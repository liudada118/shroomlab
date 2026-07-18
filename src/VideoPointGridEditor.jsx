import React, { useEffect, useMemo, useRef, useState } from 'react';
import { HAND_R_VIDEO_POINTS, VIDEO_POINT_MATRIX_SIZE } from './handPressureData.js';

const EDITOR_MATRIX_SIZE = VIDEO_POINT_MATRIX_SIZE;
const VIDEO_POINT_DRAFT_STORAGE_KEY = 'shroomLab.handVideoPointEditor.draft.v1';
const VIDEO_POINT_CELL_SIZE_STORAGE_KEY = 'shroomLab.handVideoPointEditor.cellSize.v1';
const DEFAULT_POINT_CELL_SIZE = 12;
const MIN_POINT_CELL_SIZE = 7;
const MAX_POINT_CELL_SIZE = 20;

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

export function sanitizeVideoPoints(points) {
  if (!Array.isArray(points) || points.length !== HAND_R_VIDEO_POINTS.length) {
    return HAND_R_VIDEO_POINTS.map(([row, col]) => [row, col]);
  }

  return points.map((point, index) => (
    isValidPoint(point) ? [point[0], point[1]] : [...HAND_R_VIDEO_POINTS[index]]
  ));
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
    // Local persistence is optional; editing should continue without it.
  }
}

export function readStoredVideoPoints() {
  return sanitizeVideoPoints(readLocalStorage(VIDEO_POINT_DRAFT_STORAGE_KEY));
}

function readStoredCellSize() {
  const storedValue = readLocalStorage(VIDEO_POINT_CELL_SIZE_STORAGE_KEY);
  const storedSize = Number(storedValue);
  return storedValue !== null && Number.isFinite(storedSize)
    ? Math.max(MIN_POINT_CELL_SIZE, Math.min(MAX_POINT_CELL_SIZE, storedSize))
    : DEFAULT_POINT_CELL_SIZE;
}

function pointKey(row, col) {
  return `${row}:${col}`;
}

function clampCoordinate(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.min(EDITOR_MATRIX_SIZE - 1, Math.round(numericValue)));
}

function clampDeltaForPoints(points, deltaRow, deltaCol) {
  const rows = points.map(([row]) => row);
  const cols = points.map(([, col]) => col);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);

  return {
    row: Math.max(-minRow, Math.min(EDITOR_MATRIX_SIZE - 1 - maxRow, deltaRow)),
    col: Math.max(-minCol, Math.min(EDITOR_MATRIX_SIZE - 1 - maxCol, deltaCol)),
  };
}

function moveAllPoints(points, deltaRow, deltaCol) {
  const safeDelta = clampDeltaForPoints(points, deltaRow, deltaCol);
  return {
    points: points.map(([row, col]) => [row + safeDelta.row, col + safeDelta.col]),
    delta: safeDelta,
  };
}

function formatVideoPointArray(points) {
  const lines = [];

  for (let i = 0; i < points.length; i += 8) {
    lines.push(points.slice(i, i + 8).map(([row, col]) => `[${row}, ${col}]`).join(', '));
  }

  return `const HAND_R_VIDEO_POINTS = Object.freeze([\n  ${lines.join(',\n  ')}${lines.length ? ',' : ''}\n]);`;
}

function normalizeParsedVideoPoints(points) {
  if (!Array.isArray(points) || points.length !== HAND_R_VIDEO_POINTS.length) {
    return null;
  }

  return sanitizeVideoPoints(points);
}

function parseVideoPointsText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return null;
  }

  const trimmed = text.trim();

  try {
    const parsed = JSON.parse(trimmed);
    return normalizeParsedVideoPoints(parsed);
  } catch {
    // Continue with JS array extraction below.
  }

  const startIndex = trimmed.indexOf('[');
  const endIndex = trimmed.lastIndexOf(']');
  if (startIndex < 0 || endIndex <= startIndex) {
    return null;
  }

  try {
    const arrayLiteral = trimmed.slice(startIndex, endIndex + 1);
    const parsed = Function(`"use strict"; return (${arrayLiteral});`)();
    return normalizeParsedVideoPoints(parsed);
  } catch {
    return null;
  }
}

