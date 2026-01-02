---
title: xv6 中的上下文切换机制详解
description: 详解 xv6 的上下文切换机制，包括进程主动让出 CPU、睡眠、终止及调度触发场景。
publishDate: 2025-04-08
tags:
  - xv6
  - 进程
language: '中文'
---

xv6 实现了一个精简但完整的上下文切换机制，使多个进程能够共享 CPU。上下文切换主要发生在以下场景：

- 进程主动让出 CPU（`yield()`）
- 进程睡眠（`sleep()`）
- 进程终止（`exit()`）
- 时钟中断触发调度

---

## 核心数据结构

### 1. `struct context`

保存内核线程切换时需要的寄存器状态：

```c
struct context {
  uint64 ra;    // 返回地址
  uint64 sp;    // 栈指针
  // 被调用者保存寄存器
  uint64 s0;
  uint64 s1;
  // ...
  uint64 s11;
};
```

### 2. `struct cpu`

存储每个 CPU 核心的状态：

```c
struct cpu {
  struct proc *proc;          // 当前运行的进程
  struct context context;     // 调度器上下文
  int noff;                   // 中断嵌套深度
  int intena;                 // 中断启用状态
};
```

### 3. `struct proc`

进程控制块，包含进程的上下文：

```c
struct proc {
  // ...
  struct context context;    // 进程内核线程的上下文
  // ...
};
```

---

## 上下文切换的流程

### 1. `yield()` 函数

当进程需要让出 CPU 时调用：

```c
void yield(void) {
  struct proc *p = myproc();
  acquire(&p->lock);           // 获取进程锁
  p->state = RUNNABLE;         // 设置状态为可运行
  sched();                     // 调用调度器
  release(&p->lock);           // 释放进程锁
}
```

### 2. `sched()` 函数

上下文切换的核心函数，从当前进程切换到调度器上下文：

```c
void sched(void) {
  int intena;
  struct proc *p = myproc();

  // 各种合法性检查
  if(!holding(&p->lock)) panic("sched p->lock");
  if(mycpu()->noff != 1) panic("sched locks");
  if(p->state == RUNNING) panic("sched running");
  if(intr_get()) panic("sched interruptible");

  intena = mycpu()->intena;

  // 切换上下文
  swtch(&p->context, &mycpu()->context);

  mycpu()->intena = intena;
}
```

### 3. `swtch()` 函数（汇编实现）

保存当前寄存器状态并加载新上下文：

```asm
.globl swtch
swtch:
    # 保存旧的上下文 (a0 指向 &old->context)
    sd ra, 0(a0)
    sd sp, 8(a0)
    sd s0, 16(a0)
    sd s1, 24(a0)
    # ...保存所有 s 寄存器
    sd s11, 88(a0)

    # 加载新的上下文 (a1 指向 &new->context)
    ld ra, 0(a1)
    ld sp, 8(a1)
    ld s0, 16(a1)
    ld s1, 24(a1)
    # ...加载所有 s 寄存器
    ld s11, 88(a1)
    
    ret  # 跳转到新上下文的返回地址
```

### 4. `scheduler()` 函数

调度器逻辑，选择下一个要运行的进程：

```c
void scheduler(void) {
  struct proc *p;
  struct cpu *c = mycpu();
  
  c->proc = 0;
  for(;;){
    intr_on();
    
    for(p = proc; p < &proc[NPROC]; p++) {
      acquire(&p->lock);
      if(p->state == RUNNABLE) {
        p->state = RUNNING;
        c->proc = p;
        
        // 切换到进程上下文
        swtch(&c->context, &p->context);
        
        c->proc = 0;
      }
      release(&p->lock);
    }
  }
}
```

### 5. 进程初始化时的上下文设置

在进程创建时设置初始上下文：

```c
static struct proc* allocproc(void) {
  // ...
  
  memset(&p->context, 0, sizeof(p->context));
  p->context.ra = (uint64)forkret;  // 返回地址设置为 forkret
  p->context.sp = p->kstack + PGSIZE; // 设置内核栈顶
  
  // ...
}
```

