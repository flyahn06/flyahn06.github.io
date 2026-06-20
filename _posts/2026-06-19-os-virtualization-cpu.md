---
title: "[CS][OS] Virtualization - CPU"
excerpt: "OS는 여러 process들을 하나의 프로세서 위에서 어떻게 돌릴까?"

categories:
  - Operating System
tags:
  - [os, process, scheduling, cpu virtualization]

permalink: /os/virtualiztion-cpu/

toc: true
toc_sticky: true

date: 2026-06-19
last_modified_at: 2026-06-20
---

> 이 글은 Andrea Arpaci-Dusseau and Remzi Arpaci-Dusseau의 Operating Systems: Three Easy Pieces를 참고한 글입니다.  
> [여기](https://pages.cs.wisc.edu/~remzi/OSTEP/)에서 무료로 볼 수 있습니다.

# 0. Introduction

현대 컴퓨터의 프로세서는 이전에 비해 많이 늘었지만, 여전히 무한하지는 않다. 일반 사용자들은 많아봐야 32개 이하의 프로세서를 사용한다. 그러나 그 프로세서 위에서 돌아가는 process의 수는 훨씬 많다. 당장 작업 관리자만 실행해 봐도, 32개를 훌쩍 넘는 process들이 동작하고 있음을 알 수 있다. 그러나 이 process들은 자신이 프로세서를 독점하고 있다고 생각할 것이다 (현재 실행되고 있기 때문에). 그렇다면 어떻게 이런 것이 가능할까? 다시 말해, 어떻게 한정된 자원으로 "무한한 자원"이 존재하는 것처럼 process들을 속일 수 있을까? 

# 1. Defination of A Process

이에 앞서 process의 정의를 살펴보자. 정말 쉽게 설명하자면, process는 실행 중인 프로그램이다. 여기서 중요한 것은 process는 단순히 프로그램의 바이너리 데이터만을 의미하는 것이 아니라, 동작 중인 context를 포함한다는 점이다. 즉, process는 다음과 같은 것들을 포함한다. 

1. process에 운영체제가 할당한 메모리 (stack, heap, data, code등)
2. 레지스터 상태
3. 사용 중인 I/O 장치들

다시 말해, 프로그램의 바이너리 데이터와 위에서 말한 요소들을 잘 저장하고 복원할 수만 있다면, process를 잠시 멈췄다가 실행하는 것이 가능해진다는 것이다. 

# 2. Process States

다음으로 process가 가질 수 있는 상태를 알아야 한다. process는 다음과 같은 상태를 가질 수 있다. 

* `Running`: 이 상태를 가진 process들은 말 그대로 실행중으로, instruction들이 CPU에서 실행중인 상태이다. 
* `Ready`: 이 상태를 가진 process들은 당장 실행될 수 있지만, 자원을 할당받지 못해 대기 중인 상태이다. 
* `Blocked`: 이 상태를 가진 process들은 특정 이벤트가 발생하기 전까지 멈춰 있는 상태이다. 주로 I/O 작업을 요청한 process가 요청된 I/O 작업이 끝나기 전까지 이 상태이다. 

그림으로 표현하면 다음과 같다.

<center>
      <img src="/assets/images/posts_img/cs/os/abstraction-process-cpu-virtualization/process-three-states.png" alt="process-three-states">
</center>

process는 위 3가지 상태를 번갈아가며서 동작한다. 이때 OS가 특정 process를 `ready` 상태에서 `running` 상태로 바꾸면 해당 process는 **scheduled** 되었다고 하며, 반대로 `running` 상태에서 ready 상태나 `blocked` 상태로 바뀌면 해당 process는 **descheduled** 되었다고 표현한다.

# 3. Process Transition

## 3-1. Overview

하나의 코어를 가진 CPU와 4개의 insturction을 수행하고 끝나는 process A, B를 가정하자 (즉, A와 B는 I/O 작업을 수행하지 않는다). A가 먼저 실행된다 가정했을 때, 이 두 process는 다음과 같은 상태를 가지며 동작할 것이다.


| Time | Process_A | Process_B | Notes       |
| ---- | --------- | --------- | ----------- |
| 1    | Running   | Ready     |             |
| 2    | Running   | Ready     |             |
| 3    | Running   | Ready     |             |
| 4    | Running   | Ready     | Process_A 끝 |
| 5    | \-        | Running   |             |
| 6    | \-        | Running   |             |
| 7    | \-        | Running   |             |
| 8    | \-        | Running   | Process_B 끝 |
{: style="display: table; margin: 0 auto; width: auto;"}

`T=4`에서 `Process_A`가 끝나며 `Process_B`로 자원이 넘어가고, `ready` 상태에서 `running` 상태로 바뀌며 실행되는 것을 볼 수 있다.

이번에는 `Process_A`가 `T=2`에서 3사이클짜리 I/O 작업을 수행한다고 가정하자. 이 경우에는 `Process_A`가 `blocked` 상태로 전환되며, `ready` 상태인 `Process_B`가 자원을 할당받고 실행될 것이다. 표로 나타내면 다음과 같다.

| Time | Process_A | Process_B | Notes       |
| ---- | --------- | --------- | ----------- |
| 1    | Running   | Ready     |             |
| 2    | Running   | Ready     | Process_A가 I/O 시작 |
| 3    | Blocked   | Running     |             |
| 4    | Blocked   | Running     |  |
| 5    | Blocked        | Running   |             |
| 6    | Ready        | Running   | Process_A 끝 |
| 7    | Running        | \-   |  |
| 8    | Running        | \-   | Process_B 끝 |
{: style="display: table; margin: 0 auto; width: auto;"}

위 표처럼 `T=2` 이후 `Process_B`가 자원을 할당받고 실행되기 시작하며, `Process_A`는 `blocked` 상태로 전환됨을 볼 수 있다. 이때 `T=5`에서 `Process_A`가 I/O 작업을 끝내지만, 바로 자원을 받고 `running` 상태로 전환되는 것이 아니라 `Process_B`가 작업을 끝낼 때까지 `ready` 상태로 대기하는 점에 주목하자. [^1]
 
## 3-2. Data Structures

위의 예시로부터 OS가 직접 process의 상태를 바꿔가며 여러 process들을 실행한다는 것을 알았다. 바꿔 말하면, OS는 모든 process를 관리하는 것이고, 이 때문에 

1. 실행 중인 process 목록
2. process의 context

를 알고 있어야 한다. 

따라서 OS는 실행 중인 모든 process를 list 형태로 만들어 관리하며, 이를 **process list**라 부른다. 또한 `ready` 상태인 process를 `running`으로 만들기 위해, 혹은 그 반대의 경우를 위해 process의 register context, 사용 중인 장치 정보, `pid`등을 다음 예시와 같이 구조체로 만들어 저장한다.

```c
struct context {
  int rip;
  int rsp;
  int rbp;
  // ...
}

struct proc {
  char *mem;                    // address space의 시작 주소
  uint sz;                      // process가 할당받은 메모리 크기
  // ...
  enum proc_state state;
  int pid;
  struct context context;
  struct file *ofile[NOFILE];   // 사용 중인 file 목록
}
```

이제 OS는 process의 상태를 바꾸고 싶을 때 해당 구조체를 통해 process의 상태를 저장하고 `ready` 혹은 `blocked` 상태로 전환하거나, 해당 구조체로부터 process의 상태를 복원하고 자원을 할당해 `running` 상태로 만들 수 있게 된다. [^2]

# 4. Limited Direct Execution (LDE)

위의 예시로부터, 우리는 OS가 직접 process의 상태에 관여하며 여러 process를 하나의 CPU위에서 돌릴 수 있음을 알았다. 그러나 지금까지의 내용은 단순히 여러 process가 하나의 CPU 위에서 돌아갈 수 있다는 것이지, 여러 process가 "동시에" 돌아가는 것처럼 한다는 것이 아니었다. 그렇다면 어떻게 해야 여러 process가 동시에 돌아가는 것처럼 보일 수 있을까? 

답은 간단하다. 특정 process를 짧은 시간 동안 돌리고, 다른 process를 짧은 시간 동안 돌리고, 또 다른 process를 짧은 시간 동안 돌리는 것을 계속 반복하는 것이다[^3] (이를 time-sharing이라 한다). 이를 통해 process가 얼마나 많든 관계없이, 무한히 많은 CPU가 존재하는 것 같은 착각을 불러일으키는 CPU Virtualization이 달성된다.

그러나 이 방법에는 다음과 같은 문제가 존재한다. 

1. 어떻게 시스템에 overhead를 최소화하며 virtualization을 달성할 수 있을까?
2. OS가 어떻게 process에 대한 제어권을 유지할까?  
예를 들어, 악의적인 process 하나가 자원을 돌려주지 않고 계속해서 실행된다면 OS로서는 이를 막을 방법이 없다. (해당 process가 돌아가는 동안 OS는 실행될 수 없기 때문이다.)  
마찬가지로, 악의적인 process가 민감한 메모리에 직접 접근하는 것도 OS가 막을 수 없을 것이다.

이러한 문제를 위해 등장한 것이 LDE이다. 

## 4-1. Direct Execution

Direct Execution의 아아디어는 굉장히 단순하다. 실행하고 싶은 process를 아무런 제한 없이 CPU에서 바로 돌리는 것이다. 즉, OS가 어떤 process를 실행하고 싶다면 다음과 같은 절차를 따라 실행될 것이다.

1. 해당 process를 process list에 추가한다.
2. 해당 process를 위한 메모리를 할당하고, 프로그램을 메모리에 로드한다.
3. 해당 process의 EP로 점프한다.

process가 끝나면 다음과 같은 절차를 밟을 것이다.

1. process에 할당된 메모리를 해제한다.
2. 해당 process를 process list에서 삭제한다.

그러나 이는 위에서 말한 문제점이 존재한다. 이를 해결하기 위해 **Limited** DE가 등장했다.

## 4-2. Restricted Operations

우선 process가 허가되지 않은 자원에 접근하는 것(예를 들어 다른 process의 메모리에 접근하는 행위)을 막기 위해서, CPU에 `mode`가 도입되었다. CPU는 다음과 같은 2개의 `mode`를 가지고 있으며, 각각의 `mode`에 대한 설명은 다음과 같다. 

* `Kernel mode`: 이 모드에서는 CPU가 어떤 작업이든 제한없이 할 수 있다. OS가 동작하는 모드이다.
* `User mode`: 이 모드에서는 CPU가 실행할 수 있는 instruction이 제한된다. 특히, 이 모드에서는 I/O 작업을 직접적으로 수행하거나 주변 장치에 접근하는 것이 제한된다. 일반적인 프로그램이 동작하는 모드이다.

그렇다면 `user mode`에서 동작하는 process가 I/O 작업을 하거나 주변 장치에 접근하려면 어떻게 할까? 이를 위해 `system call`이라는 개념이 등장했다. `User mode`의 process들은 직접 I/O 작업을 하거나 주변 장치에 접근하는 것이 아니라, system call을 통해 OS에 하고자 하는 작업을 대신 수행하도록 하는 것이다. 이렇게 하면 OS가 해당 작업의 유효성을 검사할 수 있기 때문에 위에서 말한 문제점이 사라지게 된다. 

이때 system call을 통해 OS로 context를 전환하며 CPU의 mode를 전환하기 위해 `trap`으로 대표되는 특별한 instruction이 실행되며, 반대로 OS에서 요청을 처리한 후 user process로 context를 전환하기 위해 `return-from-trap`으로 대표되는 특별한 instruction이 실행된다. 표로 실행 흐름을 보면 다음과 같다.

| OS @ boot <br> (Kernel Mode) | Hardware                               |
| ------------------------ | -------------------------------------- |
| initialize trap table    | remember address of<br>&nbsp;&nbsp; syscall handler |
{: style="display: table; margin: 0 auto; width: auto;"}
{% include gallery caption="부팅 시" %}

| OS @ run<br>(Kernel Mode)                                                                    | Hardware                                                   | Program<br>(User Mode)     |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------- |
| Process list에 추가<br>process를 위한 메모리 할당<br>프로그램 로드<br>Kernel stack에 register 세팅<br>return-from-trap<br> |                                                            |                         |
|                                                                                           | Kernel stack으로부터 register 복구<br>User mode로 전환<br>main으로 점프       |                         |
|                                                                                           |                                                            | syscall<br>OS로 trap        |
|                                                                                           | Kernel stack에 register 저장<br>Kernel mode로 전환<br>Trap handler로 점프 |                         |
| syscall 처리<br>return-from-trap                                                               |                                                            |                         |
|                                                                                           | Kernel stack으로부터 register 복구<br>User mode로 전환 복원된 PC로 점프      |                         |
|                                                                                           |                                                            | 실행 종료<br>OS로 trap (exit()) |
|                                                                                           | Kernel stack에 register 저장<br>Kernel mode로 전환<br>Trap handler로 점프 |                         |
| syscall 처리<br>&nbsp;&nbsp;process에 할당된 메모리 해제<br>&nbsp;&nbsp;Process list에서 해당 process 삭제                                    |                                                            |                         |
{: style="display: table; margin: 0 auto; width: auto;"}
{% include gallery caption="실행 시" %}

부팅 시, CPU는 항상 kernel mode로 시작되고 따라서 OS는 trap table을 설정할 수 있다. 이때 OS는 syscall handler의 위치를 설정하게 된다.

이후 OS가 process를 시작할 때, 자원 할당 후 바로 프로그램의 EP로 점프하는 것이 아니라 `kernel stack`에 레지스터를 저장하게 된다. 이때 `kernel stack`은 per-process이며, 특정한 형식에 따라 세팅해두면 CPU의 mode 전환이 일어날 때 하드웨어가 알아서 레지스터를 저장 및 복원해준다. 이렇게 register들이 저장된 frame을 `interrupt frame`이라 하고, 형태는 아래의 구조체에서 볼 수 있다.

<details>
<summary>Interrupt Frame 펼치기/접기</summary>
{% highlight C %}
// Def. in /arch/x86/include/asm/ptrace.h, line 103 (@linux-7.1)

struct pt_regs {
	/*
	 * C ABI says these regs are callee-preserved. They aren't saved on
	 * kernel entry unless syscall needs a complete, fully filled
	 * "struct pt_regs".
	 */
	unsigned long r15;
	unsigned long r14;
	unsigned long r13;
	unsigned long r12;
	unsigned long bp;
	unsigned long bx;

	/* These regs are callee-clobbered. Always saved on kernel entry. */
	unsigned long r11;
	unsigned long r10;
	unsigned long r9;
	unsigned long r8;
	unsigned long ax;
	unsigned long cx;
	unsigned long dx;
	unsigned long si;
	unsigned long di;

	/*
	 * orig_ax is used on entry for:
	 * - the syscall number (syscall, sysenter, int80)
	 * - error_code stored by the CPU on traps and exceptions
	 * - the interrupt number for device interrupts
	 *
	 * A FRED stack frame starts here:
	 *   1) It _always_ includes an error code;
	 *
	 *   2) The return frame for ERET[US] starts here, but
	 *      the content of orig_ax is ignored.
	 */
	unsigned long orig_ax;

	/* The IRETQ return frame starts here */
	unsigned long ip;

	union {
		/* CS selector */
		u16		cs;
		/* The extended 64-bit data slot containing CS */
		u64		csx;
		/* The FRED CS extension */
		struct fred_cs	fred_cs;
	};

	unsigned long flags;
	unsigned long sp;

	union {
		/* SS selector */
		u16		ss;
		/* The extended 64-bit data slot containing SS */
		u64		ssx;
		/* The FRED SS extension */
		struct fred_ss	fred_ss;
	};

	/*
	 * Top of stack on IDT systems, while FRED systems have extra fields
	 * defined above for storing exception related information, e.g. CR2 or
	 * DR6.
	 */
};
{% endhighlight %}
</details>

> **참고**  
> 일반적으로 syscall을 호출하기 위해서는 user mode의 프로그램이 정해진 형식대로 register를 설정하는 것이 필요하다.  
> 대표적으로 SYSV의 syscall 형식은 [여기](https://syscalls.mebeim.net/?table=x86/64/x64/latest)에서 볼 수 있다.

## 4-3. Process Switch

위에서 말했듯, CPU Virtualizaion을 위해서는 한 process를 짧은 시간 동안 실행하고, 다른 process를 짧은 시간 동안 실행하는 것을 연속적으로 해야 한다고 언급했었다. 그러나 user process가 실행중일 때는 OS가 실행될 수 없는데, 이는 어떻게 해결해야 할까?

### 4-3-1. Non-preemptive(cooperative) Approach

가장 쉬운 방법은 user process가 syscall을 통해 자발적으로 context를 OS로 전환할 때까지 기다리는 것이다. OS가 syscall을 처리한 이후 이 process를 계속 실행할지 아니면 다른 process를 실행할지 결정하도록 하는 것이다.

> **참고**  
> User process는 오류에 의해 OS로 trap하기도 한다.  
> 예를 들어, 0으로 나누거나 접근할 수 없는 메모리 주소에 접근하는 경우(null dereferencing을 생각해 보자)를 생각해 보자.

그러나 이 방법은 process가 악의적인 목적을 가지고 (혹은 실수로) syscall을 하지 않은 채 무한루프에 빠져버린다면 OS가 실행되지 못할 것이고, 이는 시스템 전체가 멈추는 결과를 가져온다. 

### 4-3-2. Preemptive(non-cooperative) Approach

위에서 살펴본 non-preemptive approach는 프로세스가 악의적이든 실수든 syscall을 실행하지 않으면 CPU를 독점할 수 있는 문제가 있었다. 이를 해결하기 위해 OS는 한 번 더 `timer interrupt`를 통해 하드웨어의 도움을 받게 된다. 

이를 위해 OS는 부팅 시 `interrupt timer`와 `interrupt handler`를 설정하게 되고, `interrupt timer`가 설정된 CPU는 설정된 시간마다 `interrupt`를 발생시키게 된다. 따라서 user process가 자발적으로 syscall 등을 통해 OS에 실행권을 양보하지 않더라도 일정 시간이 흐른 후 항상 OS로 실행 흐름이 돌아오는 것이 보장된다. 따라서 OS는 계속해서 해당 process를 실행할지, 다른 process로 context switch할 지 결정할 수 있게 된다. 이를 표로 나타내면 다음과 같다. 

| OS @ boot <br> (Kernel Mode) | Hardware                               |
| ------------------------ | -------------------------------------- |
| initialize trap table    | remember address of<br>&nbsp;&nbsp; syscall handler<br>&nbsp;&nbsp; interrupt handler |
| start interrupt timer    | 하드웨어 타이머 시작<br>&nbsp;&nbsp; 설정된 시간마다 interrupt 발생 |
{: style="display: table; margin: 0 auto; width: auto;"}
{% include gallery caption="부팅 시" %}

| OS @ run<br>(Kernel Mode)                                                                         | Hardware                                                             | Program<br>(User Mode) |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------- |
|                                                                                                                                                       |                                                                      | Process A           |
|                                                                                                                                                       | Timer interrupt<br>A의 registers를 A의 kernel stack에 저장<br>trap handler로 jump |                     |
| Trap handle<br>&nbsp;&nbsp;A를 계속 실행할지 다른 process로 switch할지 결정<br>&nbsp;&nbsp;A의 register를 A의 proc-struct에 저장<br>&nbsp;&nbsp;B의 proc-struct로부터 B의 register 복원<br>&nbsp;&nbsp;B의 kernel stack으로 전환<br>return-from-trap |                                                                      |                     |
|                                                                                                                                                       | Kernel stack으로부터 register 복원<br>User mode로 전환<br>복원된 PC로 점프                |                     |
|                                                                                                                                                       |                                                                      | Process B           |
{: style="display: table; margin: 0 auto; width: auto;"}
{% include gallery caption="실행 시" %}

이를 통해 OS는 다수의 process가 하나의 CPU 위에서 실행되는 것처럼 보이게 하면서도, 각각의 process에 대한 제어권을 잃지 않을 수 있다. 

[^1]: 여기서 `Process_A`가 I/O 작업 이후 바로 `running` 상태로 전환될지, `ready` 상태로 전환 후 대기할지는 전적으로 scheduler의 policy에 의해 결정된다. 이는 나중에 다룰 예정이다.
[^2]: 이를 context switch라 부른다.
[^3]: 여기서 어느 process를 돌릴지, 또 그 시간은 얼마만큼 정할지에 대한 내용은 scheduler의 policy에 의해 결정된다. 이 내용은 나중에 더 깊게 다룰 예정이다. 