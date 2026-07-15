import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

const HAND_REFERENCE_MODEL_URL = '/model/hand0423g_regular_square_texture_fixed.glb';
const REGION_OBJ_URL = '/hand_info/finger_thirds_export/hand0423g_finger_thirds_and_palm.obj';
const REGION_MTL_URL = '/hand_info/finger_thirds_export/hand0423g_finger_thirds_and_palm.mtl';

function loadText(url) {
  return fetch(url).then((response) => {
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }

    return response.text();
  });
}

function loadRegionObj() {
  return new Promise((resolve, reject) => {
    new MTLLoader()
      .setPath('/hand_info/finger_thirds_export/')
      .load('hand0423g_finger_thirds_and_palm.mtl', (materials) => {
        materials.preload();
        new OBJLoader()
          .setMaterials(materials)
          .load(REGION_OBJ_URL, resolve, undefined, reject);
      }, undefined, reject);
  });
}

function loadReferenceHand() {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(HAND_REFERENCE_MODEL_URL, (gltf) => resolve(gltf.scene), undefined, reject);
  });
}

function parseObjStats(objText) {
  const stats = {
    vertices: 0,
    faces: 0,
    groups: [],
  };
  let currentGroup = 'default';

  objText.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('v ')) {
      stats.vertices += 1;
      return;
    }

    if (trimmed.startsWith('g ')) {
      currentGroup = trimmed.slice(2).trim() || 'default';
      if (!stats.groups.some((group) => group.name === currentGroup)) {
        stats.groups.push({ name: currentGroup, faces: 0 });
      }
      return;
    }

    if (trimmed.startsWith('f ')) {
      stats.faces += 1;
      const group = stats.groups.find((item) => item.name === currentGroup);
      if (group) {
        group.faces += 1;
      }
    }
  });

  return stats;
}

function normalizeModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z) || 1;

  model.position.sub(center);
  model.scale.setScalar(7.8 / maxAxis);
  model.rotation.set(0.1, -0.45, 2.25);
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

function buildEdgeAndPointOverlays(model) {
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0x00fff7,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    depthWrite: false,
  });
  const pointMaterial = new THREE.PointsMaterial({
    color: 0x00fff7,
    transparent: true,
    opacity: 0.88,
    size: 0.055,
    sizeAttenuation: true,
    depthTest: false,
    depthWrite: false,
  });
  const created = [];

  model.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position) {
      return;
    }

    const edgeGeometry = new THREE.EdgesGeometry(child.geometry, 1);
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    edges.renderOrder = 4;
    edges.frustumCulled = false;

    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute('position', child.geometry.attributes.position.clone());
    const points = new THREE.Points(pointGeometry, pointMaterial);
    points.renderOrder = 5;
    points.frustumCulled = false;

    child.add(edges, points);
    created.push(edges, points);
  });

  return {
    edgeMaterial,
    pointMaterial,
    setVisible(visible) {
      created.forEach((object) => {
        object.visible = visible;
      });
    },
    dispose() {
      created.forEach((object) => {
        object.geometry.dispose();
        if (object.parent) {
          object.parent.remove(object);
        }
      });
      edgeMaterial.dispose();
      pointMaterial.dispose();
    },
  };
}

