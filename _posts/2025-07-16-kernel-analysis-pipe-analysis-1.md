---
title: "[Kernel Analysis] IPC - pipe.c 분석 (1)"
excerpt: "pipe가 어떻게 열리고, write()와 read()가 어떻게 정의되는지 알아보자"

categories:
  - Kernel Analysis
tags:
  - [IPC, pipe]

permalink: /kernel-analysis/pipe-analysis-1/

toc: true
toc_sticky: true

date: 2025-07-16
last_modified_at: 2025-07-16
---
# 1. pipe 생성

우선 pipe가 생성될 때 불리는 syscall의 원형을 살펴보면

```c
// Def. in fs/pipe.c, line 1043 (@linux-5.10.239)
SYSCALL_DEFINE2(pipe2, int __user *, fildes, int, flags)
{
	return do_pipe2(fildes, flags);
}

SYSCALL_DEFINE1(pipe, int __user *, fildes)
{
	return do_pipe2(fildes, 0);
}
```

`do_pipe2()`를 호출하는 것을 알 수 있다. 이 함수로 넘어가면

```c
static int do_pipe2(int __user *fildes, int flags)
{
	struct file *files[2];
	int fd[2];
	int error;

	error = __do_pipe_flags(fd, files, flags);
	if (!error) {
		if (unlikely(copy_to_user(fildes, fd, sizeof(fd)))) {
			fput(files[0]);
			fput(files[1]);
			put_unused_fd(fd[0]);
			put_unused_fd(fd[1]);
			error = -EFAULT;
		} else {
			fd_install(fd[0], files[0]);
			fd_install(fd[1], files[1]);
		}
	}
	return error;
}
```

위와 같은 코드를 볼 수 있고, 흐름을 따라가다 보면 다음과 같은 역할을 하고 있음을 알 수 있다.

1. file 구조체 2개 할당
2. inode 구조체 할당 / 앞서 할당한 file 구조체 설정
3. 빈 영역의 파일 디스크립터 2개 할당
4. 앞서 할당한 파일 디스크립터 설정

---

## 1-1. file 구조체 2개 할당

```c
static int do_pipe2(int __user *fildes, int flags)
{
	struct file *files[2];
```

## 1-2. inode 구조체 할당 / file 구조체 설정

`do_pipe2()`에서 맨 처음 실행되는 `__do_pipe_flags()`에서 호출하는 `create_pipe_file()`를 따라들어가면

```c
int create_pipe_files(struct file **res, int flags)
{
	struct inode *inode = get_pipe_inode();
	...
	f = alloc_file_pseudo(inode, pipe_mnt, "",
				O_WRONLY | (flags & (O_NONBLOCK | O_DIRECT)),
				&pipefifo_fops);
	
	f->private_data = inode->i_pipe;
	
	res[0] = alloc_file_clone(f, O_RDONLY | (flags & O_NONBLOCK),
				  &pipefifo_fops);
	...
	res[0]->private_data = inode->i_pipe;
	res[1] = f;
	stream_open(inode, res[0]);
	stream_open(inode, res[1]);
	return 0;
} // 일부생략
```

위와 같이 `get_pipe_inode()`를 통해 inode 구조체를 하나 할당받고 있는 것을 볼 수 있다. 이후 `alloc_file_pseduo()`, `alloc_file_clone()`를 통해 파일 2개를 만들고 있는데, 하나는 `O_RDONLY`로 만들고 하나는 `O_WRONLY`로 만든다. 이로부터 파이프에 읽거나 쓸 때 사용하는 파일이 분리되어 있음을 알 수 있다. `get_pipe_inode()`를  따라들어가면

```c
static struct inode * get_pipe_inode(void)
{
	struct inode *inode = new_inode_pseudo(pipe_mnt->mnt_sb);
	struct pipe_inode_info *pipe;

	inode->i_ino = get_next_ino();
	pipe = alloc_pipe_info();

	inode->i_pipe = pipe;
	pipe->files = 2;
	pipe->readers = pipe->writers = 1;
	inode->i_fop = &pipefifo_fops;
	...

	return inode;
	...
}
```

위와 같이 inode를 할당받은 후 `pipe_inode_info` 구조체를 할당받는다. 이를 위해 실행되는 `alloc_pipe_info()`를 살펴보면

