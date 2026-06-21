---
title: "[CS][OS] Virtualization - Scheduling (2): MLFQ"
excerpt: "Scheduling 방법들을 알아보자 (MLFQ)"

categories:
  - Operating System
tags:
  - [os, process, scheduling, mlfq, multi-level feedback queue]

permalink: /os/scheduling-2/

toc: true
toc_sticky: true

date: 2026-06-20
last_modified_at: 2026-06-20
---

> 이 글은 Andrea Arpaci-Dusseau and Remzi Arpaci-Dusseau의 Operating Systems: Three Easy Pieces를 참고한 글입니다.  
> [여기](https://pages.cs.wisc.edu/~remzi/OSTEP/)에서 무료로 볼 수 있습니다.

# 0. Introduction

[이전 글](/os/scheduling-1)에서, 마지막 전제인 "5. 모든 task의 실행 시간은 알려져 있다"는 비현실적인 전제라고 언급했었다. 현실 컴퓨터에 적용할 수 있는 scheduling policy를 만들기 위해서는 5번째 전제를 깨야 하는데, 어떻게 이걸 깨고서도 FIFO와 SJF처럼 동작하는 scheduling policy를 만들 수 있을까?

이를 위해 등장한 것이 Multi-Level Feedback Queue(MLFQ)이다. 이 policy는 priority에 따라 여러 개의 queue를 사용하며, priority가 같은 queue에 들어 있는 task들은 RR로 처리하는 방식으로 동작한다.

# 1. 기본 규칙

MLFQ의 기본 규칙은 위에서 설명했듯 다음과 같다. 

> **규칙 1.**  
> `Priority(A)` $>$ `Priority(B)`라면, A를 실행한다. 

> **규칙 2.**  
> `Priority(A)` $=$ `Priority(B)`라면, A와 B는 RR로 실행된다. 

8개의 queue로 구성된 MLFQ의 예시는 다음과 같다. 

<center>
      <img src="/assets/images/posts_img/cs/os/virtualization-scheduling-2/mlfq-example.png" alt="mlfq-example" height="20%">
</center>

`A`와 `B`는 Priority가 높기 때문에 RR로 실행될 것이다. 이 둘이 모두 queue에서 나가거나 `Q4`까지 priority가 떨어지지 않는 이상, `C`는 실행되지 않는다. 마찬가지로, `A`, `B`, `C`가 모두 queue에서 나가거나 `Q1`까지 priority가 떨어지지 않는 이상, `D`는 실행되지 않는다. 

여기서 중요한 것은, priority가 높은 task는 (즉, 더 자주 실행되는 task는) 사실 CPU를 많이 사용하지 않는 task라는 것이다. CPU를 자주 release하는 task는 interactive(IO-bound)한 task일 확률이 높고, 따라서 response time이 적어야 한다. 예를 들어, 워드나 한글 같은 프로그램은 CPU를 사용할 수 있어도 대부분의 경우에서 사용자의 입력을 기다리고 있을 것이기 때문에 자주 CPU를 release할 것이다. 그러나 자주 CPU를 할당받지 않으면 사용자가 입력을 해도 늦게 화면에 표시되는 현상이 나타날 것이고, 사용자는 "이 프로그램은 느리다"라는 인식을 가지게 될 것이다. 

반대로, priority가 낮은 task는 IO-bound 하기보다는 CPU-bound할 확률이 높다. 예를 들어, 비트코인 채굴기를 생각해 보자. 비트코인 채굴기 CPU-bound한 task이기 때문에 CPU가 주어질 때마다 다음 timer interupt가 발생할 때까지 꽉꽉 채워 사용할 것이다. 그러나 해당 비트코인 채굴기의 response time은 꼭 적을 필요가 없다. 애당초 사용자와 상호작용할 일이 거의 없기 때문이기도 하고, 사용자가 상호작용을 시도해도 몇 ms 늦게 응답하는 것쯤은 이해할 수 있기 때문이다. 

# 2. Priority 조정

한 번 정해진 priority가 그대로 계속 유지된다면 효율적이지 못할 것이다. 그래서 MLFQ는 아래 규칙에 따라 task의 priority를 조정한다. 

> **규칙 3.**  
> 처음 OS에 task가 들어오면, 가장 높은 priority를 부여한다.

> **규칙 4-a.**  
> 만약 task가 주어진 time slice를 전부 사용하면 (즉, timer interrupt가 발생해서 OS로 context가 넘어오면), 해당 task의 priority는 낮아진다. 

> **규칙 4-b.**  
> 만약 task가 주어진 time slice를 전부 사용하기 전에 CPU를 반환하면 (즉, timer interrupt가 발생하기 전에 OS로 context가 넘어오면), 해당 task의 priority는 높아진다.

## 2-1. 예시

CPU-bound한 task `A`가 OS에 들어왔고, 계속해서 CPU를 사용한다고 하자. 그림으로 표현하면 다음과 같을 것이다. 

<center>
      <img src="/assets/images/posts_img/cs/os/virtualization-scheduling-2/mlfq-longtask.png" alt="mlfq-longtask" width="50%">
</center>

`Q2`에서 할당된 time slice를 전부 사용하고 `Q1`으로 demotion되는 걸 볼 수 있으며, `Q1`에서마저 time slice를 전부 사용해서 `Q0`까지 demotion되는 걸 볼 수 있다. 

이제 CPU-bound하지만 `A`보다는 총 소요시간이 짧은 `B`와, CPU-bound 하지 않은 `C`를 추가해 보자. 이러한 경우, MLFQ는 다음과 같이 동작할 것이다. 

<center>
      <img src="/assets/images/posts_img/cs/os/virtualization-scheduling-2/mlfq-withshort.png" alt="mlfq-withshort" width="50%">
</center>
{% include gallery caption="`B`가 추가된 경우(왼쪽)과 `C`가 추가된 경우(오른쪽)" %}

`B`는 $T=100$에 OS에 들어오기 때문에, priority가 가장 높은 `Q2`에서 시작한다. 그러나 주어진 time slice를 전부 소진하고 $T=110$에서 `Q1`으로 demotion되지만 먼저 들어온 `A`는 `Q0`에 있기 때문에 바로 이어서 실행되게 된다. 이후 `B`가 종료되는 $T=120$부터는 `A`가 CPU를 차지하게 된다.

`C`는 $T=50$에 OS에 처음 들어오지만, 주어진 time slice를 전부 소진하지 않고 CPU를 반환하기 때문에 계속 priority가 가장 높은 queue인 `Q2`에 머물게 된다. CPU 사용 시간을 보면 `C`는 interactive한 (즉, IO-bound한) task임을 추측할 수 있는데, MLFQ의 이런 동작을 통해 response time을 최소화함으로써 유저는 쾌적하게 시스템을 사용할 수 있게 된다. 

# 3. Starvation

그러나 OS에 interactive한 task가 너무 많을 경우 문제가 발생할 수 있다. 리소스가 상위 queue의 task에만 할당되고 하위 queue에는 할당되지 않아 하위 queue의 task들이 실행되지 못할 수 있다는 것이다 (이를 starvation이라 한다).

<center>
      <img src="/assets/images/posts_img/cs/os/virtualization-scheduling-2/mlfq-starvation.png" alt="mlfq-starvation" width="50%">
</center>

위의 그림에서 볼 수 있듯, interactive한 task 2개가 들어오는 $T=100$ 시점부터 `Q0`의 task는 리소스를 전혀 받지 못하는 것을 알 수 있다. 

마찬가지로 task는 돌아가는 동안 특성이 바뀔 수 있다. 예를 들어, 게임을 생각해보자. 게임이 시작되고 나서는 디스크에 저장된 맵 정보라던지 텍스쳐 파일을 로드해야 하기 때문에 IO-bound할 것이다. 그러나 로딩이 끝나고 나서부터는 CPU-bound해질 것이다. 물론 규칙 4-a와 4-b에 의해 올바른 자리를 서서히 찾아가겠지만 그 동안 유저는 불편함을 느낄 수 있다. 

이를 위해, MLFQ 다음과 같은 규칙을 새로 추가한다. 

> **규칙 5.**  
> 일정한 시간 간격마다, 모든 task는 최고 priority를 가지도록 boost된다. 

즉, 일정한 시간 간격마다 모든 task가 다음 그림과 같이 `Q2`로 올라가게 되는 것이다.

<center>
      <img src="/assets/images/posts_img/cs/os/virtualization-scheduling-2/mlfq-withboost.png" alt="mlfq-withboost" width="50%">
</center>

이를 통해 starvation 문제를 해결할 수 있다. 

> **참고**  
> 이때 어느 시간 간격마다 priority boost가 일어나야 적당할지는 아무도 "모른다". 따라서 이 시간 간격은 확실히 정해진 값 없이, 시스템의 특성에 따라 직접 실험해가며 정해야 한다. 

# 4. Scheduler Exploit

그러나 아직 문제가 남아 있다. 만약 악의적인 task가 일부러 time slice를 거의 소진할만큼 CPU를 사용하고, 마지막 순간에 syscall등을 통해 CPU를 반환한다면 어떻게 될까? MLFQ는 이 task가 time slice를 전부 소진하지 않은 상태로 CPU를 반환했기 때문에 최상위 priority를 계속 유지하도록 할 것이고, 따라서 이 task는 다음과 같이 CPU를 독점할 수 있게 된다. 

<center>
      <img src="/assets/images/posts_img/cs/os/virtualization-scheduling-2/mlfq-exploit.png" alt="mlfq-exploit" width="50%">
</center>

그렇다면 이 문제를 어떻게 해결해야 할까? 이 문제는 4-a와 4-b 규칙을 살짝 바꿈으로써 해결할 수 있다. time slice를 다 썼냐 쓰지 않았냐가 기준이 되는 것이 아니라, 다음과 같이 해당 priority level에 할당된 할당량을 다 썼냐 쓰지 않았냐로 결정하는 것이다. 

> **규칙 4.**  
> 만약 task가 해당 priority level에 주어진 할당량을 전부 사용했다면, priority가 하나 낮아진다. (CPU를 얼마나 많이 반환했냐는 전혀 관계가 없다.)

<center>
      <img src="/assets/images/posts_img/cs/os/virtualization-scheduling-2/mlfq-withtolerance.png" alt="mlfq-withtolerance" width="50%">
</center>

이 규칙이 적용되면, 위와 같이 연한 회색 task가 `Q2`와 `Q1`에서 주어진 time slice가 끝나기 전 CPU를 한 번씩 반환했지만 해당 단계에서 주어진 할당량을 전부 소진했기 때문에 demotion된 것을 볼 수 있다.

MLFQ는 이러한 방식을 통해 저번 글의 마지막 전제인 "모든 task의 실행 시간은 알려져 있다"를 깨고서도 잘 동작한다. 
