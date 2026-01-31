---
title: "[CS] TrustZone for Cortex-M (HW)"
excerpt: "Cortex-M 아키텍처에서의 TrustZone을 알아보자 (1)"

categories:
  - CS
tags:
  - [arm, trustzone, tz-m, tf-m, trustedfirmware, trustedfirmare-m, cortex-m]

permalink: /cs/arm-trustzone-m-hw/

toc: true
toc_sticky: true

date: 2026-01-31
last_modified_at: 2026-01-31
---

> 이 글은 TrustZone Technology Microcontroller System Hardware Design Concepts Version 1.0을 읽고 정리한 글입니다.  
> 원 문서는 [여기](https://documentation-service.arm.com/static/65817009159ca73387224b36)에서 볼 수 있습니다.

> 이 글은 TrustedFirmware-M을 이해하는 데 있어 필요한 최소한의 하드웨어적 TrustZone 구현만을 다룹니다.  
> 보다 깊은 내용은 위의 문서를 참고하시기 바랍니다.


# 0. Introduction

ARM TrustZone은 ARM 이키텍처에서 제공하는 하드웨어 기반 보안 기술이다. TrustZone은 보안에 민감한 애플리케이션이나 데이터를 일반적인 애플리케이션들과 분리된
실행 환경을 제공하는 것으로 보안성을 높이는데, 제공하는 아키텍처에 따라 Cortex-A용 TrustZone과 Cortex-M용 TrustZone으로 나눌 수 있다.

여기서는 Cortex-M용 TrustZone을 다룬다.

# 1. Memory Types

Cortex-M용 TrustZone은 메모리 주소에 기반해서 Secure 영역과 Non-secure 영역을 구분한다.
따라서 메모리 영역에 다음과 같은 4가지 속성을 가질 수 있다.

## 1-1. Non-secure (NS)

이 영역은 일반적인 유저 에플리케이션이 사용하는 영역이다. 이 영역에서 일어나는 메모리 접근(메모리 읽기, 쓰기와 branching을 비롯한 모든 종류의 접근을 의미한다)은
같은 NS 영역으로 한정된다. 즉 이 영역에서 실행되는 에플리케이션은 뒤에서 말할 S 영역에 접근할 수 없다.

## 1-2. Secure (S)

이 영역은 보안 에플리케이션이 사용하는 영역이다.

## 1-3. Non-secure Callable (NSC)

이 영역은 S에 속하는 영역이기는 하나, 예외적으로 NS에서 S에 존재하는 다양한 서비스들을 활용하기 위해 branching을 통해 실행할 수 있는 영역이다.

이 영역은 non-secure state에서 secure state로 전환하는 `SG` 인스트럭션이 수행될 수 있는 유일한 영역이기도 하다. 

## 1-4. Exempt

NS와 S, 모든 상태에서 접근할 수 이는 메모리 구역이다. 

# 2. Memory Map

ARMv8-M은 512MB을 기준으로 memory map을 만든다. 일반적으로 memory map은 마음대로 정할 수 있지만[^1], 이 문서에서는 다음과 같은 방법을 추천한다.

* 기존에 사용하던 memory map을 가져온다.
* 512MB를 기준으로, 아래쪽 절반은 NS로 사용하고 위쪽 절반은 S로 사용한다.

예시는 다음과 같다.

<center>
    <img src="/assets/images/posts_img/cs/about-arm-trustzone-m-hw/memory_map_ex.png" alt="memory_map_ex.png" width="70%">
</center>

이런 식으로 memory map을 결정하면, 주소의 28번째 비트를 사용해 이 영역이 S인지 NS인지 바로 판단할 수 있다는 장점이 생긴다. (무슨 소리인지 모르곘으면 주소를 바이너리로 바꿔보자)

# 3. IDAU / SAU

위에서 언급했듯, Cortex-M용 TrustZone은 메모리 주소로 S와 NS를 구분한다. 이를 위해 사용될 수 있는 유닛이 IDAU(Implementation Defined Attribution Unit)과
SAU이다.

SAU는 프로세서 안에 위치한 유닛이다. 이 유닛은 S 상태에서 programmable하며, MPU(Memory Protection Unit)과 비슷한 방법으로 프로그래밍이 가능하다. 
이에 반해 IDAU는 프로세서 바깥에 위치하며, 일반적으로 칩 설계 당시에 결정되며 programmable하지 않다.

<center>
    <img src="/assets/images/posts_img/cs/about-arm-trustzone-m-hw/idau_responder.png" alt="idau_responder.png" width="70%">
</center>

프로세서는 위의 그림처럼 IDAU와 SAU 둘 다 메모리 영역의 attribute를 결정하기 위해 쓸 수 있지만, 다음과 같은 제약이 존재한다.

<center>
IDAU와 SAU가 반환한 attribute가 다를 경우, 더 강한 attribute가 적용됨.
</center>

예를 들어 설명하면 다음과 같다.

* IDAU가 특정 영역을 NS, SAU가 S로 지정하면 그 영역은 S가 된다.
* 반대로 SAU가 특정 영역을 S, IDAU가 NS로 지정해도 그 영역은 S가 된다.

이를 그림으로 표현하면 아래와 같다. SAU와 IDAU 사이 차이가 있는 영역에 집중해서 보자.

<center>
    <img src="/assets/images/posts_img/cs/about-arm-trustzone-m-hw/memory_attribution_precedence.png" alt="memory_attribution_precedence.png">
</center>

# 4. `SG` Instruction

ARMv8-M 프로세서는 NS에서 S로 상태를 전환하기 위해 특별한 instruction 실행이 필요한데, 이것이 `SG`(Secure Gateway) instruction이다.
S에 존재하는 코드들은 `SG`를 통해 해당 위치가 적절한 entry임(예를 들어, S에 존재하는 함수의 시작 위치)을 표시한다. 예를 들어, 공격자가 NS에서 실행되는 에플리케이션의 취약점을 통해 `PC`를 컨트롤할 수
있는 상황일지라도, S에 존재하는 가젯들을 사용하기 위해 S에 존재하는 코드의 임의 위치로 점프할 수 없다는 것이다. 

위에서 잠깐 언급했듯, `SG`가 실행될 수 있는 곳은 오로지 NSC로 표시된 영역밖에 없다. 이렇게 하면 프로그래머가 실수로 `SG` 인스트럭션을
유저 에플리케이션에 포함하거나, `SG` 인스트럭션과 같은 인코딩 값을 가지는 데이터(`0xE97F`)를 저장하는 데서 생길 수 있는 보안상의 문제점을 해결할 수 있다.

# 5. System Initialization

TrustZone을 지원하는 ARMv8-M 프로세서들은 S상태로 리셋된다. 이때 리셋 주소는 `VTOR_S`(Secure Vector Table Offset Register)에 의해 정해진다[^2].
따라서 프로세서를 초기화할 때 프로그래머는 `VTOR_S`가 S 영역을 가리키고 있다는 것을 보장해야 하며, 만약 S 영역이 아니라면 fault가 발생되게 된다.

또한 기본적으로 system security controller는 주변 장치와 메모리를 S에서만 접근할 수 있도록 허용한다. 따라서 부팅 과정에서 NS가 사용할 수 있도록 주변 장치와 메모리의 접근을
release하는 과정이 필요하다.

[^1]: Region numbers의 제약으로 256개를 초과하는 영역으로 나눌 수는 없다.
[^2]: 이 레지스터의 초깃값을 설정하는 방법은 자세히 소개되어있지는 않지만, 여러 가지 방법이 가능하다고 설명되어 있다.