export default function VideoPointGridEditor({
  onNavigate,
  embedded = false,
  points: controlledPoints,
  onPointsChange,
}) {
  const isControlled = Array.isArray(controlledPoints) && typeof onPointsChange === 'function';
  const [internalPoints, setInternalPoints] = useState(readStoredVideoPoints);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pointCellSize, setPointCellSize] = useState(readStoredCellSize);
  const [clipboardStatus, setClipboardStatus] = useState('');
  const [arrayInput, setArrayInput] = useState('');
  const [moveAllMode, setMoveAllMode] = useState(false);
  const moveAllDragRef = useRef(null);
  const points = useMemo(
    () => sanitizeVideoPoints(isControlled ? controlledPoints : internalPoints),
    [controlledPoints, internalPoints, isControlled],
  );
  const currentPoint = points[activeIndex] || [0, 0];
  const output = useMemo(() => formatVideoPointArray(points), [points]);
  const indicesByCell = useMemo(() => {
    const map = new Map();

    points.forEach(([row, col], index) => {
      const key = pointKey(row, col);
      const indices = map.get(key) || [];
      indices.push(index);
      map.set(key, indices);
    });

    return map;
  }, [points]);

  useEffect(() => {
    writeLocalStorage(VIDEO_POINT_DRAFT_STORAGE_KEY, points);
  }, [points]);

  useEffect(() => {
    writeLocalStorage(VIDEO_POINT_CELL_SIZE_STORAGE_KEY, pointCellSize);
  }, [pointCellSize]);

  useEffect(() => {
    setArrayInput(output);
  }, [output]);

  const commitPoints = (nextPoints) => {
    const sanitizedPoints = sanitizeVideoPoints(nextPoints);
    if (isControlled) {
      onPointsChange(sanitizedPoints);
    } else {
      setInternalPoints(sanitizedPoints);
    }
  };

  const setCurrentPoint = (row, col) => {
    const nextPoints = points.map((point, index) => (
      index === activeIndex ? [clampCoordinate(row), clampCoordinate(col)] : point
    ));
    commitPoints(nextPoints);
  };

  const moveAllBy = (deltaRow, deltaCol) => {
    const moved = moveAllPoints(points, deltaRow, deltaCol);
    commitPoints(moved.points);
    setClipboardStatus(`Moved all [${moved.delta.row}, ${moved.delta.col}]`);
  };

  const updatePointAtIndex = (pointIndex, row, col) => {
    const nextPoints = points.map((point, index) => (
      index === pointIndex ? [clampCoordinate(row), clampCoordinate(col)] : point
    ));
    commitPoints(nextPoints);
    setActiveIndex(pointIndex);
  };

  const handleGridCellClick = (row, col, indices) => {
    if (moveAllMode) {
      return;
    }

    const current = currentPoint[0] === row && currentPoint[1] === col;

    if (indices.length && !current) {
      setActiveIndex(indices[0]);
      return;
    }

    setCurrentPoint(row, col);
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

  const startMoveAllDrag = (event) => {
    if (!moveAllMode || (event.button !== undefined && event.button !== 0)) {
      return;
    }

    const targetElement = document.elementFromPoint(event.clientX, event.clientY);
    const cell = cellFromElement(targetElement, event.currentTarget);
    if (!cell) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    moveAllDragRef.current = {
      active: true,
      startRow: cell.row,
      startCol: cell.col,
      startPoints: points.map(([row, col]) => [row, col]),
    };
    setClipboardStatus('Move all drag');
  };

  const updateMoveAllDrag = (event) => {
    const dragState = moveAllDragRef.current;
    if (!dragState?.active) {
      return;
    }

    event.preventDefault();
    const targetElement = document.elementFromPoint(event.clientX, event.clientY);
    const cell = cellFromElement(targetElement, event.currentTarget);
    if (!cell) {
      return;
    }

    const moved = moveAllPoints(
      dragState.startPoints,
      cell.row - dragState.startRow,
      cell.col - dragState.startCol,
    );
    commitPoints(moved.points);
    setClipboardStatus(`Moving all [${moved.delta.row}, ${moved.delta.col}]`);
  };

  const endMoveAllDrag = () => {
    if (!moveAllDragRef.current?.active) {
      return;
    }

    moveAllDragRef.current = null;
  };

  useEffect(() => {
    window.addEventListener('pointerup', endMoveAllDrag);
    window.addEventListener('pointercancel', endMoveAllDrag);
    return () => {
      window.removeEventListener('pointerup', endMoveAllDrag);
      window.removeEventListener('pointercancel', endMoveAllDrag);
    };
  }, []);

  const updateActiveIndex = (value) => {
    const nextIndex = Math.max(0, Math.min(points.length - 1, Number(value) - 1));
    if (Number.isFinite(nextIndex)) {
      setActiveIndex(nextIndex);
    }
  };

  const resetPoints = () => {
    commitPoints(HAND_R_VIDEO_POINTS.map(([row, col]) => [row, col]));
    setActiveIndex(0);
  };

  const copyOutput = async () => {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(output);
      setClipboardStatus('Copied code');
    }
  };

  const copyJson = async () => {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(JSON.stringify(points));
      setClipboardStatus('Copied JSON');
    }
  };

  const pastePoints = async () => {
    if (!navigator.clipboard?.readText) {
      setClipboardStatus('Paste unavailable');
      return;
    }

    const parsedPoints = parseVideoPointsText(await navigator.clipboard.readText());
    if (!parsedPoints) {
      setClipboardStatus('Invalid mapping');
      return;
    }

    commitPoints(parsedPoints);
    setActiveIndex(0);
    setClipboardStatus('Pasted');
  };

  const applyArrayInput = () => {
    const parsedPoints = parseVideoPointsText(arrayInput);
    if (!parsedPoints) {
      setClipboardStatus(`Need ${HAND_R_VIDEO_POINTS.length} points`);
      return;
    }

    commitPoints(parsedPoints);
    setActiveIndex(0);
    setClipboardStatus(`Applied ${parsedPoints.length}`);
  };

  const updateArrayInput = (value) => {
    setArrayInput(value);

    const parsedPoints = parseVideoPointsText(value);
    if (!parsedPoints) {
      setClipboardStatus(`Editing array`);
      return;
    }

    commitPoints(parsedPoints);
    setActiveIndex((currentIndex) => Math.min(currentIndex, parsedPoints.length - 1));
    setClipboardStatus(`Synced ${parsedPoints.length}`);
  };

  const editorContent = (
    <section className={`point-editor-shell video-point-editor-shell${embedded ? ' embedded-point-editor-shell embedded-video-point-editor-shell' : ''}`}>
        <div className="point-editor-board-panel">
          <header className="point-editor-header">
            <div>
              <h1>HAND_R_VIDEO_POINTS</h1>
              <p>{EDITOR_MATRIX_SIZE}x{EDITOR_MATRIX_SIZE} ordered coordinate grid for newArr147</p>
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
              className="point-grid video-point-grid"
              aria-label={`${EDITOR_MATRIX_SIZE}x${EDITOR_MATRIX_SIZE} ordered HAND_R_VIDEO_POINTS editor`}
              style={{
                '--point-cell-size': `${pointCellSize}px`,
                '--point-grid-size': `${EDITOR_MATRIX_SIZE}`,
              }}
              onPointerDown={startMoveAllDrag}
              onPointerMove={updateMoveAllDrag}
            >
              {Array.from({ length: EDITOR_MATRIX_SIZE }, (_, row) =>
                Array.from({ length: EDITOR_MATRIX_SIZE }, (_, col) => {
                  const indices = indicesByCell.get(pointKey(row, col)) || [];
                  const active = indices.length > 0;
                  const current = currentPoint[0] === row && currentPoint[1] === col;

                  return (
                    <button
                      key={`${row}-${col}`}
                      className={`point-cell${active ? ' active' : ''}${current ? ' current' : ''}`}
                      type="button"
                      title={`[${row}, ${col}]${indices.length ? ` - index ${indices.map((index) => index + 1).join(', ')}` : ''}`}
                      aria-pressed={current}
                      data-row={row}
                      data-col={col}
                      onClick={() => handleGridCellClick(row, col, indices)}
                    >
                      {current ? activeIndex + 1 : indices.length > 1 ? `+${indices.length}` : indices.length === 1 ? indices[0] + 1 : ''}
                    </button>
                  );
                }),
              )}
            </div>
          </div>
        </div>

        <aside className="point-editor-side">
          <section className="point-editor-card">
            <h2>Mapping</h2>
            <dl className="point-editor-stats">
              <div>
                <dt>Matrix</dt>
                <dd>{EDITOR_MATRIX_SIZE}x{EDITOR_MATRIX_SIZE}</dd>
              </div>
              <div>
                <dt>Length</dt>
                <dd>{points.length}</dd>
              </div>
              <div>
                <dt>Index</dt>
                <dd>{activeIndex + 1}</dd>
              </div>
              <div>
                <dt>Point</dt>
                <dd>[{currentPoint[0]}, {currentPoint[1]}]</dd>
              </div>
              <div>
                <dt>Clipboard</dt>
                <dd>{clipboardStatus || '-'}</dd>
              </div>
            </dl>

            <div className="point-editor-version-fields">
              <label>
                <span>newArr147 index</span>
                <input
                  type="number"
                  min="1"
                  max={points.length}
                  value={activeIndex + 1}
                  onChange={(event) => updateActiveIndex(event.target.value)}
                />
              </label>
              <label>
                <span>Row</span>
                <input
                  type="number"
                  min="0"
                  max={EDITOR_MATRIX_SIZE - 1}
                  value={currentPoint[0]}
                  onChange={(event) => setCurrentPoint(Number(event.target.value), currentPoint[1])}
                />
              </label>
              <label>
                <span>Col</span>
                <input
                  type="number"
                  min="0"
                  max={EDITOR_MATRIX_SIZE - 1}
                  value={currentPoint[1]}
                  onChange={(event) => setCurrentPoint(currentPoint[0], Number(event.target.value))}
                />
              </label>
            </div>

            <div className="video-point-move-controls">
              <button
                className={moveAllMode ? 'active' : ''}
                type="button"
                onClick={() => {
                  setMoveAllMode((currentMode) => !currentMode);
                  setClipboardStatus(moveAllMode ? 'Single point mode' : 'Move all mode');
                }}
              >
                Move All
              </button>
              <button type="button" onClick={() => moveAllBy(-1, 0)}>
                Up
              </button>
              <button type="button" onClick={() => moveAllBy(1, 0)}>
                Down
              </button>
              <button type="button" onClick={() => moveAllBy(0, -1)}>
                Left
              </button>
              <button type="button" onClick={() => moveAllBy(0, 1)}>
                Right
              </button>
            </div>

            <div className="video-point-index-list" aria-label="newArr147 region coordinate controls">
              {points.map(([row, col], index) => (
                <div
                  key={index}
                  className={`video-point-index-row${index === activeIndex ? ' active' : ''}`}
                >
                  <button type="button" onClick={() => setActiveIndex(index)}>
                    #{index + 1}
                  </button>
                  <label>
                    <span>R</span>
                    <input
                      type="number"
                      min="0"
                      max={EDITOR_MATRIX_SIZE - 1}
                      value={row}
                      onChange={(event) => updatePointAtIndex(index, Number(event.target.value), col)}
                    />
                  </label>
                  <label>
                    <span>C</span>
                    <input
                      type="number"
                      min="0"
                      max={EDITOR_MATRIX_SIZE - 1}
                      value={col}
                      onChange={(event) => updatePointAtIndex(index, row, Number(event.target.value))}
                    />
                  </label>
                </div>
              ))}
            </div>

            <div className="point-editor-actions video-point-actions">
              <button type="button" onClick={() => setActiveIndex(Math.max(0, activeIndex - 1))}>
                Prev
              </button>
              <button type="button" onClick={() => setActiveIndex(Math.min(points.length - 1, activeIndex + 1))}>
                Next
              </button>
              <button type="button" onClick={copyOutput}>
                Copy Code
              </button>
              <button type="button" onClick={copyJson}>
                Copy JSON
              </button>
              <button type="button" onClick={pastePoints}>
                Paste
              </button>
              <button type="button" onClick={applyArrayInput}>
                Apply Array
              </button>
              <button type="button" onClick={resetPoints}>
                Reset
              </button>
            </div>
          </section>

          <section className="point-editor-card output-card video-point-array-card">
            <h2>Array Output</h2>
            <textarea
              value={arrayInput}
              spellCheck="false"
              onChange={(event) => updateArrayInput(event.target.value)}
            />
            <span className="point-array-status">Editable HAND_R_VIDEO_POINTS array</span>
          </section>
        </aside>
      </section>
  );

  if (embedded) {
    return (
      <section className="embedded-point-editor embedded-video-point-editor" aria-label="HAND_R_VIDEO_POINTS editor">
        {editorContent}
      </section>
    );
  }

  return (
    <main className="point-editor-page video-point-editor-page">
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
