const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const { FileUploadClient } = require('./fclient.js');
const logger = require('./logger.js');
const createLog=require('./logger.js').create;
createLog('watcher');


const { WatcherConfig: CONFIG } = require('./cfg.js');


// 正在上传的文件集合
//const uploadingFiles = new Set();
const pendingUploads = new Set();  // 延迟上传队列
const pendingDeletes = new Set();  // 删除队列上传队列

logger.info('='.repeat(60));
logger.info('文件监听自动上传服务');
logger.info('='.repeat(60));
logger.info(`监听目录: ${CONFIG.WATCH_DIR}`);
logger.info(`服务器: ${CONFIG.SERVER_HOST}:${CONFIG.SERVER_PORT}`);
logger.info(`虚拟目录: ${CONFIG.VIRTUAL_DIR}`);
logger.info(`MD5 校验: ${CONFIG.ENABLE_MD5 ? '开启' : '关闭'}`);
logger.info(`断点续传: ${CONFIG.ENABLE_RESUME ? '开启' : '关闭'}`);
logger.info('='.repeat(60));
logger.info();

// 确保监听目录存在
if (!fs.existsSync(CONFIG.WATCH_DIR)) {
  logger.info(`[系统] 创建监听目录: ${CONFIG.WATCH_DIR}`);
  fs.mkdirSync(CONFIG.WATCH_DIR, { recursive: true });
}

// 主函数
(async function main() {
  const client = new FileUploadClient(
    CONFIG.SERVER_HOST,
    CONFIG.SERVER_PORT,
    true,  // 不是测试模式
    CONFIG.ENABLE_MD5,
    CONFIG.VIRTUAL_DIR
  );
  try {
    await client.connect();
  } catch (err) {
    logger.error('✗ 无法连接到服务器，退出程序');
    // 等待日志写入
    await new Promise(resolve => setTimeout(resolve, 100));
    process.exit(1);
  }

  // 上传文件函数
  async function uploadFile(filePath) {
    const fileName = path.basename(filePath);
    
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      logger.info(`[跳过] ${fileName} - 文件不存在`);
      return true;
    }

    // 检查文件大小
    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      logger.info(`[跳过] ${fileName} - 文件为空`);
      return true;
    }

    try {
      logger.info(`\n[上传] ${fileName} (${formatSize(stats.size)})`);
      
      const uploadPromise = new Promise((resolve, reject) => {
        client.uploadComplete = resolve;
        client.uploadFailed = reject;
      });
      if(!client.isConnected()) {
        logger.info('重新连接服务器...');
        await client.connect();
      }
      let relativePath = filePath.replace(CONFIG.WATCH_DIR + path.sep, '');
      relativePath = CONFIG.VIRTUAL_DIR + path.sep + relativePath;
      let resumeEnabled = CONFIG.ENABLE_RESUME;
      if (resumeEnabled) {
        const ext = path.extname(fileName).toLowerCase();
        if (CONFIG.FILE_DISABLE_RESUME.includes(ext)) {
          resumeEnabled = false;
          //logger.info(`[提示] ${fileName} 的扩展名在不支持断点续传列表中，禁用断点续传`);
        }
      }
      await client.uploadFile(filePath, relativePath, resumeEnabled, CONFIG.ENABLE_MD5);
      await uploadPromise;
      
      logger.info(`[完成] ${fileName} 上传成功\n`);
      return true;
      
    } catch (err) {
      logger.error(`[失败] ${fileName} 上传失败: ${err.message}\n`);
      return false;
    }
  }

  // 格式化文件大小
  function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
  }

  function addToList(filePath) {
    if (pendingUploads.size > 200)
    {
      logger.info('[警告] 待上传文件过多>200,丢弃文件 ' + filePath);
      return;
    }
    pendingUploads.add(filePath);
    logger.info('上传文件队列添加 当前大小: ' + pendingUploads.size);
  }

  // 创建文件监听器
  const watcher = chokidar.watch(CONFIG.WATCH_DIR, {
    ignored: /(^|[\/\\])\../,  // 忽略隐藏文件
    persistent: true,
    ignoreInitial: true,  // 忽略初始扫描的文件
    awaitWriteFinish: {
      stabilityThreshold: 100,  // 文件2秒内没有变化才认为写入完成
      pollInterval: 100
    }
  });

  // 上传队列处理（递归延时，避免重叠）
  async function processUploadQueue() {
    if (pendingUploads.size > 0) {
      const filesToUpload = Array.from(pendingUploads);
      pendingUploads.clear();
      
      for (const filePath of filesToUpload) {
        let succ=await uploadFile(filePath);
        if (succ && CONFIG.DELETE_ON_SUCCESS) {
          fs.unlink(filePath, (err) => {
            if (err) {
              logger.error(`[错误] 删除文件失败: ${filePath} - ${err.message}`);
            } else {
              logger.info(`[删除] ${path.basename(filePath)} - 上传成功后删除本地文件`);
            }
          });
        }
      }
    }

    if( pendingDeletes.size > 0) {
      const filesToDelete = Array.from(pendingDeletes);
      pendingDeletes.clear();

      if(!client.isConnected()) {
        logger.info('重新连接服务器...');
        await client.connect();
      }
      for (const filePath of filesToDelete) {
        logger.info(`[请求服务器删除] ${path.basename(filePath)}`);
        let relativePath = filePath.replace(CONFIG.WATCH_DIR + path.sep, '');
        relativePath = CONFIG.VIRTUAL_DIR + path.sep + relativePath;
        client.delFile(relativePath);
      }
    }

    // 等待1秒后再次检查队列
    setTimeout(processUploadQueue, CONFIG.SYNC_INTERVAL);
  }
  
  // 启动队列处理
  processUploadQueue();

  // 监听文件添加事件（文件写入完成）
  watcher.on('add', (filePath) => {
    const fileName = path.basename(filePath);
    logger.info(`[检测] ${fileName} - 文件已写入完成`);

    addToList(filePath);
  });

  // 监听文件变化事件
  watcher.on('change', (filePath) => {
    const fileName = path.basename(filePath);
    logger.info(`[变化] ${fileName} - 文件正在修改`);
    addToList(filePath);
  });

  //监听删除事件
  watcher.on('unlink', (filePath) => {
    if (CONFIG.DELETE_ON_SUCCESS)// 如果是上传成功后删除本地文件，则忽略删除事件
      return;

    if(!CONFIG.SYNC_DELETE_FILE)
      return;

    const fileName = path.basename(filePath);
    logger.info(`[删除] ${fileName} - 文件已被删除`);
    pendingDeletes.add(filePath);
  });

  // 监听错误
  watcher.on('error', (error) => {
    logger.error('[错误] 监听器错误:', error);
  });

  // 监听器就绪
  watcher.on('ready', () => {
    logger.info('[就绪] 文件监听器已启动，等待文件...\n');
  });

  // 优雅退出
  process.on('SIGINT', async () => {
    logger.info('\n\n正在关闭监听器...');
    
    pendingUploads.clear();
    
    await watcher.close();
    logger.info('监听器已关闭');
    // 等待日志写入
    await new Promise(resolve => setTimeout(resolve, 200));
    process.exit(0);
  });

  // 捕获未处理的异常
  process.on('uncaughtException', async (err) => {
    logger.error('[致命错误]', err);
    // 等待日志写入
    await new Promise(resolve => setTimeout(resolve, 200));
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('[未处理的 Promise 拒绝]', reason);
  });

})(); // 结束 async main()