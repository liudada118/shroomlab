import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  HAND_R_VIDEO_POINTS,
  SOURCE_MATRIX_SIZE,
  VIDEO_POINT_BLOCK_SIZE,
  VIDEO_POINT_MATRIX_SIZE,
} from './handPressureData.js';

const EDITOR_MATRIX_SIZE = SOURCE_MATRIX_SIZE;
const POINT_DRAFT_STORAGE_KEY = 'shroomLab.handPointEditor.draft.v4';
const POINT_VERSIONS_STORAGE_KEY = 'shroomLab.handPointEditor.versions.v1';
const POINT_CELL_SIZE_STORAGE_KEY = 'shroomLab.handPointEditor.cellSize.v1';
const POINT_GRID_SIZE_STORAGE_KEY = 'shroomLab.handPointEditor.gridSize.v1';
const DEFAULT_POINT_CELL_SIZE = 5;
const MIN_POINT_CELL_SIZE = 3;
const MAX_POINT_CELL_SIZE = 10;

function pointKey(row, col) {
  return `${row}:${col}`;
}

function sortPoints(points) {
  return [...points].sort(([rowA, colA], [rowB, colB]) => rowA - rowB || colA - colB);
}

function scaleCoordinate(value, fromSize, toSize) {
  if (fromSize === VIDEO_POINT_MATRIX_SIZE && toSize === EDITOR_MATRIX_SIZE) {
    return Math.max(0, Math.min(toSize - 1, value * VIDEO_POINT_BLOCK_SIZE));
  }

  return Math.round((value / Math.max(1, fromSize - 1)) * (toSize - 1));
}

function scalePoint(point, fromSize, toSize) {
  return [scaleCoordinate(point[0], fromSize, toSize), scaleCoordinate(point[1], fromSize, toSize)];
}

function videoPointToEditorBlock(point) {
  const startRow = scaleCoordinate(point[0], VIDEO_POINT_MATRIX_SIZE, EDITOR_MATRIX_SIZE);
  const startCol = scaleCoordinate(point[1], VIDEO_POINT_MATRIX_SIZE, EDITOR_MATRIX_SIZE);
  const blockPoints = [];

  for (let rowOffset = 0; rowOffset < VIDEO_POINT_BLOCK_SIZE; rowOffset += 1) {
    for (let colOffset = 0; colOffset < VIDEO_POINT_BLOCK_SIZE; colOffset += 1) {
      blockPoints.push([
        Math.min(EDITOR_MATRIX_SIZE - 1, startRow + rowOffset),
        Math.min(EDITOR_MATRIX_SIZE - 1, startCol + colOffset),
      ]);
    }
  }

  return blockPoints;
}

export function scaleVideoPointsToEditorPoints(points) {
  return sanitizeEditorPoints((Array.isArray(points) ? points : HAND_R_VIDEO_POINTS).flatMap((point) => (
    Array.isArray(point) && point.length === 2
      ? videoPointToEditorBlock(point)
      : [0, 0]
  )));
}

function migratePointsToEditorSize(points, fromSize = VIDEO_POINT_MATRIX_SIZE) {
  if (fromSize === EDITOR_MATRIX_SIZE) {
    return points;
  }

  return points.map((point) => scalePoint(point, fromSize, EDITOR_MATRIX_SIZE));
}

function isValidPoint(point) {
  return (
    Array.isArray(point) &&
    point.length === 2 &&
    Number.isInteger(point[0]) &&
    Number.isInteger(point[1]) &&
    point[0] >= 0 &&
    point[0] < EDITOR_MATRIX_SIZE &&
    point[1] >= 0 &&
    point[1] < EDITOR_MATRIX_SIZE
  );
}

export function sanitizeEditorPoints(points) {
  if (!Array.isArray(points)) {
    return [];
  }

  const seen = new Set();
  const sanitized = [];

  points.forEach((point) => {
    if (!isValidPoint(point)) {
      return;
    }

    const [row, col] = point;
    const key = pointKey(row, col);
    if (!seen.has(key)) {
      seen.add(key);
      sanitized.push([row, col]);
    }
  });

  return sortPoints(sanitized);
}

function uniqueInitialPoints(videoPoints = HAND_R_VIDEO_POINTS) {
  return scaleVideoPointsToEditorPoints(videoPoints);
}

export function formatPointArray(points) {
  const sorted = sortPoints(points);
  const lines = [];

  for (let i = 0; i < sorted.length; i += 8) {
    lines.push(sorted.slice(i, i + 8).map(([row, col]) => `[${row}, ${col}]`).join(', '));
  }

  return `const HAND_COORDINATE_POINTS = Object.freeze([\n  ${lines.join(',\n  ')}${lines.length ? ',' : ''}\n]);`;
}

