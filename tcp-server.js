const net = require('net');
const fs = require('fs');
//const { type } = require('os');
// 配置
const PORT = 3000;
const HOST = '0.0.0.0';
const PATH = '/opt/uploads';

const clients = new Map();
const files = new Map();
class myFile{
  constructor(id, filename, size) {
    this.id = id;//id就是文件md5值
    this.filename = filename;
    this.size = size;//总大小
    this.writtenSize = 0;//已经写入的大小
    this.writeQueue = []; // 写入队列
    this.hasError = false; // 标记是否发生错误
    this.isClosed = false; // 标记是否已关闭
    this.Open(0,filename);
    
  }
    
  Open(startPos,fileName) {
    // 关闭现有流（如果打开的话）
    if (this.stream && !this.isClosed) {
      this.stream.end();
      return true;
    }
    // 重新创建写入流，指定起始位置
    if (startPos > 0)
    {
      this.stream = fs.createWriteStream(`${PATH}/${fileName}`, { flags: 'r+', start: startPos });
    }
    else {
      this.stream = fs.createWriteStream(`${PATH}/${fileName}`);
    }
    
    // 监听 open 事件（文件成功打开）
    this.stream.on('open', (fd) => {
      console.log(`[文件] ${this.filename} 成功打开，文件描述符: ${fd}`);
    });

    // 监听 drain 事件，当缓冲区清空时触发
    this.stream.on('drain', () => {
      console.log(`[文件] ${this.filename} 缓冲区已清空，可以继续写入`);
      this.processQueue();
    });

    // 监听错误事件 - 需要清理资源
    this.stream.on('error', (err) => {
      console.error(`[文件错误] ${this.filename}: ${err.message}`);
      this.hasError = true;
      
      // 尝试关闭流（可能文件未打开成功）
      this.cleanup();
    });

    // 监听 finish 事件，当文件完全写入并关闭时触发
    this.stream.on('finish', () => {
      console.log(`[文件] ${this.filename} 写入完成`);
    });

    // 监听 close 事件
    this.stream.on('close', () => {
      console.log(`[文件] ${this.filename} 流已关闭`);
      this.isClosed = true;
    });
  }

  // 写入数据（处理背压）
  write(data) {
    // 检查是否发生错误
    if (this.hasError) {
      console.error(`[文件] ${this.filename} 已发生错误，拒绝写入`);
      return false;
    }

    if (this.isClosed) {
      console.error(`[文件] ${this.filename} 已关闭，拒绝写入`);
      return false;
    }

    const err = this.processQueue();//处理队列里之前没写进入的数据
    if (!err)
    {
      return false;
    }
    // write() 返回 false 表示内部缓冲区已满，需要等待 drain 事件
    const canWrite = this.stream.write(data);
    this.writtenSize += data.length;

    if (!canWrite) {
      console.log(`[文件] ${this.filename} 缓冲区已满，放入队列...`);
      // 缓冲区满了，暂停写入
      this.writeQueue.push(data);
      return true;
    }
    return true;
  }


  processQueue() {
    while (this.writeQueue.length > 0) {
      const data = this.writeQueue.shift();
      const canWrite = this.stream.write(data);
      this.writtenSize += data.length;

      if (!canWrite) {
        console.log(`[文件] ${this.filename} 缓冲区再次满，继续放入队列... queue长度:${this.writeQueue.length}`);
        // 缓冲区满了，停止处理队列
        this.writeQueue.unshift(data); // 把数据放回队列开头
        if(this.writeQueue.length > 100){
          return false;//队列太长返回失败
        }
        return true;
      }
    }
    return true;
  }

  isComplete() {
    return this.writtenSize >= this.size;
  }

  // 关闭文件并确保数据写入磁盘
  async close() {
    return new Promise((resolve, reject) => {
      if (this.isClosed) {
        resolve();
        return;
      }

      // end() 会刷新缓冲区并关闭文件
      this.stream.end(() => {
        console.log(`[文件] ${this.filename} 已关闭`);
        resolve();
      });

      this.stream.on('error', reject);
    });
  }

