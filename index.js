const watcher = require('./fwatcher.js');
const server = require('./fserver.js');

const args = process.argv.slice(2);
let isServer = args.indexOf('--server') !== -1;
let isWatcher = args.indexOf('--watcher') !== -1;
if (args.length === 0)
{
  isServer = true;
}
if (isWatcher)
{
  watcher.RunWatcher();
}
else if (isServer)
{
  server.startServer();
}
else {
  console.log('请指定运行模式: --server 或 --watcher');
}

