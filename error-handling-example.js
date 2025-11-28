const fs = require('fs');

// ========== 演示文件流错误处理 ==========

console.log('=== 1. 正常文件操作 ===\n');
const normalStream = fs.createWriteStream('test-normal.txt');

normalStream.on('open', (fd) => {
  console.log('✓ 文件成功打开，fd:', fd);
});

normalStream.on('error', (err) => {
  console.error('✗ 错误:', err.message);
});

normalStream.on('finish', () => {
  console.log('✓ 写入完成\n');
});

normalStream.write('正常数据\n');
normalStream.end();


// ========== 2. 权限错误 - 写入到不存在的目录 ==========
setTimeout(() => {
  console.log('=== 2. 写入到不存在的目录 ===\n');
  
  const badStream = fs.createWriteStream('/nonexistent/directory/file.txt');
  
  badStream.on('open', (fd) => {
    console.log('✓ 文件打开，fd:', fd);
  });
  
  badStream.on('error', (err) => {
    console.error('✗ 发生错误:', err.code, '-', err.message);
    console.log('→ 需要清理资源！');
    
    // 清理：销毁流
    if (!badStream.destroyed) {
      badStream.destroy();
      console.log('→ 流已销毁\n');
    }
  });
  
  badStream.write('测试数据\n');
}, 500);


// ========== 3. 磁盘满错误模拟 ==========
setTimeout(() => {
  console.log('=== 3. 写入后发生错误的处理 ===\n');
  
  const stream3 = fs.createWriteStream('test-error.txt');
  let hasError = false;
  
  stream3.on('error', (err) => {
    console.error('✗ 写入错误:', err.message);
    hasError = true;
    
    // 清理资源
    if (!stream3.destroyed) {
      stream3.destroy();
      console.log('→ 已销毁流');
    }
    
    // 删除不完整的文件
    if (fs.existsSync('test-error.txt')) {
      fs.unlinkSync('test-error.txt');
      console.log('→ 已删除不完整文件\n');
    }
  });
  
  stream3.write('部分数据\n');
  
  // 模拟在写入过程中发生错误
  // stream3.destroy(new Error('模拟磁盘满'));
  
  stream3.end();
}, 1000);


// ========== 4. 正确的错误处理模式 ==========
setTimeout(() => {
  console.log('=== 4. 推荐的错误处理模式 ===\n');
  
  class SafeFileWriter {
    constructor(filename) {
      this.filename = filename;
      this.stream = null;
      this.hasError = false;
      this.isClosed = false;
      
      try {
        this.stream = fs.createWriteStream(filename);
        this.setupListeners();
      } catch (err) {
        console.error('✗ 创建流失败:', err.message);
        this.hasError = true;
      }
    }
    
    setupListeners() {
      this.stream.on('open', (fd) => {
        console.log(`  ✓ ${this.filename} 打开成功 (fd: ${fd})`);
      });
      
      this.stream.on('error', (err) => {
        console.error(`  ✗ ${this.filename} 错误:`, err.message);
        this.hasError = true;
        this.cleanup();
      });
      
      this.stream.on('finish', () => {
        console.log(`  ✓ ${this.filename} 写入完成`);
      });
      
      this.stream.on('close', () => {
        console.log(`  ✓ ${this.filename} 已关闭`);
        this.isClosed = true;
      });
    }
    
    write(data) {
      if (this.hasError) {
        console.error(`  ✗ ${this.filename} 已发生错误，拒绝写入`);
        return false;
      }
      
      if (this.isClosed) {
        console.error(`  ✗ ${this.filename} 已关闭，拒绝写入`);
        return false;
      }
      
      if (!this.stream) {
        console.error(`  ✗ ${this.filename} 流不存在`);
        return false;
      }
      
      return this.stream.write(data);
    }
    
    async close() {
      return new Promise((resolve, reject) => {
        if (this.isClosed) {
          resolve();
          return;
        }
        
        if (!this.stream) {
          resolve();
          return;
        }
        
        this.stream.end(() => {
          resolve();
        });
        
        this.stream.on('error', reject);
      });
    }
    
    cleanup() {
      console.log(`  → 清理 ${this.filename} 的资源`);
      
      if (this.stream && !this.stream.destroyed) {
        this.stream.destroy();
      }
      
      // 如果需要，删除不完整的文件
      if (this.hasError && fs.existsSync(this.filename)) {
        try {
          fs.unlinkSync(this.filename);
          console.log(`  → 已删除不完整文件: ${this.filename}`);
        } catch (err) {
          console.error('  ✗ 删除文件失败:', err.message);
        }
      }
    }
  }
  
  // 测试成功场景
  const writer1 = new SafeFileWriter('test-safe-1.txt');
  writer1.write('安全数据 1\n');
  writer1.write('安全数据 2\n');
  writer1.close().then(() => {
    console.log('  ✓ writer1 关闭成功\n');
  });
  
  // 测试失败场景
  setTimeout(() => {
    const writer2 = new SafeFileWriter('/nonexistent/path/file.txt');
    writer2.write('这不会被写入\n');
  }, 500);
  
}, 1500);


// ========== 5. destroy() vs end() 的区别 ==========
setTimeout(() => {
  console.log('\n=== 5. destroy() vs end() 的区别 ===\n');
  
  // end() - 正常关闭，等待缓冲区清空
  const stream1 = fs.createWriteStream('test-end.txt');
  stream1.write('数据 1\n');
  stream1.write('数据 2\n');
  stream1.end(() => {
    console.log('✓ end() - 所有数据已写入并关闭');
  });
  
  setTimeout(() => {
    // destroy() - 立即关闭，不等待缓冲区
    const stream2 = fs.createWriteStream('test-destroy.txt');
    stream2.write('数据 1\n');
    stream2.write('数据 2\n');
    stream2.destroy(); // 可能丢失数据
    console.log('⚠ destroy() - 立即关闭，可能丢失数据');
  }, 200);
  
}, 3000);


// ========== 清理测试文件 ==========
setTimeout(() => {
  console.log('\n=== 清理测试文件 ===\n');
  const files = [
    'test-normal.txt',
    'test-error.txt',
    'test-safe-1.txt',
    'test-end.txt',
    'test-destroy.txt'
  ];
  
  files.forEach(f => {
    if (fs.existsSync(f)) {
      fs.unlinkSync(f);
      console.log(`✓ 已删除: ${f}`);
    }
  });
  
  console.log('\n=== 总结 ===');
  console.log(`
1. 监听 'error' 事件是必须的
2. 发生错误时：
   - 设置错误标志，拒绝后续写入
   - 使用 destroy() 清理流
   - 考虑删除不完整的文件
   - 从 Map/列表中移除
3. 正常关闭使用 end()，错误时使用 destroy()
4. 检查 hasError 和 isClosed 状态
5. 监听 'open' 事件确认文件成功打开
  `);
}, 4000);