  // 清理资源（在错误情况下调用）
  cleanup() {
    if (!this.isClosed && this.stream) {
      try {
        // 销毁流，不等待缓冲区清空
        this.stream.destroy();
        console.log(`[文件] ${this.filename} 流已销毁`);
      } catch (err) {
        console.error(`[文件] ${this.filename} 销毁流时出错: ${err.message}`);
      }
    }
    
    // 清空队列
    this.writeQueue = [];
  }
}
// 客户端类
class mySession {
  constructor(socket) {
    this.socket = socket;
    this.address = `${socket.remoteAddress}:${socket.remotePort}`;
    this.connectTime = new Date();
    this.messageCount = 0;
    this.buffer = Buffer.alloc(0); // 缓冲区，存储不完整的数据
    this.isFirstMessage = true; // 标记是否是第一个消息
    this.jsonMessage = null; // 存储解析后的 JSON 消息
    
    console.log(`[新客户端] ${this.address} 已连接`);
    socket.on('data', this.onData.bind(this));
      
    // 处理客户端断开连接
    socket.on('close', this.onClose.bind(this));

    // 处理错误
    socket.on('error', this.onError.bind(this));
  }

  // 发送消息给客户端
  send(message) {
    if (!this.socket.destroyed) {
      this.socket.write(message);
    }
  }

  // 处理接收到的数据（处理拆包/粘包）
  onData(chunk) {
    // 将新数据追加到缓冲区
    this.buffer = Buffer.concat([this.buffer, chunk]);
    
    // 处理第一个消息（JSON，以 \0 结尾）
    if (this.isFirstMessage) {
      this.processJsonMessage();
    } else {
      // 处理后续的二进制数据
      const result = this.processBinaryData();
      if (result === 0) {
        // 处理错误，关闭连接
        let resp = {
          type: 'error',
          message: '文件写入失败'
        };
        this.socket.end(JSON.stringify(resp) + '\0');
      }
      else if (result === 2) {
        let resp = {
          type: 'finish',
          message: '文件传输完成'
        };
        this.socket.end(JSON.stringify(resp) + '\0');
      }
    }
  }
  // 处理 JSON 消息（以 \0 结尾）
  processJsonMessage() {
    // 查找 \0 的位置
    const nullIndex = this.buffer.indexOf(0);
    
    if (nullIndex === -1) {
      // 还没有收到完整的消息，继续等待
      console.log(`[JSON] ${this.address} 收到部分数据，等待更多... (已收到: ${this.buffer.length} 字节)`);
      return;
    }
    
    // 找到了 \0，提取完整的 JSON 消息
    const jsonBuffer = this.buffer.slice(0, nullIndex);
    const jsonString = jsonBuffer.toString('utf8');
    
    try {
      this.jsonMessage = JSON.parse(jsonString);
      console.log(`[JSON] ${this.address} 接收到完整消息:`, this.jsonMessage);
      
      // 处理 JSON 消息
      this.handleJsonMessage(this.jsonMessage);
      
      // 移除已处理的数据（包括 \0）
      this.buffer = this.buffer.slice(nullIndex + 1);
      this.isFirstMessage = false;
      
      // 如果缓冲区还有数据，继续处理
      if (this.buffer.length > 0) {
        this.processBinaryData();
      }
      
    } catch (err) {
      console.error(`[JSON错误] ${this.address} 解析失败: ${err.message}`);
      console.error('原始数据:', jsonString);
      // 可以选择关闭连接或发送错误消息
      this.socket.end('JSON解析错误\n');
    }
  }

