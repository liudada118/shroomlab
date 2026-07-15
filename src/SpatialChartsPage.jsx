import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const DATASETS = {
  revenue: {
    eyebrow: 'REVENUE OVERVIEW',
    total: '¥ 8.42M',
    change: '+24.8%',
    bars: [0.42, 0.66, 0.51, 0.92, 1.3, 1.08],
    line: [0.34, 0.68, 0.48, 0.94, 0.72, 1.22, 1.06],
    donut: [0.39, 0.27, 0.2, 0.14],
  },
  users: {
    eyebrow: 'ACTIVE AUDIENCE',
    total: '126.4K',
    change: '+18.2%',
    bars: [0.64, 0.5, 0.84, 0.72, 1.08, 1.36],
    line: [0.28, 0.5, 0.62, 0.55, 0.88, 1.02, 1.26],
    donut: [0.46, 0.23, 0.18, 0.13],
  },
  conversion: {
    eyebrow: 'CONVERSION SIGNAL',
    total: '38.6%',
    change: '+7.4%',
    bars: [0.76, 0.62, 0.44, 0.86, 1.04, 1.18],
    line: [0.42, 0.38, 0.7, 0.61, 0.82, 1.12, 1.3],
    donut: [0.34, 0.3, 0.22, 0.14],
  },
};

const COLORS = ['#ff355d', '#ff8a1e', '#2eb8ff', '#bd28ef'];

function standardMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: options.metalness ?? 0.18,
    roughness: options.roughness ?? 0.32,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    side: THREE.DoubleSide,
  });
}

function addEdges(mesh, color = '#9bdcff', opacity = 0.24) {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
  mesh.add(edges);
}

function addShadowedMesh(group, geometry, material, position, rotation) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function createTextSprite(text, color = '#dff5ff', size = 0.8) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = '700 42px Segoe UI, Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = color;
  context.shadowColor = color;
  context.shadowBlur = 12;
  context.fillText(text, 256, 62);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(size * 4, size, 1);
  return sprite;
}

function createDonutSegment(innerRadius, outerRadius, startAngle, endAngle, depth, color) {
  const shape = new THREE.Shape();
  shape.moveTo(Math.cos(startAngle) * outerRadius, Math.sin(startAngle) * outerRadius);
  shape.absarc(0, 0, outerRadius, startAngle, endAngle, false);
  shape.lineTo(Math.cos(endAngle) * innerRadius, Math.sin(endAngle) * innerRadius);
  shape.absarc(0, 0, innerRadius, endAngle, startAngle, true);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.035, bevelSegments: 2 });
  geometry.center();
  const mesh = new THREE.Mesh(geometry, standardMaterial(color, { roughness: 0.27 }));
  mesh.castShadow = true;
  return mesh;
}

function addChartPlate(group, width, depth, color = '#17213c') {
  const plate = addShadowedMesh(
    group,
    new THREE.BoxGeometry(width, 0.12, depth),
    standardMaterial(color, { metalness: 0.05, roughness: 0.58, transparent: true, opacity: 0.82 }),
    [0, -0.13, 0],
  );
  addEdges(plate, '#4069a8', 0.25);
  return plate;
}

