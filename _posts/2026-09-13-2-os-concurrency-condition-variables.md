---
title: "[CS][OS] Concurrency - Condition Variables"
excerpt: "효율적인 synchronization을 위한 condition variables의 개념을 알아보자"

categories:
  - Operating System
tags:
  - [os, concurrency, condition variable, synchronization]

permalink: /os/concurrency-condition-variables/

toc: true
toc_sticky: true

date: 2026-09-13
last_modified_at: 2026-09-13
---

> 이 글은 Andrea Arpaci-Dusseau and Remzi Arpaci-Dusseau의 Operating Systems: Three Easy Pieces를 참고한 글입니다.  
> [여기](https://pages.cs.wisc.edu/~remzi/OSTEP/)에서 무료로 볼 수 있습니다.

# 0. Introduction

이전 글에서, 우리는 어떻게 하면 두 개 이상의 thread가 critical section에 들어가지 않게 할 수 있는지, 즉 mutex를 구현하기 위한 lock을 살펴봤다. 그러나 다음과 같은 상황에서는 어떻게 할까?

1. 부모 스레드가 자식 스레드를 10개 만든다.
2. 자식 스레드는 웹서버에 접속해서 이미지를 다운받는다.
3. 부모 스레드는 자식 스레드가 모두 이미지를 다운받을 때까지 대기하고, 작업을 이어간다.

Lock을 사용하면, 다음과 같은 해결 방법을 생각해볼 수 있다. (여기서는 리눅스의 pthread가 기본적으로 제공하는 lock을 사용한다.)

```c
#include <pthread.h>

int finished = 0;
char **urls = {...}
pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;

void *worker(void *arg) {
  BYTE *img = download((char *)arg);
  pthread_mutex_lock(&mutex);
  finished++;
  pthread_mutex_unlock(&mutex)
  // ...
}

int main() {
  pthread_t workers[10];
  for (int i = 0; i < 10; i++) {
    pthread_create(&workers[i], NULL, worker, (void *)urls[i]);
  }

  while (finished != 10) {
    // 여기서는 읽기만 하므로 race condition이 발생하지 않는다.
    // 물론 finished의 값을 가져온 직후 마지막 worker가 작업을 끝내고 
    // finished 값을 업데이트할 수 있지만
    // 루프를 다시 한 번 도는 손해 외에는 크게 문제되지 않는다.
  }

  ...
}
```

그러나 앞에서 말했듯 이 방식은 굉장히 비효율적이다. worker thread들이 실행되는 동안 main thread가 계속해서 spin-wait을 하고 있기 때문이다. 이런 상황에서 보다 효율적으로 대처할 수 있도록 **condition variable**이 등장했다.

# 1. Condition Variables

Condition variable은 `wait()`과 `signal()`을 통해 동작한다. 각각에 대한 설명은 다음과 같다.

* `wait()`: 인수로 주어진 condition variable이 특정 상태가 될 때까지 대기한다.
* `signal()`: 인수로 주어진 condition variable의 상태를 바꾼다.  
이를 통해, `wait()`중인 thread를 깨우게 된다.

pthread에서는 이를 위해 다음과 같은 함수를 제공한다.

```c
pthread_cond_wait(pthread_cont_t *c, pthread_mutex_t *m)
pthread_cond_signal(pthread_cond_t *c)
```

이때, `pthread_cond_wait()`이 mutex를 받는다는 점을 눈여겨봐야 한다. `pthread_cond_wait()`은 해당 함수가 호출되기 전에 `m`을 acquire한 상태임을 가정하며, 해당 함수가 호출되면 sleep하기 직전 lock을 푼다. 이후 다른 thread가 `pthread_cond_signal()`을 통해 해당 함수를 깨우면, 다시 lock을 acquire한 뒤 리턴하게 된다. 이에 대한 이유는 다음 코드를 보며 이해하자.

## 1-1. Example

```c
#include <stdio.h>
#include <pthread.h>

pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t c = PTHREAD_COND_INITIALIZER;
int done = 0;

void *worker(void *arg) {
  printf("worker\n");
  pthread_mutex_lock(&m);
  done = 1;
  pthread_cond_signal(&c);
  pthread_mutex_unlock(&m);
  return NULL;
}

int main() {
  pthread_t t;
  pthread_create(&t, NULL, worker, NULL);
  
  pthread_mutex_lock(&m);
  while (done == 0) {
    pthread_cond_wait(&c, &m);
  }
  pthread_mutex_unlock(&m);
  printf("main end\n");

  return 0;
}
```

위 코드의 동작을 다음 2가지 경우로 나눠 생각해 보자.

1. `pthread_create()` 직후 worker가 실행되는 경우  
worker는 "worker"를 출력하고, lock을 획득할 것이다. 다음으로 `done=1`을 실행하고, lock을 풀고, `signal()`을 통해 lock을 풀고 main을 깨운다.  
다시 main이 실행되면, done의 값이 1이기 때문에 while문을 통과해 "main end"를 출력하고 끝이 난다.
2. `pthread_create()` 직후 main이 이어서 실행되는 경우  
main은 lock을 걸고, done의 값을 살펴볼 것이다. 여기서는 `done=0`이기 때문에 `wait()`이 실행되고, lock은 풀리게 된다.  
이제 worker가 실행될 것이고, 위와 동일한 과정을 거쳐 `signal()`을 통해 lock을 풀고 main을 깨운다.  
다시 main이 실행되면, done의 값이 1이기 때문에 while문을 통과해 "main end"를 출력하고 끝이 난다.

## 1-2. Without `done`

앞선 두 가지 경우에서 제대로 동작함을 알 수 있지만, `done`이 꼭 필요할까? `done`을 없애고 다시 코드를 짜 보면 다음과 같다.

```c
void *worker(void *arg) {
  printf("worker\n");
  pthread_mutex_lock(&m);
  pthread_cond_signal(&c);
  pthread_mutex_unlock(&m);
  return NULL;
}

int main() {
  pthread_t t;
  pthread_create(&t, NULL, worker, NULL);
  
  pthread_mutex_lock(&m);
  pthread_cond_wait(&c, &m);
  pthread_mutex_unlock(&m);
  printf("main end\n");

  return 0;
}
```

이렇게 짜면, 다음과 같은 상황에서 문제가 발생한다.

1. `pthread_create()` 직후 worker가 실행된다. worker는 `signal()`을 실행하지만 아무 스레드도 깨워지지 않는다.
2. main이 실행된다. main은 `wait()`을 실행하지만, 깨워줄 스레드가 없어 영원히 sleep한다.

따라서 `done` 변수가 반드시 필요함을 알 수 있다. 

## 1-2. Without mutex

마찬가지로 mutex에 대해서도 의문을 가질 수 있는데, 만약 다음과 같이 코드를 짜면 어떻게 될까?

```c
void *worker(void *arg) {
  printf("worker\n");
  done = 1;
  pthread_cond_signal(&c);
  return NULL;
}

int main() {
  pthread_t t;
  pthread_create(&t, NULL, worker, NULL);
  
  while (done == 0) {
    pthread_cond_wait(&c);
  }
  printf("main end\n");

  return 0;
}
```

이렇게 짜면, 다음과 같은 상황에서 문제가 발생한다.

1. `pthread_create()` 직후 main이 실행된다.  
main은 while문에서 조건 테스트를 위해 done의 값을 가져온 상태에서 멈추게 된다. (당연히 `done=0`일 것이다!) 
2. 이제 worker가 실행된다. worker는 끝까지 실행되어 `signal()`을 실행한다.
3. 다시 main이 실행된다. main은 아까 가져온 `done=0`을 보고, `wait()`을 실행한다. 위와 마찬가지로, main은 깨워줄 스레드가 없어 영원히 sleep하게 된다.

따라서 이런 상황을 방지하기 위해, mutex가 필요하다는 것을 알 수 있다. 

# 2. Producer / Consumer Problem

프로그램을 만들다 보면, 한 쪽에서는 데이터를 생산하기만 하고 한 쪽에서는 읽기만 하는 경우가 있다. 예를 들어, 리눅스의 pipe가 그렇다. `cat access.log | grep 2026-09-13`같은 명령을 실행하면, `cat`은 pipe buffer에 계속해서 내용을 쓸 것이고 `grep`은 pipe buffer에서 내용을 계속 읽어들일 것이다. 이렇게 데이터를 한 쪽이 생산하고 한 쪽이 읽어들이는 관계를 **producer-consumer** 관계라고 한다. 이제부터 producer-consumer를 condition variable을 통해 구현할 것이다.

우선, 데이터를 넣는 `get()`과 `put()`을 다음과 같이 정의한다. (설명의 편의를 위해서 버퍼가 단 하나의 슬롯만 가지고 있다 가정한다.)

```c
#define MAX_SLOT ( 1 )
int buffer;
int count = 0;

void put(int value) {
  assert(count < MAX_SLOT);
  count++;
  buffer = value;
}

int get() {
  assert(count > 0);
  count--;
  return buffer;
}
```

이제 consumer와 producer를 다음과 같이 정의하자.

```c
void *producer(void *arg) {
  for (int i = 0; i < *(int *)arg; i++) {
    put(i);
  }
}

void *consumer(void *arg) {
  for (int i = 0; i < *(int *)arg; i++) {
    printf("%d\n", get());
  }
}
```

## 2-1. Mesa / Hoare Semantics

당연하게도, 이렇게 정의한 후 producer와 consumer를 실행시키면 오류가 날 것이다. 이를 해결하기 위해 condition variable을 도입해 보자.

```c
pthread_cond_t c = PTHREAD_COND_INITIALIZER;
pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;

void *producer(void *arg) {
  for (int i = 0; i < *(int *)arg; i++) {
    pthread_mutex_lock(&m);

    if (count >= MAX_SLOT) {
      // put이 불가능한 경우
      pthread_cond_wait(&c, &m);
    }
    
    put(i);
    pthread_cond_signal(&c); // 데이터가 들어오기를 기다리고 있는 consumer를 위해
    pthread_mutex_unlock(&m);
  }
}

void *consumer(void *arg) {
  for (int i = 0; i < *(int *)arg; i++) {
    pthread_mutex_lock(&m);
    
    if (count == 0) {
      // get이 불가능한 경우
      pthread_cond_wait(&c, &m);
    }

    printf("%d\n", get());
    pthread_cond_signal(&c); // 데이터가 빠지기를 기다리고 있는 producer를 위해
    pthread_mutex_unlock(&m);
  }
}
```

위 코드는 문제가 없어 보이고, 실제로 하나의 producer와 하나의 comsumer가 있다면 문제되지 않는다(직접 따라가 보면서 이해하자).
그러나 여러 개의 consumer가 존재한다면 문제가 생긴다.

예를 들어, producer <span style='color: #E06D69'>P</span>와 consumer <span style='color: #DCA83B'>C1</span>, <span style='color: #5A99C7'>C2</span>가 존재한다 가정하자.

1. 먼저 <span style='color: #DCA83B'>C1</span>이 실행된다.  
`count=0`이므로 `wait()`이 실행된다.
2. 뒤이어 <span style='color: #E06D69'>P</span>가 실행된다.  
<span style='color: #E06D69'>P</span>는 `put()`을 실행하고 `signal()`을 실행한다.  
이 시점에서 <span style='color: #DCA83B'>C1</span>은 `ready`상태가 되지만, 바로 실행된다는 보장은 없다.
3. <span style='color: #5A99C7'>C2</span>가 실행된다.  
`count=1`이기 때문에 `get()`이 실행된다. `signal()`이 실행되지만 `wait()`중인 thread가 없으므로 무시된다.
4. <span style='color: #DCA83B'>C1</span>이 실행된다.  
<span style='color: #DCA83B'>C1</span>도 `get()`을 실행하지만, 데이터가 없기 때문에 오류가 발생한다.

즉, `signal()`을 호출한 이후 무조건 `wait()`중인 스레드가 실행된다는 보장이 없기 때문에(이는 전적으로 scheduling policy에 의해 결정되는 것이다) 우리는

**`signal()`을 호출한 시점과 스레드가 깨어나는 시점의 조건이 동일함**
{: .text-center}

을 보장할 수 없다. 이를 

**Mesa Semantics**
{: .text-center}

라고 부른다. 반대의 경우인 `signal()`을 호출한 시점과 스레드가 깨어나는 시점의 조건이 동일함을 보장하는 경우(즉, `signal()` 호출 이후 무조건 대기 중인 스레드가 실행되는 경우)를

**Hoare Semantics**
{: .text-center}

라고 부른다. 현대 OS는 대부분 mesa semantics를 따르기 때문에, 수정이 필요하다.

이 문제는 간단히 해결되는데, 단순히 `if`문을 `while`문으로 다음과 같이 바꾸면 된다.

```c
void *producer(void *arg) {
  ...
  while (count >= MAX_SLOT) {
    // put이 불가능한 경우
    pthread_cond_wait(&c, &m);
  }
  ...
}

void *consumer(void *arg) {
  ...
  while (count == 0) {
    // get이 불가능한 경우
    pthread_cond_wait(&c, &m);
  }
  ...
}
```

이렇게 되면, 깨어난 이후 다시 한 번 조건을 검사하기 때문에 문제가 해결된다. 따라서, condition variable을 사용할 때는 **항상 조건을 while문으로 검사**해야 한다. (처음의 예시에서 `done`을 검사할 때 while을 사용한 것도 같은 의미에서이다.)

> **참고**  
> 해당 경우처럼, `signal()` 직후 대기 중인 스레드가 즉각적으로 깨어나지 않아 조건이 충족되지 않았는데도 아무런 이유 없이 깨어난 것처럼 보이는 현상을
> 
> **가짜 깨우기 (Spurious Wakeup)**
> {: .text-center}
> 
> 라고 한다.

## 2-2. Deadlock

그러나 위처럼 수정해도 문제가 발생하게 된다. 위와 마찬가지로 producer <span style='color: #E06D69'>P</span>와 consumer <span style='color: #DCA83B'>C1</span>, <span style='color: #5A99C7'>C2</span>가 존재한다 가정하자.

1. <span style='color: #DCA83B'>C1</span>이 실행된다.  
<span style='color: #DCA83B'>C1</span>은 `count=0`이기 때문에 `wait()`을 실행하고 sleep 상태가 된다.
2. <span style='color: #5A99C7'>C2</span>가 실행된다.  
<span style='color: #5A99C7'>C2</span>는 `count=0`이기 때문에 `wait()`을 실행하고 sleep 상태가 된다.
3. <span style='color: #E06D69'>P</span>가 실행된다.  
<span style='color: #E06D69'>P</span>는 `count=0`이기 때문에 `put()`을 실행하고, `signal()`도 실행한다.  
이 시점에서 <span style='color: #DCA83B'>C1</span>은 ready queue에 들어간다(물론 scheduling policy에 따라 <span style='color: #5A99C7'>C2</span>가 들어갈 수도 있다).  
이후 <span style='color: #E06D69'>P</span>는 멈추지 않고 실행되어 `count=1` 조건에 걸려 `wait()`을 실행하고 sleep 상태가 된다.
4. <span style='color: #DCA83B'>C1</span>이 실행된다.  
<span style='color: #DCA83B'>C1</span>은 `get()`을 실행하고, `signal()`도 실행한다.  
여기서 scheduling policy에 의해, <span style='color: #5A99C7'>C2</span>가 ready queue에 들어간다고 가정하자.
5. <span style='color: #5A99C7'>C2</span>가 실행된다. 이미 값을 <span style='color: #DCA83B'>C1</span>이 읽어 `count=0`이기 때문에 `wait()`이 실행된다. 이제 모든 스레드가 sleep 상태이다.

이 문제는, 상식적으로 producer는 consumer를 깨우고, consumer는 producer를 깨워야 하지만 condition variable을 하나만 사용해 어떤 스레드를 깨울지 명시되지 않았기 때문이다. 이를 해결하기 위해서는 condition variable 수를 2개로 늘리면 된다.

```c
void *producer(void *arg) {
  for (int i = 0; i < *(int *)arg; i++) {
    pthread_mutex_lock(&m);

    while (count >= MAX_SLOT) {
      // put이 불가능한 경우
      pthread_cond_wait(&producer_c, &m);
    }
    
    put(i);
    pthread_cond_signal(&consumer_c); // 데이터가 들어오기를 기다리고 있는 consumer를 위해
    pthread_mutex_unlock(&m);
  }
}

void *consumer(void *arg) {
  for (int i = 0; i < *(int *)arg; i++) {
    pthread_mutex_lock(&m);
    
    while (count == 0) {
      // get이 불가능한 경우
      pthread_cond_wait(&consumer_c, &m);
    }

    printf("%d\n", get());
    pthread_cond_signal(&producer_c); // 데이터가 빠지기를 기다리고 있는 producer를 위해
    pthread_mutex_unlock(&m);
  }
}
```

# 3. Covering Conditions

지금까지 `signal()`은 scheduling policy에 따라 기다리고 있는 하나의 스레드만을 깨웠다. 그러나, 다음과 같은 경우에서는 이런 방식이 충분하지 않다.

메모리가 200인 시스템을 가정하자. 현재 메모리는 모두 할당된 상황이다.

1. `allocate(100)`이 실행된다. 공간이 없기 때문에 `wait()`이 실행된다.
2. `allocate(30)`이 실행된다. 공간이 없기 때문에 `wait()`이 실행된다.
3. `free(50)`이 실행된다. `signal()`이 실행된다.

이 경우에서 만약 `allocate(30)`이 깨어난다면 좋겠지만, 만약 `allocate(100)`이 깨어난다면 충분한 공간이 없기 때문에 다시 `wait()`이 실행될 것이다. 이는 공간이 50만큼 남아 있지만 `allocate(30)`이 실행되지 않는 것이기 때문에 분명 문제가 있고, 이를 위해 pthread는 대기 중인 모든 스레드를 깨울 수 있는 `pthread_cond_broadcast()`를 제공한다. 또한, 이렇게 대기 중인 모든 스레드를 깨워야 할 필요가 있는 condition을

**Covering Condition**
{: .text-center}

라고 한다.

당연하게도, covering condition은 대기 중인 모든 스레드를 깨우는 것이기 때문에 오버헤드가 상당히 크다. 따라서 covering condition을 최소화해 `pthread_cond_broadcast()`의 사용을 최대한 줄여야 한다. 실제로 앞서 deadlock 문제를 해결했을 때도 `producer_c`, `consumer_c`로 나누지 않고 그냥 `pthread_cond_broadcast(&c)`를 사용해도 해결할 수 있었지만, 굳이 condition variable을 두 개로 나눈 것도 이러한 이유에서다.
