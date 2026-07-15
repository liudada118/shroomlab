import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';

const MODEL_URL = '/model/hand0423g.glb';

function removeObject(object) {
  if (object.parent) {
    object.parent.remove(object);
  }
}

function normalizeModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z) || 1;

  model.position.sub(center);
  model.scale.setScalar(7.2 / maxAxis);
  model.rotation.set(0.24, -0.42, 2.28);
}

function simplifyGeometry(sourceGeometry, modifier, simplificationRatio) {
  const geometry = sourceGeometry.clone();
  const position = geometry.attributes.position;

  if (!position || position.count < 120) {
    return geometry;
  }

  const removeCount = Math.max(0, Math.floor(position.count * simplificationRatio));
  try {
    const simplified = modifier.modify(geometry, removeCount);
    geometry.dispose();
    return simplified;
  } catch (error) {
    console.warn('Hand wireframe simplification failed, using original geometry:', error);
    return geometry;
  }
}

function buildTriangleLineGeometry(sourceGeometry, transform, modifier, simplificationRatio) {
  const simplifiedGeometry = simplifyGeometry(sourceGeometry, modifier, simplificationRatio);
  const position = simplifiedGeometry.attributes.position;

  if (!position) {
    simplifiedGeometry.dispose();
    return null;
  }

  const simplifiedIndex = simplifiedGeometry.index;
  const triangleCount = simplifiedIndex ? Math.floor(simplifiedIndex.count / 3) : Math.floor(position.count / 3);
  const lines = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  const readVertex = (vertexIndex, target) => {
    target
      .set(
        position.getX(vertexIndex),
        position.getY(vertexIndex),
        position.getZ(vertexIndex),
      )
      .applyMatrix4(transform);
  };

  const pushEdge = (start, end) => {
    lines.push(start.x, start.y, start.z, end.x, end.y, end.z);
  };

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const base = triangleIndex * 3;
    const ia = simplifiedIndex ? simplifiedIndex.getX(base) : base;
    const ib = simplifiedIndex ? simplifiedIndex.getX(base + 1) : base + 1;
    const ic = simplifiedIndex ? simplifiedIndex.getX(base + 2) : base + 2;

    readVertex(ia, a);
    readVertex(ib, b);
    readVertex(ic, c);
    pushEdge(a, b);
    pushEdge(b, c);
    pushEdge(c, a);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  simplifiedGeometry.dispose();
  return geometry;
}

