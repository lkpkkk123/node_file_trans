# 文件监听自动上传

使用 chokidar 监听目录，当文件写入完成后自动上传到服务器。

## 安装依赖

```bash
npm install
```

## 使用方法

### 1. 启动服务器

```bash
node tcp-server-fixed.js
```

### 2. 启动文件监听器

```bash
# 基本用法（监听默认目录 /home/likp/watch_uploads）
node file-watcher.js

# 指定监听目录
node file-watcher.js /path/to/watch

# 指定监听目录和服务器
node file-watcher.js /path/to/watch 192.168.1.100 3000

# 指定虚拟目录（上传到服务器的目录）
node file-watcher.js /path/to/watch 192.168.1.100 3000 uploads

# 使用 npm 脚本
npm run watch
```

### 3. 测试

将文件复制或移动到监听目录：

```bash
cp ~/Downloads/test.zip /home/likp/watch_uploads/
```

文件监听器会自动检测并上传到服务器。

## 参数说明

```
node file-watcher.js [监听目录] [服务器IP] [端口] [虚拟目录]
```

- **监听目录**: 要监听的本地目录（默认：`/home/likp/watch_uploads`）
- **服务器IP**: TCP 服务器地址（默认：`127.0.0.1`）
- **端口**: 服务器端口（默认：`3000`）
- **虚拟目录**: 上传到服务器的虚拟目录（默认：`.` 根目录）

## 特性

- ✅ 自动检测新文件
- ✅ 等待文件写入完成（2秒稳定期）
- ✅ 避免重复上传
- ✅ 支持 MD5 校验
- ✅ 支持断点续传
- ✅ 忽略隐藏文件
- ✅ 优雅退出

## 工作流程

1. 监听器启动，监控指定目录
2. 检测到新文件时，等待文件稳定（2秒内无变化）
3. 延迟1秒确保文件完全关闭
4. 连接服务器并上传文件
5. 上传完成后自动断开连接
6. 继续监听新文件

## 注意事项

- 不会上传空文件
- 不会重复上传正在上传的文件
- 按 `Ctrl+C` 优雅退出（会等待正在上传的文件完成）

## 示例

### 场景1：本地监听上传到默认目录
```bash
node file-watcher.js /home/likp/watch_uploads
```

### 场景2：上传到服务器的 uploads 虚拟目录
```bash
node file-watcher.js /home/likp/watch_uploads 192.168.8.237 3000 uploads
```

### 场景3：配合服务器路径映射
服务器配置：
```javascript
UPLOAD_PATH_MAP: new Map([
  ['.', '/home/server/default'],
  ['uploads', '/home/server/uploads']
])
```

监听器：
```bash
node file-watcher.js /home/client/files 192.168.8.237 3000 uploads
```

文件会上传到服务器的 `/home/server/uploads/` 目录。
