const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 配置
const CONFIG = {
  HOST: '127.0.0.1',
  PORT: 3000,
  CHUNK_SIZE: 64 * 1024 // 64KB 每次发送
};

class FileUploadClient {
  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.currentFile = null;
    this.isWaitingAck = false;
    this.startPos = 0;
  }

  // 连接到服务器
  connect() {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      
      this.socket.connect(this.port, this.host, () => {
        console.log(`✓ 已连接到服务器 ${this.host}:${this.port}`);
        resolve();
      });

      this.socket.on('data', this.onData.bind(this));
      this.socket.on('close', this.onClose.bind(this));
      this.socket.on('error', (err) => {
        console.error('✗ 连接错误:', err.message);
        reject(err);
      });
    });
  }

  // 处理服务器响应
  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    
    // 查找 JSON 消息（以 \0 结尾）
    const nullIndex = this.buffer.indexOf(0);
    if (nullIndex !== -1) {
      const jsonBuffer = this.buffer.slice(0, nullIndex);
      const jsonString = jsonBuffer.toString('utf8');
      
      try {
        const response = JSON.parse(jsonString);
        this.handleResponse(response);
        this.buffer = this.buffer.slice(nullIndex + 1);
      } catch (err) {
        // 不是 JSON，可能是文本消息
        const textMsg = this.buffer.slice(0, nullIndex).toString('utf8');
        console.log('服务器消息:', textMsg);
        this.buffer = this.buffer.slice(nullIndex + 1);
      }
    } else if (this.buffer.length > 0) {
      // 没有 \0，可能是普通文本消息
      const lines = this.buffer.toString('utf8').split('\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (lines[i].trim()) {
          console.log('服务器消息:', lines[i]);
        }
      }
      // 保留最后一行（可能不完整）
      this.buffer = Buffer.from(lines[lines.length - 1]);
    }
  }

  // 处理服务器 JSON 响应
  handleResponse(response) {
    console.log('收到响应:', response);
    
    if (response.type === 'ack_file_ready') {
      // 服务器准备好接收文件
      this.startPos = response.start_pos || 0;
      this.isWaitingAck = false;
      
      if (this.startPos > 0) {
        console.log(`✓ 断点续传，从位置 ${this.startPos} 继续`);
      }
      
      // 开始发送文件数据
      this.sendFileData();
      
    } else if (response.type === 'finish') {
      console.log('✓ 服务器确认:', response.message);
      this.disconnect();
      
    } else if (response.type === 'error') {
      console.error('✗ 服务器错误:', response.message);
      this.disconnect();
    }
  }

  // 计算文件 MD5
  async calculateMD5(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  // 上传文件
  async uploadFile(filePath) {
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }

    const stats = fs.statSync(filePath);
    const filename = path.basename(filePath);
    
    console.log('\n=== 文件上传 ===');
    console.log(`文件: ${filename}`);
    console.log(`大小: ${this.formatSize(stats.size)}`);
    console.log(`路径: ${filePath}`);
    
    // 计算 MD5
    console.log('\n计算 MD5...');
    const md5 = await this.calculateMD5(filePath);
    console.log(`MD5: ${md5}`);
    
    // 构建文件元数据消息
    const metadata = {
      type: 'file',
      filename: filename,
      size: stats.size,
      id: md5
    };
    
    this.currentFile = {
      path: filePath,
      size: stats.size,
      sent: 0,
      stream: null
    };
    
    // 发送元数据
    console.log('\n发送文件元数据...');
    const jsonString = JSON.stringify(metadata);
    this.socket.write(jsonString + '\0');
    this.isWaitingAck = true;
  }

  // 发送文件数据
  sendFileData() {
    if (!this.currentFile) {
      console.error('✗ 没有当前文件');
      return;
    }

    const startTime = Date.now();
    
    // 创建读取流，从 startPos 开始
    this.currentFile.stream = fs.createReadStream(this.currentFile.path, {
      start: this.startPos
    });
    
    this.currentFile.sent = this.startPos;
    let lastProgress = -1;

    console.log('\n开始传输文件...\n');

    this.currentFile.stream.on('data', (chunk) => {
      // 检查是否可以写入
      const canWrite = this.socket.write(chunk);
      this.currentFile.sent += chunk.length;
      
      // 显示进度
      const progress = Math.floor((this.currentFile.sent / this.currentFile.size) * 100);
      if (progress !== lastProgress && progress % 5 === 0) {
        const speed = this.calculateSpeed(this.currentFile.sent - this.startPos, Date.now() - startTime);
        console.log(`进度: ${progress}% (${this.formatSize(this.currentFile.sent)}/${this.formatSize(this.currentFile.size)}) - ${speed}`);
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
      
      console.log('\n✓ 文件发送完成');
      console.log(`总用时: ${duration} 秒`);
      console.log(`平均速度: ${avgSpeed}`);
      console.log('\n等待服务器确认...');
    });

    this.currentFile.stream.on('error', (err) => {
      console.error('✗ 读取文件错误:', err.message);
      this.disconnect();
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
    console.log('\n连接已关闭');
    process.exit(0);
  }
}

// 主函数
async function main() {
  // 解析命令行参数
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('用法: node tcp-client.js <文件路径> [服务器地址] [端口]');
    console.log('\n示例:');
    console.log('  node tcp-client.js ./test.txt');
    console.log('  node tcp-client.js ./test.txt 192.168.1.100');
    console.log('  node tcp-client.js ./test.txt 192.168.1.100 3000');
    console.log('\n参数说明:');
    console.log('  <文件路径>   - 要上传的文件路径（必需）');
    console.log('  [服务器地址] - 服务器 IP 地址（可选，默认: 127.0.0.1）');
    console.log('  [端口]       - 服务器端口（可选，默认: 3000）');
    process.exit(1);
  }

  const filePath = args[0];
  const host = args[1] || CONFIG.HOST;
  const port = parseInt(args[2]) || CONFIG.PORT;

  console.log('='.repeat(50));
  console.log('TCP 文件上传客户端');
  console.log('='.repeat(50));

  try {
    const client = new FileUploadClient(host, port);
    await client.connect();
    await client.uploadFile(filePath);
  } catch (err) {
    console.error('\n✗ 错误:', err.message);
    process.exit(1);
  }
}

// 运行
main();
