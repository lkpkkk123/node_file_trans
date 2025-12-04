bun build ./fserver.js --outfile=./exe/fserver --target=bun --compile
bun build --compile fserver.js --outfile=./exe/fserver.exe --target=bun-windows-x64
bun build --compile fserver.js --outfile=./exe/fserver_arm --target=bun-linux-arm64

bun build ./fwatcher.js --outfile=./exe/fwatcher --target=bun --compile
bun build --compile fwatcher.js --outfile=./exe/fwatcher.exe --target=bun-windows-x64
bun build --compile fwatcher.js --outfile=./exe/fwatcher_arm --target=bun-linux-arm64