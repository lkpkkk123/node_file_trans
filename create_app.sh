bun build ./index.js --outfile=./exe/fserver --target=bun --compile
bun build --compile index.js --outfile=./exe/fserver.exe --target=bun-windows-x64
bun build --compile index.js --outfile=./exe/fserver_arm --target=bun-linux-arm64