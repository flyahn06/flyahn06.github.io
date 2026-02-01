---
title: "[CS] TrustZone for Cortex-M (SW)"
excerpt: "Cortex-M 아키텍처에서의 TrustZone을 알아보자 (2)"

categories:
  - CS
tags:
  - [arm, trustzone, tz-m, tf-m, trustedfirmware, trustedfirmare-m, cortex-m]

permalink: /cs/arm-trustzone-m-sw/

toc: true
toc_sticky: true

date: 2026-02-01
last_modified_at: 2026-02-01
---

> 이 글은 Armv8-M Security Extension User Guide Version 1.0을 읽고 정리한 글입니다.  
> 원 문서는 [여기](https://documentation-service.arm.com/static/67936b5127eda361ad4e5c0d)에서 볼 수 있습니다.

> 이 글은 [이전 글](/cs/arm-trustzone-m-hw)을 바탕으로, 이를 활용하기 위한 소프트웨어적인 가이드 중 특히 Function Call을 집중적으로 다룹니다.
> 보다 깊은 내용은 위의 문서를 참고하시기 바랍니다.

> 이 글은 ARM Assembly에 대한 기본적인 이해를 전제로 합니다.

# 1. Registers

레지스터에 담긴 정보들에 대한 접근은 그 자체로 보안에 있어 중요하고, 따라서 레지스터에도 다음과 같은 속성이 적용된다.

* Common access: 이 속성의 레지스터는 NS와 S 모두에서 접근할 수 있다.
* Secure access only: 이 속성의 레지스터는 S에서만 접근이 가능하다. 
* Banked registers: 이 속성의 레지스터는 NS와 S 모두에서 접근할 수 있지만, 서로 다르게 구현되어 있어 각자 다른 값을 가질 수 있다.

## 1-1. GPRs

ARMv8-M 아키텍처는 `R0`부터 `R15`까지 16개의 범용 레지스터를 사용한다. 단, 몇 가지 레지스터들은 특수한 용도러 쓰인다.

* `R13`은 `SP` 레지스터로 현재 스택 포인터를 저장한다.
* `R14`는 `LR`(Link Register) 레지스터로 함수 호출 시 복귀할 주소를 담고 있다.
* `R15`는 `PC`로 프로그램 카운터를 저장한다.

`R13`을 제외한 모든 레지스터는 bank되지 않은 레지스터이므로, 모든 상태에서 접근할 수 있고 상태 전환 이후에도 값이 동일하게 유지됨이 보장된다.
이를 통해 S의 함수 호출 시 인자를 전달하거나 S에서 NS로 리턴값을 전달하는 등이 가능해진다. 그러나 만약 레지스터에 저장된 값이 민감한 정보라면,
NS로 스위칭하기 이전에 값을 지우는 작업이 필요하다.

## 1-2. SPRs

예외 처리에 쓰이는 `PRIMASK`, `FAULTMASK`, `BASEPRI`과 같은 특수 목적 레지스터의 값을 읽거나 변경할 때는
`MOV` 인스트럭션 대신 `MRS`, `MSR`, `VMSR`, `CPS`등의 인스트럭션을 써야 한다. 또한 이 레지스터들은 전부 bank된 레지스터이므로, 
NS와 S에서 접근할 때 각자 다른 값을 가질 수 있다. 그러나 예외적으로 S에서는 NS의 특수 목적 레지스터에 접근해 이 값을 볼 수 있다. 
예시는 다음과 같다.

```nasm
MRS R0, PRIMASK       ; R0에 현재 상태의 PRIMASK 레지스터의 값을 복사함
MRS R0, PRIMASK_NS    ; R0에 NS의 PRIMASK 레지스터의 값을 복사함
```

## 1-3. System Control Registers

System Control Space(SCS)는 프로세서의 설정을 바꾸거나 주변 기기들을 조작하기 위한 레지스터를 제공한다. (DMA같은 느낌인가??)
SCS는 항상 주소 `0xE000E000`에 있고, 이 영역은 Exempt이며, bank된 영역이기 때문에 S와 NS 전부에서 접근이 가능하다. 
이 영역에서는 다음과 같은 유닛을 설정하고 제어할 수 있다. 

* NVIC(Nested Vectored Interrupt Controller)
* MPU(Memory Protection Unit)
* SCP(System Control Block)
* 주변 장치

SPR에서 bank된 레지스터일지라도 S는 NS의 레지스터를 볼 수 있었는데, SCS도 가능하다. S 상태에서 `0xE002E000` 주소에 접근하면 NS의
SCS를 볼 수 있고, 수정도 할 수 있다. 이를 간단하게 그림으로 표현하면 다음과 같다.

<center>
    <a href="/assets/images/posts_img/cs/about-arm-trustzone-m-sw/scs_overview.png">
        <img src="/assets/images/posts_img/cs/about-arm-trustzone-m-sw/scs_overview.png" alt="scs_overview.png">
    </a>
</center>

# 2. Memory Configuration

이전 글에서, vender가 결정하는 IDAU와 달리 SAU는 프로그래밍이 가능하다고 했었다. 
이 절에서는 SAU를 프로그래밍하는 방법과 MPU를 프로그래밍하는 방법을 다룬다.

## 2-1. SAU

SAU는 일반적으로 S 상태에서 프로그래밍이 가능하며, 앞 절에서 언급한 SCS를 통해 프로그래밍이 가능하다. 

| 주소         | 레지스터     | 설명                            |
|------------|----------|-------------------------------|
| 0xE000EDD0 | SAU_CTRL | SAU 컨트롤 레지스터                  |
| 0xE000EDD4 | SAU_TYPE | SAU 타입 레지스터                   |
| 0xE000EDD8 | SAU_RNR  | SAU Region Number 레지스터        |
| 0xE000EDDC | SAU_RBAR | SAU Region Base Address 레지스터  |
| 0xE000EDE0 | SAU_RLAR | SAU Region Limit Address 레지스터 |
{: style="display: table; margin: 0 auto; width: auto;"}

프로그래밍하는 방법은 다음과 같다.

1. `SAU_TYPE` 레지스터를 읽어 남은 영역의 개수를 확인한다.
2. `SAU_RNR` 레지스터에 값을 써 설정하고 싶은 영역을 선택한다.   
  예를 들어, 8개의 영역을 지원하는 프로세서에서 `0x3`을 써 넣으면 3번 영역이 선택된다.
3. `SAU_RBAR`, `SAU_RLAR`에 값을 차례로 써 넣어 영역을 정의한다.   
  이때 `SAU_RLR`에 있는 NSC 비트와 ENABLE 비트를 조작해 4가지 영역 중 하나로 해당 영역의 속성을 결정할 수 있다. 
4. `SAU_CTRL.ENABLE` 비트에 1을 써 SAU를 활성화한다.

## 2-2. MPU

MPU를 프로그래밍하는 방법은 이 글에서 다루지 않는다.

# 3. Function Calls

## 3-1. State Transition

함수 호출은 S와 NS 경계를 양방향으로 넘나들 수 있다. 즉 NS에서 S로의 함수 호출도 가능하고, 그 반대인 S에서 NS로의 함수 호출도 가능하다. 
단 보안성을 위해 따라야 하는 규칙이 존재한다.

이때 Cortex-M Security Extension은 호환성을 위해 S 이미지를 빌드할 때만 CMSE 툴체인을 필요로 하고, 
NS를 빌드할 때는 일반적인 툴체인을 사용할 수 있도록 했다.

> 여기서는 자세히 설명하지 않았지만, 경계를 넘을 때 CPU의 mode(handler / thread)는 바뀌지 않는다.

## 3-2. NS에서 S로의 호출

> 기초적인 이해를 위해 내용을 많이 간소화했기 때문에, 더 자세한 내용은
> 도입에서 말씀드린 문서를 참고하시기 바랍니다.

### 3-2-1. In C

반드시 CMSE 툴체인을 사용해야 하며, 필요한 속성들을 사용하기 위해 `arm_cmse.h`를 include해야 한다.

NS에서 호출할 수 있는 Secure API 함수를 만들기 위해서는 함수 선언부에 `__attribute__((cmse_nonsecure_entry))`를 붙여야 한다.
이 속성이 붙으면, 컴파일러는 다음과 같은 일을 하게 된다.

1. `SG`를 포함한 veneer를 생성함
2. return 직전 민감한 데이터를 들고 있는 레지스터를 초기화함
3. return이 `BXNS` 인스트럭션으로 수행되게 함

예시는 다음과 같다.

```c
// -- secure_interface.c --
#include <arm_cmse.h>
#include "secure_interface.h"

int __attribute__((cmse_nonsecure_entry)) entry1(int x) {
  ...
}
```

```c
// -- secure_interface.h --
#include "secure_interface.h"
int entry1(int x);  // 일반적인 함수처럼 프로토타이핑하면 됨
```

이렇게 만들어진 함수는 NS에서 일반 함수 호출하듯 다음과 같이 사용할 수 있다. (이때는 CMSE 툴체인을 사용할 필요가 없다)

```c
#include "secure_interface.h"

int main() { 
  ...
  entry1(10);
  ... 
}
```

### 3-2-1. In assembly

전반적인 흐름을 어셈블리로 정리하면 다음 그림과 같다.

<center>
    <a href="/assets/images/posts_img/cs/about-arm-trustzone-m-sw/fc_ns2s_asm.png">
        <img src="/assets/images/posts_img/cs/about-arm-trustzone-m-sw/fc_ns2s_asm.png" alt="fc_ns2s_asm.png">
    </a>
</center>

1. NS의 caller는 일반적인 함수 호출하듯 `BL`을 사용해 NSC에 존재하는 veneer 함수를 호출함 (이 함수는 자동으로 만들어진다고 위에 언급했다.)
2. veneer는
   1. `SG` 인스트럭션을 사용해 상태를 S로 전환함. (`SG`가 NSC 이외의 영역에서 수행되면 `NOP`와 같은 역할을 함)
   2. `B.W`를 사용해 함수 본체로 흐름을 옮김.
     이때, 우리가 만든 함수는 veneer 함수와 구분하기 위해 항상 `__acle_se_`라는 접두어가 붙음
3. 함수 실행이 끝나면, `BXNS`를 사용해 S에서 NS로의 상태 전환과 동시에 NS의 caller로 복귀함.

만약 NS가 올바른 entry가 아닌 (즉, `SG`로 시작하지 않는) 주소로 점프하게 되면, Secure HardFault가 발생하게 된다.

## 3-3. S에서 NS로의 호출

### 3-3-1. In C

보통 함수 포인터를 받아 호출하기 때문에, 이 함수 포인터를 `__attribute__((cmse_nonsecure_call))` 속성이 붙은 함수 포인터로 casting한 후
`cmse_nsfptr_create()`를 사용해 호출해야 한다. 예시 코드는 다음과 같다. 

```c
// Secure

typedef int __attribute__((cmse_nonsecure_call)) nsfunc(int);
nsfunc *ns_callback = 0;

// NS에서 S를 호출해 ns_callback을 세팅해줘야 하기 때문에,
// 위애서 말했듯 cmse_nonsecure_entry 속성이 붙어 있다는 것에 주의하자.
int __attribute__((cmse_nonsecure_entry)) ns_callable_fn(nsfunc *callback) {
    ns_callback = (nsfunc *)cmse_nsfptr_create(callback);
    ...
}

void secure_fn(void) {
    // ns_callable_fn()이 반드시 호출된 후 실행되어야 함
    ns_callback(0xdeadbeef);
    ...    
}
```

NS에서는 다음과 같이 짜면 된다.

```c
#include "secure_interface.h"

int func_ns(int x) {
    return x + 1;
}

int main() {
    ns_callable_fn(func_ns);
    ...
}
```

이렇게 하면, S에서 NS로 함수 호출이 가능해진다. 

### 3-3-1. In assembly

retaddr과 여러 레지스터의 무결성을 보장하기 위해, 일반적인 함수 호출보다 조금 더 복잡한 방법을 따른다.
전반적인 흐름을 어셈블리로 정리하면 다음 그림과 같다.

<center>
    <a href="/assets/images/posts_img/cs/about-arm-trustzone-m-sw/fc_s2ns_asm.png">
        <img src="/assets/images/posts_img/cs/about-arm-trustzone-m-sw/fc_s2ns_asm.png" alt="fc_s2ns_asm.png">
    </a>
</center>

1. 함수 실행 전, S 함수는 다음 레지스터에 해당하지 않는 모든 레지스터의 값을 저장하고 지워야 한다.
   * `LR`
   * 함수 호출 시 사용되는 인자를 가지고 있는 레지스터
   * 특별히 민감한 정보라고 생각되지 않는 레지스터
2. S의 caller는 `BLXNS`을 사용해 함수를 호출한다.   
  이때, 호출하고자 하는 함수가 NS 영역이 아닌 S 영역에 존재한다면 아래 단계를 모두 건너뛰고 일반적인 `BL`처럼 동작한다.
3. `BLXNS`는
    1. Secure stack에 존재하는 `FNC_RETURN`의 stack frame에 LR 레지스터 등을 push한다.   
     이렇게 하면 `LR` 레지스터 값 조작을 통해 `PC`를 탈취하는 공격을 방어할 수 있다. 
    2. `LR` 레지스터에 `FNC_RETURN`을 저장한다.
   3. NS로 state를 전환함과 동시에 NS 영역의 대상 함수로 실행 흐름을 옮긴다.
4. NS 함수 실행이 끝나면, 일반적인 복귀를 수행한다. 이때 `LR`에 `FNC_RETURN`이 저장되어 있기 때문에 이 함수로 복귀하게 된다.
5. `FNC_RETURN`은 여러 검사를 수행한 후, 저장된 값에 문제가 없다고 판단되면 S로 state 전환 후 저장된 주소로 복귀한다. 
