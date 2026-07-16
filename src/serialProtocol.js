export const SERIAL_BAUD_RATE = 921600;
export const SERIAL_FRAME_DELIMITER = Object.freeze([0xaa, 0x55, 0x03, 0x99]);
export const SERIAL_FRAME_DELIMITER_LENGTH = SERIAL_FRAME_DELIMITER.length;
export const SERIAL_PRESSURE_POINT_COUNT = 256;
export const SERIAL_PRESSURE_GRID_SIZE = 16;
export const SERIAL_FIRST_PAYLOAD_LENGTH = 130;
export const SERIAL_SECOND_PAYLOAD_LENGTH = 146;

const HAND_SIDE_BY_TYPE = Object.freeze({
  1: 'left',
  2: 'right',
});

function toUint8Array(value) {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return new Uint8Array(value);
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  return new Uint8Array(0);
}

function concatUint8Arrays(left, right) {
  const result = new Uint8Array(left.length + right.length);
  result.set(left, 0);
  result.set(right, left.length);
  return result;
}

function indexOfDelimiter(buffer, startIndex = 0) {
  const maxStart = buffer.length - SERIAL_FRAME_DELIMITER_LENGTH;

  for (let index = startIndex; index <= maxStart; index += 1) {
    let matched = true;

    for (let offset = 0; offset < SERIAL_FRAME_DELIMITER_LENGTH; offset += 1) {
      if (buffer[index + offset] !== SERIAL_FRAME_DELIMITER[offset]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return index;
    }
  }

  return -1;
}

function parseFloat32LEArray(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = [];

  for (let offset = 0; offset + 3 < bytes.byteLength; offset += 4) {
    const value = view.getFloat32(offset, true);
    result.push(Number.isFinite(value) ? value : 0);
  }

  return result;
}

function getPayloadSide(payload) {
  return HAND_SIDE_BY_TYPE[Number(payload[1])] || null;
}

export function createSerialDelimiterParser({ onPayload, onDrop = () => {}, maxBufferLength = 4096 } = {}) {
  let buffer = new Uint8Array(0);

  function push(chunk) {
    const bytes = toUint8Array(chunk);
    if (!bytes.length) {
      return;
    }

    buffer = concatUint8Arrays(buffer, bytes);
    let delimiterIndex = indexOfDelimiter(buffer);

    while (delimiterIndex >= 0) {
      const payload = buffer.slice(0, delimiterIndex);
      buffer = buffer.slice(delimiterIndex + SERIAL_FRAME_DELIMITER_LENGTH);

      if (payload.length) {
        onPayload?.(payload);
      }

      delimiterIndex = indexOfDelimiter(buffer);
    }

    if (buffer.length > maxBufferLength) {
      onDrop({ reason: 'serial delimiter buffer overflow', length: buffer.length });
      buffer = buffer.slice(-SERIAL_FRAME_DELIMITER_LENGTH + 1);
    }
  }

  function reset() {
    buffer = new Uint8Array(0);
  }

  return { push, reset };
}

export function createGloveFramer({ onFrame, onDrop = () => {}, timeoutMs = 300 } = {}) {
  const chunks = {
    left: null,
    right: null,
  };
  const chunkTime = {
    left: 0,
    right: 0,
  };

  function cleanupExpired(now = Date.now()) {
    ['left', 'right'].forEach((side) => {
      if (chunks[side] && now - chunkTime[side] > timeoutMs) {
        chunks[side] = null;
        chunkTime[side] = 0;
        onDrop({ reason: 'first chunk timeout', side });
      }
    });
  }

  function handlePayload(rawPayload) {
    cleanupExpired();
    const payload = toUint8Array(rawPayload);

    if (payload.length !== SERIAL_FIRST_PAYLOAD_LENGTH && payload.length !== SERIAL_SECOND_PAYLOAD_LENGTH) {
      onDrop({ reason: 'unexpected payload length', length: payload.length });
      return;
    }

    const side = getPayloadSide(payload);
    if (!side) {
      onDrop({ reason: 'unknown hand side', packetType: payload[1] });
      return;
    }

    if (payload.length === SERIAL_FIRST_PAYLOAD_LENGTH) {
      chunks[side] = payload.slice(2, 130);
      chunkTime[side] = Date.now();
      return;
    }

    const firstChunk = chunks[side];
    chunks[side] = null;
    chunkTime[side] = 0;

    if (!firstChunk || firstChunk.length !== 128) {
      onDrop({ reason: 'missing first chunk', side });
      return;
    }

    const secondChunk = payload.slice(2, 130);
    const imuBytes = payload.slice(130, 146);
    const pressureBytes = concatUint8Arrays(firstChunk, secondChunk);
    const pressureData = Array.from(pressureBytes);
    const rotate = parseFloat32LEArray(imuBytes);

    onFrame?.({
      handSide: side,
      pressureData,
      rotate: rotate.every((value) => value === 0) ? [] : rotate,
      timestamp: Date.now(),
      raw: {
        firstChunk,
        secondChunk,
        imuBytes,
      },
    });
  }

  function reset() {
    chunks.left = null;
    chunks.right = null;
    chunkTime.left = 0;
    chunkTime.right = 0;
  }

  return { handlePayload, reset };
}
