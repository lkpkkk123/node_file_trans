
const ServerConfig = {
  PORT: 3000,
  HOST: '0.0.0.0',
  //UPLOAD_PATH: '/home/likp/test_uploads',
  UPLOAD_PATH_MAP: new Map(
    [['.','/home/likp/test_uploads'],//virtual path,real path .是根目录，必须有一个根目录
      ['uploads','/home/likp/test_uploads2']]),
  MAX_CONNECTIONS: 500,
  MAX_BUFFER_SIZE: 64 * 1024 * 1024, // 64MB socket 缓冲
  MAX_FILE_SIZE: 100 * 1024 * 1024 * 1024, // 100GB
  CLIENT_TIMEOUT: 3 * 60 * 1000, // 3分钟
  RESUME_TIMEOUT: 2 * 60 * 60 * 1000, // 2小时
  DELETE_EMPTY_DIR: true, // 收到删除文件时，检查删除空目录
};
// 配置
const WatcherConfig = {
  WATCH_DIR: process.argv[2] || '/home/likp/watch_uploads',  // 监听目录
  SERVER_HOST: process.argv[3] || '192.168.8.78',
  SERVER_PORT: parseInt(process.argv[4]) || 3000,
  ENABLE_RESUME: true,
  ENABLE_MD5: false,
  VIRTUAL_DIR: 'uploads',  // 上传到服务器的虚拟目录
  SYNC_INTERVAL: 5000,  // 文件关闭后等待5秒再上传（确保写入完成）
  SYNC_DELETE_FILE: true,  // 同步删除的文件
  DELETE_ON_SUCCESS: false,  // 上传成功后删除本地文件
  FILE_DISABLE_RESUME: ['.m3u8'], // 不支持断点续传的文件列表
  STABILITY_THRESHOLD: 2000, // 文件稳定时间，单位毫秒
};

module.exports = {
  ServerConfig,
  WatcherConfig
};

