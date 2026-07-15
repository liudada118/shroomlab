import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODEL_URL = '/model/hand0423g_skinned.glb';
const AXES = ['x', 'y', 'z'];
const FINGER_NAMES = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const SEGMENT_NAMES = ['Metacarpal', 'Proximal', 'Middle', 'Distal'];
const EMPTY_FINGER_CURL = Object.freeze({ 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 });

function radiansToDegrees(value) {
  return Math.round(THREE.MathUtils.radToDeg(value));
}

function rotationFromBone(bone) {
  return AXES.reduce((rotation, axis) => {
    rotation[axis] = radiansToDegrees(bone?.rotation?.[axis] || 0);
    return rotation;
  }, {});
}

function boneLabel(name) {
  if (name === 'Forearm_00') return 'Forearm Root';
  if (name === 'Forearm_01') return 'Forearm';
  if (name === 'Wrist') return 'Wrist';

  const match = /^Finger_(\d)(\d)(?:_end)?$/.exec(name);
  if (!match) return name;

  const finger = FINGER_NAMES[Number(match[1])] || `Finger ${match[1]}`;
  const segment = name.endsWith('_end') ? 'Tip' : SEGMENT_NAMES[Number(match[2])] || `Segment ${match[2]}`;
  return `${finger} · ${segment}`;
}

function fingerIndexFromBoneName(name) {
  const match = /^Finger_(\d)/.exec(name);
  return match ? Number(match[1]) : null;
}

function poseFinger(bones, originalQuaternions, fingerIndex, degrees) {
  const segments = fingerIndex === 0
    ? [[0, 0.28], [1, 0.58], [2, 0.82], [3, 1]]
    : [[1, 0.68], [2, 0.88], [3, 1]];

  segments.forEach(([segmentIndex, amount]) => {
    const name = `Finger_${fingerIndex}${segmentIndex}`;
    const bone = bones.get(name);
    const original = originalQuaternions.get(name);
    if (!bone || !original) return;
    const curl = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      THREE.MathUtils.degToRad(degrees * amount),
    );
    bone.quaternion.copy(original).multiply(curl);
  });
}

function normalizeModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = 7.2 / (Math.max(size.x, size.y, size.z) || 1);

  model.scale.setScalar(scale);
  model.position.copy(center).multiplyScalar(-scale);
}

function disposeModel(model) {
  model.traverse((child) => {
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.filter(Boolean).forEach((material) => material.dispose());
  });
}

