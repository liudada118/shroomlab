# 触觉手套四元数与手指弯折输出说明

本文档用于把当前项目中的触觉手套四元数和手指弯折逻辑迁移到其他项目。串口分帧请先参考 `docs/serial-framing-921600-130-146.md`。

## 数据来源

完整手套采样由 `130` 字节 payload 和 `146` 字节 payload 组合：

```text
pressureData = payload130[2..129] + payload146[2..129]  // 256 点压力
imuBytes     = payload146[130..145]                     // 16 字节姿态
```

后端当前输出：

```js
{
  handSide: 'left',          // left 或 right
  realArr: [/* 256 */],      // 原始 256 点压力
  rawPressureData: [/* 256 */],
  newArr147: [/* mapped */], // 手形映射数据，用于手指弯折取点
  rotate: [q0, q1, q2, q3]   // 由 16 字节 IMU 解析，全部为 0 时可能省略
}
```

左手一般走 `sitData`，右手一般走 `backData`。双手套模式下以 `handSide` 为准，不依赖串口来自哪个端口。

## 四元数解析

`imuBytes` 长度为 `16`，按 4 个 `float32 little-endian` 解析：

```js
function parseQuaternionFromImuBytes(imuBytes) {
  const buffer = Buffer.from(imuBytes);
  const result = [];
  for (let offset = 0; offset + 3 < buffer.length; offset += 4) {
    const value = buffer.readFloatLE(offset);
    result.push(Number.isFinite(value) ? value : 0);
  }
  return result; // [q0, q1, q2, q3]
}
```

当前项目对应逻辑是 `server/mathUtils.js` 的 `bytes4ToInt10()`。

## 四元数输出规则

后端直接输出解析后的数组：

```js
const rotate = parseQuaternionFromImuBytes(imuBytes);

const payload = {
  handSide,
  realArr: pressureData,
  rawPressureData: pressureData,
  newArr147: mappedPressureData,
};

if (rotate.length && !rotate.every((value) => value === 0)) {
  payload.rotate = rotate;
}
```

建议另一个项目保留原始字段名：

```js
{
  handSide: 'left',
  pressureData: [/* 256 */],
  mappedPressureData: [/* mapped */],
  quaternion: [q0, q1, q2, q3],
  timestamp: Date.now()
}
```

如果要兼容当前前端，也可以继续使用字段名 `rotate`。

## 前端四元数应用

当前前端不是直接把 `rotate` 塞进模型，而是先做坐标调整、有效性过滤和初始姿态归零。

### 有效性过滤

```js
function isValidQuaternionInput(rotate) {
  if (!Array.isArray(rotate) || rotate.length < 4) return false;
  if (rotate.some((value) => value == null || Number.isNaN(value))) return false;

  const modelInput = [-rotate[0], rotate[1], rotate[2], rotate[3]];
  return !modelInput.some((value) => Math.abs(value) > 1);
}
```

### 坐标调整

当前前端先做：

```js
const modelInput = [-rotate[0], rotate[1], rotate[2], rotate[3]];
```

进入 `transformQuaternion()` 后，又交换前两个分量：

```js
const values = [...modelInput];
[values[0], values[1]] = [values[1], values[0]];
const q = new THREE.Quaternion(...values);
```

所以从后端原始 `rotate = [q0, q1, q2, q3]` 到 `THREE.Quaternion` 的实际输入为：

```text
THREE.Quaternion(q1, -q0, q2, q3)
```

### 初始姿态归零

每只手维护独立的基准四元数：

```js
const state = {
  left: { base: null, baseInv: null },
  right: { base: null, baseInv: null },
};
```

第一帧有效四元数作为基准，模型输出单位四元数：

```js
function transformQuaternion(rawRotate, handSide) {
  const modelInput = [-rawRotate[0], rawRotate[1], rawRotate[2], rawRotate[3]];
  const values = [...modelInput];
  [values[0], values[1]] = [values[1], values[0]];

  const q = new THREE.Quaternion(...values);
  const handState = state[handSide];

  if (!handState.base) {
    handState.base = q.clone();
    handState.baseInv = handState.base.clone().invert();
    return new THREE.Quaternion(0, 0, 0, 1);
  }

  if (handState.base.lengthSq() === 0) {
    return new THREE.Quaternion(0, 0, 0, 1);
  }

  const transformed = new THREE.Quaternion();
  transformed.multiplyQuaternions(handState.baseInv, q);
  transformed.x = -transformed.x;
  return transformed;
}
```

