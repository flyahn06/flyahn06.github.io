---
title: "[Tech Analysis] ASLR 심층분석"
excerpt: "ASLR이 켜져 있을 때 stack의 시작주소가 어떻게 난수화되는지 알아보자"

categories:
  - CS
tags:
  - [CS, ASLR, Mitigation]

permalink: /cs/aslr-analysis/

toc: true
toc_sticky: true

date: 2025-07-11
last_modified_at: 2025-07-11
---
최근 CTF를 푸느라 열심히 디버깅을 하다 특이한 사실을 하나 관찰했다. 32비트 바이너리가 제공되는 문제였는데, AAW가 가능하고 NX가 걸려있지 않아 stack에 쉘코드를 삽입 후 그 주소로 점프해 쉘을 열 수 있었다. 그런데 문제는 stack상 주소를 알아낼 수 있는 방법이 전혀 없다는 것이었다. 고민하면서 계속 디버깅을 하다 stack주소가 항상 0xff로 시작한다는 사실을 알게 되었다. 분명 ASLR이 활성화되어있어 stack 주소가 계속해서 바뀌어야 하는데, 첫 바이트가 항상 0xff라는 사실은 굉장히 흥미로웠다. 왜 이런지 보기 위해 ASLR을 조금 깊이 파고들었다.
# 1. Canonical Addressing

이를 이해하기 위해서는 우선 Canonical Addressing을 알아야 한다. 일반적으로 우리는 64비트 운영체제를 사용하기 때문에, adressing을 할 때 64비트 전부를 사용한다고 생각한다. 그러나 현대 CPU는 64비트 전부를 addressing에 사용하지 않고, 대부분의 아키텍쳐는 48비트만 사용한다[^1]. 이런 특성 때문에 등장한 것이 canonical addressing인데, 우선 canonical하다는 것은

**<center>하위 48비트를 제외한 나머지 비트가 MSB와 같은 비트임</center>**
**<center>(혹은) MSB부터 48번째 비트까지 같음</center>**
을 의미한다. 그리고 이런 규칙을 만족하는 주소를 canonical address라고 한다. 간단히 예를 들어 아래와 같은 주소를 가정하자.


```
(1) 0x0000 0f23 af33 1234
(2) 0x0010 f000 0000 1123
(3) 0x0000 7fff ffff ffff
```
위에서 말한 규칙을 잘 생각해보면 다음을 쉽게 알 수 있다.

&nbsp;&nbsp;&nbsp;&nbsp;(1)은 canonical address이다.  
&nbsp;&nbsp;&nbsp;&nbsp;(2)는 canonical address가 아니다. 53번째 비트가 다르기 때문이다.  
&nbsp;&nbsp;&nbsp;&nbsp;(3)은 canonical address다.  

이때 눈여겨봐야 할 주소는 (3)이다. 일반적으로 리눅스는 MSB가 0인 canonical address(즉, MSB부터 48번째 비트까지가 전부 0임)를 유저영역에 할당하고 MSB가 1인 canonical address(즉, MSB부터 48번째 비트까지가 모두 1임)를 커널이 사용한다[^2]. 이 사실을 고려하면 (3)은 유저영역에서 접근가능한 가상주소 중 가장 높은 주소이다.

한 가지 더 알아야 하는 사실은 32비트 바이너리는 64비트 시스템에서 실행될 때 64비트 바이너리들과 다르게 공간을 할당받지 않는다는 것이다. 다른 64비트 바이너리처럼 `0x0000 0000 0000 0000` ~ `0x0000 7fff ffff ffff`까지의 공간을 할당받고, 그 중 32비트에서 접근가능한 공간만 사용한다.

이제 위에서 말한 현상을 이해할 준비가 끝났다.

# 2. 32-bit executable (on 64-bit system)

위에서 말했듯, 우선 바이너리는 운영체제로부터 `0x0000 7fff ffff ffff`까지의 공간을 할당받는다. 이때 ASLR이 켜져 있다면 stack 공간 형성 시 다음과 같은 커널 함수의 영향을 받는다.

```c
// Def. in arch/arm64/include/asm/elf.h, line 191 (@v6.16-rc3)
#define STACK_RND_MASK			(test_thread_flag(TIF_32BIT) ? \
						0x7ff >> (PAGE_SHIFT - 12) : \
						0x3ffff >> (PAGE_SHIFT - 12))

// Def. in mm/util.c, line 340 (@v6.16-rc3)
static unsigned long randomize_stack_top(unsigned long stack_top)
{
	unsigned long random_variable = 0;

	if ((current->flags & PF_RANDOMIZE) &&
		!(current->personality & ADDR_NO_RANDOMIZE)) {
		random_variable = get_random_long();
		random_variable &= STACK_RND_MASK;
		random_variable <<= PAGE_SHIFT;
	}
#ifdef CONFIG_STACK_GROWSUP
	return PAGE_ALIGN(stack_top) + random_variable;
#else
	return PAGE_ALIGN(stack_top) - random_variable;
#endif
}
```

이 함수는 유저 메모리 영역의 최상단 주소에서 일정 난수를 빼는 방식으로 stack의 주소를 난수화하는데, 이때 유저가 할당받은 메모리 영역에서 빼는 난수에 `0x0000 3fff ff00 0000` 마스크가 씌워져 항상 stack의 시작 주소는 최소한 `0x0000 3fff ff00 0000`보다는 큼이 보장된다. 이때 32bit 바이너리는 하위 4바이트만 사용하기 때문에 stack의 시작 주소는 항상 `0xff` 이다. 하위 12비트는 page 단위 정렬 때문에 항상 0으로 고정된다. 그림으로 표현하면 다음과 같다.
![aslr_32bit.jpg](/assets/images/posts_img/cs/aslr-analysis/aslr_32bit.jpg)

# 2. 64-bit
위의 코드로부터 여기서는 생성되는 난수에 `0x0000 7ff0 0000 0000`마스크가 씌워져 stack의 시작 주소가 최소한 `0x0000 7ff0 0000 0000`보다 큼이 보장되어 있다. 마찬가지로 하위 12비트는 page 단위 정렬 때문에 항상 0으로 고정된다. 마찬가지로 그림으로 표현하면 다음과 같다.
![aslr_64bit.jpg](/assets/images/posts_img/cs/aslr-analysis/aslr_64bit.jpg)

# 결론
처음 이야기한 상황처럼 stack에 AAW 프리미티브롤 통해 쉘코드를 넣은 후 그 주소로 리턴하려면 brute forcing이 무조건 있어야 하는데, 일반적으로 ASLR 때문에 거의 불가능해 보인다. 그러나 위에서 살펴본 canonical addressing과 randomize_stack_top() 때문에 32비트 바이너리라면 맞춰야 하는 주소가 1.5바이트에 불과하다. 즉 성공 확률이 1/4096으로 꽤 높은 편이다. 더군다나 stack의 크기가 꽤 크다는 점까지 고려하면 확률이 더 높이지기 때문에, 충분히 시도해볼 가치가 있다. 

[^1]: ARMv8.2-LPA 아키텍쳐는 이름에서 말하듯 (Large Physical Address), 52비트까지 addressing을 지원한다.
[^2]: 실제로 커널 디버깅을 하다 보면 주소가 항상 0xffff f...로 시작하는 것을 볼 수 있다.