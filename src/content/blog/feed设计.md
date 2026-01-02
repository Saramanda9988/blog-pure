---
title: Feed/TimeLine 设计
description: 介绍 Feed/TimeLine 流的设计机制，分析其作为内容聚合与分发系统的架构特点。
publishDate: 2025-08-07
tags:
  - feed
  - 消息分发系统
  - 个人笔记
language: '中文'
---

## 介绍

Feed流是一种内容聚合和分发机制。作为一个消息分发系统，它和聊天的架构有异曲同工之妙

![微博的feed](/photos/feed/image(2).png)

![github__的feed(本质上更像是动态)](/photos/feed/image(3).png)

![知乎的动态](/photos/feed/image(4).png)

无论是传统的社交平台的关注/好友feed流，视频/文章平台的动态还是im系统中的朋友圈，其技术的核心都包含三个方面：

- Feed的聚合与分发，用户打开Feed首页后能看到关注人的feed信息列表，同时用户发表的feed需要分发给粉丝或指定用户

- Feed信息的组装与展现；

- 用户关系管理，即用户及其关注/粉丝关系的管理

## 从需求方的思考

当拿到一个feed需求的时候，你要考虑自己的feed产品需要满足什么功能，做出对应的设计

- 我们设计的偏向**动态**（展示用户行为活动）还是**内容流**（展示用户生产内容）

- 我们的关注形式会是**单向关注**(关注博主，更容易出现大v/热点消息问题) 还是 **双向关注**(加好友，较少出现大v问题) 还是 **消息探测**(小红书，抖音，不关注用户也能推荐)

- 我们更注重 **时间排序**(适合写扩散，维护各自的信箱即可) 还是 **推荐排序**(推拉结合，进行数据聚合，热点推送，个性化推荐)

- 我们的内容需不需要进行审核（动态的行为几乎不需要， 内容流则可能需要接入外部审核平台）

- 我们是保证 **强一致性** 还是 **最终一致性**（删除推文可能不是瞬间删除，而是经过多次刷新消失）还是**不保证一致性**也可以接受（内容被删除，但是feed不删除）

- .......

## 消息的聚合分发

### Timeline模式

对于一个简单的类github feed的动态timeline，我们可以采用一个写扩散 +事件模型进行解决

- 用户a触发行为，前端回调接口

- 服务端收到请求，创建对应的事件

- 通过关系服务，查询关注了a的用户

- 事件分别落库用户自己的发件箱和关注用户的收件箱中

这里的收件箱为了快速响应访问，可以维护在redis缓存中，更快的进行响应

这是一个简单的feed模型，接下来我们研究复杂feed流的的聚合分发形式，这里以twitter为例，twitter对自己的服务有着以下的要求：

> - Read heavy - The read to write ratio for twitter is very high, so our system should be able to support that kind of pattern
> - 读多写少 - 推特的读写比例非常高，因此我们的系统应该能够支持这种模式
>
> - Lag is acceptable - From the previous two NFRs, we can understand that the system should be highly available and have very low latency. So when we say lag is ok, we mean it is ok to get notification about someone else’s tweet a few seconds later, but the rendering of the content should be almost instantaneous.
> - 延迟是可以接受的 - 从前两个非功能性需求中，我们可以理解系统应该具有高可用性和极低的延迟。因此，当我们说延迟可以接受时，我们的意思是可以稍晚几秒钟收到他人推文的通知，但内容的渲染应该是几乎即时的。
>
> - The important requirement is that the service should be highly available. It means that the users can read tweets on their home timeline without any downtime
> - 重要要求是服务应具有高可用性。这意味着用户可以在主时间线上无任何停机时间阅读推文
>
> - Fast rendering, Fast tweet
> - 快速渲染，快速推文。
>

twitter大量使用redis进行缓存，在redis中维护用户的timeline，但是在redis维护所有用户的timeline（即时他们并不活跃）过于消耗资源，为此，twitter进行了用户分级

![](/photos/feed/image(6).png)

- 对于活跃/在线用户，他们的timeline会在redis中进行维护，

- 对于被动用户，则不维护他们timeline，当他们上线时，系统会识别出他们是被动用户，然后查询用户关系，查询推文服务获取这些用户的推文，将它们缓存到 Redis 中，并发送给客户端。