function parsePointArrayText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return null;
  }

  const trimmed = text.trim();

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? sanitizeEditorPoints(parsed) : null;
  } catch {
    // Continue with JS array extraction below.
  }

  const startIndex = trimmed.indexOf('[');
  const endIndex = trimmed.lastIndexOf(']');
  if (startIndex >= 0 && endIndex > startIndex) {
    try {
      const parsed = Function(`"use strict"; return (${trimmed.slice(startIndex, endIndex + 1)});`)();
      return Array.isArray(parsed) ? sanitizeEditorPoints(parsed) : null;
    } catch {
      // Continue with numeric pair parsing below.
    }
  }

  const numbers = trimmed
    .split(/[,\s\[\]]+/)
    .map(Number)
    .filter((value) => Number.isFinite(value));

  if (numbers.length < 2 || numbers.length % 2 !== 0) {
    return null;
  }

  const points = [];
  for (let index = 0; index < numbers.length; index += 2) {
    points.push([numbers[index], numbers[index + 1]]);
  }

  return sanitizeEditorPoints(points);
}

function readLocalStorage(key) {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocalStorage(key, value) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local persistence is a convenience layer; editing should still work without it.
  }
}

export function readStoredDraft(fallbackPoints = uniqueInitialPoints()) {
  const draft = readLocalStorage(POINT_DRAFT_STORAGE_KEY);
  if (!Array.isArray(draft)) {
    return sanitizeEditorPoints(fallbackPoints);
  }

  const storedGridSize = Number(readLocalStorage(POINT_GRID_SIZE_STORAGE_KEY) ?? VIDEO_POINT_MATRIX_SIZE);
  const points = Number.isFinite(storedGridSize) && storedGridSize > 0 && storedGridSize !== EDITOR_MATRIX_SIZE
    ? migratePointsToEditorSize(draft, storedGridSize)
    : draft;

  return sanitizeEditorPoints(points);
}

export function getInitialEditorPoints(videoPoints = HAND_R_VIDEO_POINTS) {
  return readStoredDraft(uniqueInitialPoints(videoPoints));
}

function readStoredCellSize() {
  const storedValue = readLocalStorage(POINT_CELL_SIZE_STORAGE_KEY);
  const storedSize = Number(storedValue);
  return storedValue !== null && Number.isFinite(storedSize)
    ? Math.max(MIN_POINT_CELL_SIZE, Math.min(MAX_POINT_CELL_SIZE, storedSize))
    : DEFAULT_POINT_CELL_SIZE;
}

function sanitizeVersion(version, index) {
  if (!version || typeof version !== 'object') {
    return null;
  }

  const points = sanitizeEditorPoints(version.points);
  const gridSize = Number(version.gridSize ?? VIDEO_POINT_MATRIX_SIZE);
  const migratedPoints = Number.isFinite(gridSize) && gridSize > 0 && gridSize !== EDITOR_MATRIX_SIZE
    ? sanitizeEditorPoints(migratePointsToEditorSize(points, gridSize))
    : points;

  const fallbackDate = new Date().toISOString();
  const id = typeof version.id === 'string' && version.id ? version.id : `stored-${index}`;
  const name =
    typeof version.name === 'string' && version.name.trim()
      ? version.name.trim()
      : `Version ${index + 1}`;

  return {
    id,
    name,
    points: migratedPoints,
    gridSize: EDITOR_MATRIX_SIZE,
    createdAt: typeof version.createdAt === 'string' ? version.createdAt : fallbackDate,
    updatedAt: typeof version.updatedAt === 'string' ? version.updatedAt : fallbackDate,
  };
}

function readStoredVersions() {
  const versions = readLocalStorage(POINT_VERSIONS_STORAGE_KEY);
  if (!Array.isArray(versions)) {
    return [];
  }

  return versions.map(sanitizeVersion).filter(Boolean);
}

function createVersionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function PointEditorPage({
  onNavigate,
  embedded = false,
  points: controlledPoints,
  onPointsChange,
  baseVideoPoints,
  onProjectVideoPoints,
}) {
  const initialEditorPoints = useMemo(() => uniqueInitialPoints(baseVideoPoints), [baseVideoPoints]);
  const isControlled = Array.isArray(controlledPoints) && typeof onPointsChange === 'function';
  const [internalPoints, setInternalPoints] = useState(() => readStoredDraft(initialEditorPoints));
  const [versions, setVersions] = useState(readStoredVersions);
  const [versionName, setVersionName] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [lastPoint, setLastPoint] = useState(null);
  const [arrayInput, setArrayInput] = useState('');
  const [arrayInputStatus, setArrayInputStatus] = useState('');
  const [pointCellSize, setPointCellSize] = useState(readStoredCellSize);
  const [expandedEditorOpen, setExpandedEditorOpen] = useState(false);
  const [expandedPointCellSize, setExpandedPointCellSize] = useState(7);
  const dragRef = useRef({ active: false, mode: 'add', touched: new Set() });
  const pointsRef = useRef([]);
  const points = useMemo(
    () => (isControlled ? sanitizeEditorPoints(controlledPoints) : internalPoints),
    [controlledPoints, internalPoints, isControlled],
  );
  const pointSet = useMemo(() => new Set(points.map(([row, col]) => pointKey(row, col))), [points]);
  const output = useMemo(() => formatPointArray(points), [points]);
  const selectedVersion = useMemo(
    () => versions.find((version) => version.id === selectedVersionId) || null,
    [selectedVersionId, versions],
  );

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    writeLocalStorage(POINT_DRAFT_STORAGE_KEY, points);
    writeLocalStorage(POINT_GRID_SIZE_STORAGE_KEY, EDITOR_MATRIX_SIZE);
  }, [points]);

  useEffect(() => {
    writeLocalStorage(POINT_VERSIONS_STORAGE_KEY, versions);
  }, [versions]);

  useEffect(() => {
    writeLocalStorage(POINT_CELL_SIZE_STORAGE_KEY, pointCellSize);
  }, [pointCellSize]);

  useEffect(() => {
    setArrayInput(output);
  }, [output]);

  const commitPoints = (nextPoints) => {
    const sanitizedPoints = sanitizeEditorPoints(nextPoints);
    pointsRef.current = sanitizedPoints;
    if (isControlled) {
      onPointsChange(sanitizedPoints);
    } else {
      setInternalPoints(sanitizedPoints);
    }
  };

  const paintPoint = (row, col, mode) => {
    const key = pointKey(row, col);
    const dragState = dragRef.current;
    if (dragState.touched.has(key)) {
      return;
    }

    dragState.touched.add(key);
    const currentPoints = pointsRef.current;
    const exists = currentPoints.some(([pointRow, pointCol]) => pointRow === row && pointCol === col);

    if (mode === 'add' && exists) {
      return;
    }

    if (mode === 'remove' && !exists) {
      return;
    }

    const nextPoints =
      mode === 'add'
        ? sortPoints([...currentPoints, [row, col]])
        : currentPoints.filter(([pointRow, pointCol]) => pointRow !== row || pointCol !== col);

    commitPoints(nextPoints);
    setLastPoint({ row, col, action: mode === 'add' ? 'added' : 'removed' });
  };

  const togglePoint = (row, col) => {
    const key = pointKey(row, col);
    const exists = pointSet.has(key);

    commitPoints(
      exists
        ? points.filter(([pointRow, pointCol]) => pointRow !== row || pointCol !== col)
        : sortPoints([...points, [row, col]]),
    );
    setLastPoint({ row, col, action: exists ? 'removed' : 'added' });
  };

  const resetPoints = () => {
    commitPoints(initialEditorPoints);
    setLastPoint(null);
  };

  const clearPoints = () => {
    commitPoints([]);
    setLastPoint(null);
  };

  const copyOutput = async () => {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(output);
      setArrayInputStatus('Copied');
    }
  };

  const applyArrayInput = () => {
    const parsedPoints = parsePointArrayText(arrayInput);
    if (!parsedPoints) {
      setArrayInputStatus('Invalid array');
      return;
    }

    commitPoints(parsedPoints);
    setLastPoint(null);
    setArrayInputStatus(`Applied ${parsedPoints.length}`);
  };

  const saveVersion = () => {
    const now = new Date().toISOString();
    const nextVersion = {
      id: createVersionId(),
      name: versionName.trim() || `Version ${versions.length + 1}`,
      points: sanitizeEditorPoints(points),
      gridSize: EDITOR_MATRIX_SIZE,
      createdAt: now,
      updatedAt: now,
    };

    setVersions((currentVersions) => [nextVersion, ...currentVersions]);
    setSelectedVersionId(nextVersion.id);
    setVersionName(nextVersion.name);
  };

  const updateVersion = () => {
    if (!selectedVersion) {
      return;
    }

    const now = new Date().toISOString();
    const nextName = versionName.trim() || selectedVersion.name;

    setVersions((currentVersions) =>
      currentVersions.map((version) =>
        version.id === selectedVersion.id
          ? {
              ...version,
              name: nextName,
              points: sanitizeEditorPoints(points),
              updatedAt: now,
            }
          : version,
      ),
    );
  };

  const loadVersion = () => {
    if (!selectedVersion) {
      return;
    }

    commitPoints(selectedVersion.points);
    setVersionName(selectedVersion.name);
    setLastPoint(null);
  };

  const deleteVersion = () => {
    if (!selectedVersion) {
      return;
    }

    setVersions((currentVersions) => currentVersions.filter((version) => version.id !== selectedVersion.id));
    setSelectedVersionId('');
    setVersionName('');
  };

  const cellFromElement = (element, gridElement) => {
    const cellElement = element?.closest?.('.point-cell');
    if (!cellElement || !gridElement.contains(cellElement)) {
      return null;
    }

    const row = Number(cellElement.dataset.row);
    const col = Number(cellElement.dataset.col);
    return Number.isInteger(row) && Number.isInteger(col) ? { row, col } : null;
  };

  const startPointDrag = (event) => {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    const cell = cellFromElement(event.target, event.currentTarget);
    if (!cell) {
      return;
    }

    event.preventDefault();
    const mode = pointSet.has(pointKey(cell.row, cell.col)) ? 'remove' : 'add';
    dragRef.current = {
      active: true,
      mode,
      touched: new Set(),
      startRow: cell.row,
      startCol: cell.col,
    };
    paintPoint(cell.row, cell.col, mode);
  };

  const movePointDrag = (event) => {
    const dragState = dragRef.current;
    if (!dragState.active) {
      return;
    }

    event.preventDefault();
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const cell = cellFromElement(element, event.currentTarget);
    if (cell) {
      paintPoint(cell.row, cell.col, dragState.mode);
    }
  };

  const endPointDrag = () => {
    const dragState = dragRef.current;
    if (!dragState.active) {
      return;
    }

    dragRef.current = { active: false, mode: 'add', touched: new Set() };
  };

  useEffect(() => {
    window.addEventListener('pointerup', endPointDrag);
    window.addEventListener('pointercancel', endPointDrag);
    return () => {
      window.removeEventListener('pointerup', endPointDrag);
      window.removeEventListener('pointercancel', endPointDrag);
    };
  }, []);

  const renderPointGrid = (cellSize, extraClassName = '') => (
    <div className="point-grid-scroll">
      <div
        className={`point-grid${extraClassName ? ` ${extraClassName}` : ''}`}
        aria-label={`${EDITOR_MATRIX_SIZE}x${EDITOR_MATRIX_SIZE} point editor`}
        style={{
          '--point-cell-size': `${cellSize}px`,
          '--point-grid-size': `${EDITOR_MATRIX_SIZE}`,
        }}
        onPointerDown={startPointDrag}
        onPointerMove={movePointDrag}
        onPointerLeave={endPointDrag}
      >
        {Array.from({ length: EDITOR_MATRIX_SIZE }, (_, row) =>
          Array.from({ length: EDITOR_MATRIX_SIZE }, (_, col) => {
            const active = pointSet.has(pointKey(row, col));

            return (
              <button
                key={`${row}-${col}`}
                className={`point-cell${active ? ' active' : ''}`}
                type="button"
                title={`[${row}, ${col}]`}
                aria-pressed={active}
                data-row={row}
                data-col={col}
              />
            );
          }),
        )}
      </div>
    </div>
  );

  const editorContent = (
    <section className={`point-editor-shell${embedded ? ' embedded-point-editor-shell' : ''}`}>
      <div className="point-editor-board-panel">
        <header className="point-editor-header">
          <div>
            <h1>Hand Coordinate Modeler</h1>
            <p>{EDITOR_MATRIX_SIZE}x{EDITOR_MATRIX_SIZE} sensor coordinate grid</p>
          </div>
          <div className="point-editor-header-controls">
            <button type="button" onClick={() => setExpandedEditorOpen(true)}>
              Expand
            </button>
            <label className="point-cell-size-control">
              <span>Cell size</span>
              <input
                type="range"
                min={MIN_POINT_CELL_SIZE}
                max={MAX_POINT_CELL_SIZE}
                step="1"
                value={pointCellSize}
                onChange={(event) => setPointCellSize(Number(event.target.value))}
              />
              <strong>{pointCellSize}px</strong>
            </label>
          </div>
        </header>

        {renderPointGrid(pointCellSize)}
      </div>

      <aside className="point-editor-side">
        <section className="point-editor-card">
          <h2>Selection</h2>
          <dl className="point-editor-stats">
            <div>
              <dt>Matrix</dt>
              <dd>{EDITOR_MATRIX_SIZE}x{EDITOR_MATRIX_SIZE}</dd>
            </div>
            <div>
              <dt>Points</dt>
              <dd>{points.length}</dd>
            </div>
            <div>
              <dt>Versions</dt>
              <dd>{versions.length}</dd>
            </div>
            <div>
              <dt>Last</dt>
              <dd>{lastPoint ? `[${lastPoint.row}, ${lastPoint.col}] ${lastPoint.action}` : '-'}</dd>
            </div>
          </dl>
          <div className="point-editor-version-fields">
            <label>
              <span>Name</span>
              <input
                type="text"
                value={versionName}
                placeholder={`Version ${versions.length + 1}`}
                onChange={(event) => setVersionName(event.target.value)}
              />
            </label>
            <label>
              <span>Versions</span>
              <select
                value={selectedVersionId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  const nextVersion = versions.find((version) => version.id === nextId);
                  setSelectedVersionId(nextId);
                  setVersionName(nextVersion ? nextVersion.name : '');
                }}
              >
                <option value="">No saved version</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.name} - {version.points.length} pts - {formatDateTime(version.updatedAt)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="point-editor-version-actions">
            <button type="button" onClick={saveVersion}>
              Save Version
            </button>
            <button type="button" disabled={!selectedVersion} onClick={updateVersion}>
              Update
            </button>
            <button type="button" disabled={!selectedVersion} onClick={loadVersion}>
              Load
            </button>
            <button className="danger" type="button" disabled={!selectedVersion} onClick={deleteVersion}>
              Delete
            </button>
          </div>
          <div className="point-editor-actions">
            <button type="button" onClick={copyOutput}>
              Copy
            </button>
            <button type="button" onClick={applyArrayInput}>
              Apply
            </button>
            {onProjectVideoPoints ? (
              <button type="button" onClick={onProjectVideoPoints}>
                Project 147
              </button>
            ) : null}
            <button type="button" onClick={resetPoints}>
              Reset
            </button>
            <button type="button" onClick={clearPoints}>
              Clear
            </button>
          </div>
        </section>

        <section className="point-editor-card output-card">
          <h2>Array Output</h2>
          <textarea
            value={arrayInput}
            spellCheck="false"
            onChange={(event) => setArrayInput(event.target.value)}
          />
          <span className="point-array-status">{arrayInputStatus || 'Editable'}</span>
        </section>
      </aside>

      {expandedEditorOpen ? (
        <div className="point-editor-modal-backdrop" role="presentation" onMouseDown={() => setExpandedEditorOpen(false)}>
          <section
            className="point-editor-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Expanded hand coordinate modeler"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2>Hand Coordinate Modeler</h2>
                <p>{points.length} points · {EDITOR_MATRIX_SIZE}x{EDITOR_MATRIX_SIZE}</p>
              </div>
              <div className="point-editor-modal-controls">
                <label className="point-cell-size-control">
                  <span>Zoom</span>
                  <input
                    type="range"
                    min="3"
                    max="12"
                    step="1"
                    value={expandedPointCellSize}
                    onChange={(event) => setExpandedPointCellSize(Number(event.target.value))}
                  />
                  <strong>{expandedPointCellSize}px</strong>
                </label>
                <button type="button" onClick={() => setExpandedEditorOpen(false)}>Close</button>
              </div>
            </header>
            {renderPointGrid(expandedPointCellSize, 'expanded-point-grid')}
          </section>
        </div>
      ) : null}
    </section>
  );

  if (embedded) {
    return (
      <section className="embedded-point-editor" aria-label="Hand coordinate editor">
        {editorContent}
      </section>
    );
  }

  return (
    <main className="point-editor-page">
      <nav className="app-nav" aria-label="Page view">
        <button type="button" onClick={() => onNavigate('terrain')}>
          Pressure
        </button>
        <button type="button" onClick={() => onNavigate('hand')}>
          Wireframe
        </button>
        <button type="button" onClick={() => onNavigate('obj')}>
          OBJ
        </button>
        <button className="active" type="button" onClick={() => onNavigate('points')}>
          Points
        </button>
      </nav>

      {editorContent}
    </main>
  );
}
