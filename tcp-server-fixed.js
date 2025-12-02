const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
// 配置
const CONFIG = {
  PORT: 3000,
  HOST: '0.0.0.0',
  //UPLOAD_PATH: '/home/likp/test_uploads',
  UPLOAD_PATH_MAP: new Map(
    [['.','/home/likp/test_uploads'],//virtual path,real path .是根目录，必须有一个根目录
      ['uploads','/home/likp/test_uploads2']]),
  MAX_CONNECTIONS: 500,
  MAX_BUFFER_SIZE: 64 * 1024 * 1024, // 64MB socket 缓冲
  MAX_FILE_SIZE: 100 * 1024 * 1024 * 1024, // 100GB
  CLIENT_TIMEOUT: 3 * 60 * 1000, // 3分钟
  RESUME_TIMEOUT: 2 * 60 * 60 * 1000, // 2小时
};
function GetTickCount() {
  return Math.floor(os.uptime() * 1000);
}
function mapToRealPath(clientFileName)
{
  const baseName = path.basename(clientFileName);
  const dirName = path.dirname(clientFileName);
  const firstLevelDir = dirName.split(path.sep)[0] || '.';
  // if (firstLevelDir === '.') {
  //   clientFileName = '.' + path.sep + clientFileName;
  // }
  if(CONFIG.UPLOAD_PATH_MAP.has(firstLevelDir)){
    let realPath = CONFIG.UPLOAD_PATH_MAP.get(firstLevelDir);
    // 移除首层虚拟目录，拼接真实路径
    const relativePath = dirName === firstLevelDir ? baseName : clientFileName.substring(firstLevelDir.length + path.sep.length);
    const endPath = path.join(realPath, relativePath);
    return endPath;
  }
  else{
    const endPath = path.join(CONFIG.UPLOAD_PATH_MAP.get('.'), clientFileName);
    return endPath;
  }
}

const clients = new Map();
const files = new Map();

// 确保上传目录存在
function ensureUploadDir() {

  CONFIG.UPLOAD_PATH_MAP.forEach((realPath,virtualPath) => {
    if (!fs.existsSync(realPath)) {
      try {
        fs.mkdirSync(realPath, { recursive: true });
        console.log(`[系统] 创建上传目录: ${realPath} (虚拟路径: ${virtualPath})`);
      } catch (err) {
        console.error(`[系统错误] 无法创建上传目录: ${err.message}`);
        process.exit(1);
      }
    }
  });
}

