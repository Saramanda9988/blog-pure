---
title: Go语言常用Idiomatic Patterns
description: 常见的 Go 语言中常用的编程模式
publishDate: 2025-10-27
tags:
  - golang
  - 个人笔记
language: '中文'
heroImage: { src: './thumbnail.jpg', color: '#83a1d5ff' }
---

## 1. 静态检查是否实现接口

```go
var _ io.Closer = (*XClient)(nil)
```

## 2. **面向实例** 和 面向包创建方法

大多数用户只需要默认行为

```go
// 这是 Server 类型的方法，绑定到具体的 *Server 实例上
// 更灵活，适用于需要多个 server 实例或自定义行为的场景
func (server *Server) Accept(lis net.Listener)

// 这是一个普通的包级函数，内部委托给一个 **全局默认实例DefaultServer
//  提供了更简洁的 API，用户不需要显式创建 `Server` 实例，直接调用
//geerpc.Accept(lis)即可启动服务。
func Accept(lis net.Listener) { DefaultServer.Accept(lis) }
```

## 3. 组合优于继承

描述接口能做什么

```go
type ReadWriteCloser interface {
    io.Reader
    io.Writer
    io.Closer
}
```

## 4. 函数式选项（Functional Options Pattern）

类似工厂模式，构造具有多个可选参数的对象（如配置、客户端、服务等）
~~所以为什么不直接用链式的工厂模式？~~

```go
type Server struct {
    addr     string
    port     int
    timeout  time.Duration
    maxConns int
    tls      bool
}

// Option 是一个函数类型，用于修改 *Server
type Option func(*Server)

// 提供选项函数（公开 API）
func WithAddr(addr string) Option {
    return func(s *Server) {
        s.addr = addr
    }
}

func WithPort(port int) Option {
    return func(s *Server) {
        s.port = port
    }
}

func WithTimeout(timeout time.Duration) Option {
    return func(s *Server) {
        s.timeout = timeout
    }
}

// 构建函数
func NewServer(opts ...Option) *Server {
    // 设置默认值
    s := &Server{
        addr:     "localhost",
        port:     8080,
        timeout:  30 * time.Second,
        maxConns: 100,
        tls:      false,
    }

    // 应用用户传入的选项（覆盖默认值）
    for _, opt := range opts {
        opt(s)
    }

    return s
}

server := NewServer(
    WithAddr("0.0.0.0"),
    WithPort(8000),
    WithTimeout(5 * time.Second),
)
```

## 5. 接口型函数

典型的适配器模式，通过 `HandlerFunc` 将“函数”适配成“接口实现”，适配方法的参数要求

```go
type Handler interface {  
    ServeHTTP(ResponseWriter, *Request)  
}  

type HandlerFunc func(ResponseWriter, *Request)  
  
func (f HandlerFunc) ServeHTTP(w ResponseWriter, r *Request) {  
    f(w, r)  
}
```

- 这里为 `HandlerFunc` 类型定义了一个方法 `ServeHTTP`
- 方法体内直接调用函数 `f(w, r)`
- 由于 `HandlerFunc` 实现了 `ServeHTTP` 方法，它就满足了 `Handler` 接口
