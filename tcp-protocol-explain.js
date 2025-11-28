// ========== TCP 拆包/粘包问题详解 ==========

/*
TCP 拆包/粘包问题：

1. 拆包（Fragmentation）：
   一个完整的消息被分成多个 TCP 包发送
   
   发送端: [JSON消息: {"type":"file"}]
   网络层: [{"type] [":"file"}]
   接收端: 第1次收到 {"type  第2次收到 ":"file"}

2. 粘包（Concatenation）：
   多个消息合并在一个 TCP 包中发送
   
   发送端: [消息1] [消息2] [消息3]
   网络层: [消息1消息2消息3]
   接收端: 一次收到 消息1消息2消息3


3. 混合情况：
   发送端: [消息1] [消息2] [消息3]
   网络层: [消息1+消息2的一半] [消息2的另一半+消息3]
*/

// ========== 解决方案 ==========

console.log('=== TCP 消息分包方案 ===\n');

// 方案1: 固定长度
console.log('1. 固定长度分包');
console.log('   每个消息固定 N 字节');
console.log('   优点: 简单');
console.log('   缺点: 浪费空间\n');

// 方案2: 分隔符（你当前使用的）
console.log('2. 分隔符分包（\\0 结尾）');
console.log('   消息格式: JSON内容 + \\0');
console.log('   优点: 简单，节省空间');
console.log('   缺点: 消息内容不能包含分隔符\n');

// 方案3: 长度前缀（最常用）
console.log('3. 长度前缀分包');
console.log('   消息格式: [4字节长度] + [消息内容]');
console.log('   优点: 高效，可靠');
console.log('   缺点: 略复杂\n');

// 方案4: 混合方案
console.log('4. 混合方案');
console.log('   消息格式: [头部: 类型+长度] + [消息体]');
console.log('   优点: 最灵活');
console.log('   缺点: 实现复杂\n');


// ========== 代码示例：长度前缀方案 ==========

console.log('\n=== 长度前缀方案示例 ===\n');

class MessageProtocol {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  // 编码消息（添加长度前缀）
  encode(message) {
    const msgBuffer = Buffer.from(JSON.stringify(message), 'utf8');
    const lenBuffer = Buffer.alloc(4);
    lenBuffer.writeUInt32BE(msgBuffer.length, 0); // 4字节长度（大端序）
    
    return Buffer.concat([lenBuffer, msgBuffer]);
  }

  // 解码消息（处理拆包/粘包）
  decode(chunk) {
    const messages = [];
    
    // 追加新数据到缓冲区
    this.buffer = Buffer.concat([this.buffer, chunk]);
    
    while (this.buffer.length >= 4) {
      // 读取消息长度（前4字节）
      const msgLength = this.buffer.readUInt32BE(0);
      
      // 检查是否收到完整消息
      if (this.buffer.length < 4 + msgLength) {
        // 数据不完整，等待更多数据
        console.log(`  等待数据: 需要 ${4 + msgLength} 字节, 已有 ${this.buffer.length} 字节`);
        break;
      }
      
      // 提取完整消息
      const msgBuffer = this.buffer.slice(4, 4 + msgLength);
      const message = JSON.parse(msgBuffer.toString('utf8'));
      messages.push(message);
      
      // 移除已处理的数据
      this.buffer = this.buffer.slice(4 + msgLength);
      
      console.log(`  解析成功: ${JSON.stringify(message)}`);
    }
    
    return messages;
  }
}

// 测试长度前缀方案
const protocol = new MessageProtocol();

console.log('编码消息:');
const msg1 = { type: 'text', content: 'Hello' };
const encoded = protocol.encode(msg1);
console.log(`  原始消息: ${JSON.stringify(msg1)}`);
console.log(`  编码后长度: ${encoded.length} 字节`);
console.log(`  前4字节(长度): ${encoded.readUInt32BE(0)}`);
console.log('');

console.log('模拟拆包接收:');
// 模拟消息被拆成3个包
const part1 = encoded.slice(0, 5);
const part2 = encoded.slice(5, 10);
const part3 = encoded.slice(10);

