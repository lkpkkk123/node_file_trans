const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 配置
const CONFIG = {
  PORT: 3000,
  HOST: '0.0.0.0',
  UPLOAD_PATH: '/home/likp/test_uploads',
  MAX_CONNECTIONS: 100,
  MAX_BUFFER_SIZE: 64 * 1024 * 1024, // 64MB socket 缓冲
  MAX_FILE_SIZE: 100 * 1024 * 1024 * 1024, // 100GB
  CLIENT_TIMEOUT: 3 * 60 * 1000, // 3分钟
  MAX_QUEUE_SIZE: 128 * 1024 * 1024, // 128MB 排队缓冲
  RESUME_QUEUE_THRESHOLD: 8 * 1024 * 1024, // 队列 < 8MB 恢复接收
  FILE_WRITE_CHUNK: 512 * 1024, // 每次向磁盘写 512KB
  CHECK_MD5: true // 是否在完成后校验 MD5
};

const clients = new Map();
const files = new Map();

// 确保上传目录存在
function ensureUploadDir() {
  if (!fs.existsSync(CONFIG.UPLOAD_PATH)) {
    try {
      fs.mkdirSync(CONFIG.UPLOAD_PATH, { recursive: true });
      console.log(`[系统] 创建上传目录: ${CONFIG.UPLOAD_PATH}`);
    } catch (err) {
      console.error(`[系统错误] 无法创建上传目录: ${err.message}`);
      process.exit(1);
    }
  }
}

