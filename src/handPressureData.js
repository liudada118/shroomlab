import { SERIAL_PRESSURE_GRID_SIZE, SERIAL_PRESSURE_POINT_COUNT } from './serialProtocol.js';
import { getSerialPressureSnapshot } from './serialPressureStore.js';

const SOURCE_MATRIX_SIZE = 32;
export const SENSOR_MATRIX_SIZE = 64;
export const MATRIX_SIZE_OPTIONS = [32, 64];
export const DEFAULT_GAUSSIAN_KERNEL_SIZE = 5;
const RAW_PRESSURE_MAX_VALUE = 255;
const INTERPOLATED_POINT_THRESHOLD = 0.015;
const GAUSSIAN_BLEND = 0.48;
const PALM_ROW_MIN = 15;
const PALM_ROW_MAX = 23;
const PALM_COL_MIN = 12;
const PALM_COL_MAX = 28;
const MAX_PALM_GAP = 2;
const MAX_PALM_ROW_GAP = 4;

export const HAND_R_ADC_ORDER = Object.freeze([
  240, 239, 238, 256, 255, 254, 16, 15, 14, 32, 31, 30,
  237, 236, 235, 253, 252, 251, 13, 12, 11, 29, 28, 27,
  234, 233, 232, 250, 249, 248, 10, 9, 8, 26, 25, 24,
  231, 230, 229, 247, 246, 245, 7, 6, 5, 23, 22, 21,
  228, 227, 226, 244, 243, 242, 4, 3, 2, 20, 19, 18,
  0, 47, 0, 0, 44, 0, 0, 41, 0, 0, 38, 0, 0, 35, 0, 61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 51, 50,
  80, 79, 78, 77, 76, 75, 74, 73, 72, 71, 70, 69, 68, 67, 66,
  96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83, 82,
  112, 111, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100, 99, 98,
  128, 127, 126, 125, 124, 123, 122, 121, 120, 119, 118, 117, 116, 115, 114,
]);

export const HAND_R_VIDEO_POINTS = Object.freeze([
  [21, 3], [20, 3], [19, 3], [3, 10], [3, 11], [3, 12], [0, 15], [0, 16], [0, 17], [2, 23], [2, 24], [2, 25], [7, 27], [7, 28], [7, 29],
  [21, 4], [20, 4], [19, 4], [4, 10], [4, 11], [4, 12], [1, 15], [1, 16], [1, 17], [3, 23], [3, 24], [3, 25], [8, 27], [8, 28], [8, 29],
  [22, 5], [21, 5], [20, 5], [5, 10], [5, 11], [5, 12], [2, 16], [2, 17], [2, 18], [4, 23], [4, 24], [4, 25], [9, 27], [9, 28], [9, 29],
  [22, 6], [21, 6], [20, 6], [6, 11], [6, 12], [6, 13], [3, 16], [3, 17], [3, 18], [5, 23], [5, 24], [5, 25], [10, 27], [10, 28], [10, 29],
  [23, 8], [22, 8], [21, 8], [10, 12], [10, 13], [10, 14], [9, 17], [9, 18], [9, 19], [9, 22], [9, 23], [9, 24], [12, 26], [12, 27], [12, 28],
  [15, 18], [15, 18], [15, 19], [15, 20], [15, 21], [15, 22], [15, 23], [15, 24], [15, 25], [15, 26], [15, 27], [15, 28],
  [17, 15], [17, 15], [17, 16], [17, 17], [17, 18], [17, 19], [17, 20], [17, 21], [17, 22], [17, 23], [17, 24], [17, 25], [17, 26], [17, 27], [17, 28],
  [19, 15], [19, 15], [19, 16], [19, 17], [19, 18], [19, 19], [19, 20], [19, 21], [19, 22], [19, 23], [19, 24], [19, 25], [19, 26], [19, 27], [19, 28],
  [21, 15], [21, 15], [21, 16], [21, 17], [21, 18], [21, 19], [21, 20], [21, 21], [21, 22], [21, 23], [21, 24], [21, 25], [21, 26], [21, 27], [21, 28],
  [23, 15], [23, 15], [23, 16], [23, 17], [23, 18], [23, 19], [23, 20], [23, 21], [23, 22], [23, 23], [23, 24], [23, 25], [23, 26], [23, 27], [23, 28],
]);

