---
title: "[ETC][Pawnyable] Tools and Setups"
excerpt: ""

categories:
  - ETC
tags:
  - [Pawnyable, setup, tools, ROPgadget, offset calculator]

permalink: /etc/tools-and-setups/

toc: true
toc_sticky: true

date: 2025-07-17
last_modified_at: 2025-07-17
---
[pawnyable.cafe](https://pawnyable.cafe/linux-kernel)에서 커널 해킹을 공부하다 보면
1. 자주 쓰는 설정 파일 / 스크립트들
2. 자주 쓰는 코드 템플릿듯
3. 자주 쓰는 툴들
그런데 이에 대한 설명이 좀 부족한 것 같아서 보충 설명을 남기고, 또 이들에 보다 쉽게 접근하기 위해 내가 쓰는 alias와 팁들을 정리해 보려고 한다.  

이에 앞서 디렉토리 구조는 다음과 같다.

- LKXX
  - qemu/
    - root/
      - exploit.c (직접 만듦)
    - bzImage
    - rootfs.cpio
    - run.sh
  - src/
    - vuln.c
    - vuln.ko

(처음 받으면 `rootfs.cpio`만 있을 것이다. `mkdir root; cd root; cpio -idv < ../rootfs.cpio`를 통해 cpio를 풀어주자)
  
# 1. 스크립트 / 설정 파일
## 1-1. run.sh
`qemu`를 시작하기 위해 쓰이는 스크립트이다.

### 1-1-1. qemu 옵션
처음 받아 열어보면 아래와 같을 것이다.
```shell
#!/bin/sh

qemu-system-x86_64 \
    -m 64M \
    -nographic \
    -kernel bzImage \
    -append "console=ttyS0 loglevel=3 oops=panic panic=-1" \
    -no-reboot \
    -cpu kvm64,+smep\
    -smp 1 \
    -monitor /dev/null \
    -initrd rootfs.cpio \
    -net nic,model=virtio \
    -net user
```

여기서 중요한 옵션은 `-append` 옵션과 추가해야 하는 `-gdb` 옵션이다.
- `-append` 옵션은 커널에 다양한 인수를 주어 실행시킬 수 있는 옵션이다. 예를 들어 `nopti` 옵션을 주면 KPTI가 비활성화되며, `nokaslr` 옵션을 주면 KASLR이 비활성화된다.
- `-gdb` 옵션은 커널에 GDB를 remote로 붙여 디버깅이 가능하도록 한다. `-gdb tcp::6626`처럼 구성해 커널을 실행하면 gdb에서 `target remote 6626` 명령을 이용해 커널 디버깅을 할 수 있게 된다. 

### 1-1-2. 자동 컴파일 / 아카이빙

나는 보통 root 디렉토리 안에 `exploit.c`를 만들고 컴파일한 후, 전체를 cpio로 아카이빙해 파일시스템을 구성하는 편이다. 따라서 매 실행시마다 `exploit.c`를 다시 컴파일하고 아카이빙하는 과정이 필요해
`run.sh` 앞 부분에 다음 스크립트를 추가한다.
```shell
#!/bin/sh

cd root
# 미리 컴파일해뒀던 파일들을 삭제함
rm exploit 
rm test

# 다시 컴파일함
musl-gcc -o exploit exploit.c -static
musl-gcc -o test test.c -static

# cpio로 아카이빙해서 파일시스템을 구성함
find . -print0 | cpio -o --format=newc --null --owner=root > ../rootfs_updated.cpio
cd ..

qemu-system-x86_64 \
    ...
    -initrd rootfs_updated.cpio \   # 여기가 바뀜!
    ...
```

전체 스크립트는 다음과 같다.

<details>
<summary>펼치기/접기</summary>
{% highlight shell %}
#!/bin/sh

cd root
rm exploit
rm test

musl-gcc -o exploit exploit.c -static
musl-gcc -o test test.c -static

find . -print0 | cpio -o --format=newc --null --owner=root > ../rootfs_updated.cpio
cd ..

qemu-system-x86_64 \
    -m 64M \
    -nographic \
    -kernel bzImage \
    -append "console=ttyS0 loglevel=3 oops=panic panic=-1" \
    -no-reboot \
    -cpu kvm64,+smep \
    -smp 1 \
    -monitor /dev/null \
    -initrd rootfs_updated.cpio \
    -net nic,model=virtio \
    -net user \
    -gdb tcp::6626
{% endhighlight %}
</details>

수정할 일도 많고 실행할 일도 많아서 나는 다음과 같은 alias를 지정해두고 사용하는 편이다.
```shell
vimsh='vim run.sh'
runsh=./run.sh
```

## 1-2. S99pawnyable

init 스크립트 중 하나로, 부팅 후 쉘을 만들어주고 각종 보안 옵션들을 설정하는 파일이다. 아마 이렇게 되어있을 것이다.
```shell
#!/bin/sh

##
## Setup
##
mdev -s
mount -t proc none /proc
mkdir -p /dev/pts
mount -vt devpts -o gid=4,mode=620 none /dev/pts
chmod 666 /dev/ptmx
stty -opost
echo 2 > /proc/sys/kernel/kptr_restrict       # (1)
echo 1 > /proc/sys/kernel/dmesg_restrict      # (2)

##
## Install driver
##
insmod /root/vuln.ko
mknod -m 666 /dev/holstein c `grep holstein /proc/devices | awk '{print $1;}'` 0

##
## User shell
##
echo -e "\nBoot took $(cut -d' ' -f1 /proc/uptime) seconds\n"
echo "[ Holstein v1 (LK01) - Pawnyable ]"
setsid cttyhack setuidgid 1337 sh            # (3)

##
## Cleanup
##
umount /proc
poweroff -d 0 -f
```
여기서 중요한 부분은 다음과 같다.

- (1) KADR (Kernel Address Display Restriction) 관련 내용이다.  
실제로 이를 주석처리하지 않고 커널을 부팅한 후 `/proc/kallsyms`를 읽어 보면 주소가 하나도 나오지 않는 것을 볼 수 있다. 주석처리해두자.  
- (2) dmesg를 볼 수 없도록 하는 옵션이다. 이것도 디버깅할 때 방해가 되므로 주석처리해두자.  
- (3) setuidgid를 통해 사용자의 uid와 gid를 지정한다. 이때 1337 대신 0을 써두면 부팅 후 루트 사용자로 쉘을 사용할 수 있다. 디버깅할 때는 0으로 설정하자.  

디버깅을 하다 보면 (3)번을 정말 자주 설정해야 하기 때문에 수정할 일이 많은 파일이다. 그래서 나는 이 파일도 `run.sh`와 마찬가지로 alias를 지정해두고 쓰는 편이다. 
```shell
vims99='vim root/etc/init.d/S99pawnyable'
```

# 2. 코드 템플릿

이에 대한 설명은 [Kernel Exploit Tech](/categories/kernel-exploit-tech/)에 나와 있다.

## 2-1. save_state()

```c
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
```

## 2-2. win()
```c
static void win() {
    char *argv[] = { "/bin/sh", NULL };
    char *envp[] = { NULL };
    puts("[+] win!");
    execve("/bin/sh", argv, envp);
}
```

## 2-3. ROP

```c
p = (unsigned long *)&buf[0x100];
*p++ = 0xdeadbeef;
*p++ = pop_rdi_ret;
*p++ = 0;
*p++ = prepare_kernel_cred;
*p++ = pop_rcx_ret;
*p++ = 0;
*p++ = mov_rdi_rax_rep_movsq_ret;
*p++ = commit_creds;
*p++ = swapgs_restore_regs_and_return_to_usermode;
*p++ = 0xdeadbeef;
*p++ = 0xcafebebe;
*p++ = (unsigned long)&win;
*p++ = user_cs;
*p++ = user_rflags;
*p++ = user_rsp;
*p++ = user_ss;
```

## 2-4. Consts

```c
#define koffset                                     

#define prepare_kernel_cred                         (kbase + )
#define commit_creds                                (kbase + )
#define swapgs_restore_regs_and_return_to_usermode  (kbase + )

#define pop_rdi_ret                                 (kbase + )
#define pop_rcx_ret                                 (kbase + )
#define mov_rdi_rax_rep_movsq_ret                   (kbase + )
```

# 3. 자주 쓰는 툴

## 3-1. extract-vmlinux
`bzImage`에서 `vmlinux`를 뽑아내기 위해 쓴다. 사용할 수 있는 ROP gadget을 찾는 과정에서 `vmlinux` 파일이 필요하기 때문에 거의 필수이다.

```shell
wget -O https://raw.githubusercontent.com/torvalds/linux/master/scripts/extract-vmlinux
./extract-vmlinux bzImage > vmlinux
```

## 3-2. ROPgadget
ROP 가젯을 찾는 데 있어서 최고의 툴이라고 생각한다. 그러나 커널 이미지는 너무 커서 한 번 찾는 데 시간이 많이 걸리므로 결과를 파일로 저장해 뒀다
필요할 때 `cat`을 통해 찾는 편이 좋다.
```shell
ROPgadget --binary vmlinux > gadgets.txt
cat gadgets.txt | grep ~~~
```

## 3-3. offsetcalc.py
오프셋을 조금 더 편하게 계산하기 위해 만들었다. KASLR이 꺼진 상황에서 사용해야 한다.
```py
#!/usr/bin/python3
import sys

textbase = 0xffffffff81000000

if sys.argv[1] == "i":
    print(hex(int(sys.argv[2], 16) + textbase))
    exit(0)

target = int(sys.argv[1], 16)

print(hex(target - textbase))
```
```shell
# 오프셋 계산
~$ ./offsetcalc.py 0xffffffff811f32f2
0x1f32f2

# 오프셋으로부터 주소 계산
~$ ./offsetcalc.py i 0x1f32f2
0xffffffff811f32f2
```