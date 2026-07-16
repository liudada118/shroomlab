import React, { useEffect, useMemo, useRef, useState } from 'react';
import BoneControlPage from './BoneControlPage.jsx';
import GloveMotionPage from './GloveMotionPage.jsx';
import HandWireframePage from './HandWireframePage.jsx';
import LightStudyPage from './LightStudyPage.jsx';
import ObjModelPage from './ObjModelPage.jsx';
import PointEditorPage, { getInitialEditorPoints, sanitizeEditorPoints } from './PointEditorPage.jsx';
import PressureTerrain from './PressureTerrain.jsx';
import RegionObjPage from './RegionObjPage.jsx';
import SpatialChartsPage from './SpatialChartsPage.jsx';
import TextureMapPage from './TextureMapPage.jsx';
import VideoPointGridEditor, { readStoredVideoPoints } from './VideoPointGridEditor.jsx';
import {
  DEFAULT_GAUSSIAN_KERNEL_SIZE,
  HAND_R_VIDEO_POINTS,
  MATRIX_SIZE_OPTIONS,
  SENSOR_MATRIX_SIZE,
  buildHandPressureFrame,
} from './handPressureData.js';
import {
  DEFAULT_PRESSURE_PALETTE,
  PRESSURE_COLOR_STOPS,
  pressureColorAt,
} from './pressurePalette.js';
import { clearManualPressureFrame, replaceManualPressureFrame } from './serialPressureStore.js';
import { useWebSocketPressureSource } from './webSocketPressureSource.js';

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
  if (window.location.hash === '#/glb-bones') {
    return 'bones';
  }
  if (window.location.hash === '#/glove-motion') {
    return 'gloveMotion';
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
  if (window.location.hash === '#/pressure2' || window.location.hash === '#/texture-map') {
    return 'texture';
  }
  if (window.location.hash === '#/light-study') {
    return 'lightStudy';
  }
  if (window.location.hash === '#/spatial-charts') {
    return 'spatialCharts';
  }
  return 'terrain';
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function arrayFromUnknown(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (ArrayBuffer.isView(value)) {
    return Array.from(value);
  }

  return null;
}

function parsePressureArrayText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return null;
  }

  const trimmed = text.trim();
  let parsed = null;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const startIndex = trimmed.indexOf('[');
    const endIndex = trimmed.lastIndexOf(']');

    if (startIndex >= 0 && endIndex > startIndex) {
      try {
        parsed = Function(`"use strict"; return (${trimmed.slice(startIndex, endIndex + 1)});`)();
      } catch {
        parsed = null;
      }
    }

    if (!parsed) {
      const numbers = trimmed
        .split(/[,\s]+/)
        .map(Number)
        .filter((value) => Number.isFinite(value));
      parsed = numbers.length ? numbers : null;
    }
  }

  if (!parsed) {
    return null;
  }

  const parsedObject = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  const mappedPressureData = parsedObject ? arrayFromUnknown(parsedObject.newArr147 ?? parsedObject.mappedPressureData) : null;
  if (mappedPressureData?.length === HAND_R_VIDEO_POINTS.length) {
    return { mappedPressureData };
  }

  const pressureData = parsedObject
    ? arrayFromUnknown(
        parsedObject.pressureData ??
        parsedObject.rawPressureData ??
        parsedObject.realArr ??
        parsedObject.data ??
        parsedObject.values,
      )
    : null;
  if (pressureData?.length === 256) {
    return { pressureData };
  }

  const array = arrayFromUnknown(parsed);
  if (array?.length === HAND_R_VIDEO_POINTS.length) {
    return { mappedPressureData: array };
  }
  if (array?.length === 256) {
    return { pressureData: array };
  }

  return null;
}

