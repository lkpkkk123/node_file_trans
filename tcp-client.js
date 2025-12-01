const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 配置
const CONFIG = {
  HOST: '127.0.0.1',
  PORT: 3000,
  CHUNK_SIZE: 512 * 1024 // 512KB 每次读取，减少 syscalls
};

class FileUploadClient {
  constructor(host, port, enableResume = false, isTestMode = false) {
    this.host = host;
    this.port = port;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.currentFile = null;
    this.isWaitingAck = false;
    this.startPos = 0;
    this.enableResume = enableResume;
    this.lastMd5 = null;
    this.isTestMode = isTestMode;
    this.uploadComplete = null; // Promise resolver for test mode
  }

  // 连接到服务器
  connect() {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      
      this.socket.connect(this.port, this.host, () => {
        this.socket.setNoDelay(true);
        this.socket.setKeepAlive(true, 30000);
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
      if (response.server_md5) {
        const expected = (this.currentFile && this.currentFile.md5) || this.lastMd5;
        console.log(`服务器 MD5: ${response.server_md5}`);
        if (expected) {
          console.log(`本地 MD5: ${expected}`);
          const matches = typeof response.match === 'boolean' ? response.match : response.server_md5 === expected;
          if (matches) {
            console.log('✓ MD5 校验通过');
          } else {
            console.error('✗ MD5 校验失败，文件可能损坏');
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
  async uploadFile(filePath, useMd5 = false) {
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
    console.log(`断点续传: ${this.enableResume ? '开启' : '关闭'}`);
    
    // 计算 MD5
    let md5 = '';
    if(useMd5) {
      console.log('\n计算 MD5...');
      md5 = await this.calculateMD5(filePath);
      console.log(`MD5: ${md5}`);
    }
    
    // 构建文件元数据消息
    const metadata = {
      type: 'file',
      filename: filename,
      size: stats.size,
      id: md5,
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
      start: this.startPos,
      highWaterMark: CONFIG.CHUNK_SIZE
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
    if (!this.isTestMode) {
      process.exit(0);
    }
  }
}

// 主函数
async function main() {
  // 解析命令行参数
  const args = process.argv.slice(2);
  let resumeEnabled = false;
  const resumeFlagIndex = args.indexOf('--resume');
  const isTest = args.indexOf('--test');

  if (resumeFlagIndex !== -1) {
    resumeEnabled = true;
    args.splice(resumeFlagIndex, 1);
  }
  let md5SumEnabled = false;
  if (args.indexOf('--md5sum') !== -1) {
    md5SumEnabled = true;
    console.log('MD5 校验启用');
    args.splice(args.indexOf('--md5sum'), 1);
  }
  
  if (args.length === 0) {
    console.log('用法: node tcp-client.js <文件路径> [服务器地址] [端口]');
    console.log('\n示例:');
    console.log('  node tcp-client.js ./test.txt');
    console.log('  node tcp-client.js ./test.txt 192.168.1.100');
    console.log('  node tcp-client.js ./test.txt 192.168.1.100 3000 --resume');
    console.log('\n参数说明:');
    console.log('  <文件路径>   - 要上传的文件路径（必需）');
    console.log('  [服务器地址] - 服务器 IP 地址（可选，默认: 127.0.0.1）');
    console.log('  [端口]       - 服务器端口（可选，默认: 3000）');
    console.log('  [--resume]   - 开启断点续传（可选，默认关闭）');
    process.exit(1);
  }

  const filePath = args[0];
  const host = args[1] || CONFIG.HOST;
  const port = parseInt(args[2]) || CONFIG.PORT;
  
  // 测试模式：循环上传文件列表
  if (isTest !== -1) {
    args.splice(isTest, 1);
    
    const fileList = [
      '/home/likp/Downloads/SaperaLTSDKWow64Setup-9.00.zip',
      '/home/likp/Downloads/SDL2-2.24.0.zip',
      '/home/likp/Downloads/rec_20251021154452_20251021163600_64.mp4',
      '/home/likp/Downloads/NVIDIA-Linux-x86_64-550.135.run'
    ];
    
    console.log('='.repeat(50));
    console.log('TCP 文件上传客户端 - 测试模式');
    console.log('='.repeat(50));
    console.log(`文件列表: ${fileList.length} 个文件`);
    console.log('按 Ctrl+C 停止测试\n');
    
    let client = new FileUploadClient(host, port, resumeEnabled, true);
    await client.connect();
    
    let uploadCount = 0;
    while (true) {
      for (const testFilePath of fileList) {
        try {
          console.log(`\n[测试 #${++uploadCount}] 开始上传: ${path.basename(testFilePath)}`);
          
          // 创建 Promise 等待上传完成
          const uploadPromise = new Promise(resolve => {
            client.uploadComplete = resolve;
          });
          
          await client.uploadFile(testFilePath, md5SumEnabled);
          await uploadPromise;
          
          console.log(`[测试 #${uploadCount}] 完成\n`);
          
          // 短暂延迟避免过快
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (err) {
          console.error(`\n✗ 测试错误 (#${uploadCount}):`, err.message);
          console.log('重新连接...');
          client = new FileUploadClient(host, port, resumeEnabled, true);
          await client.connect();
        }
      }
    }
    return; // 测试模式不执行下面的单次上传
  }
  
  // 普通模式：单次上传
  console.log('='.repeat(50));
  console.log('TCP 文件上传客户端');
  console.log('='.repeat(50));

  try {
    const client = new FileUploadClient(host, port, resumeEnabled, false);
    await client.connect();
    await client.uploadFile(filePath, md5SumEnabled);
  } catch (err) {
    console.error('\n✗ 错误:', err.message);
    process.exit(1);
  }
}

// 运行
main();
//让进程不要退出