function buildSpatialCharts(scene, data) {
  const root = new THREE.Group();
  root.rotation.y = -0.08;
  scene.add(root);

  const columnChart = new THREE.Group();
  columnChart.position.set(-3.65, 0.05, -2.65);
  addChartPlate(columnChart, 4.15, 2.3);
  data.bars.forEach((height, index) => {
    const color = index < 3 ? '#238dff' : COLORS[(index - 3) % COLORS.length];
    const bar = addShadowedMesh(
      columnChart,
      new THREE.BoxGeometry(0.42, height * 2, 0.5),
      standardMaterial(color, { roughness: 0.26 }),
      [-1.48 + index * 0.58, height, 0.08],
    );
    bar.userData.baseScale = 1;
    bar.userData.pulsePhase = index * 0.55;
  });
  const columnLabel = createTextSprite('MONTHLY GROWTH', '#9ddcff', 0.34);
  columnLabel.position.set(0, 0.12, 1.02);
  columnChart.add(columnLabel);
  root.add(columnChart);

  const lineChart = new THREE.Group();
  lineChart.position.set(1.2, 0.02, -2.72);
  addChartPlate(lineChart, 4.45, 2.35);
  const linePoints = data.line.map((value, index) => new THREE.Vector3(-1.72 + index * 0.58, 0.18 + value * 1.5, 0));
  const curve = new THREE.CatmullRomCurve3(linePoints);
  const line = addShadowedMesh(
    lineChart,
    new THREE.TubeGeometry(curve, 70, 0.055, 8, false),
    standardMaterial('#ff7f24', { roughness: 0.22 }),
    [0, 0, 0],
  );
  line.userData.glow = true;
  linePoints.forEach((point, index) => {
    const marker = addShadowedMesh(
      lineChart,
      new THREE.SphereGeometry(0.13, 20, 20),
      standardMaterial(index % 2 ? '#30c6ff' : '#9b39ff'),
      [point.x, point.y, point.z],
    );
    marker.userData.spin = 0.5 + index * 0.08;
  });
  [-1.4, -0.7, 0, 0.7, 1.4].forEach((x) => {
    const gridLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0.05, -0.72), new THREE.Vector3(x, 0.05, 0.72)]),
      new THREE.LineBasicMaterial({ color: '#39618d', transparent: true, opacity: 0.26 }),
    );
    lineChart.add(gridLine);
  });
  const lineLabel = createTextSprite('PERFORMANCE', '#9ddcff', 0.34);
  lineLabel.position.set(0, 0.12, 1.03);
  lineChart.add(lineLabel);
  root.add(lineChart);

  const polyChart = new THREE.Group();
  polyChart.position.set(4.5, 0.35, -2.45);
  addChartPlate(polyChart, 2.45, 2.45);
  const poly = addShadowedMesh(
    polyChart,
    new THREE.IcosahedronGeometry(1.08, 1),
    standardMaterial('#229cff', { roughness: 0.24 }),
    [0, 1.05, 0],
    [0.08, -0.42, 0.12],
  );
  addEdges(poly, '#6ad7ff', 0.32);
  poly.userData.spin = 0.12;
  const polyLabel = createTextSprite('MARKET SHAPE', '#9ddcff', 0.3);
  polyLabel.position.set(0, 0.05, 1.05);
  polyChart.add(polyLabel);
  root.add(polyChart);

  const donutChart = new THREE.Group();
  donutChart.position.set(-2.75, 0.02, 1.35);
  addChartPlate(donutChart, 3.25, 3.25);
  let angle = Math.PI * 0.12;
  data.donut.forEach((share, index) => {
    const gap = 0.045;
    const span = share * Math.PI * 2 - gap;
    const segment = createDonutSegment(0.72, 1.25, angle + gap, angle + span, 0.32, COLORS[index]);
    segment.rotation.x = -Math.PI / 2;
    segment.position.y = 0.22 + (index === 2 ? 0.13 : 0);
    segment.userData.spin = index % 2 ? -0.08 : 0.06;
    donutChart.add(segment);
    angle += share * Math.PI * 2;
  });
  const donutLabel = createTextSprite('CHANNEL MIX', '#9ddcff', 0.32);
  donutLabel.position.set(0, 0.12, 1.44);
  donutChart.add(donutLabel);
  root.add(donutChart);

  const radialChart = new THREE.Group();
  radialChart.position.set(1.05, 0.04, 1.35);
  addChartPlate(radialChart, 3.45, 3.25);
  const radialValues = [0.92, 0.76, 0.61, 0.45];
  radialValues.forEach((value, index) => {
    const radius = 0.62 + index * 0.24;
    const points = [];
    const start = Math.PI * 0.15;
    const end = start + Math.PI * 1.65 * value;
    for (let step = 0; step <= 48; step += 1) {
      const stepAngle = start + (end - start) * (step / 48);
      points.push(new THREE.Vector3(Math.cos(stepAngle) * radius, 0.14 + index * 0.035, Math.sin(stepAngle) * radius));
    }
    const radialCurve = new THREE.CatmullRomCurve3(points);
    addShadowedMesh(
      radialChart,
      new THREE.TubeGeometry(radialCurve, 64, 0.075, 8, false),
      standardMaterial(COLORS[index], { roughness: 0.24 }),
      [0, 0, 0],
    );
  });
  const radialLabel = createTextSprite('GOAL PROGRESS', '#9ddcff', 0.32);
  radialLabel.position.set(0, 0.12, 1.45);
  radialChart.add(radialLabel);
  root.add(radialChart);

  const pieChart = new THREE.Group();
  pieChart.position.set(4.35, 0.06, 1.25);
  addChartPlate(pieChart, 3.1, 3.1);
  let pieAngle = Math.PI * 0.18;
  data.donut.forEach((share, index) => {
    const segment = createDonutSegment(0.02, 1.12, pieAngle + 0.035, pieAngle + share * Math.PI * 2 - 0.035, 0.38, COLORS[index]);
    segment.rotation.x = -Math.PI / 2;
    segment.position.y = 0.22 + (index === 3 ? 0.18 : 0);
    pieChart.add(segment);
    pieAngle += share * Math.PI * 2;
  });
  const center = addShadowedMesh(
    pieChart,
    new THREE.CylinderGeometry(0.36, 0.36, 0.48, 32),
    standardMaterial('#263653', { metalness: 0.52, roughness: 0.2, transparent: true, opacity: 0.88 }),
    [0, 0.42, 0],
  );
  addEdges(center, '#a5dcff', 0.34);
  const pieLabel = createTextSprite('AUDIENCE SPLIT', '#9ddcff', 0.32);
  pieLabel.position.set(0, 0.12, 1.37);
  pieChart.add(pieLabel);
  root.add(pieChart);

  const barsTop = new THREE.Group();
  barsTop.position.set(-0.2, 0.15, -5.35);
  [0.75, 1.12, 1.55, 2.12].forEach((height, index) => {
    const tower = addShadowedMesh(
      barsTop,
      new THREE.BoxGeometry(0.72, height, 0.72),
      standardMaterial(COLORS[index], { roughness: 0.25 }),
      [-1.35 + index * 0.92, height / 2, 0],
      [0, -0.16, 0],
    );
    tower.userData.pulsePhase = index * 0.8;
  });
  root.add(barsTop);

  const chips = new THREE.Group();
  chips.position.set(-5.2, 0.12, 1.15);
  COLORS.forEach((color, index) => {
    const chip = addShadowedMesh(
      chips,
      new THREE.CylinderGeometry(0.22, 0.22, 0.16, 28),
      standardMaterial(color),
      [0, 0.05, -1.05 + index * 0.68],
    );
    chip.userData.spin = 0.2 + index * 0.04;
  });
  root.add(chips);

  return root;
}

