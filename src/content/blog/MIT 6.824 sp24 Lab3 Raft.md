---
title: MIT 6.824 sp24 Lab3 Raft
description: MIT 6.824 Lab3 Raft 实现笔记，涵盖领导者选举、日志持久化及快照功能。
publishDate: 2025-11-30
tags:
  - raft
  - 笔记
language: '中文'
---

最近动手做了6.5840（6.824）的lab，关于这门课的资料很多，不介绍了，raft在论文中反复强调自己的易于理解（点名paxos），也给出了很详细的实现细节（Figure2/Figure8），建议实现之前先读一读论文，大概了解一下raft的结构

实现了大部分的协议功能，包括实现领导者选举并维持权威，日志功能，持久化，日志压缩/快照功能

## 实现思路

### 1. 选举

最初的思路和hint中一致，ticker直接使用sleep，记录上一次心跳的时间`lastheartbeat`，在每一个小的时间窗口`checkTimeOut`中检查有没有超过随机设定的选举过期时间`electionTimeOut` ,如果发现过期了就进入选举

但是这样的实现出现了很多问题，比如在测试中会经常出现投票分裂问题，测试中会模拟7个节点断3个，几乎每次都会出现两个节点同时出现选举超时，然后整个集群22投票然后失败的情况，调整了很多次`checkTimeOut`和`electionTimeOut`都没解决（感觉是代码没写好）

最后还是选择了Timer包，提供了很多方便的api，也很好阅读，使用了以后直接实现了严格计时，lab3A在-race参数下也能稳定运行成功

```go	
func (rf *Raft) ticker() {
    for !rf.killed() {
        // Your code here (3A)
        select {
        case <-rf.electionTimer.C:
            rf.mu.Lock()
            if rf.state != Leader {
                go rf.startElection()
            } else {
                // Leader 不应该超时，重置即可
                rf.resetElectionTimer()
            }
            rf.mu.Unlock()
        }
    }
}

func (rf *Raft) resetElectionTimer() {
    rf.electionTimeout = GetRandomElectionTimeout(rf.me)
    rf.electionTimer.Reset(rf.electionTimeout)
}
```

之前在做7days-golang中的GeeCache时候使用了类似time.After这样的处理方法，感觉也可以替代Timer实现严格计时

```go
func dialTimeout(f newClientFunc, network, address string, opts ...*common.Option) (client *Client, err error) {  
    //......
    
    ch := make(chan clientResult)  
    go func() {  
       client, err := f(conn, opt)  
       ch <- clientResult{client: client, err: err}  
    }()   
    if opt.ConnectTimeout == 0 {  
       result := <-ch  
       return result.client, result.err  
    }  
    
    select {  
    case <-time.After(opt.ConnectTimeout):  
       return nil, fmt.Errorf("rpc client: connect timeout: expect within %s", opt.ConnectTimeout)  
    case result := <-ch:  
       return result.client, result.err  
    }  
}
```

每一次收到AppendEntries/Vote/toCandidate都记得重置选举计时器，防止选举后意外超时即可

一开始完全把心跳和正常的AppendEntries分开，日志为空的就是心跳，但后来代码越写越复杂，进行日志同步的时候还出现了问题，ai点拨后发现其实没有这么大的差别，心跳中也可以进行日志同步的功能，不一定非得是特殊处理，只要是合法的AppendEntries都能说明leader还活着，暂时不用选举

### 2. 日志功能

检查是否更新commitIndex和log的应用都用了一个goroutine进行，不过前者睡50ms间隔，后者睡10ms间隔，一开始尝试在每次进行start中挂起同步进行共识判断，但是其实不需要，而且还让代码很复杂

commitChecker每次唤醒遍历自己的matchIndex，发现当前任期最大+半数共识就提交
logApplyer每次根据lastApply和commitIndex一个个提交即可

### 3. 持久化

