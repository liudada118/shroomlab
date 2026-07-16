import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SERIAL_BAUD_RATE,
  createGloveFramer,
  createSerialDelimiterParser,
} from './serialProtocol.js';
import {
  commitSerialPressureFrame,
  getActiveSerialHandSide,
  getSerialPressureSnapshot,
  setActiveSerialHandSide,
  subscribeSerialPressureSource,
} from './serialPressureStore.js';

export const DEFAULT_PRESSURE_WS_URL = 'ws://127.0.0.1:19999/';

const PRESSURE_ARRAY_KEYS = [
  'pressureData',
  'rawPressureData',
  'realArr',
  'data',
  'values',
];

function normalizeHandSide(value, fallback = 'right') {
  if (value === 1 || value === '1' || value === '01' || value === 'left' || value === 'l') {
    return 'left';
  }

  if (value === 2 || value === '2' || value === '02' || value === 'right' || value === 'r') {
    return 'right';
  }

  return fallback;
}

function toPressureArray(value) {
  if (ArrayBuffer.isView(value)) {
    return Array.from(value);
  }

  if (Array.isArray(value)) {
    return value;
  }

  return null;
}

function pickPressureArray(payload) {
  if (Array.isArray(payload) || ArrayBuffer.isView(payload)) {
    return toPressureArray(payload);
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  for (const key of PRESSURE_ARRAY_KEYS) {
    const pressureArray = toPressureArray(payload[key]);
    if (pressureArray?.length === 256) {
      return pressureArray;
    }
  }

  return null;
}

function pickFrameData(payload) {
  if (Array.isArray(payload) || ArrayBuffer.isView(payload)) {
    const pressureArray = toPressureArray(payload);
    return pressureArray?.length === 256 ? { pressureData: pressureArray } : null;
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const mappedPressureData = toPressureArray(payload.newArr147 ?? payload.mappedPressureData);
  if (mappedPressureData?.length) {
    return { mappedPressureData };
  }

  const pressureData = pickPressureArray(payload);
  return pressureData?.length === 256 ? { pressureData } : null;
}

function parseJsonMessage(data) {
  if (typeof data !== 'string') {
    return null;
  }

  const trimmed = data.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const numbers = trimmed
      .split(/[,\s]+/)
      .map(Number)
      .filter((value) => Number.isFinite(value));
    return numbers.length === 256 ? numbers : null;
  }
}

function parseBinaryMessage(bytes) {
  const firstByte = bytes.find((byte) => byte > 32);
  const looksLikeText = firstByte === 91 || firstByte === 123 || (firstByte >= 45 && firstByte <= 57);

  if (!looksLikeText || typeof TextDecoder === 'undefined') {
    return null;
  }

  return parseJsonMessage(new TextDecoder().decode(bytes));
}

function framesFromPayload(payload, fallbackHandSide = 'right') {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload)) {
    const frameData = pickFrameData(payload);
    return frameData
      ? [{ handSide: fallbackHandSide, ...frameData, timestamp: Date.now() }]
      : [];
  }

  if (typeof payload !== 'object') {
    return [];
  }

  const frames = [];
  const fallbackSide = normalizeHandSide(
    payload.handSide ?? payload.side ?? payload.hand ?? payload.packetType ?? payload.type,
    fallbackHandSide,
  );
  const directFrameData = pickFrameData(payload);

  if (directFrameData) {
    frames.push({
      handSide: fallbackSide,
      ...directFrameData,
      rotate: payload.rotate,
      timestamp: payload.timestamp || Date.now(),
    });
  }

  [
    ['sitData', 'left'],
    ['leftData', 'left'],
    ['left', 'left'],
    ['backData', 'right'],
    ['rightData', 'right'],
    ['right', 'right'],
  ].forEach(([key, side]) => {
    const nested = payload[key];
    const frameData = pickFrameData(nested);
    if (frameData) {
      frames.push({
        handSide: side,
        ...frameData,
        rotate: nested?.rotate,
        timestamp: nested?.timestamp || payload.timestamp || Date.now(),
      });
    }
  });

  return frames;
}

function createInitialStatus(url) {
  return {
    url,
    supported: typeof WebSocket !== 'undefined',
    connected: false,
    connecting: false,
    error: '',
    dropCount: 0,
    frameCount: 0,
    source: 'websocket',
  };
}

