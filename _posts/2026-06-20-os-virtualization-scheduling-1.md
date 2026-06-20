---
title: "[CS][OS] Virtualization - Scheduling (1)"
excerpt: "Scheduling 방법들을 알아보자 (FIFO, SJF, STCF, RR)"

categories:
  - Operating System
tags:
  - [os, process, scheduling, fifo, sjf, stcf, rr]

permalink: /os/scheduling-1/

toc: true
toc_sticky: true

date: 2026-06-20
last_modified_at: 2026-06-20
---

> 이 글은 Andrea Arpaci-Dusseau and Remzi Arpaci-Dusseau의 Operating Systems: Three Easy Pieces를 참고한 글입니다.  
> [여기](https://pages.cs.wisc.edu/~remzi/OSTEP/)에서 무료로 볼 수 있습니다.

# 0. Introduction

[이전 글](/os/virtualization-cpu)에서 OS는 다수의 process들을 짧은 시간 동안 실행함으로써 다수의 프로세스가 무한히 많은 CPU 위에서 동시에 돌아가는 것처럼 보이도록 한다고 말했다. 그렇다면 어떤 process를, 언제, 얼마나 많이 실행해야 가장 적절할까? 이를 결정하는 것이 scheduling policy다. 

이를 설명하기 앞서, 실행되고 있는 process(여기서부터는 job/task라는 단어를 사용한다)에 대한 몇 가지 전제가 필요하다.

1. 모든 task는 소요시간이 동일하다.
2. 모든 task는 같은 시간에 시작된다.
3. 한 번 실행되면, 모든 task는 끝날 때까지 실행된다. 
4. 모든 task는 I/O 작업 없이 CPU만을 사용한다. 
5. 모든 task의 실행 시간은 알려져 있다.

# 1. Scheduling Metrics

어떤 scheduling policy에 대해, 해당 scheduling policy가 좋은지를 판단하기 위해 사용하는 척도가 몇 있다. 여기서는 간단한 척도 2개를 중심으로 scheduling policy를 비교한다. 

## 1-1. Turnaround Time ($T_{\text{turnaround}}$)

$T_{\text{turnaround}}$는 task가 OS에 들어오고 나서(시작된 시간이 아니다!) task가 끝나기까지의 시간이다. 즉, $T_{\text{turnaround}}$는 다음과 같이 계산된다.

$$T_{\text{turnaround}} = T_{\text{completion}} - T_{\text{arrival}}$$

예를 들어, 어떤 task가 $T=10$일 때 들어와서 $T=30$일 때 끝났다면, 이때의 $T_{\text{turnaround}} = 30 - 10 = 20$이다.

## 1-2. Response Time ($T_{\text{response}}$)

$T_{\text{response}}$는 task가 OS에 들어오고 나서 task가 처음으로 schedule되어 시작된 (즉, 처음으로 output을 만들어낸) 시간이다. 즉, $T_{\text{response}}$는 다음과 같이 계산된다.

$$T_{\text{response}} = T_{\text{first run}} - T_{\text{arrival}}$$

예를 들어, 어떤 task가 $T=10$일 때 들어와서 $T=15$일 때 처음으로 schedule되어 실행되었다면, 이때의 $T_{\text{response}} = 15 - 10 = 5$이다.

# 2. First In, First Out (FIFO)

FIFO는 선착순을 그대로 반영한 scheduling policy이다. 이 방식은, task들을 들어온 순서대로 실행시킨다. 예를 들어, 10만큼의 시간이 걸리는 task `A`, `B`, `C`가 동시에 OS에 들어왔다 하자. (단, `A`보다는 `B`가 조금 더 늦게, `B`보다는 `C`가 조금 더 늦게 들어왔다고 가정하자.) 이 상황에서 FIFO는 다음 그림과 같이 `A`를 실행한 다음 `B`를, 그 다음 마지막으로 `C`를 순차적으로 실행하게 될 것이다. 

<center>
      <img src="/assets/images/posts_img/cs/os/virtualization-scheduling-1/fifo-1.png" alt="fifo-1" width="50%">
</center>

이때 `A`는 10에, `B`는 20에, `C`는 30에 끝났기 때문에 평균 turnaround time은 다음과 같을 것이다.

$$\overline{T_{\text{turnaround}}} = \frac{10 + 20 + 30}{3} = 20$$

원래 실행시간이 10이라는 것을 고려하면 조금 느려졌기는 했지만 감당 가능한 수준이다. 그러나 1번째 전제를 깨고 `A`가 100만큼의 시간이 걸린다고 가정하면 다음과 같을 것이다.

<center>
      <img src="/assets/images/posts_img/cs/os/virtualization-scheduling-1/fifo-2.png" alt="fifo-2" width="50%">
</center>

이 경우 평균 turnaround time은 다음과 같아진다.

$$\overline{T_{\text{turnaround}}} = \frac{100 + 110 + 120}{3} = 110$$

`B`, `C`의 원래 실행시간이 10만큼의 시간이 걸린다는 점을 고려하면 이 경우는 `B`와 `C`에게 엄청난 손해라는 것을 알 수 있다. 

# 3. Shortest Job First (SJF)

이를 해결하기 위해 가장 짧은 작업을 가장 먼저 실행하는 방법을 생각해볼 수 있다. SJF는 가장 짧은 작업을 실행하고, 그 다음 차례대로 짧은 작업을 순차적으로 수행한다. 위의 예제에 SJF를 적용하면 다음과 같을 것이다. 

<center>
      <img src="/assets/images/posts_img/cs/os/virtualization-scheduling-1/sjf-1.png" alt="sjf-1" width="50%">
</center>

이렇게 되면 평균 turnaround time이 다음과 같이 줄어들게 된다. 

$$\overline{T_{\text{turnaround}}} = \frac{10 + 20 + 120}{3} = 50$$

> **참고**  
> 모든 task가 동일한 시간에 들어온다면, SJF는 $\overline{T_{\text{turnaround}}}$를 가장 작게 만들 수 있는 최적화된 scheduling policy이다.   
> 자세한 증명은 생략한다. 

이제 2번째 전제인 "모든 task는 같은 시간에 시작된다"를 깨고, `B`와 `C`가 $T=10$에 들어온다 가정하자. 이렇게 된다면 SJF는 FIFO와 같은 방식으로 들어온 task들을 scheduling 할 것이고, 결국 평균 turnaround time이 다시 낮아지게 된다.

<center>
      <img src="/assets/images/posts_img/cs/os/virtualization-scheduling-1/sjf-2.png" alt="sjf-2" width="50%">
</center>

# 4. Shortest Time-to-Completion First (STCF)

> **참고**  
> FIFO와 SJF는 non-preemptive한 scheduling policy다. 다시 말해, 한 번 task가 실행되면 scheduler는 task에 관여하지 않는다.  
> 그러나 STCF를 포함해 지금부터 나오는 scheduling policy는 전부 preemptive scheduling policy다. 즉, scheduler가 process를 멈출 수 있고 다시 실행시킬 수도 있다. 

SJF의 이런 문제를 해결하기 위해, task가 들어올 때마다 "가장 먼저 끝나는 task"를 탐색해 그 task를 schedule한다. 예를 들어, 위의 예시에서 STCF는 다음 그림과 같이 동작할 것이다. 

<center>
      <img src="/assets/images/posts_img/cs/os/virtualization-scheduling-1/stcf-1.png" alt="stcf-1" width="50%">
</center>

$T=10$에서 `B`와 `C`가 들어온다. 이 시점에서 `A`는 90만큼의 시간이 더 필요하고, `B`와 `C`는 10만큼의 시간이 필요하기 때문에 `B`가 실행되게 된다. $T=20$에서 `B`의 실행이 끝난 후, 마찬가지로 `A`는 90만큼의 시간이 필요하고 `C`는 10만큼의 시간이 필요하기 때문에 마찬가지로 `C`가 실행되게 된다. 

이 경우 평균 turnaround time은 다음과 같아진다.

$$\overline{T_{\text{turnaround}}} = \frac{120 + 10 + 20}{3} = 50$$

# 5. Round Robin (RR)

지금까지 봐 왔던 scheduler는 response time을 고려하지 않았다. 예를 들어, `A=100`, `B=10`, `C=10`인 상황에서 SJF를 다시 떠올려 보자. `A`는 `B`와 `C`가 모두 실행되고 나서야 실행될 수 있기 때문에, $T_{\text{turnaround}}=20$ 이 될 것이다. 다시 말해, `A`를 실행한 사용자는 20만큼의 시간이 흐를 동안 아무런 결과가 나오지 않는 화면만 쳐다보고 있어야 한다는 것이다. 이는 적절하지 않다.

이를 해결하기 위해 RR은 `time slice`(혹은 `scheduling quantum`)이라 불리는 시간 동안 task들을 번갈아가며 실행되도록 한다. 예를 들어, `time slice`가 1인 RR에 5만큼의 시간이 걸리는 `A`, `B`, `C`가 들어온다면 다음 그림과 같이 동작할 것이다.

<center>
      <img src="/assets/images/posts_img/cs/os/virtualization-scheduling-1/rr.png" alt="rr" width="50%">
</center>

이 경우 평균 response time은 다음과 같아진다.

$$\overline{T_{\text{response, RR}}} = \frac{0 + 1 = 2}{3} = 1$$

같은 작업을 FIFO나 SJF로 돌렸다면 평균 response time이

$$\overline{T_{\text{response, SJF}}} = \frac{0 + 5 + 10}{3} = 5$$

라는 점을 고려하면 엄청난 발전이다. 그러나 평균 turnaround time을 비교해 보면

$$\overline{T_{\text{turnaround, RR}}} = \frac{13 + 14 + 15}{3} = 14$$


$$\overline{T_{\text{turnaround, SJF}}} = \frac{5 + 10 + 15}{3} = 10$$

가 되고, SJF나 FIFO에 비해 떨어지게 된다. 즉, RR은 turnaround time을 대가로 response time을 올리는 scheduling policy이다.  일반적으로 turnaround time과 response time은 trade-off 관계에 있기 때문에, 둘 모두를 향상시킬 수 있는 방법은 없다. 

# 6. Incorporating I/O

이제 4번째 전제인 "모든 task는 I/O 작업 없이 CPU만을 사용한다."를 깨 보자. 특정 task가 I/O 요청을 날리고 block 상태로 들어간다면, 당연히 그 동안은 CPU를 사용할 수 없기에 다른 task를 그 시간동안 schedule 하는 것이 좋을 것이다. 특히 느린 disk에 I/O 요청을 날렸다면, I/O 요청이 완료되기까지 시간이 꽤 걸릴 것이기 때문에 이 시간을 적절히 사용하는 것이 더욱 중요해진다. 

예를 들어, 총 50만큼 CPU를 사용하며 10당 10이 걸리는 I/O 요청을 날리는 `A`와(즉, 90만큼의 시간이 필요하다!), 50만큼 CPU를 쓰는 `B`를 가정해 보자. 만약 FIFO가 이를 처리한다면, 다음과 같을 것이다. 

<center>
      <img src="/assets/images/posts_img/cs/os/virtualization-scheduling-1/no-overlap.png" alt="no-overlap" width="50%">
</center>

중간중간 `A`가 blocked일 때 CPU가 idle인 상태가 보일 것이다. 이 시간은 버려지는 시간이기 때문에, ready 상태인 `B`를 중간중간 끼워넣으면 다음과 같을 것이다.

<center>
      <img src="/assets/images/posts_img/cs/os/virtualization-scheduling-1/with-overlap.png" alt="with-overlap" width="50%">
</center>

이렇게 되면 전체 실행 시간이 140에서 100으로 줄게 된다. 이는 전체 throughput이 향상되는 (당연히 average turnaround time도 좋아진다) 결과를 가져온다. 

> **참고**  
> I/O 작업이 끝나고 나서 I/O 작업을 요청한 task를 실행할지 (위의 예제에서는 A), 아니면 다른 task를 계속 실행할지는 scheduler의 policy마다 다르다.  
> 위의 예제에서는 STCF를 적용했고, 따라서 I/O 작업이 끝난 이후 A가 실행됐다. 

# 마지막 전제 깨기

지금까지 다룬 scheduling policy는 5번째 전제에 의해 task가 끝나기까지 걸리는 시간을 알고 있다고 가정했다. 그러나 현실에서 task가 얼마나 걸릴지에 대해 예측하는 건 거의 불가능하다. 그렇다면 task의 소요시간에 대한 지식 없이도 SJF나 STCF같이 동작하는 scheduling policy를 어떻게 만들 수 있을까? 이는 다음 글에서 다뤄볼 예정이다. 