// 安全的文件名检查
function sanitizeFilename(filename) {
  // 移除路径遍历字符
  const basename = path.basename(filename);
  // 移除特殊字符
  return basename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

class myFile {
  constructor(filePath, size, session, md5sum,allowResume = false,) {
    this.size = size;
    this.writtenSize = 0;
    this.hasError = false;
    this.isClosed = false;
    this.stream = null;
    this.session = session; // 关联的会话对象
    this.awaitDrain = false;
    this.filePath = filePath;
    this.allowResume = allowResume;
    this.md5sum = md5sum;
    this.CHECK_MD5 = (md5sum !== ''); // 是否在完成后校验 MD5
    this.inQueueTime = 0;
    
    // 验证文件大小
    if (size > CONFIG.MAX_FILE_SIZE) {
      throw new Error(`文件大小超过限制: ${size} > ${CONFIG.MAX_FILE_SIZE}`);
    }
  }
  
  async CreateFile(startPos, filePath)
  {
    return new Promise((resolve, reject) => {
      // 关闭现有流
      if (this.stream && !this.isClosed) {
        this.removeListeners();
        this.stream.end();
      }

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

      this.stream.on('error', (err) => {
        console.error(`[文件错误] ${this.filePath}: ${err.message}`);
        //this.hasError = true;
        this.cleanup();
        reject(err);
      });
      this.stream.on('open', (fd) => {
        console.log(`[文件] ${this.filePath} 成功打开，文件描述符: ${fd}`);
        //this.isClosed = false;
        resolve(true);
      });
    });
  }
  async Open(startPos, filePath) {
    // 关闭现有流
    let isOpenSuccess = false;
    for (let i = 0; i < 2; i++) {
      try {
        await this.CreateFile(startPos, filePath);
        isOpenSuccess = true;
        this.isClosed = false;
        this.filePath = filePath;
        this.setupListeners();
        break;
      } catch (err) {
        if (i == 0)
        {
          let dirName = path.dirname(filePath);
          fs.mkdirSync(dirName, { recursive: true });
        }

      }
    }
    if (!isOpenSuccess) {
      this.hasError = true;
      if (this.session)
      {
        this.session.notifyError('无法打开文件: ' + filePath);
      }
      if (this.allowResume){
        files.delete(this.filePath);
      }
    }
    return isOpenSuccess;
  }
  
  // 设置事件监听器
  setupListeners() {
    if (!this.stream) return;
    
    this.stream.on('open', (fd) => {
      console.log(`[文件] ${this.filePath} 成功打开，文件描述符: ${fd}`);
      this.isClosed = false;
    });

    this.stream.on('drain', () => {
      this.awaitDrain = false;
      if(this.session) {
        this.session.resumeReceiving('file-stream-backpressure');
      }
    });

    this.stream.on('error', (err) => {
      console.error(`[文件错误] ${this.filePath}: ${err.message}`);
      this.hasError = true;
      this.cleanup();
      
      // 从 Map 中移除
      if (this.allowResume) {
        files.delete(this.filePath);
      }
      
      // 通知客户端
      if (this.session) {
        this.session.notifyError('文件写入错误: ' + err.message);
      }
    });

    this.stream.on('finish', () => {
      console.log(`[文件] ${this.filePath} 写入完成`);
    });

    this.stream.on('close', () => {
      console.log(`[文件] ${this.filePath} 流已关闭`);
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
      console.error(`[文件] ${this.filePath} 已发生错误，拒绝写入`);
      return false;
    }

    if (this.isClosed) {
      console.error(`[文件] ${this.filePath} 已关闭，拒绝写入`);
      return false;
    }

    if (!this.stream) {
      console.error(`[文件] ${this.filePath} 流不存在`);
      return false;
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
        console.log(`[文件] ${this.filePath} 已关闭`);
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
        // 先尝试优雅关闭，如果失败再强制销毁
        if (this.stream.writable) {
          this.stream.end();
        } else {
          this.stream.destroy();
        }
        console.log(`[文件] ${this.filePath} 流已关闭`);
      } catch (err) {
        console.error(`[文件] ${this.filePath} 关闭流时出错: ${err.message}`);
        try {
          this.stream.destroy();
        } catch (e) {
          // 忽略 destroy 错误
        }
      }
    }
    
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

  checkAndDelTimeOutResumeFile()
  {
    const now = GetTickCount();
    files.forEach((file, filePath) => {
      if ((now - file.inQueueTime) > CONFIG.RESUME_TIMEOUT) {
        console.log(`[清理] 超时未完成的断点续传文件: ${filePath}`);
        file.cleanup();
        files.delete(filePath);
      }
    });
  }
  processJsonMessage() {
    const nullIndex = this.buffer.indexOf(0);
    
    if (nullIndex === -1) {
      console.log(`[JSON] ${this.address} 等待完整消息... (${this.buffer.length} 字节)`);
      return;
    }
    
    const jsonBuffer = this.buffer.slice(0, nullIndex);
    const jsonString = jsonBuffer.toString('utf8');
    this.checkAndDelTimeOutResumeFile();
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

  mapToRealPath(clientFileName)
  {
    const baseName = path.basename(clientFileName);
    const dirName = path.dirname(clientFileName);
    const firstLevelDir = dirName.split(path.sep)[0];
    let realPath = null;
    // if(CONFIG.UPLOAD_PATH_MAP.has(firstLevelDir)){
    //   realPath = CONFIG.UPLOAD_PATH_MAP.get(dirName);
    //   uploadDir = realPath;
    // }else{
    //   console.error(`[错误] 虚拟路径 ${dirName} 未映射`);
    //   this.notifyError(`虚拟路径 ${dirName} 未映射`);
    //   setTimeout(() => {
    //     this.socket.end();
    //   }, 100);
    //   return;
    // }
  }

  handleJsonMessage(msg) {
    if (msg.type === 'file') {
      console.log(`[文件] 文件名: ${msg.filename}, 大小: ${msg.size}, md5: ${msg.md5sum}`);
      //将msg.filename分割成路径和文件名
      //let fPath = sanitizeFilename(msg.filename);
      let fPath = mapToRealPath(msg.filename);
      try {
        const allowResume = Boolean(msg.resume);
        let file;
        let startPos = 0;
        
        // 检查是否断点续传
        if (allowResume && files.has(fPath)) {
          file = files.get(fPath);
          if (file && file.allowResume && msg.size > file.writtenSize &&  file.filePath === fPath) {
            startPos = file.writtenSize;
            file.md5sum = msg.md5sum; // 更新 MD5
            file.size = msg.size; // 更新文件大小
            file.Open(startPos, fPath);
            console.log(`[断点续传] ${fPath} 从 ${startPos} 继续`);
          } else {
            console.log('[警告] 文件名不匹配或不可续传，创建新文件');
            file = new myFile(fPath, msg.size, this, msg.md5sum, allowResume);
            file.Open(0, fPath);
            if (file.allowResume) {
              file.inQueueTime=GetTickCount();
              files.set(fPath, file);
            }
          }
        } else {
          file = new myFile(fPath, msg.size, this,msg.md5sum, allowResume);
          file.Open(0, fPath);
          if (file.allowResume) {
            file.inQueueTime=GetTickCount();
            files.set(fPath, file);
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
      console.log('socket buffer size=',this.buffer.length);

      // 定期打印进度
      const progress = (this.currentFile.writtenSize / this.currentFile.size * 100).toFixed(1);
      console.log(`[进度] ${this.address} ${progress}% (${this.currentFile.writtenSize}/${this.currentFile.size})`);
    }
    
    if (this.currentFile.isComplete()) {
      console.log(`[完成] ${this.address} 文件: ${this.currentFile.filePath}`);
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

      let serverMd5 = '';
      let checksumMatch = true;
      if (file.CHECK_MD5) {
        serverMd5 = await file.computeMD5();
        checksumMatch = serverMd5 === file.md5sum;
        console.log(`[校验] ${file.filePath} MD5=${serverMd5} ${checksumMatch ? '匹配' : `≠ 期望 ${file.md5sum}`}`);
      }

      const resp = {
        type: 'finish',
        message: '文件传输完成',
        server_md5: file.CHECK_MD5 ? serverMd5 : null,
        expected_md5: file.md5sum,
        match: checksumMatch
      };
      this.send(JSON.stringify(resp) + '\0');
    } catch (err) {
      console.error(`[校验错误] ${file.filePath}: ${err.message}`);
      this.notifyError('服务器校验失败: ' + err.message);
    } finally {
      if (!file.allowResume) {
        files.delete(file.filePath);
      }
    }
  }

  onError(err) {
    // 忽略常见的客户端断开错误
    if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
      console.log(`[断开] ${this.address} 连接重置`);
    } else {
      console.error(`[错误] ${this.address}: ${err.message}`);
    }
    // onClose 会自动调用，不需要重复 cleanup
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
    
    // 关闭当前文件
    if (this.currentFile) {
      console.log(`[清理] 关闭未完成的文件: ${this.currentFile.filePath}`);
      
      // 如果不是断点续传模式，从 files Map 中移除
      if (!this.currentFile.allowResume && files.has(this.currentFile.filePath)) {
        files.delete(this.currentFile.filePath);
        console.log(`[清理] 从 files Map 移除: ${this.currentFile.filePath}`);
      }
      
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
      currentFile: this.currentFile ? this.currentFile.filePath : null
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
    let upLoadDirs = '';
    CONFIG.UPLOAD_PATH_MAP.forEach((realPath,virtualPath) => {
      upLoadDirs += `${virtualPath} -> ${realPath}\n`;
    });
    console.log(`上传目录: \n${upLoadDirs}`);
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
