const net = require('net');

// 配置
const PORT = 3000;
const HOST = '127.0.0.1';

// 创建客户端连接
const client = new net.Socket();

// 连接到服务器
client.connect(PORT, HOST, () => {
  console.log(`已连接到服务器 ${HOST}:${PORT}`);
  console.log('输入消息后按回车发送，输入 "quit" 退出\n');
});

// 接收服务器消息
client.on('data', (data) => {
  process.stdout.write(data.toString());
});

// 处理连接关闭
client.on('close', () => {
  console.log('连接已关闭');
  process.exit(0);
});

// 处理错误
client.on('error', (err) => {
  console.error('连接错误:', err.message);
  process.exit(1);
});

// 从标准输入读取用户输入
process.stdin.on('data', (data) => {
  client.write(data);
});
