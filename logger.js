const { log } = require('console');
const path = require('path');
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

function getCaller() {
  const stack = new Error().stack.split('\n');
  if (stack.length > 3) {
    const line = stack[3];
    const match = line.match(/at\s+(?:.*\s+)?\(?([^:)]+):(\d+):\d+\)?/);
    if (match) {
      return `${path.basename(match[1])}:${match[2]}`;
    }
  }
  
  return 'unknown';
}

let currentLogLevel = LOG_LEVELS.INFO;
let enableCallerInfo = false;
let logOpen;
function configureLogging({ level = 'INFO', enableCaller = false, open = true } = {}) {
  currentLogLevel = LOG_LEVELS[level] ?? LOG_LEVELS.INFO;
  enableCallerInfo = enableCaller;
  logOpen = open;
}

function logger(level = 'INFO', ...args) {
  if(logOpen===false) return;
  // 级别过滤
  if (LOG_LEVELS[level] < currentLogLevel) return;
  
  const now = Date.now();
  let timestamp;
  
  // 简单的时间戳缓存
  if (!logger._lastTime || now - logger._lastTime > 0) {
    logger._lastTime = now;
    const date = new Date(now);
    logger._cachedTime = `${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}.${date.getMilliseconds().toString().padStart(3, '0')}`;
  }
  timestamp = logger._cachedTime;
  
  // 只在需要时获取调用者信息
  const caller = enableCallerInfo ? getCaller() : '';
  
  // 使用 console[level] 对应的方法
  const consoleMethod = console[level.toLowerCase()] || console.log;
  consoleMethod(`${timestamp} [${level}] ${caller ? ` [${caller}]` : ''}`, ...args);
}

// 初始化缓存
logger._lastTime = 0;
logger._cachedTime = '';
logger.configure = configureLogging;
// 快捷方法
logger.debug = (...args) => logger('DEBUG', ...args);
logger.info = (...args) => logger('INFO', ...args);
logger.warn = (...args) => logger('WARN', ...args);
logger.error = (...args) => logger('ERROR', ...args);

exports.logger = logger;

