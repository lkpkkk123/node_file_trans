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

// 使用对象来保存 logger 实例，这样可以动态更新
const loggerContainer = {
  instance: null
};

function create(logfile) {
  loggerContainer.instance = winston.createLogger({
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
        filename: path.join(logDir, logfile + '.log'),
        level: 'info',
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 5
      }),
      // 错误日志文件
      new winston.transports.File({
        filename: path.join(logDir, logfile + '_error.log'),
        level: 'error',
        maxsize: 10 * 1024 * 1024,
        maxFiles: 5
      })
    ]
  });
}

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

// 包装 logger 方法以自动添加调用位置，并动态引用 logger 实例
const logger = {
  info: (message) => {
    if (loggerContainer.instance) {
      loggerContainer.instance.info({ message, caller: getCaller() });
    } else {
      console.log(`[INFO] ${message}`); // 降级到 console
    }
  },
  error: (message) => {
    if (loggerContainer.instance) {
      loggerContainer.instance.error({ message, caller: getCaller() });
    } else {
      console.error(`[ERROR] ${message}`);
    }
  },
  warn: (message) => {
    if (loggerContainer.instance) {
      loggerContainer.instance.warn({ message, caller: getCaller() });
    } else {
      console.warn(`[WARN] ${message}`);
    }
  },
  debug: (message) => {
    if (loggerContainer.instance) {
      loggerContainer.instance.debug({ message, caller: getCaller() });
    } else {
      console.log(`[DEBUG] ${message}`);
    }
  }
};

// 关闭日志并等待写入完成
async function close() {
  if (loggerContainer.instance) {
    // 强制flush所有日志
    const instance = loggerContainer.instance;
    
    // 关闭所有 transport
    for (const transport of instance.transports) {
      if (typeof transport.close === 'function') {
        await new Promise(resolve => {
          transport.once('finish', resolve);
          transport.end();
          setTimeout(resolve, 500); // 超时保护
        });
      }
    }
    
    // 关闭 logger
    instance.end();
    
    // 等待一小段时间确保写入完成
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

module.exports = logger;
module.exports.create = create;
module.exports.close = close;