function applySurfaceLook(model, showSurface) {
  const surfaceMaterials = [];

  model.traverse((child) => {
    if (!child.isMesh || !child.material) {
      return;
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const clonedMaterials = materials.map((material) => {
      const cloned = material.clone();
      cloned.side = THREE.DoubleSide;
      cloned.transparent = true;
      cloned.opacity = showSurface ? 0.72 : 0;
      cloned.depthWrite = showSurface;
      surfaceMaterials.push(cloned);
      return cloned;
    });

    child.material = Array.isArray(child.material) ? clonedMaterials : clonedMaterials[0];
    child.frustumCulled = false;
  });

  return {
    setVisible(visible) {
      surfaceMaterials.forEach((material) => {
        material.opacity = visible ? 0.72 : 0;
        material.depthWrite = visible;
        material.needsUpdate = true;
      });
    },
    dispose() {
      surfaceMaterials.forEach((material) => material.dispose());
    },
  };
}

function applyReferenceHandLook(model, showHand) {
  const materials = [];

  model.traverse((child) => {
    if (!child.isMesh || !child.material) {
      return;
    }

    const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
    const clonedMaterials = sourceMaterials.map((material) => {
      const cloned = material.clone();
      cloned.color = new THREE.Color(0x9ddad8);
      cloned.side = THREE.DoubleSide;
      cloned.transparent = true;
      cloned.opacity = showHand ? 0.32 : 0;
      cloned.depthWrite = false;
      cloned.roughness = 0.72;
      materials.push(cloned);
      return cloned;
    });

    child.material = Array.isArray(child.material) ? clonedMaterials : clonedMaterials[0];
    child.renderOrder = 1;
    child.frustumCulled = false;
  });

  return {
    setVisible(visible) {
      materials.forEach((material) => {
        material.opacity = visible ? 0.32 : 0;
        material.needsUpdate = true;
      });
    },
    dispose() {
      materials.forEach((material) => material.dispose());
    },
  };
}

export default function RegionObjPage({ onNavigate }) {
  const mountRef = useRef(null);
  const handRef = useRef(null);
  const surfaceRef = useRef(null);
  const overlayRef = useRef(null);
  const autoRotateRef = useRef(false);
  const [showHand, setShowHand] = useState(true);
  const [showSurface, setShowSurface] = useState(true);
  const [showEdges, setShowEdges] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [stats, setStats] = useState({ vertices: 0, faces: 0, groups: [] });

  useEffect(() => {
    handRef.current?.setVisible(showHand);
  }, [showHand]);

  useEffect(() => {
    surfaceRef.current?.setVisible(showSurface);
  }, [showSurface]);

  useEffect(() => {
    overlayRef.current?.setVisible(showEdges);
  }, [showEdges]);

  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

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
    controls.autoRotateSpeed = 0.72;
    controls.minDistance = 5.2;
    controls.maxDistance = 18;
    controls.target.set(0, -0.15, 0);

    const rig = new THREE.Group();
    scene.add(rig);
    scene.add(new THREE.AmbientLight(0xc9fbff, 0.78));

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
    keyLight.position.set(4.5, 6.5, 7);
    scene.add(keyLight);

    const rimLight = new THREE.PointLight(0x00fff7, 1.2, 16);
    rimLight.position.set(-3.5, 3.2, 4.5);
    scene.add(rimLight);

    const baseGrid = new THREE.GridHelper(9.5, 24, 0x22cdd6, 0x1b5061);
    baseGrid.position.y = -3.9;
    baseGrid.material.transparent = true;
    baseGrid.material.opacity = 0.24;
    scene.add(baseGrid);

    let displayGroup = null;
    let handModel = null;
    let regionModel = null;
    let frameId;
    let disposed = false;

    Promise.all([loadReferenceHand(), loadRegionObj(), loadText(REGION_OBJ_URL)]).then(
      ([loadedHandModel, loadedRegionModel, objText]) => {
        if (disposed) {
          disposeObject(loadedHandModel);
          disposeObject(loadedRegionModel);
          return;
        }

        handModel = loadedHandModel;
        regionModel = loadedRegionModel;
        displayGroup = new THREE.Group();
        displayGroup.add(handModel, regionModel);
        normalizeModel(displayGroup);
        handRef.current = applyReferenceHandLook(handModel, showHand);
        surfaceRef.current = applySurfaceLook(regionModel, showSurface);
        overlayRef.current = buildEdgeAndPointOverlays(regionModel);
        overlayRef.current.setVisible(showEdges);
        setStats(parseObjStats(objText));
        rig.add(displayGroup);
      },
      (error) => {
        console.error('Failed to load region OBJ:', error);
      },
    );

    const resize = () => {
      const { clientWidth, clientHeight } = mount;
      const compact = clientWidth < 680;

      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / Math.max(clientHeight, 1);
      camera.position.set(0, compact ? 0.25 : 0.4, compact ? 15.4 : 13.2);
      camera.updateProjectionMatrix();
      rig.scale.setScalar(compact ? 0.78 : 1);
    };

    const animate = () => {
      controls.autoRotate = autoRotateRef.current;
      controls.update();
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
      handRef.current?.dispose();
      surfaceRef.current?.dispose();
      overlayRef.current?.dispose();
      handRef.current = null;
      surfaceRef.current = null;
      overlayRef.current = null;
      if (displayGroup) {
        rig.remove(displayGroup);
      }
      if (handModel) {
        disposeObject(handModel);
      }
      if (regionModel) {
        disposeObject(regionModel);
      }
      baseGrid.geometry.dispose();
      baseGrid.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <main className="obj-model-page">
      <nav className="app-nav" aria-label="Page view">
        <button type="button" onClick={() => onNavigate('terrain')}>
          Pressure
        </button>
        <button type="button" onClick={() => onNavigate('hand')}>
          Wireframe
        </button>
        <button type="button" onClick={() => onNavigate('obj')}>
          GLB
        </button>
        <button className="active" type="button" onClick={() => onNavigate('regionObj')}>
          Cell OBJ
        </button>
        <button type="button" onClick={() => onNavigate('points')}>
          Points
        </button>
      </nav>

      <section className="region-obj-controls" aria-label="Region OBJ controls">
        <label className="obj-toggle-control">
          <input
            type="checkbox"
            checked={showHand}
            onChange={(event) => setShowHand(event.target.checked)}
          />
          <span>Hand</span>
        </label>
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
            checked={showEdges}
            onChange={(event) => setShowEdges(event.target.checked)}
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
        <div className="obj-selection-status" aria-live="polite">
          {stats.vertices}/{stats.faces}
        </div>
      </section>

      <section className="region-obj-panel" aria-label="Region OBJ groups">
        <div>
          <strong>Vertices</strong>
          <span>{stats.vertices}</span>
        </div>
        <div>
          <strong>Quads</strong>
          <span>{stats.faces}</span>
        </div>
        <ul>
          {stats.groups.map((group) => (
            <li key={group.name}>
              <span>{group.name}</span>
              <strong>{group.faces}</strong>
            </li>
          ))}
        </ul>
      </section>

      <div className="obj-model-canvas" aria-label="Loaded finger thirds and palm OBJ">
        <div className="obj-render-layer" ref={mountRef} />
      </div>
    </main>
  );
}
