import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  DEFAULT_GAUSSIAN_KERNEL_SIZE,
  SENSOR_MATRIX_SIZE,
  buildHandPressureFrame,
  buildHandRegionFrame,
} from './handPressureData.js';
import { DEFAULT_PRESSURE_PALETTE, PRESSURE_COLOR_STOPS } from './pressurePalette.js';

const TERRAIN_SIZE = 10.8;
const WIDTH = TERRAIN_SIZE;
const DEPTH = TERRAIN_SIZE;
const SURFACE_GRID_LIFT = 0.045;
const REGION_BASE_Y = -0.075;
const PRESSURE_CUTOFF = 0.012;
const GAUSSIAN_SAMPLE_BLEND = 0.46;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function gaussianWeight(distanceSquared, sigma) {
  return Math.exp(-distanceSquared / (2 * sigma * sigma));
}

function normalizeGaussianKernelSize(kernelSize) {
  const size = Number(kernelSize);
  if (!Number.isFinite(size)) {
    return DEFAULT_GAUSSIAN_KERNEL_SIZE;
  }

  const rounded = Math.max(1, Math.min(9, Math.round(size)));
  return rounded % 2 === 0 ? Math.max(1, rounded - 1) : rounded;
}

function matrixSizeOf(matrix) {
  return matrix.length || SENSOR_MATRIX_SIZE;
}

function worldToMatrix(x, z, matrixSize) {
  return {
    row: (z / DEPTH + 0.5) * (matrixSize - 1),
    col: (x / WIDTH + 0.5) * (matrixSize - 1),
  };
}

function matrixIndexToWorld(row, col, matrixSize) {
  return {
    x: (col / (matrixSize - 1) - 0.5) * WIDTH,
    z: (row / (matrixSize - 1) - 0.5) * DEPTH,
  };
}