// 安全的文件名检查
function sanitizeFilename(filename) {
  // 移除路径遍历字符
  const basename = path.basename(filename);
  // 移除特殊字符
  return basename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

class myFile {
  constructor(id, filename, size, session, allowResume = false) {
    this.id = id;
    this.filename = sanitizeFilename(filename);
    this.size = size;
    this.writtenSize = 0;
    this.writeQueue = Buffer.alloc(0);
    this.hasError = false;
    this.isClosed = false;
    this.stream = null;
    this.session = session; // 关联的会话对象
    this.awaitDrain = false;
    this.filePath = path.join(CONFIG.UPLOAD_PATH, this.filename);
    this.allowResume = allowResume;
    
    // 验证文件大小
    if (size > CONFIG.MAX_FILE_SIZE) {
      throw new Error(`文件大小超过限制: ${size} > ${CONFIG.MAX_FILE_SIZE}`);
    }
  }
  
  Open(startPos, fileName) {
    // 关闭现有流
    if (this.stream && !this.isClosed) {
      this.removeListeners();
      this.stream.end();
    }
    
    const safeFilename = sanitizeFilename(fileName);
    if (safeFilename !== this.filename) {
      this.filename = safeFilename;
      this.filePath = path.join(CONFIG.UPLOAD_PATH, this.filename);
    }
    const filePath = this.filePath;
    
    // 重新创建写入流
    try {
      if (startPos > 0) {
        this.stream = fs.createWriteStream(filePath, {
          highWaterMark: 2 * 1024 * 1024, // 2MB 缓冲区
          flags: 'r+', 
          start: startPos 
        });
      } else {
        this.stream = fs.createWriteStream(filePath, {
          highWaterMark: 2 * 1024 * 1024, // 2MB 缓冲区
        });
      }
      
      this.setupListeners();
      return true;
      
    } catch (err) {
      console.error(`[文件] 打开文件失败: ${err.message}`);
      this.hasError = true;
      return false;
    }
  }
  
  // 设置事件监听器
  setupListeners() {
    if (!this.stream) return;
    
    this.stream.on('open', (fd) => {
      console.log(`[文件] ${this.filename} 成功打开，文件描述符: ${fd}`);
    });

    this.stream.on('drain', () => {
      this.awaitDrain = false;
      this.processQueue();
      if (this.writeQueue.length === 0 && this.session) {
        this.session.resumeReceiving();
      }
    });

    this.stream.on('error', (err) => {
      console.error(`[文件错误] ${this.filename}: ${err.message}`);
      this.hasError = true;
      this.cleanup();
      
      // 从 Map 中移除
      if (this.allowResume) {
        files.delete(this.id);
      }
      
      // 通知客户端
      if (this.session) {
        this.session.notifyError('文件写入错误: ' + err.message);
      }
    });

    this.stream.on('finish', () => {
      console.log(`[文件] ${this.filename} 写入完成`);
    });

    this.stream.on('close', () => {
      console.log(`[文件] ${this.filename} 流已关闭`);
      this.isClosed = true;
    });
  }
  
  // 移除事件监听器（避免重复注册）
  removeListeners() {
    if (!this.stream) return;
    this.stream.removeAllListeners();
  }

  write(data) {
    if (this.hasError) {
      console.error(`[文件] ${this.filename} 已发生错误，拒绝写入`);
      return false;
    }

    if (this.isClosed) {
      console.error(`[文件] ${this.filename} 已关闭，拒绝写入`);
      return false;
    }

    if (!this.stream) {
      console.error(`[文件] ${this.filename} 流不存在`);
      return false;
    }

    // 如果存在积压，先排队
    if (this.awaitDrain || this.writeQueue.length > 0) {
      return this.enqueueData(data);
    }

    const canWrite = this.stream.write(data);
    this.writtenSize += data.length;

    if (!canWrite) {
      this.awaitDrain = true;
      if (this.session) {
        this.session.pauseReceiving('file-stream-backpressure');
      }
    }
    return true;
  }

  enqueueData(data) {
    this.writeQueue = Buffer.concat([this.writeQueue, data], this.writeQueue.length + data.length);

    if (this.writeQueue.length > CONFIG.MAX_QUEUE_SIZE) {
      console.error(`[文件] ${this.filename} 队列过长(${this.writeQueue.length} bytes)，拒绝写入`);
      return false;
    }

    if (this.session && this.writeQueue.length > CONFIG.RESUME_QUEUE_THRESHOLD) {
      this.session.pauseReceiving('disk-queue');
    }

    return this.processQueue();
  }

  processQueue() {
    while (this.writeQueue.length > 0 && !this.awaitDrain) {
      const chunkSize = Math.min(CONFIG.FILE_WRITE_CHUNK, this.writeQueue.length);
      const data = this.writeQueue.slice(0, chunkSize);
      const canWrite = this.stream.write(data);

      if (!canWrite) {
        console.log(`[文件] ${this.filename} 队列写入触发 drain，暂停继续`);
        this.awaitDrain = true;
        if (this.session) {
          this.session.pauseReceiving('file-stream-backpressure');
        }
        return false;
      }

      this.writtenSize += data.length;
      this.writeQueue = this.writeQueue.slice(chunkSize);
    }

    if (this.writeQueue.length < CONFIG.RESUME_QUEUE_THRESHOLD && !this.awaitDrain && this.session) {
      this.session.resumeReceiving();
    }
    return true;
  }

  isComplete() {
    return this.writtenSize >= this.size;
  }

  async close() {
    return new Promise((resolve, reject) => {
      if (this.isClosed || !this.stream) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('关闭文件超时'));
      }, 10000);

      this.stream.end(() => {
        clearTimeout(timeout);
        console.log(`[文件] ${this.filename} 已关闭`);
        resolve();
      });

      this.stream.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  cleanup() {
    if (this.stream && !this.isClosed) {
      try {
        this.removeListeners();
        this.stream.destroy();
        console.log(`[文件] ${this.filename} 流已销毁`);
      } catch (err) {
        console.error(`[文件] ${this.filename} 销毁流时出错: ${err.message}`);
      }
    }
    
    this.writeQueue = Buffer.alloc(0);
    this.awaitDrain = false;
    this.isClosed = true;
  }

  async computeMD5() {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(this.filePath);

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
}

class mySession {
  constructor(socket) {
    this.socket = socket;
    this.address = `${socket.remoteAddress}:${socket.remotePort}`;
    this.connectTime = new Date();
    this.messageCount = 0;
    this.buffer = Buffer.alloc(0);
    this.isFirstMessage = true;
    this.jsonMessage = null;
    this.currentFile = null;
    this.timeout = null;
    this.isPaused = false;
    this.pauseReason = null;
    
    console.log(`[新客户端] ${this.address} 已连接`);

    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30000);
    
    // 设置超时
    this.resetTimeout();
    
    socket.on('data', this.onData.bind(this));
    socket.on('close', this.onClose.bind(this));
    socket.on('error', this.onError.bind(this));
  }

  pauseReceiving(reason = 'backpressure') {
    if (this.isPaused || this.socket.destroyed) {
      return;
    }
    this.isPaused = true;
    this.pauseReason = reason;
    this.socket.pause();
    console.log(`[流控] ${this.address} 暂停接收 (${reason})`);
  }

  resumeReceiving() {
    if (!this.isPaused || this.socket.destroyed) {
      return;
    }
    this.isPaused = false;
    this.pauseReason = null;
    this.socket.resume();
    console.log(`[流控] ${this.address} 恢复接收`);
  }

  resetTimeout() {
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    
    this.timeout = setTimeout(() => {
      console.log(`[超时] ${this.address} 连接超时`);
      let resp = {
        type: 'error',
        message: '连接超时'
      };
      this.send(JSON.stringify(resp) + '\0');
      setTimeout(() => {
        this.socket.end();
      }, 100);
    }, CONFIG.CLIENT_TIMEOUT);
  }

  send(message) {
    if (!this.socket.destroyed) {
      this.socket.write(message);
    }
  }

  notifyError(message) {
    const resp = {
      type: 'error',
      message: message
    };
    this.send(JSON.stringify(resp) + '\0');
  }

  onData(chunk) {
    this.resetTimeout();
    
    // 检查缓冲区大小
    if (this.buffer.length + chunk.length > CONFIG.MAX_BUFFER_SIZE) {
      console.error(`[错误] ${this.address} 缓冲区溢出`);
      this.notifyError('缓冲区溢出');
      setTimeout(() => {
        this.socket.end();
      }, 100);
      return;
    }
    
    this.buffer = Buffer.concat([this.buffer, chunk]);
    
    if (this.isFirstMessage) {
      this.processJsonMessage();
    } else {
      const result = this.processBinaryData();
      if (result === 0) {
        this.notifyError('文件写入失败');
          
        setTimeout(() => {
          this.socket.end();
        }, 1000);
      }
    }
  }

  processJsonMessage() {
    const nullIndex = this.buffer.indexOf(0);
    
    if (nullIndex === -1) {
      console.log(`[JSON] ${this.address} 等待完整消息... (${this.buffer.length} 字节)`);
      return;
    }
    
    const jsonBuffer = this.buffer.slice(0, nullIndex);
    const jsonString = jsonBuffer.toString('utf8');
    
    try {
      this.jsonMessage = JSON.parse(jsonString);
      console.log(`[JSON] ${this.address} 接收到:`, this.jsonMessage);
      
      this.handleJsonMessage(this.jsonMessage);
      
      this.buffer = this.buffer.slice(nullIndex + 1);
      this.isFirstMessage = false;
      
      if (this.buffer.length > 0) {
        this.processBinaryData();
      }
      
    } catch (err) {
      console.error(`[JSON错误] ${this.address} 解析失败: ${err.message}`);
      let resp = {
        type: 'error',
        message: 'JSON解析错误'
      };
      this.send(JSON.stringify(resp) + '\0');
      setTimeout(() => {
        this.socket.end();
      }, 100);
    }
  }

  handleJsonMessage(msg) {
    if (msg.type === 'file') {
      console.log(`[文件] 文件名: ${msg.filename}, 大小: ${msg.size}, ID: ${msg.id}`);
      
      try {
        const allowResume = Boolean(msg.resume);
        let file;
        let startPos = 0;
        
        // 检查是否断点续传
        if (allowResume && files.has(msg.id)) {
          file = files.get(msg.id);
          if (file && file.allowResume && file.size > file.writtenSize &&  file.filename === sanitizeFilename(msg.filename)) {
            startPos = file.writtenSize;
            file.Open(startPos, msg.filename);
            console.log(`[断点续传] ${msg.filename} 从 ${startPos} 继续`);
          } else {
            console.log('[警告] 文件名不匹配或不可续传，创建新文件');
            file = new myFile(msg.id, msg.filename, msg.size, this, allowResume);
            file.Open(0, msg.filename);
            if (file.allowResume) {
              files.set(msg.id, file);
            }
          }
        } else {
          file = new myFile(msg.id, msg.filename, msg.size, this, allowResume);
          file.Open(0, msg.filename);
          if (file.allowResume) {
            files.set(msg.id, file);
          }
        }
        
        this.currentFile = file;
        
        const resp = {
          type: 'ack_file_ready',
          start_pos: startPos
        };
        this.send(JSON.stringify(resp) + '\0');
        
      } catch (err) {
        console.error(`[错误] 创建文件失败: ${err.message}`);
        this.notifyError(err.message);
        setTimeout(() => {
          this.socket.end();
        }, 100);
      }
      
    } else if (msg.type === 'text') {
      console.log(`[文本] ${msg.content}`);
      this.send(`收到: ${msg.content}\n`);
      
    } else {
      console.log(`[未知类型] ${msg.type}`);
    }
  }

  processBinaryData() {
    if (!this.currentFile) {
      console.error(`[错误] ${this.address} 没有当前文件对象`);
      return 0;
    }
    
    const remaining = this.currentFile.size - this.currentFile.writtenSize;
    const toWrite = Math.min(this.buffer.length, remaining);
    
    if (toWrite > 0) {
      const dataToWrite = this.buffer.slice(0, toWrite);
      
      const writeResult = this.currentFile.write(dataToWrite);
      if (writeResult === false && !this.currentFile.isComplete()) {
        console.error(`[错误] ${this.address} 写入失败`);
        return 0;
      }
      
      this.buffer = this.buffer.slice(toWrite);

      // 定期打印进度
      const progress = (this.currentFile.writtenSize / this.currentFile.size * 100).toFixed(1);
      console.log(`[进度] ${this.address} ${progress}% (${this.currentFile.writtenSize}/${this.currentFile.size})`);
    }
    
    if (this.currentFile.isComplete()) {
      console.log(`[完成] ${this.address} 文件: ${this.currentFile.filename}`);
      const finishedFile = this.currentFile;
      this.currentFile = null;
      this.isFirstMessage = true;
      this.handleCompletedFile(finishedFile);
      return 2;
    }
    
    return 1;
  }

  async handleCompletedFile(file) {
    try {
      await file.close();

      let serverMd5 = null;
      let checksumMatch = null;
      if (CONFIG.CHECK_MD5) {
        serverMd5 = await file.computeMD5();
        checksumMatch = serverMd5 === file.id;
        console.log(`[校验] ${file.filename} MD5=${serverMd5} ${checksumMatch ? '匹配' : `≠ 期望 ${file.id}`}`);
      }

      const resp = {
        type: 'finish',
        message: '文件传输完成',
        server_md5: serverMd5,
        expected_md5: file.id,
        match: checksumMatch
      };
      this.send(JSON.stringify(resp) + '\0');
    } catch (err) {
      console.error(`[校验错误] ${file.filename}: ${err.message}`);
      this.notifyError('服务器校验失败: ' + err.message);
    } finally {
      if (file.allowResume) {
        files.delete(file.id);
      }
    }
  }

  onError(err) {
    console.error(`[错误] ${this.address}: ${err.message}`);
    this.cleanup();
  }

  onClose() {
    console.log(`[断开] ${this.address} 已断开`);
    this.cleanup();
  }

  cleanup() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    
    // 关闭当前文件（但保留在 files Map 中以支持断点续传）
    if (this.currentFile) {
      console.log(`[清理] 关闭未完成的文件: ${this.currentFile.filename}`);
      this.currentFile.cleanup();
      this.currentFile = null;
    }
    
    // 清理缓冲区
    this.buffer = Buffer.alloc(0);
    
    // 从客户端列表移除
    clients.delete(this.socket);
    console.log('当前连接数:', clients.size);
  }

  getInfo() {
    return {
      address: this.address,
      connectTime: this.connectTime,
      messageCount: this.messageCount,
      bufferSize: this.buffer.length,
      currentFile: this.currentFile ? this.currentFile.filename : null
    };
  }
}

