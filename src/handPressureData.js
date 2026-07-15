const SOURCE_MATRIX_SIZE = 32;
export const SENSOR_MATRIX_SIZE = 64;
export const MATRIX_SIZE_OPTIONS = [32, 64];
export const DEFAULT_GAUSSIAN_KERNEL_SIZE = 5;
const INTERPOLATED_POINT_THRESHOLD = 0.015;
const GAUSSIAN_BLEND = 0.48;
const PALM_ROW_MIN = 15;
const PALM_ROW_MAX = 23;
const PALM_COL_MIN = 12;
const PALM_COL_MAX = 28;
const MAX_PALM_GAP = 2;
const MAX_PALM_ROW_GAP = 4;

export const HAND_R_VIDEO_POINTS = Object.freeze([
  [0, 17], [1, 16], [1, 17], [1, 18], [1, 21], [2, 13], [2, 16], [2, 17],
  [2, 18], [2, 20], [2, 21], [2, 22], [3, 12], [3, 13], [3, 14], [3, 16],
  [3, 17], [3, 18], [3, 20], [3, 21], [3, 22], [3, 25], [4, 12], [4, 13],
  [4, 14], [4, 16], [4, 17], [4, 18], [4, 20], [4, 21], [4, 22], [4, 24],
  [4, 25], [4, 26], [5, 12], [5, 13], [5, 14], [5, 16], [5, 17], [5, 18],
  [5, 21], [5, 24], [5, 25], [5, 26], [6, 12], [6, 13], [6, 14], [6, 16],
  [6, 17], [6, 18], [6, 20], [6, 22], [6, 24], [6, 25], [6, 26], [7, 12],
  [7, 13], [7, 14], [7, 21], [7, 22], [7, 25], [8, 12], [8, 13], [8, 14],
  [8, 17], [8, 21], [8, 22], [8, 24], [8, 25], [9, 17], [9, 18], [9, 20],
  [9, 21], [9, 22], [9, 24], [9, 25], [9, 26], [10, 12], [10, 13], [10, 14],
  [10, 17], [10, 18], [10, 20], [10, 21], [10, 22], [10, 24], [10, 25], [10, 26],
  [11, 12], [11, 13], [11, 14], [11, 17], [11, 18], [11, 20], [11, 21], [11, 22],
  [11, 24], [11, 25], [12, 13], [12, 14], [12, 15], [12, 17], [12, 18], [12, 20],
  [12, 21], [12, 22], [12, 25], [12, 26], [13, 13], [13, 14], [13, 15], [13, 17],
  [13, 18], [13, 20], [13, 21], [13, 22], [13, 24], [13, 26], [14, 13], [14, 14],
  [14, 15], [14, 17], [14, 18], [14, 21], [14, 25], [14, 26], [15, 4], [15, 5],
  [15, 6], [15, 13], [15, 14], [15, 15], [15, 16], [15, 17], [15, 18], [15, 19],
  [15, 20], [15, 21], [15, 22], [15, 23], [15, 24], [15, 25], [15, 26], [16, 5],
  [16, 6], [16, 7], [16, 13], [17, 5], [17, 6], [17, 7], [17, 8], [17, 9],
  [17, 15], [17, 16], [17, 17], [17, 18], [17, 19], [17, 20], [17, 21], [17, 22],
  [17, 23], [17, 24], [17, 25], [17, 26], [17, 27], [18, 6], [18, 7], [18, 8],
  [18, 9], [18, 10], [18, 13], [19, 8], [19, 9], [19, 10], [19, 13], [19, 15],
  [19, 16], [19, 17], [19, 18], [19, 19], [19, 20], [19, 21], [19, 22], [19, 23],
  [19, 24], [19, 25], [19, 26], [19, 27], [20, 10], [20, 11], [21, 9], [21, 10],
  [21, 11], [21, 12], [21, 14], [21, 15], [21, 16], [21, 17], [21, 18], [21, 19],
  [21, 20], [21, 21], [21, 22], [21, 23], [21, 24], [21, 25], [21, 26], [22, 9],
  [22, 10], [22, 11], [22, 12], [22, 13], [23, 11], [23, 12], [23, 13], [23, 15],
  [23, 16], [23, 17], [23, 18], [23, 19], [23, 20], [23, 21], [23, 22], [23, 23],
  [23, 24], [23, 25], [24, 13], [24, 14], [24, 16], [24, 18], [24, 19], [24, 20],
  [24, 21], [24, 22], [25, 14], [25, 15], [25, 16], [25, 19], [25, 21], [25, 22],
  [25, 24], [26, 18], [26, 19], [26, 20], [26, 21], [26, 23], [27, 15], [27, 17],
  [27, 18], [27, 19], [27, 20], [27, 22],
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
  const clampedRow = Math.max(0, Math.min(SOURCE_MATRIX_SIZE - 1, row));
  const clampedCol = Math.max(0, Math.min(SOURCE_MATRIX_SIZE - 1, col));
  const row0 = Math.floor(clampedRow);
  const col0 = Math.floor(clampedCol);
  const row1 = Math.min(SOURCE_MATRIX_SIZE - 1, row0 + 1);
  const col1 = Math.min(SOURCE_MATRIX_SIZE - 1, col0 + 1);
  const rowT = clampedRow - row0;
  const colT = clampedCol - col0;
  const top = lerp(matrix[row0][col0], matrix[row0][col1], colT);
  const bottom = lerp(matrix[row1][col0], matrix[row1][col1], colT);

  return lerp(top, bottom, rowT);
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
  const points = [];
  const matrix = Array.from({ length: matrixSize }, () => Array(matrixSize).fill(0));
  const sourceMatrix = buildSourcePressureMatrix(time, sourcePoints);

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
