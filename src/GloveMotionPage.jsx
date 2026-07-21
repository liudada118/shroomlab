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
const GYRO_CALIBRATION_CAPTURE_KEY = 'shroomlab.gloveMotion.gyroCalibrationCaptures.v1';
const MODEL_TRANSFORM_SETTINGS_VERSION = 2;
const GYRO_ADJUSTMENT_SETTINGS_VERSION = 10;
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
const DEFAULT_WUJI_SEND_INTERVAL_MS = 40;
const WUJI_SEND_INTERVAL_MIN_MS = 10;
const WUJI_SEND_INTERVAL_MAX_MS = 200;
const WUJI_SEND_INTERVAL_STEP_MS = 5;
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
  pivotX: 0,
  pivotY: 0,
  pivotZ: 0,
  scale: 1,
});
const MODEL_TRANSFORM_CONTROLS = Object.freeze([
  { key: 'x', label: 'X', min: -10, max: 10, step: 0.05 },
  { key: 'y', label: 'Y', min: -10, max: 10, step: 0.05 },
  { key: 'z', label: 'Z', min: -10, max: 10, step: 0.05 },
  { key: 'rotX', label: 'Pitch', min: -360, max: 360, step: 1 },
  { key: 'rotY', label: 'Yaw', min: -360, max: 360, step: 1 },
  { key: 'rotZ', label: 'Roll', min: -360, max: 360, step: 1 },
  { key: 'pivotX', label: 'Pivot X', min: -3, max: 3, step: 0.01 },
  { key: 'pivotY', label: 'Pivot Y', min: -3, max: 3, step: 0.01 },
  { key: 'pivotZ', label: 'Pivot Z', min: -3, max: 3, step: 0.01 },
  { key: 'scale', label: 'Scale', min: 0.35, max: 2.4, step: 0.01 },
]);
const GYRO_SOURCE_AXES = Object.freeze(['x', 'y', 'z']);
const DEFAULT_GYRO_ADJUSTMENT = Object.freeze({
  x: 1,
  y: 1,
  z: 1,
  sourceX: 'x',
  sourceY: 'y',
  sourceZ: 'z',
  invertRelative: false,
  alignment: Object.freeze([0, 0, 0, 1]),
  neutralRotate: null,
});
const CAPTURED_GYRO_ALIGNMENTS = Object.freeze({
  left: Object.freeze([-0.705462, 0.704345, -0.067434, 0.040903]),
  right: Object.freeze([0.012854, 0.051684, 0.66249, 0.747175]),
});
const CAPTURED_GYRO_NEUTRALS = Object.freeze({
  left: Object.freeze([0.499321736, -0.070393007, -0.056281739, -0.861716307]),
  right: Object.freeze([-0.66272303, 0.033238232, 0.0142513, 0.747990846]),
});
const GYRO_ADJUSTMENT_AXES = Object.freeze([
  { key: 'x', label: 'X', sourceKey: 'sourceX', modelLabel: 'Model X' },
  { key: 'y', label: 'Y', sourceKey: 'sourceY', modelLabel: 'Model Y' },
  { key: 'z', label: 'Z', sourceKey: 'sourceZ', modelLabel: 'Model Z' },
]);
const GYRO_AXIS_PERMUTATIONS = Object.freeze([
  Object.freeze(['x', 'y', 'z']),
  Object.freeze(['x', 'z', 'y']),
  Object.freeze(['y', 'x', 'z']),
  Object.freeze(['y', 'z', 'x']),
  Object.freeze(['z', 'x', 'y']),
  Object.freeze(['z', 'y', 'x']),
]);
const GYRO_CORRECTION_OPTIONS = Object.freeze([
  Object.freeze({ x: 1, y: 1, z: 1 }),
  Object.freeze({ x: -1, y: 1, z: 1 }),
  Object.freeze({ x: 1, y: -1, z: 1 }),
  Object.freeze({ x: 1, y: 1, z: -1 }),
  Object.freeze({ x: -1, y: -1, z: 1 }),
  Object.freeze({ x: -1, y: 1, z: -1 }),
  Object.freeze({ x: 1, y: -1, z: -1 }),
  Object.freeze({ x: -1, y: -1, z: -1 }),
]);
const GYRO_CALIBRATION_POSES = Object.freeze([
  Object.freeze({ key: 'neutral', label: 'Neutral' }),
  Object.freeze({ key: 'pitch_up', label: 'Pitch +' }),
  Object.freeze({ key: 'pitch_down', label: 'Pitch -' }),
  Object.freeze({ key: 'yaw_left', label: 'Yaw L' }),
  Object.freeze({ key: 'yaw_right', label: 'Yaw R' }),
  Object.freeze({ key: 'roll_left', label: 'Roll L' }),
  Object.freeze({ key: 'roll_right', label: 'Roll R' }),
]);
const GYRO_POSE_PLAYBACK_SEQUENCE = Object.freeze([
  'neutral',
  'pitch_up',
  'neutral',
  'pitch_down',
  'neutral',
  'yaw_left',
  'neutral',
  'yaw_right',
  'neutral',
  'roll_left',
  'neutral',
  'roll_right',
]);
const GYRO_POSE_PLAYBACK_SECONDS = 1.8;
const GYRO_CALIBRATION_EXPECTATIONS = Object.freeze([
  Object.freeze({ pose: 'pitch_up', axis: 'x', sign: 1 }),
  Object.freeze({ pose: 'pitch_down', axis: 'x', sign: -1 }),
  Object.freeze({ pose: 'yaw_left', axis: 'y', sign: 1 }),
  Object.freeze({ pose: 'yaw_right', axis: 'y', sign: -1 }),
  Object.freeze({ pose: 'roll_left', axis: 'z', sign: 1 }),
  Object.freeze({ pose: 'roll_right', axis: 'z', sign: -1 }),
]);
const GYRO_CALIBRATION_TARGETS_BY_SIDE = Object.freeze({
  left: Object.freeze([
    Object.freeze({ positivePose: 'pitch_up', negativePose: 'pitch_down', target: Object.freeze([0, -1, 0]) }),
    Object.freeze({ positivePose: 'yaw_left', negativePose: 'yaw_right', target: Object.freeze([-1, 0, 0]) }),
    Object.freeze({ positivePose: 'roll_left', negativePose: 'roll_right', target: Object.freeze([0, 0, -1]) }),
  ]),
  right: Object.freeze([
    Object.freeze({ positivePose: 'pitch_up', negativePose: 'pitch_down', target: Object.freeze([0, -1, 0]) }),
    Object.freeze({ positivePose: 'yaw_left', negativePose: 'yaw_right', target: Object.freeze([1, 0, 0]) }),
    Object.freeze({ positivePose: 'roll_left', negativePose: 'roll_right', target: Object.freeze([0, 0, -1]) }),
  ]),
});
const GYRO_INVERT_RELATIVE_BY_SIDE = Object.freeze({ left: false, right: true });
const HAND_BACK_PIVOT_LOCAL_Y = 0.88;

function defaultModelTransforms() {
  return {
    single: { ...DEFAULT_MODEL_TRANSFORM },
    left: { ...DEFAULT_MODEL_TRANSFORM },
    right: { ...DEFAULT_MODEL_TRANSFORM },
  };
}

function cloneModelTransforms(transforms) {
  return Object.entries(transforms || {}).reduce((next, [key, transform]) => {
    next[key] = { ...DEFAULT_MODEL_TRANSFORM, ...(transform || {}) };
    return next;
  }, {});
}

function modelTransformsFromDefaults(overrides) {
  const next = defaultModelTransforms();
  if (!overrides || typeof overrides !== 'object') {
    return next;
  }

  Object.entries(overrides).forEach(([key, transform]) => {
    if (transform && typeof transform === 'object') {
      next[key] = normalizeModelTransform({ ...DEFAULT_MODEL_TRANSFORM, ...transform });
    }
  });

  return next;
}

function mergeModelTransforms(defaults, stored) {
  const next = cloneModelTransforms(defaults);
  if (!stored || typeof stored !== 'object') {
    return next;
  }

  Object.entries(stored).forEach(([key, transform]) => {
    if (transform && typeof transform === 'object') {
      next[key] = normalizeModelTransform({ ...(next[key] || DEFAULT_MODEL_TRANSFORM), ...transform });
    }
  });

  return next;
}

