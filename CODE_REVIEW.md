# TCP 文件传输服务器 - 代码审查报告

## 🐛 发现的 Bug

### 1. **严重 Bug** - Open() 方法返回值错误
**位置**: `myFile.Open()` 第 26-27 行
```javascript
if (this.stream && !this.isClosed) {
  this.stream.end();
  return true;  // ❌ 这里直接返回了，后面的代码不会执行！
}
```
**问题**: 如果流已存在，会直接 return，导致后面重新创建流的代码不执行
**影响**: 断点续传功能失效

---

### 2. **严重 Bug** - 错误传播机制缺失
**位置**: `myFile.cleanup()` 第 59 行
```javascript
this.stream.on('error', (err) => {
  console.error(`[文件错误] ${this.filename}: ${err.message}`);
  this.hasError = true;
  this.cleanup();
  // ❌ 缺少：从 files Map 中移除
  // ❌ 缺少：通知相关的客户端
});
```
**问题**: 文件错误后没有清理 files Map，也没有通知客户端
**影响**: 内存泄漏，客户端无法感知错误

---

### 3. **严重 Bug** - 断点续传逻辑错误
**位置**: `handleJsonMessage()` 第 270 行
```javascript
if (files.has(msg.id) && files[msg.id].filename === msg.filename)
                        ^^^^^^^^^^^^^^
// ❌ 错误：应该用 .get() 而不是 []
```
**问题**: Map 对象使用 `[]` 访问会返回 undefined
**正确**: `files.get(msg.id).filename`

---

### 4. **内存泄漏** - Buffer 无限增长
**位置**: `mySession.buffer`
```javascript
this.buffer = Buffer.concat([this.buffer, chunk]);
```
**问题**: 如果客户端恶意发送数据但不发 \0，buffer 会无限增长
**影响**: 服务器内存耗尽

---

### 5. **竞态条件** - 多个事件监听器重复注册
**位置**: `myFile.Open()` 第 44-66 行
```javascript
this.stream.on('open', (fd) => { ... });
this.stream.on('drain', () => { ... });
this.stream.on('error', (err) => { ... });
// 每次调用 Open() 都会注册新的监听器！
```
**问题**: 断点续传时重复调用 Open()，事件监听器会重复注册
**影响**: 内存泄漏，事件触发多次

---

### 6. **逻辑错误** - writtenSize 计算错误
**位置**: `processQueue()` 第 107 行
```javascript
const canWrite = this.stream.write(data);
this.writtenSize += data.length;  // ❌ 即使 canWrite 为 false 也累加了
```
**问题**: 数据放回队列后，writtenSize 已经增加，导致计数不准确
**影响**: 文件完成判断错误

---

### 7. **资源泄漏** - 客户端断开时文件未关闭
**位置**: `mySession.onClose()`
```javascript
onClose() {
  console.log(`[断开] 客户端已断开: ${this.address}`);
  clients.delete(this.socket);
  // ❌ 缺少：关闭当前正在传输的文件
  // ❌ 缺少：清理 buffer
}
```

---

### 8. **并发问题** - 缺少目录存在性检查
**位置**: `myFile.Open()` 第 35 行
```javascript
this.stream = fs.createWriteStream(`${PATH}/${fileName}`);
// ❌ 如果 /opt/uploads 目录不存在会报错
```

---

## ⚠️ 潜在问题

### 1. **安全问题** - 路径遍历攻击
```javascript
const file = new myFile(msg.id, msg.filename, msg.size);
// ❌ msg.filename 可能包含 "../../../etc/passwd"
```

### 2. **资源限制** - 无文件大小限制
```javascript
if (msg.type === 'file') {
  // ❌ 没有检查 msg.size 的合理性
  // 恶意客户端可以声称文件大小为 999GB
}
```

### 3. **并发问题** - 无连接数限制
```javascript
const server = net.createServer((socket) => {
  // ❌ 没有限制最大连接数
});
```

### 4. **缺少超时机制**
```javascript
// ❌ 客户端连接后不发送数据，永久占用资源
```

---

## 🔧 需要改进的地方

### 1. 缺少日志系统
- 建议使用 winston 或 pino
- 日志应该分级别记录

### 2. 缺少配置管理
```javascript
// 硬编码的配置
const PORT = 3000;
const HOST = '0.0.0.0';
const PATH = '/opt/uploads';
```

### 3. 缺少进度通知
- 客户端无法得知传输进度
- 建议定期发送进度消息

### 4. 错误处理不完善
- 很多地方只 console.error，没有实际处理
- 缺少重试机制

### 5. 缺少文件校验
- 传输完成后应该验证 MD5
- 确保文件完整性

### 6. 性能问题
```javascript
this.buffer = Buffer.concat([this.buffer, chunk]);
// concat 会创建新 Buffer，性能较差
// 建议使用 Buffer 池或流式处理
```

---

## 📋 优先级修复列表

### 🔴 高优先级（必须修复）
1. ✅ 修复 Open() 返回值逻辑
2. ✅ 修复断点续传的 Map 访问错误
3. ✅ 添加 Buffer 大小限制
4. ✅ 修复事件监听器重复注册
5. ✅ 修复 writtenSize 计算错误
6. ✅ 添加路径安全检查
7. ✅ 客户端断开时清理资源

### 🟡 中优先级（建议修复）
8. ✅ 添加文件大小限制
9. ✅ 添加连接数限制
10. ✅ 添加超时机制
11. ✅ 创建上传目录（如果不存在）
12. ✅ 改进错误传播机制

### 🟢 低优先级（可选）
13. 添加日志系统
14. 添加配置文件
15. 添加进度通知
16. 添加 MD5 校验
17. 优化 Buffer 性能

---

## 总结

当前代码存在多个严重 bug，特别是：
- 断点续传功能基本不可用
- 内存泄漏问题
- 安全漏洞

建议优先修复高优先级问题，再考虑功能增强。
