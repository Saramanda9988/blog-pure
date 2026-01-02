---
title: Scaling Push Messaging for Millions of Devices @Netflix
publishDate: 2025-07-22
tags:
  - 个人笔记
  - 架构
  - websocket
language: '中文'
description: 奈飞（Netflix）分享了 Pushy 的演进细节，它是一个 WebSocket 消息投递平台，支持公司产品在许多不同设备上的推送通知和设备之间的通信。奈飞（Netflix）的工程师对 Pushy 生态系统进行了大量的改进，以确保平台的可扩展性和可靠性，并支持新功能。
---

<iframe src="https://www.youtube.com/embed/6w6E_B55p0E" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>

![](/photos/20250721161754.png)

## 挑战

传统的阻塞io无法同时持有过多的websocket连接（context的切换）
使用一些io原语（epoll进行非阻塞调用）
使用netty——异步 I/O + 单线程 + 状态机管理（事件驱动）

## 注册服务的要求

* 低读取延迟
* 支持记录过期（有TTL）
* 可分片
* 高可用

## 在推送服务中使用长连接

HTTP 是无状态的协议，一次请求一次响应，而 **持久连接**（如 WebSocket）是客户端和服务器之间建立的一条长期连接通道；这样一来，每个连接必须和某一台特定的服务器实例“绑定”，这就引入了状态（即：客户端在哪台服务器上有连接）

>所以，Zuul Push 服务在使用长连接技术时，本质上是**变成了一个有状态服务**，这和传统的 stateless HTTP 架构不同。

### 优点：Great for client efficiency

- 客户端只需一次连接，就能持续接收消息；
- 减少了重连开销、延迟低；
- 实时性强，适合聊天、通知等场景。

### 缺点：Terrible for quick deploy/rollback(stickiness)

- 如果你部署新版本，需要重启服务进程；
- 那么所有连接的客户端都会断开，造成中断；
- 即使你是灰度发布，一台机器下线也会影响那台上所有持久连接的客户端；
- 回滚也是一样的问题，连接要重新迁移，很麻烦。

## 解决方案

1. 控制websocket生命周期（定时关闭websocket进行重连）
	* 由于负载均衡策略，websocket断开后很大可能会落在别的机器上
	* 降低了websocket对于一个服务器的粘性
2. 随机化每个长连接的声明周期
	* 防止多个连接同时断开连接，同时连接，造成服务器压力
	* lifetime随机为30min +- 2min
	* 定时器强制关闭

## 优化推送服务

1. 大部分连接都是空闲的
	* 对于推送服务，不是每时每刻都在推送信息
	* 所以即时一个服务器打开大量连接，也不会造成资源耗尽
	* 第一次尝试，尽可能开启足够多的连接，但是注意在服务器崩溃时，重启服务器会让大量的连接请求重新打入服务器，造成服务器崩溃
	* 第二次尝试，根据实际指标和压测，找到了一个 _“刚刚好的”负载窗口（Goldilocks zone）_
2. **你需要优化服务器表单操作的总成本，而不是针对低服务器数量进行优化**
	* 运行效率 不等于 更少的服务器
	* 相同成本下，更多的小型服务器比更少的大型服务器要好

## 长连接的负载均衡

![](/photos/20250722111029.png)
在tcp层运行负载均衡器/使用亚马逊LB负载均衡
![](/photos/20250722111203.png)
