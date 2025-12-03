/**
 * TCP 协议处理类
 * 协议格式：
 * - 字节 0-3: 数据长度（UInt32BE，大端序，不包含头部5字节）
 * - 字节 4: 数据类型（1=JSON，2=二进制）
 * - 字节 5+: 实际数据
 */
class TcpProtocol {
  // 数据类型常量
  static TYPE_JSON = 1;
  static TYPE_BINARY = 2;
  static HEADER_SIZE = 5;

  /**
   * 打包 JSON 数据（优化版本）
   * @param {Object} obj - 要发送的 JSON 对象
   * @returns {Buffer} - 封装好的数据包
   */
  static packJson(obj) {
    // 将对象转为 JSON 字符串
    //判断obj是不是String类型
    const jsonString = typeof obj === 'string' ? obj : JSON.stringify(obj);
    
    // 优化：直接计算字节长度，避免创建中间 Buffer
    const dataLength = Buffer.byteLength(jsonString, 'utf8');
    
    // 创建完整数据包：4字节长度 + 1字节类型 + 数据
    const packet = Buffer.allocUnsafe(TcpProtocol.HEADER_SIZE + dataLength);
    
    // 写入数据长度（大端序，32位无符号整数）
    packet.writeUInt32BE(dataLength, 0);
    
    // 写入数据类型：1 表示 JSON
    packet.writeUInt8(TcpProtocol.TYPE_JSON, 4);
    
    // 优化：直接写入 JSON 字符串，避免中间 Buffer.from 和 copy
    packet.write(jsonString, TcpProtocol.HEADER_SIZE, dataLength, 'utf8');
    
    return packet;
  }

  /**
   * 打包二进制数据（优化版本）
   * @param {Buffer|Array|string} data - 要发送的二进制数据
   * @returns {Buffer} - 封装好的数据包
   */
  static packBinary(data) {
    // 优化：如果已经是 Buffer，直接使用，避免转换
    const isBuffer = Buffer.isBuffer(data);
    const dataLength = isBuffer ? data.length : Buffer.byteLength(data);
    
    // 创建完整数据包：4字节长度 + 1字节类型 + 数据
    const packet = Buffer.allocUnsafe(TcpProtocol.HEADER_SIZE + dataLength);
    
    // 写入数据长度（大端序，32位无符号整数）
    packet.writeUInt32BE(dataLength, 0);
    
    // 写入数据类型：2 表示二进制
    packet.writeUInt8(TcpProtocol.TYPE_BINARY, 4);
    
    // 优化：根据数据类型选择最快的写入方法
    if (isBuffer) {
      // 如果是 Buffer，直接拷贝
      data.copy(packet, TcpProtocol.HEADER_SIZE);
    } else {
      // 如果不是 Buffer，直接写入（避免创建中间 Buffer）
      if (typeof data === 'string') {
        packet.write(data, TcpProtocol.HEADER_SIZE, dataLength, 'utf8');
      } else {
        // 数组等其他类型，转换后写入
        Buffer.from(data).copy(packet, TcpProtocol.HEADER_SIZE);
      }
    }
    
    return packet;
  }

  constructor(options = {}) {
    this.buffer = Buffer.alloc(0);
    this.bufferStart = 0; // 当前有效数据的起始位置
    this.bufferEnd = 0;   // 当前有效数据的结束位置（不包含）
    this.maxBufferSize = options.maxBufferSize || 10 * 1024 * 1024; // 默认最大 10MB
    this.preallocSize = options.preallocSize || 64 * 1024; // 预分配 64KB
  }

