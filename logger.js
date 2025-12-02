const winston = require('winston');
const path = require('path');
const fs = require('fs');

// 确保日志目录存在
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// 自定义格式化函数
const customFormat = winston.format.printf(({ timestamp, level, message, caller }) => {
  const location = caller || 'unknown';
  return `${timestamp} [${level.toUpperCase()}] [${location}] ${message}`;
});

const baseLogger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    customFormat
  ),
  transports: [
    // 控制台输出
    new winston.transports.Console({
      level: 'debug'
    }),
    // 所有日志文件
    new winston.transports.File({
      filename: path.join(logDir, 'app.log'),
      level: 'info',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5
    }),
    // 错误日志文件
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5
    })
  ]
});

// 获取调用位置
function getCaller() {
  const stack = new Error().stack.split('\n');
  
  // stack[0] = "Error"
  // stack[1] = "at getCaller ..."
  // stack[2] = "at logger.info/error/... (logger.js:XX:XX)"  
  // stack[3] = "at 实际调用位置" <- 我们要这个
  
  if (stack.length > 3) {
    const line = stack[3];
    const match = line.match(/at\s+(?:.*\s+)?\(?([^:)]+):(\d+):\d+\)?/);
    if (match) {
      return `${path.basename(match[1])}:${match[2]}`;
    }
  }
  
  return 'unknown';
}

// 包装 logger 方法以自动添加调用位置
const logger = {
  info: (message) => baseLogger.info({ message, caller: getCaller() }),
  error: (message) => baseLogger.error({ message, caller: getCaller() }),
  warn: (message) => baseLogger.warn({ message, caller: getCaller() }),
  debug: (message) => baseLogger.debug({ message, caller: getCaller() })
};

module.exports = logger;