export default function BoneControlPage({ onNavigate }) {
  const mountRef = useRef(null);
  const modelRef = useRef(null);
  const bonesRef = useRef(new Map());
  const originalRotationsRef = useRef(new Map());
  const originalQuaternionsRef = useRef(new Map());
  const selectedBoneRef = useRef('');
  const skeletonHelperRef = useRef(null);
  const markerRef = useRef(null);
  const autoRotateRef = useRef(false);

  const [boneOptions, setBoneOptions] = useState([]);
  const [selectedBoneName, setSelectedBoneName] = useState('');
  const [rotation, setRotation] = useState({ x: 0, y: 0, z: 0 });
  const [fingerCurl, setFingerCurl] = useState(() => ({ ...EMPTY_FINGER_CURL }));
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [loadState, setLoadState] = useState('Loading GLB skeleton…');

  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    if (skeletonHelperRef.current) {
      skeletonHelperRef.current.visible = showSkeleton;
    }
  }, [showSkeleton]);

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x07131c, 11, 28);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
    camera.position.set(0, 0.3, 13.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 7.5;
    controls.maxDistance = 19;
    controls.target.set(0, 0, 0);

    const rig = new THREE.Group();
    rig.rotation.set(0.24, -0.42, 2.28);
    scene.add(rig);

    scene.add(new THREE.HemisphereLight(0xc9ffff, 0x071018, 1.25));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(-4, 7, 8);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(0x00fff7, 1.4, 20);
    rimLight.position.set(5, 1, -3);
    scene.add(rimLight);

    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 18, 18),
      new THREE.MeshBasicMaterial({ color: 0xff4058, depthTest: false }),
    );
    marker.visible = false;
    marker.renderOrder = 10;
    scene.add(marker);
    markerRef.current = marker;

    let disposed = false;
    let frameId;

    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        const model = gltf.scene;
        if (disposed) {
          disposeModel(model);
          return;
        }

        normalizeModel(model);
        let skinnedMeshCount = 0;
        model.traverse((child) => {
          if (!child.isMesh) return;
          if (child.isSkinnedMesh) skinnedMeshCount += 1;
          child.frustumCulled = false;
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.filter(Boolean).forEach((material) => {
            if (material.color) material.color.set(0xa8e8e5);
            if ('roughness' in material) material.roughness = 0.68;
            if ('metalness' in material) material.metalness = 0.04;
            material.side = THREE.DoubleSide;
          });
        });
        rig.add(model);
        modelRef.current = model;

        const bones = [];
        model.traverse((child) => {
          if (child.isBone && !bones.some((bone) => bone.uuid === child.uuid)) {
            bones.push(child);
          }
        });

        const boneMap = new Map(bones.map((bone) => [bone.name, bone]));
        bonesRef.current = boneMap;
        originalRotationsRef.current = new Map(
          bones.map((bone) => [bone.name, bone.rotation.clone()]),
        );
        originalQuaternionsRef.current = new Map(
          bones.map((bone) => [bone.name, bone.quaternion.clone()]),
        );

        const options = bones
          .filter((bone) => !bone.name.endsWith('_end'))
          .map((bone) => ({ name: bone.name, label: boneLabel(bone.name) }));
        const initialBone = boneMap.get('Wrist') || bones[0];
        setBoneOptions(options);
        selectedBoneRef.current = initialBone?.name || '';
        setSelectedBoneName(initialBone?.name || '');
        setRotation(rotationFromBone(initialBone));
        setLoadState(
          skinnedMeshCount > 0
            ? `${bones.length} bones · ${skinnedMeshCount} skinned mesh ready`
            : 'Invalid GLB: mesh is not skinned',
        );

        const skeletonHelper = new THREE.SkeletonHelper(model);
        skeletonHelper.material.color.set(0x00fff7);
        skeletonHelper.material.transparent = true;
        skeletonHelper.material.opacity = 0.82;
        skeletonHelper.material.depthTest = false;
        skeletonHelper.renderOrder = 8;
        skeletonHelper.visible = showSkeleton;
        scene.add(skeletonHelper);
        skeletonHelperRef.current = skeletonHelper;
      },
      undefined,
      (error) => {
        console.error('Failed to load bone-control GLB:', error);
        if (!disposed) setLoadState('GLB load failed');
      },
    );

    const selectedWorldPosition = new THREE.Vector3();
    const resize = () => {
      const { clientWidth, clientHeight } = mount;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / Math.max(clientHeight, 1);
      camera.updateProjectionMatrix();
    };

    const animate = () => {
      controls.autoRotate = autoRotateRef.current;
      controls.autoRotateSpeed = 1.25;
      controls.update();

      const selectedBone = bonesRef.current.get(selectedBoneRef.current);
      if (selectedBone) {
        selectedBone.getWorldPosition(selectedWorldPosition);
        marker.position.copy(selectedWorldPosition);
        marker.visible = true;
      } else {
        marker.visible = false;
      }

      renderer.render(scene, camera);
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
      if (skeletonHelperRef.current?.parent) {
        skeletonHelperRef.current.parent.remove(skeletonHelperRef.current);
      }
      skeletonHelperRef.current?.geometry?.dispose();
      skeletonHelperRef.current?.material?.dispose();
      marker.geometry.dispose();
      marker.material.dispose();
      if (modelRef.current) disposeModel(modelRef.current);
      bonesRef.current = new Map();
      originalRotationsRef.current = new Map();
      originalQuaternionsRef.current = new Map();
      modelRef.current = null;
      skeletonHelperRef.current = null;
      markerRef.current = null;
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  const selectBone = (name) => {
    selectedBoneRef.current = name;
    setSelectedBoneName(name);
    setRotation(rotationFromBone(bonesRef.current.get(name)));
  };

  const updateRotation = (axis, value) => {
    const degrees = Number(value);
    const bone = bonesRef.current.get(selectedBoneRef.current);
    if (bone) {
      bone.rotation[axis] = THREE.MathUtils.degToRad(degrees);
      bone.updateMatrixWorld(true);
    }
    setRotation((current) => ({ ...current, [axis]: degrees }));
  };

  const resetSelectedBone = () => {
    const name = selectedBoneRef.current;
    const bone = bonesRef.current.get(name);
    const original = originalRotationsRef.current.get(name);
    if (!bone || !original) return;
    bone.rotation.copy(original);
    bone.updateMatrixWorld(true);
    setRotation(rotationFromBone(bone));
    const fingerIndex = fingerIndexFromBoneName(name);
    if (fingerIndex !== null) {
      setFingerCurl((current) => ({ ...current, [fingerIndex]: 0 }));
    }
  };

  const resetAllBones = () => {
    bonesRef.current.forEach((bone, name) => {
      const original = originalRotationsRef.current.get(name);
      if (original) bone.rotation.copy(original);
    });
    modelRef.current?.updateMatrixWorld(true);
    setRotation(rotationFromBone(bonesRef.current.get(selectedBoneRef.current)));
    setFingerCurl({ ...EMPTY_FINGER_CURL });
  };

  const updateFingerCurl = (fingerIndex, value) => {
    const degrees = Number(value);
    poseFinger(bonesRef.current, originalQuaternionsRef.current, fingerIndex, degrees);
    modelRef.current?.updateMatrixWorld(true);
    setFingerCurl((current) => ({ ...current, [fingerIndex]: degrees }));

    if (fingerIndexFromBoneName(selectedBoneRef.current) === fingerIndex) {
      setRotation(rotationFromBone(bonesRef.current.get(selectedBoneRef.current)));
    }
  };

  const makeFist = () => {
    const fistCurl = { 0: 68, 1: 88, 2: 92, 3: 90, 4: 84 };
    Object.entries(fistCurl).forEach(([fingerIndex, degrees]) => {
      poseFinger(
        bonesRef.current,
        originalQuaternionsRef.current,
        Number(fingerIndex),
        degrees,
      );
    });
    modelRef.current?.updateMatrixWorld(true);
    setFingerCurl(fistCurl);
    setRotation(rotationFromBone(bonesRef.current.get(selectedBoneRef.current)));
  };

  return (
    <main className="bone-control-page">
      <nav className="app-nav" style={{ '--nav-count': 5 }} aria-label="Page view">
        <button type="button" onClick={() => onNavigate('terrain')}>Pressure</button>
        <button type="button" onClick={() => onNavigate('hand')}>Wireframe</button>
        <button type="button" onClick={() => onNavigate('obj')}>OBJ</button>
        <button className="active" type="button" onClick={() => onNavigate('bones')}>Bones</button>
        <button type="button" onClick={() => onNavigate('points')}>Points</button>
      </nav>

      <header className="bone-control-title">
        <span>Skinned GLB Lab</span>
        <h1>Hand Bone Control</h1>
        <p>{MODEL_URL} · {loadState}</p>
      </header>

      <section className="bone-control-panel" aria-label="GLB bone controls">
        <div className="finger-curl-controls">
          <div className="bone-control-section-title">
            <span>Finger curl</span>
            <div>
              <button type="button" disabled={!boneOptions.length} onClick={resetAllBones}>Open</button>
              <button type="button" disabled={!boneOptions.length} onClick={makeFist}>Fist</button>
            </div>
          </div>
          {FINGER_NAMES.map((fingerName, fingerIndex) => (
            <label key={fingerName}>
              <span>{fingerName}</span>
              <input
                type="range"
                min="0"
                max="110"
                step="1"
                value={fingerCurl[fingerIndex]}
                disabled={!boneOptions.length}
                aria-label={`${fingerName} curl`}
                onChange={(event) => updateFingerCurl(fingerIndex, event.target.value)}
                onInput={(event) => updateFingerCurl(fingerIndex, event.target.value)}
              />
              <strong>{fingerCurl[fingerIndex]}°</strong>
            </label>
          ))}
        </div>

        <div className="bone-control-divider" />
        <label className="bone-select-control">
          <span>Bone</span>
          <select
            value={selectedBoneName}
            disabled={!boneOptions.length}
            onChange={(event) => selectBone(event.target.value)}
          >
            {boneOptions.map((bone) => (
              <option key={bone.name} value={bone.name}>{bone.label} ({bone.name})</option>
            ))}
          </select>
        </label>

        <div className="bone-rotation-controls">
          {AXES.map((axis) => (
            <label key={axis}>
              <span>{axis.toUpperCase()}</span>
              <input
                type="range"
                min="-180"
                max="180"
                step="1"
                value={rotation[axis]}
                disabled={!selectedBoneName}
                onChange={(event) => updateRotation(axis, event.target.value)}
                onInput={(event) => updateRotation(axis, event.target.value)}
              />
              <strong>{rotation[axis]}°</strong>
            </label>
          ))}
        </div>

        <div className="bone-toggle-row">
          <label>
            <input
              type="checkbox"
              checked={showSkeleton}
              onChange={(event) => setShowSkeleton(event.target.checked)}
            />
            <span>Skeleton</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={autoRotate}
              onChange={(event) => setAutoRotate(event.target.checked)}
            />
            <span>Rotate</span>
          </label>
        </div>

        <div className="bone-action-row">
          <button type="button" disabled={!selectedBoneName} onClick={resetSelectedBone}>Reset Bone</button>
          <button type="button" disabled={!boneOptions.length} onClick={resetAllBones}>Reset All</button>
        </div>

        <p className="bone-control-hint">上方 Curl 会直接弯曲整根手指；下方 Bone 控制用于微调单个有蒙皮权重的关节。</p>
      </section>

      <div className="bone-control-canvas" ref={mountRef} aria-label="Controllable skinned GLB hand model" />
    </main>
  );
}
