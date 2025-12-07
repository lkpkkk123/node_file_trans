const { dir } = require('console');
const fs = require('fs');
const path = require('path');

class myWatcher {
  constructor(dirPath,cfg={}) {
    this.dirPath = dirPath;
    this.watchers = new Map();  // path -> watcher
    this.events = new Map();
    this.cbs = new Map();
    this.pathDepth = dirPath.split(path.sep).length;
    this.cfg = cfg;
    if (!this.cfg.interval) {
      this.cfg.interval = 1000;//1秒处理一次事件
    }
    if (!cfg.ignoreStartWith)
    {
      this.cfg.ignoreStartWith = ['.']; //忽略以.开头的文件或目录
    }
    if (!this.cfg.ignoreEndWith)
    {
      this.cfg.ignoreEndWith = []; //忽略以指定字符串结尾的文件或目录
    }
    if(!cfg.maxDepth)
    {
      this.cfg.maxDepth = 99;
    }
  }

  // 关闭指定目录及其所有子目录的监控器
  closeWatcher(watchPath) {
    let watcher = this.watchers.get(watchPath);
    if (!watcher)
      return false;
    
    // 先关闭所有子目录的监控器
    const pathPrefix = watchPath + path.sep;
    for (let [dirPath, subWatcher] of this.watchers) {
      if (dirPath.startsWith(pathPrefix)) {
        try {
          subWatcher.close();
        } catch (err) {
          // 忽略关闭错误
        }
        this.watchers.delete(dirPath);
        console.log(`已关闭子目录监控: ${dirPath}`);
      }
    }
    
    // 再关闭当前目录的监控器
    try {
      watcher.close();
    } catch (err) {
      // 忽略关闭错误
    }
    this.watchers.delete(watchPath);
    console.log(`已关闭 ${watchPath} 监控`);
    return true;
  }
  closeAllWatchers() {
    for (let [watchPath, watcher] of this.watchers) {
      try {
        watcher.close();
      } catch (err) {
        // 忽略关闭错误
      }
      console.log(`已关闭 ${watchPath} 监控`);
    }
    this.watchers.clear();
  }
  isIgnored(filename,isDir) {
    // 忽略以指定前缀开头的文件或目录
    if (isDir) {
      let dir = filename+path.sep;//目录不判断StartWitch,只判断EndWitch
      // 忽略以指定后缀结尾的文件或目录
      for (let suffix of this.cfg.ignoreEndWith) {
        if (dir.endsWith(suffix)) {
          return true;
        }
      }
      return false;
    }
    else {
      let baseName = path.basename(filename);
      for (let prefix of this.cfg.ignoreStartWith) {
        if (baseName.startsWith(prefix)) {
        //console.log(`[忽略] 以 ${prefix} 开头: ${filename}`);
          return true;
        }
      }
      // 忽略以指定后缀结尾的文件或目录
      for (let suffix of this.cfg.ignoreEndWith) {
        if (baseName.endsWith(suffix)) {
        //console.log(`[忽略] 以 ${suffix} 结尾: ${filename}`);
          return true;
        }
      }
      return false;
    }

  }
  setEvent(key,value)
  {
    if (!this.events.has(key))
    {
      this.events.set(key,value);
    }
  }
  handleFileEvent(eventType, filename, watchPath) {
    if (!filename) return;  // 忽略空文件名
  
    const fullPath = path.join(watchPath, filename);
  
    
    if (eventType === 'change') {
      if (this.isIgnored(filename,false)) {
        return;
      }
      //console.log(`[变化] ${fullPath}`);
      let type='change';
      const eventKey = `${type}:${fullPath}`;
      this.setEvent(eventKey, {fullPath,type:'change',tm:this.getProcessTick()});
    } else if (eventType === 'rename') {
      
      // 区分是新建还是删除
      try {
        const stat = fs.statSync(fullPath);
        // 文件存在 = 新建或重命名到此
        if (stat.isDirectory()) {
          if (this.isIgnored(filename,true)) {
            return;
          }
          console.log(`[新建目录] ${fullPath}`);
          const depth = fullPath.split(path.sep).length - this.pathDepth;
          if (depth < this.cfg.maxDepth) {
            console.log(`[监控] 添加目录监控: ${fullPath}`);
            this.watchDirectory(fullPath, depth, true);
            this.setEvent(`addDir:${fullPath}`, {fullPath, type: 'addDir', tm: this.getProcessTick()});
          } else {
            console.log(`[跳过] 目录深度超限: ${fullPath}`);
          }
        } else {
          if (this.isIgnored(filename,false)) {
            return;
          }
          this.setEvent(`add:${fullPath}`, {fullPath, type: 'add', tm: this.getProcessTick()});
          console.log(`[新建文件1] ${fullPath}`);
        }
      } catch (err) {
      // 文件不存在 = 删除或重命名走了
        if (err.code === 'ENOENT') {
          if (this.closeWatcher(fullPath)) {
            if (this.isIgnored(filename,true)) {
              return;
            }
            console.log(`[删除目录] ${fullPath}`);
            this.setEvent(`unlinkDir:${fullPath}`, {fullPath, type: 'unlinkDir', tm: this.getProcessTick()});
          }
          else {
            if (this.isIgnored(filename,false)) {
              return;
            }

            console.log(`[删除文件] ${fullPath}`);
            this.setEvent(`unlink:${fullPath}`, {fullPath, type: 'unlink', tm: this.getProcessTick()});
          }
        } else {
          console.log(`[错误] ${fullPath}: ${err.message}`);
        }
      }
    }
    else{
      console.log(`[未知事件] ${eventType} - ${fullPath}`);
    }
    //}, DEBOUNCE_TIME);
  
  //pendingEvents.set(eventKey, timer);
  }
  ScanFiles(dirPath)
  {
    fs.readdir(dirPath, { withFileTypes: true, recursive: true }, (err, files) => {
      if (err) {
        console.error(`[错误] 读取目录 ${dirPath} 失败:`, err.message);
        return;
      }
      for (const entry of files) {
        // 只处理目录，跳过文件
        if (entry.isFile() && !this.isIgnored(entry.name,false)) {
          const filePath = path.join(entry.parentPath, entry.name);
          //this.watchOneDirectory(filePath);
          this.setEvent(`add:${filePath}`, {fullPath: filePath, type: 'add', tm: this.getProcessTick()});
          console.log(`[新建文件2] ${filePath}`);
        }
      }
    });
  }
  watchOneDirectory(dirPath, scanFiles = false)
  {
  // 监控单个目录
    try {
      const watcher = fs.watch(dirPath, { recursive: false }, (eventType, filename) => {
        this.handleFileEvent(eventType, filename, dirPath);
      });
      if (scanFiles) {
        setTimeout(() => {
          this.ScanFiles(dirPath);
        }, 800);
      }
      this.watchers.set(dirPath, watcher);
      
      watcher.on('error', (error) => {
        console.error(`[错误] 监控器错误 ${dirPath}:`, error.message);
        
        // 关闭失效的监控器
        try {
          watcher.close();
        } catch (err) {
          // 忽略关闭错误
        }
        
        this.watchers.delete(dirPath);
        
        // 如果是目录被删除（ENOENT），检查父目录是否还存在
        if (error.code === 'ENOENT') {
          console.log(`[清理] 目录已删除: ${dirPath}`);
        }
      });
    
      
    } catch (error) {
      console.error(`[错误] 无法监控目录 ${dirPath}:`, error.message);
    }
  }
  watchDirectory(dirPath, depth = 0, scanFiles = false) {
    if (depth >= this.cfg.maxDepth) {
      console.log(`[跳过] 深度超限: ${dirPath} (深度 ${depth})`);
      return;
    }
    
    // 如果已经在监控，跳过
    if (this.watchers.has(dirPath)) {
      return;
    }
    this.watchOneDirectory(dirPath, scanFiles);
    fs.readdir(dirPath, { withFileTypes: true, recursive: true }, (err, files) => {
      if (err) {
        console.error(`[错误] 读取目录 ${dirPath} 失败:`, err.message);
        return;
      }
      for (const entry of files) {
        // 只处理目录，跳过文件
        if (entry.isDirectory() && !this.isIgnored(entry.name,true)) {
          const subPath = path.join(entry.parentPath, entry.name);
          //console.log(entry);
          this.watchOneDirectory(subPath, scanFiles);
        }
      }
      console.log(`[扫描完成] 目录 ${dirPath} 下的所有子目录已监控 数量: ${this.watchers.size}`);
    });
  }
  getProcessTick() {
    return Math.floor(process.uptime() * 1000);
  }
  eventProcess()
  {
    //console.log(`处理事件 tm: ${this.getProcessTick()} , 待处理事件数量: ${this.events.size}`);
    this.events.forEach((value, eventKey) => {
      //console.log(`检查事件: ${eventKey} , 事件时间: ${value.tm}`);
      if (this.getProcessTick() - value.tm >= this.cfg.interval)
      {
        if (this.cbs.has(value.type)) {
          this.cbs.get(value.type)(value.fullPath);
        }
        this.events.delete(eventKey);
      }

    });
  }
  on(type, cb) {
    this.cbs.set(type, cb);
  }
  start() {
    console.log(`开始递归监控目录: ${this.dirPath}`);
    try {
      this.watchDirectory(this.dirPath);
    } catch (err) {
      console.error(`[错误] 无法监控根目录 ${this.dirPath}:`, err.message);
      return;
    }
    //console.log('已监控目录数量:', this.watchers.size);
    setInterval(() => {
      this.eventProcess();
    }, this.cfg.interval);
  }
  stop() {
    this.closeAllWatchers();
  }
}

if (require.main === module) {
  //console.log('开始监控目录: /home/likp/watch_uploads,最大深度: 99');
  let watcher = new myWatcher('/home/likp/watch_uploads',
    {
      interval: 1000,
      ignoreStartWith: ['.'],
      ignoreEndWith: ['.tmp','.tmp/'],
      maxDepth: 99
    });
  watcher.on('add', (fullPath) => {
    console.log(`[回调] 文件添加: ${fullPath}`);
  });
  watcher.on('change', (fullPath) => {
    console.log(`[回调] 文件修改: ${fullPath}`);
  });
  watcher.on('unlink', (fullPath) => {
    console.log(`[回调] 文件删除: ${fullPath}`);
  });
  watcher.on('unlinkDir', (fullPath) => {
    console.log(`[回调] 目录删除: ${fullPath}`);
  });
  watcher.start();
  //console.log('监控目录数量:', watcher.watchers.size);
}
module.exports = myWatcher;
