---
title: "[Kernel Analysis] MM - Page Table 분석"
excerpt: "4-Level Page Table이 어떻게 구현되고 동작하는지 알아보자"

categories:
  - Kernel Analysis
tags:
  - [Kernel, Memory Management, Page Table, 4-Level Page Table]

permalink: /kernel-analysis/page-table-analysis/

toc: true
toc_sticky: true

date: 2025-07-23
last_modified_at: 2025-07-23
---

> Canonical Addressing에 대한 지식이 선행되어야 합니다.  
> 이에 대한 내용은 [이 글](/cs/aslr-analysis/#1-canonical-addressing)을 참고하세요. 

모든 프로세스가 물리 주소를 사용한다고 해 보자. 프로세스 A가 실수로 자신이 할당받은 공간이 아니라 프로세스 B가 할당받은 공간에 값을 쓴다면,
상황에 따라 프로세스 B애 치명적인 오류가 일어날 수 있다. 또는 만약 프로세스 A가 자신이 할당받은 공간이 아니라 프로세스 B가 할당받은 공간의 값을 읽는다면,
상황에 따라 심각한 보안상의 문제가 생길 수 있다. (프로세스 B가 사용자가 입력한 비밀번호를 저장한 공간에 A가 마음대로 접근할 수 있다고 생각해 보자.) 

이런 상황을 방지하기 프로세스는 시작될 때 고유한 address space를 부여받는다. 32bit 시스템의 경우 프로세스가 사용할 수 있는 논리적 주소는 `0x00000000 ~ 0xffffffff`이고,
64bit 시스템의 경우는 `0x0000 0000 0000 0000 ~ 0xffff ffff ffff ffff`이다[^1]. 이런 방식을 사용하면 프로세스 A가 `0x800010`에 값을 쓴다고 해서, 
프로세스 B의 `0x800010`에 있는 값이 바뀌는 것이 아니다. 둘은 논리적 주소만 같을 뿐 물리적 주소는 완전히 다르기 때문이다. 이렇게 하면 프로세스는 독립성을 보장받을 수 있다.

위에서 봤듯 프로세스는 이렇게 물리적 주소가 할당된 가상 메모리를 이용하지만, 프로세서는 직접적인 물리적 주소를 기반으로 동작한다. 
즉 프로세스가 가상 메모리 주소에 접근할 때 프로세서가 요청을 처리하기 전 가상 메모리 주소를 물리 메모리 주소로 변환해야 하는데, 이를 위해 사용하는 것이 page table이다. 

리눅스의 페이지 테이블은 4단계로 구성된다. 이렇게 페이지 테이블을 계층적으로 나눠 관리하면, 큰 물리 메모리도 단일 계층의 페이지 테이블을 사용했을 때보다 적은 용량으로
관리할 수 있는 이점이 생긴다. 이 문서에서는 x86-64 아키텍쳐를 기반으로 리눅스의 4계층 페이지 테이블을 설명한다.

# 1. x86-64 Virtual Address

x86-64 아키텍쳐에서 사용하는 가상주소는 다음과 같이 나눌 수 있다. 

<center>
    <img src="/assets/images/posts_img/kernel/kernel-analysis/page-table/virtual_address_layout.jpg" alt="virtual_address_layout.jpg">
</center>

여기서 각각의 영역에 대한 설명은 다음과 같다.

- `PGD`: Page Global Directory상의 offset 값이다.
- `PUD`: Page Upper Directory상의 offset 값이다.
- `PMD`: Page Middle Directory상의 offset 값이다.
- `PTE`: Page Table Entry상의 offset 값이다.

# 2. 변환 과정

프로세스가 `0x0000 7f23 abcd 1234`에 접근하려고 한다고 하자. MMU는 이 가상 주소로부터 앞서 보았던 규칙에 따라 `PGD`, `PUD`, `PMD`, `PTE`, `물리 offset` 값을
파싱한다. 파싱하면 다음과 같다.

<center>
    <img src="/assets/images/posts_img/kernel/kernel-analysis/page-table/resolve_ex.jpg" alt="resolve_ex.jpg" width="70%">
</center>

- 물리 Offset: `0b0010 0011 0100` = `0x234` = 564
- PTE: `0b0 1101 0001` = `0xD1` = 209
- PMD: `0b10 1011 110` = `0x15E` = 350
- PUD: `0b010 0011 10` = `0x8E` = 142
- PGD: `0b0111 1111 0` = `0xFE` = 254

이때 PGD의 물리 주소는 `CR3` 레지스터에 저장되어 있다. MMU는 다음과 같은 과정을 거쳐 가상 주소를 물리 주소로 바꾼다.

1. PGD의 254번 인덱스에 접근해 주소를 읽는다.  
`읽을 물리 주소 = CR3 + 254 * 0x8`
2. PGD에서 읽은 주소는 PUD의 물리 주소이므로, 이로부터 PUD의 142번 인덱스에 접근해 주소를 읽는다.  
`읽을 물리 주소 = PGD + 142 * 0x8`
3. PUD에서 읽은 주소는 PMD의 물리 주소이므로, 이로부터 PMD의 350번 인덱스에 접근해 주소를 읽는다.  
`읽을 물리 주소 = PUD + 350 * 0x8`
4. PMD에서 읽은 주소는 PTE의 물리 주소이므로, 이로부터 PTE의 209번 인덱스에 접근해 주소를 읽는다.  
`읽을 물리 주소 = PMD + 350 * 0x8`
5. 이제 물리 페이지(프레임)의 주소를 알아냈으므로, 여기에 물리 offset 값을 더하면 최종 물리 주소가 나온다.  
`최종 물리주소 = physical page address + 564`

전체 과정을 그림으로 표현하면 다음과 같다.

<center>
    <img src="/assets/images/posts_img/kernel/kernel-analysis/page-table/resolve_full.jpg" alt="resolve_full.jpg">
</center>

참고로 PTE의 구조와 각 필드에 대한 설명은 다음과 같다.


<center>
    <img src="/assets/images/posts_img/kernel/kernel-analysis/page-table/pte_description_fig.png" alt="pte_description_fig.png">
</center>

<center>
    <img src="/assets/images/posts_img/kernel/kernel-analysis/page-table/pte_description_table.png" alt="pte_description_table.png">
</center>

설명을 읽다 보면 흥미로운 사실들을 많이 알 수 있다. Userland에서 항상 궁금했던 접근 권한이 어떻게 설정되는지, 읽기/쓰기 권한이 어떻게 설정되는지부터 시작해 NX가
어떻게 구현되어 있는지도 볼 수 있다(참고로 NX 비트는 63번째 비트이며, 표에는 없지만 그림에 XD라는 이름으로 존재한다). 여기서 눈여겨봐야 할 것은 `P` 비트인데, 만약
PTE에 접근했을 때 `P` 비트가 0으로 설정되어 있다면 커널은 Page Fault를 발생시킨다.

# 3. Page Fault

위에서 언급했듯 막상 page table entry에 접근하니 `P(present)=0`인 경우가 있을 수 있다[^2]. 
이때 커널은 page fault를 발생시키며, 이는 `do_page_fault()` 함수가 처리한다.

```c
DEFINE_IDTENTRY_RAW_ERRORCODE(exc_page_fault)
{
	unsigned long address = read_cr2();
	...
	instrumentation_begin();
	handle_page_fault(regs, error_code, address);
	instrumentation_end();

	irqentry_exit(regs, state);
}
```

여기서 호출되는 `handle_page_fault()`함수는

```c
static __always_inline void
handle_page_fault(struct pt_regs *regs, unsigned long error_code,
			      unsigned long address)
{
	trace_page_fault_entries(regs, error_code, address);

	if (unlikely(kmmio_fault(regs, address)))
		return;

	/* Was the fault on kernel-controlled part of the address space? */
	if (unlikely(fault_in_kernel_space(address))) {
		do_kern_addr_fault(regs, error_code, address);
	} else {
		do_user_addr_fault(regs, error_code, address);
		...
```

다음과 같이 어느 공간에서의 page fault 상황인지 파악한 후 그에 맞는 동작을 수행한다. 보통 커널 공간에서의 page fault는 panic이기 때문에 user 공간에서의 page fault를 처리하는 `do_user_addr_fault()`를 따라가다 보면 결국 `__handle_mm_fault()`에 도달하게 된다. 이 함수는

1. Invalid Reference인지 확인한다(실제 존재하지 않는 주소에 접근하려고 했거나 `r--` 구역에 쓰려고 하는 등).
    1. Invalud Reference라면 프로세스를 중지시킨다.
    2. Invalid Reference가 아니라면 물리 메모리에 올라와있지 않은 것이기 때문에 디스크에서 찾아 swap in 해주면 된다. (`do_swap_page()`)
2. 필요한 page를 디스크에서 찾는다.
3. 물리 메모리에서 빈 frame을 찾는다. 빈 frame이 없다면 기존의 frame 중 하나를 swap out한다[^3].
4. 확보된 frame에 page를 올린다.
5. page table의 valid bit을 수정한다.
6. page fault를 발생시킨 코드를 다시 시작한다.

위와 같은 역할을 하며, 이런 동작을 통해 demand paging이 구현된다.

[^1]: 물론 프로세스가 할당받은 주소공간 전부를 사용할 수 있는 것은 아니다. 상위 영역은 커널이 사용한다.
[^2]: 아키텍쳐마다 다르나, x86_64는 Present Bit, ARM계열은 Valid Bit이라고 부른다.
[^3]: 이때 어떤 frame을 버릴지 선택하는 알고리즘은 여러 종류가 있다. 이는 나중에 다뤄 볼 예정이다.