function MatrixPanel({ colorDepth, matrixSize, gaussianKernelSize, pressurePalette, sourcePoints, videoPoints, dataVersion }) {
  const matrix = useMemo(
    () => buildHandPressureFrame(0.8, { matrixSize, gaussianKernelSize, sourcePoints, videoPoints }).matrix,
    [dataVersion, gaussianKernelSize, matrixSize, sourcePoints, videoPoints],
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

function DataSourceControl({ dataSource }) {
  const { status, snapshot, activeHandSide, setActiveHandSide, connect, disconnect } = dataSource;
  const [manualStatus, setManualStatus] = useState('');
  const manualActive = snapshot?.source === 'manual';
  const lastFrameTime = snapshot?.timestamp
    ? `${Math.max(0, Date.now() - snapshot.timestamp)} ms`
    : 'none';

  const pastePressureArray = async () => {
    if (!navigator.clipboard?.readText) {
      setManualStatus('Paste unavailable');
      return;
    }

    const frameData = parsePressureArrayText(await navigator.clipboard.readText());
    if (!frameData) {
      setManualStatus(`Need ${HAND_R_VIDEO_POINTS.length} or 256 values`);
      return;
    }

    replaceManualPressureFrame({
      handSide: activeHandSide,
      ...frameData,
      timestamp: Date.now(),
    });
    setManualStatus(frameData.mappedPressureData ? `Manual ${HAND_R_VIDEO_POINTS.length}` : 'Manual 256');
  };

  const clearPressureArray = () => {
    clearManualPressureFrame();
    setManualStatus('Live source');
  };

  return (
    <div className="serial-source-control" aria-label="Pressure data channel">
      <div className="serial-source-header">
        <span>Data Channel</span>
        <strong className={status.connected || manualActive ? 'online' : ''}>
          {manualActive ? 'MANUAL' : status.connected ? 'LIVE' : status.connecting ? 'WS...' : 'SIM'}
        </strong>
      </div>
      <div className="serial-side-toggle" role="group" aria-label="Active hand side">
        {['left', 'right'].map((side) => (
          <button
            key={side}
            className={activeHandSide === side ? 'active' : ''}
            type="button"
            onClick={() => setActiveHandSide(side)}
          >
            {side}
          </button>
        ))}
      </div>
      <div className="serial-source-actions">
        <button type="button" onClick={connect} disabled={!status.supported || status.connected || status.connecting}>
          {status.connecting ? 'Connecting' : 'Connect WS'}
        </button>
        <button type="button" onClick={disconnect} disabled={!status.connected && !status.connecting}>
          Stop
        </button>
      </div>
      <div className="serial-source-actions">
        <button type="button" onClick={pastePressureArray}>
          Paste Array
        </button>
        <button type="button" onClick={clearPressureArray} disabled={!manualActive}>
          Clear Array
        </button>
      </div>
      <dl>
        <div>
          <dt>URL</dt>
          <dd title={status.url}>{status.url}</dd>
        </div>
        <div>
          <dt>Frames</dt>
          <dd>{status.frameCount}</dd>
        </div>
        <div>
          <dt>Drops</dt>
          <dd>{status.dropCount}</dd>
        </div>
        <div>
          <dt>Last</dt>
          <dd>{lastFrameTime}</dd>
        </div>
        <div>
          <dt>Array</dt>
          <dd>{manualStatus || (manualActive ? 'Manual' : 'Live')}</dd>
        </div>
      </dl>
      {status.error ? <p>{status.error}</p> : null}
    </div>
  );
}

function StatsPanel({ colorDepth, matrixSize, gaussianKernelSize, pressurePalette, sourcePoints, videoPoints, dataVersion }) {
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
        videoPoints={videoPoints}
        dataVersion={dataVersion}
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
  onFullscreen,
  dataSource,
}) {
  return (
    <section className="terrain-controls" aria-label="Terrain controls">
      <DataSourceControl dataSource={dataSource} />
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
          min="0.1"
          max="20"
          step="0.1"
          value={heightScale}
          onChange={(event) => onHeightScaleChange(Number(event.target.value))}
        />
        <strong>{heightScale.toFixed(2)}</strong>
      </label>
      <label>
        <span>Color</span>
        <input
          type="range"
          min="0.1"
          max="12"
          step="0.1"
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
      <button className="terrain-fullscreen-action" type="button" onClick={onFullscreen}>
        Fullscreen 3D
      </button>
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
  const [videoPoints, setVideoPoints] = useState(readStoredVideoPoints);
  const terrainPanelRef = useRef(null);
  const dataSource = useWebSocketPressureSource();
  const dataVersion = dataSource.snapshot?.timestamp || dataSource.status.frameCount;

  useEffect(() => {
    setSourcePoints(sanitizeEditorPoints(videoPoints));
  }, [videoPoints]);

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
      lightStudy: '/light-study',
      bones: '/glb-bones',
      gloveMotion: '/glove-motion',
      obj: '/obj-model',
      points: '/point-editor',
      pressure2: '/texture-map',
      regionObj: '/region-obj',
      spatialCharts: '/spatial-charts',
      terrain: '/',
      texture: '/texture-map',
    };
    window.location.hash = routeMap[nextPage] || '/';
  };

  const toggleTerrainFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }

    await terrainPanelRef.current?.requestFullscreen?.();
  };

  if (page === 'hand') {
    return <HandWireframePage onNavigate={navigate} />;
  }

  if (page === 'bones') {
    return <BoneControlPage onNavigate={navigate} />;
  }

  if (page === 'gloveMotion') {
    return <GloveMotionPage onNavigate={navigate} />;
  }

  if (page === 'points') {
    return <VideoPointGridEditor onNavigate={navigate} points={videoPoints} onPointsChange={setVideoPoints} />;
  }

  if (page === 'obj') {
    return <ObjModelPage onNavigate={navigate} videoPoints={videoPoints} />;
  }

  if (page === 'regionObj') {
    return <RegionObjPage onNavigate={navigate} />;
  }

  if (page === 'texture') {
    return (
      <TextureMapPage
        onNavigate={navigate}
        dataSource={dataSource}
        sourcePoints={sourcePoints}
        videoPoints={videoPoints}
        pressurePalette={pressurePalette}
      />
    );
  }

  if (page === 'lightStudy') {
    return <LightStudyPage onNavigate={navigate} />;
  }

  if (page === 'spatialCharts') {
    return <SpatialChartsPage onNavigate={navigate} />;
  }

  return (
    <main className="dashboard-shell dashboard-shell-with-editor">
      <nav className="app-nav" style={{ '--nav-count': 9 }} aria-label="Page view">
        <button className="active" type="button" onClick={() => navigate('terrain')}>
          Pressure
        </button>
        <button type="button" onClick={() => navigate('texture')}>
          Texture
        </button>
        <button type="button" onClick={() => navigate('hand')}>
          Wireframe
        </button>
        <button type="button" onClick={() => navigate('obj')}>
          OBJ
        </button>
        <button type="button" onClick={() => navigate('bones')}>
          Bones
        </button>
        <button type="button" onClick={() => navigate('gloveMotion')}>
          Motion
        </button>
        <button type="button" onClick={() => navigate('points')}>
          Points
        </button>
        <button type="button" onClick={() => navigate('lightStudy')}>
          Light
        </button>
        <button type="button" onClick={() => navigate('spatialCharts')}>
          Charts
        </button>
      </nav>

      <section className="pressure-editor-stack" aria-label="Pressure mapping editors">
        <VideoPointGridEditor
          embedded
          onNavigate={navigate}
          points={videoPoints}
          onPointsChange={setVideoPoints}
        />
        <PointEditorPage
          embedded
          onNavigate={navigate}
          points={sourcePoints}
          onPointsChange={setSourcePoints}
        />
      </section>

      <section className="terrain-panel" ref={terrainPanelRef}>
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
          onFullscreen={toggleTerrainFullscreen}
          dataSource={dataSource}
        />

        <PressureTerrain
          heightScale={heightScale}
          colorDepth={colorDepth}
          matrixSize={matrixSize}
          gaussianKernelSize={gaussianKernelSize}
          pressurePalette={pressurePalette}
          sourcePoints={sourcePoints}
          videoPoints={videoPoints}
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
        videoPoints={videoPoints}
        dataVersion={dataVersion}
      />
    </main>
  );
}

export default App;
