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

  model.scale.setScalar(scale);
  model.position.copy(center).multiplyScalar(-scale);
  model.rotation.set(0.2, -0.42, 2.28);
}

function applyLineColor(model, skeletonHelper, lineColor) {
  const color = new THREE.Color(lineColor || DEFAULT_LINE_COLOR);
  const emissive = color.clone().multiplyScalar(0.18);

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
      if ('emissive' in material) material.emissive.copy(emissive);
      material.needsUpdate = true;
    });
  });

  if (skeletonHelper?.material?.color) {
    skeletonHelper.material.color.copy(color);
  }
}

function applyModelLook(model, lineColor) {
  model.traverse((child) => {
    if (!child.isMesh) return;

    child.frustumCulled = false;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.filter(Boolean).forEach((material) => {
      if ('roughness' in material) material.roughness = 0.52;
      if ('metalness' in material) material.metalness = 0.08;
      material.side = THREE.DoubleSide;
    });
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
}) {
  const mountRef = useRef(null);
  const motionGroupRef = useRef(null);
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
  const useLiveRef = useRef(true);
  const bendGainRef = useRef(1);
  const lineColorRef = useRef(DEFAULT_LINE_COLOR);
  const activeHandSideRef = useRef('right');
  const skeletonHelperRef = useRef(null);
  const pressureRuntimeRef = useRef(null);
  const dataSource = useWebSocketPressureSource();
  const [useLiveData, setUseLiveData] = useState(true);
  const [bendGain, setBendGain] = useState(1);
  const [lineColor, setLineColor] = useState(DEFAULT_LINE_COLOR);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [loadState, setLoadState] = useState('Loading');
  const [calibrationVersion, setCalibrationVersion] = useState(0);
  const [poseReadout, setPoseReadout] = useState({
    source: 'SIM',
    quaternion: '0.00 / 0.00 / 0.00 / 1.00',
    bends: [...EMPTY_BEND],
    rawFingerPoints: [0, 0, 0, 0, 0],
    frameAge: 'none',
  });

  const activeCalibration = useMemo(
    () => calibrationRef.current[dataSource.activeHandSide] || DEFAULT_CALIBRATION,
    [calibrationVersion, dataSource.activeHandSide],
  );

  useEffect(() => {
    snapshotRef.current = dataSource.snapshot;
  }, [dataSource.snapshot]);

  useEffect(() => {
    activeHandSideRef.current = dataSource.activeHandSide;
  }, [dataSource.activeHandSide]);

  useEffect(() => {
    useLiveRef.current = useLiveData;
  }, [useLiveData]);

  useEffect(() => {
    bendGainRef.current = bendGain;
  }, [bendGain]);

  useEffect(() => {
    lineColorRef.current = lineColor;
    if (modelRef.current) {
      applyLineColor(modelRef.current, skeletonHelperRef.current, lineColor);
    }
  }, [lineColor]);

  useEffect(() => {
    if (skeletonHelperRef.current) {
      skeletonHelperRef.current.visible = showSkeleton;
    }
  }, [showSkeleton]);

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x06121a, 10, 30);

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

    scene.add(new THREE.HemisphereLight(0xc9ffff, 0x061018, 1.12));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.05);
    keyLight.position.set(-4, 6.2, 8);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(0x00fff7, 1.6, 20);
    rimLight.position.set(4.5, 1.8, -4);
    scene.add(rimLight);

    const grid = new THREE.GridHelper(10, 26, 0x1edee6, 0x123b4b);
    grid.position.y = -3.9;
    grid.material.transparent = true;
    grid.material.opacity = 0.22;
    scene.add(grid);

    let model = null;
    let frameId = 0;
    let disposed = false;
    let lastReadoutAt = 0;
    let lastPressureFrameAt = -1;
    let elapsed = 0;
    const clock = new THREE.Clock();
    const liveFingerPoints = [0, 0, 0, 0, 0];
    const targetQuaternion = new THREE.Quaternion();
    const displayedQuaternion = new THREE.Quaternion();
    displayedQuaternionRef.current = displayedQuaternion;
    const curlQuaternion = new THREE.Quaternion();
    const simulatedFrame = {
      euler: new THREE.Euler(0, 0, 0, 'XYZ'),
      quaternion: new THREE.Quaternion(),
      rotate: [0, 0, 0, 1],
      rawFingerPoints: [0, 0, 0, 0, 0],
    };

    new GLTFLoader().load(
      modelUrl,
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }

        model = gltf.scene;
        modelRef.current = model;
        normalizeModel(model);
        applyModelLook(model, lineColorRef.current);
        motionGroup.add(model);

        const bones = [];
        model.traverse((child) => {
          if (child.isBone && !bones.some((bone) => bone.uuid === child.uuid)) {
            bones.push(child);
          }
        });
        bonesRef.current = new Map(bones.map((bone) => [bone.name, bone]));
        originalQuaternionsRef.current = new Map(
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
        skeletonHelperRef.current = skeletonHelper;
        applyLineColor(model, skeletonHelper, lineColorRef.current);

        const skinnedMeshCount = [];
        model.traverse((child) => {
          if (child.isSkinnedMesh) skinnedMeshCount.push(child);
        });
        setLoadState(`${bones.length} bones / ${skinnedMeshCount.length} skin`);

        resolveRegionData(regionDataSource)
          .then((regionData) => {
            if (disposed || !model) return;

            const result = applyRegionColors(model, regionData, regionColorOptions);
            pressureRuntimeRef.current = result.pressureRuntime;
            applyLineColor(model, skeletonHelper, lineColorRef.current);
            setLoadState(
              `${bones.length} bones / ${skinnedMeshCount.length} skin / ${
                result.colored ? `${result.lineCount} ${regionLabel}` : `no ${regionLabel}`
              }`,
            );
          })
          .catch((error) => {
            console.error('Failed to apply hand region colors:', error);
            if (!disposed) {
              setLoadState(`${bones.length} bones / ${skinnedMeshCount.length} skin / region failed`);
            }
          });
      },
      undefined,
      (error) => {
        console.error('Failed to load glove motion GLB:', error);
        if (!disposed) setLoadState('Load failed');
      },
    );

    const resize = () => {
      const { clientWidth, clientHeight } = mount;
      const compact = clientWidth < 680;

      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / Math.max(clientHeight, 1);
      camera.position.set(0, compact ? 0.15 : 0.35, compact ? 16.8 : 14.2);
      camera.updateProjectionMatrix();
      motionGroup.scale.setScalar(compact ? 0.74 : 1);
      motionGroup.position.set(compact ? -0.2 : 0, compact ? 0.15 : 0, 0);
    };

    const animate = () => {
      const delta = Math.min(clock.getDelta(), 0.05);
      elapsed += delta;
      const snapshot = snapshotRef.current;
      const pressureFrameAt = snapshot?.timestamp || 0;
      if (pressureFrameAt !== lastPressureFrameAt) {
        lastPressureFrameAt = pressureFrameAt;
        updateNew147PressureColors(pressureRuntimeRef.current, snapshot?.mappedPressureData);
      }

      const liveRotate = snapshot?.rotate;
      const hasMappedFingerPoints = extractFingerRootPoints(snapshot?.mappedPressureData, liveFingerPoints);
      const hasLivePose = useLiveRef.current && isUsableRotate(liveRotate);
      const hasLiveBend = useLiveRef.current && hasMappedFingerPoints;
      const fallbackFrame = hasLivePose && hasLiveBend ? null : writeSimulatedFrame(elapsed, simulatedFrame);
      const rotate = hasLivePose ? liveRotate : fallbackFrame.rotate;
      const rawFingerPoints = hasLiveBend ? liveFingerPoints : fallbackFrame.rawFingerPoints;
      transformQuaternionForRender(rotate, quaternionStateRef.current, targetQuaternion);

      const smoothing = 1 - Math.exp(-delta * (hasLivePose ? 18 : 10));
      displayedQuaternion.slerp(targetQuaternion, smoothing);
      motionGroup.quaternion.copy(displayedQuaternion);
      latestRawFingerPointsRef.current = rawFingerPoints;
      bendRef.current = updateFingerBend(
        bendRef.current,
        rawFingerPoints,
        calibrationRef.current[snapshot?.handSide || activeHandSideRef.current] || DEFAULT_CALIBRATION,
      );
      applyFingerBend(
        bonesRef.current,
        originalQuaternionsRef.current,
        bendRef.current,
        bendGainRef.current,
        curlQuaternion,
      );
      model?.updateMatrixWorld(true);

      controls.update();
      renderer.render(scene, camera);

      if (performance.now() - lastReadoutAt > 250) {
        lastReadoutAt = performance.now();
        setPoseReadout({
          source: hasLivePose || hasLiveBend ? 'LIVE' : 'SIM',
          quaternion: formatQuaternion(displayedQuaternion),
          bends: bendRef.current.map((value) => Math.round(value * 100)),
          rawFingerPoints: rawFingerPoints.map((value) => Math.round(value)),
          frameAge: snapshot?.timestamp ? `${Math.max(0, Date.now() - snapshot.timestamp)} ms` : 'none',
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
      skeletonHelperRef.current?.geometry?.dispose();
      skeletonHelperRef.current?.material?.dispose();
      if (skeletonHelperRef.current?.parent) {
        skeletonHelperRef.current.parent.remove(skeletonHelperRef.current);
      }
      skeletonHelperRef.current = null;
      pressureRuntimeRef.current = null;
      if (model) disposeObject(model);
      modelRef.current = null;
      grid.geometry.dispose();
      grid.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      motionGroupRef.current = null;
      displayedQuaternionRef.current = null;
      bonesRef.current = new Map();
      originalQuaternionsRef.current = new Map();
    };
  }, [modelUrl, regionColorOptions, regionDataSource, regionLabel]);

  const resetQuaternionBase = () => {
    quaternionStateRef.current = { base: null, baseInv: null };
    displayedQuaternionRef.current?.identity();
    motionGroupRef.current?.quaternion.identity();
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
    <main className="glove-motion-page">
      <nav className="app-nav" style={{ '--nav-count': 7 }} aria-label="Page view">
        <button type="button" onClick={() => onNavigate('terrain')}>Pressure</button>
        <button type="button" onClick={() => onNavigate('hand')}>Wireframe</button>
        <button type="button" onClick={() => onNavigate('obj')}>OBJ</button>
        <button type="button" onClick={() => onNavigate('bones')}>Bones</button>
        <button className={pageKey === 'gloveMotion' ? 'active' : ''} type="button" onClick={() => onNavigate('gloveMotion')}>Motion</button>
        <button className={pageKey === 'motion2' ? 'active' : ''} type="button" onClick={() => onNavigate('motion2')}>Motion2</button>
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

        <div className="glove-motion-actions">
          <button type="button" onClick={resetQuaternionBase}>Zero Q</button>
          <button type="button" onClick={() => captureCalibration(0)}>Open Cal</button>
          <button type="button" onClick={() => captureCalibration(1)}>Bend Cal</button>
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
    </main>
  );
}
