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

function createInitialStatus() {
  return {
    supported: typeof navigator !== 'undefined' && Boolean(navigator.serial),
    connected: false,
    connecting: false,
    error: '',
    dropCount: 0,
    frameCount: 0,
  };
}

export function useSerialPressureSource() {
  const [status, setStatus] = useState(createInitialStatus);
  const [snapshot, setSnapshot] = useState(() => getSerialPressureSnapshot());
  const [activeHandSide, setActiveHandSideState] = useState(getActiveSerialHandSide);
  const portRef = useRef(null);
  const readerRef = useRef(null);
  const readLoopAbortRef = useRef(false);

  useEffect(() => subscribeSerialPressureSource(() => {
    setSnapshot(getSerialPressureSnapshot());
    setActiveHandSideState(getActiveSerialHandSide());
  }), []);

  const disconnect = useCallback(async () => {
    readLoopAbortRef.current = true;

    try {
      await readerRef.current?.cancel();
    } catch {
      // A reader can already be closed when the serial device is unplugged.
    }

    readerRef.current = null;

    try {
      await portRef.current?.close();
    } catch {
      // Closing a disconnected port can fail in Chromium; status still needs to reset.
    }

    portRef.current = null;
    setStatus((current) => ({
      ...current,
      connected: false,
      connecting: false,
    }));
  }, []);

  const connect = useCallback(async () => {
    if (!navigator.serial) {
      setStatus((current) => ({
        ...current,
        error: '当前浏览器不支持 Web Serial，请使用 Chrome 或 Edge。',
      }));
      return;
    }

    setStatus((current) => ({
      ...current,
      connecting: true,
      error: '',
    }));

    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: SERIAL_BAUD_RATE });
      portRef.current = port;
      readLoopAbortRef.current = false;

      const framer = createGloveFramer({
        onFrame(frame) {
          commitSerialPressureFrame(frame);
          setStatus((current) => ({
            ...current,
            connected: true,
            connecting: false,
            frameCount: current.frameCount + 1,
            error: '',
          }));
        },
        onDrop(info) {
          setStatus((current) => ({
            ...current,
            dropCount: current.dropCount + 1,
            error: info.reason || '串口包已丢弃',
          }));
        },
      });
      const parser = createSerialDelimiterParser({
        onPayload: framer.handlePayload,
        onDrop(info) {
          setStatus((current) => ({
            ...current,
            dropCount: current.dropCount + 1,
            error: info.reason || '串口缓冲区异常',
          }));
        },
      });

      setStatus((current) => ({
        ...current,
        connected: true,
        connecting: false,
        error: '',
      }));

      while (port.readable && !readLoopAbortRef.current) {
        const reader = port.readable.getReader();
        readerRef.current = reader;

        try {
          while (!readLoopAbortRef.current) {
            const { value, done } = await reader.read();
            if (done) {
              break;
            }
            parser.push(value);
          }
        } finally {
          reader.releaseLock();
          readerRef.current = null;
        }
      }
    } catch (error) {
      setStatus((current) => ({
        ...current,
        connected: false,
        connecting: false,
        error: error?.message || '串口连接失败',
      }));
    }
  }, []);

  useEffect(() => () => {
    void disconnect();
  }, [disconnect]);

  return {
    status,
    snapshot,
    activeHandSide,
    setActiveHandSide: setActiveSerialHandSide,
    connect,
    disconnect,
  };
}
