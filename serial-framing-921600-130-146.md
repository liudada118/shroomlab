# 921600 串口 130/146 字节分帧协议说明

本文档用于把当前项目中的触觉手套 2 串口分帧逻辑迁移到其他项目。协议依据当前代码实现整理，主要对应 `hand0205Double` 传感器类型。

## 关键参数

| 项目 | 值 |
| --- | --- |
| 波特率 | `921600` |
| 帧尾分隔符 | `AA 55 03 99` |
| 分帧方式 | 按帧尾分隔符切包 |
| 有效 payload 长度 | `130` 字节或 `146` 字节 |
| 完整压力点数 | `256` 点 |
| 姿态数据长度 | `16` 字节 |
| 左右手标识 | payload 第 2 字节：`01=左手`，`02=右手` |

注意：`130` 和 `146` 是去掉帧尾 `AA 55 03 99` 之后的 payload 长度，不包含 4 字节帧尾。

## 串口帧格式

硬件连续发送两类 payload，并在每个 payload 后追加帧尾：

```text
[130 字节 payload] AA 55 03 99
[146 字节 payload] AA 55 03 99
```

接收端使用 `AA 55 03 99` 作为分隔符后，程序拿到的 buffer 不包含分隔符。

## 130 字节 payload

```text
byte 0      : 包序号 / 分段标识，当前双手分流逻辑不依赖它
byte 1      : 手别，01=左手，02=右手
byte 2-129  : 压力数据前半段，共 128 字节
```

处理方式：

1. 读取 `byte 1` 判断左手或右手。
2. 保存 `byte 2-129` 这 128 字节到对应手的临时缓存。
3. 等待同一只手后续的 `146` 字节 payload。

## 146 字节 payload

```text
byte 0      : 包序号 / 分段标识，当前双手分流逻辑不依赖它
byte 1      : 手别，01=左手，02=右手
byte 2-129  : 压力数据后半段，共 128 字节
byte 130-145: IMU / 姿态数据，共 16 字节
```

处理方式：

1. 读取 `byte 1` 判断左手或右手。
2. 取 `byte 2-129` 作为压力后半段。
3. 取 `byte 130-145` 作为 IMU 数据。
4. 将之前缓存的 128 字节前半段和当前 128 字节后半段拼接，得到 256 点压力数据。
5. 清空对应手的临时缓存。

## 完整采样组合

一帧完整采样由同一只手的 `130` payload 和 `146` payload 组合：

```text
pressureData = payload130[2..129] + payload146[2..129]
imuBytes     = payload146[130..145]
```

结果：

```text
pressureData.length = 256
imuBytes.length     = 16
```

IMU 数据按 4 个 `float32 little-endian` 解析：

```text
imu[0] = float32LE(imuBytes[0..3])
imu[1] = float32LE(imuBytes[4..7])
imu[2] = float32LE(imuBytes[8..11])
imu[3] = float32LE(imuBytes[12..15])
```

如果 4 个姿态值全为 `0`，当前项目一般不下发 `rotate` 字段。

## 推荐状态机

每只手维护一个独立缓存：

```text
chunks.left  = null
chunks.right = null
```

接收到 payload 后：

1. 长度是 `130`：缓存该手的前 128 字节。
2. 长度是 `146`：查找该手缓存，存在则组合成完整 256 点数据；不存在则丢弃当前包或记录异常。
3. 其他长度：丢弃并记录日志。
4. 如果连续收到同一只手多个 `130` 包，使用最新的 `130` 包覆盖旧缓存，用于自动重新同步。
5. 建议给缓存加超时，例如 `200 ms` 到 `500 ms` 内没有等到 `146` 包就清空缓存。

## Node.js 示例

安装依赖：

```bash
npm install serialport @serialport/parser-delimiter
```

可直接迁移的解析代码：

