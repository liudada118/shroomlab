import { SERIAL_PRESSURE_POINT_COUNT } from './serialProtocol.js';

const listeners = new Set();
let notifyTimer = 0;
const serialState = {
  frames: {
    left: null,
    right: null,
  },
  manualFrame: null,
  activeHandSide: 'right',
};

function notifySerialListeners() {
  listeners.forEach((listener) => listener(serialState));
}

function scheduleSerialListeners() {
  if (notifyTimer) {
    return;
  }

  const scheduler = typeof window !== 'undefined' ? window.setTimeout : setTimeout;
  notifyTimer = scheduler(() => {
    notifyTimer = 0;
    notifySerialListeners();
  }, 66);
}

function normalizePressureData(values) {
  if (!Array.isArray(values) || values.length !== SERIAL_PRESSURE_POINT_COUNT) {
    return null;
  }

  return values.map((value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return 0;
    }

    return Math.max(0, Math.min(255, Math.round(numericValue)));
  });
}

function normalizeMappedPressureData(values) {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }

  return values.map((value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return 0;
    }

    return Math.max(0, Math.min(255, Math.round(numericValue)));
  });
}

export function subscribeSerialPressureSource(listener) {
  listeners.add(listener);
  listener(serialState);

  return () => listeners.delete(listener);
}

export function setActiveSerialHandSide(handSide) {
  if (handSide !== 'left' && handSide !== 'right') {
    return;
  }

  serialState.activeHandSide = handSide;
  notifySerialListeners();
}

export function getActiveSerialHandSide() {
  return serialState.activeHandSide;
}

export function getSerialPressureSnapshot() {
  if (serialState.manualFrame) {
    return serialState.manualFrame;
  }

  const preferredFrame = serialState.frames[serialState.activeHandSide];
  const fallbackFrame = serialState.frames.right || serialState.frames.left;
  return preferredFrame || fallbackFrame || null;
}

export function getSerialPressureFramesSnapshot() {
  return {
    frames: {
      left: serialState.frames.left,
      right: serialState.frames.right,
    },
    manualFrame: serialState.manualFrame,
    activeHandSide: serialState.activeHandSide,
  };
}

function normalizeFrame(frame, source = 'live') {
  const pressureData = normalizePressureData(frame.pressureData);
  const mappedPressureData = normalizeMappedPressureData(frame.mappedPressureData);
  if ((!pressureData && !mappedPressureData) || (frame.handSide !== 'left' && frame.handSide !== 'right')) {
    return null;
  }

  return {
    handSide: frame.handSide,
    pressureData,
    mappedPressureData,
    rotate: Array.isArray(frame.rotate) ? frame.rotate : [],
    timestamp: frame.timestamp || Date.now(),
    source,
  };
}

export function commitSerialPressureFrame(frame) {
  const normalizedFrame = normalizeFrame(frame, 'live');
  if (!normalizedFrame) {
    return;
  }

  serialState.frames[normalizedFrame.handSide] = normalizedFrame;
  scheduleSerialListeners();
}

export function replaceManualPressureFrame(frame) {
  const normalizedFrame = normalizeFrame(frame, 'manual');
  if (!normalizedFrame) {
    return false;
  }

  serialState.manualFrame = normalizedFrame;
  notifySerialListeners();
  return true;
}

export function clearManualPressureFrame() {
  serialState.manualFrame = null;
  notifySerialListeners();
}
