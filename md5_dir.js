const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 计算文件 MD5
function calcFileMD5(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// 递归遍历目录
async function traverseDirectory(dir, baseDir, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      await traverseDirectory(fullPath, baseDir, results);
    } else if (entry.isFile()) {
      const relativePath = path.relative(baseDir, fullPath);
      const md5 = await calcFileMD5(fullPath);
      results.push({ path: relativePath, md5 });
      console.log(`${relativePath}  ${md5}`);
    }
  }
  
  return results;
}

// 主函数
async function main() {
  const targetDir = process.argv[2] || '.';
  
  if (!fs.existsSync(targetDir)) {
    console.error(`错误: 目录不存在 ${targetDir}`);
    process.exit(1);
  }
  
  if (!fs.statSync(targetDir).isDirectory()) {
    console.error(`错误: ${targetDir} 不是目录`);
    process.exit(1);
  }
  
  console.log(`正在扫描目录: ${targetDir}\n`);
  await traverseDirectory(targetDir, targetDir);
}

main().catch(err => {
  console.error('错误:', err);
  process.exit(1);
});
