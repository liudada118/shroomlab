import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import {
  DEFAULT_GAUSSIAN_KERNEL_SIZE,
  SENSOR_MATRIX_SIZE,
  buildHandPressureFrame,
} from './handPressureData.js';

const DEFAULT_OBJ_MODEL_NAME = 'hand0423g_quads.obj';
const FRONT_HAND_REGION_URL = '/hand_info/hand0423g_front_hand_palm_fingers.json';
const FRONT_HAND_REGION_CSV_URL = '/hand_info/hand0423g_front_hand_palm_fingers.csv';
const MIN_EDGE_GRANULARITY = 1;
const MAX_EDGE_GRANULARITY = 8;
const SOURCE_MATRIX_SIZE = 32;
const HAND_MODEL_X_MIN = -2.66226387;
const HAND_MODEL_X_MAX = 6.01092291;
const HAND_MODEL_Y_MIN = -11.4826946;
const HAND_MODEL_Y_MAX = 8.76825905;
const HAND_MODEL_Z_MIN = -1.37241149;
const HAND_MODEL_Z_MAX = 2.58495402;
const SELECTION_MIN_DRAG_DISTANCE = 6;
const DEFAULT_COORD_FILTER = Object.freeze({
  xMin: HAND_MODEL_X_MIN,
  xMax: 5.99,
  yMin: -0.23,
  yMax: HAND_MODEL_Y_MAX,
  zMin: 0.53,
  zMax: HAND_MODEL_Z_MAX,
});
const BASE_SURFACE_COLOR = new THREE.Color(0xaef4ef);
const DEFAULT_BASE_GRID_COLOR = '#00fff7';
const DEFAULT_LOW_PRESSURE_COLOR = '#00d8ff';
const DEFAULT_MID_PRESSURE_COLOR = '#ffe600';
const DEFAULT_HIGH_PRESSURE_COLOR = '#ff2438';
const DEFAULT_PRESSURE_COLOR_GAIN = 3.2;
const DEFAULT_PRESSURE_COLOR_CUTOFF = 0.006;

