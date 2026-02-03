---
title: "[CS] TrustZone for Cortex-M (SW)"
excerpt: "Cortex-M 아키텍처에서의 TrustZone을 알아보자 (3)"

categories:
  - CS
tags:
  - [arm, trustzone, tz-m, tf-m, trustedfirmware, trustedfirmare-m, cortex-m]

permalink: /cs/arm-trustzone-m-sw-2/

toc: true
toc_sticky: true

date: 2026-02-03
last_modified_at: 2026-02-03
---

> 이 글은 Armv8-M Security Extension User Guide Version 1.0을 읽고 정리한 글입니다.  
> 원 문서는 [여기](https://documentation-service.arm.com/static/67936b5127eda361ad4e5c0d)에서 볼 수 있습니다.

> 이 글은 [이전 글](/cs/arm-trustzone-m-sw)에서 이어지며,   
> ARM Assembly에 대한 기본적인 이해를 전제로 합니다.

---

# (추가) Cortex-M의 mode와 PSP, MSP

Cortex-M은 다음과 같이 2개의 mode를 지원한다.

* Thread mode는 exception이나 interrupt가 발생하지 않은 보통의 상태에서 동작하는 모드로, 일반적인 동작 상황에서 사용되는 모드이다.
* Handler mode는 exception이나 interrupt가 발생한 상황에서 이를 처리하기 위해 사용되는 모드이다. Thread mode보다 높은 권한을 가진다.

프로세서가 어느 모드에 있냐에 따라 `SP` 레지스터가 가리키는 레지스터가 달라지는데, 이때 사용될 수 있는 레지스터가 `PSP`(Process Stack Pointer)와 
`MSP`(Main Stack Pointer)이다.

## MSP (Main Stack Pointer)

이 포인터는 프로세서가 handler mode일 때 쓰인다. 그러나 설정에 따라 thread mode에서도 이 스택 포인터를 사용할 수 있다. 

`MSP`가 가질 수 있는 값을 제한하기 위해 (즉, main stack frame의 크기를 제한하기 위해) `MSPLIM`을 사용할 수 있다. 
만약 main stack frame의 크기가 너무 커져 `MSP > MSPLIM`이 되면 synchronous stack limit violation (STKOF) UsageFault이 발생한다.

## PSP(Process Stack Pointer)

이 포인터는 프로세서가 thread mode일 때 사용될 수 있다. 이는 `CONTROL` 레지스터의 `SPSel` 비트에 따라 다음과 같이 결정된다.

`PSP`가 가질 수 있는 값을 제한하기 위해 (즉, process stack frame의 크기를 제한하기 위해) `PSPLIM`을 사용할 수 있다.
만약 main stack frame의 크기가 너무 커져 `PSP > PSPLIM`이 되면 synchronous stack limit violation (STKOF) UsageFault이 발생한다.

* `CONTROL.SPSel == 0`인 경우, thread mode에서 `MSP`를 사용한다.
* `CONTROL.SPSel == 1`인 경우, thread mode에서 `PSP`를 사용한다.

여기서 기억해야 할 사실은 `PSP`와 `MSP` 모두 banked 레지스터이며, 따라서 `PSP_NS`, `MSP_NS`, `PSP_S`, `MSP_NS`로 나뉠 수 있다.
당연하게도 이들을 제한하는 limit 레지스터도 banked 레지스터이며, `PSPLIM_NS`, `MSPLIM_NS`, `PSPLIM_S`, `MSPLIM_S`로 세분화될 수 있다.

또한 `CONTROL.SPSel` 비트도 banked이기 때문에, S와 NS가 사용하는 스택 설정이 다를 수 있다는 것을 알아야 한다. 다시 말해, NS의 thread mode는
`PSP`를 쓰지만 S의 thread mode는 `MSP`를 쓸 수도 있다는 것이다. 이로 인해 생기는 문제점들을 해결하기 위해 뒤에서 말할 stack sealing이 반드시 필요하다.

---

# 4. Exception Model

> 이 절에서는 tf-m을 이해하기 위해 필요한 최소한의 Exception Model 설명만을 담고 있습니다.  
> 이에 대한 보다 자세한 내용은, [위에서 언급한 문서](https://documentation-service.arm.com/static/67936b5127eda361ad4e5c0d)의 5. Armv8-M 
> exception model with Security Extension과 
> [Armv8-M Exception Model User Guide](https://developer.arm.com/documentation/107706/latest/)를 참고하시기 바랍니다.

## 4-1. Exception에서의 state 전환

TrustZone을 지원하는 Cortex-M 프로세서는 exception에 있어 다음과 같은 특징을 갖는다.

1. 일부 system exception은 banked됨  
  즉, S와 NS는 banked된 system exception에 대해 서로 다른 버전을 가질 수 있다.
2. S와 NS는 서로 다른 exception vector table을 갖는다.  
  즉, S와 NS는 같은 exception일지라도 이를 처리하는 exception handler의 구현이 다를 수 있다.
3. S의 exception handler들은 `SG`로 시작할 필요가 없다.  
  대신, 프로세서가 S에서 처리되어야 하는 exception이 발생하면 알아서 state를 전환한다. 따라서 secure exception handler들은 
  `__attribute__((cmse_nonsecure_entry))` 속성이 붙어 있어서는 안 된다. 

주변기기에 대한 interrupt가 처리될 영역은 Interrupt Target Non-secure (`NVIC_ITNS`) 레지스터를 통해 결정할 수 있다. 이 레지스터는
S 상태에서만 programmable하다. 

Exception이 발생하면 프로세서는 다음 그림과 같이 해당 exception에 맞는 state로 상태전환을 한다.

<center>
      <img src="/assets/images/posts_img/cs/about-arm-trustzone-m-sw-2/exc_state_trans.png" alt="exc_state_trans.png" width="70%">
</center>

Exception이 발생해 exception handler가 실행될 때, 만약 state가 동일하다면 (예를 들어 S 실행 도중 S에서 처리하는 exception이 발생한다면), 일반적인
exception handling이 수행된다. 그러나 S가 실행되던 도중 NS에서 처리해야 하는 exception이 발생한 경우, S의 context를 NS가 볼 수 없도록 하기 위해
추가적인 작업이 필요하다.

이 경우 프로세서는 secure stack 위로 민감한 정보를 담고 있는 레지스터를 전부 push하고, 레지스터의 값을 지운다. 따라서 일반적인 처리에 비해 latency가 길어지게 된다.

## 4-2. Stack Frames

위에서 말한 이유로 인해(민감한 정보를 지우는 행위), 여기서 사용하는 exception stack frame은 일반적인 함수가 사용하는 stack frame과는 다르다.
일반적인 exception frame은 다음과 같이 생겼다 (굉장히 크다). 참고로, 이런 exception stack frame의 생성과 해석은 전적으로 하드웨어에 의해 이루어진다. 

<center>
      <img src="/assets/images/posts_img/cs/about-arm-trustzone-m-sw-2/exc_stkfr_layout.png" alt="exc_stkfr_layout.png">
</center>

각각의 context 영역 대한 설명은 다음과 같다. 

### 4-2-1. State context

이 영역은 caller-saved registers로 지정된 레지스터를 저장하는 영역이다. 

### 4-2-2. (Additional) FP context

이 영역은 FP를 사용하는 경우, caller-saved registers로 지정된 레지스터를 저장하는 영역이다. 

### 4-2-3. Additional state context

이 영역은 callee-saved registers로 지정된 레지스터를 저장하는 영역이다. 

### 4-2-4. Integrity signature

이 영역은 이 frame이 exception frame임을 나타내기 위해 쓰이는 값이다. FP context가 없는 경우 `0xFEFA125A`라는 고정된 값을 사용하며,
있는 경우 `0xFEFA125B`를 사용한다. 이 값의 역할은 stack sealing과 함께 부록의 설명을 보자.

## 4-3. `EXC_RETURN`

전 글에서 언급했듯, S가 NS를 호출한 후 복귀할 때는 실행 흐름의 무결성을 보장하기 위해 `LR`에 `FNC_RETURN`이라는 특수한 값을 넣는다고 했다. 이는 S 실행 도중
NS의 exception handler가 실행된 후 S로 복귀할 때도 마찬가지이다. 

일반적으로 C 함수의 호출은 `BL`(branch and link) 인스트럭션으로 이루어지며, `BL` 인스트럭션은 자동으로 `LR` 레지스터에 복귀 주소를 저장한다. 따라서
함수의 복귀는 일반적으로 `BX LR`이나 (다른 함수를 호출해 `LR`이 stack에 push된 경우,) `POP {PC}`로 이루어진다. 

Exception handler도 C로 작성될 수 있기 때문에, Armv8-M 프로세서들은 exception handling을 위해 S에서 NS로 전환되는 경우 위에서 말한
exception stack frame을 생성한 후 `LR` 레지스터에 `EXC_RETURN`이라는 특수한 토큰을 넣는다. 

따라서 NS에서 exception handling이 끝난 후, 일반적인 함수 리턴을 수행하면 프로세서가 `EXC_RETURN` 값을 보고 만들어뒀던 exception stack frame의
context를 통해 이전 상태로 복귀할 수 있다. (exception stack frame의 해석은 전적으로 하드웨어에 의해 이루어진다는 점을 다시 생각해보자)

# (부록) Stack sealing과 integrity signature

> 이 내용은 [Armv8-M Secure Stack Sealing Advisory Notice](https://developer.arm.com/documentation/102817/0100/?lang=en)와 관련된 내용입니다.

## 1. Stack integrity signature의 필요성

이 값은, NS에서 S로 복귀하는 경우 잘못된 `XXX_RETURN`을 사용하는 것을 막기 위해 추가된 값이다. 

예를 들어, 일반적인 S에서 NS로의 함수 호출 후 리턴하는 과정을 생각해 보자. 이전 글에서 설명한 내용대로 원래는 `BX LR`을 통해 
`PC`에 `FNC_RETURN`이 들어가야 하지만, NS에서 악성 앱이 `LR`의 값을 임의로 `EXC_RETURN`으로 바꿨다고 하자. 
이 경우, `FNC_RETURN`의 stack 대신 exception stack frame이 `FNC_RETURN` stack frame으로 해석되며 최종적으로
integrity signature가 `PC`로 해석되게 된다. 그러나 `0xF`로 시작하는 주소는 NX 주소이기 때문에, 프로세서는 `MemManage` fault를 발생시키게 된다. 

반대의 경우로, NS에서 인터럽트를 처리한 직후 `EXC_RETURN` 대신 `FNC_RETURN`을 사용한다 해 보자. 이 경우, 아까 말했듯 `0xF`로 시작하는 주소는 NX 주소이기 때문에
일반적인 `FNC_RETURN` stack frame이라면 저장된 `LR`이 `0xF`로 시작할 수 없고, 따라서 유효한 stack integrity signature인 `0xFEFA125B`나 `0xFEFA125A`중
어느 하나와도 일치할 수 없게 된다. 따라서 프로세서는 이 과정에서 Secure HardFault를 발생시키게 된다. 

따라서 stack integrity signature를 통해, `FNC_RETURN`을 써야 하는 경우에서 `EXC_RETURN`을 쓰는 경우와 반대 경우 모두 fault를 일으켜
종료됨이 보장된다. 

## 2. Stack sealing

저번 글에서 언급했듯, 일반적으로 state가 전환될 때 (NS에서 S로, 혹은 그 반대로) CPU의 mode는 전환되지 않는다. 즉, thread mode의 NS가 S를 호출하면
S도 thread mode로 호출된다는 뜻이다. 

이를 악용하면, NS와 S의 thread 모드 모두에서 `PSP`를 쓰는 시스템에 대해 다음과 같은 공격 방식을 고려해볼 수 있다. 


<center>
      <img src="/assets/images/posts_img/cs/about-arm-trustzone-m-sw-2/fake_fncret_flow.png" alt="fake_fncret_flow.png">
</center>

1. Thread mode의 NS가 S를 호출
2. 호출된 S는 `svc`를 통해 NS에서 처리되는 인터럽트를 발생시킴. 
3. 호출된 NS의 interrupt handler는 `MSP_NS`를 사용하게 되고, 가짜 `FNC_RETURN`을 사용해 S로 리턴을 시도함.

위에서 말한 stack integrity signature가 이 문제를 해결해줄 것 같지만, 그렇지 않다. 만약 3번 시점에 S의 `MSP`가 비어 있는 상황이라면, 
stack underflow가 발생해 인접한 메모리의 값을 강제로 읽게 될 것이다. (`MSPLIM_S` 검사도 이를 해결하지 못하는데, 이는 스택의 상한값에 대한 검사만 있지 언더플로에는 대비가 되어 있지 않기 떄문이다.)

만약 인접한 메모리를 NS에서 마음대로 접근할 수 있다면, 해당 위치에 fake `LR`을 넣어 S로의 실행 흐름을 임의로 조작할 수 있게 된다. 이를 위해 stack
underflow를 방지할 수 있는 방법이 필요하고, 이를 위해 다음 그림과 같이 stack sealing인 `0xFEF5EDA5`가 활용된다.

<center>
      <img src="/assets/images/posts_img/cs/about-arm-trustzone-m-sw-2/stkseal_overview.png" alt="stkseal_overview.png">
</center>

일반적으로 Armv8-M은 스택이 DWORD로 정렬이 되어 있음을 보장해야 하기 때문에, `0xFEF5EDA5`를 스택의 시작에 두 번 넣게 된다. 이렇게 하면, stack underflow가 
발생하더라도 `LR`에 `0xFEF5EDA5`가 들어가게 되고, `0xF`로 시작하는 주소는 NX이기 때문에 안전하게 MemManage fault가 발생하게 된다. 
