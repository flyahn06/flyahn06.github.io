---
title: "[CS][OS] Concurrency - Locks"
excerpt: "Race condition 해결을 위한 lock의 개념을 알아보자"

categories:
  - Operating System
tags:
  - [os, concurrency, critical section, test-and-set, compare-and-swap, load-linked, store-conditional, fetch-and-add]

permalink: /os/concurrency-locks/

toc: true
toc_sticky: true

date: 2026-09-13
last_modified_at: 2026-09-13
---

> 이 글은 Andrea Arpaci-Dusseau and Remzi Arpaci-Dusseau의 Operating Systems: Three Easy Pieces를 참고한 글입니다.  
> [여기](https://pages.cs.wisc.edu/~remzi/OSTEP/)에서 무료로 볼 수 있습니다.

# 0. Introduction

이전 글에서, 다수의 thread가 하나의 변수에 접근해 값을 쓰려고 할 때 race condition이 발생한다는 사실을 알았다. 이를 해결하기 위해 하드웨어가 제공하는 atomic operation들을 사용해서 thread간 synchronization을 해야 하는데, 이를 위해 등장한 개념이 **lock**이다. 

# 1. Locks / Mutex

기본적으로 lock은 race condition이 일어날 수 있는 영역, 즉 

**Critical Section**
{: .text-center}

에 들어가기 전에 설정되고 critical section 이후 해제된다. 예를 들어, 저번 글에서 살펴본 `counter++`에 lock을 적용하면 다음과 같을 것이다.

```c
lock_t counter_lock;

// ...

lock(&counter_lock);
counter++;    // critical section
unlock(&counter_lock);
```

이렇게 되면, 한 thread(`t1`이라 하자)가 `counter++`를 실행하는 도중 정지되고 다른 thread(`t2`라 하자)가 실행권을 얻더라도, 
`t1`이 lock을 이미 걸어놓은 상태이기 때문에 `t2`는 critical section에 진입할 수 없고 `lock(&counter_lock)`에서 대기할 것이다.
이후 `t1`이 실행권을 얻어 `unlock(&counter_lock)`을 실행하게 되면 비로소 `t2`도 `lock(&counter_lock)`을 넘어 critical section에 진입할 수 있게 되는 것이다. 따라서 lock은 다음 2가지의 상태를 갖는다.

* 아무도 lock을 점유하고 있지 않은 경우인 **unlocked**(혹은 **available**, **free**) 상태
* 특정 thread가 lock을 점유하고 있는 **locked** (혹은 **acquired**, **held**) 상태

이처럼 lock을 사용해 critical section에 한 thread만 들어올 수 있게 하는 기술을

**상호 배제 (Mutual Exclusion, mutex)**
{: .text-center}

라고 한다.

# 2. Metrics

Lock을 만들기 앞서, 만든 lock을 평가하기 위해 다음 3가지 지표를 사용한다.

1. **Mutual exclusion을 제공하는가?**  
당연하게도, 만약 만든 lock이 mutual exclusion을 제공하지 않아 다수의 thread가 critical section에 진입한다면 완전히 쓸모가 없을 것이다.
2. **공정한가?**  
Scheduling에서 본 것처럼, 만약 특정 thread가 critical section을 독점하게 된다면 남은 thread들은 계속해서 대기만 하는 starvation 문제가 생길 수 있다.
3. **성능이 좋은가?**  
Lock을 걸거나 풀 때, 혹은 대기할 때 생기는 overhead가 최소한이어야 된다.

# 3. Types of Locks

## 3-1. Disabling Interrupt

가장 쉬운 방법으로, critical section에 있는 동안은 해당 thread가 interrupt되지 않도록 interrupt 자체를 꺼 버리는 방법이 있을 것이다. 이를 사용하면 다음과 같이 mutex를 구현할 수 있다. 

```c
disable_interrupt(current_cpu);
counter++;
enable_interrupt(currnet_cpu);
```

그러나 이는 문제가 굉장히 많다. 우선 프로세서의 개수가 1이라면 mutual exclusion을 제공할 것이다. 그러나 critical section에서 굉장히 무거운 작업을 실행한다면, 다른 thread, process, 심지어는 OS도 실행권을 못 받게 되고 starvation 문제가 발생할 수 있다. 더 나아가 악성 프로그램이 이를 사용해 CPU를 독점한다면 사용자는 컴퓨터를 재부팅하는 방법밖에 없다. 

또한, 현대 CPU는 프로세서의 개수가 1이 아니다. 이런 경우, 만약 thread들이 서로 다른 프로세서 위에서 실행된다면 mutual exclusion도 기대할 수 없다. `CPU 1`에서 실행되는 `t1`이 `disable_interrupt(1)`을 실행 후 critical section에 진입해도 `CPU 2` 위에서 실행되는 `t2`도 `disable_interrupt(2)`를 실행하고 critical section에 진입할 수 있기 때문이다. 따라서 interrupt를 제어하는 것으로는 lock을 구현할 수 없다.

## 3-2. Using Flag

그렇다면 다음과 같은 방식 또한 생각해볼 수 있다.

```c
int flag = 0;

void lock() {
  while (flag) {}  // spin-lock
  flag = 1;
}

void unlock() {
  flag = 0;
}
```

위 방식은 단순히 전역 변수 `flag`를 두고, 해당 값이 `1`이면 `locked` 상태로 간주하고 `0`이면 `unlocked` 상태로 간주하는 것이다. 그러나 다음과 같은 상황을 생각해볼 수 있다.

1. `t1`이 `lock()`을 호출한다. 최초의 `flag`는 `0`이기 때문에 while문을 통과한다. 
2. `t1`이 interrupt되고 `t2`가 실행된다. 마찬가지로 while문을 통과한다.
3. `t2`가 interrupt되고 `t1`이 실행된다. `flag`를 `1`로 설정한다. Critical section에 진입한다.
4. `t1`이 interrupt되고 `t2`가 실행된다 `flag`를 `1`로 설정한다. Critical section에 진입한다.

즉, `flag`라는 변수를 검사하고 설정하는 것도 critical section의 일부이기 때문에, 결국 같은 race condition이 발생하게 되는 것이다. 
즉 우리는 `lock`을 구현하기 위해 하드웨어의 도움을 받을 수밖에 없고, 따라서 하드웨어는 여러 atomic operation들을 통해 lock의 구현을 가능하게 한다.

## 3-3. Test-and-Set

하드웨어가 제공하는 가장 간단한 atomic operation은 test-and-set이다[^1]. 이를 C코드로 표현하면 다음과 같다.

```c
int test_and_set(int *pold, int new) {
  int old = *pold;
  *pold = new;
  return old;
}
```

이는 단순히 메모리 주소를 하나 받아 그 값을 새로운 값으로 업데이트하고, 이전 값을 돌려주는 것이다. 여기서 하나 기억해야 할 것은 이 동작은 atomic하다는 것이다. 즉, 이해를 위해 C 코드로 바꿔 설명한 것일 뿐 사실 이 과정은 하나의 어셈블리로 번역된다.

이제 이를 사용하면, 다음과 같이 lock을 구현할 수 있다.

```c
int flag = 0;

void lock() {
  while (test_and_set(&flag, 1) == 1) {}
}

void unlock() {
  flag = 0;
}
```

`test_and_set(&flag, 1)`이 결국 lock을 acquire하기 위한 것이라고 생각하고, 다음 2가지 경우로 나눠 생각해보자.

1. lock이 걸려있는 경우  
이 경우 `test_and_set(&flag, 1)`은 1을 반환하게 된다. 따라서 while문을 벗어나지 못한다.
2. lock이 걸려있지 않은 경우  
이 경우 `test_and_set(&flag, 1)`은 0을 반환하게 된다. 따라서 while문을 벗어나고, `flag`는 1로 업데이트된다.

이때, `test_and_set()`은 값을 가져오는 것과 업데이트하는 것을 atomic하게 처리하기 때문에, race condition이 일어날 수 없고 따라서 mutex를 보장한다.

> **참고**  
> 개인적으로 C코드로 보는 것보다 해당 코드가 어셈블리로 어떻게 번역될가를 생각해보는 것이 이해에 도움이 된다고 생각한다.  
> lock 부분을 예시로 번역하여 살펴보면 다음과 같을 것이다.  
> ```nasm
> lock:
>   mov eax, 1
>   xchg eax, DWORD PTR [flag]
>   test eax, eax
>   jnz lock
>   ret
> ```
> 해당 lock의 어느 부분에서 interrupt되더라도 mutex가 보장된다는 것은 직접 생각해 보자.

## 3-4. Compare-And-Swap

Compare-and-swap도 마찬가지로 하드웨어가 제공하는 atomic operation이며[^2], C코드로 나타내면 다음과 같다.

```c
int compare_and_swap(int *ptr, int expected, int new) {
  int actual = *ptr;
  if (actual == expected) *ptr = new;
  return actual;
}
```

즉 compare-and-swap은 해당 메모리 주소의 값이 `expected`와 동일하다면 값을 바꾸고 그렇지 않으면 바꾸지 않으며, 두 경우 모두에서 이전에 저장되어 있던 값을 리턴하는 atomic operation이다.

마찬가지로 이를 활용하면 다음과 같이 lock을 구현할 수 있다.

```c
int flag = 0;

void lock() {
  while(compare_and_swap(&flag, 0, 1) == 1) {}
}

void unlock() {
  flag = 0;
}
```

동작 원리는 test-and-set과 매우 비슷하다. 차이점은 test-and-set은 무조건 해당 위치에 값을 설정하지만, compare-and-swap은 값을 검사한 후 설정한다는 것이다. Test-and-set과 마찬가지로 compare-and-swap은 값을 가져와 검사하고 설정하는 것을 atomic하게 처리하기 때문에, mutex를 보장할 수 있다.

> **참고**  
> 마찬가지로 lock 부분을 예시로 번역하여 살펴보면 다음과 같을 것이다.  
> ```nasm
> lock:
>   mov eax, 0
>   mov ebx, 1
>   ; cmpxchg는 accumulator와 값을 비교
>   lock cmpxchg DWORD PTR [flag], ebx
>   jnz lock
>   ret
> ```
> 해당 lock의 어느 부분에서 interrupt되더라도 mutex가 보장된다는 것은 직접 생각해 보자.

## 3-5. Load-Linked / Store-Conditional

우선 C코드로 해당 operation을 살펴보면 다음과 같다[^3].

```c
int load_linked(int *ptr) {
  return *ptr;
}

int store_conditional(int *ptr, int new) {
  if (check_if_updated(ptr)) {
    // 만약 해당 주소가 마지막으로 load_linked된 뒤
    // 값이 바뀐 경우 실패
    return 0;
  }
  // 해당 주소가 마지막으로 load_linked된 뒤
  // 값이 바뀌지 않았다면 업데이트
  *ptr = value;
  return 1;
}
```

Compare-and-swap과 비슷해 보이지만, store-conditional은 값을 직접적으로 비교하는 것이 아니라 "해당 값에 업데이트가 일어났냐"를 감시하는 것이다. 여기서 lock에 직접적으로 변화가 생길 때는 acquire할 때와 release할 때라는 점을 고려하면 결국 compare-and-swap과 비슷하게 lock을 구현할 수 있게 된다.

```c
int flag = 0;

void lock() {
  while (1) {
    while (load_linked(&flag) == 1) {}
    if (store_conditional(&flag, 1) == 1)
      break;
  }
}

void unlock() {
  flag = 0;
}
```

조금 헷갈릴 수 있지만, 다음과 같이 critical section에 접근하는 <span style='color: #E06D69' markdown='1'>`t1`</span>, <span style='color: #DCA83B' markdown='1'>`t2`</span>, <span style='color: #5A99C7' markdown='1'>`t3`</span>을 예시로 생각해 보자.

1. <span style='color: #E06D69' markdown='1'>`t1`</span>은 lock을 acquire한 상태로, critical section에서 작업을 수행하는 중이다.  
<span style='color: #DCA83B' markdown='1'>`t2`</span>는 `while (load_linked(&flag) == 1) {}`에서 spin-lock을 수행하는 중이다.  
<span style='color: #5A99C7' markdown='1'>`t3`</span>도 마찬가지로 `while (load_linked(&flag) == 1) {}`에서 spin-lock을 수행하는 중이다.  
2. <span style='color: #E06D69' markdown='1'>`t1`</span>이 작업을 끝내고 `flag`를 0으로 만든다.
3. <span style='color: #DCA83B' markdown='1'>`t2`</span>가 실행된다. 이제 `flag=0`이므로 while문을 탈출하게 된다.
4. <span style='color: #5A99C7' markdown='1'>`t3`</span>가 실행된다. 마찬가지로 while문을 탈출한다.  
이후 <span style='color: #5A99C7' markdown='1'>`t3`</span>는 `store_conditional()`을 실행한다. 이때, 마지막으로 <span style='color: #5A99C7' markdown='1'>`t3`</span>가 `load_linked()`를 수행한 후 값이 바뀌지 않았기 때문에 이는 성공한다. 이제 `flag=1`이다. <span style='color: #5A99C7' markdown='1'>`t3`</span>은 critical section에 진입한다.
5. <span style='color: #DCA83B' markdown='1'>`t2`</span>가 다시 실행된다. <span style='color: #DCA83B' markdown='1'>`t2`</span>도 `store_conditional()`을 실행하지만, 마지막으로 `t2`가 `load_linked()`를 수행한 후 값이 바뀌었기 때문에 (0에서 1로) 이는 실패한다. 따라서 <span style='color: #DCA83B' markdown='1'>`t2`</span>는 다시 spin-lock을 수행한다.

> **참고**  
> 마찬가지로 lock 부분을 예시로 번역하여 살펴보면 다음과 같을 것이다. (ARMv8-A)  
> ```nasm
> lock:
>   mov  x10, 1
>   ldxr x8, [flag]       ; 실제로는 ldaxr 사용
>   cbnz x8, lock
>   stxr w9, x10, [flag]
>   cbnz w9, lock         ; 성공했을때 0
>   ret
> ```
> 해당 lock의 어느 부분에서 interrupt되더라도 mutex가 보장된다는 것은 직접 생각해 보자.

## 3-6. Fetch-And-Add (Ticket Lock)

마지막으로 살펴볼 atomic operation은 fetch-and-add이다[^4].

```c
int fetch_and_add(int *ptr) {
  int old = *ptr;
  *ptr++;
  return old;
}
```

이를 사용하면, ticket lock이라는 lock을 만들 수 있다.

```c
int ticket = 0;
int turn = 0;

void lock() {
  int myturn = fetch_and_add(&ticket);
  while (turn != myturn) {}
}

void unlock() {
  turn++;
}
```

굉장히 간단한 로직이기 때문에 한 번 따라가면서 생각해보자.

# 4. Waiting

지금껏 우리는 spin-lock을 사용해 lock이 acquire될때까지 대기했다. 그러나 이는 CPU 사이클을 계속해서 소비하기 때문에, busy wait이라 불린다. 그러나 이런 방식을 사용하면 의미없는 조건을 비교하는 데 CPU 사이클을 소비하기 때문에 굉장히 비효율적이다. 따라서 lock을 acquire하기 전 대기하는 과정에서 더 효율적인 방법이 필요하다.

## 4-1. Yielding

가장 간단한 방법으로, lock이 acquired 상태라면 스스로 CPU를 release하는 (즉, 스스로 deschedule하는) 방법을 고려해볼 수 있다. C코드로 나타내면 다음과 같을 것이다.

```c
void lock() {
  while (lock is held)
    deschedule();
  // ...
}
```

이러한 방식을 사용하면 실제로 lock을 hold하고 있는 스레드가 대기하는 스레드보다 CPU를 더 많이 사용하게 되어 효율적이게 된다. 그러나 현대의 scheduler가 거의 예측할 수 없는 방식으로 동작한다는 것을 고려하면, 대기하는 스레드가 많은 경우 특정 스레드가 CPU를 독점하고 나머지 스레드들은 starvation 문제를 겪을 수 있다는 문제점이 있다. (100개의 thread가 lock을 사용중인데, `t1`과 `t2`가 schedule을 상대적으로 많이 받는다면 둘만이 lock을 독점할 수 있다.)

## 4-2. Queueing

이를 해결하기 위해, queue를 사용해볼 수 있다. queue는 FIFO를 따르기 때문에, lock을 획득하지 못한 thread가 queue에 자신을 등록하는 방식을 채택하면 보다 공평하게 schedule될 수 있다. 

이를 설명하기 위해 Solaris가 제공하는 `park()`와 `unpark()`를 사용한다. 간단히 말해 `park()`는 현재 thread를 sleep상태로 전환하는 것이고 `unpark(thread_id)`는 해당 tid의 thread를 깨워 실행시키는 것이다. 이들을 사용해 C로 구현하면 다음과 같을 것이다.

```c
int flag = 0;   // main lock
int guard = 0;
queue q;

void lock() {
  while (test_and_set(guard, 1)) {}  // guard를 얻기 위해 spin-wait
  // ----- Critical section protected by guard -----
  if (flag == 0) {
    flag = 1;   // acquire main lock
    guard = 0;  // release guard lock
  } else {
    // lock이 걸려있는 경우
    queue_add(&q, current_thread_id);
    guard = 0;
    park();  // sleep 상태로 전환
  }
}

void unlock() {
  while (test_and_set(guard, 1)) {}  // guard를 얻기 위해 spin-wait
  // ----- Critical section protected by guard -----
  if (is_empty(&q)) {
    // 기다리고 있는 thread가 없기 때문에 lock을 release
    lock = 0;
    guard = 0;
  } else {
    // 기다리고 있는 thread가 있기 때문에 lock을 hold한 채로 해당 thread를 깨워야 함!
    // 즉, lock의 소유권을 unpark되는 thread로 이전하는 것과 비슷함
    unpark(get(&q));
  }
  guard = 0;
}
```

여기서 `guard`를 얻기 위해 spin-lock을 사용한다는 것에 의문이 들 수 있다. 하지만 여기서 중요한 것은 `guard`가 제공하는 critical section의 크기는 예상할 수 있고 또 매우 작다는 것이다. 일반적으로 유저가 lock을 얻은 이후 진입하는 critical section의 길이는 알 수 없기 때문에, 여기서 spin-lock을 사용하는 것은 굉장히 비효율적일 수 있다. 그러나 `guard`가 제공하는 critical section은 짧기 때문에, 상대적으로 spin-lock으로 인해 유발되는 비효율적인 측면이 작아지게 된다. 

즉, 이 방법의 핵심은 spin-lock으로 대기하는 시간을 최소한으로 줄임으로써 비효율을 최소화하는 것이다.

그러나 이 방법도 문제점이 있다. 예를 들어, 다음과 같은 상황을 가정하자.

1. `t1`이 critical section 안에 있는 상황에서, `t2`가 `lock()`을 실행한다.
2. `t2`는 자신을 queue에 넣고, `guard`에 대한 lock을 해제한다.
3. 이때 `t1`이 다시 실행되고, `unlock()`을 실행한다. 이때, queue에 `t2`가 들어 있기 때문에 `unpark(t2)`를 실행한다.
4. `t2`가 다시 실행권을 얻으면, `park()`가 실행되며 멈춘다.

이렇게 되면 `t2`는 lock을 얻은 상태에서 영원히 잠들게 된다. 이를 해결하기 위해 Solaris는 `setpark()`를 제공한다. `setpark()`는 해당 thread가 곧 `park()`될 것이라고 표시하며, 만약 `setpark()`가 실행된 후 interrupt 발생 후 다시 돌아와 `park()`가 실행되면 해당 `park()`는 바로 리턴하게 된다. 따라서, 다음과 같이 수정하면 문제를 해결할 수 있게 된다.

```c
queue_add(&q, current_thread_id);
setpark();
guard = 0;
// sleep 상태로 전환
// 만약 interrupt된 이후 unpark()로 다시 실행권을 얻게 된다면
// sleep 상태로 전환하지 않고 그대로 실행됨
park();
```

[^1]: AMD64 어셈블리 기준 `xchg`가 이에 해당한다.
[^2]: AMD64 어셈블리 기준 `cmpxchg`가 이에 해당한다.
[^3]: AMD64는 해당 기능을 제공하지 않는다. ARMv8-A 어셈블리 기준으로는 `ldxr`, `stxr`에 해당된다. 
[^4]: AMD64 어셈블리 기준 `xadd`가 이에 해당한다.
