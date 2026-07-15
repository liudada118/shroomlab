import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {
  DEFAULT_GAUSSIAN_KERNEL_SIZE,
  SENSOR_MATRIX_SIZE,
  buildHandPressureFrame,
} from './handPressureData.js';
import { DEFAULT_PRESSURE_PALETTE } from './pressurePalette.js';
import {
  buildGeometry,
  buildSurfaceGridGeometry,
  updateSurfaceGrid,
  updateTerrain,
} from './PressureTerrain.jsx';

const TERRAIN_HEIGHT_SCALE = 2.15;
const TERRAIN_COLOR_DEPTH = 1.25;
const DEFAULT_TERRAIN_TRANSFORM = Object.freeze({
  x: 0,
  y: 0,
  z: 0,
  pitch: 62,
  yaw: -14,
  roll: -6,
  scale: 1,
});

const TERRAIN_TRANSFORM_CONTROLS = Object.freeze([
  Object.freeze({ key: 'x', label: '位置 X', min: -4, max: 4, step: 0.05, suffix: '' }),
  Object.freeze({ key: 'y', label: '位置 Y', min: -4, max: 4, step: 0.05, suffix: '' }),
  Object.freeze({ key: 'z', label: '位置 Z', min: -3, max: 3, step: 0.05, suffix: '' }),
  Object.freeze({ key: 'pitch', label: '俯仰 X', min: 0, max: 180, step: 1, suffix: '°' }),
  Object.freeze({ key: 'yaw', label: '方位 Y', min: -180, max: 180, step: 1, suffix: '°' }),
  Object.freeze({ key: 'roll', label: '侧倾 Z', min: -180, max: 180, step: 1, suffix: '°' }),
  Object.freeze({ key: 'scale', label: '缩放', min: 0.5, max: 1.5, step: 0.01, suffix: '×' }),
]);

const TONES = {
  ice: {
    label: '冷光',
    core: 0xe7f2ff,
    glow: 0x89aeea,
  },
  pearl: {
    label: '珍珠',
    core: 0xfff7ec,
    glow: 0xc4b9aa,
  },
  ember: {
    label: '余烬',
    core: 0xffe0be,
    glow: 0xe48a51,
  },
};