```c
struct pipe_inode_info *alloc_pipe_info(void)
{
	struct pipe_inode_info *pipe;
	unsigned long pipe_bufs = PIPE_DEF_BUFFERS;
	struct user_struct *user = get_current_user();
	unsigned long user_bufs;
	unsigned int max_size = READ_ONCE(pipe_max_size);

	pipe = kzalloc(sizeof(struct pipe_inode_info), GFP_KERNEL_ACCOUNT);
	...
	pipe->bufs = kcalloc(pipe_bufs, sizeof(struct pipe_buffer),
			     GFP_KERNEL_ACCOUNT);
	...
}
```

위와 같이 pipe용 버퍼도 할당받는 것을 알 수 있다. 이때 버퍼는 page 단위이며, `PIPE_DEF_BUFFERS`는 pipe_fs_i.h에 정의된 상수로 값이 16이다. 이로부터 하나의 버퍼만 사용하는 것이 아닌 16개의 버퍼를 사용하고 있음을 알 수 있다. 다만 상황에 따라 버퍼의 수를 줄이기도 하는데, 줄어들어도 항상 2의 제곱수개의 버퍼를 사용한다. 최소 버퍼 개수는 `PIPE_MIN_DEF_BUFFERS`로, 값이 2이다.

```c
	if (pipe_bufs * PAGE_SIZE > max_size && !capable(CAP_SYS_RESOURCE))
		pipe_bufs = max_size >> PAGE_SHIFT;
	...
	if (too_many_pipe_buffers_soft(user_bufs) && pipe_is_unprivileged_user()) {
		user_bufs = account_pipe_buffers(user, pipe_bufs, PIPE_MIN_DEF_BUFFERS);
		pipe_bufs = PIPE_MIN_DEF_BUFFERS;
	}
```

이후 readers와 writers가 1로 초기화되며, files는 2로 초기화된다 (위에서 봤듯 pipe에서 read, pipe에 write하는 fd를 별도로 관리함). 또한 `i_fop`에 `pipefifo_fops`를 할당하는 것올 볼 수 있는데, 여기서 fop는 file operation의 약자이다. `pipefifo_fops`를 살펴보면

```c
const struct file_operations pipefifo_fops = {
	.open		= fifo_open,
	...
	.read_iter	= pipe_read,
	.write_iter	= pipe_write,
	...
};
```

위와 같다.

## 1-3. 빈 영역의 파일 디스크립터 2개 할당

다시 `__do_pipe_flags()`로 돌아오면

```c
static int __do_pipe_flags(int *fd, struct file **files, int flags)
{
	...
	error = get_unused_fd_flags(flags);
	if (error < 0)
		goto err_read_pipe;
	fdr = error;

	error = get_unused_fd_flags(flags);
	if (error < 0)
		goto err_fdr;
	fdw = error;
	...
```

다음과 같이 `get_unused_fd_flags()`를 통해 파일 디스크립터를 받아오는 것을 볼 수 있다. 이 함수는 file.h에 존재하며, 말 그대로 사용하지 않는 파일 디스크립터를 하나 가져오는 역할을 한다.

## 1-4. 파일 디스크립터 설정

`__do_pipe_flags()` 에서 나와 다시 `do_pipe2()`로 돌아가면 `copy_to_user()`을 사용해 할당해둔 파일 디스크립터들을 유저 공간으로 복사한다. 이후 복사가 된 것을 확인하고 `fd_install()`을 통해 유저에게 넘긴 파일 디스크립터들을 위에서 할당받고 설정해둔 파일 구조체와 연결해주므로써 pipe의 동작이 시작된다.

```c
	error = __do_pipe_flags(fd, files, flags);
	if (!error) {
		if (unlikely(copy_to_user(fildes, fd, sizeof(fd)))) {
			...
		} else {
			fd_install(fd[0], files[0]);
			fd_install(fd[1], files[1]);
		}
	}
```

# 2. write to pipe

## 2-1. 인자 분석

pipe에 쓰기를 수행하는 `pipe_write()`의 정의를 살펴보면 다음과 같다.

```c
static ssize_t
pipe_write(struct kiocb *iocb, struct iov_iter *from)
```

여기서 첫 번째 인자로 받는 `struct kiocb`의 정의는 fs.h에서 찾아볼 수 있고, 정의는 다음과 같다.