```js
const { SerialPort } = require('serialport');
const { DelimiterParser } = require('@serialport/parser-delimiter');

const BAUD_RATE = 921600;
const FRAME_DELIMITER = Buffer.from([0xaa, 0x55, 0x03, 0x99]);
const SIDE_BY_TYPE = {
  1: 'left',
  2: 'right',
};

function parseFloat32LEArray(bytes) {
  const result = [];
  for (let offset = 0; offset + 3 < bytes.length; offset += 4) {
    const value = bytes.readFloatLE(offset);
    result.push(Number.isFinite(value) ? value : 0);
  }
  return result;
}

function createGloveFramer({ onFrame, onDrop = () => {} } = {}) {
  const chunks = {
    left: null,
    right: null,
  };
  const chunkTime = {
    left: 0,
    right: 0,
  };
  const timeoutMs = 300;

  function getSide(payload) {
    return SIDE_BY_TYPE[Number(payload[1])] || null;
  }

  function cleanupExpired(now = Date.now()) {
    for (const side of ['left', 'right']) {
      if (chunks[side] && now - chunkTime[side] > timeoutMs) {
        chunks[side] = null;
        onDrop({ reason: 'first chunk timeout', side });
      }
    }
  }

  function handlePayload(payload) {
    cleanupExpired();

    if (!Buffer.isBuffer(payload)) {
      payload = Buffer.from(payload);
    }

    if (payload.length !== 130 && payload.length !== 146) {
      onDrop({ reason: 'unexpected payload length', length: payload.length });
      return;
    }

    const side = getSide(payload);
    if (!side) {
      onDrop({ reason: 'unknown hand side', packetType: payload[1] });
      return;
    }

    if (payload.length === 130) {
      chunks[side] = Buffer.from(payload.subarray(2, 130));
      chunkTime[side] = Date.now();
      return;
    }

    const firstChunk = chunks[side];
    chunks[side] = null;

    if (!firstChunk || firstChunk.length !== 128) {
      onDrop({ reason: 'missing first chunk', side });
      return;
    }

    const secondChunk = payload.subarray(2, 130);
    const imuBytes = payload.subarray(130, 146);
    const pressureData = Array.from(Buffer.concat([firstChunk, secondChunk]));
    const rotate = parseFloat32LEArray(imuBytes);

    onFrame({
      side,
      pressureData,
      rotate,
      raw: {
        firstChunk,
        secondChunk: Buffer.from(secondChunk),
        imuBytes: Buffer.from(imuBytes),
      },
    });
  }

  return { handlePayload };
}

function openGlovePort(portPath) {
  const port = new SerialPort({
    path: portPath,
    baudRate: BAUD_RATE,
    autoOpen: true,
  });

  const parser = port.pipe(new DelimiterParser({
    delimiter: FRAME_DELIMITER,
  }));

  const framer = createGloveFramer({
    onFrame(frame) {
      console.log('frame', frame.side, frame.pressureData.length, frame.rotate);
      // frame.side: 'left' 或 'right'
      // frame.pressureData: 256 点压力原始值
      // frame.rotate: 4 个 float32LE 姿态值
    },
    onDrop(info) {
      console.warn('drop serial payload', info);
    },
  });

  parser.on('data', framer.handlePayload);

  port.on('error', (error) => {
    console.error('serial error', error);
  });

  return { port, parser, framer };
}

module.exports = {
  openGlovePort,
  createGloveFramer,
};
```

## WebSocket / 上层数据建议

解析完成后，建议给上层输出统一对象：

```js
{
  handSide: 'left',          // left 或 right
  pressureData: [/* 256 */], // 原始压力矩阵
  rotate: [/* 4 */],         // IMU float32LE，全部为 0 时可省略
  timestamp: Date.now()
}
```

如果需要兼容当前项目的字段命名：

| 手别 | 当前项目实时字段 |
| --- | --- |
| 左手 | `sitData` / `realArr` / `rawPressureData` / `newArr147` / `handSide: "left"` |
| 右手 | `backData` / `realArr` / `rawPressureData` / `newArr147` / `handSide: "right"` |

另一个项目如果不需要当前项目的手部模型映射，只保留 `pressureData` 和 `rotate` 即可。

## 异常处理建议

- `146` payload 到达但没有对应 `130` 缓存：丢弃，并等待下一次 `130` 重新同步。
- `130` payload 到达但缓存中已有旧数据：覆盖旧缓存。
- payload 长度不是 `130` 或 `146`：丢弃并记录长度。
- 手别不是 `01` 或 `02`：丢弃并记录原始 `byte 1`。
- `rotate` 解析出 `NaN` 或 `Infinity`：替换为 `0`。
- 如果压力数据里可能出现 `AA 55 03 99` 连续字节，需要硬件协议额外保证转义或校验；当前项目按分隔符直接切包，默认 payload 不会误包含该分隔符。

## 当前项目代码对应关系

| 逻辑 | 文件位置 |
| --- | --- |
| 波特率选择 `921600` | `server.js` 的 `getSensorBaudRate()` |
| 帧尾 `AA 55 03 99` | `server.js` 的 `splitBuffer` |
| 串口分隔解析 | `DelimiterParser({ delimiter: splitBuffer })` |
| 130 字节前半包缓存 | `handleHandGloveDoubleFirstPacket()` |
| 146 字节后半包 + IMU 组合 | `handleHandGloveDoubleSecondPacket()` |
| 左右手路由 | `getHandGloveDoublePacketSide()` / `routeHandGloveDoubleFrame()` |
| IMU float32LE 解析 | `server/mathUtils.js` 的 `bytes4ToInt10()` |