function SpatialChartsPage({ onNavigate }) {
  const mountRef = useRef(null);
  const controlsRef = useRef(null);
  const autoRotateRef = useRef(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [activeMetric, setActiveMetric] = useState('revenue');
  const data = DATASETS[activeMetric];

  useEffect(() => {
    autoRotateRef.current = autoRotate;
    if (controlsRef.current) controlsRef.current.autoRotate = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#080b1d');
    scene.fog = new THREE.FogExp2('#080b1d', 0.032);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(10.8, 9.2, 13.8);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.055;
    controls.enablePan = false;
    controls.minDistance = 9;
    controls.maxDistance = 27;
    controls.minPolarAngle = Math.PI * 0.17;
    controls.maxPolarAngle = Math.PI * 0.46;
    controls.target.set(0.2, 0.3, -0.55);
    controls.autoRotate = autoRotateRef.current;
    controls.autoRotateSpeed = 0.48;
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight('#7dbdff', '#070913', 1.25));
    const keyLight = new THREE.DirectionalLight('#d9ecff', 2.7);
    keyLight.position.set(-2, 12, 7);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -12;
    keyLight.shadow.camera.right = 12;
    keyLight.shadow.camera.top = 12;
    keyLight.shadow.camera.bottom = -12;
    scene.add(keyLight);
    const cyanLight = new THREE.PointLight('#1db8ff', 2.7, 18);
    cyanLight.position.set(-5, 3, 1);
    scene.add(cyanLight);
    const magentaLight = new THREE.PointLight('#ed2cff', 2.2, 16);
    magentaLight.position.set(5, 4, -3);
    scene.add(magentaLight);
    const orangeLight = new THREE.PointLight('#ff7b20', 1.8, 14);
    orangeLight.position.set(1, 2, 6);
    scene.add(orangeLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 27),
      new THREE.MeshStandardMaterial({ color: '#0e1328', metalness: 0.14, roughness: 0.67 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.23;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(28, 28, '#304266', '#18213d');
    grid.position.y = -0.165;
    grid.material.transparent = true;
    grid.material.opacity = 0.24;
    scene.add(grid);

    const chartRoot = buildSpatialCharts(scene, data);
    const clock = new THREE.Clock();
    let animationFrame = 0;

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);

    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();
      chartRoot.traverse((object) => {
        if (object.userData.spin) object.rotation.y += object.userData.spin * 0.0018;
        if (object.userData.pulsePhase !== undefined) {
          const pulse = 1 + Math.sin(elapsed * 1.25 + object.userData.pulsePhase) * 0.018;
          object.scale.y = pulse;
        }
      });
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      controlsRef.current = null;
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => {
            if (material.map) material.map.dispose();
            material.dispose();
          });
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [data]);

  const resetView = () => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.object.position.set(10.8, 9.2, 13.8);
    controls.target.set(0.2, 0.3, -0.55);
    controls.update();
  };

  return (
    <main className="spatial-charts-page">
      <div className="spatial-charts-glow" aria-hidden="true" />
      <div ref={mountRef} className="spatial-charts-canvas" aria-label="可拖拽旋转和缩放的三维数据图表场景" />

      <header className="spatial-charts-header">
        <button className="spatial-back-button" type="button" onClick={() => onNavigate('terrain')}>
          <span aria-hidden="true">←</span>
          返回
        </button>
        <div className="spatial-brand">
          <i aria-hidden="true" />
          DATASPACE
        </div>
        <div className="spatial-status"><i aria-hidden="true" /> LIVE SCENE</div>
      </header>

      <section className="spatial-intro">
        <p>{data.eyebrow}</p>
        <h1>3D 数据空间</h1>
        <span>在同一个三维场景里，让趋势、占比和结构真正“站起来”。</span>
      </section>

      <section className="spatial-metric-card" aria-live="polite">
        <div>
          <span>核心指标</span>
          <strong>{data.total}</strong>
        </div>
        <em>{data.change}</em>
        <p>较上一周期</p>
      </section>

      <section className="spatial-controls" aria-label="三维图表控制">
        <div className="spatial-metric-switch" role="group" aria-label="数据维度">
          {[
            ['revenue', '收入'],
            ['users', '用户'],
            ['conversion', '转化'],
          ].map(([key, label]) => (
            <button
              key={key}
              className={activeMetric === key ? 'active' : ''}
              type="button"
              onClick={() => setActiveMetric(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="spatial-view-actions">
          <button className={autoRotate ? 'active' : ''} type="button" onClick={() => setAutoRotate((value) => !value)}>
            <i aria-hidden="true" /> {autoRotate ? '自动旋转中' : '自动旋转'}
          </button>
          <button type="button" onClick={resetView}>重置视角</button>
        </div>
      </section>

      <div className="spatial-legend" aria-label="图表类型">
        <span>柱状趋势</span>
        <span>曲线走势</span>
        <span>渠道占比</span>
        <span>目标进度</span>
      </div>

      <p className="spatial-hint"><span aria-hidden="true">↔</span> 拖拽旋转 · 滚轮缩放</p>
    </main>
  );
}

export default SpatialChartsPage;
