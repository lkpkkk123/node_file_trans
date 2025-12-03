const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
//引入 TcpProtocol
const TcpProtocol = require('./tcp_protocol');
const logger = require('./logger');
const createLog=require('./logger').create;
createLog('client');
// 配置
const CONFIG = {
  HOST: '127.0.0.1',
  PORT: 3000,
  CHUNK_SIZE: 512 * 1024 // 512KB 每次读取，减少 syscalls
};

class FileUploadClient {
  constructor(host, port, isTestMode = false) {
    this.host = host;
    this.port = port;
    this.socket = null;
    this.tcpProtocol = new TcpProtocol();
    this.currentFile = null;
    this.isWaitingAck = false;
    this.startPos = 0;
    this.lastMd5 = null;
    this.isTestMode = isTestMode;
    this.uploadComplete = null; // Promise resolver for test mode
    this.uploadFailed = null; // Promise rejecter for test mode
  }

  // 连接到服务器
  connect() {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      
      this.socket.connect(this.port, this.host, () => {
        this.socket.setNoDelay(true);
        this.socket.setKeepAlive(true, 30000);
        logger.info(`✓ 已连接到服务器 ${this.host}:${this.port}`);
        resolve();
      });

      this.socket.on('data', this.onData.bind(this));
      this.socket.on('close', this.onClose.bind(this));
      this.socket.on('error', (err) => {
        logger.error('✗ 连接错误:', err.message);
        reject(err);
      });
    });
  }
  isConnected() {
    return this.socket && !this.socket.destroyed;
  }

  // 处理服务器响应
  onData(chunk) {
    try {
      this.tcpProtocol.unpack(chunk, (pack) => {
        if (pack.type === TcpProtocol.TYPE_JSON) {
          this.handleResponse(pack.data);
        } else {
          logger.info(`服务器消息: 接收 ${pack.data.length} 字节二进制数据`);
        }
      });
    } catch (err) {
      logger.error('✗ 解析数据包错误:', err.message);
    }
  }

  // 处理服务器 JSON 响应
  handleResponse(response) {
    logger.info(`收到响应: ${JSON.stringify(response)}`);
    
    if (response.type === 'ack_file_ready') {
      // 服务器准备好接收文件
      this.startPos = response.start_pos || 0;
      this.isWaitingAck = false;
      
      if (this.startPos > 0) {
        logger.info(`✓ 断点续传，从位置 ${this.startPos} 继续`);
      }
      
      // 开始发送文件数据
      this.sendFileData();
      
    } else if (response.type === 'finish') {
      logger.info(`✓ 服务器确认: ${response.message}`);
      if (response.server_md5) {
        const expected = (this.currentFile && this.currentFile.md5) || this.lastMd5;
        logger.info(`服务器 MD5: ${response.server_md5}`);
        if (expected) {
          logger.info(`本地 MD5: ${expected}`);
          const matches = typeof response.match === 'boolean' ? response.match : response.server_md5 === expected;
          if (matches) {
            logger.info('✓ MD5 校验通过');
          } else {
            if (this.uploadFailed) {
              this.uploadFailed(new Error('✗ MD5 校验失败，文件可能损坏'));        
            }
            logger.error('✗ MD5 校验失败，文件可能损坏');
          }
        }
      }
      
      // 测试模式下不断开连接，通知上传完成
      if (this.isTestMode && this.uploadComplete) {
        this.uploadComplete();
      } else {
        this.disconnect();
      }
      
    } else if (response.type === 'error') {
      logger.error(`✗ 服务器错误: ${response.message}`);
      this.disconnect();
      if (this.uploadFailed) {
        this.uploadFailed(new Error(response.message));        
      }
    } else if (response.type === 'del_file_ack') {
      logger.info(response.message);
    }
  }

  // 计算文件 MD5
  async calculateMD5(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', (data) => {
        if (filePath.endsWith('.m3u8')) {
          logger.info(`md5 ${filePath} data:${data}`);
        }
        hash.update(data);
      });
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
  // 上传文件
  delFile(serverPath) {
    const metadata = {
      type: 'del_file',
      filename: serverPath
    };
    const jsonString = JSON.stringify(metadata);
    this.socket.write(TcpProtocol.packJson(jsonString));
  }
  // 上传文件
  async uploadFile(filePath,serverPath, resumeEnable, useMd5 = false) {//serverDir不能带/
    // 检查文件是否存在
    this.enableResume = resumeEnable;
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    if (fs.statSync(filePath).size === 0) {
      throw new Error(`文件为空: ${filePath}`);
    }


    const stats = fs.statSync(filePath);
    const filename = serverPath;
    
    
    logger.info('=== 文件上传 ===');
    logger.info(`文件: ${filename}`);
    logger.info(`大小: ${this.formatSize(stats.size)}`);
    logger.info(`路径: ${filePath}`);
    logger.info(`断点续传: ${this.enableResume ? '开启' : '关闭'}`);
    
    // 计算 MD5
    let md5 = '';
    if(useMd5) {
      logger.info('计算 MD5...');
      md5 = await this.calculateMD5(filePath);
      logger.info(`MD5: ${md5}`);
    }
    
    // 构建文件元数据消息
    const metadata = {
      type: 'file',
      filename: filename,
      size: stats.size,
      md5sum: md5,
      resume: this.enableResume
    };
    
    this.currentFile = {
      path: filePath,
      size: stats.size,
      sent: 0,
      stream: null,
      md5
    };
    this.lastMd5 = md5;
    
    // 发送元数据
    const jsonString = JSON.stringify(metadata);
    logger.info(`发送文件元数据 ${jsonString.length} 字节, 内容: ${jsonString}`);

    this.socket.write(TcpProtocol.packJson(jsonString));
    this.isWaitingAck = true;
  }

  // 发送文件数据
  sendFileData() {
    if (!this.currentFile) {
      logger.error('✗ 没有当前文件');
      if (this.uploadFailed) {
        this.uploadFailed(new Error('✗ 没有当前文件'));        
      }
      return;
    }

    const startTime = Date.now();
    
    // 创建读取流，从 startPos 开始
    this.currentFile.stream = fs.createReadStream(this.currentFile.path, {
      start: this.startPos,
      highWaterMark: CONFIG.CHUNK_SIZE
    });
    
    this.currentFile.sent = this.startPos;
    let lastProgress = -1;

    logger.info('\n开始传输文件...\n');

    this.currentFile.stream.on('data', (chunk) => {
      if (this.currentFile.path.endsWith('.m3u8')) {
        logger.info(`send ${this.currentFile.path} data:${chunk}`);
      }
      // 检查是否可以写入
      let writeSize = Math.min(chunk.length, this.currentFile.size - this.currentFile.sent);
      if (writeSize <= 0) {
        //结束发送
        this.currentFile.stream.close();
        return;
      }
      //发送writeSize大小的数据
      chunk = chunk.slice(0, writeSize);
      const canWrite = this.socket.write(TcpProtocol.packBinary(chunk));
      this.currentFile.sent += chunk.length;
      
      // 显示进度
      const progress = Math.floor((this.currentFile.sent / this.currentFile.size) * 100);
      if (progress !== lastProgress && progress % 5 === 0) {
        const speed = this.calculateSpeed(this.currentFile.sent - this.startPos, Date.now() - startTime);
        logger.info(`进度: ${progress}% (${this.formatSize(this.currentFile.sent)}/${this.formatSize(this.currentFile.size)}) - ${speed}`);
        lastProgress = progress;
      }
      
      // 如果缓冲区满了，暂停读取
      if (!canWrite) {
        this.currentFile.stream.pause();
      }
    });

    // 监听 drain 事件，恢复读取
    this.socket.on('drain', () => {
      if (this.currentFile && this.currentFile.stream) {
        this.currentFile.stream.resume();
      }
    });

    this.currentFile.stream.on('end', () => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      const avgSpeed = this.calculateSpeed(this.currentFile.sent - this.startPos, Date.now() - startTime);
      
      logger.info('\n✓ 文件发送完成');
      logger.info(`总用时: ${duration} 秒`);
      logger.info(`平均速度: ${avgSpeed}`);
      logger.info('\n等待服务器确认...');
    });

    this.currentFile.stream.on('error', (err) => {
      logger.error('✗ 读取文件错误:', err.message);
      this.disconnect();
      if (this.uploadFailed) {
        this.uploadFailed(err);        
      }
    });
  }

  // 格式化文件大小
  formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
  }

  // 计算传输速度
  calculateSpeed(bytes, milliseconds) {
    if (milliseconds === 0) return '0 B/s';
    const bytesPerSecond = (bytes / milliseconds) * 1000;
    return this.formatSize(bytesPerSecond) + '/s';
  }

  // 断开连接
  disconnect() {
    if (this.socket && !this.socket.destroyed) {
      this.socket.end();
    }
  }

  onClose() {
    logger.info('\n连接已关闭');
    if (!this.isTestMode) {
      process.exit(0);
    }
    else {
      this.socket = null;
      if (this.uploadFailed) {
        this.uploadFailed(new Error('连接已关闭'));        
      }
    }
  }
}

module.exports = { FileUploadClient };