function normalizeObjModelName(value) {
  const trimmed = value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  const modelName = trimmed
    .replace(/^public\/model\//i, '')
    .replace(/^model\//i, '');

  if (!modelName) {
    return DEFAULT_OBJ_MODEL_NAME;
  }

  return modelName.toLowerCase().endsWith('.obj') ? modelName : `${modelName}.obj`;
}

function buildObjModelUrl(modelName) {
  return `/model/${normalizeObjModelName(modelName)}`;
}

function loadObjModel(url) {
  return new Promise((resolve, reject) => {
    new OBJLoader().load(url, resolve, undefined, reject);
  });
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.text();
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Browser automation and some local contexts can block async clipboard writes.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

function parseObjVertexIndex(token, vertexCount) {
  const rawIndex = Number.parseInt(token.split('/')[0], 10);
  if (!Number.isFinite(rawIndex)) {
    return null;
  }

  return rawIndex < 0 ? vertexCount + rawIndex : rawIndex - 1;
}

function normalizeEdgeGranularity(value) {
  const granularity = Number(value);
  if (!Number.isFinite(granularity)) {
    return MIN_EDGE_GRANULARITY;
  }

  return Math.max(MIN_EDGE_GRANULARITY, Math.min(MAX_EDGE_GRANULARITY, Math.round(granularity)));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function sampleMatrix(matrix, row, col) {
  const matrixSize = matrix.length || SENSOR_MATRIX_SIZE;
  const clampedRow = Math.max(0, Math.min(matrixSize - 1, row));
  const clampedCol = Math.max(0, Math.min(matrixSize - 1, col));
  const row0 = Math.floor(clampedRow);
  const col0 = Math.floor(clampedCol);
  const row1 = Math.min(matrixSize - 1, row0 + 1);
  const col1 = Math.min(matrixSize - 1, col0 + 1);
  const rowT = clampedRow - row0;
  const colT = clampedCol - col0;
  const top = lerp(matrix[row0][col0], matrix[row0][col1], colT);
  const bottom = lerp(matrix[row1][col0], matrix[row1][col1], colT);

  return lerp(top, bottom, rowT);
}

function colorForPressure(value, pressureStyle) {
  const pressure = clamp01(value);
  const lowColor = pressureStyle.lowColor;
  const midColor = pressureStyle.midColor;
  const highColor = pressureStyle.highColor;

  if (pressure < 0.5) {
    return lowColor.clone().lerp(midColor, pressure / 0.5);
  }

  return midColor.clone().lerp(highColor, (pressure - 0.5) / 0.5);
}

function modelToSourceCoordinate(x, y) {
  const row = clamp01((HAND_MODEL_Y_MAX - y) / (HAND_MODEL_Y_MAX - HAND_MODEL_Y_MIN)) * (SOURCE_MATRIX_SIZE - 1);
  const col = clamp01((x - HAND_MODEL_X_MIN) / (HAND_MODEL_X_MAX - HAND_MODEL_X_MIN)) * (SOURCE_MATRIX_SIZE - 1);

  return {
    row: Number(row.toFixed(4)),
    col: Number(col.toFixed(4)),
    rowIndex: Math.round(row),
    colIndex: Math.round(col),
  };
}

function pointKeyForPosition(x, y, z) {
  return `${x.toFixed(5)}:${y.toFixed(5)}:${z.toFixed(5)}`;
}

function pointKeyForFloat32Position(x, y, z) {
  return pointKeyForPosition(Math.fround(x), Math.fround(y), Math.fround(z));
}

function parseRegionCsv(csvText) {
  const quadIds = new Set();
  const vertexIds = new Set();
  const lines = csvText.trim().split(/\r?\n/);

  lines.slice(1).forEach((line) => {
    if (!line.trim()) {
      return;
    }

    const columns = line.split(',');
    const quadId = Number(columns[0]);
    if (Number.isFinite(quadId)) {
      quadIds.add(quadId);
    }

    [3, 4, 5, 6].forEach((columnIndex) => {
      const vertexId = Number(columns[columnIndex]);
      if (Number.isFinite(vertexId)) {
        vertexIds.add(vertexId);
      }
    });
  });

  return {
    quadIds: [...quadIds],
    vertexIds: [...vertexIds],
  };
}

async function loadFrontHandRegion() {
  const [json, csv] = await Promise.all([
    fetchJson(FRONT_HAND_REGION_URL),
    fetchText(FRONT_HAND_REGION_CSV_URL),
  ]);
  const csvRegion = parseRegionCsv(csv);
  const vertexIds = new Set([...(json.vertex_ids || []), ...csvRegion.vertexIds]);

  return {
    ...json,
    vertex_ids: [...vertexIds],
    quad_ids: csvRegion.quadIds,
  };
}

function parseObjCoordinateMap(objText, modelUrl) {
  const vertices = [];
  const faces = [];

  objText.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('v ')) {
      const [, x, y, z] = trimmed.split(/\s+/);
      vertices.push({
        id: vertices.length + 1,
        x: Number(x),
        y: Number(y),
        z: Number(z),
      });
      return;
    }

    if (!trimmed.startsWith('f ')) {
      return;
    }

    const vertexIds = trimmed
      .slice(2)
      .trim()
      .split(/\s+/)
      .map((token) => {
        const vertexIndex = parseObjVertexIndex(token, vertices.length);
        return vertexIndex === null ? null : vertexIndex + 1;
      })
      .filter((vertexId) => vertexId !== null && vertices[vertexId - 1]);

    if (vertexIds.length >= 3) {
      faces.push({
        id: faces.length + 1,
        vertexIds,
      });
    }
  });

  const points = vertices.map((vertex) => ({
    ...vertex,
    source: modelToSourceCoordinate(vertex.x, vertex.y),
  }));

  const quads = faces.map((face) => {
    const faceVertices = face.vertexIds.map((vertexId) => vertices[vertexId - 1]);
    const center = faceVertices.reduce(
      (acc, vertex) => ({
        x: acc.x + vertex.x / faceVertices.length,
        y: acc.y + vertex.y / faceVertices.length,
        z: acc.z + vertex.z / faceVertices.length,
      }),
      { x: 0, y: 0, z: 0 },
    );

    return {
      id: face.id,
      vertexIds: face.vertexIds,
      center: {
        x: Number(center.x.toFixed(6)),
        y: Number(center.y.toFixed(6)),
        z: Number(center.z.toFixed(6)),
        source: modelToSourceCoordinate(center.x, center.y),
      },
    };
  });

  return {
    schema: 'shroomLab.objGridMap.v1',
    model: modelUrl,
    coordinateSystem: {
      model: 'OBJ local coordinates before page normalization',
      sourceMatrix: `${SOURCE_MATRIX_SIZE}x${SOURCE_MATRIX_SIZE}`,
      sourceRow: 'mapped from OBJ y, top to bottom',
      sourceCol: 'mapped from OBJ x, left to right',
    },
    counts: {
      points: points.length,
      quads: quads.length,
    },
    points,
    quads,
  };
}

function buildPalmCoordinateMap(coordinateMap, regionData) {
  if (!regionData) {
    return coordinateMap;
  }

  const regionVertexIds = new Set(regionData.vertex_ids || []);
  const regionQuadIds = new Set(regionData.quad_ids || []);
  const regionQuads = regionQuadIds.size
    ? coordinateMap.quads.filter((quad) => regionQuadIds.has(quad.id))
    : coordinateMap.quads.filter((quad) => quad.vertexIds.some((vertexId) => regionVertexIds.has(vertexId)));
  const referencedPointIds = new Set(regionQuads.flatMap((quad) => quad.vertexIds));
  const pointIds = new Set([...regionVertexIds, ...referencedPointIds]);
  const points = coordinateMap.points.filter((point) => pointIds.has(point.id));

  if (!points.length || !regionQuads.length) {
    return {
      ...coordinateMap,
      schema: 'shroomLab.objRegularGridMap.v1',
      region: {
        name: 'loadedObjGrid',
        note: 'Front-hand vertex-id region did not match the loaded OBJ; exporting the loaded OBJ grid.',
      },
    };
  }

  return {
    ...coordinateMap,
    schema: 'shroomLab.objFrontHandPalmFingersGridMap.v1',
    region: {
      name: 'frontHandPalmFingers',
      source: FRONT_HAND_REGION_URL,
      csv: FRONT_HAND_REGION_CSV_URL,
      label: regionData.label,
      selectionRule: regionData.selection_rule,
      vertexBounds: regionData.vertex_bounds,
    },
    counts: {
      points: points.length,
      quads: regionQuads.length,
    },
    points,
    quads: regionQuads,
  };
}

function pointMatchesCoordinateFilter(point, filter) {
  return (
    point.x >= filter.xMin &&
    point.x <= filter.xMax &&
    point.y >= filter.yMin &&
    point.y <= filter.yMax &&
    point.z >= filter.zMin &&
    point.z <= filter.zMax
  );
}

function positionMatchesCoordinateFilter(x, y, z, filter) {
  return (
    x >= filter.xMin &&
    x <= filter.xMax &&
    y >= filter.yMin &&
    y <= filter.yMax &&
    z >= filter.zMin &&
    z <= filter.zMax
  );
}

function buildCoordinateFilteredMap(coordinateMap, filter) {
  const filteredQuads = coordinateMap.quads.filter((quad) => pointMatchesCoordinateFilter(quad.center, filter));
  const referencedPointIds = new Set(filteredQuads.flatMap((quad) => quad.vertexIds));
  const directPointIds = new Set(
    coordinateMap.points
      .filter((point) => pointMatchesCoordinateFilter(point, filter))
      .map((point) => point.id),
  );
  const pointIds = new Set([...directPointIds, ...referencedPointIds]);
  const points = coordinateMap.points.filter((point) => pointIds.has(point.id));

  return {
    ...coordinateMap,
    schema: 'shroomLab.objCoordinateFilteredGridMap.v1',
    filter,
    counts: {
      points: points.length,
      quads: filteredQuads.length,
    },
    points,
    quads: filteredQuads,
  };
}

function buildObjFaceGridGeometries(objText, edgeGranularity) {
  const granularity = normalizeEdgeGranularity(edgeGranularity);
  const vertices = [];
  const edges = [];
  const seenSourceEdges = new Set();

  objText.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('v ')) {
      const [, x, y, z] = trimmed.split(/\s+/);
      vertices.push([Number(x), Number(y), Number(z)]);
      return;
    }

    if (!trimmed.startsWith('f ')) {
      return;
    }

    const indices = trimmed
      .slice(2)
      .trim()
      .split(/\s+/)
      .map((token) => parseObjVertexIndex(token, vertices.length))
      .filter((index) => index !== null && vertices[index]);

    indices.forEach((startIndex, edgeIndex) => {
      const endIndex = indices[(edgeIndex + 1) % indices.length];
      const edgeKey = startIndex < endIndex ? `${startIndex}:${endIndex}` : `${endIndex}:${startIndex}`;

      if (seenSourceEdges.has(edgeKey)) {
        return;
      }

      seenSourceEdges.add(edgeKey);
      edges.push([startIndex, endIndex]);
    });
  });

  const linePositions = granularity === 1
    ? edges.flatMap(([startIndex, endIndex]) => [...vertices[startIndex], ...vertices[endIndex]])
    : buildCoarseEdgePositions(vertices, edges, granularity);
  const pointPositions = buildPointPositionsFromLines(linePositions);
  const lineGeometry = new THREE.BufferGeometry();
  const pointGeometry = new THREE.BufferGeometry();

  lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
  pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pointPositions, 3));
  setGeometryBaseColors(lineGeometry, new THREE.Color(DEFAULT_BASE_GRID_COLOR));
  setGeometryBaseColors(pointGeometry, new THREE.Color(DEFAULT_BASE_GRID_COLOR));

  return { lineGeometry, pointGeometry };
}

