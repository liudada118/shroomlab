# Glove Motion 区域渲染说明

本文档说明 `http://localhost:5173/#/glove-motion` 页面中，彩色手部线框模型是如何渲染出来的。

## 入口文件

页面实现位于：

```text
src/GloveMotionPage.jsx
```

加载的手部模型是：

```text
public/model/hand1_wrist_cut_cyan_rigged_wireframe.glb
```

区域索引文件是：

```text
public/hand1_wrist_cut_wire_regions.json
```

## 渲染流程

1. 使用 `GLTFLoader` 加载 `hand1_wrist_cut_cyan_rigged_wireframe.glb`。
2. 使用 `normalizeModel()` 对模型进行居中、缩放和旋转，让模型进入当前相机视角。
3. 使用 `applyModelLook()` 保留 GLB 原始材质，同时调整材质参数：

```js
roughness = 0.52;
metalness = 0.08;
side = THREE.DoubleSide;
```

4. 模型初始会先使用默认青色线框色：

```js
const DEFAULT_LINE_COLOR = '#6dfaff';
```

5. 页面加载 `hand1_wrist_cut_wire_regions.json`。
6. `applyRegionColors()` 找到模型 mesh，创建 `color` 顶点属性，并按照区域给顶点上色。
7. 材质切换为顶点色渲染：

```js
material.color.set(0xffffff);
material.vertexColors = true;
material.needsUpdate = true;
```

## 区域颜色

当前区域颜色定义在 `REGION_COLORS` 中：

```js
const REGION_COLORS = {
  palm: 0x00ff00,
  thumb: 0xff0000,
  index: 0xffff00,
  middle: 0xff00ff,
  ring: 0x0088ff,
  pinky: 0xff8800,
};
```

对应关系如下：

| 区域 | 颜色 | Hex |
| --- | --- | --- |
| palm | 绿色 | `#00ff00` |
| thumb | 红色 | `#ff0000` |
| index | 黄色 | `#ffff00` |
| middle | 紫红色 | `#ff00ff` |
| ring | 蓝色 | `#0088ff` |
| pinky | 橙色 | `#ff8800` |

## 区域映射逻辑

`hand1_wrist_cut_wire_regions.json` 按照线段索引记录区域归属。

关键字段示例：

```json
{
  "verticesPerLine": 8,
  "regions": [
    {
      "key": "palm",
      "editable": true,
      "lineIndices": []
    }
  ]
}
```

每条线段对应的第一个顶点索引这样计算：

```js
const firstVertex = lineIndex * verticesPerLine;
```

然后每条线段连续给 8 个顶点上色：

```js
for (let i = 0; i < verticesPerLine; i += 1) {
  attribute.setXYZ(firstVertex + i, color.r, color.g, color.b);
}
```

`wrist` 区域不会被重新上色，因为它在 JSON 中被标记为不可编辑区域。

## 场景灯光

当前视觉效果不只来自区域顶点色，还依赖 Three.js 场景灯光和页面背景。

Three.js 场景使用了：

```js
scene.fog = new THREE.Fog(0x06121a, 10, 30);

scene.add(new THREE.HemisphereLight(0xc9ffff, 0x061018, 1.12));

const keyLight = new THREE.DirectionalLight(0xffffff, 1.05);
keyLight.position.set(-4, 6.2, 8);

const rimLight = new THREE.PointLight(0x00fff7, 1.6, 20);
rimLight.position.set(4.5, 1.8, -4);

const grid = new THREE.GridHelper(10, 26, 0x1edee6, 0x123b4b);
grid.material.opacity = 0.22;
```

这些配置组合出了当前的霓虹线框效果：

```text
高饱和区域顶点色
+ 青色边缘光
+ 深蓝绿色雾效
+ 透明 canvas 叠加 CSS 网格背景
= 高对比彩色线框手部模型
```

## CSS 背景

页面背景由 `src/styles.css` 中的 `.glove-motion-page` 控制。

Three.js canvas 本身是透明的：

```js
renderer.setClearColor(0x000000, 0);
```

因此模型最终是叠加在深色 CSS 背景之上的。

## 与 Pressure 数据的关系

`hand1_wrist_cut_wire_regions.json` 可以用于根据压力数据给模型区域上色，但它和 Pressure 页面当前使用的数据不是同一个坐标系统，不能直接按数组索引一一对应。

当前 `hand1_wrist_cut_wire_regions.json` 中的区域是：

```text
palm
thumb
index
middle
ring
pinky
wrist
```

Pressure 侧已有的 11 个区域是：

```text
palm
thumb
index
middle
ring
pinky
thumb_connection
index_connection
middle_connection
ring_connection
pinky_connection
```

建议的合并对应关系：

```text
hand1 palm   -> pressure palm
hand1 thumb  -> pressure thumb + thumb_connection
hand1 index  -> pressure index + index_connection
hand1 middle -> pressure middle + middle_connection
hand1 ring   -> pressure ring + ring_connection
hand1 pinky  -> pressure pinky + pinky_connection
hand1 wrist  -> 不参与 pressure 映射
```

如果要实现真正的 11 区域独立控制，需要把 `hand1_wrist_cut_wire_regions.json` 中五个手指与手掌连接区域单独拆分出来，形成：

```text
thumb_connection
index_connection
middle_connection
ring_connection
pinky_connection
```

这样才能和 Pressure 侧的 11 区域数据精确对应。
