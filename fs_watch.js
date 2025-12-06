const fs = require('fs');
const path = require('path');

class myWatcher {
  constructor(dirPath,cfg={}) {
    this.dirPath = dirPath;
    this.watchers = new Map();  // path -> watcher
    this.events = new Map();
    this.cbs = new Map();
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
  isIgnored(filename) {
    // 忽略以指定前缀开头的文件或目录
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
  handleFileEvent(eventType, filename, watchPath) {
    if (!filename) return;  // 忽略空文件名
  
    const fullPath = path.join(watchPath, filename);
  
    
    if (eventType === 'change') {
      if (this.isIgnored(filename)) {
        return;
      }
      console.log(`[变化] ${fullPath}`);
      let type='change';
      const eventKey = `${type}:${fullPath}`;
      this.events.set(eventKey, {fullPath,type:'change',tm:this.getProcessTick()});
    } else if (eventType === 'rename') {
      
      // 区分是新建还是删除
      try {
        const stat = fs.statSync(fullPath);
        // 文件存在 = 新建或重命名到此
        if (stat.isDirectory()) {
          console.log(`[新建目录] ${fullPath}`);
          const depth = fullPath.split(path.sep).length - WATCH_DIR.split(path.sep).length;
          if (depth < this.cfg.maxDepth) {
            console.log(`[监控] 添加目录监控: ${fullPath}`);
            this.watchDirectory(fullPath, depth);
            this.events.set(`addDir:${fullPath}`, {fullPath, type: 'addDir', tm: this.getProcessTick()});
          } else {
            console.log(`[跳过] 目录深度超限: ${fullPath}`);
          }
        } else {
          if (this.isIgnored(filename)) {
            return;
          }
          this.events.set(`add:${fullPath}`, {fullPath, type: 'add', tm: this.getProcessTick()});
          console.log(`[新建文件] ${fullPath}`);
        }
      } catch (err) {
      // 文件不存在 = 删除或重命名走了
        if (err.code === 'ENOENT') {
          if (this.closeWatcher(fullPath)) {
            console.log(`[删除目录] ${fullPath}`);
            this.events.set(`unlinkDir:${fullPath}`, {fullPath, type: 'unlinkDir', tm: this.getProcessTick()});
          }
          else {
            if (this.isIgnored(filename)) {
              return;
            }
            if(this.events.has(`unlinkDir:${fullPath}`)){//删除目录会有两次回调，忽略第二次
              return;
            }
            console.log(`[删除文件] ${fullPath}`);
            this.events.set(`unlink:${fullPath}`, {fullPath, type: 'unlink', tm: this.getProcessTick()});
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
  watchDirectory(dirPath, depth = 0) {
    if (depth >= this.cfg.maxDepth) {
      console.log(`[跳过] 深度超限: ${dirPath} (深度 ${depth})`);
      return;
    }
    
    // 如果已经在监控，跳过
    if (this.watchers.has(dirPath)) {
      return;
    }
    
    try {
      const watcher = fs.watch(dirPath,{ recursive: true }, (eventType, filename) => {
        this.handleFileEvent(eventType, filename, dirPath);
      });
      
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
      
      // 递归监控子目录
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subPath = path.join(dirPath, entry.name);
          this.watchDirectory(subPath, depth + 1);
        }
      }
      
    } catch (error) {
      console.error(`[错误] 无法监控目录 ${dirPath}:`, error.message);
    }
  }
  getProcessTick() {
    return Math.floor(process.uptime() * 1000);
  }
  eventProcess()
  {
    this.events.forEach((value, eventKey) => {
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
    this.watchDirectory(this.dirPath);
    console.log('已监控目录数量:', this.watchers.size);
    setInterval(() => {
      this.eventProcess();
    }, this.cfg.interval);
  }
  stop() {
    this.closeAllWatchers();
  }
}

if (require.main === module) {
  console.log('开始监控目录: /home/likp/watch_uploads,最大深度: 99');
  let watcher = new myWatcher('/home/likp/watch_uploads',
    {
      interval: 1000,
      ignoreStartWith: ['.'],
      ignoreEndWith: ['.tmp'],
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
  console.log('监控目录数量:', watcher.watchers.size);
}
module.exports = myWatcher;