function buildCoarseEdgePositions(vertices, edges, granularity) {
  const box = new THREE.Box3();
  vertices.forEach(([x, y, z]) => {
    box.expandByPoint(new THREE.Vector3(x, y, z));
  });

  const size = box.getSize(new THREE.Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z) || 1;
  const divisions = Math.max(10, Math.round(96 / granularity));
  const cellSize = maxAxis / divisions;
  const clusters = new Map();

  const clusterKeyFor = ([x, y, z]) => {
    const cx = Math.round((x - box.min.x) / cellSize);
    const cy = Math.round((y - box.min.y) / cellSize);
    const cz = Math.round((z - box.min.z) / cellSize);
    return `${cx}:${cy}:${cz}`;
  };

  const vertexClusterKeys = vertices.map((vertex) => {
    const key = clusterKeyFor(vertex);
    const cluster = clusters.get(key) || { count: 0, x: 0, y: 0, z: 0 };
    cluster.count += 1;
    cluster.x += vertex[0];
    cluster.y += vertex[1];
    cluster.z += vertex[2];
    clusters.set(key, cluster);
    return key;
  });

  clusters.forEach((cluster) => {
    cluster.x /= cluster.count;
    cluster.y /= cluster.count;
    cluster.z /= cluster.count;
  });

  const linePositions = [];
  const seenCoarseEdges = new Set();

  edges.forEach(([startIndex, endIndex]) => {
    const startKey = vertexClusterKeys[startIndex];
    const endKey = vertexClusterKeys[endIndex];

    if (startKey === endKey) {
      return;
    }

    const edgeKey = startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`;
    if (seenCoarseEdges.has(edgeKey)) {
      return;
    }

    seenCoarseEdges.add(edgeKey);
    const start = clusters.get(startKey);
    const end = clusters.get(endKey);
    linePositions.push(start.x, start.y, start.z, end.x, end.y, end.z);
  });

  return linePositions;
}

function buildPointPositionsFromLines(linePositions) {
  const points = [];
  const seen = new Set();

  for (let i = 0; i < linePositions.length; i += 3) {
    const x = linePositions[i];
    const y = linePositions[i + 1];
    const z = linePositions[i + 2];
    const key = pointKeyForPosition(x, y, z);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    points.push(x, y, z);
  }

  return points;
}

function setGeometryBaseColors(geometry, color) {
  const position = geometry.attributes.position;
  const colors = [];

  for (let i = 0; i < position.count; i += 1) {
    colors.push(color.r, color.g, color.b);
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) {
      child.geometry.dispose();
    }

    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    }
  });
}

function normalizeModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z) || 1;

  model.position.sub(center);
  model.scale.setScalar(7.6 / maxAxis);
  model.rotation.set(0.1, -0.45, 2.25);
}

function vertexToHandSample(x, y, matrixSize) {
  const sourceRow = clamp01((HAND_MODEL_Y_MAX - y) / (HAND_MODEL_Y_MAX - HAND_MODEL_Y_MIN)) * (SOURCE_MATRIX_SIZE - 1);
  const sourceCol = clamp01((x - HAND_MODEL_X_MIN) / (HAND_MODEL_X_MAX - HAND_MODEL_X_MIN)) * (SOURCE_MATRIX_SIZE - 1);

  return {
    row: (sourceRow / (SOURCE_MATRIX_SIZE - 1)) * (matrixSize - 1),
    col: (sourceCol / (SOURCE_MATRIX_SIZE - 1)) * (matrixSize - 1),
  };
}

function setBaseVertexColors(model) {
  model.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position) {
      return;
    }

    const position = child.geometry.attributes.position;
    const colors = [];

    for (let i = 0; i < position.count; i += 1) {
      colors.push(BASE_SURFACE_COLOR.r, BASE_SURFACE_COLOR.g, BASE_SURFACE_COLOR.b);
    }

    child.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  });
}

function gridColorForPosition(x, y, z, pressureMatrix, showPressureData, selectedPointKeys, pressureStyle) {
  const matrixSize = pressureMatrix.length || SENSOR_MATRIX_SIZE;

  if (!showPressureData || !selectedPointKeys.has(pointKeyForPosition(x, y, z))) {
    return pressureStyle.baseColor;
  }

  const sample = vertexToHandSample(x, y, matrixSize);
  const pressure = clamp01(sampleMatrix(pressureMatrix, sample.row, sample.col) * pressureStyle.colorGain);

  return pressure > pressureStyle.cutoff ? colorForPressure(pressure, pressureStyle) : pressureStyle.baseColor;
}

function updatePressureGeometryColors(geometry, pressureMatrix, showPressureData, selectedPointKeys, pressureStyle) {
  const position = geometry.attributes.position;
  const colors = geometry.attributes.color;

  for (let i = 0; i < position.count; i += 1) {
    const color = gridColorForPosition(
      position.getX(i),
      position.getY(i),
      position.getZ(i),
      pressureMatrix,
      showPressureData,
      selectedPointKeys,
      pressureStyle,
    );
    colors.setXYZ(i, color.r, color.g, color.b);
  }

  colors.needsUpdate = true;
}

function updatePalmPressureGridColors(gridObjects, pressureMatrix, showPressureData, selectedPointKeys, pressureStyle) {
  if (!gridObjects) {
    return;
  }

  updatePressureGeometryColors(gridObjects.lineGeometry, pressureMatrix, showPressureData, selectedPointKeys, pressureStyle);
  updatePressureGeometryColors(gridObjects.pointGeometry, pressureMatrix, showPressureData, selectedPointKeys, pressureStyle);
}

function applyModelLook(model, faceGridGeometries, { showSurface, showWireframe }) {
  const surfaceMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0.04,
    vertexColors: true,
    transparent: true,
    opacity: showSurface ? 0.5 : 0,
    side: THREE.DoubleSide,
    depthWrite: showSurface,
  });
  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    opacity: showWireframe ? 0.95 : 0,
    depthTest: false,
    depthWrite: false,
  });
  const pointMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    opacity: showWireframe ? 0.95 : 0,
    size: 0.075,
    sizeAttenuation: true,
    depthTest: false,
    depthWrite: false,
  });

  model.traverse((child) => {
    if (!child.isMesh || !child.geometry) {
      return;
    }

    child.material = surfaceMaterial;
    child.castShadow = false;
    child.receiveShadow = false;
    child.frustumCulled = false;
  });

  setBaseVertexColors(model);

  const faceLines = new THREE.LineSegments(faceGridGeometries.lineGeometry, lineMaterial);
  const facePoints = new THREE.Points(faceGridGeometries.pointGeometry, pointMaterial);
  faceLines.renderOrder = 4;
  facePoints.renderOrder = 5;
  faceLines.frustumCulled = false;
  facePoints.frustumCulled = false;
  model.add(faceLines, facePoints);

  return () => {
    surfaceMaterial.dispose();
    lineMaterial.dispose();
    pointMaterial.dispose();
    faceGridGeometries.lineGeometry.dispose();
    faceGridGeometries.pointGeometry.dispose();
  };
}

export default function ObjModelPage({ onNavigate, videoPoints }) {
  const mountRef = useRef(null);
  const pressureStyleRef = useRef({
    colorGain: DEFAULT_PRESSURE_COLOR_GAIN,
    cutoff: DEFAULT_PRESSURE_COLOR_CUTOFF,
    baseColor: new THREE.Color(DEFAULT_BASE_GRID_COLOR),
    lowColor: new THREE.Color(DEFAULT_LOW_PRESSURE_COLOR),
    midColor: new THREE.Color(DEFAULT_MID_PRESSURE_COLOR),
    highColor: new THREE.Color(DEFAULT_HIGH_PRESSURE_COLOR),
  });
  const selectionModeRef = useRef(false);
  const selectionApiRef = useRef({
    clear: () => {},
    selectAll: () => {},
    applyCoordinateFilter: () => {},
  });
  const coordinateMapRef = useRef(null);
  const frontHandRegionRef = useRef(null);
  const [showSurface, setShowSurface] = useState(true);
  const [showWireframe, setShowWireframe] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [showPalmPressure, setShowPalmPressure] = useState(true);
  const [pressureColorGain, setPressureColorGain] = useState(DEFAULT_PRESSURE_COLOR_GAIN);
  const [pressureColorCutoff, setPressureColorCutoff] = useState(DEFAULT_PRESSURE_COLOR_CUTOFF);
  const [baseGridColor, setBaseGridColor] = useState(DEFAULT_BASE_GRID_COLOR);
  const [lowPressureColor, setLowPressureColor] = useState(DEFAULT_LOW_PRESSURE_COLOR);
  const [midPressureColor, setMidPressureColor] = useState(DEFAULT_MID_PRESSURE_COLOR);
  const [highPressureColor, setHighPressureColor] = useState(DEFAULT_HIGH_PRESSURE_COLOR);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const [selectionBox, setSelectionBox] = useState(null);
  const [mapCopyStatus, setMapCopyStatus] = useState('');
  const [coordinateFilter, setCoordinateFilter] = useState(DEFAULT_COORD_FILTER);
  const [showCoordinatePanel, setShowCoordinatePanel] = useState(true);
  const [edgeGranularity, setEdgeGranularity] = useState(1);
  const [modelNameInput, setModelNameInput] = useState(DEFAULT_OBJ_MODEL_NAME);
  const [activeModelName, setActiveModelName] = useState(DEFAULT_OBJ_MODEL_NAME);
  const activeModelUrl = buildObjModelUrl(activeModelName);

  useEffect(() => {
    pressureStyleRef.current = {
      colorGain: pressureColorGain,
      cutoff: pressureColorCutoff,
      baseColor: new THREE.Color(baseGridColor),
      lowColor: new THREE.Color(lowPressureColor),
      midColor: new THREE.Color(midPressureColor),
      highColor: new THREE.Color(highPressureColor),
    };
  }, [baseGridColor, highPressureColor, lowPressureColor, midPressureColor, pressureColorCutoff, pressureColorGain]);

  const updateEdgeGranularity = (event) => {
    setEdgeGranularity(Number(event.target.value));
  };

  const loadModelByName = (event) => {
    event.preventDefault();
    const nextModelName = normalizeObjModelName(modelNameInput);
    setModelNameInput(nextModelName);
    setActiveModelName(nextModelName);
  };

  const updateCoordinateFilter = (key, value) => {
    setCoordinateFilter((currentFilter) => {
      const nextFilter = {
        ...currentFilter,
        [key]: Number(value),
      };
      selectionApiRef.current.applyCoordinateFilter(nextFilter);
      return nextFilter;
    });
  };

  const copyCoordinateMap = async () => {
    if (!coordinateMapRef.current) {
      setMapCopyStatus('Not ready');
      return;
    }

    const copied = await writeClipboardText(JSON.stringify(coordinateMapRef.current, null, 2));
    setMapCopyStatus(copied ? 'Copied' : 'Copy blocked');
    window.setTimeout(() => setMapCopyStatus(''), 1400);
  };

  const copyPalmCoordinateMap = async () => {
    if (!coordinateMapRef.current) {
      setMapCopyStatus('Not ready');
      return;
    }

    const palmMap = buildPalmCoordinateMap(coordinateMapRef.current, frontHandRegionRef.current);
    const copied = await writeClipboardText(JSON.stringify(palmMap, null, 2));
    setMapCopyStatus(copied ? `${palmMap.counts.points}/${palmMap.counts.quads}` : 'Copy blocked');
    window.setTimeout(() => setMapCopyStatus(''), 1800);
  };

  const copyCoordinateFilteredMap = async () => {
    if (!coordinateMapRef.current) {
      setMapCopyStatus('Not ready');
      return;
    }

    const filteredMap = buildCoordinateFilteredMap(coordinateMapRef.current, coordinateFilter);
    const copied = await writeClipboardText(JSON.stringify(filteredMap, null, 2));
    setMapCopyStatus(copied ? `${filteredMap.counts.points}/${filteredMap.counts.quads}` : 'Copy blocked');
    window.setTimeout(() => setMapCopyStatus(''), 1800);
  };

  useEffect(() => {
    selectionModeRef.current = selectionMode;
  }, [selectionMode]);

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x071018, 12, 28);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
    camera.position.set(0, 0.4, 14);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.72;
    controls.minDistance = 6.4;
    controls.maxDistance = 18;
    controls.target.set(0, -0.15, 0);

    const rig = new THREE.Group();
    scene.add(rig);
    scene.add(new THREE.AmbientLight(0xc9fbff, 0.74));

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.86);
    keyLight.position.set(4.5, 6.5, 7);
    scene.add(keyLight);

    const rimLight = new THREE.PointLight(0x00fff7, 1.2, 16);
    rimLight.position.set(-3.5, 3.2, 4.5);
    scene.add(rimLight);

    const baseGrid = new THREE.GridHelper(9.5, 24, 0x22cdd6, 0x1b5061);
    baseGrid.position.y = -3.9;
    baseGrid.material.transparent = true;
    baseGrid.material.opacity = 0.26;
    scene.add(baseGrid);

    let model = null;
    let gridObjects = null;
    let disposeLook = () => {};
    let frameId;
    let disposed = false;
    const selectedPointKeys = new Set();
    const clock = new THREE.Clock();
    const projectedPoint = new THREE.Vector3();
    const worldPoint = new THREE.Vector3();
    const dragState = {
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
    };

    const updateSelectedCount = () => {
      setSelectedCount(selectedPointKeys.size);
    };

    const clearSelection = () => {
      selectedPointKeys.clear();
      updateSelectedCount();
    };

    const selectAllPoints = () => {
      if (!gridObjects) {
        return;
      }

      const position = gridObjects.pointGeometry.attributes.position;
      selectedPointKeys.clear();
      for (let i = 0; i < position.count; i += 1) {
        selectedPointKeys.add(pointKeyForPosition(position.getX(i), position.getY(i), position.getZ(i)));
      }
      updateSelectedCount();
    };

    const applyCoordinateFilter = (filter) => {
      if (!gridObjects) {
        return;
      }

      const position = gridObjects.pointGeometry.attributes.position;
      selectedPointKeys.clear();
      for (let i = 0; i < position.count; i += 1) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = position.getZ(i);
        if (positionMatchesCoordinateFilter(x, y, z, filter)) {
          selectedPointKeys.add(pointKeyForPosition(x, y, z));
        }
      }
      updateSelectedCount();
    };

    const selectPointsInRect = (selectionRect) => {
      if (!model || !gridObjects) {
        return;
      }

      const position = gridObjects.pointGeometry.attributes.position;
      const width = Math.max(mount.clientWidth, 1);
      const height = Math.max(mount.clientHeight, 1);

      model.updateMatrixWorld(true);
      for (let i = 0; i < position.count; i += 1) {
        worldPoint
          .set(position.getX(i), position.getY(i), position.getZ(i))
          .applyMatrix4(model.matrixWorld);
        projectedPoint.copy(worldPoint).project(camera);

        if (projectedPoint.z < -1 || projectedPoint.z > 1) {
          continue;
        }

        const x = (projectedPoint.x * 0.5 + 0.5) * width;
        const y = (-projectedPoint.y * 0.5 + 0.5) * height;
        if (
          x >= selectionRect.left &&
          x <= selectionRect.left + selectionRect.width &&
          y >= selectionRect.top &&
          y <= selectionRect.top + selectionRect.height
        ) {
          selectedPointKeys.add(pointKeyForPosition(position.getX(i), position.getY(i), position.getZ(i)));
        }
      }

      updateSelectedCount();
    };

    const pointerPosition = (event) => {
      const bounds = mount.getBoundingClientRect();
      return {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };
    };

    const setBoxFromDrag = (currentX, currentY) => {
      const left = Math.min(dragState.startX, currentX);
      const top = Math.min(dragState.startY, currentY);
      const width = Math.abs(currentX - dragState.startX);
      const height = Math.abs(currentY - dragState.startY);
      const box = { left, top, width, height };
      setSelectionBox(box);
      return box;
    };

    const finishSelectionDrag = (event) => {
      if (!dragState.active) {
        return;
      }

      const point = pointerPosition(event);
      const box = setBoxFromDrag(point.x, point.y);
      dragState.active = false;
      controls.enabled = true;
      setSelectionBox(null);

      if (dragState.pointerId !== null && mount.hasPointerCapture?.(dragState.pointerId)) {
        mount.releasePointerCapture(dragState.pointerId);
      }

      if (box.width >= SELECTION_MIN_DRAG_DISTANCE && box.height >= SELECTION_MIN_DRAG_DISTANCE) {
        selectPointsInRect(box);
      }
    };

    const onPointerDown = (event) => {
      if (!selectionModeRef.current || event.button !== 0) {
        return;
      }

      event.preventDefault();
      const point = pointerPosition(event);
      dragState.active = true;
      dragState.pointerId = event.pointerId;
      dragState.startX = point.x;
      dragState.startY = point.y;
      controls.enabled = false;
      mount.setPointerCapture?.(event.pointerId);
      setSelectionBox({ left: point.x, top: point.y, width: 0, height: 0 });
    };

    const onPointerMove = (event) => {
      if (!dragState.active) {
        return;
      }

      event.preventDefault();
      const point = pointerPosition(event);
      setBoxFromDrag(point.x, point.y);
    };

    const onPointerUp = (event) => {
      finishSelectionDrag(event);
    };

    const onPointerCancel = () => {
      if (!dragState.active) {
        return;
      }

      dragState.active = false;
      controls.enabled = true;
      setSelectionBox(null);
      if (dragState.pointerId !== null && mount.hasPointerCapture?.(dragState.pointerId)) {
        mount.releasePointerCapture(dragState.pointerId);
      }
    };

    selectionApiRef.current = {
      clear: clearSelection,
      selectAll: selectAllPoints,
      applyCoordinateFilter,
    };
    setSelectedCount(0);

    Promise.all([
      loadObjModel(activeModelUrl),
      fetchText(activeModelUrl),
      loadFrontHandRegion(),
    ]).then(
      ([loadedModel, objText, frontHandRegion]) => {
        if (disposed) {
          disposeObject(loadedModel);
          return;
        }

        model = loadedModel;
        frontHandRegionRef.current = frontHandRegion;
        coordinateMapRef.current = parseObjCoordinateMap(objText, activeModelUrl);
        gridObjects = buildObjFaceGridGeometries(objText, edgeGranularity);
        normalizeModel(model);
        disposeLook = applyModelLook(model, gridObjects, { showSurface, showWireframe });
        applyCoordinateFilter(coordinateFilter);
        rig.add(model);
        setMapCopyStatus('Loaded');
        window.setTimeout(() => setMapCopyStatus(''), 1200);
      },
      (error) => {
        console.error('Failed to load OBJ model:', error);
        setMapCopyStatus('Load failed');
      },
    );

    const resize = () => {
      const { clientWidth, clientHeight } = mount;
      const compact = clientWidth < 680;

      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / Math.max(clientHeight, 1);
      camera.position.set(0, compact ? 0.25 : 0.4, compact ? 16.2 : 14);
      camera.updateProjectionMatrix();
      rig.scale.setScalar(compact ? 0.72 : 1);
    };

    const animate = () => {
      controls.autoRotate = autoRotate;
      if (model) {
        const pressureMatrix = buildHandPressureFrame(clock.getElapsedTime(), {
          matrixSize: SENSOR_MATRIX_SIZE,
          gaussianKernelSize: DEFAULT_GAUSSIAN_KERNEL_SIZE,
          videoPoints,
        }).matrix;
        updatePalmPressureGridColors(
          gridObjects,
          pressureMatrix,
          showPalmPressure,
          selectedPointKeys,
          pressureStyleRef.current,
        );
      }
      controls.update();
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };

    resize();
    window.addEventListener('resize', resize);
    mount.addEventListener('pointerdown', onPointerDown);
    mount.addEventListener('pointermove', onPointerMove);
    mount.addEventListener('pointerup', onPointerUp);
    mount.addEventListener('pointercancel', onPointerCancel);
    animate();

    return () => {
      disposed = true;
      selectionApiRef.current = { clear: () => {}, selectAll: () => {}, applyCoordinateFilter: () => {} };
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resize);
      mount.removeEventListener('pointerdown', onPointerDown);
      mount.removeEventListener('pointermove', onPointerMove);
      mount.removeEventListener('pointerup', onPointerUp);
      mount.removeEventListener('pointercancel', onPointerCancel);
      controls.dispose();
      disposeLook();
      if (model) {
        disposeObject(model);
      }
      baseGrid.geometry.dispose();
      baseGrid.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [activeModelUrl, autoRotate, edgeGranularity, showPalmPressure, showSurface, showWireframe, videoPoints]);

  return (
    <main className="obj-model-page">
      <nav className="app-nav" aria-label="Page view">
        <button type="button" onClick={() => onNavigate('terrain')}>
          Pressure
        </button>
        <button type="button" onClick={() => onNavigate('hand')}>
          Wireframe
        </button>
        <button className="active" type="button" onClick={() => onNavigate('obj')}>
          OBJ
        </button>
        <button type="button" onClick={() => onNavigate('points')}>
          Points
        </button>
      </nav>

      <section className="obj-model-controls" aria-label="OBJ model controls">
        <form className="obj-model-loader" onSubmit={loadModelByName}>
          <label htmlFor="obj-model-name">Model</label>
          <input
            id="obj-model-name"
            type="text"
            value={modelNameInput}
            spellCheck="false"
            onChange={(event) => setModelNameInput(event.target.value)}
          />
          <button type="submit">Load</button>
        </form>
        <label className="obj-toggle-control">
          <input
            type="checkbox"
            checked={showSurface}
            onChange={(event) => setShowSurface(event.target.checked)}
          />
          <span>Surface</span>
        </label>
        <label className="obj-toggle-control">
          <input
            type="checkbox"
            checked={showWireframe}
            onChange={(event) => setShowWireframe(event.target.checked)}
          />
          <span>Edges</span>
        </label>
        <label className="obj-toggle-control">
          <input
            type="checkbox"
            checked={autoRotate}
            onChange={(event) => setAutoRotate(event.target.checked)}
          />
          <span>Rotate</span>
        </label>
        <label className="obj-toggle-control">
          <input
            type="checkbox"
            checked={showPalmPressure}
            onChange={(event) => setShowPalmPressure(event.target.checked)}
          />
          <span>Data</span>
        </label>
        <label className="obj-pressure-control">
          <span>Gain</span>
          <input
            type="range"
            min="0.5"
            max="10"
            step="0.1"
            value={pressureColorGain}
            onChange={(event) => setPressureColorGain(Number(event.target.value))}
            onInput={(event) => setPressureColorGain(Number(event.target.value))}
          />
          <strong>{pressureColorGain.toFixed(1)}</strong>
        </label>
        <label className="obj-pressure-control">
          <span>Cutoff</span>
          <input
            type="range"
            min="0"
            max="0.12"
            step="0.002"
            value={pressureColorCutoff}
            onChange={(event) => setPressureColorCutoff(Number(event.target.value))}
            onInput={(event) => setPressureColorCutoff(Number(event.target.value))}
          />
          <strong>{pressureColorCutoff.toFixed(3)}</strong>
        </label>
        <div className="obj-color-controls" aria-label="OBJ pressure colors">
          <label title="Base wire color">
            <span>Base</span>
            <input
              type="color"
              value={baseGridColor}
              onChange={(event) => setBaseGridColor(event.target.value)}
            />
          </label>
          <label title="Low pressure color">
            <span>Low</span>
            <input
              type="color"
              value={lowPressureColor}
              onChange={(event) => setLowPressureColor(event.target.value)}
            />
          </label>
          <label title="Mid pressure color">
            <span>Mid</span>
            <input
              type="color"
              value={midPressureColor}
              onChange={(event) => setMidPressureColor(event.target.value)}
            />
          </label>
          <label title="High pressure color">
            <span>High</span>
            <input
              type="color"
              value={highPressureColor}
              onChange={(event) => setHighPressureColor(event.target.value)}
            />
          </label>
        </div>
        <label className="obj-toggle-control">
          <input
            type="checkbox"
            checked={selectionMode}
            onChange={(event) => setSelectionMode(event.target.checked)}
          />
          <span>Select</span>
        </label>
        <button className="obj-action-control" type="button" onClick={() => selectionApiRef.current.clear()}>
          Clear
        </button>
        <button className="obj-action-control" type="button" onClick={() => selectionApiRef.current.selectAll()}>
          All
        </button>
        <button className="obj-action-control" type="button" onClick={copyPalmCoordinateMap}>
          Palm Map
        </button>
        <button className="obj-action-control" type="button" onClick={copyCoordinateMap}>
          Copy Map
        </button>
        <button className="obj-action-control" type="button" onClick={() => setShowCoordinatePanel((visible) => !visible)}>
          XYZ
        </button>
        <div className="obj-selection-status" aria-live="polite">
          {mapCopyStatus || selectedCount}
        </div>
        <label className="obj-grain-control">
          <span>Coarse</span>
          <input
            type="range"
            min={MIN_EDGE_GRANULARITY}
            max={MAX_EDGE_GRANULARITY}
            step="1"
            value={edgeGranularity}
            onChange={updateEdgeGranularity}
            onInput={updateEdgeGranularity}
          />
          <strong>{edgeGranularity}x</strong>
        </label>
      </section>

      {showCoordinatePanel ? (
        <section className="obj-coordinate-panel" aria-label="Coordinate filter">
          <div className="obj-coordinate-header">
            <span>XYZ Filter</span>
            <button type="button" onClick={copyCoordinateFilteredMap}>
              Copy XYZ
            </button>
          </div>
          {[
            ['x', HAND_MODEL_X_MIN, HAND_MODEL_X_MAX],
            ['y', HAND_MODEL_Y_MIN, HAND_MODEL_Y_MAX],
            ['z', HAND_MODEL_Z_MIN, HAND_MODEL_Z_MAX],
          ].map(([axis, min, max]) => {
            const minKey = `${axis}Min`;
            const maxKey = `${axis}Max`;
            const minValue = coordinateFilter[minKey];
            const maxValue = coordinateFilter[maxKey];

            return (
              <div className="obj-coordinate-row" key={axis}>
                <div className="obj-coordinate-label">
                  <strong>{axis.toUpperCase()}</strong>
                  <span>{minValue.toFixed(2)} .. {maxValue.toFixed(2)}</span>
                </div>
                <label>
                  <span>Min</span>
                  <input
                    aria-label={`${axis} min`}
                    max={maxValue}
                    min={min}
                    step="0.05"
                    type="range"
                    value={minValue}
                    onChange={(event) => updateCoordinateFilter(minKey, event.target.value)}
                    onInput={(event) => updateCoordinateFilter(minKey, event.target.value)}
                  />
                </label>
                <label>
                  <span>Max</span>
                  <input
                    aria-label={`${axis} max`}
                    max={max}
                    min={minValue}
                    step="0.05"
                    type="range"
                    value={maxValue}
                    onChange={(event) => updateCoordinateFilter(maxKey, event.target.value)}
                    onInput={(event) => updateCoordinateFilter(maxKey, event.target.value)}
                  />
                </label>
              </div>
            );
          })}
        </section>
      ) : null}

      <div className={`obj-model-canvas${selectionMode ? ' selecting' : ''}`} aria-label="Loaded OBJ hand model">
        <div className="obj-render-layer" ref={mountRef} />
        {selectionBox ? (
          <div
            className="obj-selection-box"
            style={{
              left: `${selectionBox.left}px`,
              top: `${selectionBox.top}px`,
              width: `${selectionBox.width}px`,
              height: `${selectionBox.height}px`,
            }}
          />
        ) : null}
      </div>
    </main>
  );
}
