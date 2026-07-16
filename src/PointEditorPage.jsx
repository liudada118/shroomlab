import React, { useEffect, useMemo, useState } from 'react';
import { HAND_R_VIDEO_POINTS } from './handPressureData.js';

const EDITOR_MATRIX_SIZE = 32;
const POINT_DRAFT_STORAGE_KEY = 'shroomLab.handPointEditor.draft.v1';
const POINT_VERSIONS_STORAGE_KEY = 'shroomLab.handPointEditor.versions.v1';
const POINT_CELL_SIZE_STORAGE_KEY = 'shroomLab.handPointEditor.cellSize.v1';
const DEFAULT_POINT_CELL_SIZE = 9;
const MIN_POINT_CELL_SIZE = 6;
const MAX_POINT_CELL_SIZE = 18;

function pointKey(row, col) {
  return `${row}:${col}`;
}

function sortPoints(points) {
  return [...points].sort(([rowA, colA], [rowB, colB]) => rowA - rowB || colA - colB);
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

function uniqueInitialPoints() {
  return sanitizeEditorPoints(HAND_R_VIDEO_POINTS);
}

export function formatPointArray(points) {
  const sorted = sortPoints(points);
  const lines = [];

  for (let i = 0; i < sorted.length; i += 8) {
    lines.push(sorted.slice(i, i + 8).map(([row, col]) => `[${row}, ${col}]`).join(', '));
  }

  return `const HAND_R_VIDEO_POINTS = Object.freeze([\n  ${lines.join(',\n  ')}${lines.length ? ',' : ''}\n]);`;
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

export function readStoredDraft() {
  const draft = readLocalStorage(POINT_DRAFT_STORAGE_KEY);
  return Array.isArray(draft) ? sanitizeEditorPoints(draft) : uniqueInitialPoints();
}

export function getInitialEditorPoints() {
  return readStoredDraft();
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

  const fallbackDate = new Date().toISOString();
  const id = typeof version.id === 'string' && version.id ? version.id : `stored-${index}`;
  const name =
    typeof version.name === 'string' && version.name.trim()
      ? version.name.trim()
      : `Version ${index + 1}`;

  return {
    id,
    name,
    points,
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
}) {
  const isControlled = Array.isArray(controlledPoints) && typeof onPointsChange === 'function';
  const [internalPoints, setInternalPoints] = useState(readStoredDraft);
  const [versions, setVersions] = useState(readStoredVersions);
  const [versionName, setVersionName] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [lastPoint, setLastPoint] = useState(null);
  const [arrayInput, setArrayInput] = useState('');
  const [arrayInputStatus, setArrayInputStatus] = useState('');
  const [pointCellSize, setPointCellSize] = useState(readStoredCellSize);
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
    writeLocalStorage(POINT_DRAFT_STORAGE_KEY, points);
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
    if (isControlled) {
      onPointsChange(sanitizedPoints);
    } else {
      setInternalPoints(sanitizedPoints);
    }
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
    commitPoints(uniqueInitialPoints());
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

  const editorContent = (
    <section className={`point-editor-shell${embedded ? ' embedded-point-editor-shell' : ''}`}>
      <div className="point-editor-board-panel">
        <header className="point-editor-header">
          <div>
            <h1>Hand Coordinate Modeler</h1>
            <p>32x32 sensor coordinate grid</p>
          </div>
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
        </header>

        <div className="point-grid-scroll">
          <div
            className="point-grid"
            aria-label="32x32 point editor"
            style={{ '--point-cell-size': `${pointCellSize}px` }}
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
                    onClick={() => togglePoint(row, col)}
                  />
                );
              }),
            )}
          </div>
        </div>
      </div>

      <aside className="point-editor-side">
        <section className="point-editor-card">
          <h2>Selection</h2>
          <dl className="point-editor-stats">
            <div>
              <dt>Matrix</dt>
              <dd>32x32</dd>
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
