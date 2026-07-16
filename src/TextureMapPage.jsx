import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  DEFAULT_GAUSSIAN_KERNEL_SIZE,
  SENSOR_MATRIX_SIZE,
  buildHandPressureFrame,
} from './handPressureData.js';
import {
  DEFAULT_PRESSURE_PALETTE,
  PRESSURE_COLOR_STOPS,
} from './pressurePalette.js';

const MODEL_URL = '/model/hand0423g_cyan_tube_wireframe.glb';
const TEXTURE_SIZE = 256;
const VERTEX_PRESSURE_GAIN = 4.8;
const VERTEX_PRESSURE_CUTOFF = 0.006;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function colorForPressure(value, colorDepth, palette) {
  const pressure = clamp01(value * colorDepth);

  for (let i = 1; i < PRESSURE_COLOR_STOPS.length; i += 1) {
    const stop = PRESSURE_COLOR_STOPS[i];
    const previousStop = PRESSURE_COLOR_STOPS[i - 1];
    if (pressure <= stop.position) {
      const t = (pressure - previousStop.position) / (stop.position - previousStop.position);
      return new THREE.Color(palette[i - 1] || DEFAULT_PRESSURE_PALETTE[i - 1])
        .lerp(new THREE.Color(palette[i] || DEFAULT_PRESSURE_PALETTE[i]), clamp01(t));
    }
  }

  return new THREE.Color(palette[palette.length - 1] || DEFAULT_PRESSURE_PALETTE[DEFAULT_PRESSURE_PALETTE.length - 1]);
}

function makePressureTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;

  return { canvas, context: canvas.getContext('2d'), texture };
}

function paintPressureTexture(context, matrix, colorDepth, palette) {
  const matrixSize = matrix.length || SENSOR_MATRIX_SIZE;
  const cellSize = TEXTURE_SIZE / matrixSize;
  context.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  context.fillStyle = '#062a33';
  context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  for (let row = 0; row < matrixSize; row += 1) {
    for (let col = 0; col < matrixSize; col += 1) {
      const pressure = matrix[row][col];
      const color = colorForPressure(pressure, colorDepth, palette);
      const alpha = pressure > 0 ? 0.5 + clamp01(pressure * colorDepth) * 0.5 : 0.18;

      context.fillStyle = `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${alpha})`;
      context.fillRect(col * cellSize, row * cellSize, Math.ceil(cellSize) + 0.5, Math.ceil(cellSize) + 0.5);
    }
  }
}

function samplePressureMatrix(matrix, row, col) {
  const matrixSize = matrix.length || SENSOR_MATRIX_SIZE;
  const clampedRow = Math.max(0, Math.min(matrixSize - 1, row));
  const clampedCol = Math.max(0, Math.min(matrixSize - 1, col));
  const row0 = Math.floor(clampedRow);
  const col0 = Math.floor(clampedCol);
  const row1 = Math.min(matrixSize - 1, row0 + 1);
  const col1 = Math.min(matrixSize - 1, col0 + 1);
  const rowT = clampedRow - row0;
  const colT = clampedCol - col0;
  const top = matrix[row0][col0] + (matrix[row0][col1] - matrix[row0][col0]) * colT;
  const bottom = matrix[row1][col0] + (matrix[row1][col1] - matrix[row1][col0]) * colT;

  return top + (bottom - top) * rowT;
}

