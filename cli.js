const { FileUploadClient } = require('./tcp-client.js');
const path = require('path');

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
  let serverDir = '.';
  if (args.indexOf('--dir') !== -1) {
    serverDir = args[args.indexOf('--dir') + 1];
    console.log(`服务器目录设置为: ${serverDir}`);
    args.splice(args.indexOf('--dir'), 2);
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
  const host = args[1];
  const port = parseInt(args[2]);
  
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
          
          await client.uploadFile(testFilePath,serverDir, md5SumEnabled);
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
    let serverPath=serverDir+path.sep+path.basename(filePath);
    await client.uploadFile(filePath,serverPath, md5SumEnabled);
  } catch (err) {
    console.error('\n✗ 错误:', err.message);
    process.exit(1);
  }
}

// 运行
main();
//让进程不要退出