应用到模型：

```js
if (handSide === 'right') {
  rightHandGroup.quaternion.copy(transformQuaternion(rotate, 'right'));
} else {
  leftHandGroup.quaternion.copy(transformQuaternion(rotate, 'left'));
}
```

## 四元数渲染流程

当前项目的四元数渲染链路如下：

```text
串口 146 payload 末尾 16 字节
  -> 后端 bytes4ToInt10() 解析为 rotate[4]
  -> WebSocket 下发 rotate
  -> 前端过滤非法值
  -> 坐标转换 [-q0, q1, q2, q3] + 交换前两位
  -> 每只手首帧作为基准姿态
  -> qRender = base^-1 * qCurrent
  -> qRender.x 取反
  -> leftHandGroup/rightHandGroup.quaternion.copy(qRender)
  -> renderer.render(scene, camera)
```

### 渲染对象

双手套模式中，左右手分别有独立的 Three.js group：

```js
let leftHandGroup;
let rightHandGroup;

let quaternion;      // 左手当前渲染四元数
let rightQuaternion; // 右手当前渲染四元数
```

左手使用 `changeHandAngle()`，右手使用 `changeRightHandAngle()`：

```js
function changeHandAngle(rotate) {
  if (!rotate || rotate.includes(undefined)) return;
  quaternion = transformQuaternion(rotate, 'left');
  if (leftHandGroup && quaternion) {
    leftHandGroup.quaternion.copy(quaternion);
  }
}

function changeRightHandAngle(rotate) {
  if (!rotate || rotate.includes(undefined)) return;
  rightQuaternion = transformQuaternion(rotate, 'right');
  if (rightHandGroup && rightQuaternion) {
    rightHandGroup.quaternion.copy(rightQuaternion);
  }
}
```

### 渲染循环中的保持

当前项目在收到四元数时会立即 `copy()` 一次，同时在渲染刷新函数里继续把缓存的四元数应用到模型：

```js
function sitRenew() {
  if (leftHandGroup && quaternion) {
    leftHandGroup.quaternion.copy(quaternion);
  }

  if (rightHandGroup && rightQuaternion) {
    rightHandGroup.quaternion.copy(rightQuaternion);
  }

  renderer.render(scene, camera);
}
```

这样做的目的：

1. WebSocket 到达时立即更新姿态，降低响应延迟。
2. 渲染循环每帧重新应用缓存姿态，避免模型加载、重建、其它动画逻辑覆盖 quaternion 后丢失姿态。

### 可复用渲染代码

下面是脱离当前项目后可直接复用的 Three.js 四元数渲染核心：

```js
import * as THREE from 'three';

const handState = {
  left: {
    base: null,
    baseInv: null,
    current: new THREE.Quaternion(0, 0, 0, 1),
    group: null,
  },
  right: {
    base: null,
    baseInv: null,
    current: new THREE.Quaternion(0, 0, 0, 1),
    group: null,
  },
};

function isUsableRotate(rotate) {
  if (!Array.isArray(rotate) || rotate.length < 4) return false;
  if (rotate.some((value) => value == null || Number.isNaN(value))) return false;

  const modelInput = [-rotate[0], rotate[1], rotate[2], rotate[3]];
  return !modelInput.some((value) => Math.abs(value) > 1);
}

function toThreeQuaternionInput(rotate) {
  // 当前项目实际等价于 THREE.Quaternion(q1, -q0, q2, q3)
  return [rotate[1], -rotate[0], rotate[2], rotate[3]];
}

function transformQuaternionForRender(rotate, handSide = 'left') {
  const state = handState[handSide];
  const q = new THREE.Quaternion(...toThreeQuaternionInput(rotate));

  if (!state.base) {
    state.base = q.clone();
    state.baseInv = state.base.clone().invert();
    return new THREE.Quaternion(0, 0, 0, 1);
  }

  if (state.base.lengthSq() === 0) {
    return new THREE.Quaternion(0, 0, 0, 1);
  }

  const rendered = new THREE.Quaternion();
  rendered.multiplyQuaternions(state.baseInv, q);
  rendered.x = -rendered.x;
  return rendered;
}

function updateHandQuaternion({ handSide, rotate }) {
  if (!isUsableRotate(rotate)) return;

  const state = handState[handSide];
  state.current = transformQuaternionForRender(rotate, handSide);

  if (state.group) {
    state.group.quaternion.copy(state.current);
  }
}

function renderFrame(renderer, scene, camera) {
  for (const side of ['left', 'right']) {
    const state = handState[side];
    if (state.group && state.current) {
      state.group.quaternion.copy(state.current);
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(() => renderFrame(renderer, scene, camera));
}
```