  // 处理 JSON 消息内容
  handleJsonMessage(msg) {
    // 根据消息类型进行处理
    if (msg.type === 'file') {
      // 文件传输消息
      console.log(`[文件传输] 文件名: ${msg.filename}, 大小: ${msg.size}, MD5: ${msg.id}`);
      
      // 创建文件对象
      const file = new myFile(msg.id, msg.filename, msg.size);
      let resp = {
        type: 'ack_file_ready',
        start_pos:0,
      };
      //查看map是否已经存在文件，如果存在根据md5值和文件名判断是否是断点续传的文件
      if (files.has(msg.id) && files[msg.id].filename === msg.filename)
      {//断点续传的文件，获取文件的大小
        resp.start_pos = files[msg.id].writtenSize;
        this.currentFile = files.get(msg.id);
        this.currentFile.Open(resp.start_pos,msg.filename);
        console.log(`[断点续传] 继续传输文件 ${msg.filename} 从位置 ${resp.start_pos}`);
      }
      else {
        files.set(msg.id, file);
        this.currentFile = file;
      }
      

      this.send(JSON.stringify(resp) + '\0');
      
    } else if (msg.type === 'text') {
      // 文本消息
      console.log(`[文本消息] ${msg.content}`);
      this.send(`收到: ${msg.content}\n`);
      
    } else {
      console.log(`[未知类型] ${msg.type}`);
    }
  }

  // 处理二进制数据
  processBinaryData() {
    if (!this.currentFile) {
      console.error(`[错误] ${this.address} 没有当前文件对象`);
      return 0;
    }
    
    // 计算还需要接收多少数据
    const remaining = this.currentFile.size - this.currentFile.writtenSize;
    const toWrite = Math.min(this.buffer.length, remaining);
    
    if (toWrite > 0) {
      // 提取要写入的数据
      const dataToWrite = this.buffer.slice(0, toWrite);
      
      // 写入文件
      const success = this.currentFile.write(dataToWrite);
      if (!success) {
        console.error(`[错误] ${this.address} 写入文件失败`);
        this.socket.end('写入失败\n');
        return 0;
      }
      
      // 移除已处理的数据
      this.buffer = this.buffer.slice(toWrite);
      
      console.log(`[数据] ${this.address} 写入 ${toWrite} 字节, 进度: ${this.currentFile.writtenSize}/${this.currentFile.size}`);
    }
    
    // 检查文件是否完成
    if (this.currentFile.isComplete()) {
      console.log(`[完成] ${this.address} 文件传输完成: ${this.currentFile.filename}`);
      this.currentFile.close();
      this.currentFile = null;
      this.send('文件接收完成\n');
      
      // 重置为等待下一个 JSON 消息
      this.isFirstMessage = true;
      return 2;//表示文件接收完成
    }
    return 1;//表示继续接收数据
  }

  onError(err) {
    console.error(`[错误] ${this.address}: ${err.message}`);
    clients.delete(this.socket);
    
  }
  onClose() {
    console.log(`[断开] 客户端已断开: ${this.address}`);
    clients.delete(this.socket);
    console.log('当前连接数:', clients.size);
  }

  // 获取客户端信息
  getInfo() {
    return {
      address: this.address,
      connectTime: this.connectTime,
      messageCount: this.messageCount
    };
  }
}

// 创建 TCP 服务器
const server = net.createServer((socket) => {
  const clientAddress = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`[连接] 新客户端已连接: ${clientAddress}`);

  // 创建客户端实例并添加到 Map 中
  const client = new mySession(socket);
  clients.set(socket, client);
  console.log(`当前连接数: ${clients.size}`);

  // 发送欢迎消息
  client.send('欢迎连接到 TCP 服务器！\n');
  client.send('输入消息后按回车发送\n');
  client.send('命令: "quit" 退出, "list" 查看在线用户\n');

});

// 广播消息给所有客户端（除了发送者）
function broadcast(senderSocket, message) {
  clients.forEach((client, socket) => {
    if (socket !== senderSocket && !socket.destroyed) {
      client.send(message);
    }
  });
}

// 启动服务器
server.listen(PORT, HOST, () => {
  console.log(`TCP 服务器运行在 ${HOST}:${PORT}`);
  console.log('等待客户端连接...');
  console.log('使用 telnet 或 nc 命令连接: telnet 127.0.0.1 3000');
});

// 处理服务器错误
server.on('error', (err) => {
  console.error('服务器错误:', err.message);
  process.exit(1);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n正在关闭服务器...');
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});