这一个part难度不大，完成`persist`和`readPersist`两个函数，在每一个持久化状态改变的位置添加`persist`即可，重点是去做hint中提到的一个冲突日志跳过的优化，之前的实现是发现`preLogIndex`不对的时候，leader给`nextIndex`减1下一次重试，

```go
if !reply.Success {
	if rf.nextIndex[server] > 1 {
		rf.nextIndex[server] -= 1	
	}
}
```

这种写法在3c中无法通过，需要我们在`AppendEntries`的reply中添加相关参数，让follow寻找冲突任期的第一条日志返回给leader，来提高匹配效率

### 4. 快照

这里第一步需要我们把log的访问逻辑从直接用index访问变为根据`lastSnapshotIndex`进行逻辑处理再访问，可以写两个辅助函数，把所有之前直接访问log的地方都替换了即可

然后就是实现`InstallSnapshot`，逻辑就是检查是不是快照包含的entry都比自己新，新就全部直接应用并更新状态，这里注意`InstallSnapshot`也是一个合法rpc，记得重置自己的选举超时计时器

对于调用这个rpc，我一开始想的是在`Start`和心跳中发现日志不对之后进行类似补救的处理，这样就出了大问题，如果要应用快照的节点日志很短，会直接返回`conflictTerm`为-1，这时候不检查快照最后应用之间更改preLogIndex，会发生负数访问直接panic，最后只在心跳中进行判断对于一个节点，是要发送`AppendEntries`还是`InstallSnapshot`，进行统一处理

持久化的时候我额外添加了`lastSnapshotIndex`和`lastSnapshotTerm`作为持久化参数，因为我在进行逻辑index计算的时候很依赖这两个参数

## 优化&踩坑

### 心跳快照

在准备进行心跳的时候，先持锁给整个rf当前状态进行快照，既保证了一致性，也方便对发送`AppendEntries`还是`InstallSnapshot`的判断

```go
        //获取快照，避免在 goroutine 中持锁访问
        term := rf.currentTerm
        leaderId := rf.me
        leaderCommit := rf.commitIndex
        // 为每个 peer 准备参数快照
        type peerArgs struct {
            prevLogIndex    int
            prevLogTerm     int
            entries         []LogEntry
            installSnapshot bool
            snapshotTerm    int
            snapshotIndex   int
            snapshot        []byte
        }

        peersData := make([]peerArgs, len(rf.peers))
        for i := range rf.peers {
            if i != rf.me {
                if rf.nextIndex[i] <= rf.lastSnapshotIndex {
                    peersData[i].installSnapshot = true
                    peersData[i].snapshotTerm = rf.lastSnapshotTerm
                    peersData[i].snapshotIndex = rf.lastSnapshotIndex
                    if snapshot == nil {
                        snapshot = rf.persister.ReadSnapshot()
                    }
                    peersData[i].snapshot = snapshot
                    continue
                }

                peersData[i].prevLogIndex = rf.nextIndex[i] - 1
                peersData[i].prevLogTerm = rf.getLogEntry(peersData[i].prevLogIndex).Term
                // 心跳也可以携带需要同步的日志
                if rf.nextIndex[i] <= rf.getLastLogIndex() {
                    peersData[i].entries = rf.getLogEntrys(rf.nextIndex[i])
                }
            }
        }
```

### term检查

每一次进行了rpc，都要记得判断`args.Term != rf.currentTerm`，很重要，防止过期的请求影响当前的判断，因为这个dubug好久（

### 两次计数检查

在选举中，如果选举成功成为leader，是需要启动心跳协程的，这里在检查选票的时候可以检查两次，防止启动多个心跳协程出问题
```go
// 两次检查，每次都检查是否已经完成，防止重复计数开启多个心跳/重复投票计数
if votesGranted > len(rf.peers)/2 {
	rf.muVote.Unlock()
	return
}

votesGranted += 1

if votesGranted > len(rf.peers)/2 {
	// 获得多数票，成为Leader
	// ......
	// 启动心跳协程
	go rf.startHeartBeat()
	// 启动 commitIndex 检查协程
	go rf.startCommitChecker()

}
```


