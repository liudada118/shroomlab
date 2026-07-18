import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useWebSocketPressureSource } from './webSocketPressureSource.js';

const MODEL_URL = '/model/hand1_wrist_cut_cyan_rigged_wireframe.glb';
const REGION_DATA_URL = '/hand1_wrist_cut_wire_regions.json';
const FINGER_NAMES = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const FINGER_BONE_CHAINS = [
  ['Finger_01', 'Finger_02'],
  ['Finger_10', 'Finger_11', 'Finger_12'],
  ['Finger_20', 'Finger_21', 'Finger_22'],
  ['Finger_30', 'Finger_31', 'Finger_32'],
  ['Finger_40', 'Finger_41', 'Finger_42'],
];
const EMPTY_BEND = Object.freeze([0, 0, 0, 0, 0]);
const DEFAULT_CALIBRATION = Object.freeze([
  [0, 0, 0, 0, 0],
  [255, 255, 255, 255, 255],
]);
const FINGER_BEND_AXIS = new THREE.Vector3(0, 0, 1);
const DEFAULT_LINE_COLOR = '#6dfaff';
const LINE_COLOR_PRESETS = ['#6dfaff', '#00fff7', '#ff8157', '#ffe66d', '#a88cff'];
const DEFAULT_SCENE_BACKGROUND_COLOR = '#061018';
const GLOVE_MOTION_SETTINGS_KEY = 'shroomlab.gloveMotion.settings.v1';
const DEFAULT_REGION_LABEL = 'regions';
const REGION_COLORS = {
  palm: 0x00ff00,
  thumb: 0xff0000,
  index: 0xffff00,
  middle: 0xff00ff,
  ring: 0x0088ff,
  pinky: 0xff8800,
};
const NEW147_FINGER_KEYS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const NEW147_FINGER_ROW_COUNT = 4;
const NEW147_FINGER_COL_COUNT = 3;
const NEW147_FINGER_VALUE_COUNT = NEW147_FINGER_KEYS.length * NEW147_FINGER_ROW_COUNT * NEW147_FINGER_COL_COUNT;
const NEW147_IGNORED_FINGER_BASE_COUNT = 15;
const NEW147_PALM_ROW_COUNTS = [12, 15, 15, 15, 15];
const NEW147_PALM_VALUE_COUNT = NEW147_PALM_ROW_COUNTS.reduce((sum, count) => sum + count, 0);
const PRESSURE_BASE_COLOR = new THREE.Color(0x073c46);
const PRESSURE_CYAN = new THREE.Color(0x00fff7);
const PRESSURE_YELLOW = new THREE.Color(0xffe66d);
const PRESSURE_RED = new THREE.Color(0xff2f2f);
const WUJI_BRIDGE_URL = 'ws://127.0.0.1:8765/ws';
const WUJI_MAX_RAD = 1.0;
const WUJI_SPREAD_MAX_RAD = 0.2;
const WUJI_SEND_INTERVAL_MS = 40;
const WUJI_ZERO_FRAME_COUNT = 6;
const DEFAULT_WUJI_WEIGHTS = Object.freeze({
  maxRad: WUJI_MAX_RAD,
  j1: 0.55,
  j3: 0.90,
  j4: 0.75,
});
const WUJI_WEIGHT_CONTROLS = Object.freeze([
  { key: 'maxRad', label: 'Max', min: 0.2, max: 2.5, step: 0.01 },
  { key: 'j1', label: 'J1', min: 0, max: 2.5, step: 0.01 },
  { key: 'j3', label: 'J3', min: 0, max: 2.5, step: 0.01 },
  { key: 'j4', label: 'J4', min: 0, max: 2.5, step: 0.01 },
]);
const WUJI_ZERO_TARGET = Object.freeze([
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
]);
const DEFAULT_MODEL_TRANSFORM = Object.freeze({
  x: 0,
  y: 0,
  z: 0,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
  scale: 1,
});
const MODEL_TRANSFORM_CONTROLS = Object.freeze([
  { key: 'x', label: 'X', min: -10, max: 10, step: 0.05 },
  { key: 'y', label: 'Y', min: -10, max: 10, step: 0.05 },
  { key: 'z', label: 'Z', min: -10, max: 10, step: 0.05 },
  { key: 'rotX', label: 'Pitch', min: -360, max: 360, step: 1 },
  { key: 'rotY', label: 'Yaw', min: -360, max: 360, step: 1 },
  { key: 'rotZ', label: 'Roll', min: -360, max: 360, step: 1 },
  { key: 'scale', label: 'Scale', min: 0.35, max: 2.4, step: 0.01 },
]);
const HAND_BACK_PIVOT_LOCAL_Y = 0.88;

function defaultModelTransforms() {
  return {
    single: { ...DEFAULT_MODEL_TRANSFORM },
    left: { ...DEFAULT_MODEL_TRANSFORM },
    right: { ...DEFAULT_MODEL_TRANSFORM },
  };
}

function readStoredCalibration(handSide) {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_CALIBRATION.map((row) => [...row]);
  }

  const key = handSide === 'left' ? 'fingerArrL' : 'fingerArrR';
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    if (
      Array.isArray(parsed) &&
      parsed.length >= 2 &&
      parsed.every((row) => Array.isArray(row) && row.length >= 5)
    ) {
      return [
        parsed[0].slice(0, 5).map((value) => Number(value) || 0),
        parsed[1].slice(0, 5).map((value) => Number(value) || 0),
      ];
    }
  } catch {
    // Ignore malformed calibration from older sessions.
  }

  return DEFAULT_CALIBRATION.map((row) => [...row]);
}

function writeStoredCalibration(handSide, calibration) {
  if (typeof localStorage === 'undefined') {
    return;
  }

  const key = handSide === 'left' ? 'fingerArrL' : 'fingerArrR';
  localStorage.setItem(key, JSON.stringify(calibration));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function clampNumber(value, fallback, min = -Infinity, max = Infinity) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, numericValue));
}

function normalizeHexColor(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : fallback;
}

function normalizeModelTransform(value) {
  return MODEL_TRANSFORM_CONTROLS.reduce((transform, control) => {
    transform[control.key] = clampNumber(
      value?.[control.key],
      DEFAULT_MODEL_TRANSFORM[control.key],
      control.min,
      control.max,
    );
    return transform;
  }, {});
}

function normalizeModelTransforms(value) {
  const next = defaultModelTransforms();
  if (!value || typeof value !== 'object') {
    return next;
  }

  Object.entries(value).forEach(([key, transform]) => {
    if (transform && typeof transform === 'object') {
      next[key] = normalizeModelTransform(transform);
    }
  });

  return next;
}

function normalizeWujiWeights(value) {
  return WUJI_WEIGHT_CONTROLS.reduce((weights, control) => {
    weights[control.key] = clampNumber(
      value?.[control.key],
      DEFAULT_WUJI_WEIGHTS[control.key],
      control.min,
      control.max,
    );
    return weights;
  }, {});
}

