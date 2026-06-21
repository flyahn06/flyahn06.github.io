---
title: "[CS][OS] Virtualization - Scheduling (3): CFS, EEVDF"
excerpt: "Scheduling 방법들을 알아보자 (CFS, EEVDF)"

categories:
  - Operating System
tags:
  - [os, process, scheduling, cfs, linux scheduler, completely fair scheduler]

permalink: /os/scheduling-3/

toc: true
toc_sticky: true

date: 2026-06-21
last_modified_at: 2026-06-21
---

> 이 글은 Andrea Arpaci-Dusseau and Remzi Arpaci-Dusseau의 Operating Systems: Three Easy Pieces와   
> [리눅스 커널 내부구조(백승재)](https://product.kyobobook.co.kr/detail/S000001637811) 를 참고한 글입니다.  
> Operating Systems: Three Easy Pieces는 [여기](https://pages.cs.wisc.edu/~remzi/OSTEP/)에서 무료로 볼 수 있습니다.

이번 글에서는, linux-6.6까지 실제로 사용됐던 Completely Fair Scheduler (CFS)와 linux-6.6 이후 사용되고 있는 Earliest Eligible Virtual Deadline First (EEVDF) scheduler를 다룬다. 

# 1. Completely Fair Scheduler (CFS)

Time slice가 고정된 다른 scheduler와는 다르게, CFS는 모든 ready 상태의 task에 대해 CPU를 공정하게 분배하는 것을 추구한다. CFS는 `vruntime`을 사용해 이를 구현한다. 

## 1-1. `vruntime`

`vruntime` 원래 virtual runtime에서 온 말인데, 개인적으로 가상보다는 특정 task가 실행된 "정규화된 시간"이라고 생각하는 게 편할 것 같다 (왜 그런지는 나중에 설명하겠다). CFS는 대기하고 있는 task중 `vruntime`이 가장 적은 task를 뽑아 자원을 주고 실행시킨다. 

그렇다면 뽑힌 task가 얼마나 많은 시간동안 실행되는 것이 적절할까? 이는 `sched_latency`와 `min_granularity`로 정해진다. 

## 1-2. `sched_latency`와 `min_granularity`

CFS는 task가 N개일 때 `sched_latency / N`만큼을 한 task의 time slice로 정한다. 예를 들어, `sched_latency`가 `100ms`이고 `N=10`일 때 각각의 task는 `10ms`동안 실행될 수 있는 것이다. 이러한 관점에서 보면, `sched_latency`는 각각의 task가 기대하는 최대 응답 시간이라 봐도 무방하다. 위의 예시에서, 각각의 task는 최대 `100ms`를 기다린 후 다시 실행될 수 있을 것이다. 

`sched_latency`는 기본적으로 `60ms`로 설정되어 있다.

```c
// Def. in /kernel/sched/fair.c, line 72 (@linux-6.5)

/*
 * Targeted preemption latency for CPU-bound tasks:
 *
 * NOTE: this latency value is not the same as the concept of
 * 'timeslice length' - timeslices in CFS are of variable length
 * and have no persistent notion like in traditional, time-slice
 * based scheduling concepts.
 *
 * (to see the precise effective timeslice length of your workload,
 *  run vmstat and monitor the context-switches (cs) field)
 *
 * (default: 6ms * (1 + ilog(ncpus)), units: nanoseconds)
 */
unsigned int sysctl_sched_latency			= 6000000ULL;
```

그러나 실행 대기중인 task가 너무 많으면 각각의 task는 실행시간을 조금밖에 보장받지 못하고, 오히려 context switch에 드는 비용이 더 커질 수 있다. 이를 방지하기 위해, CFS는 time slice의 최솟값인 `min_granularity`를 다음과 같이 지정한다. (기본값은 `7.5ms`다.)


```c
// Def. in /kernel/sched/fair.c, line 93 (@linux-6.5)

/*
 * Minimal preemption granularity for CPU-bound tasks:
 *
 * (default: 0.75 msec * (1 + ilog(ncpus)), units: nanoseconds)
 */
unsigned int sysctl_sched_min_granularity			= 750000ULL;
```

linux-6.5에서는 다음과 같이 `__sched_period()`와 `sched_slice()` 내부에서 실제 time slice가 계산된다. 

```c
// Def. in /kernel/sched/fair.c, line 725 (@linux-6.5)
static u64 __sched_period(unsigned long nr_running)
{
	if (unlikely(nr_running > sched_nr_latency))
		return nr_running * sysctl_sched_min_granularity;
	else
		return sysctl_sched_latency;
}

// Def. in /kernel/sched/fair.c, line 741 (@linux-6.5)
static u64 sched_slice(struct cfs_rq *cfs_rq, struct sched_entity *se)
{
  // ...
  
  slice = __sched_period(nr_running + !se->on_rq);

  // ...

  slice = max_t(u64, slice, min_gran);

  // ...

  return slice;
}
```

## 1-3. Niceness

CFS는 이것뿐만 아니라 `nice`라는 값을 통해서 유저나 task가 직접 scheduling에 어느 정도 관여할 수 있도록 한다. `nice`는 0이 기본값이며, `nice()`를 통해 값을 -20부터 +19까지 설정할 수 있다. 낮은 `nice` 값은 높은 priority를 뜻한다 (다른 task에게 nice하지 못하니까 당연히 CPU를 독차지하려고 할 것이다). 반대로 높은 `nice` 값은 낮은 priority를 뜻한다 (다른 task에게 nice하니까 CPU를 최대한 양보하려고 할 것이다).

CFS는 다음과 같이 미리 계산된 lookup table을 통해 각각의 nice값을 `weight`로 mapping한다. 

```c
// Def. in /kernel/sched/core.c, line 11495 (@linux-6.5)

const int sched_prio_to_weight[40] = {
 /* -20 */     88761,     71755,     56483,     46273,     36291,
 /* -15 */     29154,     23254,     18705,     14949,     11916,
 /* -10 */      9548,      7620,      6100,      4904,      3906,
 /*  -5 */      3121,      2501,      1991,      1586,      1277,
 /*   0 */      1024,       820,       655,       526,       423,
 /*   5 */       335,       272,       215,       172,       137,
 /*  10 */       110,        87,        70,        56,        45,
 /*  15 */        36,        29,        23,        18,        15,
};
```

이제 단순히 `sched_latency`를 task의 수로 나누는 것이 아니라, 각각의 `weight`를 고려하여 분배한다. 

총 $N$개의 task가 존재하고, $n$번째 task의 `weight`를 $\text{weight}_n$이라고 했을 때, `k`번째 task의 time slice $\text{time_slice}_k$는 다음과 같이 계산된다. 

$$
\text{time_slice}_k = \frac{\text{weight}_k}{\sum_{i=0}^{N-1}{\text{weight}_i}} \cdot \text{sched_latency}
$$

즉 각각의 `weight`에 따라 `sched_latency`를 비례배분한다고 생각하면 된다. 

예를 들어, `+14`의 `nice` 값을 가진 `A`와 `+20`의 `nice` 값을 가진 `B`를 가정하자. 이때 `A`의 `weight`는 45가 되고, `B`의 `weight`는 15가 된다. 따라서

$$
\text{time_slice}_A=\frac{45}{45 + 15} \cdot 60\text{ms} = 45\text{ms}
$$

$$
\text{time_slice}_B=\frac{15}{45 + 15} \cdot 60\text{ms} = 15\text{ms}
$$

가 될 것이다.

## 1-4. Update `vruntime`

이제 time slice를 비례배분하는 식으로 동작하기 때문에, `vruntime`도 이에 맞춰 비례적으로 증가해야 한다. 예를 들어, 앞에서 본 예시에서 `A`는 가중치가 `B`의 3배이므로 시간을 "정규화"하기 위해서 `A`의 `vruntime`은 `B`의 `vruntime`이 증가하는 속도의 $\frac{1}{3}$으로 증가해야 할 것이다. 이를 위해, `vruntime`의 업데이트는 다음과 같이 이루어진다.

$$
\text{vruntime}_i += \frac{\text{weight}_0}{\text{weight}_i} \cdot \text{runtime}_i
$$

이때 $\text{weight}_0$는 `nice=0` 일때의 `weight` 값이고, $\text{runtime}_i$는 $i$번째 task의 실제 실행 시간이다. 

## <부록> Red-Black Tree와 I/O Handling

CFS는 `vruntime`이 가장 적은 task를 schedule한다 했기 때문에, scheduling decision이 일어날 때마다 가장 작은 `vruntime`을 가진 task를 queue에서 찾아야 한다. 이를 위해 CFS는 red-black tree에 ready상태나 running 프로세스들을 저장해 관리한다. Red-black tree는 삽입, 탐색, 삭제가 전부 $O(\log{n})$이기 때문에 효율적으로 이러한 작업이 가능하다.

마찬가지로 긴 I/O 작업 후 깨어난 task의 `vruntime`은 해당 red-black tree에서 최소 `vruntime`을 탐색해 이 값으로 설정한다. 만약 `vruntime`이 이렇게 설정되지 않는다면 해당 task가 CPU를 독점하게 될 것이다. (예를 들어, 극단적으로 1시간동안의 I/O 작업 끝에 다시 ready 상태가 된 task를 생각해 보자. 이 task의 `vruntime`은 다른 모든 task의 `vruntime`보다 훨씬 작을 것이고, (모든 task의 nice가 동일하다면) 1시간동안 CPU를 독점하게 될 것이다!)

# 2. Earliest Eligible Virtual Deadline First (EEVDF)

EEVDF는 CFS와 기본적인 개념을 공유한다. 그러나 CFS는 오로지 `vruntime`만을 scheduling decision의 기준점으로 삼았기 때문에, 문제가 발생할 수 있다. 설명을 위해 다음 두 가지 task를 가정하자.

1. CPU-bound한 task `A`  
$\text{vruntime}_A = 90$  
$\text{nice}_A = 0$

2. IO-bound하며 interactive한 task `B`  
$\text{vruntime}_A = 95$  
$\text{nice}_B = -20$

이 경우에서, CFS는 당연히 `vruntime`이 더 적은 `A`를 schedule할 것이다. 따라서 `B`는 그동안 CPU를 받지 못할 것이고, 이로 인해 유저는 `B`가 버벅거린다고 생각할 것이다 (심지어 이는 `B`의 `nice`가 최저 점수임에도 불구하고 일어난 일이다!). 이런 문제를 해결하기 위해, EEVDF는 `lag`와 `deadline`을 도입해 이 문제를 해결한다. 

## 2-1. Lag

`lag`는 task 전체의 `vruntime` 평균보다 내가 얼마나 뒤쳐졌는지를 나타내는 값이고, 다음과 같이 계산된다. 

$$
\text{lag}_i = \bar{V} - \text{vruntime}_i
$$

이때 $V$는 task 전체의 `vruntime` 평균이다. 

$$
\bar{V} = \frac{\sum_{k=0}^{N-1}{\text{vruntime}_k}}{N}
$$

즉, $lag > 0$이면 이 task는 다른 task에 비해 상대적으로 `vruntime`이 뒤쳐졌다(즉, CPU를 덜 받았다)고 생각할 수 있다. 반대로, $lag < 0$이면 이 task는 다른 task에 비해 상대적으로 `vruntime`을 많이 받았다고 생각할 수 있다.

EEVDF는 모든 task에 대해 `lag` 값을 계산하고, 이 값이 양수인 task만 추려낸다. 이때, `lag` 값이 양수인 task를 

**<center>eligible</center>**

하다고 하고, 오로지 eligible한 task만이 schedule될 기회를 얻는다. 실제로 커널에서는 다음과 같은 코드를 통해 이를 구현한다. 

```c
// Def. in /kernel/sched/fair.c, line 832 (@linux-7.1)
static s64 entity_lag(struct cfs_rq *cfs_rq, struct sched_entity *se, u64 avruntime)
{
  // ...
  vlag = avruntime - se->vruntime;
  // ...
  return clamp(vlag, -limit, limit);
}


// Def. in /kernel/sched/fair.c, line 858 (@linux-7.1)
static __always_inline
bool update_entity_lag(struct cfs_rq *cfs_rq, struct sched_entity *se)
{
  u64 avruntime = avg_vruntime(cfs_rq);
  s64 vlag = entity_lag(cfs_rq, se, avruntime);

  // ...
  
  se->vlag = vlag;

  // ...
}
```

## 2-2. Deadline

다음으로, eligible한 task들에 대해 `deadline`을 다음과 같이 계산한다.

$$
\text{deadline}_i = \text{vruntime}_i + \frac{\text{slice}}{\text{weight}_i}
$$

이때 `slice`는 유저가 직접 설정하지 않았다면 `sysctl_sched_base_slice`을 가져다 쓰고(이는 앞서 설명한 `min_graduality`와 같다), 유저가 설정했다면 그 값을 가져다 쓴다.

```c
// Def. in /kernel/sched/fair.c, line 79 (@linux-7.1)
/*
 * Minimal preemption granularity for CPU-bound tasks:
 *
 * (default: 0.70 msec * (1 + ilog(ncpus)), units: nanoseconds)
 */
unsigned int sysctl_sched_base_slice			= 700000ULL;

// Def. in /kernel/sched/fair.c, line 1238 (@linux-7.1)
static bool update_deadline(struct cfs_rq *cfs_rq, struct sched_entity *se)
{
  // ...
  if (!se->custom_slice)
    se->slice = sysctl_sched_base_slice;

  /*
   * EEVDF: vd_i = ve_i + r_i / w_i
   */
  se->deadline = se->vruntime + calc_delta_fair(se->slice, se);

  // ...
}
```

> **참고**  
> custom slice는 `sched_setattr()` syscall을 통해 직접 설정할 수 있다. 

## 2-3. Pick

이렇게 계산된 task중, EEVDF는 `deadline`이 가장 작은 task에게 자원을 할당하고 실행시킨다. 

```c
// Def. in /kernel/sched/fair.c, line 1136 (@linux-7.1)

static struct sched_entity *pick_eevdf(struct cfs_rq *cfs_rq, bool protect)
{
    // ...
	/* Heap search for the EEVD entity */
	while (node) {
		struct rb_node *left = node->rb_left;

		/*
		 * Eligible entities in left subtree are always better
		 * choices, since they have earlier deadlines.
		 */
		if (left && vruntime_eligible(cfs_rq,
					__node_2_se(left)->min_vruntime)) {
			node = left;
			continue;
		}

		se = __node_2_se(node);

		/*
		 * The left subtree either is empty or has no eligible
		 * entity, so check the current node since it is the one
		 * with earliest deadline that might be eligible.
		 */
		if (entity_eligible(cfs_rq, se)) {
			best = se;
			break;
		}

		node = node->rb_right;
	}
found:
	if (!best || (curr && entity_before(curr, best)))
		best = curr;

	return best;
}
```

다시 처음의 예시로 돌아와 EEVDF가 어떻게 이 문제를 해결하는지 보자. 처음의 예시는 다음과 같이 2개의 task를 가정했었다. 

1. CPU-bound한 task `A`  
$\text{vruntime}_A = 90$  
$\text{nice}_A = 0$

2. IO-bound하며 interactive한 task `B`  
$\text{vruntime}_A = 95$  
$\text{nice}_B = -20$

여기에 추가로 $\bar{V}=80$이라는 가정을 추가하자. 그렇다면 두 task의 `lag`는 다음과 같을 것이다. 

$$
\text{lag}_A = 80 - 90 = -10
$$


$$
\text{lag}_B = 80 - 95 = -15
$$

두 task 모두 $lag < 0$이므로 eligible하고, 따라서 `deadline`이 다음과 같이 계산될 것이다.

> **참고**  
> 실제로 계산이 이루어질 때는 `weight`와 `slice`가 그대로 계산되진 않지만,  
> 여기서는 편의를 위해 그대로 집어넣었다. 

$$
\text{deadline}_A = 90 + \frac{700000}{1024} \approx 773.59
$$

$$
\text{deadline}_B = 95 + \frac{700000}{88761} \approx 102.88
$$

따라서 `B`가 schedule될 것이고, 유저는 버벅거림 없이 쾌적하게 `B`를 이용할 수 있을 것이다. 