function initializeVertexColors(geometry) {
  const position = geometry.attributes.position;
  const colors = [];
  const baseColor = new THREE.Color(0x0c5b66);

  for (let i = 0; i < position.count; i += 1) {
    colors.push(baseColor.r, baseColor.g, baseColor.b);
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

function updatePressureVertexColors(geometry, matrix, colorDepth, palette, fallbackPressure = 0) {
  const uv = geometry.attributes.uv;
  const colors = geometry.attributes.color;
  const matrixSize = matrix.length || SENSOR_MATRIX_SIZE;
  const baseColor = new THREE.Color(0x0c5b66);

  if (!uv || !colors) {
    return;
  }

  for (let i = 0; i < uv.count; i += 1) {
    const row = uv.getY(i) * (matrixSize - 1);
    const col = uv.getX(i) * (matrixSize - 1);
    const pressure = Math.max(samplePressureMatrix(matrix, row, col), fallbackPressure);
    const boosted = clamp01(pressure * VERTEX_PRESSURE_GAIN);
    const color = boosted > VERTEX_PRESSURE_CUTOFF
      ? colorForPressure(boosted, colorDepth, palette)
      : baseColor;

    colors.setXYZ(i, color.r, color.g, color.b);
  }

  colors.needsUpdate = true;
}

function applyGeometryPlanarPressureUv(geometry) {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const size = bounds.getSize(new THREE.Vector3());
  const position = geometry.attributes.position;
  const uvs = [];

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    uvs.push(
      size.x > 0 ? clamp01((x - bounds.min.x) / size.x) : 0.5,
      size.y > 0 ? clamp01(1 - (y - bounds.min.y) / size.y) : 0.5,
    );
  }

  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
}

function normalizeGeometryMesh(mesh) {
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = 4.8 / (Math.max(size.x, size.y, size.z) || 1);

  mesh.geometry.translate(-center.x, -center.y, -center.z);
  mesh.scale.setScalar(scale);
  mesh.rotation.set(0.1, -0.45, 2.25);
  mesh.frustumCulled = false;
}

function buildSampledPointGeometry(sourceGeometry, stride = 8) {
  const sourcePosition = sourceGeometry.attributes.position;
  const sourceUv = sourceGeometry.attributes.uv;
  const positions = [];
  const uvs = [];

  for (let i = 0; i < sourcePosition.count; i += stride) {
    positions.push(sourcePosition.getX(i), sourcePosition.getY(i), sourcePosition.getZ(i));
    if (sourceUv) {
      uvs.push(sourceUv.getX(i), sourceUv.getY(i));
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (uvs.length) {
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  }
  initializeVertexColors(geometry);
  geometry.computeBoundingSphere();
  return geometry;
}

function buildSampledTriangleGeometry(sourceGeometry, triangleStride = 10) {
  const sourcePosition = sourceGeometry.attributes.position;
  const sourceIndex = sourceGeometry.index;
  const positions = [];
  const triangleCount = sourceIndex
    ? Math.floor(sourceIndex.count / 3)
    : Math.floor(sourcePosition.count / 3);

  const vertexIndexAt = (triangleIndex, cornerIndex) => {
    const index = triangleIndex * 3 + cornerIndex;
    return sourceIndex ? sourceIndex.getX(index) : index;
  };

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += triangleStride) {
    for (let cornerIndex = 0; cornerIndex < 3; cornerIndex += 1) {
      const vertexIndex = vertexIndexAt(triangleIndex, cornerIndex);
      positions.push(
        sourcePosition.getX(vertexIndex),
        sourcePosition.getY(vertexIndex),
        sourcePosition.getZ(vertexIndex),
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function buildTriangleLineGeometry(sourceGeometry) {
  const position = sourceGeometry.attributes.position;
  const uv = sourceGeometry.attributes.uv;
  const lines = [];
  const uvs = [];

  for (let i = 0; i < position.count; i += 3) {
    const ax = position.getX(i);
    const ay = position.getY(i);
    const az = position.getZ(i);
    const bx = position.getX(i + 1);
    const by = position.getY(i + 1);
    const bz = position.getZ(i + 1);
    const cx = position.getX(i + 2);
    const cy = position.getY(i + 2);
    const cz = position.getZ(i + 2);

    lines.push(
      ax, ay, az, bx, by, bz,
      bx, by, bz, cx, cy, cz,
      cx, cy, cz, ax, ay, az,
    );

    if (uv) {
      const au = uv.getX(i);
      const av = uv.getY(i);
      const bu = uv.getX(i + 1);
      const bv = uv.getY(i + 1);
      const cu = uv.getX(i + 2);
      const cv = uv.getY(i + 2);

      uvs.push(
        au, av, bu, bv,
        bu, bv, cu, cv,
        cu, cv, au, av,
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  if (uvs.length) {
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  }
  initializeVertexColors(geometry);
  geometry.computeBoundingSphere();
  return geometry;
}

function applyTextureLook(model, texture, opacity, showWire) {
  const materials = [];

  model.traverse((child) => {
    if (!child.isMesh) {
      return;
    }

    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: texture,
      vertexColors: THREE.VertexColors,
      transparent: true,
      opacity: Math.min(opacity, 0.92),
      wireframe: false,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
    });

    child.material = material;
    child.renderOrder = 4;
    materials.push(material);
  });

  return {
    setOpacity(nextOpacity) {
      materials.forEach((material) => {
        material.opacity = Math.min(nextOpacity, 0.92);
        material.needsUpdate = true;
      });
    },
    setWireframe() {
      materials.forEach((material) => {
        material.wireframe = false;
        material.needsUpdate = true;
      });
    },
    dispose() {
      materials.forEach((material) => material.dispose());
    },
  };
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.filter(Boolean).forEach((material) => material.dispose());
  });
}

export default function TextureMapPage({ onNavigate, dataSource, sourcePoints, videoPoints, pressurePalette }) {
  const mountRef = useRef(null);
  const modelLookRef = useRef(null);
  const pointOverlayRef = useRef(null);
  const lineOverlayRef = useRef(null);
  const dataSourceRef = useRef(dataSource);
  const settingsRef = useRef({
    autoRotate: false,
    colorDepth: 2.4,
    opacity: 0.82,
    showWire: true,
    sourcePoints,
    videoPoints,
    pressurePalette,
  });
  const [autoRotate, setAutoRotate] = useState(false);
  const [showWire, setShowWire] = useState(true);
  const [colorDepth, setColorDepth] = useState(2.4);
  const [opacity, setOpacity] = useState(0.82);
  const [loadState, setLoadState] = useState('Loading');
  const [readout, setReadout] = useState({ source: 'SIM', peak: 0, frameAge: 'none' });

  useEffect(() => {
    dataSourceRef.current = dataSource;
  }, [dataSource]);

  useEffect(() => {
    settingsRef.current = {
      autoRotate,
      colorDepth,
      opacity,
      showWire,
      sourcePoints,
      videoPoints,
      pressurePalette,
    };
    modelLookRef.current?.setOpacity(opacity);
    modelLookRef.current?.setWireframe(showWire);
    if (pointOverlayRef.current) {
      pointOverlayRef.current.visible = showWire;
    }
    if (lineOverlayRef.current) {
      lineOverlayRef.current.visible = showWire;
    }
  }, [autoRotate, colorDepth, opacity, pressurePalette, showWire, sourcePoints, videoPoints]);

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x061018, 11, 28);
    const { context, texture } = makePressureTexture();

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
    camera.position.set(0, 0.36, 14.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.autoRotateSpeed = 0.66;
    controls.minDistance = 6.4;
    controls.maxDistance = 18;
    controls.target.set(0, -0.15, 0);

    const rig = new THREE.Group();
    scene.add(rig);
    scene.add(new THREE.HemisphereLight(0xc9ffff, 0x061018, 1.08));

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.94);
    keyLight.position.set(-4, 6.4, 7);
    scene.add(keyLight);

    const rimLight = new THREE.PointLight(0x00fff7, 1.45, 18);
    rimLight.position.set(4.2, 2.2, -4.5);
    scene.add(rimLight);

    const heatLight = new THREE.PointLight(0xff6a3d, 1.05, 12);
    heatLight.position.set(-2.8, 2.8, 4);
    scene.add(heatLight);

    const grid = new THREE.GridHelper(10, 26, 0x1edee6, 0x123b4b);
    grid.position.y = -3.9;
    grid.material.transparent = true;
    grid.material.opacity = 0.2;
    scene.add(grid);

    let model = null;
    let frameId = 0;
    let disposed = false;
    let lastReadoutAt = 0;
    const clock = new THREE.Clock();

    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }

        let sourceMesh = null;
        gltf.scene.traverse((child) => {
          if (!sourceMesh && child.isMesh && child.geometry?.attributes?.position) {
            sourceMesh = child;
          }
        });

        if (!sourceMesh) {
          setLoadState('No mesh');
          disposeObject(gltf.scene);
          return;
        }

        const geometry = buildSampledTriangleGeometry(sourceMesh.geometry, 20);
        applyGeometryPlanarPressureUv(geometry);
        initializeVertexColors(geometry);
        model = new THREE.Mesh(geometry);
        normalizeGeometryMesh(model);
        modelLookRef.current = applyTextureLook(
          model,
          texture,
          settingsRef.current.opacity,
          settingsRef.current.showWire,
        );
        const pointGeometry = buildSampledPointGeometry(geometry, 8);
        const pointOverlay = new THREE.Points(
          pointGeometry,
          new THREE.PointsMaterial({
            color: 0xffffff,
            vertexColors: THREE.VertexColors,
            size: 0.075,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.95,
            depthWrite: false,
          }),
        );
        pointOverlay.renderOrder = 7;
        pointOverlay.frustumCulled = false;
        pointOverlay.visible = settingsRef.current.showWire;
        pointOverlay.position.copy(model.position);
        pointOverlay.rotation.copy(model.rotation);
        pointOverlay.scale.copy(model.scale);
        pointOverlayRef.current = pointOverlay;

        const lineOverlay = new THREE.LineSegments(
          buildTriangleLineGeometry(geometry),
          new THREE.LineBasicMaterial({
            color: 0xffffff,
            vertexColors: THREE.VertexColors,
            transparent: true,
            opacity: 0.82,
            depthWrite: false,
          }),
        );
        lineOverlay.renderOrder = 8;
        lineOverlay.frustumCulled = false;
        lineOverlay.visible = settingsRef.current.showWire;
        lineOverlay.position.copy(model.position);
        lineOverlay.rotation.copy(model.rotation);
        lineOverlay.scale.copy(model.scale);
        lineOverlayRef.current = lineOverlay;

        rig.add(model, pointOverlay, lineOverlay);

        setLoadState('1 mesh / texture');
        disposeObject(gltf.scene);
      },
      undefined,
      (error) => {
        console.error('Failed to load texture map GLB:', error);
        if (!disposed) setLoadState('Load failed');
      },
    );

    const resize = () => {
      const { clientWidth, clientHeight } = mount;
      const compact = clientWidth < 680;

      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / Math.max(clientHeight, 1);
      camera.position.set(0, compact ? 0.15 : 0.36, compact ? 16.6 : 14.2);
      camera.updateProjectionMatrix();
      rig.scale.setScalar(compact ? 0.74 : 1);
      rig.position.set(compact ? -0.16 : 0, compact ? 0.12 : 0, 0);
    };

    const animate = () => {
      const elapsed = clock.getElapsedTime();
      const currentSettings = settingsRef.current;
      const frame = buildHandPressureFrame(elapsed, {
        matrixSize: SENSOR_MATRIX_SIZE,
        gaussianKernelSize: DEFAULT_GAUSSIAN_KERNEL_SIZE,
        sourcePoints: currentSettings.sourcePoints,
        videoPoints: currentSettings.videoPoints,
      });
      const peak = frame.points.reduce((max, point) => Math.max(max, point.value), 0);
      const fallbackPressure = peak * 0.16;
      paintPressureTexture(context, frame.matrix, currentSettings.colorDepth, currentSettings.pressurePalette);
      if (model?.geometry) {
        updatePressureVertexColors(
          model.geometry,
          frame.matrix,
          currentSettings.colorDepth,
          currentSettings.pressurePalette,
          fallbackPressure,
        );
      }
      if (pointOverlayRef.current?.geometry) {
        updatePressureVertexColors(
          pointOverlayRef.current.geometry,
          frame.matrix,
          currentSettings.colorDepth,
          currentSettings.pressurePalette,
          fallbackPressure,
        );
      }
      if (lineOverlayRef.current?.geometry) {
        updatePressureVertexColors(
          lineOverlayRef.current.geometry,
          frame.matrix,
          currentSettings.colorDepth,
          currentSettings.pressurePalette,
          fallbackPressure,
        );
      }
      texture.needsUpdate = true;
      controls.autoRotate = currentSettings.autoRotate;
      heatLight.intensity = 0.86 + Math.sin(elapsed * 1.15) * 0.12;
      controls.update();
      renderer.render(scene, camera);

      if (performance.now() - lastReadoutAt > 240) {
        lastReadoutAt = performance.now();
        const snapshot = dataSourceRef.current?.snapshot;
        setReadout({
          source: snapshot ? (snapshot.source === 'manual' ? 'MANUAL' : 'LIVE') : 'SIM',
          peak,
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
      pointOverlayRef.current?.geometry?.dispose();
      pointOverlayRef.current?.material?.dispose();
      pointOverlayRef.current = null;
      lineOverlayRef.current?.geometry?.dispose();
      lineOverlayRef.current?.material?.dispose();
      lineOverlayRef.current = null;
      modelLookRef.current?.dispose();
      modelLookRef.current = null;
      if (model) {
        model.geometry.dispose();
      }
      grid.geometry.dispose();
      grid.material.dispose();
      texture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <main className="texture-map-page">
      <nav className="app-nav" style={{ '--nav-count': 6 }} aria-label="Page view">
        <button type="button" onClick={() => onNavigate('terrain')}>Pressure</button>
        <button className="active" type="button" onClick={() => onNavigate('texture')}>Texture</button>
        <button type="button" onClick={() => onNavigate('hand')}>Wireframe</button>
        <button type="button" onClick={() => onNavigate('obj')}>OBJ</button>
        <button type="button" onClick={() => onNavigate('bones')}>Bones</button>
        <button type="button" onClick={() => onNavigate('points')}>Points</button>
      </nav>

      <header className="texture-map-title">
        <span>Texture Map</span>
        <h1>Pressure Texture on GLB</h1>
        <p>{MODEL_URL} / {loadState}</p>
      </header>

      <section className="texture-map-panel" aria-label="Texture map controls">
        <div className="texture-map-status">
          <strong className={readout.source !== 'SIM' ? 'online' : ''}>{readout.source}</strong>
          <span>{dataSource?.status.connected ? 'WS connected' : dataSource?.status.connecting ? 'Connecting' : 'Simulation'}</span>
        </div>

        <div className="texture-side-toggle" role="group" aria-label="Active hand side">
          {['left', 'right'].map((side) => (
            <button
              key={side}
              className={dataSource?.activeHandSide === side ? 'active' : ''}
              type="button"
              onClick={() => dataSource?.setActiveHandSide(side)}
            >
              {side}
            </button>
          ))}
        </div>

        <div className="texture-map-actions">
          <button type="button" onClick={dataSource?.connect} disabled={!dataSource?.status.supported || dataSource?.status.connected || dataSource?.status.connecting}>
            {dataSource?.status.connecting ? 'Connecting' : 'Connect WS'}
          </button>
          <button type="button" onClick={dataSource?.disconnect} disabled={!dataSource?.status.connected && !dataSource?.status.connecting}>
            Stop
          </button>
        </div>

        <label className="texture-toggle-control">
          <input
            type="checkbox"
            checked={showWire}
            onChange={(event) => setShowWire(event.target.checked)}
          />
          <span>Wire</span>
        </label>
        <label className="texture-toggle-control">
          <input
            type="checkbox"
            checked={autoRotate}
            onChange={(event) => setAutoRotate(event.target.checked)}
          />
          <span>Rotate</span>
        </label>

        <label className="texture-range-control">
          <span>Color</span>
          <input
            type="range"
            min="0.1"
            max="12"
            step="0.1"
            value={colorDepth}
            onChange={(event) => setColorDepth(Number(event.target.value))}
            onInput={(event) => setColorDepth(Number(event.target.value))}
          />
          <strong>{colorDepth.toFixed(1)}</strong>
        </label>

        <label className="texture-range-control">
          <span>Opacity</span>
          <input
            type="range"
            min="0.18"
            max="1"
            step="0.02"
            value={opacity}
            onChange={(event) => setOpacity(Number(event.target.value))}
            onInput={(event) => setOpacity(Number(event.target.value))}
          />
          <strong>{opacity.toFixed(2)}</strong>
        </label>

        <dl className="texture-map-readout">
          <div>
            <dt>Frame</dt>
            <dd>{readout.frameAge}</dd>
          </div>
          <div>
            <dt>Peak</dt>
            <dd>{Math.round(readout.peak * 255)}</dd>
          </div>
        </dl>
      </section>

      <div className="texture-map-canvas" ref={mountRef} aria-label="Pressure texture mapped hand model" />
    </main>
  );
}