```c
struct kiocb {
	struct file		*ki_filp;

	/* The 'ki_filp' pointer is shared in a union for aio */
	randomized_struct_fields_start

	loff_t			ki_pos;
	void (*ki_complete)(struct kiocb *iocb, long ret, long ret2);
	void			*private;
	int			ki_flags;
	u16			ki_hint;
	u16			ki_ioprio; /* See linux/ioprio.h */
	union {
		unsigned int		ki_cookie; /* for ->iopoll */
		struct wait_page_queue	*ki_waitq; /* for async buffered IO */
	};

	randomized_struct_fields_end
};
```

이 멤버들 중 `pipe_write()`가 사용하는 변수는 `ki_filp` 하나로, 현재 열린 파일을 가리키는 포인터이다. 이때 이 포인터는 당연히 파이프를 열 때 할당받은 쓰기 전용 파일일 것이다.

두 번째 인자는 `iov_iter` 구조체로, uio.h에서 찾아볼 수 있으며 정의는 다음과 같다.

```c
struct iov_iter {
	/*
	 * Bit 0 is the read/write bit, set if we're writing.
	 * Bit 1 is the BVEC_FLAG_NO_REF bit, set if type is a bvec and
	 * the caller isn't expecting to drop a page reference when done.
	 */
	unsigned int type;
	size_t iov_offset;
	size_t count;
	union {
		const struct iovec *iov;
		const struct kvec *kvec;
		const struct bio_vec *bvec;
		struct pipe_inode_info *pipe;
	};
	union {
		unsigned long nr_segs;
		struct {
			unsigned int head;
			unsigned int start_head;
		};
	};
};
```

이 구조체에서 중요한 멤버는 다음과 같다.

- `iov`: 입출력에 사용할 버퍼의 정보를 담고 있는 배열이다. `iovec`의 정의는 다음과 같다.

    ```c
    struct iovec
    {
    	void __user *iov_base;	/* BSD uses caddr_t (1003.1g requires void *) */
    	__kernel_size_t iov_len; /* Must be size_t (1003.1g) */
    };
    ```

- `count`, `head`등은 변수 이름으로부터 직관적으로 알 수 있다.

## 2-2. 동작 분석

우선 `from`으로부터 쓸 바이트 수를 읽고, 0인 경우 바로 종료한다. 만약 0이 아니라면 pipe에 락을 걸고 쓰기 작업을 시작한다.

```c
	struct file *filp = iocb->ki_filp;
	struct pipe_inode_info *pipe = filp->private_data;
	size_t total_len = iov_iter_count(from);
	...
	if (unlikely(total_len == 0))
		return 0;

	__pipe_lock(pipe);
```

이후 readers 멤버를 검사해 만약 pipe에 readers가 없다면 바로 종료한다. 이는 POSIX 표준에 따른 것으로, reader가 없을 떄는 파이프가 끊어진 상태로 간주해 쓰지 않고 오류를 발생시키는 것이 원칙이다.

```c
	if (!pipe->readers) {
		send_sig(SIGPIPE, current, 0);
		ret = -EPIPE;
		goto out;
	}
```

다음으로 pipe가 비었는지 검사해, 비지 않았다면 써야 하는 데이터를 buffer 뒤로 이어붙이기 위한 작업을 수행한다. 코드를 분석해보면 다음과 같다.

```c
	head = pipe->head;                                                 // (1)
	was_empty = pipe_empty(head, pipe->tail);
	chars = total_len & (PAGE_SIZE - 1);                               // (2)
	if (chars && !was_empty) {
		unsigned int mask = pipe->ring_size - 1;                         // (3)
		struct pipe_buffer *buf = &pipe->bufs[(head - 1) & mask];
		int offset = buf->offset + buf->len;

		if ((buf->flags & PIPE_BUF_FLAG_CAN_MERGE) &&
		    offset + chars <= PAGE_SIZE) {                               // (4)
			ret = pipe_buf_confirm(pipe, buf);
			if (ret)
				goto out;

			ret = copy_page_from_iter(buf->page, offset, chars, from);     // (5)
			if (unlikely(ret < chars)) {
				ret = -EFAULT;
				goto out;
			}

			buf->len += ret;
			if (!iov_iter_count(from))
				goto out;
		}
	}
```