function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.035, 'rgba(255,255,255,.95)');
  gradient.addColorStop(0.12, 'rgba(205,224,255,.48)');
  gradient.addColorStop(0.42, 'rgba(125,157,218,.12)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function makeDustGeometry(count = 260) {
  const positions = new Float32Array(count * 3);
  let seed = 7431;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = -0.2 + random() * 8.8;
    positions[index * 3 + 1] = -4.6 + random() * 9.2;
    positions[index * 3 + 2] = -4 + random() * 7;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

export default function LightStudyPage({ onNavigate }) {
  const mountRef = useRef(null);
  const terrainTransformRef = useRef(DEFAULT_TERRAIN_TRANSFORM);
  const [tone, setTone] = useState('ice');
  const [paused, setPaused] = useState(false);
  const [transformPanelOpen, setTransformPanelOpen] = useState(false);
  const [terrainTransform, setTerrainTransform] = useState(() => ({ ...DEFAULT_TERRAIN_TRANSFORM }));

  useEffect(() => {
    terrainTransformRef.current = terrainTransform;
  }, [terrainTransform]);

  const updateTerrainTransform = (key, value) => {
    setTerrainTransform((current) => ({ ...current, [key]: value }));
  };

  const resetTerrainTransform = () => {
    setTerrainTransform({ ...DEFAULT_TERRAIN_TRANSFORM });
  };

  useEffect(() => {
    const mount = mountRef.current;
    const palette = TONES[tone];
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x010102);
    scene.fog = new THREE.FogExp2(0x010102, 0.055);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.66;
    mount.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 70);
    camera.position.set(0, 0, 10.5);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.78, 0.62, 0.12);
    composer.addPass(bloom);

    const rig = new THREE.Group();
    rig.position.set(-3.4, 0.1, 0);
    rig.rotation.set(1.08, -0.24, -0.1);
    rig.scale.setScalar(0.76);
    scene.add(rig);

    const initialPressureMatrix = buildHandPressureFrame(0, {
      matrixSize: SENSOR_MATRIX_SIZE,
      gaussianKernelSize: DEFAULT_GAUSSIAN_KERNEL_SIZE,
    }).matrix;
    const terrainGeometry = buildGeometry(SENSOR_MATRIX_SIZE);
    updateTerrain(
      terrainGeometry,
      initialPressureMatrix,
      TERRAIN_HEIGHT_SCALE,
      TERRAIN_COLOR_DEPTH,
      DEFAULT_GAUSSIAN_KERNEL_SIZE,
      DEFAULT_PRESSURE_PALETTE,
    );
    const terrainMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.72,
      metalness: 0.12,
      emissive: 0x02070b,
      emissiveIntensity: 0.08,
    });
    const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
    terrain.renderOrder = 1;
    rig.add(terrain);

    const surfaceGridGeometry = buildSurfaceGridGeometry();
    updateSurfaceGrid(
      surfaceGridGeometry,
      initialPressureMatrix,
      TERRAIN_HEIGHT_SCALE,
      DEFAULT_GAUSSIAN_KERNEL_SIZE,
    );
    const surfaceGridMaterial = new THREE.LineBasicMaterial({
      color: 0xc8fbff,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const surfaceGrid = new THREE.LineSegments(surfaceGridGeometry, surfaceGridMaterial);
    surfaceGrid.renderOrder = 2;
    rig.add(surfaceGrid);

    scene.add(new THREE.AmbientLight(0x335a78, 0.38));
    const keyLight = new THREE.DirectionalLight(0xf0f6ff, 0.3);
    keyLight.position.set(-2, 6, 8);
    scene.add(keyLight);
    const grazingLight = new THREE.PointLight(palette.glow, 0.76, 18);
    grazingLight.position.set(0.13, -0.08, -3.2);
    scene.add(grazingLight);

    const glowTexture = makeGlowTexture();
    const haloMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: palette.glow,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    const halo = new THREE.Sprite(haloMaterial);
    halo.position.set(0.13, -0.08, -3.2);
    halo.scale.set(3.4, 3.4, 1);
    halo.renderOrder = 4;
    scene.add(halo);

    const coreMaterial = haloMaterial.clone();
    coreMaterial.color.setHex(palette.core);
    coreMaterial.opacity = 0.94;
    const core = new THREE.Sprite(coreMaterial);
    core.position.copy(halo.position);
    core.position.z += 0.02;
    core.scale.set(0.7, 0.7, 1);
    core.renderOrder = 5;
    scene.add(core);

    const dustGeometry = makeDustGeometry();
    const dustMaterial = new THREE.PointsMaterial({
      color: palette.glow,
      size: 0.018,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const dust = new THREE.Points(dustGeometry, dustMaterial);
    scene.add(dust);

    const pointer = new THREE.Vector2(0, 0);
    const targetPointer = new THREE.Vector2(0, 0);
    let cameraDistance = 10.5;
    let targetDistance = 10.5;
    let frameId;
    let disposed = false;
    let lastTerrainUpdate = -Infinity;
    let compactLayout = false;
    const clock = new THREE.Clock();

    const onPointerMove = (event) => {
      const bounds = mount.getBoundingClientRect();
      targetPointer.x = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1;
      targetPointer.y = -(((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 2 - 1);
    };
    const onPointerLeave = () => targetPointer.set(0, 0);
    const onWheel = (event) => {
      targetDistance = THREE.MathUtils.clamp(targetDistance + event.deltaY * 0.002, 9.2, 12.4);
    };
    const resize = () => {
      const width = Math.max(mount.clientWidth, 1);
      const height = Math.max(mount.clientHeight, 1);
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      compactLayout = width < 700;
      halo.scale.setScalar(compactLayout ? 2.45 : 3.4);
      core.scale.setScalar(compactLayout ? 0.52 : 0.7);
    };

    const animate = () => {
      if (disposed) return;
      const elapsed = clock.getElapsedTime();
      pointer.lerp(targetPointer, 0.035);
      cameraDistance = THREE.MathUtils.lerp(cameraDistance, targetDistance, 0.055);
      camera.position.z = cameraDistance;

      if (!paused && elapsed - lastTerrainUpdate >= 1 / 12) {
        const pressureMatrix = buildHandPressureFrame(elapsed, {
          matrixSize: SENSOR_MATRIX_SIZE,
          gaussianKernelSize: DEFAULT_GAUSSIAN_KERNEL_SIZE,
        }).matrix;
        updateTerrain(
          terrainGeometry,
          pressureMatrix,
          TERRAIN_HEIGHT_SCALE,
          TERRAIN_COLOR_DEPTH,
          DEFAULT_GAUSSIAN_KERNEL_SIZE,
          DEFAULT_PRESSURE_PALETTE,
        );
        updateSurfaceGrid(
          surfaceGridGeometry,
          pressureMatrix,
          TERRAIN_HEIGHT_SCALE,
          DEFAULT_GAUSSIAN_KERNEL_SIZE,
        );
        lastTerrainUpdate = elapsed;
      }

      const transform = terrainTransformRef.current;
      const basePositionX = compactLayout ? -3.05 : -3.4;
      const baseScale = compactLayout ? 0.66 : 0.76;
      const pointerYaw = paused ? 0 : pointer.x * 0.055;
      const pointerPitch = paused ? 0 : -pointer.y * 0.04;
      rig.position.set(basePositionX + transform.x, 0.1 + transform.y, transform.z);
      rig.scale.setScalar(baseScale * transform.scale);
      rig.rotation.set(
        THREE.MathUtils.degToRad(transform.pitch) + pointerPitch,
        THREE.MathUtils.degToRad(transform.yaw) + pointerYaw,
        THREE.MathUtils.degToRad(transform.roll),
      );

      if (!paused) {
        dust.rotation.y = elapsed * 0.008;
      }
      const lightX = 0.13 + pointer.x * 0.34;
      const lightY = -0.08 + pointer.y * 0.28;
      halo.position.x = THREE.MathUtils.lerp(halo.position.x, lightX, 0.025);
      halo.position.y = THREE.MathUtils.lerp(halo.position.y, lightY, 0.025);
      core.position.x = halo.position.x;
      core.position.y = halo.position.y;
      grazingLight.position.copy(halo.position);
      grazingLight.intensity = paused ? 0.66 : 0.72 + Math.sin(elapsed * 0.72) * 0.08;
      haloMaterial.opacity = paused ? 0.34 : 0.38 + Math.sin(elapsed * 0.72) * 0.05;

      composer.render();
      frameId = requestAnimationFrame(animate);
    };

    resize();
    mount.addEventListener('pointermove', onPointerMove);
    mount.addEventListener('pointerleave', onPointerLeave);
    mount.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('resize', resize);
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      mount.removeEventListener('pointermove', onPointerMove);
      mount.removeEventListener('pointerleave', onPointerLeave);
      mount.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', resize);
      terrainGeometry.dispose();
      terrainMaterial.dispose();
      surfaceGridGeometry.dispose();
      surfaceGridMaterial.dispose();
      glowTexture.dispose();
      haloMaterial.dispose();
      coreMaterial.dispose();
      dustGeometry.dispose();
      dustMaterial.dispose();
      composer.renderTarget1.dispose();
      composer.renderTarget2.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [paused, tone]);

  return (
    <main className={`light-study-page light-tone-${tone}`}>
      <div className="light-study-canvas" ref={mountRef} aria-label="交互式 3D 压力地形光影场景" />

      <header className="light-study-header">
        <button className="light-study-back" type="button" onClick={() => onNavigate('terrain')} aria-label="返回 Pressure 页面">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5-7 7 7 7" /></svg>
        </button>
        <div className="light-study-brand"><span>SHROOM LAB</span><i /></div>
        <div className="light-study-header-actions">
          <button
            className={`light-study-action${transformPanelOpen ? ' active' : ''}`}
            type="button"
            onClick={() => setTransformPanelOpen((value) => !value)}
            aria-expanded={transformPanelOpen}
            aria-controls="light-terrain-transform-panel"
          >
            调节
          </button>
          <button className="light-study-pause" type="button" onClick={() => setPaused((value) => !value)}>
            {paused ? '继续' : '暂停'}
          </button>
        </div>
      </header>

      {transformPanelOpen && (
        <aside className="light-transform-panel" id="light-terrain-transform-panel" aria-label="热力地形变换设置">
          <header>
            <div>
              <span>TERRAIN TRANSFORM</span>
              <strong>热力地形调节</strong>
            </div>
            <button type="button" onClick={resetTerrainTransform}>复位</button>
          </header>
          <div className="light-transform-fields">
            {TERRAIN_TRANSFORM_CONTROLS.map((control) => {
              const value = terrainTransform[control.key];
              const digits = control.step < 0.1 ? 2 : 0;
              return (
                <label key={control.key}>
                  <span>
                    <b>{control.label}</b>
                    <output>{value.toFixed(digits)}{control.suffix}</output>
                  </span>
                  <input
                    type="range"
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    value={value}
                    onChange={(event) => updateTerrainTransform(control.key, Number(event.target.value))}
                  />
                </label>
              );
            })}
          </div>
        </aside>
      )}

      <section className="light-study-copy">
        <p>PRESSURE FIELD / 001</p>
        <h1>压力成形<br />数据地形</h1>
        <div className="light-study-rule" />
        <span>移动指针改变光线，滚动调整距离</span>
      </section>

      <div className="light-study-credit" aria-hidden="true">
        <span>VOLUMETRIC DATA</span>
        <strong>PRESSURE TERRAIN</strong>
      </div>

      <aside className="light-study-controls" aria-label="光影色调">
        <span>色温</span>
        <div>
          {Object.entries(TONES).map(([key, option]) => (
            <button
              className={tone === key ? 'active' : ''}
              type="button"
              key={key}
              onClick={() => setTone(key)}
              aria-pressed={tone === key}
            >
              <i />{option.label}
            </button>
          ))}
        </div>
      </aside>

      <footer className="light-study-footer">
        <span>REAL-TIME WEBGL</span>
        <span>2026 · EXPERIMENTAL SERIES</span>
      </footer>
    </main>
  );
}
