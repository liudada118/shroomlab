# Wuji Hand WebSocket 接入说明

本文档只说明如何从另一个项目通过 WebSocket 调用当前 Wuji Hand bridge。

## 1. WebSocket 地址

```text
ws://127.0.0.1:8765/ws
```

前提：本机 Wuji bridge 服务已经启动。

可以先检查：

```text
http://127.0.0.1:8765/health
```

正常返回示例：

```json
{
  "ok": true,
  "live": true,
  "frames": 0,
  "controller_ready": false,
  "hardware_error": null
}
```

字段含义：

```text
ok=true                 bridge 服务正常
live=true               当前是实机模式
hardware_error=null     没有硬件错误
frames                  已接收/处理的控制帧数
controller_ready        实时控制器是否已经打开；第一次发送目标后通常会变 true
```

## 2. 连接后 bridge 首包

连接 WebSocket 后，bridge 会主动发一条 `status`：

```json
{
  "type": "status",
  "live": true,
  "frames": 0,
  "version": "v2026.05.05-live-ui-27.1",
  "sdk_matrix": "F1..F5 x J1..J4 rad"
}
```

## 3. 发送格式

另一个项目只需要发送 JSON 文本，不需要二进制。

最常用格式：

```json
{
  "type": "snapshot",
  "mode": "five-bend-control",
  "target": [
    [0.000, 0.000, 0.000, 0.000],
    [0.165, 0.000, 0.270, 0.225],
    [0.275, 0.000, 0.450, 0.375],
    [0.275, 0.000, 0.450, 0.375],
    [0.110, 0.000, 0.180, 0.150]
  ],
  "maxRad": 1.0,
  "spreadMaxRad": 0.2,
  "timestamp": 1720000000.123
}
```

## 4. target 矩阵格式

`target` 是 `5x4` 数组，单位是弧度 `rad`。

行顺序：

```text
0 = thumb  拇指
1 = index  食指
2 = middle 中指
3 = ring   无名指
4 = little 小指
```

列顺序：

```text
0 = J1 第一段弯曲
1 = J2 开合/侧摆
2 = J3 中段弯曲
3 = J4 末段弯曲
```

如果只有五指弯曲值，没有开合/侧摆，`J2` 填 `0`。

## 5. 从五指弯曲值生成 target

输入：

```json
[0.0, 0.3, 0.5, 0.5, 0.2]
```

顺序：

```text
[拇指, 食指, 中指, 无名指, 小指]
```

转换公式：

```text
J1 = bend * maxRad * 0.55
J2 = 0
J3 = bend * maxRad * 0.90
J4 = bend * maxRad * 0.75
```

## 6. Bridge 返回 ack

bridge 不是每帧都返回，通常每 5 帧返回一次：

```json
{
  "type": "ack",
  "frames": 25,
  "live": true,
  "hardware_error": null,
  "control_path": "target-matrix",
  "raw_abs_max": 0.6,
  "clipped_values": 0,
  "apply_ms": 0.5
}
```

重点看：

```text
hardware_error=null   无硬件错误
clipped_values=0      没有被安全限幅裁剪
apply_ms              bridge 处理耗时
frames                已处理帧数
```

## 7. 错误返回

如果格式错误或硬件错误，会返回：

```json
{
  "type": "error",
  "message": "target 必须是 5×4，当前 shape=(...)",
  "live": true,
  "frames": 10,
  "hardware_error": null
}
```

常见错误：

```text
target 不是 5x4
target 里有 NaN 或 Inf
Wuji USB 设备没有枚举
设备被其他程序占用
bridge 不是 live 模式
```

## 8. JavaScript 最小示例

```js
const ws = new WebSocket("ws://127.0.0.1:8765/ws");

function bendValuesToTarget(bends, maxRad = 1.0) {
  return bends.slice(0, 5).map((bend) => {
    const b = Math.max(0, Math.min(1, Number(bend)));
    return [
      +(b * maxRad * 0.55).toFixed(4),
      0,
      +(b * maxRad * 0.90).toFixed(4),
      +(b * maxRad * 0.75).toFixed(4)
    ];
  });
}

ws.onopen = () => {
  const bends = [0.0, 0.3, 0.5, 0.5, 0.2];

  ws.send(JSON.stringify({
    type: "snapshot",
    mode: "five-bend-control",
    target: bendValuesToTarget(bends, 1.0),
    maxRad: 1.0,
    spreadMaxRad: 0.2,
    timestamp: Date.now() / 1000
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log("bridge:", msg);
};
```

## 9. Python 最小示例

```python
import asyncio
import json
import time
import websockets


def bend_values_to_target(bends, max_rad=1.0):
    target = []
    for bend in bends[:5]:
        b = max(0.0, min(1.0, float(bend)))
        target.append([
            round(b * max_rad * 0.55, 4),
            0.0,
            round(b * max_rad * 0.90, 4),
            round(b * max_rad * 0.75, 4),
        ])
    return target


async def main():
    async with websockets.connect("ws://127.0.0.1:8765/ws") as ws:
        print("status:", await ws.recv())

        bends = [0.0, 0.3, 0.5, 0.5, 0.2]
        payload = {
            "type": "snapshot",
            "mode": "five-bend-control",
            "target": bend_values_to_target(bends, max_rad=1.0),
            "maxRad": 1.0,
            "spreadMaxRad": 0.2,
            "timestamp": time.time(),
        }

        await ws.send(json.dumps(payload))
        print("reply:", await ws.recv())


asyncio.run(main())
```

## 10. 连续发送建议

实时控制时：

```text
建议频率: 20-30 FPS
每帧发送最新 target
不要同时让摄像头页面和你的项目一起发
停止时发送 5-10 帧全 0 target
```

全 0 target：

```json
[
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0]
]
```