function readStoredGloveMotionSettings() {
  const defaults = {
    useLiveData: true,
    bendGain: 1,
    lineColor: DEFAULT_LINE_COLOR,
    showSkeleton: false,
    mirrorScaleX: false,
    sceneBackgroundColor: DEFAULT_SCENE_BACKGROUND_COLOR,
    wujiWeights: { ...DEFAULT_WUJI_WEIGHTS },
    modelTransforms: defaultModelTransforms(),
  };

  if (typeof localStorage === 'undefined') {
    return defaults;
  }

  try {
    const parsed = JSON.parse(localStorage.getItem(GLOVE_MOTION_SETTINGS_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') {
      return defaults;
    }

    return {
      useLiveData: typeof parsed.useLiveData === 'boolean' ? parsed.useLiveData : defaults.useLiveData,
      bendGain: clampNumber(parsed.bendGain, defaults.bendGain, 0, 1.35),
      lineColor: normalizeHexColor(parsed.lineColor, defaults.lineColor),
      showSkeleton: typeof parsed.showSkeleton === 'boolean' ? parsed.showSkeleton : defaults.showSkeleton,
      mirrorScaleX: typeof parsed.mirrorScaleX === 'boolean' ? parsed.mirrorScaleX : defaults.mirrorScaleX,
      sceneBackgroundColor: normalizeHexColor(parsed.sceneBackgroundColor, defaults.sceneBackgroundColor),
      wujiWeights: normalizeWujiWeights(parsed.wujiWeights),
      modelTransforms: normalizeModelTransforms(parsed.modelTransforms),
    };
  } catch {
    return defaults;
  }
}

function writeStoredGloveMotionSettings(settings) {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(GLOVE_MOTION_SETTINGS_KEY, JSON.stringify(settings));
}

function roundRad(value) {
  return Math.round(value * 10000) / 10000;
}

function bendValuesToWujiTarget(bends, weights = DEFAULT_WUJI_WEIGHTS) {
  const maxRad = Number(weights.maxRad) || WUJI_MAX_RAD;
  return bends.slice(0, 5).map((bend) => {
    const b = clamp01(Number(bend) || 0);
    return [
      roundRad(b * maxRad * (Number(weights.j1) || 0)),
      0,
      roundRad(b * maxRad * (Number(weights.j3) || 0)),
      roundRad(b * maxRad * (Number(weights.j4) || 0)),
    ];
  });
}

function wujiSnapshotPayload(target, weights = DEFAULT_WUJI_WEIGHTS) {
  const maxRad = Number(weights.maxRad) || WUJI_MAX_RAD;
  return JSON.stringify({
    type: 'snapshot',
    mode: 'five-bend-control',
    target,
    maxRad,
    spreadMaxRad: WUJI_SPREAD_MAX_RAD,
    timestamp: Date.now() / 1000,
  });
}

function formatWujiStatus(enabled, status) {
  if (!enabled) {
    return 'OFF';
  }

  if (status.error) {
    return status.error;
  }

  if (status.connected) {
    return status.ack || `sent ${status.frames}`;
  }

  return 'connecting';
}

function clampIndex(value, maxExclusive) {
  return Math.max(0, Math.min(maxExclusive - 1, value));
}

function normalizeRange(value, bounds) {
  if (!Array.isArray(bounds) || bounds.length < 2 || bounds[0] === bounds[1]) {
    return 0;
  }

  return clamp01((value - bounds[0]) / (bounds[1] - bounds[0]));
}

function normalizePressureValue(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return clamp01(numericValue / 255);
}

function setPressureColor(attribute, vertexIndex, value) {
  const normalizedValue = normalizePressureValue(value);

  if (normalizedValue <= 0.01) {
    attribute.setXYZ(vertexIndex, PRESSURE_BASE_COLOR.r, PRESSURE_BASE_COLOR.g, PRESSURE_BASE_COLOR.b);
    return;
  }

  const color = PRESSURE_CYAN.clone();
  if (normalizedValue < 0.55) {
    color.lerp(PRESSURE_YELLOW, normalizedValue / 0.55);
  } else {
    color.copy(PRESSURE_YELLOW).lerp(PRESSURE_RED, (normalizedValue - 0.55) / 0.45);
  }

  attribute.setXYZ(vertexIndex, color.r, color.g, color.b);
}

function updateManualQuaternion(transform, target) {
  target.setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(transform.rotX || 0),
      THREE.MathUtils.degToRad(transform.rotY || 0),
      THREE.MathUtils.degToRad(transform.rotZ || 0),
      'XYZ',
    ),
  );

  return target;
}

function formatTransformValue(key, value) {
  if (key === 'scale') {
    return value.toFixed(2);
  }

  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
}

function isUsableRotate(rotate) {
  if (!Array.isArray(rotate) || rotate.length < 4) return false;
  if (rotate.some((value) => value == null || Number.isNaN(Number(value)))) return false;

  const modelInput = [-rotate[0], rotate[1], rotate[2], rotate[3]];
  return !modelInput.some((value) => Math.abs(Number(value)) > 1.0001);
}

function transformQuaternionForRender(rotate, state, target) {
  if (!state.input) {
    state.input = new THREE.Quaternion();
  }

  const q = state.input
    .set(Number(rotate[1]), -Number(rotate[0]), Number(rotate[2]), Number(rotate[3]))
    .normalize();

  if (!state.base) {
    state.base = q.clone();
    state.baseInv = state.base.clone().invert();
    return target.identity();
  }

  if (state.base.lengthSq() === 0) {
    return target.identity();
  }

  target.multiplyQuaternions(state.baseInv, q);
  target.x = -target.x;
  return target.normalize();
}

function rawRotateFromThreeQuaternion(q, target) {
  target[0] = -q.y;
  target[1] = q.x;
  target[2] = q.z;
  target[3] = q.w;
  return target;
}

function extractFingerRootPoints(mappedData, target) {
  if (!Array.isArray(mappedData) || mappedData.length < 75) {
    return false;
  }

  const row = 4;
  for (let fingerIndex = 0; fingerIndex < 5; fingerIndex += 1) {
    const index = row * 15 + fingerIndex * 3;
    target[fingerIndex] = (
      (Number(mappedData[index]) || 0) +
      (Number(mappedData[index + 1]) || 0) +
      (Number(mappedData[index + 2]) || 0)
    );
  }

  return true;
}

function normalizeBendValue(rawValue, minValue, maxValue) {
  const base = maxValue - minValue || 1;
  return clamp01(Math.round(((rawValue - minValue) / base) * 100) / 100);
}

function updateFingerBend(previousBend, rawFingerPoints, calibration) {
  if (!rawFingerPoints) {
    return previousBend;
  }

  const minValues = calibration[0] || DEFAULT_CALIBRATION[0];
  const maxValues = calibration[1] || DEFAULT_CALIBRATION[1];

  for (let index = 0; index < previousBend.length; index += 1) {
    const rawValue = Number(rawFingerPoints[index]);
    if (!Number.isFinite(rawValue)) {
      continue;
    }

    const value = normalizeBendValue(rawValue, minValues[index] || 0, maxValues[index] || 0);
    previousBend[index] += (value - previousBend[index]) / 3;
  }

  return previousBend;
}

function applyFingerBend(bones, originalQuaternions, bendValues, bendGain, curl) {
  FINGER_BONE_CHAINS.forEach((boneNames, fingerIndex) => {
    const bend = clamp01(bendValues[fingerIndex] || 0);
    const angle = (-Math.PI / 2) * bend * bendGain;
    curl.setFromAxisAngle(FINGER_BEND_AXIS, angle);

    boneNames.forEach((boneName) => {
      const bone = bones.get(boneName);
      const original = originalQuaternions.get(boneName);
      if (!bone || !original) return;

      bone.quaternion.copy(original).multiply(curl);
    });
  });
}

function normalizeModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = 7.4 / (Math.max(size.x, size.y, size.z) || 1);
  const handBackPivot = new THREE.Vector3(
    center.x,
    box.min.y + size.y * HAND_BACK_PIVOT_LOCAL_Y,
    center.z,
  );

  model.scale.setScalar(scale);
  model.rotation.set(0.2, -0.42, 2.28);
  model.position.set(0, 0, 0);
  model.updateMatrixWorld(true);

  const pivotAfterTransform = handBackPivot.clone().applyMatrix4(model.matrixWorld);
  model.position.sub(pivotAfterTransform);
  model.updateMatrixWorld(true);
}

function applyLineColor(model, skeletonHelper, lineColor) {
  const color = new THREE.Color(lineColor || DEFAULT_LINE_COLOR);

  model.traverse((child) => {
    if (!child.isMesh) return;

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.filter(Boolean).forEach((material) => {
      if (child.userData.regionColored) {
        if (material.color) material.color.set(0xffffff);
        material.vertexColors = true;
        material.needsUpdate = true;
        return;
      }

      if (material.color) material.color.copy(color);
      if ('emissive' in material) material.emissive.set(0x000000);
      if ('emissiveIntensity' in material) material.emissiveIntensity = 0;
      material.needsUpdate = true;
    });
  });

  if (skeletonHelper?.material?.color) {
    skeletonHelper.material.color.copy(color);
  }
}

