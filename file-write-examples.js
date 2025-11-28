const fs = require('fs');

// ========== 1. 异步写入的问题 ==========
console.log('=== 演示异步写入问题 ===\n');

const file1 = fs.createWriteStream('test-async.txt');

// write() 是异步的，不等待写入完成
file1.write('第一行数据\n');
file1.write('第二行数据\n');
file1.write('第三行数据\n');

// 立即关闭可能导致数据丢失！
// file1.end(); // 不推荐

// 正确做法：使用回调确保写入
file1.end(() => {
  console.log('✓ 文件1写入完成\n');
});


// ========== 2. 检测背压（backpressure）==========
console.log('=== 演示背压处理 ===\n');

const file2 = fs.createWriteStream('test-backpressure.txt');
let canContinue = true;

// 写入大量数据
for (let i = 0; i < 100; i++) {
  canContinue = file2.write(`第 ${i} 行数据\n`);
  
  if (!canContinue) {
    console.log(`⚠ 缓冲区在第 ${i} 次写入时满了！`);
    
    // 等待 drain 事件后继续
    file2.once('drain', () => {
      console.log('✓ 缓冲区已清空，可以继续写入\n');
    });
    break;
  }
}

file2.end();


// ========== 3. 使用 Promise 确保写入完成 ==========
console.log('=== 使用 Promise 确保写入 ===\n');

function writeFileAsync(filename, data) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filename);
    
    stream.on('error', reject);
    stream.on('finish', () => {
      console.log(`✓ ${filename} 写入完成`);
      resolve();
    });
    
    // 写入数据
    stream.write(data);
    stream.end();
  });
}

// 使用 async/await
async function testPromise() {
  try {
    await writeFileAsync('test-promise.txt', '这是通过 Promise 写入的数据\n');
    console.log('✓ Promise 方式写入成功\n');
  } catch (err) {
    console.error('✗ 写入失败:', err);
  }
}

testPromise();


// ========== 4. 处理写入队列和背压 ==========
console.log('=== 使用队列处理写入 ===\n');

class SafeFileWriter {
  constructor(filename) {
    this.stream = fs.createWriteStream(filename);
    this.queue = [];
    this.isWriting = false;
    
    this.stream.on('drain', () => {
      console.log('  → 缓冲区已清空');
      this.processQueue();
    });

    this.stream.on('error', (err) => {
      console.error('  ✗ 写入错误:', err);
    });
  }

  write(data) {
    if (this.isWriting) {
      this.queue.push(data);
      console.log(`  排队: ${this.queue.length} 个待写入`);
      return;
    }

    const canWrite = this.stream.write(data);
    
    if (!canWrite) {
      console.log('  ⚠ 缓冲区满，暂停写入');
      this.isWriting = true;
    }
  }

  processQueue() {
    this.isWriting = false;
    if (this.queue.length > 0) {
      const data = this.queue.shift();
      console.log(`  处理队列: 剩余 ${this.queue.length} 个`);
      this.write(data);
    }
  }

  async close() {
    return new Promise((resolve) => {
      this.stream.end(() => {
        console.log('  ✓ 文件已安全关闭');
        resolve();
      });
    });
  }
}

const writer = new SafeFileWriter('test-queue.txt');
for (let i = 0; i < 10; i++) {
  writer.write(`队列数据 ${i}\n`);
}
writer.close();


// ========== 5. 使用 fsync 强制刷新到磁盘 ==========
console.log('\n=== 强制刷新到磁盘 ===\n');

const file3 = fs.createWriteStream('test-fsync.txt');

file3.write('重要数据\n');

// 获取文件描述符并强制刷新
file3.on('open', (fd) => {
  // 使用 fsync 确保数据写入磁盘
  fs.fsync(fd, (err) => {
    if (err) {
      console.error('✗ fsync 失败:', err);
    } else {
      console.log('✓ 数据已强制刷新到磁盘');
    }
    file3.end();
  });
});


// ========== 6. 监听所有重要事件 ==========
console.log('\n=== 监听所有事件 ===\n');

const file4 = fs.createWriteStream('test-events.txt');

file4.on('open', (fd) => {
  console.log('  open: 文件已打开，fd =', fd);
});

file4.on('drain', () => {
  console.log('  drain: 缓冲区已清空');
});

file4.on('finish', () => {
  console.log('  finish: 所有数据已写入完成');
});

file4.on('close', () => {
  console.log('  close: 文件已关闭');
});

file4.on('error', (err) => {
  console.log('  error: 发生错误', err);
});

file4.write('测试数据\n');
file4.end();


// ========== 总结 ==========
setTimeout(() => {
  console.log('\n=== 总结 ===');
  console.log('1. write() 是异步的，返回 boolean 表示是否可以继续写入');
  console.log('2. 返回 false 时表示缓冲区满，需要等待 drain 事件');
  console.log('3. 使用 end() 而不是 close() 来关闭文件');
  console.log('4. 监听 finish 事件确认写入完成');
  console.log('5. 使用 fsync() 强制刷新到磁盘');
  console.log('6. 使用 Promise/async-await 处理异步流程');
  
  // 清理测试文件
  setTimeout(() => {
    const files = [
      'test-async.txt',
      'test-backpressure.txt',
      'test-promise.txt',
      'test-queue.txt',
      'test-fsync.txt',
      'test-events.txt'
    ];
    files.forEach(f => {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
      }
    });
    console.log('\n✓ 测试文件已清理');
  }, 1000);
}, 2000);
