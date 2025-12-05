const fs = require('fs');
// 默认服务器配置
const DefaultServerConfig = {
  PORT: 3000,
  HOST: '0.0.0.0',
  UPLOAD_PATH_MAP: [
    ['.', '/home/likp/test_uploads'],  // virtual path, real path .是根目录，必须有一个根目录
    ['uploads', '/home/likp/test_uploads2']
  ],
  MAX_CONNECTIONS: 500,
  MAX_BUFFER_SIZE: 64 * 1024 * 1024, // 64MB socket 缓冲
  MAX_FILE_SIZE: 100 * 1024 * 1024 * 1024, // 100GB
  CLIENT_TIMEOUT: 3 * 60 * 1000, // 3分钟
  RESUME_TIMEOUT: 2 * 60 * 60 * 1000, // 2小时
  DELETE_EMPTY_DIR: true, // 收到删除文件时，检查删除空目录
};

// 默认监听配置
const DefaultWatcherConfig = {
  WATCH_DIR: '/home/likp/watch_uploads',  // 监听目录
  SERVER_HOST: '192.168.8.78',
  SERVER_PORT: 3000,
  ENABLE_RESUME: true,
  ENABLE_MD5: false,
  VIRTUAL_DIR: 'uploads',  // 上传到服务器的虚拟目录
  SYNC_INTERVAL: 5000,  // 文件关闭后等待5秒再上传（确保写入完成）
  SYNC_DELETE_FILE: true,  // 同步删除的文件
  DELETE_ON_SUCCESS: false,  // 上传成功后删除本地文件
  FILE_DISABLE_RESUME: ['.m3u8'], // 不支持断点续传的文件列表
  STABILITY_THRESHOLD: 2000, // 文件稳定时间，单位毫秒
  SWITCH_CHECK_FILE: '/opt/aibox/cfg/fupload_switch.txt', // 控制开关文件路径，内容为open或者文件不存在则上传，否则不上传
};

/**
 * 加载配置文件，如果文件不存在则创建默认配置
 * @param {string} configPath - 配置文件路径
 * @param {object} defaultConfig - 默认配置对象
 * @returns {object} - 加载的配置对象
 */
function loadConfig(configPath, defaultConfig) {
  try {
    if (fs.existsSync(configPath)) {
      // 配置文件存在，读取并合并
      const fileContent = fs.readFileSync(configPath, 'utf8');
      const userConfig = JSON.parse(fileContent);
      console.log(`配置文件已加载: ${configPath}`);
      return { ...defaultConfig, ...userConfig };
    } else {
      // 配置文件不存在，创建默认配置文件
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
      console.log(`配置文件已创建: ${configPath}`);
      return defaultConfig;
    }
  } catch (error) {
    console.error(`加载配置文件失败: ${configPath}, 错误: ${error.message}`);
    console.log('使用默认配置');
    return defaultConfig;
  }
}

// 配置文件路径
const serverConfigPath = 'fserver_cfg.json';
const watcherConfigPath = 'fwatcher_cfg.json';

// 加载配置
let ServerConfig = loadConfig(serverConfigPath, DefaultServerConfig);
let WatcherConfig = loadConfig(watcherConfigPath, DefaultWatcherConfig);

// 将 UPLOAD_PATH_MAP 数组转换为 Map
if (Array.isArray(ServerConfig.UPLOAD_PATH_MAP)) {
  ServerConfig.UPLOAD_PATH_MAP = new Map(ServerConfig.UPLOAD_PATH_MAP);
}

module.exports = {
  ServerConfig,
  WatcherConfig
};