---

## 上下文切换的关键特性

1. **协作式切换**：只在特定点（如 `yield()`、`sleep()` 和 `exit()`）发生
2. **双重上下文**：
   - 用户/内核切换：通过陷阱机制（`trampoline.S`）处理
   - 内核线程切换：通过 `swtch()` 处理，只保存必要的内核寄存器
3. **锁保护**：
   - 进程在切换前必须持有自己的锁
   - 调度器释放旧进程的锁，获取新进程的锁
4. **特殊情况**：
   - 新创建的进程从 `forkret()` 开始执行
   - 定时器中断会导致运行进程调用 `yield()`，从而触发上下文切换

---

## 完整的上下文切换流程示例

假设进程 P1 调用 `yield()` 让出 CPU，调度器选择进程 P2 运行：

1. P1 调用 `yield()`，将自己状态设为 `RUNNABLE`
2. P1 调用 `sched()`，通过 `swtch()` 保存自己的上下文并切换到调度器上下文
3. `scheduler()` 找到 P2（状态为 `RUNNABLE`）
4. 调度器将 P2 的状态设为 `RUNNING`，通过 `swtch()` 保存调度器上下文并切换到 P2 的上下文
5. P2 从上次调用 `sched()` 的地方继续执行，释放自己的锁
6. 当 P2 完成工作或时间片用尽，调用 `yield()` 让出 CPU，重复上述过程

---

## 上下文切换调用链解析

### 1. 两个关键 `context`

- `p->context`：进程的内核线程上下文
- `cpu->context`：CPU 的调度器上下文

### 2. 调度器线程

- 每个 CPU 有一个专用调度器线程，运行 `scheduler()` 函数
- 使用 CPU 自己的栈和上下文

---

## 完整调用链示例（以 `yield()` 为例）

1. **进程主动让出 CPU**

```c
acquire(&p->lock);
p->state = RUNNABLE;
sched();
```

2. **`sched()` 的准备工作**

```c
if(intr_get() || mycpu()->noff != 1 || ...) panic("sched");

swtch(&p->context, &mycpu()->context);
```

3. **`swtch()` 汇编实现**

```asm
# 保存当前寄存器到旧 context
sd ra, 0(a0)
sd sp, 8(a0)
...

# 加载新 context（调度器的 context）
ld ra, 0(a1)
ld sp, 8(a1)
...

ret  # 跳转到调度器代码
```

4. **调度器接管**

```c
for(p = proc; p < &proc[NPROC]; p++) {
  acquire(&p->lock);
  if(p->state == RUNNABLE) {
    p->state = RUNNING;
    swtch(&cpu->context, &p->context);
  }
  release(&p->lock);
}
```

---

## 关键点图解

```
[Process A kernel thread]
  |
  v
保存到A的p->context
  |
  v
切换到cpu->context → [Scheduler thread]
                          |
                          v
                     [Scheduler代码]
                          |
                          v
                     选择Process B
                          |
                          v
保存到cpu->context
                          |
                          v
切换到B的p->context → [Process B kernel thread]
```

---

## 三个重要细节

1. **上下文切换的对称性**
   - 每次 `swtch()` 都是成对出现：进程→调度器，调度器→新进程
   - 第二次切换时，`cpu->context` 保存的是调度器在 `swtch()` 后的返回地址

2. **锁的持有**
   - 进程必须在持有自己的 `p->lock` 时调用 `sched()`
   - 调度器在选择进程前会获取目标进程的 `p->lock`

3. **栈的切换**
   - `sp` 是上下文的一部分，切换 `context` 时自动切换了内核栈
   - 进程和调度器使用完全独立的栈空间

---

## 为什么这样设计？

1. **隔离性**：调度器作为独立线程，不受任何进程状态影响
2. **可重入性**：调度器可以在任何 CPU 上运行相同的代码
3. **原子性**：通过锁保证进程状态转换的原子性
