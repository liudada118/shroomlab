import React, { useEffect, useMemo, useState } from 'react';
import HandWireframePage from './HandWireframePage.jsx';
import ObjModelPage from './ObjModelPage.jsx';
import PointEditorPage, { getInitialEditorPoints } from './PointEditorPage.jsx';
import PressureTerrain from './PressureTerrain.jsx';
import RegionObjPage from './RegionObjPage.jsx';
import {
  DEFAULT_GAUSSIAN_KERNEL_SIZE,
  MATRIX_SIZE_OPTIONS,
  SENSOR_MATRIX_SIZE,
  buildHandPressureFrame,
} from './handPressureData.js';
import {
  DEFAULT_PRESSURE_PALETTE,
  PRESSURE_COLOR_STOPS,
  pressureColorAt,
} from './pressurePalette.js';

const peakRows = [
  ['Index Finger', '22.1N', 'danger'],
  ['Middle Finger', '20.3N', 'danger'],
  ['Thumb', '18.7N', 'warn'],
  ['Ring Finger', '16.8N', 'warn'],
  ['Pinky', '10.2N', 'ok'],
];

function pageFromHash() {
  if (window.location.hash === '#/hand-wireframe') {
    return 'hand';
  }
  if (window.location.hash === '#/point-editor') {
    return 'points';
  }
  if (window.location.hash === '#/obj-model') {
    return 'obj';
  }
  if (window.location.hash === '#/region-obj') {
    return 'regionObj';
  }
  if (window.location.hash === '#/pressure2') {
    return 'pressure2';
  }
  return 'terrain';
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function MatrixPanel({ colorDepth, matrixSize, gaussianKernelSize, pressurePalette, sourcePoints }) {
  const matrix = useMemo(
    () => buildHandPressureFrame(0.8, { matrixSize, gaussianKernelSize, sourcePoints }).matrix,
    [gaussianKernelSize, matrixSize, sourcePoints],
  );

  return (
    <section className="side-card matrix-card" aria-label="Sensor matrix">
      <h2>Sensor Matrix ({matrixSize}x{matrixSize})</h2>
      <div className="sensor-grid" style={{ '--matrix-size': matrixSize }}>
        {matrix.flatMap((row, y) =>
          row.map((value, x) => {
            const displayPressure = clamp01(value * colorDepth);
            const displayColor = pressureColorAt(value, colorDepth, pressurePalette);

            return (
              <span
                key={`${x}-${y}`}
                className={`sensor-dot${value > 0 ? ' active' : ''}`}
                style={{
                  '--pressure': displayPressure,
                  backgroundColor: value > 0 ? displayColor : undefined,
                  boxShadow: value > 0 ? `0 0 ${2 + displayPressure * 8}px ${displayColor}` : undefined,
                }}
                aria-hidden="true"
              />
            );
          }),
        )}
      </div>
    </section>
  );
}

function StatsPanel({ colorDepth, matrixSize, gaussianKernelSize, pressurePalette, sourcePoints }) {
  return (
    <aside className="stats-column">
      <section className="side-card force-card">
        <h2>Total Force Output</h2>
        <strong>88.1</strong>
        <span>Newton (N)</span>
      </section>

      <section className="side-card peak-card">
        <h2>Peak Pressure Points</h2>
        <ul>
          {peakRows.map(([label, value, tone]) => (
            <li key={label}>
              <span>{label}</span>
              <strong className={tone}>{value}</strong>
            </li>
          ))}
        </ul>
      </section>

      <MatrixPanel
        colorDepth={colorDepth}
        matrixSize={matrixSize}
        gaussianKernelSize={gaussianKernelSize}
        pressurePalette={pressurePalette}
        sourcePoints={sourcePoints}
      />
    </aside>
  );
}

function TerrainControls({
  heightScale,
  colorDepth,
  matrixSize,
  gaussianKernelSize,
  pressurePalette,
  onHeightScaleChange,
  onColorDepthChange,
  onMatrixSizeChange,
  onGaussianKernelSizeChange,
  onPressurePaletteChange,
  onPressurePaletteReset,
}) {
  return (
    <section className="terrain-controls" aria-label="Terrain controls">
      <div className="matrix-size-toggle" aria-label="Matrix size">
        {MATRIX_SIZE_OPTIONS.map((size) => (
          <button
            key={size}
            className={matrixSize === size ? 'active' : ''}
            type="button"
            onClick={() => onMatrixSizeChange(size)}
          >
            {size}
          </button>
        ))}
      </div>
      <label>
        <span>Height</span>
        <input
          type="range"
          min="0.7"
          max="3"
          step="0.05"
          value={heightScale}
          onChange={(event) => onHeightScaleChange(Number(event.target.value))}
        />
        <strong>{heightScale.toFixed(2)}</strong>
      </label>
      <label>
        <span>Color</span>
        <input
          type="range"
          min="0.55"
          max="1.9"
          step="0.05"
          value={colorDepth}
          onChange={(event) => onColorDepthChange(Number(event.target.value))}
        />
        <strong>{colorDepth.toFixed(2)}</strong>
      </label>
      <label>
        <span>Gaussian</span>
        <input
          type="range"
          min="1"
          max="9"
          step="2"
          value={gaussianKernelSize}
          onChange={(event) => onGaussianKernelSizeChange(Number(event.target.value))}
        />
        <strong>{gaussianKernelSize}x{gaussianKernelSize}</strong>
      </label>
      <div className="heat-palette-control">
        <div className="heat-palette-heading">
          <span>Heat colors</span>
          <button type="button" onClick={onPressurePaletteReset}>Reset</button>
        </div>
        <div className="heat-palette-grid">
          {PRESSURE_COLOR_STOPS.map((stop, index) => (
            <label key={stop.label} title={`${stop.label}: ${pressurePalette[index]}`}>
              <span>{stop.label}</span>
              <input
                type="color"
                value={pressurePalette[index]}
                aria-label={`${stop.label} heat map color`}
                onChange={(event) => onPressurePaletteChange(index, event.target.value)}
              />
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}

function App() {
  const [page, setPage] = useState(pageFromHash);
  const [heightScale, setHeightScale] = useState(1.85);
  const [colorDepth, setColorDepth] = useState(1.25);
  const [matrixSize, setMatrixSize] = useState(SENSOR_MATRIX_SIZE);
  const [gaussianKernelSize, setGaussianKernelSize] = useState(DEFAULT_GAUSSIAN_KERNEL_SIZE);
  const [pressurePalette, setPressurePalette] = useState(() => [...DEFAULT_PRESSURE_PALETTE]);
  const [sourcePoints, setSourcePoints] = useState(getInitialEditorPoints);

  const updatePressurePalette = (index, color) => {
    setPressurePalette((currentPalette) =>
      currentPalette.map((currentColor, colorIndex) => (colorIndex === index ? color : currentColor)),
    );
  };

  useEffect(() => {
    const syncPage = () => setPage(pageFromHash());
    window.addEventListener('hashchange', syncPage);
    return () => window.removeEventListener('hashchange', syncPage);
  }, []);

  const navigate = (nextPage) => {
    const routeMap = {
      hand: '/hand-wireframe',
      obj: '/obj-model',
      points: '/point-editor',
      pressure2: '/pressure2',
      regionObj: '/region-obj',
      terrain: '/',
    };
    window.location.hash = routeMap[nextPage] || '/';
  };

  if (page === 'hand') {
    return <HandWireframePage onNavigate={navigate} />;
  }

  if (page === 'points') {
    return <PointEditorPage onNavigate={navigate} points={sourcePoints} onPointsChange={setSourcePoints} />;
  }

  if (page === 'obj') {
    return <ObjModelPage onNavigate={navigate} />;
  }

  if (page === 'regionObj') {
    return <RegionObjPage onNavigate={navigate} />;
  }

  return (
    <main className="dashboard-shell dashboard-shell-with-editor">
      <nav className="app-nav" style={{ '--nav-count': 5 }} aria-label="Page view">
        <button className="active" type="button" onClick={() => navigate('terrain')}>
          Pressure
        </button>
        <button type="button" onClick={() => navigate('pressure2')}>
          Pressure2
        </button>
        <button type="button" onClick={() => navigate('hand')}>
          Wireframe
        </button>
        <button type="button" onClick={() => navigate('obj')}>
          OBJ
        </button>
        <button type="button" onClick={() => navigate('points')}>
          Points
        </button>
      </nav>

      <PointEditorPage
        embedded
        onNavigate={navigate}
        points={sourcePoints}
        onPointsChange={setSourcePoints}
      />

      <section className="terrain-panel">
        <header className="panel-title">
          <h1>3D Pressure Terrain Map</h1>
          <p>手掌压力三维地形可视化 · 实时数据映射</p>
        </header>

        <TerrainControls
          heightScale={heightScale}
          colorDepth={colorDepth}
          matrixSize={matrixSize}
          gaussianKernelSize={gaussianKernelSize}
          pressurePalette={pressurePalette}
          onHeightScaleChange={setHeightScale}
          onColorDepthChange={setColorDepth}
          onMatrixSizeChange={setMatrixSize}
          onGaussianKernelSizeChange={setGaussianKernelSize}
          onPressurePaletteChange={updatePressurePalette}
          onPressurePaletteReset={() => setPressurePalette([...DEFAULT_PRESSURE_PALETTE])}
        />

        <PressureTerrain
          heightScale={heightScale}
          colorDepth={colorDepth}
          matrixSize={matrixSize}
          gaussianKernelSize={gaussianKernelSize}
          pressurePalette={pressurePalette}
          sourcePoints={sourcePoints}
        />

        <div className="view-tabs" aria-label="Map view mode">
          <button className="active" type="button">3D View</button>
          <button type="button">Top View</button>
          <button type="button">Side View</button>
        </div>
      </section>

      <StatsPanel
        colorDepth={colorDepth}
        matrixSize={matrixSize}
        gaussianKernelSize={gaussianKernelSize}
        pressurePalette={pressurePalette}
        sourcePoints={sourcePoints}
      />
    </main>
  );
}

export default App;
