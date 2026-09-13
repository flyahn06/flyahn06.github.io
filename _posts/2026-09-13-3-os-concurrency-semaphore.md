---
title: "[CS][OS] Concurrency - Semaphores"
excerpt: "Semaphore의 개념을 알아보자"

categories:
  - Operating System
tags:
  - [os, concurrency, critical section, semaphore]

permalink: /os/concurrency-semaphores/

toc: true
toc_sticky: true

date: 2026-09-13
last_modified_at: 2026-09-13
---

> 이 글은 Andrea Arpaci-Dusseau and Remzi Arpaci-Dusseau의 Operating Systems: Three Easy Pieces를 참고한 글입니다.  
> [여기](https://pages.cs.wisc.edu/~remzi/OSTEP/)에서 무료로 볼 수 있습니다.

# 0. Introduction

지금까지 concurrency 문제를 다루며 봐 왔듯, 우리는 multi-thread 환경에서 발생할 수 있는 여러 문제들을 해결하기 위해 lock과 condition variable들이 필요했다. Semaphore는 이 둘의 역할을 한 번에 하는 synchronization primitive로써, 처음 초기화할 때 값을 무엇으로 두냐에 따라 다양한 역할을 수행할 수 있다는 장점이 있다. 

# 1. Semaphore

Semaphore는 정수 값을 담고 있는 객체로, `sem_wait()`과 `sem_post()`로 그 값을 조작할 수 있다. 그러나 semaphore는 사용하기 전 반드시 그 값을 초기화해야 한다. 

## 1-1. `sem_init()`

Semaphore는 `sem_init()`를 통해 초기화할 수 있다.

```c
int sem_init(sem_t *sem, int pshared, unsigned int value);
```

이때 `pshared`는 다음과 같이 설정해야 한다.

* `0`이면 한 process 내의 thread에서 공유되며, 모든 thread에서 공유되도록 전역 변수나 힙 등에 `sem_t` 객체가 위치해야 한다.
* `0`이 아니라면 서로 다른 process에서 공유되며, 각각의 process에서 접근할 수 있는 공유 메모리에 `sem_t` 객체가 위치해야 한다.

`value`는 semaphore가 처음으로 가질 값을 말한다.

예를 들어, 다음과 같이 semaphore를 초기화하면 `s`는 단일 process 내에서 공유되며, 처음 값은 1이 되는 것이다.

```c
#include <stdio.h>

sem_t s;
sem_init(&s, 0, 1)
```

## 1-2. `sem_wait()`, `sem_post()`

`sem_wait()`은 다음과 같이 정의된다.

```c
int sem_wait(sem_t *s) {
  decrease(s);
  if (s->value < 0)
    wait();
}
```

즉, `sem_t` 객체 `s`를 받아 값을 하나 줄이고, 만약 그 값이 음수라면 대기한다.

`sem_post()`은 다음과 같이 정의된다.

```c
int sem_post(sem_t *s) {
  increase(s);
  if (there exists waiting thread) {
    wake(thread)
  }
}
```

즉, `sem_t` 객체 `s`를 받아 값을 하나 올리고, 대기하고 있는 스레드가 있다면 하나를 깨운다. 

여기서 기억해야 할 사실은 `sem_wait()`과 `sem_post()` 둘 다 atomic operation이라는 것이다. 따라서 `s`에서 발생할 수 있는 race condition 문제는 일단 생각하지 않아도 좋다.

# 2. Semaphore as Lock

이제 semaphore를 사용해 lock을 구현하는 방법을 알아본다. `sem_wait()`이 음수일 때 `wait()`을 실행한다는 점을 고려하면, semaphore의 initialization 과정에서 초깃값을 1로 설정해 주면 된다. 따라서 이를 C로 구현하면 다음과 같다.

```c
sem_t s;

// 초깃값이 1인 semaphore
sem_init(&s, 0, 1);

sem_wait(&s);
// Critical section
sem_post(&s);
```

설명을 위해 두 개의 thread, <span style='color: #5A99C7'>t1</span>과 <span style='color: #E06D69'>t2</span>를 가정하자.

1. <span style='color: #5A99C7'>t1</span>이 먼저 실행된다.  
<span style='color: #5A99C7'>t1</span>은 `sem_wait()`을 실행하고, 이 시점에서 `s`는 1이기 때문에 하나를 줄여도 0이 되고, 따라서 `wait()`을 하지 않는다.
2. <span style='color: #E06D69'>t2</span>가 실행된다.  
이 시점에서 `s`는 0으로, 하나를 줄이면 -1로 음수가 되기 때문에 `wait()`이 실행된다.
3. <span style='color: #5A99C7'>t1</span>이 critical section에서 빠져나오며 `sem_post()`를 실행한다.  
이후 `s`는 0이 되고, 대기 중인 <span style='color: #E06D69'>t2</span>가 ready 상태가 된다.
4. <span style='color: #E06D69'>t2</span>가 실행된다.  
이후 critical section에서 빠져나오며 `sem_post()`를 실행하면, `s`는 다시 1이 된다.

이러한 과정을 통해 semaphore를 통해 lock을 구현할 수 있다. 이때 lock이 2가지 상태만을 가진다는 점에 착안하여, 이러한 semaphore를

**Binary Semaphore**
{: .text-center}

라고 부르기도 한다.

# 3. Semaphore as Condition Variable

이제 semaphore를 사용해 condition variable처럼 순서를 정해줄 수 있는 방법을 살펴보려고 한다. 

예를 들어, 부모 스레드가 자식 스레드가 종료될 때까지 기다리는 상황을 생각해 보자. Condition variable을 사용했다면 `pthread_cond_wait()`과 `pthread_cond_signal()`을 통해 구현했겠지만, semaphore로는 다음과 같이 구현할 수 있다.

```c
#include <semaphore.h>
#include <pthread.h>

sem_t s;

void *worker(void *args) {
  // ...
  sem_post(&s);
  return NULL;
}

int main() {
  pthread_t t;
  
  sem_init(&s, 0, 0);
  pthread_create(&t, NULL, worker, NULL);
  sem_wait(&s);
  // ...
}
```

다음 2가지 경우로 나눠 동작 방식을 살펴보자.

1. `pthread_create()` 이후 바로 worker가 실행되는 경우  
작업이 끝나고 `sem_post()`를 통해 `s`를 1로 만들고, 대기하고 있는 스레드가 없기 때문에 아무것도 하지 않고 종료된다.  
이후 main이 실행되고, `sem_wait()`에서 `s`의 값이 1로 하나를 줄여도 음수가 아니기 때문에 통과한다.
2. `pthread_create()` 이후 바로 worker가 실행되지 않는 경우  
main에서 `sem_wait()`이 실행되면, `s`의 값이 -1이 되면서 음수가 되어 대기 상태가 된다.  
이후 worker가 `sem_post()`를 통해 대기 중이던 main을 깨우고, 계속해서 실행할 수 있다.

따라서 이를 통해 condition variable를 구현할 수 있다.

# 4. Producer / Consumer Problem

이제 앞서 봤던 producer / consumer problem을 semaphore로 해결해 보자. 앞서 봤던 기술들을 활용하면 다음과 같이 짜볼 수 있다. 

```c
sem_t consumer_c;
sem_t producer_c;

void *producer(void *arg) {
  for (int i = 0; i < *(int *)arg; i++) {
    sem_wait(&producer_c);
    put(i);
    sem_post(&consumer_c)
  }
}

void *consumer(void *arg) {
  for (int i = 0; i < *(int *)arg; i++) {
    sem_wait(&consumer_c);
    printf("%d", get());
    sem_post(&producer_c);
  }
}

int main() {
  ...
  sem_init(&consumer_c, 0, 0);
  sem_init(&producer_c, 0, MAX_SLOT);
  ...
}
```

CV와 lock을 사용한 것에 비해 많이 단순해졌는데, 이유는 semaphore 자체가 내부적으로 counter와 비슷하게 동작하기 때문에 조건을 검사하기 위한 while문이 사라졌기 때문이다. 

여기서 각 semaphore의 현재 값은 "얼마나 읽고 쓸 수 있는지"를 나타내는 지표라고 봐도 무방하다. 가령 `consumer_c`는 consumer가 현재 최대 몇 개까지 읽을 수 있냐를 나타낸다. 처음에는 하나도 읽지 못하기 때문에 당연히 0이고(따라서 consumer가 먼저 실행되더라도 바로 sleep하게 된다), producer가 값을 쓴 후 `sem_post()`를 사용해 값을 하나씩 늘려 줘야 비로소 읽기가 가능해지는 것이다. 예를 들어, `MAX_SLOT=10`인 상황에서 producer가 3번 `put()`을 실행했다면 `consumer_c`는 3이 될 것이고, `producer_c`는 7이 될 것이다. 각각은 consumer가 몇 번 더 읽을 수 있는지, producer가 몇 번 더 쓸 수 있는지를 나타낸다. 

그러나 이는 문제가 있는데, `MAX_SLOT=1`인 상황에서는 잘 동작하지만 `MAX_SLOT>1`인 상황에서 다수의 producer와 consumer가 있을 때 race condition이 발생한다는 것이다. 설명을 위해 `MAX_SLOT=5`이며 producer <span style='color: #E06D69'>P</span>와 consumer <span style='color: #DCA83B'>C1</span>, <span style='color: #5A99C7'>C2</span>가 있는 상황을 가정하자.

1. <span style='color: #E06D69'>P</span>가 연달아 3번 실행된다.  
실행 이후 `consumer_c`는 3이 되고, `producer_c`는 2가 된다.
2. <span style='color: #DCA83B'>C1</span>가 실행된다.  
`sem_wait()`이 실행되고, `consumer_c`는 2가 된다. 여전히 양수이므로 <span style='color: #DCA83B'>C1</span>은 critical section에 진입한다.
3. <span style='color: #DCA83B'>C1</span>아 `get()`을 실행하는 도중 <span style='color: #5A99C7'>C2</span>가 실행된다.
`sem_wait()`이 실행되고, `consumer_c`는 1이 된다. 여전히 양수이므로 <span style='color: #5A99C7'>C2</span>도 critical section에 진입한다.

따라서 이러한 상황에서는 mutex가 제대로 작동하지 않는다는 것을 알 수 있고, 이를 해결하기 위해 다음과 같이 mutex를 추가해주면 된다.

```c
sem_t consumer_c;
sem_t producer_c;
sem_t mutex;

void *producer(void *arg) {
  for (int i = 0; i < *(int *)arg; i++) {
    sem_wait(&mutex);
    sem_wait(&producer_c);
    put(i);
    sem_post(&consumer_c)
    sem_post(&mutex);
  }
}

void *consumer(void *arg) {
  for (int i = 0; i < *(int *)arg; i++) {
    sem_wait(&mutex);
    sem_wait(&consumer_c);
    printf("%d", get());
    sem_post(&producer_c);
    sem_post(&mutex);
  }
}

int main() {
  ...
  sem_init(&consumer_c, 0, 0);
  sem_init(&producer_c, 0, MAX_SLOT);
  sem_init(&mutex, 0, 1);
  ...
}
```

그러나 이런 상황에서는 deadlock이 생긴다는 사실을 굉장히 쉽게 알 수 있다. 다음 상황을 생각해 보자.

1. Consumer <span style='color: #5A99C7'>C</span>가 실행된다.  
<span style='color: #5A99C7'>C</span>는 lock을 얻고, `sem_wait(&consumer_c)`에서 sleep 상태가 된다.
1. Producer <span style='color: #E06D69'>P</span>가 실행된다.  
<span style='color: #E06D69'>P</span>는 lock을 얻지 못해 `sem_wait(&mutex)`에서 sleep 상태가 된다.

따라서 아무 thread도 깨어나지 못한다. 이를 해결하기 위해서는 간단하게 mutex와 condition variable의 위치를 바꿔주기만 하면 된다.

```c
void *producer(void *arg) {
  for (int i = 0; i < *(int *)arg; i++) {
    sem_wait(&producer_c);
    sem_wait(&mutex);
    put(i);
    sem_post(&mutex);
    sem_post(&consumer_c)
  }
}

void *consumer(void *arg) {
  for (int i = 0; i < *(int *)arg; i++) {
    sem_wait(&consumer_c);
    sem_wait(&mutex);
    printf("%d", get());
    sem_post(&mutex);
    sem_post(&producer_c);
  }
}
```

이제 위와 같은 경우를 가정해 흐름을 따라가 보면, 다음과 같다.

1. <span style='color: #5A99C7'>C</span>가 실행된다.  
<span style='color: #5A99C7'>C</span>는 `sem_wait(&consumer_c)`에서 sleep 상태가 된다.
2. <span style='color: #E06D69'>P</span>가 실행된다.  
<span style='color: #E06D69'>P</span>는 `sem_wait(&producer_c)`를 통과하고, lock을 얻고, `put()`을 실행한 후 lock을 release하고 `sem_post()`를 실행한다.
3. <span style='color: #5A99C7'>C</span>가 실행된다.  
<span style='color: #5A99C7'>C</span>는 lock을 얻고, `get()`을 실행한 후 나머지 과정을 이어간다.

이렇듯 mutex의 위치를 바꿈으로써 해결할 수 있음을 알 수 있다. 

# 5. Reader-Writer Locks

Semaphore로 구현할 수 있는 것들 중 또 다른 하나는 reader-writer lock이다. 

생각해 보면, 공유된 자원에 대해 writer은 단 하나만 실행되어야 하지만 reader는 동시에 여럿 실행되도 된다. Reader는 값을 읽기만 할 뿐 변경하지 않고, 따라서 race condition 문제가 발생할 수 있기 때문이다. 이를 통해 자원에 접근할 때의 성능을 향상시킬 수 있으며, 이를 reader-writer lock이라 한다. 우선 writer lock은 binary semaphore로 구현할 수 있다.

```c
typedef struct {
  sem_t lock;       // readers 관리를 위한 lock
  sem_t writelock;
  int readers;
} rwlock_t;

void init(rwlock_t *rwlock) {
  sem_init(rwlock->lock, 0, 1);
  sem_init(rwlock->writelock, 0, 1);
  rwlock->readers = 0;
}

void rwlock_wrlock(rwlock_t *rwlock) {
  sem_wait(rwlock->writelock);
}

void rwlock_unwrlock(rwlock_t *rwlock) {
  sem_post(rwlock->writelock);
}
```

다음으로, reader lock은 다음과 같이 구현할 수 있다. 여기서 기억할 점은, 다수의 reader가 실행될 수 있다는 것이다.

```c
void rwlock_rdlock(rwlock_t *rwlock) {
  sem_wait(rwlock->lock);
  rwlock->readers++;

  if (rwlock->readers == 1)
    sem_wait(rwlock->writelock);
  
  sem_post(rwlock->lock);
}

void rwlock_unrdlock(rwlock_t *rwlock) {
  sem_wait(rwlock->lock);
  rwlock->readers--;

  if (rwlock->readers == 0)
    sem_post(rwlock->writelock);
  
  sem_post(rwlock->lock);
}
```

우선 `rwlock_t.readers`는 race condition이 발생할 수 있는 변수이기 때문에, 이를 수정하기 전 `rwlock_t.lock`을 통해 mutex를 구현해줘야 한다.

Read lock을 획득하는 과정에서, 만약 `readers`의 값이 1이라면, 즉 자신이 첫 번째 reader라면 우선 `writelock`을 획득해 reader가 실행되는 동안 write를 방지해야 한다. 만약 자신이 첫 번째 reader가 아니라면, 다른 reader들도 실행중이라는 뜻이기 때문에 바로 critical section에 진입할 수 있다.

마찬가지로 read lock을 release하는 과정에서, 만약 자신을 제외하고 남은 reader가 없다면 `writelock`을 반환해 writer가 (혹은, 다른 reader가 다시 acquire할수도 있다!) 쓸 수 있도록 해야 한다. 만약 남은 reader가 있다면, `writelock`을 반환하지 않고 그대로 종료한다. (어차피 마지막 reader가 반환할 것이므로)

그러나 이는 reader가 많거나 특정 reader가 오랫동안 writelock을 점유하고 있을 때 writer에게 starvation 문제가 발생할 수 있다는 단점이 있다. 이는 reader가 `writelock`을 획득한 후 해당 lock을 잡고 있는 시간의 상한선을 설정하는 등의 방법으로 해결할 수 있다. 

# 6. Implementation with Locks and CVs

Semaphore로 lock과 CV를 구현할 수 있듯, lock과 CV를 통해 semaphore를 구현할 수 있다. 앞서 살펴본 정의를 잘 보며 구현하면, 다음과 같이 구현할 수 있을 것이다.

```c
#include <pthread.h>

typedef struct {
  int value;
  pthread_mutex_t mutex;
  pthread_cond_t cond;
} sem_t;

void sem_init(sem_t *s, int value) {
  pthread_cond_init(&s->cond, NULL);
  pthread_mutex_init(&s->mutex, NULL);
  s->value = value;
}

void sem_post(sem_t *s) {
  pthread_mutex_lock(&s->mutex);
  s->value++;
  pthread_cond_signal(&s->cond);
  pthread_mutex_unlock(&s->mutex);
}

void sem_wait(sem_t *s) {
  pthread_mutex_lock(&s->mutex);
  s->value--;
  while (s->value < 0) {
    pthread_cond_wait(&s->cond, &s->mutex);
  }
  pthread_mutex_unlock(&s->mutex);
}
```

그러나 여기에는 치명적 오류가 있는데, `t1`, `t2`, `t3`이 binary semaphore를 통해 경쟁하는 상태를 생각하자.

1. `t1`이 `sem_wait()`을 호출하고, `value`는 0이 된다. `t1`은 critical section에 진입한다.
2. `t2`이 `sem_wait()`을 호출하고, `value`는 -1이 된다. `t2`는 대기하게 된다.
3. `t3`이 `sem_wait()`을 호출하고, `value`는 -2가 된다. `t3`은 대기하게 된다. 
4. `t1`이 작업을 마치고 `sem_post()`를 호출한다. `value`는 -1이 되며, `t2`가 깨어난다 가정하자.
5. `t2`는 여전히 `value`가 음수이기 때문에, 다시 대기 상태로 들어간다.

따라서 아무런 스레드도 깨어나지 못하게 되는 deadlock이 발생한다. 이를 해결하기 위해서는, 다음과 같이 `sem_wait()`에서 `value`의 값을 업데이트하는 시점을 조건 검사 후로 옮기면 된다. 

```c
void sem_wait(sem_t *s) {
  pthread_mutex_lock(&s->mutex);
  while (s->value <= 0) {
    pthread_cond_wait(&s->cond, &s->mutex);
  }
  s->value--;
  pthread_mutex_unlock(&s->mutex);
}
```

이렇게 수정하면, 위와 같은 상황에서 다음과 같이 동작하게 된다.

1. `t1`이 `sem_wait()`을 호출하고, `value`는 0이 된다. `t1`은 critical section에 진입한다.
2. `t2`이 `sem_wait()`을 호출하고, `value`는 계속 0인 상태로 유지된다. `t2`는 대기하게 된다.
3. `t3`이 `sem_wait()`을 호출하고, `value`는 계속 0인 상태로 유지된다. `t3`은 대기하게 된다. 
4. `t1`이 작업을 마치고 `sem_post()`를 호출한다. `value`는 1이 되며, `t2`가 깨어난다 가정하자.
5. `t2`는 `value`가 양수이기 때문에, `value`를 0으로 만들고 critical section에 진입한다.

이렇듯 deadlock 문제가 해결되었음을 알 수 있다. 