console.log('收到第1个包 (5字节):');
let result = protocol.decode(part1);
console.log(`  解析出 ${result.length} 条消息\n`);

console.log('收到第2个包 (5字节):');
result = protocol.decode(part2);
console.log(`  解析出 ${result.length} 条消息\n`);

console.log('收到第3个包 (剩余):');
result = protocol.decode(part3);
console.log(`  解析出 ${result.length} 条消息\n`);


// ========== 代码示例：分隔符方案（你的方案）==========

console.log('\n=== 分隔符方案示例（\\0结尾）===\n');

class NullTerminatedProtocol {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  // 编码消息（添加 \0）
  encode(message) {
    const jsonString = JSON.stringify(message);
    return Buffer.from(jsonString + '\0', 'utf8');
  }

  // 解码消息
  decode(chunk) {
    const messages = [];
    
    // 追加数据
    this.buffer = Buffer.concat([this.buffer, chunk]);
    
    // 查找所有的 \0
    let nullIndex;
    while ((nullIndex = this.buffer.indexOf(0)) !== -1) {
      // 提取消息
      const msgBuffer = this.buffer.slice(0, nullIndex);
      const message = JSON.parse(msgBuffer.toString('utf8'));
      messages.push(message);
      
      // 移除已处理的数据（包括 \0）
      this.buffer = this.buffer.slice(nullIndex + 1);
      
      console.log(`  解析成功: ${JSON.stringify(message)}`);
    }
    
    if (this.buffer.length > 0) {
      console.log(`  缓冲区剩余: ${this.buffer.length} 字节（不完整的消息）`);
    }
    
    return messages;
  }
}

const protocol2 = new NullTerminatedProtocol();

console.log('编码消息:');
const msg2 = { type: 'file', filename: 'test.txt' };
const encoded2 = protocol2.encode(msg2);
console.log(`  原始消息: ${JSON.stringify(msg2)}`);
console.log(`  编码后: ${encoded2.toString()}`);
console.log('');

console.log('模拟拆包接收:');
const p1 = encoded2.slice(0, 15);
const p2 = encoded2.slice(15);

console.log('收到第1个包:');
protocol2.decode(p1);
console.log('');

console.log('收到第2个包:');
protocol2.decode(p2);
console.log('');


// ========== 粘包测试 ==========

console.log('\n=== 粘包测试（多个消息合并）===\n');

const protocol3 = new NullTerminatedProtocol();

const msg3 = { id: 1, text: 'First' };
const msg4 = { id: 2, text: 'Second' };
const msg5 = { id: 3, text: 'Third' };

// 将3个消息合并成一个包
const combined = Buffer.concat([
  protocol3.encode(msg3),
  protocol3.encode(msg4),
  protocol3.encode(msg5)
]);

console.log('一次性发送3个消息（粘包）:');
const results = protocol3.decode(combined);
console.log(`成功解析 ${results.length} 条消息\n`);


// ========== 总结 ==========
console.log('\n=== 总结 ===\n');
console.log(`
你的实现方案：
✓ 使用 Buffer 缓冲区存储不完整数据
✓ JSON 消息以 \\0 结尾
✓ 使用 indexOf(0) 查找消息边界
✓ 处理完整消息后移除已处理的数据

关键代码逻辑：
1. this.buffer = Buffer.concat([this.buffer, chunk])  // 追加数据
2. const nullIndex = this.buffer.indexOf(0)           // 查找分隔符
3. if (nullIndex === -1) return                       // 不完整，等待
4. const msg = this.buffer.slice(0, nullIndex)        // 提取消息
5. this.buffer = this.buffer.slice(nullIndex + 1)     // 移除已处理

优点：
✓ 实现简单
✓ 消息长度灵活
✓ 适合文本消息

注意事项：
⚠ JSON 内容不能包含 \\0 字符
⚠ 需要正确处理 UTF-8 编码
⚠ 缓冲区需要及时清理
`);