export function useWebSocketPressureSource(url = DEFAULT_PRESSURE_WS_URL) {
  const [status, setStatus] = useState(() => createInitialStatus(url));
  const [snapshot, setSnapshot] = useState(() => getSerialPressureSnapshot());
  const [activeHandSide, setActiveHandSideState] = useState(getActiveSerialHandSide);
  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(0);
  const statusFlushTimerRef = useRef(0);
  const pendingStatusRef = useRef({ frameCount: 0, dropCount: 0, error: null });
  const shouldReconnectRef = useRef(true);

  useEffect(() => subscribeSerialPressureSource(() => {
    setSnapshot(getSerialPressureSnapshot());
    setActiveHandSideState(getActiveSerialHandSide());
  }), []);

  const flushPendingStatus = useCallback(() => {
    statusFlushTimerRef.current = 0;
    const pending = pendingStatusRef.current;
    pendingStatusRef.current = { frameCount: 0, dropCount: 0, error: null };

    if (!pending.frameCount && !pending.dropCount && pending.error === null) {
      return;
    }

    setStatus((current) => ({
      ...current,
      frameCount: current.frameCount + pending.frameCount,
      dropCount: current.dropCount + pending.dropCount,
      error: pending.error === null ? current.error : pending.error,
    }));
  }, []);

  const queueStatusUpdate = useCallback((update) => {
    pendingStatusRef.current.frameCount += update.frameCount || 0;
    pendingStatusRef.current.dropCount += update.dropCount || 0;
    if (Object.prototype.hasOwnProperty.call(update, 'error')) {
      pendingStatusRef.current.error = update.error;
    }

    if (statusFlushTimerRef.current) {
      return;
    }

    statusFlushTimerRef.current = window.setTimeout(flushPendingStatus, 100);
  }, [flushPendingStatus]);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    window.clearTimeout(reconnectTimerRef.current);
    window.clearTimeout(statusFlushTimerRef.current);
    reconnectTimerRef.current = 0;
    statusFlushTimerRef.current = 0;

    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    setStatus((current) => ({
      ...current,
      connected: false,
      connecting: false,
    }));
  }, []);

  const connect = useCallback(() => {
    if (socketRef.current && socketRef.current.readyState <= WebSocket.OPEN) {
      return;
    }

    if (typeof WebSocket === 'undefined') {
      setStatus((current) => ({
        ...current,
        supported: false,
        error: '当前浏览器不支持 WebSocket。',
      }));
      return;
    }

    shouldReconnectRef.current = true;
    setStatus((current) => ({
      ...current,
      connecting: true,
      error: '',
    }));

    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;

    const framer = createGloveFramer({
      onFrame(frame) {
        commitSerialPressureFrame(frame);
        queueStatusUpdate({ frameCount: 1, error: '' });
      },
      onDrop(info) {
        queueStatusUpdate({ dropCount: 1, error: info.reason || '数据包已丢弃' });
      },
    });
    const parser = createSerialDelimiterParser({
      onPayload: framer.handlePayload,
      onDrop(info) {
        queueStatusUpdate({ dropCount: 1, error: info.reason || 'WebSocket 二进制缓冲区异常' });
      },
    });

    socket.addEventListener('open', () => {
      setStatus((current) => ({
        ...current,
        connected: true,
        connecting: false,
        error: '',
      }));
    });

    socket.addEventListener('message', async (event) => {
      if (event.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(event.data);
        const payload = parseBinaryMessage(bytes);
        if (payload) {
          const frames = framesFromPayload(payload, getActiveSerialHandSide());
          if (!frames.length) {
            queueStatusUpdate({ dropCount: 1, error: 'WebSocket 消息没有可用的 256 点压力数据' });
            return;
          }
          frames.forEach((frame) => commitSerialPressureFrame(frame));
          queueStatusUpdate({ frameCount: frames.length, error: '' });
          return;
        }

        parser.push(bytes);
        return;
      }

      if (event.data instanceof Blob) {
        const bytes = new Uint8Array(await event.data.arrayBuffer());
        const payload = parseBinaryMessage(bytes);
        if (payload) {
          const frames = framesFromPayload(payload, getActiveSerialHandSide());
          if (!frames.length) {
            queueStatusUpdate({ dropCount: 1, error: 'WebSocket 消息没有可用的 256 点压力数据' });
            return;
          }
          frames.forEach((frame) => commitSerialPressureFrame(frame));
          queueStatusUpdate({ frameCount: frames.length, error: '' });
          return;
        }

        parser.push(bytes);
        return;
      }

      const payload = parseJsonMessage(event.data);
      const frames = framesFromPayload(payload, getActiveSerialHandSide());
      if (!frames.length) {
        queueStatusUpdate({ dropCount: 1, error: 'WebSocket 消息没有可用的 256 点压力数据' });
        return;
      }

      frames.forEach((frame) => commitSerialPressureFrame(frame));
      queueStatusUpdate({ frameCount: frames.length, error: '' });
    });

    socket.addEventListener('error', () => {
      setStatus((current) => ({
        ...current,
        error: `无法连接 ${url}`,
      }));
    });

    socket.addEventListener('close', () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      setStatus((current) => ({
        ...current,
        connected: false,
        connecting: false,
      }));

      if (shouldReconnectRef.current) {
        reconnectTimerRef.current = window.setTimeout(connect, 1200);
      }
    });
  }, [queueStatusUpdate, url]);

  useEffect(() => {
    connect();
    return disconnect;
  }, [connect, disconnect]);

  return {
    status,
    snapshot,
    activeHandSide,
    setActiveHandSide: setActiveSerialHandSide,
    connect,
    disconnect,
    baudRate: SERIAL_BAUD_RATE,
  };
}
