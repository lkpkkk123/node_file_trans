const net = require('net');

// 演示发送消息后立即关闭的问题

console.log('=== 测试 TCP 消息发送问题 ===\n');

// 创建服务器
const server = net.createServer((socket) => {
  const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`[服务器] 客户端连接: ${clientId}`);
  
  setTimeout(() => {
    console.log('\n--- 测试1: 立即关闭（可能丢失消息）---');
    const badServer = net.createServer((s) => {
      console.log('[Bad] 客户端连接');
      s.end('这条消息可能看不到\n'); // ❌ 立即关闭
    });
    
    badServer.listen(3001, () => {
      const client1 = new net.Socket();
      client1.connect(3001, 'localhost', () => {
        console.log('[客户端1] 已连接');
      });
      
      client1.on('data', (data) => {
        console.log('[客户端1] 收到:', data.toString());
      });
      
      client1.on('end', () => {
        console.log('[客户端1] 连接关闭');
        badServer.close();
      });
    });
  }, 1000);
  
  setTimeout(() => {
    console.log('\n--- 测试2: 延迟关闭（确保消息发送）---');
    const goodServer = net.createServer((s) => {
      console.log('[Good] 客户端连接');
      s.write('这条消息能看到\n'); // ✅ 先发送
      setTimeout(() => {
        s.end(); // 100ms 后关闭
        console.log('[Good] 延迟关闭');
      }, 100);
    });
    
    goodServer.listen(3002, () => {
      const client2 = new net.Socket();
      client2.connect(3002, 'localhost', () => {
        console.log('[客户端2] 已连接');
      });
      
      client2.on('data', (data) => {
        console.log('[客户端2] 收到:', data.toString());
      });
      
      client2.on('end', () => {
        console.log('[客户端2] 连接关闭');
        goodServer.close();
      });
    });
  }, 3000);
  
  setTimeout(() => {
    console.log('\n--- 测试3: 使用回调确保发送 ---');
    const callbackServer = net.createServer((s) => {
      console.log('[Callback] 客户端连接');
      
      // 使用 write 的回调
      s.write('使用回调确保发送\n', (err) => {
        if (err) {
          console.error('[Callback] 发送失败:', err);
        } else {
          console.log('[Callback] 消息已发送，现在可以安全关闭');
          s.end();
        }
      });
    });
    
    callbackServer.listen(3003, () => {
      const client3 = new net.Socket();
      client3.connect(3003, 'localhost', () => {
        console.log('[客户端3] 已连接');
      });
      
      client3.on('data', (data) => {
        console.log('[客户端3] 收到:', data.toString());
      });
      
      client3.on('end', () => {
        console.log('[客户端3] 连接关闭');
        callbackServer.close();
      });
    });
  }, 5000);
  
  setTimeout(() => {
    console.log('\n--- 测试4: drain 事件（大数据）---');
    const drainServer = net.createServer((s) => {
      console.log('[Drain] 客户端连接');
      
      // 发送大量数据
      const largeData = 'X'.repeat(100000);
      const canWrite = s.write(largeData + '\n');
      
      if (!canWrite) {
        console.log('[Drain] 缓冲区满，等待 drain');
        s.once('drain', () => {
          console.log('[Drain] 缓冲区已清空，安全关闭');
          s.end();
        });
      } else {
        console.log('[Drain] 缓冲区未满，延迟关闭');
        setTimeout(() => s.end(), 100);
      }
    });
    
    drainServer.listen(3004, () => {
      const client4 = new net.Socket();
      client4.connect(3004, 'localhost', () => {
        console.log('[客户端4] 已连接');
      });
      
      let received = 0;
      client4.on('data', (data) => {
        received += data.length;
        console.log(`[客户端4] 收到 ${received} 字节`);
      });
      
      client4.on('end', () => {
        console.log(`[客户端4] 连接关闭，总共收到 ${received} 字节`);
        drainServer.close();
      });
    });
  }, 7000);
  
  setTimeout(() => {
    console.log('\n=== 总结 ===');
    console.log(`
1. socket.end(message)
   问题: 可能在消息发送前就关闭连接
   结果: 消息丢失

2. socket.write(message); setTimeout(() => socket.end(), 100)
   优点: 给予时间让消息发送
   结果: 大多数情况下能成功

3. socket.write(message, callback)
   优点: 确保消息写入缓冲区
   结果: 更可靠，但不保证已发送到对端

4. 等待 drain 事件
   优点: 确保缓冲区清空
   结果: 最可靠，适合大数据

推荐做法:
- 小消息: setTimeout 100ms
- 大数据: 监听 drain 事件
- 关键消息: 使用 write 回调 + setTimeout
    `);
    
    setTimeout(() => {
      server.close();
      process.exit(0);
    }, 2000);
  }, 10000);
});

server.listen(3000, () => {
  console.log('测试服务器启动在端口 3000\n');
  
  // 连接到测试服务器触发测试
  const trigger = new net.Socket();
  trigger.connect(3000, 'localhost');
});