function defaultGyroAdjustments() {
  return {
    single: {
      ...DEFAULT_GYRO_ADJUSTMENT,
      alignment: [...DEFAULT_GYRO_ADJUSTMENT.alignment],
      neutralRotate: null,
    },
    left: {
      ...DEFAULT_GYRO_ADJUSTMENT,
      alignment: [...CAPTURED_GYRO_ALIGNMENTS.left],
      neutralRotate: [...CAPTURED_GYRO_NEUTRALS.left],
    },
    right: {
      ...DEFAULT_GYRO_ADJUSTMENT,
      invertRelative: true,
      alignment: [...CAPTURED_GYRO_ALIGNMENTS.right],
      neutralRotate: [...CAPTURED_GYRO_NEUTRALS.right],
    },
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

function normalizeGyroAdjustment(value) {
  return GYRO_ADJUSTMENT_AXES.reduce((adjustment, axis) => {
    adjustment[axis.key] = Number(value?.[axis.key]) < 0 ? -1 : 1;
    adjustment[axis.sourceKey] = GYRO_SOURCE_AXES.includes(value?.[axis.sourceKey])
      ? value[axis.sourceKey]
      : axis.key;
    return adjustment;
  }, {
    alignment: normalizeGyroAlignment(value?.alignment),
    neutralRotate: normalizeGyroNeutralRotate(value?.neutralRotate),
    invertRelative: value?.invertRelative === true,
  });
}

function normalizeGyroNeutralRotate(value) {
  if (!Array.isArray(value) || value.length < 4) {
    return null;
  }

  const rotate = value.slice(0, 4).map((item) => Number(item));
  if (rotate.some((item) => !Number.isFinite(item))) {
    return null;
  }

  const length = Math.hypot(rotate[0], rotate[1], rotate[2], rotate[3]);
  if (length < 0.000001) {
    return null;
  }

  return rotate.map((item) => item / length);
}

function normalizeGyroAdjustments(value) {
  const next = defaultGyroAdjustments();
  if (!value || typeof value !== 'object') {
    return next;
  }

  Object.entries(value).forEach(([key, adjustment]) => {
    if (adjustment && typeof adjustment === 'object') {
      next[key] = normalizeGyroAdjustment(adjustment);
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
    wujiSendIntervalMs: DEFAULT_WUJI_SEND_INTERVAL_MS,
    wujiWeights: { ...DEFAULT_WUJI_WEIGHTS },
    modelTransforms: defaultModelTransforms(),
    modelTransformVersion: 0,
    gyroAdjustments: defaultGyroAdjustments(),
    gyroAdjustmentVersion: GYRO_ADJUSTMENT_SETTINGS_VERSION,
  };

  if (typeof localStorage === 'undefined') {
    return defaults;
  }

  try {
    const parsed = JSON.parse(localStorage.getItem(GLOVE_MOTION_SETTINGS_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') {
      return defaults;
    }

    let gyroAdjustments = normalizeGyroAdjustments(parsed.gyroAdjustments);
    if (parsed.gyroAdjustmentVersion !== GYRO_ADJUSTMENT_SETTINGS_VERSION) {
      gyroAdjustments = defaultGyroAdjustments();
    }
    const modelTransformVersion = Number(parsed.modelTransformVersion) || 0;

    return {
      useLiveData: typeof parsed.useLiveData === 'boolean' ? parsed.useLiveData : defaults.useLiveData,
      bendGain: clampNumber(parsed.bendGain, defaults.bendGain, 0, 1.35),
      lineColor: normalizeHexColor(parsed.lineColor, defaults.lineColor),
      showSkeleton: typeof parsed.showSkeleton === 'boolean' ? parsed.showSkeleton : defaults.showSkeleton,
      mirrorScaleX: typeof parsed.mirrorScaleX === 'boolean' ? parsed.mirrorScaleX : defaults.mirrorScaleX,
      sceneBackgroundColor: normalizeHexColor(parsed.sceneBackgroundColor, defaults.sceneBackgroundColor),
      wujiSendIntervalMs: clampNumber(
        parsed.wujiSendIntervalMs,
        defaults.wujiSendIntervalMs,
        WUJI_SEND_INTERVAL_MIN_MS,
        WUJI_SEND_INTERVAL_MAX_MS,
      ),
      wujiWeights: normalizeWujiWeights(parsed.wujiWeights),
      modelTransforms: modelTransformVersion === MODEL_TRANSFORM_SETTINGS_VERSION
        ? normalizeModelTransforms(parsed.modelTransforms)
        : defaultModelTransforms(),
      modelTransformVersion,
      gyroAdjustments,
      gyroAdjustmentVersion: GYRO_ADJUSTMENT_SETTINGS_VERSION,
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

function normalizeGyroCalibrationSample(sample) {
  if (!sample || typeof sample !== 'object' || !Array.isArray(sample.rotate) || sample.rotate.length < 4) {
    return null;
  }

  const rotate = sample.rotate.slice(0, 4).map((value) => Number(value));
  if (rotate.some((value) => !Number.isFinite(value))) {
    return null;
  }

  return {
    handSide: sample.handSide === 'left' ? 'left' : 'right',
    rotate,
    sourceTimestamp: Number(sample.sourceTimestamp) || 0,
    sourceAgeMs: Number.isFinite(Number(sample.sourceAgeMs)) ? Math.max(0, Math.round(Number(sample.sourceAgeMs))) : null,
    source: typeof sample.source === 'string' ? sample.source : 'live',
  };
}

function normalizeGyroCalibrationCapture(capture) {
  if (!capture || typeof capture !== 'object') {
    return null;
  }

  const pose = GYRO_CALIBRATION_POSES.find((item) => item.key === capture.pose);
  if (!pose) {
    return null;
  }

  return {
    id: typeof capture.id === 'string' ? capture.id : `${pose.key}-${Number(capture.capturedAt) || Date.now()}`,
    pose: pose.key,
    label: pose.label,
    handSide: capture.handSide === 'left' || capture.handSide === 'right' ? capture.handSide : null,
    capturedAt: Number(capture.capturedAt) || Date.now(),
    left: normalizeGyroCalibrationSample(capture.left),
    right: normalizeGyroCalibrationSample(capture.right),
  };
}

function readStoredGyroCalibrationCaptures() {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const parsed = JSON.parse(localStorage.getItem(GYRO_CALIBRATION_CAPTURE_KEY) || '[]');
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(normalizeGyroCalibrationCapture)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeStoredGyroCalibrationCaptures(captures) {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(GYRO_CALIBRATION_CAPTURE_KEY, JSON.stringify(captures));
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

function createWujiBridgeStatus() {
  return {
    connected: false,
    frames: 0,
    ack: '',
    error: '',
  };
}

function resolveWujiBridgeUrls(defaultUrl, urlsByHand) {
  const endpoints = {};
  if (urlsByHand && typeof urlsByHand === 'object') {
    ['left', 'right'].forEach((handSide) => {
      if (typeof urlsByHand[handSide] === 'string' && urlsByHand[handSide].trim()) {
        endpoints[handSide] = urlsByHand[handSide].trim();
      }
    });
  }

  if (!Object.keys(endpoints).length && typeof defaultUrl === 'string' && defaultUrl.trim()) {
    endpoints.default = defaultUrl.trim();
  }
  return endpoints;
}

function createWujiBridgeStatusMap(endpoints) {
  return Object.keys(endpoints).reduce((statuses, bridgeKey) => {
    statuses[bridgeKey] = createWujiBridgeStatus();
    return statuses;
  }, {});
}

function wujiBridgeKeyForHand(endpoints, handSide) {
  if (handSide && endpoints[handSide]) {
    return handSide;
  }
  if (endpoints.default) {
    return 'default';
  }
  return null;
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

function mappedQuaternionFromRotate(rotate, adjustment, target) {
  const baseVector = {
    x: Number(rotate[1]) || 0,
    y: -(Number(rotate[0]) || 0),
    z: -(Number(rotate[2]) || 0),
  };
  const sourceX = GYRO_SOURCE_AXES.includes(adjustment.sourceX) ? adjustment.sourceX : 'x';
  const sourceY = GYRO_SOURCE_AXES.includes(adjustment.sourceY) ? adjustment.sourceY : 'y';
  const sourceZ = GYRO_SOURCE_AXES.includes(adjustment.sourceZ) ? adjustment.sourceZ : 'z';
  return target
    .set(
      baseVector[sourceX] * (adjustment.x || 1),
      baseVector[sourceY] * (adjustment.y || 1),
      baseVector[sourceZ] * (adjustment.z || 1),
      Number(rotate[3]) || 0,
    )
    .normalize();
}

function normalizeGyroAlignment(value) {
  const alignment = Array.isArray(value) && value.length >= 4
    ? value.slice(0, 4).map((item, index) => (
      Number.isFinite(Number(item)) ? Number(item) : DEFAULT_GYRO_ADJUSTMENT.alignment[index]
    ))
    : [...DEFAULT_GYRO_ADJUSTMENT.alignment];
  const length = Math.hypot(alignment[0], alignment[1], alignment[2], alignment[3]);
  if (!length) {
    return [...DEFAULT_GYRO_ADJUSTMENT.alignment];
  }

  return alignment.map((item) => item / length);
}

function applyGyroAlignment(quaternion, adjustment, scratch) {
  const alignment = normalizeGyroAlignment(adjustment?.alignment);
  if (
    Math.abs(alignment[0]) < 0.000001 &&
    Math.abs(alignment[1]) < 0.000001 &&
    Math.abs(alignment[2]) < 0.000001 &&
    Math.abs(alignment[3] - 1) < 0.000001
  ) {
    return quaternion;
  }

  const alignmentQuaternion = scratch.alignmentQuaternion || new THREE.Quaternion();
  const alignmentQuaternionInv = scratch.alignmentQuaternionInv || new THREE.Quaternion();
  scratch.alignmentQuaternion = alignmentQuaternion;
  scratch.alignmentQuaternionInv = alignmentQuaternionInv;
  alignmentQuaternion.set(alignment[0], alignment[1], alignment[2], alignment[3]).normalize();
  alignmentQuaternionInv.copy(alignmentQuaternion).invert();
  return quaternion.premultiply(alignmentQuaternion).multiply(alignmentQuaternionInv);
}

function applyGyroRelativeDirection(quaternion, adjustment) {
  quaternion.x = -quaternion.x;
  if (adjustment?.invertRelative) {
    quaternion.invert();
  }
  return quaternion;
}

function applyQuaternionAxisSigns(quaternion, signs) {
  if (!signs) {
    return quaternion;
  }

  quaternion.x *= Number(signs.x) < 0 ? -1 : 1;
  quaternion.y *= Number(signs.y) < 0 ? -1 : 1;
  quaternion.z *= Number(signs.z) < 0 ? -1 : 1;
  return quaternion.normalize();
}

function transformQuaternionForRender(
  rotate,
  state,
  target,
  adjustment = DEFAULT_GYRO_ADJUSTMENT,
  useCalibratedNeutral = true,
) {
  if (!state.input) {
    state.input = new THREE.Quaternion();
  }

  const baseMode = useCalibratedNeutral ? 'calibrated' : 'session';
  if (state.baseMode !== baseMode) {
    state.base = null;
    state.baseInv = null;
    state.baseSource = null;
    state.baseMode = baseMode;
  }

  const q = mappedQuaternionFromRotate(rotate, adjustment, state.input);
  const neutralRotate = useCalibratedNeutral ? adjustment?.neutralRotate : null;
  const hasCalibratedNeutral = isUsableRotate(neutralRotate);

  if (hasCalibratedNeutral && (!state.base || state.baseSource !== neutralRotate)) {
    state.base = mappedQuaternionFromRotate(
      neutralRotate,
      adjustment,
      state.calibratedBase || new THREE.Quaternion(),
    ).clone();
    state.calibratedBase = state.base;
    state.baseInv = state.base.clone().invert();
    state.baseSource = neutralRotate;
  } else if (!state.base) {
    state.base = q.clone();
    state.baseInv = state.base.clone().invert();
    state.baseSource = null;
    return target.identity();
  }

  if (state.base.lengthSq() === 0) {
    return target.identity();
  }

  target.multiplyQuaternions(state.baseInv, q);
  applyGyroRelativeDirection(target, adjustment);
  applyGyroAlignment(target, adjustment, state);
  return target.normalize();
}

function relativeQuaternionForAdjustment(neutralRotate, sampleRotate, adjustment, scratch) {
  const base = mappedQuaternionFromRotate(neutralRotate, adjustment, scratch.base || new THREE.Quaternion()).clone();
  const sample = mappedQuaternionFromRotate(sampleRotate, adjustment, scratch.sample || new THREE.Quaternion()).clone();
  scratch.base = base;
  scratch.sample = sample;
  const baseInv = scratch.baseInv || new THREE.Quaternion();
  scratch.baseInv = baseInv.copy(base).invert();
  const relative = scratch.relative || new THREE.Quaternion();
  scratch.relative = relative.multiplyQuaternions(baseInv, sample);
  applyGyroRelativeDirection(relative, adjustment);
  applyGyroAlignment(relative, adjustment, scratch);
  return relative.normalize();
}

function buildGyroAdjustmentCandidate(axisOrder, correction, invertRelative = false) {
  return {
    x: correction.x,
    y: correction.y,
    z: correction.z,
    sourceX: axisOrder[0],
    sourceY: axisOrder[1],
    sourceZ: axisOrder[2],
    invertRelative,
  };
}

function gyroAdjustmentComplexity(adjustment, handSide) {
  const axisChanges = GYRO_ADJUSTMENT_AXES.reduce((count, axis) => (
    count
      + (adjustment[axis.sourceKey] === axis.key ? 0 : 1)
      + (adjustment[axis.key] < 0 ? 1 : 0)
  ), 0);
  const expectedInvert = GYRO_INVERT_RELATIVE_BY_SIDE[handSide] === true;
  return axisChanges + (adjustment.invertRelative === expectedInvert ? 0 : 4);
}

function collectGyroSamplesByPose(captures, handSide) {
  return captures.reduce((samplesByPose, capture) => {
    const sample = capture?.[handSide];
    if (capture?.pose && sample?.rotate && isUsableRotate(sample.rotate)) {
      if (!samplesByPose[capture.pose]) {
        samplesByPose[capture.pose] = [];
      }
      samplesByPose[capture.pose].push(sample);
    }
    return samplesByPose;
  }, {});
}

function scoreGyroAdjustmentCandidate(samplesByPose, adjustment) {
  const neutralSample = samplesByPose.neutral?.[samplesByPose.neutral.length - 1];
  if (!neutralSample) {
    return null;
  }

  const scratch = {};
  let score = 0;
  let sampleCount = 0;
  const missing = [];

  GYRO_CALIBRATION_EXPECTATIONS.forEach((expectation) => {
    const samples = samplesByPose[expectation.pose] || [];
    if (!samples.length) {
      missing.push(expectation.pose);
      return;
    }

    samples.forEach((sample) => {
      const relative = relativeQuaternionForAdjustment(neutralSample.rotate, sample.rotate, adjustment, scratch);
      const targetValue = relative[expectation.axis] * expectation.sign;
      const offAxisValue = GYRO_SOURCE_AXES
        .filter((axis) => axis !== expectation.axis)
        .reduce((sum, axis) => sum + Math.abs(relative[axis]), 0);
      const signPenalty = targetValue < 0 ? Math.abs(targetValue) * 3 : 0;
      score += targetValue - offAxisValue * 0.65 - signPenalty;
      sampleCount += 1;
    });
  });

  if (missing.length) {
    return { missing, score: -Infinity, sampleCount };
  }

  return { missing, score: sampleCount ? score / sampleCount : -Infinity, sampleCount };
}

function averageGyroPoseVector(samples, neutralRotate, adjustment = DEFAULT_GYRO_ADJUSTMENT) {
  const vector = new THREE.Vector3();
  const scratch = {};
  samples.forEach((sample) => {
    const q = relativeQuaternionForAdjustment(neutralRotate, sample.rotate, adjustment, scratch);
    const sign = q.w < 0 ? -1 : 1;
    vector.x += q.x * sign;
    vector.y += q.y * sign;
    vector.z += q.z * sign;
  });

  return samples.length ? vector.multiplyScalar(1 / samples.length) : vector;
}

function averageGyroNeutralRotate(samples) {
  if (!samples?.length) {
    return null;
  }

  const normalizedSamples = samples
    .map((sample) => normalizeGyroNeutralRotate(sample?.rotate))
    .filter(Boolean);
  if (!normalizedSamples.length) {
    return null;
  }

  const reference = normalizedSamples[0];
  const sum = [0, 0, 0, 0];
  normalizedSamples.forEach((rotate) => {
    const dot = rotate.reduce((value, item, index) => value + item * reference[index], 0);
    const sign = dot < 0 ? -1 : 1;
    rotate.forEach((item, index) => {
      sum[index] += item * sign;
    });
  });

  return normalizeGyroNeutralRotate(sum);
}

function solveGyroAlignmentQuaternion(sourceVectors, targetVectors) {
  const matrix = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  sourceVectors.forEach((source, index) => {
    const target = targetVectors[index];
    matrix[0][0] += target.x * source.x;
    matrix[0][1] += target.x * source.y;
    matrix[0][2] += target.x * source.z;
    matrix[1][0] += target.y * source.x;
    matrix[1][1] += target.y * source.y;
    matrix[1][2] += target.y * source.z;
    matrix[2][0] += target.z * source.x;
    matrix[2][1] += target.z * source.y;
    matrix[2][2] += target.z * source.z;
  });

  const sxx = matrix[0][0];
  const sxy = matrix[0][1];
  const sxz = matrix[0][2];
  const syx = matrix[1][0];
  const syy = matrix[1][1];
  const syz = matrix[1][2];
  const szx = matrix[2][0];
  const szy = matrix[2][1];
  const szz = matrix[2][2];
  const k = [
    [sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ];

  let q = [1, 0, 0, 0];
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const next = [0, 0, 0, 0];
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        next[row] += k[row][column] * q[column];
      }
    }
    const length = Math.hypot(next[0], next[1], next[2], next[3]) || 1;
    q = next.map((value) => value / length);
  }

  return new THREE.Quaternion(q[1], q[2], q[3], q[0]).normalize().invert();
}

function averageGyroAlignmentError(sourceVectors, targetVectors, alignmentQuaternion) {
  if (!sourceVectors.length) {
    return Infinity;
  }

  const total = sourceVectors.reduce((sum, source, index) => {
    const target = targetVectors[index];
    const aligned = source.clone().applyQuaternion(alignmentQuaternion).normalize();
    const dot = clampNumber(aligned.dot(target), 0, -1, 1);
    return sum + THREE.MathUtils.radToDeg(Math.acos(dot));
  }, 0);

  return total / sourceVectors.length;
}

function solveGyroAdjustmentForHand(captures, handSide) {
  const samplesByPose = collectGyroSamplesByPose(captures, handSide);
  const calibrationTargets = GYRO_CALIBRATION_TARGETS_BY_SIDE[handSide]
    || GYRO_CALIBRATION_TARGETS_BY_SIDE.right;
  const missing = [];
  if (!samplesByPose.neutral?.length) {
    missing.push('neutral');
  }
  calibrationTargets.forEach((pair) => {
    if (!samplesByPose[pair.positivePose]?.length) {
      missing.push(pair.positivePose);
    }
    if (!samplesByPose[pair.negativePose]?.length) {
      missing.push(pair.negativePose);
    }
  });
  if (missing.length) {
    return { handSide, missing, adjustment: null, score: -Infinity, sampleCount: 0 };
  }

  const neutralRotate = averageGyroNeutralRotate(samplesByPose.neutral);
  if (!neutralRotate) {
    return { handSide, missing: ['neutral'], adjustment: null, score: -Infinity, sampleCount: 0 };
  }
  const targetVectors = calibrationTargets.map((pair) => (
    new THREE.Vector3(pair.target[0], pair.target[1], pair.target[2]).normalize()
  ));
  const sampleCount = calibrationTargets.reduce((count, pair) => (
    count + samplesByPose[pair.positivePose].length + samplesByPose[pair.negativePose].length
  ), samplesByPose.neutral.length);
  let bestCandidate = null;

  GYRO_AXIS_PERMUTATIONS.forEach((axisOrder) => {
    GYRO_CORRECTION_OPTIONS.forEach((correction) => {
      [false, true].forEach((invertRelative) => {
        const candidate = buildGyroAdjustmentCandidate(axisOrder, correction, invertRelative);
        const sourceVectors = [];
        let valid = true;

        calibrationTargets.forEach((pair) => {
          const positiveVector = averageGyroPoseVector(
            samplesByPose[pair.positivePose],
            neutralRotate,
            candidate,
          );
          const negativeVector = averageGyroPoseVector(
            samplesByPose[pair.negativePose],
            neutralRotate,
            candidate,
          );
          const sourceVector = positiveVector.sub(negativeVector);
          if (sourceVector.lengthSq() < 0.000001) {
            valid = false;
            return;
          }
          sourceVectors.push(sourceVector.normalize());
        });

        if (!valid || sourceVectors.length < 3) {
          return;
        }

        const alignmentQuaternion = solveGyroAlignmentQuaternion(sourceVectors, targetVectors);
        const errorDegrees = averageGyroAlignmentError(sourceVectors, targetVectors, alignmentQuaternion);
        const complexity = gyroAdjustmentComplexity(candidate, handSide);
        const hasLowerError = !bestCandidate || errorDegrees < bestCandidate.errorDegrees - 0.05;
        const isSimplerTie = bestCandidate
          && Math.abs(errorDegrees - bestCandidate.errorDegrees) <= 0.05
          && complexity < bestCandidate.complexity;
        if (hasLowerError || isSimplerTie) {
          bestCandidate = {
            adjustment: candidate,
            alignmentQuaternion,
            errorDegrees,
            complexity,
          };
        }
      });
    });
  });

  if (!bestCandidate) {
    return { handSide, missing: ['samples'], adjustment: null, score: -Infinity, sampleCount };
  }

  const { adjustment, alignmentQuaternion, errorDegrees } = bestCandidate;
  return {
    handSide,
    adjustment: {
      ...adjustment,
      neutralRotate,
      alignment: [
        alignmentQuaternion.x,
        alignmentQuaternion.y,
        alignmentQuaternion.z,
        alignmentQuaternion.w,
      ],
    },
    score: Number.isFinite(errorDegrees) ? -errorDegrees : -Infinity,
    errorDegrees,
    sampleCount,
    missing: [],
  };
}

function averageGyroPoseQuaternion(samples, neutralRotate, adjustment) {
  if (!samples?.length || !neutralRotate) {
    return new THREE.Quaternion();
  }

  const scratch = {};
  const sum = [0, 0, 0, 0];
  let reference = null;

  samples.forEach((sample) => {
    const quaternion = relativeQuaternionForAdjustment(
      neutralRotate,
      sample.rotate,
      adjustment,
      scratch,
    ).clone();
    const sign = reference && reference.dot(quaternion) < 0 ? -1 : 1;
    if (!reference) {
      reference = quaternion.clone();
    }
    sum[0] += quaternion.x * sign;
    sum[1] += quaternion.y * sign;
    sum[2] += quaternion.z * sign;
    sum[3] += quaternion.w * sign;
  });

  const averaged = new THREE.Quaternion(sum[0], sum[1], sum[2], sum[3]);
  return averaged.lengthSq() > 0.000001 ? averaged.normalize() : averaged.identity();
}

function quaternionFromPoseEuler(target) {
  if (!Array.isArray(target?.euler) || target.euler.length < 3) {
    return null;
  }

  const values = target.euler.slice(0, 3).map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  return new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(values[0]),
    THREE.MathUtils.degToRad(values[1]),
    THREE.MathUtils.degToRad(values[2]),
    'XYZ',
  ));
}

function buildGyroPosePlaybackRuntime(calibrationData) {
  if (!calibrationData || typeof calibrationData !== 'object') {
    return null;
  }

  const runtime = {};
  ['left', 'right'].forEach((handSide) => {
    const captures = Array.isArray(calibrationData[handSide]?.captures)
      ? calibrationData[handSide].captures
      : [];
    const samplesByPose = collectGyroSamplesByPose(captures, handSide);
    const calibration = solveGyroAdjustmentForHand(captures, handSide);
    const neutralRotate = calibration.adjustment?.neutralRotate;
    if (!neutralRotate || !calibration.adjustment) {
      return;
    }

    const poseTargets = calibrationData[handSide]?.poseTargets || {};
    const neutralTargetQuaternion = quaternionFromPoseEuler(poseTargets.neutral);
    const neutralTargetInverse = neutralTargetQuaternion?.clone().invert() || null;
    const poses = GYRO_CALIBRATION_POSES.reduce((next, pose) => {
      const targetQuaternion = quaternionFromPoseEuler(poseTargets[pose.key]);
      if (neutralTargetInverse && targetQuaternion) {
        next[pose.key] = neutralTargetInverse.clone().multiply(targetQuaternion).normalize();
      } else {
        next[pose.key] = pose.key === 'neutral'
          ? new THREE.Quaternion()
          : averageGyroPoseQuaternion(
              samplesByPose[pose.key],
              neutralRotate,
              calibration.adjustment,
            );
      }
      return next;
    }, {});
    const capturedSampleCount = Object.values(samplesByPose)
      .reduce((count, samples) => count + samples.length, 0);
    const sampleCount = Math.max(
      capturedSampleCount,
      Number(calibrationData[handSide]?.sampleCount) || 0,
    );

    runtime[handSide] = {
      poses,
      adjustment: calibration.adjustment,
      sampleCount,
      errorDegrees: calibration.errorDegrees,
      targetLabels: Object.entries(poseTargets).reduce((labels, [poseKey, target]) => {
        if (typeof target?.label === 'string') {
          labels[poseKey] = target.label;
        }
        return labels;
      }, {}),
    };
  });

  return runtime.left || runtime.right ? runtime : null;
}

function gyroAdjustmentsFromPoseRuntime(storedAdjustments, poseRuntime) {
  const adjustments = normalizeGyroAdjustments(storedAdjustments);
  ['left', 'right'].forEach((handSide) => {
    if (poseRuntime?.[handSide]?.adjustment) {
      adjustments[handSide] = normalizeGyroAdjustment(poseRuntime[handSide].adjustment);
    }
  });
  return adjustments;
}

function formatGyroAdjustmentSummary(adjustment) {
  if (!adjustment) {
    return 'missing';
  }

  const axisSummary = GYRO_ADJUSTMENT_AXES
    .map((axis) => {
      const source = adjustment[axis.sourceKey] || axis.key;
      const sign = (adjustment[axis.key] || 1) < 0 ? '-' : '+';
      return `${axis.label}=${sign}raw${source.toUpperCase()}`;
    })
    .join(' / ');
  return adjustment.invertRelative ? `${axisSummary} / inverse Q` : axisSummary;
}

function rawRotateFromThreeQuaternion(q, target) {
  target[0] = -q.y;
  target[1] = q.x;
  target[2] = -q.z;
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
  modelTransformDefaults = null,
  resetStoredModelTransforms = false,
  showLiveHandToggle = true,
  poseCalibrationData = null,
  initialPoseInputMode = 'poses',
  liveQuaternionAxisSigns = null,
  lockOrientation = false,
  enableWujiBridgeByDefault = false,
  wujiBridgeUrl = WUJI_BRIDGE_URL,
  wujiBridgeUrls = null,
}) {
  const storedSettings = useMemo(() => readStoredGloveMotionSettings(), []);
  const posePlaybackRuntime = useMemo(
    () => buildGyroPosePlaybackRuntime(poseCalibrationData),
    [poseCalibrationData],
  );
  const hasPosePlayback = Boolean(posePlaybackRuntime);
  const initialGyroAdjustments = useMemo(
    () => gyroAdjustmentsFromPoseRuntime(storedSettings.gyroAdjustments, posePlaybackRuntime),
    [posePlaybackRuntime, storedSettings.gyroAdjustments],
  );
  const resolvedInitialPoseInputMode = initialPoseInputMode === 'live' ? 'live' : 'poses';
  const resolvedWujiBridgeUrls = useMemo(
    () => resolveWujiBridgeUrls(wujiBridgeUrl, wujiBridgeUrls),
    [wujiBridgeUrl, wujiBridgeUrls],
  );
  const hasSideSpecificWujiBridges = Boolean(
    resolvedWujiBridgeUrls.left || resolvedWujiBridgeUrls.right,
  );
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
  const gyroAdjustmentsRef = useRef(initialGyroAdjustments);
  const responsiveTransformRef = useRef({ x: 0, y: 0, z: 0, scale: 1 });
  const mirrorScaleXRef = useRef(storedSettings.mirrorScaleX ? -1 : 1);
  const wujiSocketsRef = useRef({});
  const wujiBridgeUrlsRef = useRef(resolvedWujiBridgeUrls);
  const wujiEnabledRef = useRef(enableWujiBridgeByDefault);
  const wujiReconnectTimersRef = useRef({});
  const wujiCloseTimersRef = useRef({});
  const lastWujiSendAtRef = useRef({});
  const wujiSendIntervalRef = useRef(storedSettings.wujiSendIntervalMs);
  const wujiWeightsRef = useRef({ ...DEFAULT_WUJI_WEIGHTS });
  const posePlaybackRef = useRef({
    inputMode: resolvedInitialPoseInputMode,
    selectedPose: 'neutral',
    autoPlay: false,
    fingerMotion: false,
    fingerCurl: 0.08,
  });
  const activePoseKeyRef = useRef('neutral');
  const dataSource = useWebSocketPressureSource();
  const [useLiveData, setUseLiveData] = useState(
    hasPosePlayback && resolvedInitialPoseInputMode === 'live' ? true : storedSettings.useLiveData,
  );
  const [bendGain, setBendGain] = useState(storedSettings.bendGain);
  const [lineColor, setLineColor] = useState(storedSettings.lineColor);
  const [showSkeleton, setShowSkeleton] = useState(storedSettings.showSkeleton);
  const [mirrorScaleX, setMirrorScaleX] = useState(storedSettings.mirrorScaleX);
  const [sceneBackgroundColor, setSceneBackgroundColor] = useState(storedSettings.sceneBackgroundColor);
  const [isSceneFullscreen, setIsSceneFullscreen] = useState(false);
  const [wujiBridgeEnabled, setWujiBridgeEnabled] = useState(enableWujiBridgeByDefault);
  const [wujiBridgeStatuses, setWujiBridgeStatuses] = useState(
    () => createWujiBridgeStatusMap(resolvedWujiBridgeUrls),
  );
  const [wujiSendIntervalMs, setWujiSendIntervalMs] = useState(storedSettings.wujiSendIntervalMs);
  const resolvedModelTransformDefaults = useMemo(
    () => modelTransformsFromDefaults(modelTransformDefaults),
    [modelTransformDefaults],
  );
  const [wujiWeights, setWujiWeights] = useState(() => ({ ...storedSettings.wujiWeights }));
  const [modelTransforms, setModelTransforms] = useState(() => (
    resetStoredModelTransforms || storedSettings.modelTransformVersion !== MODEL_TRANSFORM_SETTINGS_VERSION
      ? cloneModelTransforms(resolvedModelTransformDefaults)
      : mergeModelTransforms(resolvedModelTransformDefaults, storedSettings.modelTransforms)
  ));
  const [gyroAdjustments, setGyroAdjustments] = useState(() => initialGyroAdjustments);
  const [transformEditSide, setTransformEditSide] = useState(() => (
    initialHandSide === 'right' ? 'right' : 'left'
  ));
  const [gyroEditSide, setGyroEditSide] = useState(() => (
    initialHandSide === 'right' ? 'right' : 'left'
  ));
  const [loadState, setLoadState] = useState('Loading');
  const [calibrationVersion, setCalibrationVersion] = useState(0);
  const [poseReadout, setPoseReadout] = useState({
    source: 'SIM',
    quaternion: '0.00 / 0.00 / 0.00 / 1.00',
    bends: [...EMPTY_BEND],
    rawFingerPoints: [0, 0, 0, 0, 0],
    frameAge: 'none',
  });
  const [gyroCalibrationCaptures, setGyroCalibrationCaptures] = useState(readStoredGyroCalibrationCaptures);
  const [gyroCaptureStatus, setGyroCaptureStatus] = useState('No samples');
  const [poseInputMode, setPoseInputMode] = useState(resolvedInitialPoseInputMode);
  const [selectedPose, setSelectedPose] = useState('neutral');
  const [activePoseKey, setActivePoseKey] = useState('neutral');
  const [autoPosePlayback, setAutoPosePlayback] = useState(false);
  const [fingerMotion, setFingerMotion] = useState(false);
  const [fingerCurl, setFingerCurl] = useState(0.08);

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

  const hasPairedHandTransforms = handViewConfigs.some((view) => view.side === 'left')
    && handViewConfigs.some((view) => view.side === 'right');
  const activeTransformKey = useMemo(() => {
    const activeSideView = handViewConfigs.find((view) => view.side === transformEditSide);
    return activeSideView?.key || handViewConfigs[0]?.key || 'single';
  }, [handViewConfigs, transformEditSide]);

  const activeModelTransform = modelTransforms[activeTransformKey]
    || resolvedModelTransformDefaults[activeTransformKey]
    || DEFAULT_MODEL_TRANSFORM;
  const activeTransformLabel = handViewConfigs.find((view) => view.key === activeTransformKey)?.side
    || activeTransformKey;
  const activeGyroKey = useMemo(() => {
    const activeSideView = handViewConfigs.find((view) => view.side === gyroEditSide);
    return activeSideView?.key || handViewConfigs[0]?.key || 'single';
  }, [gyroEditSide, handViewConfigs]);
  const activeGyroView = handViewConfigs.find((view) => view.key === activeGyroKey);
  const activeGyroLabel = activeGyroView?.side || activeGyroKey;
  const activeGyroCaptureSide = activeGyroView?.side === 'right' ? 'right' : 'left';
  const activeGyroAdjustment = gyroAdjustments[activeGyroKey] || DEFAULT_GYRO_ADJUSTMENT;
  const activeGyroCalibrationCaptures = useMemo(() => (
    gyroCalibrationCaptures.filter((capture) => capture.handSide === activeGyroCaptureSide)
  ), [activeGyroCaptureSide, gyroCalibrationCaptures]);
  const gyroCaptureCounts = useMemo(() => {
    const counts = GYRO_CALIBRATION_POSES.reduce((next, pose) => {
      next[pose.key] = 0;
      return next;
    }, {});

    activeGyroCalibrationCaptures.forEach((capture) => {
      if (!counts[capture.pose]) {
        counts[capture.pose] = 0;
      }
      counts[capture.pose] += 1;
    });

    return counts;
  }, [activeGyroCalibrationCaptures]);
  const gyroCaptureTotal = activeGyroCalibrationCaptures.length;
  const activePose = GYRO_CALIBRATION_POSES.find((pose) => pose.key === activePoseKey)
    || GYRO_CALIBRATION_POSES[0];
  const posePlaybackSampleLabel = posePlaybackRuntime
    ? `L ${posePlaybackRuntime.left?.sampleCount || 0} / R ${posePlaybackRuntime.right?.sampleCount || 0}`
    : '';

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
    posePlaybackRef.current = {
      inputMode: poseInputMode,
      selectedPose,
      autoPlay: autoPosePlayback,
      fingerMotion,
      fingerCurl,
    };
  }, [autoPosePlayback, fingerCurl, fingerMotion, poseInputMode, selectedPose]);

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
    rig.manualGroup?.quaternion.copy(rig.manualQuaternion);
    if (rig.model) {
      rig.model.position.set(
        -(Number(transform.pivotX) || 0),
        -(Number(transform.pivotY) || 0),
        -(Number(transform.pivotZ) || 0),
      );
    }
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
      [activeTransformKey]: {
        ...(resolvedModelTransformDefaults[activeTransformKey] || DEFAULT_MODEL_TRANSFORM),
      },
    }));
  };

  const toggleGyroAdjustmentAxis = (axisKey) => {
    setGyroAdjustments((current) => {
      const currentAdjustment = current[activeGyroKey] || DEFAULT_GYRO_ADJUSTMENT;
      return {
        ...current,
        [activeGyroKey]: {
          ...currentAdjustment,
          [axisKey]: (currentAdjustment[axisKey] || 1) * -1,
        },
      };
    });

    handRigsRef.current.forEach((rig) => {
      if (rig.transformKey === activeGyroKey) {
        rig.quaternionState = { base: null, baseInv: null };
        rig.displayedQuaternion.identity();
        rig.gyroGroup?.quaternion.identity();
      }
    });
  };

  const updateGyroAdjustmentSource = (sourceKey, sourceAxis) => {
    if (!GYRO_SOURCE_AXES.includes(sourceAxis)) {
      return;
    }

    setGyroAdjustments((current) => {
      const currentAdjustment = current[activeGyroKey] || DEFAULT_GYRO_ADJUSTMENT;
      return {
        ...current,
        [activeGyroKey]: {
          ...currentAdjustment,
          [sourceKey]: sourceAxis,
        },
      };
    });

    handRigsRef.current.forEach((rig) => {
      if (rig.transformKey === activeGyroKey) {
        rig.quaternionState = { base: null, baseInv: null };
        rig.displayedQuaternion.identity();
        rig.gyroGroup?.quaternion.identity();
      }
    });
  };

  const readGyroCalibrationSample = (handSide, capturedAt) => {
    const frames = framesRef.current || {};
    const frame = frames.manualFrame?.handSide === handSide ? frames.manualFrame : frames[handSide];
    if (!frame || !isUsableRotate(frame.rotate)) {
      return null;
    }

    const sourceTimestamp = Number(frame.timestamp) || 0;
    const sourceTimestampMs = sourceTimestamp > 0 && sourceTimestamp < 100000000000
      ? sourceTimestamp * 1000
      : sourceTimestamp;

    return {
      handSide,
      rotate: frame.rotate.slice(0, 4).map((value) => Number(value) || 0),
      sourceTimestamp,
      sourceAgeMs: sourceTimestampMs ? Math.max(0, Math.round(capturedAt - sourceTimestampMs)) : null,
      source: frame.source || 'live',
    };
  };

  const captureGyroCalibrationPose = (poseKey) => {
    const pose = GYRO_CALIBRATION_POSES.find((item) => item.key === poseKey);
    if (!pose) {
      return;
    }

    const capturedAt = Date.now();
    const sample = readGyroCalibrationSample(activeGyroCaptureSide, capturedAt);
    if (!sample) {
      setGyroCaptureStatus(`${pose.label}: ${activeGyroCaptureSide} missing`);
      return;
    }

    const capture = {
      id: `${pose.key}-${capturedAt}`,
      pose: pose.key,
      label: pose.label,
      handSide: activeGyroCaptureSide,
      capturedAt,
      left: activeGyroCaptureSide === 'left' ? sample : null,
      right: activeGyroCaptureSide === 'right' ? sample : null,
    };

    setGyroCalibrationCaptures((current) => [...current, capture]);
    setGyroCaptureStatus(`${pose.label}: ${activeGyroCaptureSide} ok`);
  };

  const buildGyroCalibrationExport = () => JSON.stringify({
    version: 1,
    pageKey,
    handSide: activeGyroCaptureSide,
    exportedAt: new Date().toISOString(),
    poses: GYRO_CALIBRATION_POSES.map((pose) => ({ key: pose.key, label: pose.label })),
    captures: activeGyroCalibrationCaptures,
  }, null, 2);

  const copyGyroCalibrationJson = () => {
    const text = buildGyroCalibrationExport();
    if (!navigator.clipboard?.writeText) {
      setGyroCaptureStatus('Clipboard unavailable');
      return;
    }

    navigator.clipboard.writeText(text)
      .then(() => setGyroCaptureStatus(`Copied ${activeGyroCaptureSide} ${activeGyroCalibrationCaptures.length} captures`))
      .catch(() => setGyroCaptureStatus('Copy failed'));
  };

  const exportGyroCalibrationJson = () => {
    if (typeof document === 'undefined') {
      return;
    }

    const blob = new Blob([buildGyroCalibrationExport()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gyro-calibration-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setGyroCaptureStatus(`Exported ${activeGyroCaptureSide} ${activeGyroCalibrationCaptures.length} captures`);
  };

  const clearGyroCalibrationCaptures = () => {
    setGyroCalibrationCaptures((current) => current.filter((capture) => capture.handSide !== activeGyroCaptureSide));
    setGyroCaptureStatus(`Cleared ${activeGyroCaptureSide} samples`);
  };

  const clearGyroCalibrationPose = (poseKey) => {
    const pose = GYRO_CALIBRATION_POSES.find((item) => item.key === poseKey);
    setGyroCalibrationCaptures((current) => current.filter((capture) => (
      capture.handSide !== activeGyroCaptureSide || capture.pose !== poseKey
    )));
    setGyroCaptureStatus(`Cleared ${activeGyroCaptureSide} ${pose?.label || poseKey}`);
  };

  const resetGyroRuntimeState = (keys) => {
    handRigsRef.current.forEach((rig) => {
      if (keys.includes(rig.transformKey)) {
        rig.quaternionState = { base: null, baseInv: null };
        rig.displayedQuaternion.identity();
        rig.gyroGroup?.quaternion.identity();
      }
    });
  };

  const applyGyroCalibrationFromSamples = () => {
    const result = solveGyroAdjustmentForHand(activeGyroCalibrationCaptures, activeGyroCaptureSide);
    if (!result.adjustment) {
      setGyroCaptureStatus(`${activeGyroCaptureSide} missing ${result.missing?.join(',') || 'samples'}`);
      return;
    }

    setGyroAdjustments((current) => ({
      ...current,
      [activeGyroKey]: result.adjustment,
    }));
    resetGyroRuntimeState([activeGyroKey]);
    setGyroCaptureStatus(
      `Auto Cal ${activeGyroCaptureSide}: ${Number(result.errorDegrees).toFixed(1)} deg / ${formatGyroAdjustmentSummary(result.adjustment)}`,
    );
  };

  const mirrorActiveTransformToOtherHand = () => {
    const sourceView = handViewConfigs.find((view) => view.key === activeTransformKey);
    if (!sourceView?.side) {
      return;
    }

    const targetSide = sourceView.side === 'left' ? 'right' : 'left';
    const targetView = handViewConfigs.find((view) => view.side === targetSide);
    if (!targetView) {
      return;
    }

    setModelTransforms((current) => {
      const sourceTransform = current[sourceView.key]
        || resolvedModelTransformDefaults[sourceView.key]
        || DEFAULT_MODEL_TRANSFORM;
      const sourceWorldX = (Number(sourceView.x) || 0) + (Number(sourceTransform.x) || 0);
      const targetBaseX = Number(targetView.x) || 0;

      return {
        ...current,
        [targetView.key]: {
          ...(resolvedModelTransformDefaults[targetView.key] || DEFAULT_MODEL_TRANSFORM),
          ...sourceTransform,
          x: -sourceWorldX - targetBaseX,
          rotY: -(Number(sourceTransform.rotY) || 0),
          rotZ: -(Number(sourceTransform.rotZ) || 0),
        },
      };
    });
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

  const resetWujiOutput = () => {
    setWujiSendIntervalMs(DEFAULT_WUJI_SEND_INTERVAL_MS);
    setWujiWeights({ ...DEFAULT_WUJI_WEIGHTS });
  };

  const updateWujiBridgeStatus = (bridgeKey, update) => {
    setWujiBridgeStatuses((current) => {
      const previous = current[bridgeKey] || createWujiBridgeStatus();
      const changes = typeof update === 'function' ? update(previous) : update;
      return {
        ...current,
        [bridgeKey]: { ...previous, ...changes },
      };
    });
  };

  const sendWujiZeroFrames = (bridgeKey) => {
    const socket = wujiSocketsRef.current[bridgeKey];
    if (socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    for (let index = 0; index < WUJI_ZERO_FRAME_COUNT; index += 1) {
      socket.send(wujiSnapshotPayload(WUJI_ZERO_TARGET, wujiWeightsRef.current));
    }
  };

  const closeWujiBridge = (bridgeKey, { sendZero = true } = {}) => {
    window.clearTimeout(wujiReconnectTimersRef.current[bridgeKey]);
    window.clearTimeout(wujiCloseTimersRef.current[bridgeKey]);
    delete wujiReconnectTimersRef.current[bridgeKey];
    delete wujiCloseTimersRef.current[bridgeKey];

    const socket = wujiSocketsRef.current[bridgeKey];
    if (!socket) {
      updateWujiBridgeStatus(bridgeKey, { connected: false });
      return;
    }

    if (sendZero && socket.readyState === WebSocket.OPEN) {
      sendWujiZeroFrames(bridgeKey);
      wujiCloseTimersRef.current[bridgeKey] = window.setTimeout(() => {
        delete wujiCloseTimersRef.current[bridgeKey];
        if (wujiSocketsRef.current[bridgeKey] === socket) {
          socket.close();
        }
      }, 180);
      return;
    }

    socket.close();
  };

  const closeAllWujiBridges = ({ sendZero = true } = {}) => {
    const bridgeKeys = new Set([
      ...Object.keys(wujiBridgeUrlsRef.current),
      ...Object.keys(wujiSocketsRef.current),
    ]);
    bridgeKeys.forEach((bridgeKey) => closeWujiBridge(bridgeKey, { sendZero }));
  };

  const connectWujiBridge = (bridgeKey) => {
    const bridgeUrl = wujiBridgeUrlsRef.current[bridgeKey];
    if (!bridgeUrl) {
      return;
    }

    if (typeof WebSocket === 'undefined') {
      updateWujiBridgeStatus(bridgeKey, {
        connected: false,
        error: 'WebSocket unavailable',
      });
      return;
    }

    window.clearTimeout(wujiCloseTimersRef.current[bridgeKey]);
    delete wujiCloseTimersRef.current[bridgeKey];
    const currentSocket = wujiSocketsRef.current[bridgeKey];
    if (currentSocket && currentSocket.url !== bridgeUrl) {
      currentSocket.close();
      delete wujiSocketsRef.current[bridgeKey];
    }
    if (currentSocket && currentSocket.readyState <= WebSocket.OPEN) {
      return;
    }

    window.clearTimeout(wujiReconnectTimersRef.current[bridgeKey]);
    delete wujiReconnectTimersRef.current[bridgeKey];
    const socket = new WebSocket(bridgeUrl);
    wujiSocketsRef.current[bridgeKey] = socket;
    updateWujiBridgeStatus(bridgeKey, { error: '', ack: 'connecting' });

    socket.addEventListener('open', () => {
      if (wujiSocketsRef.current[bridgeKey] !== socket) return;
      updateWujiBridgeStatus(bridgeKey, {
        connected: true,
        error: '',
        ack: 'connected',
      });
    });

    socket.addEventListener('message', (event) => {
      if (wujiSocketsRef.current[bridgeKey] !== socket) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'error') {
          updateWujiBridgeStatus(bridgeKey, {
            ack: '',
            error: message.message || 'bridge error',
          });
          return;
        }

        if (message.type === 'ack') {
          updateWujiBridgeStatus(bridgeKey, (current) => ({
            connected: true,
            error: message.hardware_error || '',
            ack: `ack ${message.frames ?? current.frames}`,
          }));
          return;
        }

        if (message.type === 'status') {
          updateWujiBridgeStatus(bridgeKey, {
            connected: true,
            error: message.hardware_error || '',
            ack: message.live ? 'live' : 'status',
          });
        }
      } catch {
        updateWujiBridgeStatus(bridgeKey, { ack: 'message' });
      }
    });

    socket.addEventListener('error', () => {
      if (wujiSocketsRef.current[bridgeKey] !== socket) return;
      updateWujiBridgeStatus(bridgeKey, {
        connected: false,
        error: 'bridge unavailable',
      });
    });

    socket.addEventListener('close', () => {
      if (wujiSocketsRef.current[bridgeKey] !== socket) {
        return;
      }
      delete wujiSocketsRef.current[bridgeKey];
      updateWujiBridgeStatus(bridgeKey, {
        connected: false,
        ack: wujiEnabledRef.current ? 'reconnecting' : 'closed',
      });

      if (wujiEnabledRef.current && wujiBridgeUrlsRef.current[bridgeKey]) {
        wujiReconnectTimersRef.current[bridgeKey] = window.setTimeout(() => {
          delete wujiReconnectTimersRef.current[bridgeKey];
          connectWujiBridge(bridgeKey);
        }, 1200);
      }
    });
  };

  const sendWujiBends = (bends, handSide) => {
    if (!wujiEnabledRef.current || !Array.isArray(bends)) {
      return;
    }

    const bridgeKey = wujiBridgeKeyForHand(wujiBridgeUrlsRef.current, handSide);
    if (!bridgeKey) {
      return;
    }

    const now = performance.now();
    if (now - (lastWujiSendAtRef.current[bridgeKey] || 0) < wujiSendIntervalRef.current) {
      return;
    }

    const socket = wujiSocketsRef.current[bridgeKey];
    if (socket?.readyState !== WebSocket.OPEN) {
      connectWujiBridge(bridgeKey);
      return;
    }

    lastWujiSendAtRef.current[bridgeKey] = now;
    const target = bendValuesToWujiTarget(
      bends.map((bend) => clamp01((Number(bend) || 0) * bendGainRef.current)),
      wujiWeightsRef.current,
    );
    socket.send(wujiSnapshotPayload(target, wujiWeightsRef.current));
    updateWujiBridgeStatus(bridgeKey, (current) => ({
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
    gyroAdjustmentsRef.current = gyroAdjustments;
  }, [gyroAdjustments]);

  useEffect(() => {
    writeStoredGyroCalibrationCaptures(gyroCalibrationCaptures);
  }, [gyroCalibrationCaptures]);

  useEffect(() => {
    writeStoredGloveMotionSettings({
      useLiveData,
      bendGain,
      lineColor,
      showSkeleton,
      mirrorScaleX,
      sceneBackgroundColor,
      wujiSendIntervalMs,
      wujiWeights,
      modelTransforms,
      modelTransformVersion: MODEL_TRANSFORM_SETTINGS_VERSION,
      gyroAdjustments,
      gyroAdjustmentVersion: GYRO_ADJUSTMENT_SETTINGS_VERSION,
    });
  }, [
    useLiveData,
    bendGain,
    lineColor,
    showSkeleton,
    mirrorScaleX,
    sceneBackgroundColor,
    wujiSendIntervalMs,
    wujiWeights,
    modelTransforms,
    gyroAdjustments,
  ]);

  useEffect(() => {
    setModelTransforms((current) => {
      let changed = false;
      const next = { ...current };
      handViewConfigs.forEach((view) => {
        if (!next[view.key]) {
          next[view.key] = { ...(resolvedModelTransformDefaults[view.key] || DEFAULT_MODEL_TRANSFORM) };
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [handViewConfigs, resolvedModelTransformDefaults]);

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
    wujiSendIntervalRef.current = wujiSendIntervalMs;
  }, [wujiSendIntervalMs]);

  useEffect(() => {
    wujiBridgeUrlsRef.current = resolvedWujiBridgeUrls;
    setWujiBridgeStatuses((current) => {
      const next = { ...current };
      Object.keys(resolvedWujiBridgeUrls).forEach((bridgeKey) => {
        if (!next[bridgeKey]) {
          next[bridgeKey] = createWujiBridgeStatus();
        }
      });
      return next;
    });
  }, [resolvedWujiBridgeUrls]);

  useEffect(() => {
    wujiEnabledRef.current = wujiBridgeEnabled;

    if (wujiBridgeEnabled) {
      Object.keys(resolvedWujiBridgeUrls).forEach((bridgeKey) => connectWujiBridge(bridgeKey));
    } else {
      closeAllWujiBridges({ sendZero: true });
    }

    return () => {
      wujiEnabledRef.current = false;
      closeAllWujiBridges({ sendZero: true });
    };
  }, [resolvedWujiBridgeUrls, wujiBridgeEnabled]);

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
      const manualGroup = new THREE.Group();
      const gyroGroup = new THREE.Group();
      group.add(manualGroup);
      manualGroup.add(gyroGroup);
      motionGroup.add(group);

      return {
        ...view,
        transformKey: view.key,
        group,
        manualGroup,
        gyroGroup,
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
          const transform = modelTransformsRef.current?.[rig.transformKey] || DEFAULT_MODEL_TRANSFORM;
          model.position.set(
            -(Number(transform.pivotX) || 0),
            -(Number(transform.pivotY) || 0),
            -(Number(transform.pivotZ) || 0),
          );
          rig.gyroGroup.add(model);

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
      const compactDualHands = compact && handRigs.length > 1;

      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / Math.max(clientHeight, 1);
      camera.position.set(0, compact ? 0.15 : 0.35, compact ? 16.8 : 14.2);
      camera.updateProjectionMatrix();
      responsiveTransformRef.current = {
        x: compactDualHands ? 0 : compact ? -0.2 : 0,
        y: compactDualHands ? 0.6 : compact ? 0.15 : 0,
        z: 0,
        scale: compactDualHands ? 0.42 : compact ? 0.74 : 1,
      };
      applyCurrentModelTransform();
    };

    const animate = () => {
      const delta = Math.min(clock.getDelta(), 0.05);
      elapsed += delta;
      let readoutRig = handRigs[0] || null;
      let readoutSnapshot = null;
      let readoutSource = 'SIM';
      let readoutRawFingerPoints = EMPTY_BEND;
      const posePlaybackState = posePlaybackRef.current;
      const useCalibrationPoseInput = Boolean(
        posePlaybackRuntime && posePlaybackState.inputMode === 'poses',
      );
      const useLivePoseInput = !posePlaybackRuntime || posePlaybackState.inputMode === 'live';
      const playbackPoseKey = useCalibrationPoseInput && posePlaybackState.autoPlay
        ? GYRO_POSE_PLAYBACK_SEQUENCE[
            Math.floor(elapsed / GYRO_POSE_PLAYBACK_SECONDS) % GYRO_POSE_PLAYBACK_SEQUENCE.length
          ]
        : posePlaybackState.selectedPose;

      if (useCalibrationPoseInput && playbackPoseKey !== activePoseKeyRef.current) {
        activePoseKeyRef.current = playbackPoseKey;
        setActivePoseKey(playbackPoseKey);
      }

      handRigs.forEach((rig) => {
        const snapshot = getRigSnapshot(rig);
        const pressureFrameAt = snapshot?.timestamp || 0;
        if (pressureFrameAt !== rig.lastPressureFrameAt) {
          rig.lastPressureFrameAt = pressureFrameAt;
          updateNew147PressureColors(rig.pressureRuntime, snapshot?.mappedPressureData);
        }

        const playbackHandSide = rig.side || activeHandSideRef.current;
        const playbackQuaternion = useCalibrationPoseInput
          ? posePlaybackRuntime?.[playbackHandSide]?.poses?.[playbackPoseKey]
          : null;
        const usePosePlayback = Boolean(playbackQuaternion);
        let hasLivePose = false;
        let hasLiveBend = false;
        let rawFingerPoints = rig.simulatedFrame.rawFingerPoints;

        if (usePosePlayback) {
          rig.targetQuaternion.copy(playbackQuaternion);
          const smoothing = 1 - Math.exp(-delta * 8);
          rig.displayedQuaternion.slerp(rig.targetQuaternion, smoothing);
          if (lockOrientation) {
            rig.gyroGroup.quaternion.identity();
          } else {
            rig.gyroGroup.quaternion.copy(rig.displayedQuaternion);
          }

          const bendSmoothing = 1 - Math.exp(-delta * 9);
          for (let fingerIndex = 0; fingerIndex < FINGER_NAMES.length; fingerIndex += 1) {
            const wave = posePlaybackState.fingerMotion
              ? (0.5 + Math.sin(elapsed * 1.8 + fingerIndex * 0.68 + rig.phase) * 0.5) * 0.28
              : 0;
            const targetBend = clamp01(posePlaybackState.fingerCurl + wave);
            rig.bend[fingerIndex] += (targetBend - rig.bend[fingerIndex]) * bendSmoothing;
            rawFingerPoints[fingerIndex] = Math.round(targetBend * 255);
          }
        } else {
          const liveRotate = snapshot?.rotate;
          const hasMappedFingerPoints = extractFingerRootPoints(snapshot?.mappedPressureData, rig.liveFingerPoints);
          hasLivePose = useLivePoseInput && useLiveRef.current && isUsableRotate(liveRotate);
          hasLiveBend = useLivePoseInput && useLiveRef.current && hasMappedFingerPoints;
          const gyroAdjustment = gyroAdjustmentsRef.current[rig.transformKey] || DEFAULT_GYRO_ADJUSTMENT;
          const useSessionNeutral = Boolean(posePlaybackRuntime && useLivePoseInput);
          const useZeroFallback = handRigs.length > 1 && rig.side;
          const fallbackFrame = hasLivePose && hasLiveBend
            ? null
            : useZeroFallback
              ? rig.zeroFrame
              : writeSimulatedFrame(elapsed + rig.phase, rig.simulatedFrame);
          const rotate = hasLivePose
            ? liveRotate
            : !useSessionNeutral && isUsableRotate(gyroAdjustment.neutralRotate)
              ? gyroAdjustment.neutralRotate
              : fallbackFrame.rotate;
          rawFingerPoints = hasLiveBend ? rig.liveFingerPoints : fallbackFrame.rawFingerPoints;
          if (useSessionNeutral && !hasLivePose) {
            if (!rig.quaternionState.base) {
              rig.targetQuaternion.identity();
            }
          } else {
            transformQuaternionForRender(
              rotate,
              rig.quaternionState,
              rig.targetQuaternion,
              gyroAdjustment,
              !useSessionNeutral,
            );
            if (hasLivePose) {
              applyQuaternionAxisSigns(
                rig.targetQuaternion,
                liveQuaternionAxisSigns?.[playbackHandSide],
              );
            }
          }

          const smoothing = 1 - Math.exp(-delta * (hasLivePose ? 18 : 10));
          rig.displayedQuaternion.slerp(rig.targetQuaternion, smoothing);
          if (lockOrientation) {
            rig.gyroGroup.quaternion.identity();
          } else {
            rig.gyroGroup.quaternion.copy(rig.displayedQuaternion);
          }
          rig.bend = updateFingerBend(
            rig.bend,
            rawFingerPoints,
            calibrationRef.current[rig.side || snapshot?.handSide || activeHandSideRef.current] || DEFAULT_CALIBRATION,
          );
          const outputHandSide = rig.side || activeHandSideRef.current;
          if (
            hasLiveBend
            && (hasSideSpecificWujiBridges || !rig.side || rig.side === activeHandSideRef.current)
          ) {
            sendWujiBends(rig.bend, outputHandSide);
          }
        }

        rig.latestRawFingerPoints = rawFingerPoints.slice(0, 5);
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
          readoutSource = usePosePlayback ? 'CAL' : hasLivePose || hasLiveBend ? 'LIVE' : 'SIM';
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
          source: readoutSource,
          quaternion: formatQuaternion(readoutRig?.displayedQuaternion || new THREE.Quaternion()),
          bends: (readoutRig?.bend || EMPTY_BEND).map((value) => Math.round(value * 100)),
          rawFingerPoints: Array.from(readoutRawFingerPoints || EMPTY_BEND).map((value) => Math.round(value)),
          frameAge: posePlaybackRuntime
            ? posePlaybackSampleLabel
            : readoutSnapshot?.timestamp
              ? `${Math.max(0, Date.now() - readoutSnapshot.timestamp)} ms`
              : 'none',
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
  }, [
    handViewConfigs,
    hasSideSpecificWujiBridges,
    liveQuaternionAxisSigns,
    lockOrientation,
    modelUrl,
    posePlaybackRuntime,
    posePlaybackSampleLabel,
    regionColorOptions,
    regionDataSource,
    regionLabel,
  ]);

  const resetQuaternionBase = () => {
    quaternionStateRef.current = { base: null, baseInv: null };
    displayedQuaternionRef.current?.identity();
    handRigsRef.current.forEach((rig) => {
      rig.quaternionState = { base: null, baseInv: null };
      rig.displayedQuaternion.identity();
      rig.gyroGroup?.quaternion.identity();
    });
  };

  const captureCalibration = (index, requestedHandSide = dataSource.activeHandSide) => {
    const handSide = requestedHandSide === 'left' ? 'left' : 'right';
    const handRig = handRigsRef.current.find((rig) => rig.side === handSide);
    const rawFingerPoints = handRig?.latestRawFingerPoints || latestRawFingerPointsRef.current;
    const current = calibrationRef.current[handSide] || DEFAULT_CALIBRATION.map((row) => [...row]);
    const next = current.map((row) => [...row]);
    next[index] = rawFingerPoints.slice(0, 5);
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
      <nav className="app-nav" style={{ '--nav-count': 11 }} aria-label="Page view">
        <button type="button" onClick={() => onNavigate('terrain')}>Pressure</button>
        <button type="button" onClick={() => onNavigate('hand')}>Wireframe</button>
        <button type="button" onClick={() => onNavigate('obj')}>OBJ</button>
        <button type="button" onClick={() => onNavigate('bones')}>Bones</button>
        <button className={pageKey === 'gloveMotion' ? 'active' : ''} type="button" onClick={() => onNavigate('gloveMotion')}>Motion</button>
        <button className={pageKey === 'gloveStill' ? 'active' : ''} type="button" onClick={() => onNavigate('gloveStill')}>Still</button>
        <button className={pageKey === 'motiondouble' ? 'active' : ''} type="button" onClick={() => onNavigate('motiondouble')}>MotionDouble</button>
        <button className={pageKey === 'motion2' ? 'active' : ''} type="button" onClick={() => onNavigate('motion2')}>Motion2</button>
        <button className={pageKey === 'motion2double' ? 'active' : ''} type="button" onClick={() => onNavigate('motion2double')}>M2Double</button>
        <button className={pageKey === 'm2doublePro' ? 'active' : ''} type="button" onClick={() => onNavigate('m2doublePro')}>M2 Pro</button>
        <button type="button" onClick={() => onNavigate('points')}>Points</button>
      </nav>

      <header className="glove-motion-title">
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{modelLabel} / {loadState}</p>
      </header>

      <section className="glove-motion-panel" aria-label="Glove motion controls">
        <div className="glove-motion-status">
          <strong className={poseReadout.source === 'LIVE' || poseReadout.source === 'CAL' ? 'online' : ''}>{poseReadout.source}</strong>
          <span>
            {hasPosePlayback && poseInputMode === 'poses'
              ? `${activePose.label} / ${posePlaybackSampleLabel}`
              : dataSource.status.connected
                ? `WS connected / ${dataSource.status.frameCount} frames`
                : dataSource.status.connecting
                  ? 'Connecting'
                  : 'Simulation'}
          </span>
        </div>

        <button className="glove-fullscreen-button" type="button" onClick={enterSceneFullscreen}>
          Fullscreen 3D
        </button>

        {hasPosePlayback ? (
          <div className="glove-pose-playback-control" aria-label="Quaternion input controls">
            <div className="glove-pose-playback-heading">
              <span>{poseInputMode === 'live' ? 'WebSocket quaternion' : 'Quaternion poses'}</span>
              <strong>{poseInputMode === 'live' ? 'L + R' : posePlaybackSampleLabel}</strong>
            </div>
            <div className="glove-pose-source-toggle" role="group" aria-label="Quaternion input source">
              <button
                className={poseInputMode === 'live' ? 'active' : ''}
                type="button"
                aria-pressed={poseInputMode === 'live'}
                onClick={() => {
                  setPoseInputMode('live');
                  setUseLiveData(true);
                  setAutoPosePlayback(false);
                  resetQuaternionBase();
                }}
              >
                WS Live
              </button>
              <button
                className={poseInputMode === 'poses' ? 'active' : ''}
                type="button"
                aria-pressed={poseInputMode === 'poses'}
                onClick={() => setPoseInputMode('poses')}
              >
                Pose Test
              </button>
            </div>
            {poseInputMode === 'live' ? (
              <button className="glove-pose-set-neutral" type="button" onClick={resetQuaternionBase}>
                Set Neutral
              </button>
            ) : (
              <>
                <div className="glove-pose-playback-grid" role="group" aria-label="Calibration pose">
                  {GYRO_CALIBRATION_POSES.map((pose) => (
                    <button
                      key={pose.key}
                      className={activePoseKey === pose.key ? 'active' : ''}
                      type="button"
                      onClick={() => {
                        setAutoPosePlayback(false);
                        setSelectedPose(pose.key);
                      }}
                    >
                      <span>{pose.label}</span>
                      {posePlaybackRuntime.left?.targetLabels?.[pose.key] ? (
                        <small>L {posePlaybackRuntime.left.targetLabels[pose.key]}</small>
                      ) : null}
                      {posePlaybackRuntime.right?.targetLabels?.[pose.key] ? (
                        <small>R {posePlaybackRuntime.right.targetLabels[pose.key]}</small>
                      ) : null}
                    </button>
                  ))}
                </div>
                <div className="glove-pose-playback-actions">
                  <button
                    className={autoPosePlayback ? 'active' : ''}
                    type="button"
                    aria-pressed={autoPosePlayback}
                    onClick={() => setAutoPosePlayback((value) => !value)}
                  >
                    Auto sequence
                  </button>
                  <label>
                    <input
                      type="checkbox"
                      checked={fingerMotion}
                      onChange={(event) => setFingerMotion(event.target.checked)}
                    />
                    <span>Finger motion</span>
                  </label>
                </div>
                <label className="glove-pose-finger-curl">
                  <span>Finger curl</span>
                  <input
                    type="range"
                    min="0"
                    max="0.72"
                    step="0.01"
                    value={fingerCurl}
                    onChange={(event) => setFingerCurl(Number(event.target.value))}
                    onInput={(event) => setFingerCurl(Number(event.target.value))}
                  />
                  <strong>{Math.round(fingerCurl * 100)}%</strong>
                </label>
              </>
            )}
          </div>
        ) : null}

        {showLiveHandToggle ? (
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
        ) : null}

        {!hasPosePlayback ? (
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
        ) : null}
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
          <span>{hasSideSpecificWujiBridges ? 'Wuji bridges' : 'Wuji bridge'}</span>
        </label>
        {Object.entries(resolvedWujiBridgeUrls).map(([bridgeKey, bridgeUrl]) => {
          const status = wujiBridgeStatuses[bridgeKey] || createWujiBridgeStatus();
          const bridgeLabel = bridgeKey === 'left' ? 'L' : bridgeKey === 'right' ? 'R' : '';
          return (
            <div className="glove-bridge-status" title={bridgeUrl} key={bridgeKey}>
              <span>{bridgeLabel ? `${bridgeLabel} ${bridgeUrl}` : bridgeUrl}</span>
              <strong className={wujiBridgeEnabled && status.connected && !status.error ? 'online' : ''}>
                {formatWujiStatus(wujiBridgeEnabled, status)}
              </strong>
            </div>
          );
        })}
        <div className="glove-wuji-weight-control" aria-label="Wuji bridge bend weights">
          <div className="glove-wuji-weight-heading">
            <span>Wuji output</span>
            <button type="button" onClick={resetWujiOutput}>Reset</button>
          </div>
          <label>
            <span>Interval</span>
            <input
              type="range"
              min={WUJI_SEND_INTERVAL_MIN_MS}
              max={WUJI_SEND_INTERVAL_MAX_MS}
              step={WUJI_SEND_INTERVAL_STEP_MS}
              value={wujiSendIntervalMs}
              aria-label="Wuji send interval"
              onChange={(event) => setWujiSendIntervalMs(Number(event.target.value))}
              onInput={(event) => setWujiSendIntervalMs(Number(event.target.value))}
            />
            <strong>{Math.round(wujiSendIntervalMs)} ms</strong>
          </label>
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
            <div>
              {hasPairedHandTransforms ? (
                <button type="button" onClick={mirrorActiveTransformToOtherHand}>Mirror Other</button>
              ) : null}
              <button type="button" onClick={resetModelTransform}>Reset</button>
            </div>
          </div>
          {hasPairedHandTransforms ? (
            <div className="glove-transform-side-toggle" role="group" aria-label="Position edit hand">
              {['left', 'right'].map((side) => (
                <button
                  key={side}
                  className={transformEditSide === side ? 'active' : ''}
                  type="button"
                  onClick={() => setTransformEditSide(side)}
                >
                  Position {side}
                </button>
              ))}
            </div>
          ) : null}
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

        <div className="glove-gyro-control" aria-label="Gyro axis controls">
          <div className="glove-transform-heading">
            <span>Gyro: {activeGyroLabel}</span>
          </div>
          {hasPairedHandTransforms ? (
            <div className="glove-transform-side-toggle" role="group" aria-label="Gyro edit hand">
              {['left', 'right'].map((side) => (
                <button
                  key={side}
                  className={gyroEditSide === side ? 'active' : ''}
                  type="button"
                  onClick={() => setGyroEditSide(side)}
                >
                  Gyro {side}
                </button>
              ))}
            </div>
          ) : null}
          <div className="glove-gyro-axis-toggle" aria-label="Gyro frame correction">
            {GYRO_ADJUSTMENT_AXES.map((axis) => {
              const sign = activeGyroAdjustment[axis.key] || 1;
              const sourceAxis = activeGyroAdjustment[axis.sourceKey] || axis.key;
              return (
                <div className="glove-gyro-axis-row" key={axis.key}>
                  <button
                    className={sign < 0 ? 'active' : ''}
                    type="button"
                    onClick={() => toggleGyroAdjustmentAxis(axis.key)}
                  >
                    {axis.label} {sign < 0 ? '-' : '+'}
                  </button>
                  <select
                    value={sourceAxis}
                    aria-label={`${axis.label} gyro source axis`}
                    onChange={(event) => updateGyroAdjustmentSource(axis.sourceKey, event.target.value)}
                  >
                    {GYRO_SOURCE_AXES.map((source) => (
                      <option key={source} value={source}>raw {source.toUpperCase()}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          <div className="glove-gyro-capture-control" aria-label="Gyro calibration samples">
            <div className="glove-transform-heading">
              <span>Gyro samples {activeGyroCaptureSide}: {gyroCaptureTotal}</span>
              <div>
                <button type="button" onClick={applyGyroCalibrationFromSamples} disabled={!gyroCaptureTotal}>Auto Cal</button>
                <button type="button" onClick={copyGyroCalibrationJson} disabled={!gyroCaptureTotal}>Copy</button>
                <button type="button" onClick={exportGyroCalibrationJson} disabled={!gyroCaptureTotal}>Export</button>
                <button type="button" onClick={clearGyroCalibrationCaptures} disabled={!gyroCaptureTotal}>Clear</button>
              </div>
            </div>
            <div className="glove-gyro-pose-grid">
              {GYRO_CALIBRATION_POSES.map((pose) => {
                const count = gyroCaptureCounts[pose.key] || 0;
                return (
                  <div className="glove-gyro-pose-row" key={pose.key}>
                    <button
                      className="glove-gyro-pose-capture"
                      type="button"
                      onClick={() => captureGyroCalibrationPose(pose.key)}
                    >
                      <span>{pose.label}</span>
                      <strong>{count}</strong>
                    </button>
                    <button
                      className="glove-gyro-pose-clear"
                      type="button"
                      aria-label={`Clear ${activeGyroCaptureSide} ${pose.label}`}
                      title={`Clear ${activeGyroCaptureSide} ${pose.label}`}
                      disabled={!count}
                      onClick={() => clearGyroCalibrationPose(pose.key)}
                    >
                      x
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="glove-gyro-capture-status">{gyroCaptureStatus}</div>
          </div>
        </div>

        <div className={`glove-motion-actions${hasPosePlayback && hasPairedHandTransforms ? ' paired' : ''}`}>
          {!hasPosePlayback ? <button type="button" onClick={resetQuaternionBase}>Zero Q</button> : null}
          {hasPosePlayback && hasPairedHandTransforms ? (
            <>
              <button type="button" onClick={() => captureCalibration(0, 'left')}>Open Cal left</button>
              <button type="button" onClick={() => captureCalibration(1, 'left')}>Bend Cal left</button>
              <button type="button" onClick={() => captureCalibration(0, 'right')}>Open Cal right</button>
              <button type="button" onClick={() => captureCalibration(1, 'right')}>Bend Cal right</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => captureCalibration(0)}>Open Cal {dataSource.activeHandSide}</button>
              <button type="button" onClick={() => captureCalibration(1)}>Bend Cal {dataSource.activeHandSide}</button>
            </>
          )}
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
