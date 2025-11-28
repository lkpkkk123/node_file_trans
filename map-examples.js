// JavaScript Map 使用示例

// ===== 1. 创建 Map =====
const map1 = new Map();
const map2 = new Map([
  ['key1', 'value1'],
  ['key2', 'value2']
]);

// ===== 2. 添加元素 (set) =====
const clients = new Map();
const socket1 = { id: 1 }; // 模拟 socket 对象
const socket2 = { id: 2 };

clients.set(socket1, { name: 'Client A', messages: 0 });
clients.set(socket2, { name: 'Client B', messages: 0 });

console.log('Map 大小:', clients.size); // 2

// ===== 3. 获取元素 (get) =====
const clientA = clients.get(socket1);
console.log('获取客户端:', clientA); // { name: 'Client A', messages: 0 }

// ===== 4. 检查是否存在 (has) =====
if (clients.has(socket1)) {
  console.log('socket1 存在于 Map 中');
}

// ===== 5. 删除元素 (delete) =====
clients.delete(socket1);
console.log('删除后大小:', clients.size); // 1

// ===== 6. 遍历 Map =====

// 方法 1: forEach
clients.set(socket1, { name: 'Client A', messages: 5 });
clients.forEach((value, key) => {
  console.log('Socket ID:', key.id, 'Client:', value.name);
});

// 方法 2: for...of 遍历键值对
for (const [socket, client] of clients) {
  console.log('Socket:', socket.id, 'Client:', client.name);
}

// 方法 3: 只遍历键
for (const socket of clients.keys()) {
  console.log('Socket ID:', socket.id);
}

// 方法 4: 只遍历值
for (const client of clients.values()) {
  console.log('Client:', client.name);
}

// ===== 7. 清空 Map (clear) =====
clients.clear();
console.log('清空后大小:', clients.size); // 0

// ===== 8. Map vs Object =====
/*
Map 的优势：
1. 键可以是任何类型（对象、函数、基本类型）
2. 有 size 属性，获取大小更方便
3. 遍历顺序是插入顺序
4. 性能更好（频繁增删）
5. 更安全（没有原型链污染）

Object 适用场景：
1. 简单的键值对（字符串键）
2. 需要 JSON 序列化
*/

// ===== 9. 实际应用示例：Socket 到 Client 映射 =====
class Client {
  constructor(socket, username) {
    this.socket = socket;
    this.username = username;
    this.joinTime = new Date();
    this.messageCount = 0;
  }

  sendMessage(msg) {
    console.log(`发送给 ${this.username}: ${msg}`);
    this.messageCount++;
  }
}

const socketClientMap = new Map();

// 添加客户端
const sock1 = { id: 'socket_1' };
const sock2 = { id: 'socket_2' };

socketClientMap.set(sock1, new Client(sock1, 'Alice'));
socketClientMap.set(sock2, new Client(sock2, 'Bob'));

// 通过 socket 查找客户端
const aliceClient = socketClientMap.get(sock1);
if (aliceClient) {
  aliceClient.sendMessage('Hello!');
}

// 广播消息（除了发送者）
function broadcast(senderSocket, message) {
  socketClientMap.forEach((client, socket) => {
    if (socket !== senderSocket) {
      client.sendMessage(message);
    }
  });
}

broadcast(sock1, 'Alice 说: 大家好！');

// 移除客户端
socketClientMap.delete(sock1);
console.log('剩余客户端:', socketClientMap.size);