使用方式：

```js
handState.left.group = leftHandGroup;
handState.right.group = rightHandGroup;

// WebSocket 收到后端数据
updateHandQuaternion({
  handSide: message.handSide,
  rotate: message.rotate,
});
```

### 重置姿态

如果用户点击“归零”或重新校准姿态，需要清空对应手的基准四元数，让下一帧重新作为基准：

```js
function resetQuaternionBase(handSide) {
  const state = handState[handSide];
  state.base = null;
  state.baseInv = null;
  state.current = new THREE.Quaternion(0, 0, 0, 1);

  if (state.group) {
    state.group.quaternion.copy(state.current);
  }
}
```

双手同时重置：

```js
resetQuaternionBase('left');
resetQuaternionBase('right');
```

## 手指弯折数据来源

手指弯折不是串口直接输出的角度。当前项目从手形映射数据中提取 5 个指根压力点，再用每只手的校准上下限换算成 `0..1` 的弯折比例。

当前主要使用 `newArr147`。在 3D 遥控模式下，5 个指根点取法如下：

```js
function extractFingerRootPoints(mappedData) {
  const points = [];
  for (let i = 0; i < 5; i++) {
    const row = 4;
    const index = row * 15 + i * 3;
    points[i] =
      (mappedData[index] || 0) +
      (mappedData[index + 1] || 0) +
      (mappedData[index + 2] || 0);
  }
  return points; // 5 个原始指根压力值
}
```

也就是取映射矩阵第 5 行，每根手指连续 3 个点求和：

| 手指序号 | 取点索引 |
| --- | --- |
| `0` | `60, 61, 62` |
| `1` | `63, 64, 65` |
| `2` | `66, 67, 68` |
| `3` | `69, 70, 71` |
| `4` | `72, 73, 74` |

旧路径里如果收到的是 `newArr` 格式，会使用另一套压缩方式：

```js
function extractFingerRootPointsFromLegacyData(data) {
  const points = [];
  for (let i = 0; i < 5; i++) {
    let sum = 0;
    for (let j = 0; j < 3; j++) {
      const index = j * 10 + i * 2;
      sum += data[index] || 0;
      sum += data[index + 1] || 0;
    }
    points[i] = sum;
  }
  return points.reverse();
}
```

新项目如果只接 `hand0205Double`，优先使用 `newArr147` 的 `row * 15 + i * 3` 规则即可。

## 手指校准数据

每只手保存两组 5 点校准值：

```js
fingerCalibration = [
  [0, 0, 0, 0, 0],           // 伸直/最小值
  [255, 255, 255, 255, 255]  // 弯曲/最大值
]
```

当前项目本地存储 key：

| 手别 | localStorage key |
| --- | --- |
| 左手 | `fingerArrL` |
| 右手 | `fingerArrR` |

点击采集校准点时，当前 5 个指根压力值会写入对应数组：

```js
fingerCalibration[index] = latestFingerPoints;
```

其中 `index=0` 表示伸直基准，`index=1` 表示弯曲基准。

## 弯折比例计算

每根手指按以下公式转换为 `0..1`：