1. 현재 사용해야 하는 버퍼의 인덱스이다. (위에서 봤듯 기본적으로 pipe에서 사용하는 버퍼는 16개이다)
2. PAGE_SIZE가 2의 제곱수 단위이기 때문에 이는 `total_len % PAGE_SIZE`와 같은 표현이다. pipe에 쓰려고 하는 데이터를 page 단위로 정렬했을 때 몇 바이트가 남는지 계산한다.
3. 병합하고자 하는 버퍼를 바로 앞 버퍼로 설정한다.
4. 바로 앞 버퍼가
    1. merge 가능한지 (`PIPE_BUF_FLAG_CAN_MERGE`)
    2. 남는 바이트 수(`chars`)를 더해도 넘치지 않는지 (`offset + chars <= PAGE_SIZE`)

   를 판단해, 만약 두 조건을 모두 만족한다면 남는 바이트 수만큼 앞 버퍼에 병합한다. (5)


다음으로 남은 데이터들은 새로운 page를 할당받아 빈 버퍼에 할당한 후 그 page에 쓴다. 한 page를 전부 썼는데도 아직 쓸 데이터가 남아있으면 루프 처음으로 이동해 다시 page 할당받고 쓰기를 반복한다.

```c
for (;;) {
		...
		head = pipe->head;
		...
			if (!page) {
				page = alloc_page(GFP_HIGHUSER | __GFP_ACCOUNT);
		...
			pipe->head = head + 1;
			spin_unlock_irq(&pipe->rd_wait.lock);

			/* Insert it into the buffer array */
			buf = &pipe->bufs[head & mask];
			buf->page = page;
			buf->ops = &anon_pipe_buf_ops;
			buf->offset = 0;
			buf->len = 0;
			...
			copied = copy_page_from_iter(page, 0, PAGE_SIZE, from);
			...
			if (!iov_iter_count(from))
				break;
		}

		if (!pipe_full(head, pipe->tail, pipe->max_usage))
			continue;
```

이때 `pipe_full()`이 true여서 더 이상 쓸 공간이 없을 경우, pipe에 걸린 락을 해제하고 대기하고 있는 reader를 깨워 pipe에서 읽도록 해 공간을 확보한다.

```c
		/*
		 * We're going to release the pipe lock and wait for more
		 * space. We wake up any readers if necessary, and then
		 * after waiting we need to re-check whether the pipe
		 * become empty while we dropped the lock.
		 */
		__pipe_unlock(pipe);
		if (was_empty)
			wake_up_interruptible_sync_poll(&pipe->rd_wait, EPOLLIN | EPOLLRDNORM);
		kill_fasync(&pipe->fasync_readers, SIGIO, POLL_IN);
		wait_event_interruptible_exclusive(pipe->wr_wait, pipe_writable(pipe));
		__pipe_lock(pipe);
		was_empty = pipe_empty(pipe->head, pipe->tail);
		wake_next_writer = true;
```

전부 썼다면 락을 해제한다.

```c
if (pipe_full(pipe->head, pipe->tail, pipe->max_usage))
		wake_next_writer = false;
	__pipe_unlock(pipe);
	...
	return ret;
}
```

예시를 들기 위해 `PAGE_SIZE`가 4바이트라 가정하고, 버퍼도 4개만 사용한다고 하자. 다음 다섯 작업

1. pipe에 “ab”를 쓴다
2. pipe에 “cdefg”를 쓴다
3. pipe에 “h”를 쓴다
4. pipe에 “1234”를 쓴다
5. pipe에 “56”을 쓴다

을 수행할 때 때 버퍼가 어떻게 되는지 관찰하면

1. 버퍼가 비어 있으므로 새로운 page를 할당받아 ab를 쓴다.

   `[ab__]`

2. 쓸 대상이 cdefg이므로

   total_len % PAGE_SIZE = 5 % 4 = 1이므로 1바이트만큼을 앞 버퍼에 쓰고 나머지는 새로운 page를 할당받아 쓴다.

   `[abc_][defg]`

3. 쓸 대상이 h이고 앞 버퍼가 꽉 차 있으므로 page를 새로 할당받아 쓴다.

   `[abc_][defg][h___]`

4. 앞 버퍼가 남아있지만,

   total_len % PAGE_SIZE = 4 % 4 = 0이므로 새로운 page를 할당받아 쓴다.

   `[abc_][defg][h___][1234]`

5. pipe가 꽉 찼으므로 우선 reader를 깨우고 대기한다. reader가 한 page를 읽었다고 하면 맨 처음 버퍼가 비었으므로 다음과 같이 쓰게 된다. (pipe은 원형 버퍼를 사용한다는 점을 고려해야 한다)

   `[56__][defg][h___][1234]`


# 3. read from pipe

## 3-1. 인자 분석

