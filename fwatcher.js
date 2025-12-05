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
let switchEnabled = true;

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
async function RunWatcher() {
  // 创建两个客户端实例以提高带宽利用率
  const clients = [];
  for(let i=0;i<1;i++)
  {
    clients.push({
      client:new FileUploadClient(
        CONFIG.SERVER_HOST,
        CONFIG.SERVER_PORT,
        true,  // 不是测试模式
        CONFIG.ENABLE_MD5,
        CONFIG.VIRTUAL_DIR
      ),
      file_queue: [],
    });
  }
  
  // 连接所有客户端
  for (let i = 0; i < clients.length; i++) {
    try {
      logger.info(`正在连接客户端 ${i + 1}...`);
      await clients[i].client.connect();
      logger.info(`✓ 客户端 ${i + 1} 已连接`);
    } catch (err) {
      logger.error(`✗ 客户端 ${i + 1} 无法连接到服务器，退出程序`);
      // 等待日志写入
      await new Promise(resolve => setTimeout(resolve, 100));
      process.exit(1);
    }
  }
  
  // 获取下一个可用的客户端
  function getNextClient() {
    let minIndex = 0;
    let minQueueLen = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < clients.length; i++) {
      if (clients[i].file_queue.length < minQueueLen) {
        if (clients[i].file_queue.length === 0)
        {
          return i;
        }
        minIndex = i;
        minQueueLen = clients[i].file_queue.length;
      }
    }
    return minIndex;
  }

  // 上传文件函数
  async function uploadFile(filePath, clientIdx) {
    const fileName = path.basename(filePath);
    const client = clients[clientIdx].client;
    
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
      logger.info(`\n[上传] ${fileName} (${formatSize(stats.size)}) - 客户端 ${clientIdx + 1}`);
      
      const uploadPromise = new Promise((resolve, reject) => {
        client.uploadComplete = resolve;
        client.uploadFailed = reject;
      });
      if(!client.isConnected()) {
        logger.info(`客户端 ${clientIdx + 1} 重新连接服务器...`);
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
      
      logger.info(`[完成] ${fileName} 上传成功 - 客户端 ${clientIdx + 1}\n`);
      return true;
      
    } catch (err) {
      logger.error(`[失败] ${fileName} 上传失败 - 客户端 ${clientIdx + 1}: ${err.message}\n`);
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

  function addToClientList(filePath) {
    let index = getNextClient();
    if (clients[index].file_queue.length > 100000)
    {
      logger.info('[警告] 待上传文件过多>100000,丢弃文件 ' + filePath);
      return;
    }
    clients[index].file_queue.push(filePath);
    logger.info(`客户端 ${index + 1} 上传文件队列添加 当前大小: ${clients[index].file_queue.length}`);
  }
  function addToList(filePath) {
    if (pendingUploads.size > 100000)
    {
      logger.info('[警告] 待上传文件过多>100000,丢弃文件 ' + filePath);
      return;
    }
    pendingUploads.add(filePath);
    logger.info('上传文件队列添加 当前大小: ' + pendingUploads.size);
  }

  if (CONFIG.SWITCH_CHECK_FILE.length > 0)
  {
    if (fs.existsSync(CONFIG.SWITCH_CHECK_FILE))
    {
    //读取开关文件内容
      let content = fs.readFileSync(CONFIG.SWITCH_CHECK_FILE, 'utf8').trim();
      switchEnabled = content === 'open';
    }
    else
    {
      //创建开关文件，默认开启
      try {
        fs.writeFileSync(CONFIG.SWITCH_CHECK_FILE, 'open', 'utf8');
        switchEnabled = true;
      } catch (err) {
        logger.error(`[错误] 无法创建开关文件: ${CONFIG.SWITCH_CHECK_FILE} - ${err.message}`);
        switchEnabled = true; // 默认开启
      }
    }
    // 创建文件监听器
    const switchWatcher = chokidar.watch(CONFIG.SWITCH_CHECK_FILE);
    switchWatcher.on('change', () => {
      let content = fs.readFileSync(CONFIG.SWITCH_CHECK_FILE, 'utf8').trim();
      if (content === 'open')
        switchEnabled = true;
      else if (content === 'close')
        switchEnabled = false;
      logger.info(`[开关] 上传开关当前状态: ${switchEnabled ? '开启' : '关闭'}`);
    });
  }

  
  const watcher = chokidar.watch(CONFIG.WATCH_DIR, {
    ignored: /(^|[\/\\])\../,  // 忽略隐藏文件
    persistent: true,
    ignoreInitial: true,  // 忽略初始扫描的文件
    awaitWriteFinish: {
      stabilityThreshold: CONFIG.STABILITY_THRESHOLD || 100,  // 文件2秒内没有变化才认为写入完成
      pollInterval: 100
    }
  });

  async function  processClientUpload(clientIndex){
    //使用 Promise.all 并行上传文件到不同客户端
    while(clients[clientIndex].file_queue.length>0)
    {
      let filePath = clients[clientIndex].file_queue.shift();
      let succ = await uploadFile(filePath, clientIndex);
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
    setTimeout(async () => {
      await processClientUpload(clientIndex);
    }, 100);
  }
  async function processUploadQueue() {
    if (pendingUploads.size > 0) {
      const filesToUpload = Array.from(pendingUploads);
      pendingUploads.clear();
      
      for(const filePath of filesToUpload) {
        addToClientList(filePath);
      }

    }

    if( pendingDeletes.size > 0) {
      let filesToDelete = Array.from(pendingDeletes);
      pendingDeletes.clear();

      // 使用第一个客户端处理删除请求
      let index = getNextClient();
      if(!clients[index].client.isConnected()) {
        logger.info('重新连接服务器...');
        await clients[index].client.connect();
      }
      let relativePaths = filesToDelete.map((filePath) => {
        let relativePath = filePath.replace(CONFIG.WATCH_DIR + path.sep, '');
        relativePath = CONFIG.VIRTUAL_DIR + path.sep + relativePath;
        return  relativePath;
      });
      clients[index].client.delFile(relativePaths);
    }

    // 等待1秒后再次检查队列
    setTimeout(processUploadQueue, CONFIG.SYNC_INTERVAL);
  }
  
  // 启动队列处理
  processUploadQueue();

  for(let i=0;i<clients.length;i++)
  {
    await processClientUpload(i);
  }

  // 监听文件添加事件（文件写入完成）
  watcher.on('add', (filePath) => {
    if (!switchEnabled){
      return;
    }
    const fileName = path.basename(filePath);
    logger.info(`[检测] ${fileName} - 文件已写入完成`);

    addToList(filePath);
  });

  // 监听文件变化事件
  watcher.on('change', (filePath) => {
    if (!switchEnabled){
      return;
    }
    const fileName = path.basename(filePath);
    logger.info(`[变化] ${fileName} - 文件正在修改`);
    addToList(filePath);
  });

  //监听删除事件
  watcher.on('unlink', (filePath) => {
    if (!switchEnabled){
      return;
    }
    if (CONFIG.DELETE_ON_SUCCESS)// 如果是上传成功后删除本地文件，则忽略删除事件
      return;

    if(!CONFIG.SYNC_DELETE_FILE)
      return;

    const fileName = path.basename(filePath);
    logger.info(`[删除] ${fileName} - 文件已被删除`);
    pendingDeletes.add(filePath);
  });
  watcher.on('unlinkDir', (path) => {
    if (!switchEnabled){
      return;
    }
    console.log(`[目录删除] ${path}`);
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

}
//判断不是模块被引入才执行
if (require.main === module) {
  RunWatcher(); //
}
//导出 RunWatcher 以便外部调用
module.exports = {
  RunWatcher
};