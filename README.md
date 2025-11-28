# Node.js TCP 服务器

这是一个简单的 TCP 服务器实现，支持多客户端连接和消息广播。

## 功能特点

- ✅ 支持多客户端同时连接
- ✅ 消息广播（发送消息给所有其他客户端）
- ✅ 客户端连接/断开日志
- ✅ 错误处理
- ✅ 优雅关闭

## 使用方法

### 启动服务器

```bash
npm run server
```

服务器将在 `127.0.0.1:3000` 上监听。

### 连接客户端

**方式 1：使用提供的客户端**
```bash
npm run client
```

**方式 2：使用 telnet**
```bash
telnet 127.0.0.1 3000
```

**方式 3：使用 netcat (nc)**
```bash
nc 127.0.0.1 3000
```

### 命令

- 输入任意文本并按回车发送消息
- 输入 `quit` 退出连接
- 按 `Ctrl+C` 关闭服务器

## 文件说明

- `tcp-server.js` - TCP 服务器实现
- `tcp-client.js` - TCP 客户端实现
- `index.js` - Hello World 示例程序

## 开发环境

- Node.js 16+
- ESLint 配置已启用
- VS Code 调试配置已设置
