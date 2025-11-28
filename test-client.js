const net = require('net');
const fs = require('fs');

const PORT = 3000;
const HOST = '127.0.0.1';

// 创建客户端
const client = new net.Socket();

client.connect(PORT, HOST, () => {
  console.log('已连接到服务器\n');
  
  // 示例1: 发送文本消息
  sendTextMessage();
  
  // 示例2: 发送文件（2秒后）
  setTimeout(() => {
    sendFile('./index.js');
  }, 2000);
});

// 发送文本消息
function sendTextMessage() {
  const message = {
    type: 'text',
    content: 'Hello from client!'
  };
  
  const jsonString = JSON.stringify(message);
  const buffer = Buffer.from(jsonString + '\0'); // 添加 \0 结尾
  
  console.log('发送文本消息:', message);
  client.write(buffer);
}

// 发送文件
function sendFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error('文件不存在:', filePath);
    return;
  }
  
  const stats = fs.statSync(filePath);
  const filename = filePath.split('/').pop();
  
  // 1. 先发送 JSON 消息（文件元数据）
  const metadata = {
    type: 'file',
    filename: filename,
    size: stats.size,
    id: 'file_' + Date.now() // 简单的ID，实际应该用 MD5
  };
  
  const jsonString = JSON.stringify(metadata);
  const jsonBuffer = Buffer.from(jsonString + '\0');
  
  console.log('\n发送文件元数据:', metadata);
  client.write(jsonBuffer);
  
  // 2. 等待服务器确认，然后发送文件内容
  setTimeout(() => {
    console.log('开始发送文件内容...');
    const fileStream = fs.createReadStream(filePath);
    
    let sentBytes = 0;
    fileStream.on('data', (chunk) => {
      client.write(chunk);
      sentBytes += chunk.length;
      console.log(`已发送: ${sentBytes}/${stats.size} 字节 (${(sentBytes/stats.size*100).toFixed(1)}%)`);
    });
    
    fileStream.on('end', () => {
      console.log('文件发送完成！\n');
    });
    
    fileStream.on('error', (err) => {
      console.error('读取文件错误:', err);
    });
  }, 500);
}

// 接收服务器消息
client.on('data', (data) => {
  console.log('服务器响应:', data.toString());
});

client.on('close', () => {
  console.log('连接已关闭');
  process.exit(0);
});

client.on('error', (err) => {
  console.error('连接错误:', err.message);
  process.exit(1);
});
