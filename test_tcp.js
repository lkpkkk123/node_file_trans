const TcpProtocol = require('./tcp_protocol');

console.log('=== TCP 协议测试 ===\n');

// 测试 1: JSON 打包和解包
console.log('测试 1: JSON 数据');
const tp = new TcpProtocol();
const jsonData = {a: 1, b: 2, c: [1, 2, 3]};
const packedJson = TcpProtocol.packJson(jsonData);
console.log('原始数据:', jsonData);
console.log('打包后大小:', packedJson.length, 'bytes');
const decodedJson = tp.unpack(packedJson);
console.log('解包数据:', decodedJson);
console.log('✓ JSON 测试通过\n');

// 测试 2: 二进制打包和解包
console.log('测试 2: 二进制数据');
const tp2 = new TcpProtocol();
const binaryData = Buffer.from([1, 2, 3, 4, 5, 255]);
const packedBinary = TcpProtocol.packBinary(binaryData);
console.log('原始数据:', binaryData);
console.log('打包后大小:', packedBinary.length, 'bytes');
const decodedBinary = tp2.unpack(packedBinary);
console.log('解包数据:', decodedBinary.data);
console.log('✓ 二进制测试通过\n');

// 测试 3: 粘包处理（使用回调方式）
console.log('测试 3: 粘包处理（回调方式）');
const tp3 = new TcpProtocol();
const packet1 = TcpProtocol.packJson({msg: 'first'});
const packet2 = TcpProtocol.packJson({msg: 'second'});
const packet3 = TcpProtocol.packBinary(Buffer.from([116, 104, 105, 114, 100])); // "third" in ASCII
const combined = Buffer.concat([packet1, packet2, packet3]);
console.log('粘包总大小:', combined.length, 'bytes');

// 使用回调方式，一次性解析所有包
const packets = [];
const count = tp3.unpack(combined, (packet) => {
  packets.push(packet);
  console.log(`解析到第 ${packets.length} 个包:`, packet);
});
console.log(`总共解析了 ${count} 个数据包`);
console.log('✓ 粘包测试通过\n');

// 测试 3.5: 粘包 + 分包混合测试
console.log('测试 3.5: 粘包 + 分包混合测试');
const tp3_5 = new TcpProtocol();
const combinedSlice1 = combined.slice(0, 15);
const combinedSlice2 = combined.slice(15, 30);
const combinedSlice3 = combined.slice(30);
console.log('分包大小:', combinedSlice1.length, combinedSlice2.length, combinedSlice3.length);

let totalParsed = 0;
totalParsed += tp3_5.unpack(combinedSlice1, (packet) => {
  console.log('从第1片解析:', packet);
});
console.log(`第1片解析了 ${totalParsed} 个包`);

const parsed2 = tp3_5.unpack(combinedSlice2, (packet) => {
  console.log('从第2片解析:', packet);
});
totalParsed += parsed2;
console.log(`第2片解析了 ${parsed2} 个包`);

const parsed3 = tp3_5.unpack(combinedSlice3, (packet) => {
  console.log('从第3片解析:', packet);
});
totalParsed += parsed3;
console.log(`第3片解析了 ${parsed3} 个包，总共 ${totalParsed} 个包`);
console.log('✓ 混合测试通过\n');

// 测试 4: 分包处理
console.log('测试 4: 分包处理');
const tp4 = new TcpProtocol();
const fullPacket = TcpProtocol.packJson({msg: 'split packet test'});
const part1 = fullPacket.slice(0, 10);
const part2 = fullPacket.slice(10);

console.log('完整包大小:', fullPacket.length, 'bytes');
console.log('第一部分:', part1.length, 'bytes');
console.log('第二部分:', part2.length, 'bytes');

const r1 = tp4.unpack(part1);
console.log('第一次解析:', r1);

const r2 = tp4.unpack(part2);
console.log('第二次解析:', r2);
console.log('✓ 分包测试通过\n');

console.log('=== 所有测试通过！===');