```js
function normalizeBendValue(rawValue, minValue, maxValue) {
  const base = maxValue - minValue || 1;
  const ratio = Math.round(((rawValue - minValue) / base) * 100) / 100;
  if (ratio < 0) return 0;
  if (ratio >= 1) return 1;
  return ratio;
}
```

当前项目还做了平滑：

```js
function updateFingerBend(previousBend, rawFingerPoints, fingerCalibration) {
  const next = [...previousBend];
  const minValues = fingerCalibration[0] || [0, 0, 0, 0, 0];
  const maxValues = fingerCalibration[1] || [255, 255, 255, 255, 255];

  for (let i = 0; i < 5; i++) {
    const rawValue = rawFingerPoints[i];
    if (rawValue == null || Number.isNaN(rawValue)) continue;

    const value = normalizeBendValue(rawValue, minValues[i] || 0, maxValues[i] || 0);
    next[i] = next[i] + (value - next[i]) / 3;
  }

  return next; // 5 个 0..1 弯折比例
}
```

双手套模式下，左右手需要维护独立的平滑状态：

```js
let leftBend = [0, 0, 0, 0, 0];
let rightBend = [0, 0, 0, 0, 0];
```

## 弯折角度应用

模型接收的是 `0..1` 弯折比例。每个关节实际旋转角度为：

```js
joint.rotation.z = (-Math.PI / 2) * bendValue;
```

即：

```text
bendValue = 0   -> 0 度
bendValue = 0.5 -> -45 度
bendValue = 1   -> -90 度
```

当前模型的 5 个值对应 5 根手指：

```js
rotateFinger([Finger_01, Finger_02], bend[0]);
rotateFinger([Finger_10, Finger_11, Finger_12], bend[1]);
rotateFinger([Finger_20, Finger_21, Finger_22], bend[2]);
rotateFinger([Finger_30, Finger_31, Finger_32], bend[3]);
rotateFinger([Finger_40, Finger_41, Finger_42], bend[4]);
```

## 推荐输出对象

如果另一个项目只需要消费结果，建议输出：

```js
{
  handSide: 'left',
  pressureData: [/* 256 */],
  mappedPressureData: [/* newArr147 */],
  quaternionRaw: [q0, q1, q2, q3],
  fingerRawPoints: [p0, p1, p2, p3, p4],
  fingerBend: [b0, b1, b2, b3, b4],       // 0..1
  fingerAngleRad: [a0, a1, a2, a3, a4],   // -PI/2..0
  timestamp: Date.now()
}
```

生成示例：

```js
function buildGloveControlFrame({
  handSide,
  pressureData,
  mappedPressureData,
  rotate,
  previousBend,
  fingerCalibration,
}) {
  const fingerRawPoints = extractFingerRootPoints(mappedPressureData);
  const fingerBend = updateFingerBend(previousBend, fingerRawPoints, fingerCalibration);
  const fingerAngleRad = fingerBend.map((value) => (-Math.PI / 2) * value);

  return {
    handSide,
    pressureData,
    mappedPressureData,
    quaternionRaw: rotate,
    fingerRawPoints,
    fingerBend,
    fingerAngleRad,
    timestamp: Date.now(),
  };
}
```

## 当前项目代码对应关系

| 逻辑 | 文件位置 |
| --- | --- |
| 16 字节 IMU 解析为 4 个 float32LE | `server/mathUtils.js` 的 `bytes4ToInt10()` |
| 后端输出 `rotate` | `server.js` 的 `routeHandGloveDoubleFrame()` |
| 左右手识别 | `server.js` 的 `getHandGloveDoublePacketSide()` |
| 指根 5 点提取、校准、平滑 | `client/src/page/home/Home.jsx` |
| 四元数坐标调整与基准归零 | `client/src/components/three/hand0205Double.jsx` 的 `transformQuaternion()` |
| 左手姿态应用 | `changeHandAngle()` |
| 右手姿态应用 | `changeRightHandAngle()` |
| 左手弯折应用 | `calibration()` |
| 右手弯折应用 | `calibrationRight()` |
| 手指关节角度 | `rotateFinger()` |