function applyWireframeLook(model, simplificationRatio) {
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: 0x00d9e7,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const wireMaterial = new THREE.LineBasicMaterial({
    color: 0x00fff7,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
  });
  const glowMaterial = new THREE.LineBasicMaterial({
    color: 0x00fff7,
    transparent: true,
    opacity: 0.025,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  model.updateMatrixWorld(true);
  const modifier = new SimplifyModifier();
  const rootInverse = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const wireGroup = new THREE.Group();
  wireGroup.renderOrder = 3;

  const generatedObjects = [];
  const sourceMeshes = [];

  model.traverse((child) => {
    if (child.isMesh && child.geometry) {
      sourceMeshes.push(child);
    }
  });

  sourceMeshes.forEach((child) => {
    child.material = fillMaterial;
    child.renderOrder = 1;
    child.frustumCulled = false;

    const transform = new THREE.Matrix4().multiplyMatrices(rootInverse, child.matrixWorld);
    const wireGeometry = buildTriangleLineGeometry(child.geometry, transform, modifier, simplificationRatio);
    if (!wireGeometry) {
      return;
    }

    const wire = new THREE.LineSegments(wireGeometry, wireMaterial);
    wire.renderOrder = 3;
    wire.frustumCulled = false;
    wireGroup.add(wire);

    const glow = new THREE.LineSegments(wireGeometry.clone(), glowMaterial);
    glow.scale.setScalar(1.01);
    glow.renderOrder = 2;
    glow.frustumCulled = false;
    wireGroup.add(glow);
    generatedObjects.push(wire, glow);
  });

  model.add(wireGroup);

  return () => {
    fillMaterial.dispose();
    wireMaterial.dispose();
    glowMaterial.dispose();
    generatedObjects.forEach((object) => {
      object.geometry.dispose();
      removeObject(object);
    });
    removeObject(wireGroup);
  };
}

function makeReferenceArrows() {
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({
    color: 0x00fff7,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
  });

  for (let i = 0; i < 3; i += 1) {
    const shape = new THREE.BufferGeometry();
    const y = 1.2 - i * 0.62;
    const vertices = new Float32Array([
      0, -0.18, 0,
      0.22, 0.18, 0,
      0.22, 0.18, 0,
      -0.22, 0.18, 0,
      -0.22, 0.18, 0,
      0, -0.18, 0,
    ]);

    shape.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    const arrow = new THREE.LineSegments(shape, material);
    arrow.position.set(2.25, y, 0);
    group.add(arrow);
  }

  group.position.set(0.4, 0.7, 0.1);
  return group;
}

export default function HandWireframePage({ onNavigate }) {
  const mountRef = useRef(null);
  const [simplificationPercent, setSimplificationPercent] = useState(82);
  const [appliedSimplificationPercent, setAppliedSimplificationPercent] = useState(82);
  const updateSimplificationPercent = (event) => {
    setSimplificationPercent(Number(event.target.value));
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAppliedSimplificationPercent(simplificationPercent);
    }, 140);

    return () => window.clearTimeout(timer);
  }, [simplificationPercent]);

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x112737, 11, 24);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 80);
    camera.position.set(0, 0.12, 13.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.autoRotate = false;
    controls.minDistance = 7.5;
    controls.maxDistance = 17;
    controls.target.set(0, -0.15, 0);

    const rig = new THREE.Group();
    scene.add(rig);
    scene.add(new THREE.AmbientLight(0x5dfcff, 0.62));

    const rim = new THREE.PointLight(0x00fff7, 1.4, 18);
    rim.position.set(-3, 4, 6);
    scene.add(rim);

    const arrows = makeReferenceArrows();
    scene.add(arrows);

    let disposeWireframe = () => {};
    let frameId;
    let disposed = false;

    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        if (disposed) {
          return;
        }

        const model = gltf.scene;
        normalizeModel(model);
        disposeWireframe = applyWireframeLook(model, appliedSimplificationPercent / 100);
        rig.add(model);
      },
      undefined,
      (error) => {
        console.error('Failed to load hand model:', error);
      },
    );

    const resize = () => {
      const { clientWidth, clientHeight } = mount;
      const compact = clientWidth < 600;

      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / Math.max(clientHeight, 1);
      camera.position.set(0, compact ? 0.05 : 0.12, compact ? 17.5 : 13.2);
      camera.updateProjectionMatrix();
      rig.scale.setScalar(compact ? 0.58 : 1);
      rig.position.set(compact ? -1.15 : -0.82, compact ? 0.1 : 0, 0);
      arrows.scale.setScalar(compact ? 0.7 : 1);
      arrows.position.x = compact ? -0.25 : 0.4;
    };

    const animate = () => {
      controls.update();
      const elapsed = performance.now() * 0.001;
      arrows.position.y = 0.62 + Math.sin(elapsed * 1.7) * 0.06;
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
      disposeWireframe();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [appliedSimplificationPercent]);

  return (
    <main className="hand-page">
      <nav className="app-nav" style={{ '--nav-count': 5 }} aria-label="Page view">
        <button type="button" onClick={() => onNavigate('terrain')}>
          Pressure
        </button>
        <button className="active" type="button" onClick={() => onNavigate('hand')}>
          Wireframe
        </button>
        <button type="button" onClick={() => onNavigate('obj')}>
          OBJ
        </button>
        <button type="button" onClick={() => onNavigate('bones')}>
          Bones
        </button>
        <button type="button" onClick={() => onNavigate('points')}>
          Points
        </button>
      </nav>

      <section className="wireframe-controls" aria-label="Wireframe controls">
        <label>
          <span>Simplify</span>
          <input
            type="range"
            min="55"
            max="94"
            step="1"
            value={simplificationPercent}
            onChange={updateSimplificationPercent}
            onInput={updateSimplificationPercent}
          />
          <strong>{simplificationPercent}%</strong>
        </label>
      </section>

      <div className="hand-canvas" ref={mountRef} aria-label="Hand wireframe model" />
    </main>
  );
}