export const HAND_R_VIDEO_POINT_SET = new Set(
  HAND_R_VIDEO_POINTS.map(([row, col]) => `${row}:${col}`),
);

function normalizeSourcePoints(sourcePoints = HAND_R_VIDEO_POINTS) {
  if (!Array.isArray(sourcePoints)) {
    return HAND_R_VIDEO_POINTS;
  }

  const seen = new Set();
  const points = [];

  sourcePoints.forEach((point) => {
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      !Number.isInteger(point[0]) ||
      !Number.isInteger(point[1])
    ) {
      return;
    }

    const [row, col] = point;
    if (row < 0 || row >= SOURCE_MATRIX_SIZE || col < 0 || col >= SOURCE_MATRIX_SIZE) {
      return;
    }

    const key = `${row}:${col}`;
    if (!seen.has(key)) {
      seen.add(key);
      points.push([row, col]);
    }
  });

  return points.sort(([rowA, colA], [rowB, colB]) => rowA - rowB || colA - colB);
}

function buildSourcePointSet(sourcePoints = HAND_R_VIDEO_POINTS) {
  return new Set(normalizeSourcePoints(sourcePoints).map(([row, col]) => `${row}:${col}`));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function pressureValueForSourcePoint(row, col, time) {
  const fingerZone = row <= 12 ? 0.72 : 0.48;
  const palmZone = row >= 15 && col >= 15 ? 0.34 : 0;
  const columnPeak = Math.exp(-((col - 18) ** 2) / 96) * 0.2;
  const rowPeak = Math.exp(-((row - 5) ** 2) / 80) * 0.18;
  const pulse = 0.86 + Math.sin(time * 1.1 + row * 0.39 + col * 0.23) * 0.14;

  return clamp01((fingerZone + palmZone + columnPeak + rowPeak) * pulse);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function gaussianWeight(distanceSquared, sigma) {
  return Math.exp(-distanceSquared / (2 * sigma * sigma));
}

function normalizeMatrixSize(matrixSize) {
  return MATRIX_SIZE_OPTIONS.includes(matrixSize) ? matrixSize : SENSOR_MATRIX_SIZE;
}

function normalizeGaussianKernelSize(kernelSize) {
  const size = Number(kernelSize);
  if (!Number.isFinite(size)) {
    return DEFAULT_GAUSSIAN_KERNEL_SIZE;
  }

  const rounded = Math.max(1, Math.min(9, Math.round(size)));
  return rounded % 2 === 0 ? Math.max(1, rounded - 1) : rounded;
}

function buildSourcePressureMatrix(time, sourcePoints = HAND_R_VIDEO_POINTS) {
  const matrix = Array.from({ length: SOURCE_MATRIX_SIZE }, () => Array(SOURCE_MATRIX_SIZE).fill(0));
  const sourcePointSet = buildSourcePointSet(sourcePoints);

  sourcePointSet.forEach((key) => {
    const [row, col] = key.split(':').map(Number);
    matrix[row][col] = pressureValueForSourcePoint(row, col, time);
  });

  fillPalmInternalGaps(matrix);

  return matrix;
}

export function buildRawHandPressureMatrix(time = 0, sourcePoints = HAND_R_VIDEO_POINTS) {
  const matrix = Array.from({ length: SOURCE_MATRIX_SIZE }, () => Array(SOURCE_MATRIX_SIZE).fill(0));
  const sourcePointSet = buildSourcePointSet(sourcePoints);

  sourcePointSet.forEach((key) => {
    const [row, col] = key.split(':').map(Number);
    matrix[row][col] = pressureValueForSourcePoint(row, col, time);
  });

  return matrix;
}

function fillPalmInternalGaps(matrix) {
  for (let col = PALM_COL_MIN; col <= PALM_COL_MAX; col += 1) {
    let previousRow = null;
    let previousValue = 0;

    for (let row = PALM_ROW_MIN; row <= PALM_ROW_MAX; row += 1) {
      const value = matrix[row][col];

      if (value <= 0) {
        continue;
      }

      if (previousRow !== null) {
        const gap = row - previousRow;

        if (gap > 1 && gap <= MAX_PALM_GAP) {
          for (let fillRow = previousRow + 1; fillRow < row; fillRow += 1) {
            const t = (fillRow - previousRow) / gap;
            matrix[fillRow][col] = lerp(previousValue, value, t);
          }
        }
      }

      previousRow = row;
      previousValue = value;
    }
  }

  for (let row = PALM_ROW_MIN; row <= PALM_ROW_MAX; row += 1) {
    let previousCol = null;
    let previousValue = 0;

    for (let col = PALM_COL_MIN; col <= PALM_COL_MAX; col += 1) {
      const value = matrix[row][col];

      if (value <= 0) {
        continue;
      }

      if (previousCol !== null) {
        const gap = col - previousCol;

        if (gap > 1 && gap <= MAX_PALM_ROW_GAP) {
          for (let fillCol = previousCol + 1; fillCol < col; fillCol += 1) {
            const t = (fillCol - previousCol) / gap;
            matrix[row][fillCol] = lerp(previousValue, value, t);
          }
        }
      }

      previousCol = col;
      previousValue = value;
    }
  }
}

function sampleSourceMatrix(matrix, row, col) {
  const matrixSize = matrix.length || SOURCE_MATRIX_SIZE;
  const clampedRow = Math.max(0, Math.min(matrixSize - 1, row));
  const clampedCol = Math.max(0, Math.min(matrixSize - 1, col));
  const row0 = Math.floor(clampedRow);
  const col0 = Math.floor(clampedCol);
  const row1 = Math.min(matrixSize - 1, row0 + 1);
  const col1 = Math.min(matrixSize - 1, col0 + 1);
  const rowT = clampedRow - row0;
  const colT = clampedCol - col0;
  const top = lerp(matrix[row0][col0], matrix[row0][col1], colT);
  const bottom = lerp(matrix[row1][col0], matrix[row1][col1], colT);

  return lerp(top, bottom, rowT);
}

function normalizeRawPressureValue(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return clamp01(numericValue / RAW_PRESSURE_MAX_VALUE);
}

function normalizeRawPressureData(rawPressureData) {
  if (!Array.isArray(rawPressureData) || rawPressureData.length !== SERIAL_PRESSURE_POINT_COUNT) {
    return null;
  }

  return rawPressureData.map(normalizeRawPressureValue);
}

function normalizeVideoPoints(videoPoints = HAND_R_VIDEO_POINTS) {
  if (!Array.isArray(videoPoints) || !videoPoints.length) {
    return HAND_R_VIDEO_POINTS;
  }

  return videoPoints.map((point, index) => {
    if (
      Array.isArray(point) &&
      point.length === 2 &&
      Number.isInteger(point[0]) &&
      Number.isInteger(point[1]) &&
      point[0] >= 0 &&
      point[0] < SOURCE_MATRIX_SIZE &&
      point[1] >= 0 &&
      point[1] < SOURCE_MATRIX_SIZE
    ) {
      return [point[0], point[1]];
    }

    return HAND_R_VIDEO_POINTS[index] || [0, 0];
  });
}

function normalizeMappedPressureData(mappedPressureData, videoPoints) {
  if (!Array.isArray(mappedPressureData) || mappedPressureData.length !== videoPoints.length) {
    return null;
  }

  return mappedPressureData.map(normalizeRawPressureValue);
}

function buildVideoPointPressureSourceMatrix(mappedPressureData, handSide = 'right', videoPoints = HAND_R_VIDEO_POINTS) {
  const normalizedVideoPoints = handSide === 'right' ? normalizeVideoPoints(videoPoints) : null;
  if (!normalizedVideoPoints) {
    return null;
  }

  const normalizedData = normalizeMappedPressureData(mappedPressureData, normalizedVideoPoints);
  if (!normalizedData) {
    return null;
  }

  const sourceMatrix = Array.from({ length: SOURCE_MATRIX_SIZE }, () => Array(SOURCE_MATRIX_SIZE).fill(0));

  for (let index = 0; index < normalizedVideoPoints.length; index += 1) {
    const point = normalizedVideoPoints[index];
    if (!Array.isArray(point) || point.length !== 2) {
      continue;
    }

    const [row, col] = point;
    if (row < 0 || row >= SOURCE_MATRIX_SIZE || col < 0 || col >= SOURCE_MATRIX_SIZE) {
      continue;
    }

    sourceMatrix[row][col] = Math.max(sourceMatrix[row][col], normalizedData[index]);
  }

  fillPalmInternalGaps(sourceMatrix);
  return sourceMatrix;
}

function buildMappedPressureSourceMatrix(rawPressureData, handSide = 'right') {
  const normalizedData = normalizeRawPressureData(rawPressureData);
  if (!normalizedData) {
    return null;
  }

  const sourceMatrix = Array.from({ length: SOURCE_MATRIX_SIZE }, () => Array(SOURCE_MATRIX_SIZE).fill(0));
  const adcOrder = handSide === 'right' ? HAND_R_ADC_ORDER : null;
  const videoPoints = handSide === 'right' ? HAND_R_VIDEO_POINTS : null;

  if (!adcOrder || !videoPoints) {
    return null;
  }

  const mappedCount = Math.min(adcOrder.length, videoPoints.length);
  for (let index = 0; index < mappedCount; index += 1) {
    const adcIndex = adcOrder[index] - 1;
    const point = videoPoints[index];

    if (
      adcIndex < 0 ||
      adcIndex >= normalizedData.length ||
      !Array.isArray(point) ||
      point.length !== 2
    ) {
      continue;
    }

    const [row, col] = point;
    if (row < 0 || row >= SOURCE_MATRIX_SIZE || col < 0 || col >= SOURCE_MATRIX_SIZE) {
      continue;
    }

    sourceMatrix[row][col] = Math.max(sourceMatrix[row][col], normalizedData[adcIndex]);
  }

  fillPalmInternalGaps(sourceMatrix);
  return sourceMatrix;
}

function buildSerialPressureSourceMatrix(rawPressureData, mappedPressureData, handSide = 'right', videoPoints = HAND_R_VIDEO_POINTS) {
  const videoPointMatrix = buildVideoPointPressureSourceMatrix(mappedPressureData, handSide, videoPoints);
  if (videoPointMatrix) {
    return videoPointMatrix;
  }

  const mappedMatrix = buildMappedPressureSourceMatrix(rawPressureData, handSide);
  if (mappedMatrix) {
    return mappedMatrix;
  }

  const normalizedData = normalizeRawPressureData(rawPressureData);
  if (!normalizedData) {
    return null;
  }

  const serialMatrix = Array.from({ length: SERIAL_PRESSURE_GRID_SIZE }, (_, row) =>
    normalizedData.slice(row * SERIAL_PRESSURE_GRID_SIZE, (row + 1) * SERIAL_PRESSURE_GRID_SIZE),
  );
  const sourceMatrix = Array.from({ length: SOURCE_MATRIX_SIZE }, () => Array(SOURCE_MATRIX_SIZE).fill(0));

  for (let row = 0; row < SOURCE_MATRIX_SIZE; row += 1) {
    for (let col = 0; col < SOURCE_MATRIX_SIZE; col += 1) {
      const serialRow = (row / (SOURCE_MATRIX_SIZE - 1)) * (SERIAL_PRESSURE_GRID_SIZE - 1);
      const serialCol = (col / (SOURCE_MATRIX_SIZE - 1)) * (SERIAL_PRESSURE_GRID_SIZE - 1);
      sourceMatrix[row][col] = sampleSourceMatrix(serialMatrix, serialRow, serialCol);
    }
  }

  return sourceMatrix;
}

function gaussianSmoothMatrix(matrix, gaussianKernelSize) {
  const matrixSize = matrix.length;
  const kernelSize = normalizeGaussianKernelSize(gaussianKernelSize);
  const radius = Math.floor(kernelSize / 2);
  const sigma = Math.max(0.65, kernelSize / 3.2);

  return matrix.map((rowValues, row) =>
    rowValues.map((value, col) => {
      if (radius === 0) {
        return value;
      }

      let weightedPressure = 0;
      let totalWeight = 0;

      for (let rowOffset = -radius; rowOffset <= radius; rowOffset += 1) {
        for (let colOffset = -radius; colOffset <= radius; colOffset += 1) {
          const sampleRow = row + rowOffset;
          const sampleCol = col + colOffset;

          if (sampleRow < 0 || sampleRow >= matrixSize || sampleCol < 0 || sampleCol >= matrixSize) {
            continue;
          }

          const weight = gaussianWeight(rowOffset * rowOffset + colOffset * colOffset, sigma);
          weightedPressure += matrix[sampleRow][sampleCol] * weight;
          totalWeight += weight;
        }
      }

      const smoothedValue = totalWeight > 0 ? weightedPressure / totalWeight : value;
      return clamp01(lerp(value, smoothedValue, GAUSSIAN_BLEND));
    }),
  );
}

export function isHandSensorPoint(row, col, matrixSize = SENSOR_MATRIX_SIZE, sourcePoints = HAND_R_VIDEO_POINTS) {
  const normalizedMatrixSize = normalizeMatrixSize(matrixSize);
  const sourceRow = Math.round((row / Math.max(1, normalizedMatrixSize - 1)) * (SOURCE_MATRIX_SIZE - 1));
  const sourceCol = Math.round((col / Math.max(1, normalizedMatrixSize - 1)) * (SOURCE_MATRIX_SIZE - 1));
  return buildSourcePointSet(sourcePoints).has(`${sourceRow}:${sourceCol}`);
}

export function buildHandRegionFrame(matrixSize = SENSOR_MATRIX_SIZE, sourcePoints = HAND_R_VIDEO_POINTS) {
  const normalizedMatrixSize = normalizeMatrixSize(matrixSize);
  const matrix = Array.from({ length: normalizedMatrixSize }, () => Array(normalizedMatrixSize).fill(0));
  const points = [];
  const sourcePointSet = buildSourcePointSet(sourcePoints);

  for (let row = 0; row < normalizedMatrixSize; row += 1) {
    for (let col = 0; col < normalizedMatrixSize; col += 1) {
      const sourceRow = Math.round((row / Math.max(1, normalizedMatrixSize - 1)) * (SOURCE_MATRIX_SIZE - 1));
      const sourceCol = Math.round((col / Math.max(1, normalizedMatrixSize - 1)) * (SOURCE_MATRIX_SIZE - 1));

      if (sourcePointSet.has(`${sourceRow}:${sourceCol}`)) {
        matrix[row][col] = 1;
        points.push({ row, col, value: 1 });
      }
    }
  }

  return { matrix, points };
}

export function buildHandPressureFrame(time = 0, options = {}) {
  const matrixSize = normalizeMatrixSize(options.matrixSize ?? SENSOR_MATRIX_SIZE);
  const gaussianKernelSize = normalizeGaussianKernelSize(options.gaussianKernelSize ?? DEFAULT_GAUSSIAN_KERNEL_SIZE);
  const sourcePoints = normalizeSourcePoints(options.sourcePoints ?? HAND_R_VIDEO_POINTS);
  const serialSnapshot = options.useSerialData === false ? null : getSerialPressureSnapshot();
  const rawPressureData = options.rawPressureData ?? serialSnapshot?.pressureData;
  const mappedPressureData = options.mappedPressureData ?? serialSnapshot?.mappedPressureData;
  const handSide = options.handSide ?? serialSnapshot?.handSide ?? 'right';
  const videoPoints = normalizeVideoPoints(options.videoPoints ?? HAND_R_VIDEO_POINTS);
  const points = [];
  const matrix = Array.from({ length: matrixSize }, () => Array(matrixSize).fill(0));
  const sourceMatrix = buildSerialPressureSourceMatrix(rawPressureData, mappedPressureData, handSide, videoPoints) || buildSourcePressureMatrix(time, sourcePoints);

  for (let row = 0; row < matrixSize; row += 1) {
    for (let col = 0; col < matrixSize; col += 1) {
      const sourceRow = (row / Math.max(1, matrixSize - 1)) * (SOURCE_MATRIX_SIZE - 1);
      const sourceCol = (col / Math.max(1, matrixSize - 1)) * (SOURCE_MATRIX_SIZE - 1);
      const value = sampleSourceMatrix(sourceMatrix, sourceRow, sourceCol);
      matrix[row][col] = value;
    }
  }

  const smoothedMatrix = gaussianSmoothMatrix(matrix, gaussianKernelSize);

  for (let row = 0; row < matrixSize; row += 1) {
    for (let col = 0; col < matrixSize; col += 1) {
      const value = smoothedMatrix[row][col] > INTERPOLATED_POINT_THRESHOLD ? smoothedMatrix[row][col] : 0;
      smoothedMatrix[row][col] = value;

      if (value > 0) {
        points.push({ row, col, value });
      }
    }
  }

  return { matrix: smoothedMatrix, points };
}