  /**
   * 解析数据包（支持粘包处理，高性能版本）
   * @param {Buffer} chunk - 接收到的数据块
   * @param {Function} [callback] - 可选的回调函数，用于处理每个解析出的数据包
   * @returns {Object|null|Array} - 如果提供了回调则返回解析的包数量，否则返回单个包或 null
   */
  async unpack(chunk, callback) {
    // 追加新数据到缓冲区
    if (chunk && chunk.length > 0) {
      // 计算当前有效数据大小
      const currentDataSize = this.bufferEnd - this.bufferStart;
      const newDataEnd = currentDataSize + chunk.length;
      
      // 优化 1: 如果已消费超过一半，进行压缩（移动数据到开头）
      if (this.bufferStart > 0 && this.bufferStart > this.buffer.length / 2) {
        if (currentDataSize > 0) {
          this.buffer.copy(this.buffer, 0, this.bufferStart, this.bufferEnd);
        }
        this.bufferEnd = currentDataSize;
        this.bufferStart = 0;
      }
      
      // 检查是否需要扩容
      if (newDataEnd > this.buffer.length) {
        // 预分配更大的空间
        const newSize = Math.max(
          newDataEnd,
          Math.max(this.buffer.length * 2, this.preallocSize)
        );
        
        if (newSize > this.maxBufferSize) {
          throw new Error(`缓冲区超出最大限制: ${newSize} > ${this.maxBufferSize}`);
        }
        
        const newBuffer = Buffer.allocUnsafe(newSize);
        // 复制有效数据
        if (currentDataSize > 0) {
          this.buffer.copy(newBuffer, 0, this.bufferStart, this.bufferEnd);
        }
        this.buffer = newBuffer;
        this.bufferEnd = currentDataSize;
        this.bufferStart = 0;
      }
      
      // 追加新数据
      chunk.copy(this.buffer, this.bufferEnd - this.bufferStart + this.bufferStart);
      this.bufferEnd += chunk.length;
    }
    
    // 如果提供了回调函数，循环解析所有完整的包
    if (callback && typeof callback === 'function') {
      let count = 0;
      let packet;
      
      while ((packet = this._parseOnePacket()) !== null) {
        await callback(packet);
        count++;
      }
      
      return count;
    }
    
    // 否则只解析一个包并返回
    return this._parseOnePacket();
  }

  /**
   * 内部方法：解析单个数据包
   * @private
   * @returns {Object|null} - 解析结果 {type, data} 或 null（数据不完整）
   */
  _parseOnePacket() {
    // 计算可用数据大小
    const availableSize = this.bufferEnd - this.bufferStart;
    
    // 至少需要5字节的头部
    if (availableSize < TcpProtocol.HEADER_SIZE) {
      return null;
    }
    
    // 读取数据长度
    const dataLength = this.buffer.readUInt32BE(this.bufferStart);
    
    // 数据长度合法性检查
    if (dataLength > this.maxBufferSize || dataLength < 0) {
      throw new Error(`非法的数据包长度: ${dataLength}`);
    }
    
    // 检查是否接收到完整数据包
    const packetSize = TcpProtocol.HEADER_SIZE + dataLength;
    if (availableSize < packetSize) {
      // 数据不完整，保留在缓冲区等待更多数据
      return null;
    }
    
    // 读取数据类型
    const dataType = this.buffer.readUInt8(this.bufferStart + 4);
    
    // 解析数据
    let data;
    const dataStart = this.bufferStart + TcpProtocol.HEADER_SIZE;
    const dataEnd = dataStart + dataLength;
    
    if (dataType === TcpProtocol.TYPE_JSON) {
      // JSON 数据
      const jsonString = this.buffer.toString('utf8', dataStart, dataEnd);
      try {
        data = JSON.parse(jsonString);
      } catch (err) {
        throw new Error(`JSON 解析错误: ${err.message}`);
      }
    } else if (dataType === TcpProtocol.TYPE_BINARY) {
      // 二进制数据 - 使用 slice（零拷贝）
      data = this.buffer.slice(dataStart, dataEnd);
    } else {
      throw new Error(`未知的数据类型: ${dataType}`);
    }
    
    // 移动 start，标记数据已消费
    this.bufferStart += packetSize;
    
    // 如果缓冲区全部消费完，重置
    if (this.bufferStart >= this.bufferEnd) {
      this.bufferStart = 0;
      this.bufferEnd = 0;
      // 如果缓冲区太大，释放
      if (this.buffer.length > this.preallocSize * 4) {
        this.buffer = Buffer.alloc(0);
      }
    }
    
    return {
      type: dataType,
      data: data
    };
  }

  /**
   * 清空缓冲区
   */
  clearBuffer() {
    this.bufferStart = 0;
    this.bufferEnd = 0;
    this.buffer = Buffer.alloc(0);
  }

  /**
   * 获取当前缓冲区有效数据大小
   * @returns {number} - 缓冲区有效字节数
   */
  getBufferSize() {
    return this.bufferEnd - this.bufferStart;
  }

  /**
   * 获取缓冲区总容量
   * @returns {number} - 缓冲区总字节数
   */
  getBufferCapacity() {
    return this.buffer.length;
  }

  /**
   * 压缩缓冲区（手动触发）
   * 移除已消费的数据，释放内存
   */
  compactBuffer() {
    if (this.bufferStart > 0) {
      const remainingSize = this.bufferEnd - this.bufferStart;
      if (remainingSize > 0) {
        const newBuffer = Buffer.allocUnsafe(remainingSize);
        this.buffer.copy(newBuffer, 0, this.bufferStart, this.bufferEnd);
        this.buffer = newBuffer;
      } else {
        this.buffer = Buffer.alloc(0);
      }
      this.bufferEnd = remainingSize;
      this.bufferStart = 0;
    }
  }
}

module.exports = TcpProtocol;