// 创建 TCP 服务器
const server = net.createServer((socket) => {
  // 检查连接数限制
  if (clients.size >= CONFIG.MAX_CONNECTIONS) {
    console.log(`[拒绝] 连接数已达上限: ${CONFIG.MAX_CONNECTIONS}`);
    socket.write('服务器繁忙，请稍后再试\n');
    setTimeout(() => {
      socket.end();
    }, 100);
    return;
  }
  
  const clientAddress = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`[连接] 新客户端: ${clientAddress}`);

  const client = new mySession(socket);
  clients.set(socket, client);
  console.log(`当前连接数: ${clients.size}`);

  client.send('欢迎连接到文件传输服务器！\n');
});

// 启动服务器
function startServer() {
  ensureUploadDir();
  
  server.listen(CONFIG.PORT, CONFIG.HOST, () => {
    console.log('='.repeat(50));
    console.log('TCP 文件传输服务器已启动');
    console.log(`地址: ${CONFIG.HOST}:${CONFIG.PORT}`);
    console.log(`上传目录: ${CONFIG.UPLOAD_PATH}`);
    console.log(`最大连接数: ${CONFIG.MAX_CONNECTIONS}`);
    console.log(`最大文件大小: ${(CONFIG.MAX_FILE_SIZE / 1024 / 1024).toFixed(0)} MB`);
    console.log('='.repeat(50));
  });
}

server.on('error', (err) => {
  console.error('服务器错误:', err.message);
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${CONFIG.PORT} 已被占用`);
  }
  process.exit(1);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n正在关闭服务器...');
  
  // 关闭所有客户端连接
  clients.forEach((client) => {
    client.send('服务器正在关闭\n');
    setTimeout(() => {
      client.socket.end();
    }, 100);
  });
  
  // 关闭服务器
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
  
  // 强制退出（5秒后）
  setTimeout(() => {
    console.log('强制退出');
    process.exit(1);
  }, 5000);
});

// 启动
startServer();
