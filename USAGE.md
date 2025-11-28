# TCP 文件传输系统使用指南

## 快速开始

### 1. 启动服务器

```bash
npm run server
# 或
node tcp-server-fixed.js
```

服务器将在 `0.0.0.0:3000` 上监听，文件保存到 `/opt/uploads` 目录。

### 2. 上传文件

**基本用法：**
```bash
node tcp-client.js <文件路径>
```

**指定服务器和端口：**
```bash
node tcp-client.js <文件路径> <服务器IP> <端口>
```

## 使用示例

### 示例 1: 上传本地文件
```bash
# 上传当前目录的文件
node tcp-client.js ./test.txt

# 上传绝对路径文件
node tcp-client.js /home/user/documents/report.pdf
```

### 示例 2: 上传到远程服务器
```bash
# 上传到远程服务器
node tcp-client.js ./video.mp4 192.168.1.100

# 指定端口
node tcp-client.js ./data.zip 192.168.1.100 3000
```

### 示例 3: 使用 npm 脚本
```bash
# 使用 npm 上传
npm run upload ./myfile.txt
```

## 功能特性

### ✅ 客户端功能
- 自动计算文件 MD5
- 实时进度显示（每 5% 更新）
- 传输速度显示
- 断点续传支持
- 自动背压处理（防止内存溢出）
- 完整的错误处理

### ✅ 服务器功能
- 多客户端并发支持（最大 100 个）
- 文件大小限制（1GB）
- 路径安全检查（防止路径遍历攻击）
- 断点续传
- 超时保护（5 分钟）
- 缓冲区溢出保护
- 自动创建上传目录

## 输出示例

### 客户端上传过程
```
==================================================
TCP 文件上传客户端
==================================================

=== 文件上传 ===
文件: test.txt
大小: 10.50 MB
路径: /home/user/test.txt

计算 MD5...
MD5: 5d41402abc4b2a76b9719d911017c592

✓ 已连接到服务器 127.0.0.1:3000
服务器消息: 欢迎连接到文件传输服务器！

发送文件元数据...
收到响应: { type: 'ack_file_ready', start_pos: 0 }

开始传输文件...

进度: 5% (524.29 KB/10.50 MB) - 2.10 MB/s
进度: 10% (1.05 MB/10.50 MB) - 2.45 MB/s
进度: 15% (1.57 MB/10.50 MB) - 2.67 MB/s
...
进度: 100% (10.50 MB/10.50 MB) - 3.15 MB/s

✓ 文件发送完成
总用时: 3.33 秒
平均速度: 3.15 MB/s

等待服务器确认...
收到响应: { type: 'finish', message: '文件传输完成' }
✓ 服务器确认: 文件传输完成

连接已关闭
```

### 服务器日志
```
==================================================
TCP 文件传输服务器已启动
地址: 0.0.0.0:3000
上传目录: /opt/uploads
最大连接数: 100
最大文件大小: 1024 MB
==================================================

[连接] 新客户端: 127.0.0.1:54321
[新客户端] 127.0.0.1:54321 已连接
当前连接数: 1

[JSON] 127.0.0.1:54321 接收到: { type: 'file', filename: 'test.txt', size: 11010048, id: '5d41402abc4b2a76b9719d911017c592' }
[文件] 文件名: test.txt, 大小: 11010048, ID: 5d41402abc4b2a76b9719d911017c592
[文件] test.txt 成功打开，文件描述符: 20

[进度] 127.0.0.1:54321 5.0% (550144/11010048)
[进度] 127.0.0.1:54321 10.0% (1100288/11010048)
...
[进度] 127.0.0.1:54321 100.0% (11010048/11010048)

[完成] 127.0.0.1:54321 文件: test.txt
[文件] test.txt 已关闭
[断开] 127.0.0.1:54321 已断开
当前连接数: 0
```

## 断点续传

如果传输中断，再次上传相同文件（相同 MD5）时会自动续传：

```bash
# 第一次传输中断
node tcp-client.js ./large_file.zip
# ... 传输到 60% 时断开

# 重新上传，自动从 60% 继续
node tcp-client.js ./large_file.zip
```

