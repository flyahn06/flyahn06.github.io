---
title: "[CS][OS] Concurrency - Introduction"
excerpt: "Multi-thread 환경에서의 concurrency 문제를 알아보자"

categories:
  - Operating System
tags:
  - [os, concurrency, race condition, atomicity, thread, locks, mutex, semaphore]

permalink: /os/concurrency-intro/

toc: true
toc_sticky: true

date: 2026-09-12
last_modified_at: 2026-09-12
---

> 이 글은 Andrea Arpaci-Dusseau and Remzi Arpaci-Dusseau의 Operating Systems: Three Easy Pieces를 참고한 글입니다.  
> [여기](https://pages.cs.wisc.edu/~remzi/OSTEP/)에서 무료로 볼 수 있습니다.

# 0. Introduction

웹페이지에 접속해 이미지를 다운받는 프로그램을 생각해 보자. 만약 다운로드할 이미지가 하나라면 우선 서버에 요청을 보낸 후 이미지를 다운받고, 저장하면 될 것이다. 이 방법은 큰 문제가 없어 보이지만 이미지가 10개라면 말이 달라진다. 한 이미지를 다운받는 동안 다른 요청을 보낼 수 없기 때문에 I/O 시간이 길어지게 되고, 결과적으로 CPU가 idle인 상태로 대기하게 되어 굉장히 비효율적일 것이다. 그러나 앞서 scheduling에서 살펴봤듯, 새로운 process 비슷한 걸 만들어서 한 process가 I/O 작업을 수행하는 동안 다른 process도 동시에 요청을 보내고 I/O 작업을 수행하면 어떨까? 이를 위해 **스레드**가 등장했다.

스레드는 기본적으로 process와 매우 비슷하다. 그러나 한 가지 다른 점은, 부모 process와 code, data, heap 영역을 공유한다는 것이다. 다시 말해, 스레드는 stack만 별도인 경량 process라고 생각해도 된다. 이를 통해, I/O-bound한 작업들의 병렬성을 올림으로써 효율적으로 작업을 처리할 수 있다. 

# 1. Race Condition

겉보기에 스레드는 매우 편해 보이지만, 다음과 같은 경우를 한 번 생각해보자.

```c
#include <stdio.h>
#include <pthread.h>
#define LOOP ( 100000 )

int counter = 0;

void *worker(void* args) {
  for (int i = 0; i < LOOP; i++)
    counter++;

  return NULL;
}

int main() {
  pthread_t t1, t2;

  // t1, t2 생성
  pthread_create(&t1, NULL, worker, NULL);
  pthread_create(&t2, NULL, worker, NULL);

  // t1, t2가 끝날 때까지 기다림
  pthread_join(t1, NULL);
  pthread_join(t1, NULL);

  printf("Final counter: %d\n", counter);
  return 0;
}
```

간단히 설명하면, 전역 변수 `counter`를 `100000`씩 증가시키는 스레드를 2개 만든 것이다 (스레드는 data section을 공유하기 때문에 어느 스레드에서나 전역 변수에 접근이 가능하다는 점을 기억하자!). 실행시키면 `t1`, `t2`가 각각 `counter`를 `100000`씩 증가시키므로 최종 결과는 `200000`이 나올 것이라고 예상할 수 있다. 그러나 실제로 이를 컴파일하고 실행하면,

```sh
$ gcc -o race_cond race_cond.c
$ ./race_cond
Final counter: 100000
$ ./race_cond
Final counter: 82219
$ ./race_cond
Final counter: 108105
```

예상과는 전혀 다른 엉뚱한 결과가 나온 것을 확인할 수 있다. 이런 결과가 나온 이유를 이해하려면, 어셈블리를 살펴봐야 한다. `worker`는 다음과 같이 어셈블리로 번역된다.

```nasm
; Dump of assembler code for function worker:
push   rbp
mov    rbp,rsp
mov    QWORD PTR [rbp-0x18],rdi
mov    DWORD PTR [rbp-0x4],0x0
jmp    0x1151 <worker+36>
mov    eax,DWORD PTR [rip+0x2ee8]        # 0x402c <counter>
add    eax,0x1
mov    DWORD PTR [rip+0x2edf],eax        # 0x402c <counter>
add    DWORD PTR [rbp-0x4],0x1
cmp    DWORD PTR [rbp-0x4],0x1869f
jle    0x113e <worker+17>
mov    eax,0x0
pop    rbp
ret
```

여기서, `counter++` 구문은 다음 3줄에 대응된다. 편의상 각 줄을 `A`, `B`, `C`라 하자.

```nasm
A: mov    eax,DWORD PTR [rip+0x2ee8]        # 0x402c <counter>
B: add    eax,0x1
C: mov    DWORD PTR [rip+0x2edf],eax        # 0x402c <counter>
```

여기서 핵심은, `counter++`라는 한 줄이 어셈블리 3줄에 대응된다는 것이다. 이 사실을 잘 고려하면서, OS가 `t1`과 `t2`를 어떻게 scheduling할지 생각해보면 다음과 같은 상황을 떠올릴 수 있다.

1. `t1`이 `A`를 실행한다. `eax`에 `counter` 값이 저장된다. 예시로 100이라고 하자.  
(`t1_eax = 100`, `t2_eax = XXX`, `counter = 100`)
2. OS가 `t1` 실행을 멈추고, `t2`를 실행한다. 
3. `t2`가 `A`를 실행한다. `eax`에 `counter` 값이 저장된다. 여기서도 100이 된다!  
(`t1_eax = 100`, `t2_eax = 100`, `counter = 100`)
4. `t2`가 `B`, `C`를 실행한다. 이제 `eax`는 101이 되고, `counter` 값도 101이 된다.  
(`t1_eax = 100`, `t2_eax = 101`, `counter = 101`)
5. OS가 `t2`를 멈추고 `t1`을 다시 실행한다.
6. `t1`은 `B`, `C`를 실행한다. `eax`는 101이 되고, 역시 `counter` 값도 101이 된다.  
(`t1_eax = 101`, `t2_eax = 101`, `counter = 101`)

즉, 1~6번의 과정에서 우리는 `counter`가 102가 되기를 희망하지만 OS가 어떻게 이들을 scheduling하냐에 따라 결과가 틀어질 수 있다는 것이다. 이때 OS가 어떤 식으로 process를 scheduling할지는 거의 non-deterministic하다는 점을 고려하면, 왜 실행할 때마다 결과가 달라졌는지도 설명할 수 있다.

이렇듯 여러 스레드가 하나의 자원에 접근하며 서로 값을 쓰려는 상황을

**경쟁 조건 (Race Condition)**
{: .text-center}

이라고 한다.

# 2. Atomicity / Synchronization

이를 해결하기 위해서는, 다음과 같이 어셈블리 명령을 추가하면 된다.

```nasm
memory_add DWORD PTR [rip+0x2edf], 0x1
```

이렇게 되면 `counter++`이 하나의 어셈블리로 번역되기 때문에, 위의 race condition이 발생하지 않을 것이다. 이렇듯 어떤 작업 도중 interrupt되지 않는 것, 다시 말해 "전혀 실행되지 않거나 끝까지 실행되는 특성"을

**원자성 (Atomicity)**
{: .text-center}

라고 한다. 즉, 위의 경우는 `counter++`를 **atomic operation**으로 만들어 race condition을 해결한 경우이다.

그러나 race condition은 단순히 이런 상황만 있는 것이 아니다. 예를 들어, 다수의 thread가 하나의 linked list를 사용하는 경우, 여기서의 race condition을 막기 위해 linked list에 원소를 추가/제거하는 atomic한 어셈블리를 만들 수는 없는 노릇이다. 따라서 우리는, 하드웨어가 제공해주는 최소한의 atomic operation을 사용해 이를 통해 race condition을 해결해야 한다. 이러한 행위를

**동기화 (Synchronization)**
{: .text-center}

라고 한다. 또한 이때 사용되는 atomic operation들을 **Synchronization Primitives**라고 한다.
