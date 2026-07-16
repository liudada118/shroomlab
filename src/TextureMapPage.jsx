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
  context.fillStyle = '#0bb8c8';
  context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  for (let row = 0; row < matrixSize; row += 1) {
    for (let col = 0; col < matrixSize; col += 1) {
      const pressure = matrix[row][col];
      const color = colorForPressure(pressure, colorDepth, palette);
      const alpha = pressure > 0 ? 0.46 + clamp01(pressure * colorDepth) * 0.54 : 0.28;

      context.fillStyle = `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${alpha})`;
      context.fillRect(col * cellSize, row * cellSize, Math.ceil(cellSize) + 0.5, Math.ceil(cellSize) + 0.5);
    }
  }
}

function normalizeModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = 7.8 / (Math.max(size.x, size.y, size.z) || 1);

  model.scale.setScalar(scale);
  model.position.copy(center).multiplyScalar(-scale);
  model.rotation.set(0.1, -0.45, 2.25);
  model.updateMatrixWorld(true);

  const finalCenter = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
  model.position.sub(finalCenter);
}

function modelBoundsFromMeshes(model) {
  const box = new THREE.Box3();
  const rootInverse = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const vertex = new THREE.Vector3();

  model.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position) {
      return;
    }

    const position = child.geometry.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      vertex
        .set(position.getX(i), position.getY(i), position.getZ(i))
        .applyMatrix4(child.matrixWorld)
        .applyMatrix4(rootInverse);
      box.expandByPoint(vertex);
    }
  });

  return box;
}

function applyPlanarPressureUv(model) {
  model.updateMatrixWorld(true);
  const bounds = modelBoundsFromMeshes(model);
  const size = bounds.getSize(new THREE.Vector3());
  const rootInverse = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const vertex = new THREE.Vector3();
  const uv = new THREE.Vector2();
  const createdGeometries = [];

  model.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position) {
      return;
    }

    const geometry = child.geometry.clone();
    const position = geometry.attributes.position;
    const uvs = [];

    for (let i = 0; i < position.count; i += 1) {
      vertex
        .set(position.getX(i), position.getY(i), position.getZ(i))
        .applyMatrix4(child.matrixWorld)
        .applyMatrix4(rootInverse);
      uv.set(
        size.x > 0 ? (vertex.x - bounds.min.x) / size.x : 0.5,
        size.y > 0 ? 1 - (vertex.y - bounds.min.y) / size.y : 0.5,
      );
      uvs.push(clamp01(uv.x), clamp01(uv.y));
    }

    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    child.geometry = geometry;
    child.frustumCulled = false;
    createdGeometries.push(geometry);
  });

  return () => {
    createdGeometries.forEach((geometry) => geometry.dispose());
  };
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
  const scale = 7.8 / (Math.max(size.x, size.y, size.z) || 1);

  mesh.geometry.translate(-center.x, -center.y, -center.z);
  mesh.scale.setScalar(scale);
  mesh.rotation.set(0.1, -0.45, 2.25);
  mesh.frustumCulled = false;
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
      transparent: true,
      opacity,
      wireframe: showWire,
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
        material.opacity = nextOpacity;
        material.needsUpdate = true;
      });
    },
    setWireframe(nextShowWire) {
      materials.forEach((material) => {
        material.wireframe = nextShowWire;
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
  const settingsRef = useRef({
    autoRotate: false,
    colorDepth: 1.25,
    opacity: 0.82,
    showWire: false,
    sourcePoints,
    videoPoints,
    pressurePalette,
  });
  const [autoRotate, setAutoRotate] = useState(false);
  const [showWire, setShowWire] = useState(false);
  const [colorDepth, setColorDepth] = useState(1.25);
  const [opacity, setOpacity] = useState(0.82);
  const [loadState, setLoadState] = useState('Loading');
  const [readout, setReadout] = useState({ source: 'SIM', peak: 0, frameAge: 'none' });

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

        const geometry = sourceMesh.geometry.clone();
        applyGeometryPlanarPressureUv(geometry);
        model = new THREE.Mesh(geometry);
        normalizeGeometryMesh(model);
        modelLookRef.current = applyTextureLook(
          model,
          texture,
          settingsRef.current.opacity,
          settingsRef.current.showWire,
        );
        rig.add(model);

        const debugBox = new THREE.Box3().setFromObject(model);
        setLoadState(`1 mesh / ${Math.round(debugBox.getSize(new THREE.Vector3()).length() * 10) / 10}`);
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
      paintPressureTexture(context, frame.matrix, currentSettings.colorDepth, currentSettings.pressurePalette);
      texture.needsUpdate = true;
      controls.autoRotate = currentSettings.autoRotate;
      heatLight.intensity = 0.86 + Math.sin(elapsed * 1.15) * 0.12;
      controls.update();
      renderer.render(scene, camera);

      if (performance.now() - lastReadoutAt > 240) {
        lastReadoutAt = performance.now();
        const snapshot = dataSource?.snapshot;
        const peak = frame.points.reduce((max, point) => Math.max(max, point.value), 0);
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
  }, [dataSource]);

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
