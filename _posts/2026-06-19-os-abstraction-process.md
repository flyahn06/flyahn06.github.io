---
title: "[CS][OS] Abstraction - The Process"
excerpt: "OS는 여러 process들을 하나의 프로세서 위에서 어떻게 돌릴까?"

categories:
  - Operating System
tags:
  - [os, process, scheduling, cpu virtualization]

permalink: /os/abstraction-process/

toc: true
toc_sticky: true

date: 2026-06-19
last_modified_at: 2026-06-19
---

> 이 글은 Andrea Arpaci-Dusseau and Remzi Arpaci-Dusseau의 Operating Systems: Three Easy Pieces를 참고한 글입니다.  
> [여기](https://pages.cs.wisc.edu/~remzi/OSTEP/)에서 무료로 볼 수 있습니다.


현대 컴퓨터의 프로세서는 이전에 비해 많이 늘었지만, 여전히 무한하지는 않다. 일반 사용자들은 많아봐야 32개 이하의 프로세서를 사용한다. 그러나 그 프로세서 위에서 돌아가는 프로세스의 수는 훨씬 많다. 당장 작업 관리자만 실행해 봐도, 32개를 훌쩍 넘는 프로세스들이 동작하고 있음을 알 수 있다. 그러나 이 프로세스들은 자신이 프로세서를 독점하고 있다고 생각할 것이다 (현재 실행되고 있기 때문에). 그렇다면 어떻게 이런 것이 가능할까? 다시 말해, 어떻게 한정된 자원으로 "무한한 자원"이 존재하는 것처럼 프로세스들을 속일 수 있을까? 

# 1. Process

이에 앞서 프로세스의 정의를 살펴보자. 정말 쉽게 설명하자면, 프로세스는 실행 중인 프로그램이다. 여기서 중요한 것은 프로세스는 단순히 프로그램의 바이너리 데이터만을 의미하는 것이 아니라, 동작 중인 context를 포함한다는 점이다. 즉, 프로세스는 다음과 같은 것들을 포함한다. 

1. 프로세스에 운영체제가 할당한 메모리 (stack, heap, data, code등)
2. 레지스터 상태
3. 사용 중인 I/O 장치들

다시 말해, 프로그램의 바이너리 데이터와 위에서 말한 요소들을 잘 저장하고 복원할 수만 있다면, 프로세스를 잠시 멈췄다가 실행하는 것이 가능해진다는 것이다. 

# 2. Process Status

다음으로 프로세스가 가질 수 있는 상태를 알아야 한다. 프로세스는 다음과 같은 상태를 가질 수 있다. 

* **Running**: 이 상태를 가진 프로세스들은 말 그대로 실행중으로, instruction들이 CPU에서 실행중인 상태이다. 
* **Ready**: 이 상태를 가진 프로세스들은 당장 실행될 수 있지만, 자원을 할당받지 못해 대기 중인 상태이다. 
* **Blocked**: 이 상태를 가진 프로세스들은 IO 작업 