pipe에서 읽기를 수행하는 `pipe_read()`의 정의를 살펴보면 다음과 같다.

```c
static ssize_t
pipe_read(struct kiocb *iocb, struct iov_iter *to)
```

인자는 `pipe_write()`와 같다.

## 3-2. 동작 분석

우선 읽을 바이트 수가 0일때 바로 종료하고, 아니라면 pipe에 락을 걸고 읽기를 시작한다.

```c
	/* Null read succeeds. */
	if (unlikely(total_len == 0))
		return 0;

	ret = 0;

	__pipe_lock(pipe);
```

우선 pipe가 꽉 차 있다는 것은 writer가 공간이 부족해 데이터를 다 쓰지 못하고 reader를 깨웠다는 것으로 이해할 수 있다. 다시 말하면 pipe에 공간이 남아있다면 writer가 데이터를 전부 다 썼다는 뜻으로 생각할 수 있기에 중간에 writer를 다시 깨우지 않고 읽는다. 그러나 pipe가 꽉 차 있다면 한 패이지를 읽은 후 writer를 깨워 나머지 데이터를 전부 pipe에 쓰도록 한 후 나머지를 읽는다. 이를 위해 처음에 pipe가 꽉 차 있었는지 검사한다.

```c
	was_full = pipe_full(pipe->head, pipe->tail, pipe->max_usage);
```

다음으로 pipe에서 읽기 시작한다. 만약 한 page를 전부 다 읽었음에도 읽어야 할 데이터가 남아있다면 다음 page를 읽는다.

```c
if (!pipe_empty(head, tail)) {
			struct pipe_buffer *buf = &pipe->bufs[tail & mask];
			size_t buf_len = buf->len;
			size_t written;
			int error;
			...
			written = copy_page_to_iter(buf->page, buf->offset, buf_len, to);    // (1)
			
			ret += buf_len;
			buf->offset += buf_len;
			buf->len -= buf_len;
			
			if (!buf->len) {                                                     // (2)
				pipe_buf_release(pipe, buf);
				spin_lock_irq(&pipe->rd_wait.lock);
				tail++;
				pipe->tail = tail;                                                 // (3)
				spin_unlock_irq(&pipe->rd_wait.lock);
			}
			total_len -= buf_len;
			if (!total_len)                                                      // (4) 
				break;	/* common path: read succeeded */
			if (!pipe_empty(head, tail))	/* More to do? */                      // (5)
				continue;
		}

		if (!pipe->writers)
			break;
		if (ret)
			break;
		...
		__pipe_unlock(pipe);
```

1. 현재 page에서 버퍼의 길이만큼 읽는다
2. 만약 버퍼가 비었다면
3. 버퍼를 해제하고 tail을 늘려 다음 버퍼를 가리키게 한다
4. 목표한 바이트 수만큼 전부 읽었다면 나간다
5. 읽을 게 남았다면 계속 읽는다

이때 더 읽어야 하는데 pipe가 비어서 더 읽지 못하는 경우는 `rd_wait`에 등록한 후 기다린다. 이때 writer가 새로운 데이터를 데이터를 써야 하는데 pipe가 꽉 차서 쓰지 못한 경우는 깨어나게 된다. 이후 writer가 pipe에 데이터를 써 읽을 데이터가 생기면 reader는 다시 깨어나서 위의 과정을 반복해 데이터를 읽게 된다.

```c
		if (wait_event_interruptible_exclusive(pipe->rd_wait, pipe_readable(pipe)) < 0)
			return -ERESTARTSYS;

		__pipe_lock(pipe);
		was_full = pipe_full(pipe->head, pipe->tail, pipe->max_usage);
		wake_next_reader = true;
		// (continue)
```

모두 읽었다면 락을 해제하고 종료한다. 목표한 만큼 읽었는데도 아직 남은 데이터가 있다면 다음 reader를 깨워 데이터를 읽도록 한다.

```c
	if (pipe_empty(pipe->head, pipe->tail))
		wake_next_reader = false;
	__pipe_unlock(pipe);

	if (was_full)
		wake_up_interruptible_sync_poll(&pipe->wr_wait, EPOLLOUT | EPOLLWRNORM);
	if (wake_next_reader)
		wake_up_interruptible_sync_poll(&pipe->rd_wait, EPOLLIN | EPOLLRDNORM);
	kill_fasync(&pipe->fasync_writers, SIGIO, POLL_OUT);
	if (ret > 0)
		file_accessed(filp);
	return ret;
```