function samplePressureMatrix(matrix, row, col) {
  const matrixSize = matrixSizeOf(matrix);
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

function sampleGaussianPressureMatrix(matrix, row, col, gaussianKernelSize) {
  const kernelSize = normalizeGaussianKernelSize(gaussianKernelSize);
  const radius = Math.floor(kernelSize / 2);
  const sigma = Math.max(0.65, kernelSize / 3.2);

  if (radius === 0) {
    return samplePressureMatrix(matrix, row, col);
  }

  let weightedPressure = 0;
  let totalWeight = 0;

  for (let rowOffset = -radius; rowOffset <= radius; rowOffset += 1) {
    for (let colOffset = -radius; colOffset <= radius; colOffset += 1) {
      const weight = gaussianWeight(rowOffset * rowOffset + colOffset * colOffset, sigma);
      weightedPressure += samplePressureMatrix(matrix, row + rowOffset, col + colOffset) * weight;
      totalWeight += weight;
    }
  }

  return totalWeight > 0 ? weightedPressure / totalWeight : samplePressureMatrix(matrix, row, col);
}

function pressureAt(x, z, pressureMatrix, gaussianKernelSize) {
  const matrixSize = matrixSizeOf(pressureMatrix);
  const { row, col } = worldToMatrix(x, z, matrixSize);
  const linearPressure = samplePressureMatrix(pressureMatrix, row, col);
  const gaussianPressure = sampleGaussianPressureMatrix(pressureMatrix, row, col, gaussianKernelSize);
  const pressure = lerp(linearPressure, gaussianPressure, GAUSSIAN_SAMPLE_BLEND);

  return pressure < PRESSURE_CUTOFF ? 0 : pressure;
}

function edgeFadeAt(x, z) {
  return Math.min(
    1,
    Math.max(0, (WIDTH * 0.5 - Math.abs(x)) * 0.95),
    Math.max(0, (DEPTH * 0.5 - Math.abs(z)) * 1.25),
  );
}

function surfaceHeightAt(x, z, pressureMatrix, heightScale, gaussianKernelSize) {
  return pressureAt(x, z, pressureMatrix, gaussianKernelSize) * heightScale * edgeFadeAt(x, z);
}

function buildColorStops(pressurePalette) {
  return PRESSURE_COLOR_STOPS.map((stop, index) => [
    stop.position,
    new THREE.Color(pressurePalette[index] || DEFAULT_PRESSURE_PALETTE[index]),
  ]);
}

function colorForPressure(value, colorDepth, stops) {
  const boosted = clamp01(value * colorDepth);

  for (let i = 1; i < stops.length; i += 1) {
    const [stop, color] = stops[i];
    const [prevStop, prevColor] = stops[i - 1];
    if (boosted <= stop) {
      const t = (boosted - prevStop) / (stop - prevStop);
      return prevColor.clone().lerp(color, clamp01(t));
    }
  }

  return stops[stops.length - 1][1].clone();
}

export function buildGeometry(matrixSize) {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const colors = [];

  for (let row = 0; row < matrixSize; row += 1) {
    for (let col = 0; col < matrixSize; col += 1) {
      const { x, z } = matrixIndexToWorld(row, col, matrixSize);
      positions.push(x, 0, z);
      colors.push(0, 1, 1);
    }
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex([]);
  geometry.computeVertexNormals();
  return geometry;
}

export function updateTerrain(geometry, pressureMatrix, heightScale, colorDepth, gaussianKernelSize, pressurePalette) {
  const matrixSize = matrixSizeOf(pressureMatrix);
  const positions = geometry.attributes.position;
  const colors = geometry.attributes.color;
  const vertexPressures = [];
  const indices = [];
  const colorStops = buildColorStops(pressurePalette);

  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const pressure = pressureAt(x, z, pressureMatrix, gaussianKernelSize);
    const y = pressure * heightScale * edgeFadeAt(x, z);
    const color = colorForPressure(pressure, colorDepth, colorStops);

    vertexPressures[i] = pressure;
    positions.setY(i, y);
    colors.setXYZ(i, color.r, color.g, color.b);
  }

  for (let row = 0; row < matrixSize - 1; row += 1) {
    for (let col = 0; col < matrixSize - 1; col += 1) {
      const a = row * matrixSize + col;
      const b = a + 1;
      const c = a + matrixSize;
      const d = c + 1;
      const hasPressure = Math.max(vertexPressures[a], vertexPressures[b], vertexPressures[c], vertexPressures[d]) > 0;

      if (hasPressure) {
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  geometry.setIndex(indices);
  positions.needsUpdate = true;
  colors.needsUpdate = true;
  geometry.computeVertexNormals();
}

export function buildSurfaceGridGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  return geometry;
}

function pointsSignature(sourcePoints = []) {
  return sourcePoints.map(([row, col]) => `${row}:${col}`).join('|');
}

function buildRegionBaseGeometry(matrixSize, sourcePoints) {
  const regionMatrix = buildHandRegionFrame(matrixSize, sourcePoints).matrix;
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const indices = [];
  const cellWidth = WIDTH / (matrixSize - 1);
  const cellDepth = DEPTH / (matrixSize - 1);
  const halfCellWidth = cellWidth * 0.44;
  const halfCellDepth = cellDepth * 0.44;

  for (let row = 0; row < matrixSize; row += 1) {
    for (let col = 0; col < matrixSize; col += 1) {
      if (!regionMatrix[row][col]) {
        continue;
      }

      const { x, z } = matrixIndexToWorld(row, col, matrixSize);
      const baseIndex = positions.length / 3;
      positions.push(
        x - halfCellWidth, REGION_BASE_Y, z - halfCellDepth,
        x + halfCellWidth, REGION_BASE_Y, z - halfCellDepth,
        x - halfCellWidth, REGION_BASE_Y, z + halfCellDepth,
        x + halfCellWidth, REGION_BASE_Y, z + halfCellDepth,
      );
      indices.push(baseIndex, baseIndex + 2, baseIndex + 1, baseIndex + 1, baseIndex + 2, baseIndex + 3);
    }
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function pushSurfacePoint(positions, row, col, pressureMatrix, heightScale, gaussianKernelSize) {
  const matrixSize = matrixSizeOf(pressureMatrix);
  const { x, z } = matrixIndexToWorld(row, col, matrixSize);
  const y = surfaceHeightAt(x, z, pressureMatrix, heightScale, gaussianKernelSize) + SURFACE_GRID_LIFT;
  positions.push(x, y, z);
}

export function updateSurfaceGrid(geometry, pressureMatrix, heightScale, gaussianKernelSize) {
  const matrixSize = matrixSizeOf(pressureMatrix);
  const positions = [];

  for (let row = 0; row < matrixSize; row += 1) {
    for (let col = 0; col < matrixSize - 1; col += 1) {
      const a = matrixIndexToWorld(row, col, matrixSize);
      const b = matrixIndexToWorld(row, col + 1, matrixSize);
      if (pressureAt(a.x, a.z, pressureMatrix, gaussianKernelSize) > 0 && pressureAt(b.x, b.z, pressureMatrix, gaussianKernelSize) > 0) {
        pushSurfacePoint(positions, row, col, pressureMatrix, heightScale, gaussianKernelSize);
        pushSurfacePoint(positions, row, col + 1, pressureMatrix, heightScale, gaussianKernelSize);
      }
    }
  }

  for (let col = 0; col < matrixSize; col += 1) {
    for (let row = 0; row < matrixSize - 1; row += 1) {
      const a = matrixIndexToWorld(row, col, matrixSize);
      const b = matrixIndexToWorld(row + 1, col, matrixSize);
      if (pressureAt(a.x, a.z, pressureMatrix, gaussianKernelSize) > 0 && pressureAt(b.x, b.z, pressureMatrix, gaussianKernelSize) > 0) {
        pushSurfacePoint(positions, row, col, pressureMatrix, heightScale, gaussianKernelSize);
        pushSurfacePoint(positions, row + 1, col, pressureMatrix, heightScale, gaussianKernelSize);
      }
    }
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
}

function buildPressureMatrix(time, matrixSize, gaussianKernelSize, sourcePoints) {
  return buildHandPressureFrame(time, { matrixSize, gaussianKernelSize, sourcePoints }).matrix;
}

function makeBasePlate() {
  const shape = new THREE.Shape();
  const x = WIDTH * 0.56;
  const z = DEPTH * 0.56;
  shape.moveTo(-x, -z);
  shape.lineTo(x, -z);
  shape.lineTo(x, z);
  shape.lineTo(-x, z);
  shape.lineTo(-x, -z);

  const geometry = new THREE.ShapeGeometry(shape);
  const material = new THREE.MeshBasicMaterial({
    color: 0x17323d,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.14;

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0x58d5f0, transparent: true, opacity: 0.34 }),
  );
  edge.rotation.x = -Math.PI / 2;
  edge.position.y = -0.13;

  const group = new THREE.Group();
  group.add(mesh, edge);
  return group;
}

export default function PressureTerrain({
  heightScale = 1.85,
  colorDepth = 1.25,
  matrixSize = SENSOR_MATRIX_SIZE,
  gaussianKernelSize = DEFAULT_GAUSSIAN_KERNEL_SIZE,
  pressurePalette = DEFAULT_PRESSURE_PALETTE,
  sourcePoints,
}) {
  const mountRef = useRef(null);
  const settingsRef = useRef({
    heightScale,
    colorDepth,
    matrixSize,
    gaussianKernelSize,
    pressurePalette,
    sourcePoints,
    sourcePointsSignature: pointsSignature(sourcePoints),
  });

  useEffect(() => {
    settingsRef.current = {
      heightScale,
      colorDepth,
      matrixSize,
      gaussianKernelSize,
      pressurePalette,
      sourcePoints,
      sourcePointsSignature: pointsSignature(sourcePoints),
    };
  }, [colorDepth, gaussianKernelSize, heightScale, matrixSize, pressurePalette, sourcePoints]);

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x071018, 10, 26);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 80);
    camera.position.set(8.6, 6.2, 11.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 7;
    controls.maxDistance = 18;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.target.set(0, 0.55, 0);

    scene.add(new THREE.AmbientLight(0x8deeff, 0.58));

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.38);
    keyLight.position.set(-4, 7, 5);
    scene.add(keyLight);

    const heatLight = new THREE.PointLight(0xff7848, 0.54, 9);
    heatLight.position.set(0.6, 3.9, -2.6);
    scene.add(heatLight);

    const coolLight = new THREE.PointLight(0x32e7ff, 0.38, 12);
    coolLight.position.set(-3.5, 2.2, 2.5);
    scene.add(coolLight);

    scene.add(makeBasePlate());

    let currentRegionSignature = settingsRef.current.sourcePointsSignature;
    const regionBaseGeometry = buildRegionBaseGeometry(matrixSize, settingsRef.current.sourcePoints);
    const regionBaseMaterial = new THREE.MeshBasicMaterial({
      color: 0x00f0d8,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const regionBase = new THREE.Mesh(regionBaseGeometry, regionBaseMaterial);
    scene.add(regionBase);

    const geometry = buildGeometry(matrixSize);
    const initialSettings = settingsRef.current;
    const initialPressureMatrix = buildPressureMatrix(
      0,
      matrixSize,
      initialSettings.gaussianKernelSize,
      initialSettings.sourcePoints,
    );
    updateTerrain(
      geometry,
      initialPressureMatrix,
      initialSettings.heightScale,
      initialSettings.colorDepth,
      initialSettings.gaussianKernelSize,
      initialSettings.pressurePalette,
    );

    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    const terrain = new THREE.Mesh(geometry, material);
    scene.add(terrain);

    const surfaceGridGeometry = buildSurfaceGridGeometry();
    updateSurfaceGrid(surfaceGridGeometry, initialPressureMatrix, initialSettings.heightScale, initialSettings.gaussianKernelSize);
    const surfaceGridMaterial = new THREE.LineBasicMaterial({
      color: 0xbffcff,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const surfaceGrid = new THREE.LineSegments(surfaceGridGeometry, surfaceGridMaterial);
    scene.add(surfaceGrid);

    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x43f5ff,
      transparent: true,
      opacity: 0.025,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(geometry, glowMaterial);
    glow.scale.set(1.012, 1.05, 1.012);
    scene.add(glow);

    let frameId;
    const clock = new THREE.Clock();

    const resize = () => {
      const { clientWidth, clientHeight } = mount;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / Math.max(clientHeight, 1);
      camera.updateProjectionMatrix();
    };

    const animate = () => {
      const elapsed = clock.getElapsedTime();
      const currentSettings = settingsRef.current;

      if (currentSettings.sourcePointsSignature !== currentRegionSignature) {
        const nextGeometry = buildRegionBaseGeometry(matrixSize, currentSettings.sourcePoints);
        regionBase.geometry.dispose();
        regionBase.geometry = nextGeometry;
        currentRegionSignature = currentSettings.sourcePointsSignature;
      }

      const pressureMatrix = buildPressureMatrix(
        elapsed,
        matrixSize,
        currentSettings.gaussianKernelSize,
        currentSettings.sourcePoints,
      );
      updateTerrain(
        geometry,
        pressureMatrix,
        currentSettings.heightScale,
        currentSettings.colorDepth,
        currentSettings.gaussianKernelSize,
        currentSettings.pressurePalette,
      );
      updateSurfaceGrid(surfaceGridGeometry, pressureMatrix, currentSettings.heightScale, currentSettings.gaussianKernelSize);
      heatLight.intensity = 0.5 + Math.sin(elapsed * 1.2) * 0.06;
      coolLight.intensity = 0.34 + Math.cos(elapsed * 0.9) * 0.05;
      controls.update();
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };

    resize();
    window.addEventListener('resize', resize);
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resize);
      controls.dispose();
      regionBase.geometry.dispose();
      regionBaseMaterial.dispose();
      geometry.dispose();
      surfaceGridGeometry.dispose();
      material.dispose();
      surfaceGridMaterial.dispose();
      glowMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [matrixSize]);

  return <div className="terrain-canvas" ref={mountRef} aria-label="Animated 3D pressure terrain" />;
}