function createFlatModelMaterial(sourceMaterial, hasVertexColors, isSkinnedMesh) {
  const color = sourceMaterial?.color?.isColor
    ? sourceMaterial.color.clone()
    : new THREE.Color(DEFAULT_LINE_COLOR);
  const material = new THREE.MeshBasicMaterial({
    color,
    map: sourceMaterial?.map || null,
    alphaMap: sourceMaterial?.alphaMap || null,
    transparent: Boolean(sourceMaterial?.transparent),
    opacity: Number.isFinite(sourceMaterial?.opacity) ? sourceMaterial.opacity : 1,
    side: THREE.DoubleSide,
    vertexColors: hasVertexColors,
  });

  material.depthTest = sourceMaterial?.depthTest ?? true;
  material.depthWrite = sourceMaterial?.depthWrite ?? true;
  material.skinning = Boolean(isSkinnedMesh || sourceMaterial?.skinning);
  material.morphTargets = Boolean(sourceMaterial?.morphTargets);
  material.morphNormals = Boolean(sourceMaterial?.morphNormals);
  material.toneMapped = false;
  return material;
}

function applyModelLook(model, lineColor) {
  model.traverse((child) => {
    if (!child.isMesh) return;

    child.frustumCulled = false;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const hasVertexColors = Boolean(child.geometry?.attributes?.color);
    const flatMaterials = materials.map((material) => (
      createFlatModelMaterial(material, hasVertexColors, child.isSkinnedMesh)
    ));
    child.material = Array.isArray(child.material) ? flatMaterials : flatMaterials[0];
  });

  applyLineColor(model, null, lineColor);
}

function findRegionColorMesh(model, regionData) {
  const requiredVertexCount = (regionData.lineCount || 0) * (regionData.verticesPerLine || 0);
  let fallbackMesh = null;

  model.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position) return;

    const vertexCount = child.geometry.attributes.position.count;
    if (!fallbackMesh || vertexCount > fallbackMesh.geometry.attributes.position.count) {
      fallbackMesh = child;
    }

    if (requiredVertexCount > 0 && vertexCount >= requiredVertexCount) {
      fallbackMesh = child;
    }
  });

  return fallbackMesh;
}

function ensureVertexColorAttribute(geometry, baseColor = 0x0b5f6a) {
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color(baseColor);

  for (let index = 0; index < position.count; index += 1) {
    const offset = index * 3;
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry.attributes.color;
}

function shouldColorRegionLine(lineIndex, regionData, options) {
  if (!options?.distributionParts) {
    return true;
  }

  const part = regionData.lineDistributionParts?.[lineIndex] || null;
  return options.distributionParts.includes(part);
}

function getLineCenterXZ(position, lineIndex, verticesPerLine) {
  const firstVertex = lineIndex * verticesPerLine;
  const maxVertex = position.count - 1;
  let x = 0;
  let z = 0;
  let count = 0;

  for (let i = 0; i < verticesPerLine; i += 1) {
    const vertexIndex = firstVertex + i;
    if (vertexIndex > maxVertex) {
      continue;
    }

    x += position.getX(vertexIndex);
    z += position.getZ(vertexIndex);
    count += 1;
  }

  if (!count) {
    return null;
  }

  return { x: x / count, z: z / count };
}

function projectXZ(point, rect) {
  return {
    u: point.x * rect.axisU[0] + point.z * rect.axisU[1],
    v: point.x * rect.axisV[0] + point.z * rect.axisV[1],
  };
}

function new147PalmStartIndex(dataLength) {
  if (dataLength >= NEW147_FINGER_VALUE_COUNT + NEW147_IGNORED_FINGER_BASE_COUNT + NEW147_PALM_VALUE_COUNT) {
    return NEW147_FINGER_VALUE_COUNT + NEW147_IGNORED_FINGER_BASE_COUNT;
  }

  return NEW147_FINGER_VALUE_COUNT;
}

function new147FingerValueIndex(regionKey, point, layout) {
  const fingerIndex = NEW147_FINGER_KEYS.indexOf(regionKey);
  const rect = layout?.fingerRectangles?.[regionKey]?.tip;

  if (fingerIndex < 0 || !rect?.axisU || !rect?.axisV) {
    return null;
  }

  const projected = projectXZ(point, rect);
  const uNorm = normalizeRange(projected.u, rect.uBounds);
  const vNorm = normalizeRange(projected.v, rect.vBounds);
  const row = clampIndex(Math.floor((1 - uNorm) * NEW147_FINGER_ROW_COUNT), NEW147_FINGER_ROW_COUNT);
  const col = clampIndex(Math.floor(vNorm * NEW147_FINGER_COL_COUNT), NEW147_FINGER_COL_COUNT);

  return row * (NEW147_FINGER_KEYS.length * NEW147_FINGER_COL_COUNT) + fingerIndex * NEW147_FINGER_COL_COUNT + col;
}

function getPalmBounds(layout) {
  const corners = layout?.palmSquareXZ;
  if (!Array.isArray(corners) || corners.length < 4) {
    return null;
  }

  const xs = corners.map((corner) => corner[0]);
  const zs = corners.map((corner) => corner[1]);
  return {
    x: [Math.min(...xs), Math.max(...xs)],
    z: [Math.min(...zs), Math.max(...zs)],
  };
}

function new147PalmValueIndex(point, layout) {
  const bounds = getPalmBounds(layout);
  if (!bounds) {
    return null;
  }

  const xNorm = normalizeRange(point.x, bounds.x);
  const zNorm = normalizeRange(point.z, bounds.z);
  const row = clampIndex(Math.floor((1 - zNorm) * NEW147_PALM_ROW_COUNTS.length), NEW147_PALM_ROW_COUNTS.length);
  const rowColCount = NEW147_PALM_ROW_COUNTS[row];
  const col = clampIndex(Math.floor(xNorm * rowColCount), rowColCount);
  const rowOffset = NEW147_PALM_ROW_COUNTS.slice(0, row).reduce((sum, count) => sum + count, 0);

  return { palmOffset: rowOffset + col };
}

function buildNew147PressureMapping(region, lineIndex, regionData, position, verticesPerLine) {
  const part = regionData.lineDistributionParts?.[lineIndex] || null;
  const point = getLineCenterXZ(position, lineIndex, verticesPerLine);

  if (!point) {
    return null;
  }

  if (part === 'tip') {
    const valueIndex = new147FingerValueIndex(region.key, point, regionData.distributionLayout);
    return valueIndex == null ? null : { lineIndex, valueIndex };
  }

  if (part === 'palm_square') {
    const mapping = new147PalmValueIndex(point, regionData.distributionLayout);
    return mapping == null ? null : { lineIndex, palmOffset: mapping.palmOffset };
  }

  return null;
}

function applyRegionColors(model, regionData, options = {}) {
  const handMesh = findRegionColorMesh(model, regionData);
  const verticesPerLine = regionData.verticesPerLine || 8;
  const regions = Array.isArray(regionData.regions) ? regionData.regions : [];
  const pressureMappings = [];
  let coloredLineCount = 0;

  if (!handMesh?.geometry?.attributes?.position) {
    return { colored: false, lineCount: 0 };
  }

  handMesh.userData.regionColored = true;
  const geometry = handMesh.geometry;
  const attribute = ensureVertexColorAttribute(geometry);
  const maxVertex = geometry.attributes.position.count - 1;

  regions.forEach((region) => {
    if (!region?.editable || !(region.key in REGION_COLORS) || !Array.isArray(region.lineIndices)) {
      return;
    }

    const color = new THREE.Color(REGION_COLORS[region.key]);
    region.lineIndices.forEach((lineIndex) => {
      if (!shouldColorRegionLine(lineIndex, regionData, options)) {
        return;
      }

      const firstVertex = lineIndex * verticesPerLine;
      let coloredLine = false;

      for (let i = 0; i < verticesPerLine; i += 1) {
        const vertexIndex = firstVertex + i;
        if (vertexIndex <= maxVertex) {
          attribute.setXYZ(vertexIndex, color.r, color.g, color.b);
          coloredLine = true;
        }
      }

      if (coloredLine) {
        coloredLineCount += 1;
        if (options.pressureMapping === 'new147TipPalm') {
          const pressureMapping = buildNew147PressureMapping(
            region,
            lineIndex,
            regionData,
            geometry.attributes.position,
            verticesPerLine,
          );
          if (pressureMapping) {
            pressureMappings.push(pressureMapping);
          }
        }
      }
    });
  });

  attribute.needsUpdate = true;

  const materials = Array.isArray(handMesh.material) ? handMesh.material : [handMesh.material];
  materials.filter(Boolean).forEach((material) => {
    if (material.color) material.color.set(0xffffff);
    material.vertexColors = true;
    material.needsUpdate = true;
  });

  return {
    colored: coloredLineCount > 0,
    lineCount: coloredLineCount,
    pressureRuntime: pressureMappings.length
      ? { attribute, mappings: pressureMappings, verticesPerLine }
      : null,
  };
}

function updateNew147PressureColors(runtime, mappedPressureData) {
  if (!runtime || !Array.isArray(mappedPressureData)) {
    return false;
  }

  const palmStartIndex = new147PalmStartIndex(mappedPressureData.length);
  const maxVertex = runtime.attribute.count - 1;
  let updated = false;

  runtime.mappings.forEach((mapping) => {
    const valueIndex = mapping.palmOffset == null ? mapping.valueIndex : palmStartIndex + mapping.palmOffset;
    if (!Number.isInteger(valueIndex) || valueIndex < 0 || valueIndex >= mappedPressureData.length) {
      return;
    }

    const firstVertex = mapping.lineIndex * runtime.verticesPerLine;
    for (let i = 0; i < runtime.verticesPerLine; i += 1) {
      const vertexIndex = firstVertex + i;
      if (vertexIndex <= maxVertex) {
        setPressureColor(runtime.attribute, vertexIndex, mappedPressureData[valueIndex]);
        updated = true;
      }
    }
  });

  if (updated) {
    runtime.attribute.needsUpdate = true;
  }

  return updated;
}

function resolveRegionData(regionDataSource) {
  if (regionDataSource && typeof regionDataSource === 'object') {
    return Promise.resolve(regionDataSource);
  }

  const regionDataUrl = regionDataSource || REGION_DATA_URL;
  return fetch(regionDataUrl).then((response) => {
    if (!response.ok) {
      throw new Error(`Region data request failed: ${response.status}`);
    }
    return response.json();
  });
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.filter(Boolean).forEach((material) => material.dispose());
  });
}