服务器输出：
```
[断点续传] large_file.zip 从 6291456 继续
```

## 错误处理

### 文件不存在
```bash
$ node tcp-client.js ./notfound.txt
✗ 错误: 文件不存在: ./notfound.txt
```

### 服务器繁忙
```bash
✗ 连接错误: 服务器繁忙，请稍后再试
```

### 文件过大
```bash
✗ 服务器错误: 文件大小超过限制: 2147483648 > 1073741824
```

## 配置修改

### 修改服务器配置
编辑 `tcp-server-fixed.js` 的 `CONFIG` 对象：

```javascript
const CONFIG = {
  PORT: 3000,                          // 端口
  HOST: '0.0.0.0',                     // 监听地址
  UPLOAD_PATH: '/opt/uploads',         // 上传目录
  MAX_CONNECTIONS: 100,                // 最大连接数
  MAX_BUFFER_SIZE: 10 * 1024 * 1024,  // 10MB 缓冲区
  MAX_FILE_SIZE: 1024 * 1024 * 1024,  // 1GB 文件大小限制
  CLIENT_TIMEOUT: 5 * 60 * 1000,      // 5分钟超时
  MAX_QUEUE_SIZE: 100                  // 最大队列大小
};
```

### 修改客户端配置
编辑 `tcp-client.js` 的 `CONFIG` 对象：

```javascript
const CONFIG = {
  HOST: '127.0.0.1',           // 默认服务器地址
  PORT: 3000,                  // 默认端口
  CHUNK_SIZE: 64 * 1024       // 64KB 每次发送
};
```

## 故障排查

### 1. 权限错误
```bash
# 确保上传目录有写权限
sudo mkdir -p /opt/uploads
sudo chown $USER:$USER /opt/uploads
chmod 755 /opt/uploads
```

### 2. 端口被占用
```bash
# 查看端口占用
lsof -i :3000

# 修改配置使用其他端口
```

### 3. 防火墙问题
```bash
# 允许端口访问（Ubuntu/Debian）
sudo ufw allow 3000/tcp

# CentOS/RHEL
sudo firewall-cmd --add-port=3000/tcp --permanent
sudo firewall-cmd --reload
```

## 性能调优

### 增加传输速度
```javascript
// 增加 chunk 大小（客户端）
CHUNK_SIZE: 256 * 1024  // 256KB

// 增加缓冲区（服务器）
MAX_BUFFER_SIZE: 50 * 1024 * 1024  // 50MB
```

### 支持更大文件
```javascript
// 服务器配置
MAX_FILE_SIZE: 10 * 1024 * 1024 * 1024  // 10GB
```

## API 文档

### 消息协议

**1. 文件上传请求（客户端 → 服务器）**
```json
{
  "type": "file",
  "filename": "test.txt",
  "size": 1024,
  "id": "md5_hash"
}
```

**2. 准备接收响应（服务器 → 客户端）**
```json
{
  "type": "ack_file_ready",
  "start_pos": 0
}
```

**3. 完成响应（服务器 → 客户端）**
```json
{
  "type": "finish",
  "message": "文件传输完成"
}
```

**4. 错误响应（服务器 → 客户端）**
```json
{
  "type": "error",
  "message": "错误描述"
}
```

## 高级用法

### 批量上传
```bash
#!/bin/bash
for file in *.txt; do
  echo "上传: $file"
  node tcp-client.js "$file"
  sleep 1
done
```

### 监控上传目录
```bash
# 实时查看上传文件
watch -n 1 'ls -lh /opt/uploads'
```

### 日志记录
```bash
# 服务器日志记录到文件
node tcp-server-fixed.js 2>&1 | tee server.log

# 客户端日志
node tcp-client.js ./file.txt 2>&1 | tee upload.log
```

## 支持

如有问题，请检查：
1. 服务器是否正在运行
2. 网络连接是否正常
3. 文件路径是否正确
4. 权限是否足够
5. 磁盘空间是否充足
