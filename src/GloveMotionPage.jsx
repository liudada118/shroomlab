import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useWebSocketPressureSource } from './webSocketPressureSource.js';

const MODEL_URL = '/model/hand1_wrist_cut_cyan_rigged_wireframe.glb';
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

export default function GloveMotionPage({ onNavigate }) {
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
      MODEL_URL,
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
  }, []);

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
      <nav className="app-nav" style={{ '--nav-count': 6 }} aria-label="Page view">
        <button type="button" onClick={() => onNavigate('terrain')}>Pressure</button>
        <button type="button" onClick={() => onNavigate('hand')}>Wireframe</button>
        <button type="button" onClick={() => onNavigate('obj')}>OBJ</button>
        <button type="button" onClick={() => onNavigate('bones')}>Bones</button>
        <button className="active" type="button" onClick={() => onNavigate('gloveMotion')}>Motion</button>
        <button type="button" onClick={() => onNavigate('points')}>Points</button>
      </nav>

      <header className="glove-motion-title">
        <span>Glove Motion</span>
        <h1>Quaternion + Finger Bend</h1>
        <p>{MODEL_URL} / {loadState}</p>
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