function writeSimulatedFrame(time, frame) {
  frame.quaternion.setFromEuler(
    frame.euler.set(
      Math.sin(time * 0.9) * 0.2,
      Math.sin(time * 0.55) * 0.34,
      Math.sin(time * 0.7) * 0.18,
      'XYZ',
    ),
  );

  rawRotateFromThreeQuaternion(frame.quaternion, frame.rotate);
  for (let index = 0; index < FINGER_NAMES.length; index += 1) {
    const wave = 0.5 + Math.sin(time * 1.2 + index * 0.78) * 0.5;
    frame.rawFingerPoints[index] = Math.round(18 + wave * 245);
  }

  return frame;
}

function formatQuaternion(quaternion) {
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w]
    .map((value) => value.toFixed(2))
    .join(' / ');
}

export default function GloveMotionPage({
  onNavigate,
  pageKey = 'gloveMotion',
  eyebrow = 'Glove Motion',
  title = 'Quaternion + Finger Bend',
  regionDataSource = REGION_DATA_URL,
  regionColorOptions,
  regionLabel = DEFAULT_REGION_LABEL,
  modelUrl = MODEL_URL,
  modelLabel = MODEL_URL,
  modelScaleX = 1,
  initialHandSide = 'right',
  handViews = null,
  enableWujiBridgeByDefault = false,
  wujiBridgeUrl = WUJI_BRIDGE_URL,
}) {
  const storedSettings = useMemo(() => readStoredGloveMotionSettings(), []);
  const pageRef = useRef(null);
  const mountRef = useRef(null);
  const motionGroupRef = useRef(null);
  const handRigsRef = useRef([]);
  const modelRef = useRef(null);
  const bonesRef = useRef(new Map());
  const originalQuaternionsRef = useRef(new Map());
  const quaternionStateRef = useRef({ base: null, baseInv: null });
  const displayedQuaternionRef = useRef(null);
  const bendRef = useRef([...EMPTY_BEND]);
  const latestRawFingerPointsRef = useRef([0, 0, 0, 0, 0]);
  const calibrationRef = useRef({
    left: readStoredCalibration('left'),
    right: readStoredCalibration('right'),
  });
  const snapshotRef = useRef(null);
  const framesRef = useRef({ left: null, right: null, manualFrame: null });
  const useLiveRef = useRef(true);
  const bendGainRef = useRef(1);
  const lineColorRef = useRef(DEFAULT_LINE_COLOR);
  const activeHandSideRef = useRef('right');
  const skeletonHelperRef = useRef(null);
  const pressureRuntimeRef = useRef(null);
  const modelTransformsRef = useRef(storedSettings.modelTransforms);
  const responsiveTransformRef = useRef({ x: 0, y: 0, z: 0, scale: 1 });
  const mirrorScaleXRef = useRef(storedSettings.mirrorScaleX ? -1 : 1);
  const wujiSocketRef = useRef(null);
  const wujiEnabledRef = useRef(enableWujiBridgeByDefault);
  const wujiReconnectTimerRef = useRef(0);
  const wujiCloseTimerRef = useRef(0);
  const lastWujiSendAtRef = useRef(0);
  const wujiWeightsRef = useRef({ ...DEFAULT_WUJI_WEIGHTS });
  const dataSource = useWebSocketPressureSource();
  const [useLiveData, setUseLiveData] = useState(storedSettings.useLiveData);
  const [bendGain, setBendGain] = useState(storedSettings.bendGain);
  const [lineColor, setLineColor] = useState(storedSettings.lineColor);
  const [showSkeleton, setShowSkeleton] = useState(storedSettings.showSkeleton);
  const [mirrorScaleX, setMirrorScaleX] = useState(storedSettings.mirrorScaleX);
  const [sceneBackgroundColor, setSceneBackgroundColor] = useState(storedSettings.sceneBackgroundColor);
  const [isSceneFullscreen, setIsSceneFullscreen] = useState(false);
  const [wujiBridgeEnabled, setWujiBridgeEnabled] = useState(enableWujiBridgeByDefault);
  const [wujiBridgeStatus, setWujiBridgeStatus] = useState({
    connected: false,
    frames: 0,
    ack: '',
    error: '',
  });
  const [wujiWeights, setWujiWeights] = useState(() => ({ ...storedSettings.wujiWeights }));
  const [modelTransforms, setModelTransforms] = useState(() => ({ ...storedSettings.modelTransforms }));
  const [loadState, setLoadState] = useState('Loading');
  const [calibrationVersion, setCalibrationVersion] = useState(0);
  const [poseReadout, setPoseReadout] = useState({
    source: 'SIM',
    quaternion: '0.00 / 0.00 / 0.00 / 1.00',
    bends: [...EMPTY_BEND],
    rawFingerPoints: [0, 0, 0, 0, 0],
    frameAge: 'none',
  });

  const handViewConfigs = useMemo(() => {
    const views = Array.isArray(handViews) && handViews.length
      ? handViews
      : [{ key: 'single', side: null, x: 0, modelScaleX }];

    return views.map((view, index) => ({
      key: view.key || view.side || `hand-${index}`,
      side: view.side === 'left' || view.side === 'right' ? view.side : null,
      x: Number(view.x) || 0,
      y: Number(view.y) || 0,
      z: Number(view.z) || 0,
      scale: Number.isFinite(Number(view.scale)) ? Number(view.scale) : 1,
      modelScaleX: Number.isFinite(Number(view.modelScaleX)) ? Number(view.modelScaleX) : 1,
      phase: Number(view.phase) || index * 0.58,
    }));
  }, [handViews, modelScaleX]);

  const activeTransformKey = useMemo(() => {
    const activeSideView = handViewConfigs.find((view) => view.side === dataSource.activeHandSide);
    return activeSideView?.key || handViewConfigs[0]?.key || 'single';
  }, [dataSource.activeHandSide, handViewConfigs]);

  const activeModelTransform = modelTransforms[activeTransformKey] || DEFAULT_MODEL_TRANSFORM;
  const activeTransformLabel = handViewConfigs.find((view) => view.key === activeTransformKey)?.side
    || activeTransformKey;

  const activeCalibration = useMemo(
    () => calibrationRef.current[dataSource.activeHandSide] || DEFAULT_CALIBRATION,
    [calibrationVersion, dataSource.activeHandSide],
  );

  useEffect(() => {
    snapshotRef.current = dataSource.snapshot;
  }, [dataSource.snapshot]);

  useEffect(() => {
    framesRef.current = {
      left: dataSource.frames?.left || null,
      right: dataSource.frames?.right || null,
      manualFrame: dataSource.manualFrame || null,
    };
  }, [dataSource.frames, dataSource.manualFrame]);

  useEffect(() => {
    activeHandSideRef.current = dataSource.activeHandSide;
  }, [dataSource.activeHandSide]);

  useEffect(() => {
    if (initialHandSide === 'left' || initialHandSide === 'right') {
      dataSource.setActiveHandSide(initialHandSide);
    }
  }, [dataSource.setActiveHandSide, initialHandSide]);

  useEffect(() => {
    useLiveRef.current = useLiveData;
  }, [useLiveData]);

  useEffect(() => {
    bendGainRef.current = bendGain;
  }, [bendGain]);

  useEffect(() => {
    lineColorRef.current = lineColor;
    handRigsRef.current.forEach((rig) => {
      if (rig.model) {
        applyLineColor(rig.model, rig.skeletonHelper, lineColor);
      }
    });
  }, [lineColor]);

  useEffect(() => {
    handRigsRef.current.forEach((rig) => {
      if (rig.skeletonHelper) {
        rig.skeletonHelper.visible = showSkeleton;
      }
    });
  }, [showSkeleton]);

  useEffect(() => {
    mirrorScaleXRef.current = mirrorScaleX ? -1 : 1;
    applyCurrentModelTransform();
  }, [mirrorScaleX]);

  const applyModelTransformToRig = (rig) => {
    if (!rig?.group) {
      return;
    }

    const transforms = modelTransformsRef.current || {};
    const transform = transforms[rig.transformKey] || DEFAULT_MODEL_TRANSFORM;
    const rigScale = Number.isFinite(Number(rig.scale)) ? Number(rig.scale) : 1;
    const rigScaleX = Number.isFinite(Number(rig.modelScaleX)) ? Number(rig.modelScaleX) : 1;
    const resolvedScale = rigScale * (Number(transform.scale) || 1);
    const mirrorScaleXValue = mirrorScaleXRef.current;

    rig.group.position.set(
      (Number(rig.x) || 0) + (Number(transform.x) || 0),
      (Number(rig.y) || 0) + (Number(transform.y) || 0),
      (Number(rig.z) || 0) + (Number(transform.z) || 0),
    );
    rig.group.scale.set(
      rigScaleX * resolvedScale * mirrorScaleXValue,
      resolvedScale,
      resolvedScale,
    );
    updateManualQuaternion(transform, rig.manualQuaternion);
  };

  const applyCurrentModelTransform = () => {
    const motionGroup = motionGroupRef.current;
    if (!motionGroup) {
      return;
    }

    const base = responsiveTransformRef.current;
    motionGroup.position.set(base.x, base.y, base.z);
    motionGroup.scale.setScalar(base.scale);
    handRigsRef.current.forEach(applyModelTransformToRig);
  };

  const updateModelTransform = (key, value) => {
    setModelTransforms((current) => ({
      ...current,
      [activeTransformKey]: {
        ...(current[activeTransformKey] || DEFAULT_MODEL_TRANSFORM),
        [key]: Number(value),
      },
    }));
  };

  const resetModelTransform = () => {
    setModelTransforms((current) => ({
      ...current,
      [activeTransformKey]: { ...DEFAULT_MODEL_TRANSFORM },
    }));
  };

  const enterSceneFullscreen = () => {
    setIsSceneFullscreen(true);
    const element = pageRef.current;
    if (element?.requestFullscreen) {
      element.requestFullscreen().catch(() => {});
    }
  };

  const exitSceneFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => setIsSceneFullscreen(false));
      return;
    }

    setIsSceneFullscreen(false);
  };

  const updateWujiWeight = (key, value) => {
    setWujiWeights((current) => ({
      ...current,
      [key]: Number(value),
    }));
  };

  const resetWujiWeights = () => {
    setWujiWeights({ ...DEFAULT_WUJI_WEIGHTS });
  };

  const sendWujiZeroFrames = () => {
    const socket = wujiSocketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    for (let index = 0; index < WUJI_ZERO_FRAME_COUNT; index += 1) {
      socket.send(wujiSnapshotPayload(WUJI_ZERO_TARGET, wujiWeightsRef.current));
    }
  };

  const closeWujiBridge = ({ sendZero = true } = {}) => {
    window.clearTimeout(wujiReconnectTimerRef.current);
    window.clearTimeout(wujiCloseTimerRef.current);
    wujiReconnectTimerRef.current = 0;
    wujiCloseTimerRef.current = 0;

    const socket = wujiSocketRef.current;
    if (!socket) {
      setWujiBridgeStatus((current) => ({ ...current, connected: false }));
      return;
    }

    if (sendZero && socket.readyState === WebSocket.OPEN) {
      sendWujiZeroFrames();
      wujiCloseTimerRef.current = window.setTimeout(() => {
        if (wujiSocketRef.current === socket) {
          socket.close();
        }
      }, 180);
      return;
    }

    socket.close();
  };

  const connectWujiBridge = () => {
    if (typeof WebSocket === 'undefined') {
      setWujiBridgeStatus((current) => ({
        ...current,
        connected: false,
        error: 'WebSocket unavailable',
      }));
      return;
    }

    const currentSocket = wujiSocketRef.current;
    if (currentSocket && currentSocket.readyState <= WebSocket.OPEN) {
      return;
    }

    window.clearTimeout(wujiReconnectTimerRef.current);
    const socket = new WebSocket(wujiBridgeUrl);
    wujiSocketRef.current = socket;
    setWujiBridgeStatus((current) => ({ ...current, error: '', ack: 'connecting' }));

    socket.addEventListener('open', () => {
      if (wujiSocketRef.current !== socket) return;
      setWujiBridgeStatus((current) => ({
        ...current,
        connected: true,
        error: '',
        ack: 'connected',
      }));
    });

    socket.addEventListener('message', (event) => {
      if (wujiSocketRef.current !== socket) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'error') {
          setWujiBridgeStatus((current) => ({
            ...current,
            ack: '',
            error: message.message || 'bridge error',
          }));
          return;
        }

        if (message.type === 'ack') {
          setWujiBridgeStatus((current) => ({
            ...current,
            connected: true,
            error: message.hardware_error || '',
            ack: `ack ${message.frames ?? current.frames}`,
          }));
          return;
        }

        if (message.type === 'status') {
          setWujiBridgeStatus((current) => ({
            ...current,
            connected: true,
            error: message.hardware_error || '',
            ack: message.live ? 'live' : 'status',
          }));
        }
      } catch {
        setWujiBridgeStatus((current) => ({ ...current, ack: 'message' }));
      }
    });

    socket.addEventListener('error', () => {
      if (wujiSocketRef.current !== socket) return;
      setWujiBridgeStatus((current) => ({
        ...current,
        connected: false,
        error: 'bridge unavailable',
      }));
    });

    socket.addEventListener('close', () => {
      if (wujiSocketRef.current === socket) {
        wujiSocketRef.current = null;
      }
      setWujiBridgeStatus((current) => ({
        ...current,
        connected: false,
        ack: wujiEnabledRef.current ? 'reconnecting' : 'closed',
      }));

      if (wujiEnabledRef.current) {
        wujiReconnectTimerRef.current = window.setTimeout(connectWujiBridge, 1200);
      }
    });
  };

  const sendWujiBends = (bends) => {
    if (!wujiEnabledRef.current || !Array.isArray(bends)) {
      return;
    }

    const now = performance.now();
    if (now - lastWujiSendAtRef.current < WUJI_SEND_INTERVAL_MS) {
      return;
    }

    const socket = wujiSocketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) {
      connectWujiBridge();
      return;
    }

    lastWujiSendAtRef.current = now;
    const target = bendValuesToWujiTarget(
      bends.map((bend) => clamp01((Number(bend) || 0) * bendGainRef.current)),
      wujiWeightsRef.current,
    );
    socket.send(wujiSnapshotPayload(target, wujiWeightsRef.current));
    setWujiBridgeStatus((current) => ({
      ...current,
      connected: true,
      frames: current.frames + 1,
      ack: `sent ${current.frames + 1}`,
      error: '',
    }));
  };

  useEffect(() => {
    modelTransformsRef.current = modelTransforms;
    applyCurrentModelTransform();
  }, [modelTransforms]);

  useEffect(() => {
    writeStoredGloveMotionSettings({
      useLiveData,
      bendGain,
      lineColor,
      showSkeleton,
      mirrorScaleX,
      sceneBackgroundColor,
      wujiWeights,
      modelTransforms,
    });
  }, [
    useLiveData,
    bendGain,
    lineColor,
    showSkeleton,
    mirrorScaleX,
    sceneBackgroundColor,
    wujiWeights,
    modelTransforms,
  ]);

  useEffect(() => {
    setModelTransforms((current) => {
      let changed = false;
      const next = { ...current };
      handViewConfigs.forEach((view) => {
        if (!next[view.key]) {
          next[view.key] = { ...DEFAULT_MODEL_TRANSFORM };
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [handViewConfigs]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsSceneFullscreen(document.fullscreenElement === pageRef.current);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    wujiWeightsRef.current = wujiWeights;
  }, [wujiWeights]);

  useEffect(() => {
    wujiEnabledRef.current = wujiBridgeEnabled;

    if (wujiBridgeEnabled) {
      connectWujiBridge();
    } else {
      closeWujiBridge({ sendZero: true });
    }

    return () => {
      wujiEnabledRef.current = false;
      closeWujiBridge({ sendZero: true });
    };
  }, [wujiBridgeEnabled, wujiBridgeUrl]);

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
    camera.position.set(0, 0.35, 14.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 7;
    controls.maxDistance = 19;
    controls.target.set(0, -0.12, 0);

    const motionGroup = new THREE.Group();
    scene.add(motionGroup);
    motionGroupRef.current = motionGroup;

    const grid = new THREE.GridHelper(10, 26, 0x1edee6, 0x123b4b);
    grid.position.y = -3.9;
    grid.material.transparent = true;
    grid.material.opacity = 0.22;
    scene.add(grid);

    let frameId = 0;
    let disposed = false;
    let lastReadoutAt = 0;
    let elapsed = 0;
    const clock = new THREE.Clock();
    const curlQuaternion = new THREE.Quaternion();
    const loader = new GLTFLoader();
    const handRigs = handViewConfigs.map((view) => {
      const group = new THREE.Group();
      motionGroup.add(group);

      return {
        ...view,
        transformKey: view.key,
        group,
        model: null,
        skeletonHelper: null,
        bones: new Map(),
        originalQuaternions: new Map(),
        pressureRuntime: null,
        lastPressureFrameAt: -1,
        liveFingerPoints: [0, 0, 0, 0, 0],
        quaternionState: { base: null, baseInv: null },
        targetQuaternion: new THREE.Quaternion(),
        displayedQuaternion: new THREE.Quaternion(),
        manualQuaternion: new THREE.Quaternion(),
        bend: [...EMPTY_BEND],
        latestRawFingerPoints: [0, 0, 0, 0, 0],
        simulatedFrame: {
          euler: new THREE.Euler(0, 0, 0, 'XYZ'),
          quaternion: new THREE.Quaternion(),
          rotate: [0, 0, 0, 1],
          rawFingerPoints: [0, 0, 0, 0, 0],
        },
        zeroFrame: {
          rotate: [0, 0, 0, 1],
          rawFingerPoints: [0, 0, 0, 0, 0],
        },
        bonesText: '',
        regionText: '',
      };
    });
    handRigsRef.current = handRigs;
    applyCurrentModelTransform();
    displayedQuaternionRef.current = handRigs[0]?.displayedQuaternion || null;

    const summarizeLoadState = () => {
      if (!handRigs.length) {
        setLoadState('No hands');
        return;
      }

      const loadedCount = handRigs.filter((rig) => rig.model).length;
      const regionCount = handRigs.filter((rig) => rig.regionText).length;
      const firstLoaded = handRigs.find((rig) => rig.bonesText);
      if (handRigs.length === 1) {
        setLoadState([firstLoaded?.bonesText, firstLoaded?.regionText].filter(Boolean).join(' / ') || 'Loading');
        return;
      }

      const regionText = regionCount === handRigs.length
        ? handRigs.map((rig) => `${rig.side || rig.key}: ${rig.regionText}`).join(' / ')
        : `${loadedCount}/${handRigs.length} hands`;
      setLoadState(`${regionText}${firstLoaded?.bonesText ? ` / ${firstLoaded.bonesText}` : ''}`);
    };

    const getRigSnapshot = (rig) => {
      if (!rig.side) {
        return snapshotRef.current;
      }

      const frames = framesRef.current;
      if (frames.manualFrame?.handSide === rig.side) {
        return frames.manualFrame;
      }

      return frames[rig.side] || null;
    };

    handRigs.forEach((rig, rigIndex) => {
      loader.load(
        modelUrl,
        (gltf) => {
          if (disposed) {
            disposeObject(gltf.scene);
            return;
          }

          const model = gltf.scene;
          rig.model = model;
          normalizeModel(model);
          applyModelLook(model, lineColorRef.current);
          rig.group.add(model);

          const bones = [];
          model.traverse((child) => {
            if (child.isBone && !bones.some((bone) => bone.uuid === child.uuid)) {
              bones.push(child);
            }
          });
          rig.bones = new Map(bones.map((bone) => [bone.name, bone]));
          rig.originalQuaternions = new Map(
            bones.map((bone) => [bone.name, bone.quaternion.clone()]),
          );

          const skeletonHelper = new THREE.SkeletonHelper(model);
          skeletonHelper.material.color.set(lineColorRef.current);
          skeletonHelper.material.transparent = true;
          skeletonHelper.material.opacity = 0.72;
          skeletonHelper.material.depthTest = false;
          skeletonHelper.renderOrder = 8;
          skeletonHelper.visible = showSkeleton;
          scene.add(skeletonHelper);
          rig.skeletonHelper = skeletonHelper;
          applyLineColor(model, skeletonHelper, lineColorRef.current);

          const skinnedMeshCount = [];
          model.traverse((child) => {
            if (child.isSkinnedMesh) skinnedMeshCount.push(child);
          });
          rig.bonesText = `${bones.length} bones / ${skinnedMeshCount.length} skin`;

          if (rigIndex === 0) {
            modelRef.current = model;
            bonesRef.current = rig.bones;
            originalQuaternionsRef.current = rig.originalQuaternions;
            skeletonHelperRef.current = skeletonHelper;
          }
          summarizeLoadState();

          resolveRegionData(regionDataSource)
            .then((regionData) => {
              if (disposed || !rig.model) return;

              const result = applyRegionColors(rig.model, regionData, regionColorOptions);
              rig.pressureRuntime = result.pressureRuntime;
              if (rigIndex === 0) {
                pressureRuntimeRef.current = result.pressureRuntime;
              }
              applyLineColor(rig.model, rig.skeletonHelper, lineColorRef.current);
              rig.regionText = result.colored ? `${result.lineCount} ${regionLabel}` : `no ${regionLabel}`;
              summarizeLoadState();
            })
            .catch((error) => {
              console.error('Failed to apply hand region colors:', error);
              if (!disposed) {
                rig.regionText = 'region failed';
                summarizeLoadState();
              }
            });
        },
        undefined,
        (error) => {
          console.error('Failed to load glove motion GLB:', error);
          if (!disposed) {
            rig.bonesText = 'Load failed';
            summarizeLoadState();
          }
        },
      );
    });

    const resize = () => {
      const { clientWidth, clientHeight } = mount;
      const compact = clientWidth < 680;

      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / Math.max(clientHeight, 1);
      camera.position.set(0, compact ? 0.15 : 0.35, compact ? 16.8 : 14.2);
      camera.updateProjectionMatrix();
      responsiveTransformRef.current = {
        x: compact ? -0.2 : 0,
        y: compact ? 0.15 : 0,
        z: 0,
        scale: compact ? 0.74 : 1,
      };
      applyCurrentModelTransform();
    };

    const animate = () => {
      const delta = Math.min(clock.getDelta(), 0.05);
      elapsed += delta;
      let readoutRig = handRigs[0] || null;
      let readoutSnapshot = null;
      let readoutHasLive = false;
      let readoutRawFingerPoints = EMPTY_BEND;

      handRigs.forEach((rig) => {
        const snapshot = getRigSnapshot(rig);
        const pressureFrameAt = snapshot?.timestamp || 0;
        if (pressureFrameAt !== rig.lastPressureFrameAt) {
          rig.lastPressureFrameAt = pressureFrameAt;
          updateNew147PressureColors(rig.pressureRuntime, snapshot?.mappedPressureData);
        }

        const liveRotate = snapshot?.rotate;
        const hasMappedFingerPoints = extractFingerRootPoints(snapshot?.mappedPressureData, rig.liveFingerPoints);
        const hasLivePose = useLiveRef.current && isUsableRotate(liveRotate);
        const hasLiveBend = useLiveRef.current && hasMappedFingerPoints;
        const useZeroFallback = handRigs.length > 1 && rig.side;
        const fallbackFrame = hasLivePose && hasLiveBend
          ? null
          : useZeroFallback
            ? rig.zeroFrame
            : writeSimulatedFrame(elapsed + rig.phase, rig.simulatedFrame);
        const rotate = hasLivePose ? liveRotate : fallbackFrame.rotate;
        const rawFingerPoints = hasLiveBend ? rig.liveFingerPoints : fallbackFrame.rawFingerPoints;
        transformQuaternionForRender(rotate, rig.quaternionState, rig.targetQuaternion);

        const smoothing = 1 - Math.exp(-delta * (hasLivePose ? 18 : 10));
        rig.displayedQuaternion.slerp(rig.targetQuaternion, smoothing);
        rig.group.quaternion.copy(rig.manualQuaternion).multiply(rig.displayedQuaternion);
        rig.latestRawFingerPoints = rawFingerPoints.slice(0, 5);
        rig.bend = updateFingerBend(
          rig.bend,
          rawFingerPoints,
          calibrationRef.current[rig.side || snapshot?.handSide || activeHandSideRef.current] || DEFAULT_CALIBRATION,
        );
        if (hasLiveBend && (!rig.side || rig.side === activeHandSideRef.current)) {
          sendWujiBends(rig.bend);
        }
        applyFingerBend(
          rig.bones,
          rig.originalQuaternions,
          rig.bend,
          bendGainRef.current,
          curlQuaternion,
        );
        rig.model?.updateMatrixWorld(true);

        if (!readoutRig || rig.side === activeHandSideRef.current) {
          readoutRig = rig;
          readoutSnapshot = snapshot;
          readoutHasLive = hasLivePose || hasLiveBend;
          readoutRawFingerPoints = rawFingerPoints;
        }
      });

      if (readoutRig) {
        latestRawFingerPointsRef.current = readoutRig.latestRawFingerPoints.slice(0, 5);
        bendRef.current = readoutRig.bend;
        displayedQuaternionRef.current = readoutRig.displayedQuaternion;
        quaternionStateRef.current = readoutRig.quaternionState;
        bonesRef.current = readoutRig.bones;
        originalQuaternionsRef.current = readoutRig.originalQuaternions;
        pressureRuntimeRef.current = readoutRig.pressureRuntime;
      }

      controls.update();
      renderer.render(scene, camera);

      if (performance.now() - lastReadoutAt > 250) {
        lastReadoutAt = performance.now();
        setPoseReadout({
          source: readoutHasLive ? 'LIVE' : 'SIM',
          quaternion: formatQuaternion(readoutRig?.displayedQuaternion || new THREE.Quaternion()),
          bends: (readoutRig?.bend || EMPTY_BEND).map((value) => Math.round(value * 100)),
          rawFingerPoints: Array.from(readoutRawFingerPoints || EMPTY_BEND).map((value) => Math.round(value)),
          frameAge: readoutSnapshot?.timestamp ? `${Math.max(0, Date.now() - readoutSnapshot.timestamp)} ms` : 'none',
        });
      }

      frameId = requestAnimationFrame(animate);
    };

    resize();
    window.addEventListener('resize', resize);
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resize);
      controls.dispose();
      handRigs.forEach((rig) => {
        rig.skeletonHelper?.geometry?.dispose();
        rig.skeletonHelper?.material?.dispose();
        if (rig.skeletonHelper?.parent) {
          rig.skeletonHelper.parent.remove(rig.skeletonHelper);
        }
        if (rig.model) {
          disposeObject(rig.model);
        }
      });
      skeletonHelperRef.current = null;
      pressureRuntimeRef.current = null;
      modelRef.current = null;
      grid.geometry.dispose();
      grid.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      motionGroupRef.current = null;
      displayedQuaternionRef.current = null;
      handRigsRef.current = [];
      bonesRef.current = new Map();
      originalQuaternionsRef.current = new Map();
    };
  }, [handViewConfigs, modelUrl, regionColorOptions, regionDataSource, regionLabel]);

  const resetQuaternionBase = () => {
    quaternionStateRef.current = { base: null, baseInv: null };
    displayedQuaternionRef.current?.identity();
    handRigsRef.current.forEach((rig) => {
      rig.quaternionState = { base: null, baseInv: null };
      rig.displayedQuaternion.identity();
      rig.group.quaternion.copy(rig.manualQuaternion);
    });
  };

  const captureCalibration = (index) => {
    const handSide = dataSource.activeHandSide;
    const current = calibrationRef.current[handSide] || DEFAULT_CALIBRATION.map((row) => [...row]);
    const next = current.map((row) => [...row]);
    next[index] = latestRawFingerPointsRef.current.slice(0, 5);
    calibrationRef.current = {
      ...calibrationRef.current,
      [handSide]: next,
    };
    writeStoredCalibration(handSide, next);
    setCalibrationVersion((version) => version + 1);
  };

  return (
    <main
      ref={pageRef}
      className={`glove-motion-page${isSceneFullscreen ? ' scene-fullscreen' : ''}`}
      style={{ '--glove-background-color': sceneBackgroundColor }}
    >
      <nav className="app-nav" style={{ '--nav-count': 9 }} aria-label="Page view">
        <button type="button" onClick={() => onNavigate('terrain')}>Pressure</button>
        <button type="button" onClick={() => onNavigate('hand')}>Wireframe</button>
        <button type="button" onClick={() => onNavigate('obj')}>OBJ</button>
        <button type="button" onClick={() => onNavigate('bones')}>Bones</button>
        <button className={pageKey === 'gloveMotion' ? 'active' : ''} type="button" onClick={() => onNavigate('gloveMotion')}>Motion</button>
        <button className={pageKey === 'motiondouble' ? 'active' : ''} type="button" onClick={() => onNavigate('motiondouble')}>MotionDouble</button>
        <button className={pageKey === 'motion2' ? 'active' : ''} type="button" onClick={() => onNavigate('motion2')}>Motion2</button>
        <button className={pageKey === 'motion2double' ? 'active' : ''} type="button" onClick={() => onNavigate('motion2double')}>M2Double</button>
        <button type="button" onClick={() => onNavigate('points')}>Points</button>
      </nav>

      <header className="glove-motion-title">
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{modelLabel} / {loadState}</p>
      </header>

      <section className="glove-motion-panel" aria-label="Glove motion controls">
        <div className="glove-motion-status">
          <strong className={poseReadout.source === 'LIVE' ? 'online' : ''}>{poseReadout.source}</strong>
          <span>{dataSource.status.connected ? 'WS connected' : dataSource.status.connecting ? 'Connecting' : 'Simulation'}</span>
        </div>

        <button className="glove-fullscreen-button" type="button" onClick={enterSceneFullscreen}>
          Fullscreen 3D
        </button>

        <div className="glove-side-toggle" role="group" aria-label="Active hand side">
          {['left', 'right'].map((side) => (
            <button
              key={side}
              className={dataSource.activeHandSide === side ? 'active' : ''}
              type="button"
              onClick={() => {
                dataSource.setActiveHandSide(side);
                resetQuaternionBase();
              }}
            >
              {side}
            </button>
          ))}
        </div>

        <label className="glove-toggle-control">
          <input
            type="checkbox"
            checked={useLiveData}
            onChange={(event) => {
              setUseLiveData(event.target.checked);
              resetQuaternionBase();
            }}
          />
          <span>Live data</span>
        </label>
        <label className="glove-toggle-control">
          <input
            type="checkbox"
            checked={showSkeleton}
            onChange={(event) => setShowSkeleton(event.target.checked)}
          />
          <span>Skeleton</span>
        </label>
        <button
          className={`glove-toggle-button${mirrorScaleX ? ' active' : ''}`}
          type="button"
          aria-pressed={mirrorScaleX}
          onClick={() => setMirrorScaleX((value) => !value)}
        >
          {mirrorScaleX ? 'scale.x = -1' : 'scale.x = 1'}
        </button>
        <label className="glove-toggle-control">
          <input
            type="checkbox"
            checked={wujiBridgeEnabled}
            onChange={(event) => setWujiBridgeEnabled(event.target.checked)}
          />
          <span>Wuji bridge</span>
        </label>
        <div className="glove-bridge-status" title={wujiBridgeUrl}>
          <span>{wujiBridgeUrl}</span>
          <strong className={wujiBridgeEnabled && wujiBridgeStatus.connected && !wujiBridgeStatus.error ? 'online' : ''}>
            {formatWujiStatus(wujiBridgeEnabled, wujiBridgeStatus)}
          </strong>
        </div>
        <div className="glove-wuji-weight-control" aria-label="Wuji bridge bend weights">
          <div className="glove-wuji-weight-heading">
            <span>Wuji weights</span>
            <button type="button" onClick={resetWujiWeights}>Reset</button>
          </div>
          {WUJI_WEIGHT_CONTROLS.map((control) => (
            <label key={control.key}>
              <span>{control.label}</span>
              <input
                type="range"
                min={control.min}
                max={control.max}
                step={control.step}
                value={wujiWeights[control.key]}
                onChange={(event) => updateWujiWeight(control.key, event.target.value)}
                onInput={(event) => updateWujiWeight(control.key, event.target.value)}
              />
              <strong>{wujiWeights[control.key].toFixed(2)}</strong>
            </label>
          ))}
        </div>

        <label className="glove-bend-gain-control">
          <span>Bend gain</span>
          <input
            type="range"
            min="0"
            max="1.35"
            step="0.01"
            value={bendGain}
            onChange={(event) => setBendGain(Number(event.target.value))}
            onInput={(event) => setBendGain(Number(event.target.value))}
          />
          <strong>{bendGain.toFixed(2)}</strong>
        </label>

        <div className="glove-line-color-control" aria-label="Motion line color">
          <label>
            <span>Line color</span>
            <input
              type="color"
              value={lineColor}
              onChange={(event) => setLineColor(event.target.value)}
            />
          </label>
          <div className="glove-color-presets" aria-label="Line color presets">
            {LINE_COLOR_PRESETS.map((preset) => (
              <button
                key={preset}
                className={lineColor.toLowerCase() === preset ? 'active' : ''}
                type="button"
                style={{ '--swatch-color': preset }}
                aria-label={`Set line color ${preset}`}
                onClick={() => setLineColor(preset)}
              />
            ))}
          </div>
        </div>

        <div className="glove-background-color-control" aria-label="3D background color">
          <label>
            <span>Background</span>
            <input
              type="color"
              value={sceneBackgroundColor}
              onChange={(event) => setSceneBackgroundColor(event.target.value)}
            />
          </label>
          <button type="button" onClick={() => setSceneBackgroundColor(DEFAULT_SCENE_BACKGROUND_COLOR)}>
            Reset
          </button>
        </div>

        <div className="glove-transform-control" aria-label="Model transform controls">
          <div className="glove-transform-heading">
            <span>Transform: {activeTransformLabel}</span>
            <button type="button" onClick={resetModelTransform}>Reset</button>
          </div>
          {MODEL_TRANSFORM_CONTROLS.map((control) => (
            <label key={control.key}>
              <span>{control.label}</span>
              <input
                type="range"
                min={control.min}
                max={control.max}
                step={control.step}
                value={activeModelTransform[control.key]}
                onChange={(event) => updateModelTransform(control.key, event.target.value)}
                onInput={(event) => updateModelTransform(control.key, event.target.value)}
              />
              <strong>{formatTransformValue(control.key, activeModelTransform[control.key])}</strong>
            </label>
          ))}
        </div>

        <div className="glove-motion-actions">
          <button type="button" onClick={resetQuaternionBase}>Zero Q</button>
          <button type="button" onClick={() => captureCalibration(0)}>Open Cal {dataSource.activeHandSide}</button>
          <button type="button" onClick={() => captureCalibration(1)}>Bend Cal {dataSource.activeHandSide}</button>
        </div>

        <dl className="glove-motion-readout">
          <div>
            <dt>Frame</dt>
            <dd>{poseReadout.frameAge}</dd>
          </div>
          <div>
            <dt>Quat</dt>
            <dd>{poseReadout.quaternion}</dd>
          </div>
          {FINGER_NAMES.map((name, index) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{poseReadout.bends[index]}% / {poseReadout.rawFingerPoints[index]}</dd>
            </div>
          ))}
        </dl>

        <div className="glove-calibration-strip" aria-label="Calibration values">
          {activeCalibration.map((row, rowIndex) => (
            <span key={rowIndex}>{row.map((value) => Math.round(value)).join(' ')}</span>
          ))}
        </div>
      </section>

      <div className="glove-motion-canvas" ref={mountRef} aria-label="Glove motion hand model" />
      {isSceneFullscreen && (
        <button className="glove-scene-fullscreen-exit" type="button" onClick={exitSceneFullscreen}>
          Exit
        </button>
      )}
    </main>
  );
}