- 对于知名用户(大v)的推文，不在活跃用户的timeline中维护，而是维护一个最新更新的时间戳，在进行关系查询的时候判断用户是不是知名用户，如果是，则查询更新时间戳，如果过旧，则去知名用户的发件箱中获取新的推文，和timeline一起返回给客户端进行渲染

  - 用类似读扩散的方式，解决了知名用户发帖造成的大量冗余推文信息复制

  - 名人之间如果相互关注了，仍然采用写扩散，写入对方收件箱

    ![twitter的服务关系](/photos/feed/image(5).png)

    ![硬核课堂的分级策略，twitter的策略他可能认为是对发件箱的依赖，因此采用了收件箱长度的策略](/photos/feed/image(7).png)

利用这种读写扩散，推拉结合的架构，twitter的消息的聚合分发实现，对于一些广告，也可以采用类似读扩散的方式，在获取timeline的时候获取广告信息，统一进行展示

### 图文流模式

图文流模式是推荐排序， 可能需要推荐服务进行画像，个性化收集，写入收件箱，没有找到相关的资料，对应的架构几乎完全不同，估计是和搜广推的关联更大

![](/photos/feed/image(8).png)

## 信息的异构

<https://www.bilibili.com/video/BV1iZ421M7H8/?spm_id_from=333.788.top_right_bar_window_custom_collection.content.click&vd_source=27d9235d87b3997093ce4f7e1d419b2e>

## 用户关系管理

<https://siwei.io/nebulagraph-sns/>

使用普通的关系数据库也可以满足feed消息分发时的关系链查询，但当需要构建社交网络，如获取获取可能感兴趣的人构建feed的时候，系统常需多跳查询

```SQL
SELECT f2.followee_id FROM follows f1 JOIN follows f2 ON f1.followee_id = f2.follower_id WHERE f1.follower_id = A
```

使用传统关系型数据库需要用表格模拟图结构，模型不匹配，容易出现性能瓶颈，查询效率低，Twitter 早期曾因 JOIN 性能问题改用缓存+服务化架构

使用图数据库，方便向关系中台进行演进

![](/photos/feed/image(9).png)

## Feed的删除

![](/photos/feed/image(10).png)

![](/photos/feed/image(11).png)

~~Github~~ ~~feed因为特殊的产品形态（纯用户行为timeline）不保证一致性（取消关注了feed中也有关注记录）~~

## 搜索

---

## 参考

[Timeline Feed系统设计](https://hardcore.feishu.cn/wiki/wikcn7FQDsq2tn2MOaZSDryv8Lf)

[Feed流后台系统设计](https://ik3te1knhq.feishu.cn/wiki/W3atwVkyPiv98hkmQSIcPNS8nwg)

<https://martinfowler.com/eaaDev/EventSourcing.html>

<https://mednoter.com/design-of-feed-part-one.html>

<https://mp.weixin.qq.com/s/v08_YF78Im-Z_Qy8iX3yMQ>

<https://dennysam.medium.com/twitters-tough-architectural-decision-c61e4d0d41a5>

<https://mp.weixin.qq.com/s/RmDLqQmXQAmtQrajoanNuA?spm=a2c4e.10696291.0.0.4f9219a4uoqhOv&utm_medium=hao.caibaojian.com>

<https://zhuanlan.zhihu.com/p/30226315>

<https://www.infoq.cn/article/t0QlHfK7uXxzWO0uO*9s>

<https://juejin.cn/post/7223632126650007612>

<https://pingineering.tumblr.com/post/105293275179/building-a-scalable-and-available-home-feed>

<https://mednoter.com/design-of-feed-part-two.html>

<https://www.bilibili.com/video/BV1iZ421M7H8/?spm_id_from=333.788.top_right_bar_window_custom_collection.content.click&vd_source=27d9235d87b3997093ce4f7e1d419b2e>

<https://interviewnoodle.com/twitter-system-architecture-8dafce16aec4>

<https://www.codekarle.com/system-design/Twitter-system-design.html>

<https://www.cnblogs.com/hanease/p/16268084.html>

<https://highscalability.com/the-architecture-twitter-uses-to-deal-with-150m-active-users/>

[Feed 流](https://ycn45b70r8yz.feishu.cn/wiki/DvJMwsLSBitmDekx3DOcWPwenfG)
