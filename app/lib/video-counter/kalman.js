// Constant-velocity Kalman filter for bounding boxes.
//
// State is 8-dimensional: [cx, cy, w, h, vcx, vcy, vw, vh] — centre, width,
// height, and their velocities. Noise scales with the box's own size, so a car
// close to the camera is allowed to move further between frames than one far
// down the street.
//
// SORT and DeepSORT track aspect ratio instead of width, which couples the two
// dimensions: a vehicle turning changes its aspect sharply while its height
// barely moves, and the filter fights itself. BoT-SORT switched to width and
// height directly for that reason, and this follows it.

const STD_POSITION = 1 / 20;
const STD_VELOCITY = 1 / 160;
const NDIM = 4;

function zeros(rows, cols) {
  return Array.from({ length: rows }, () => new Array(cols).fill(0));
}

function identity(n) {
  const m = zeros(n, n);
  for (let i = 0; i < n; i += 1) m[i][i] = 1;
  return m;
}

function matmul(a, b) {
  const rows = a.length;
  const inner = b.length;
  const cols = b[0].length;
  const out = zeros(rows, cols);
  for (let i = 0; i < rows; i += 1) {
    for (let k = 0; k < inner; k += 1) {
      const aik = a[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < cols; j += 1) out[i][j] += aik * b[k][j];
    }
  }
  return out;
}

function transpose(a) {
  const out = zeros(a[0].length, a.length);
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < a[0].length; j += 1) out[j][i] = a[i][j];
  }
  return out;
}

function matvec(a, v) {
  return a.map((row) => row.reduce((sum, x, j) => sum + x * v[j], 0));
}

function addInto(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < a[0].length; j += 1) a[i][j] += b[i][j];
  }
  return a;
}

// Gauss-Jordan with partial pivoting. Only ever called on the 4x4 innovation
// covariance, so the cost is irrelevant.
function invert(matrix) {
  const n = matrix.length;
  const a = matrix.map((row, i) => [...row, ...identity(n)[i]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];

    const d = a[col][col];
    for (let j = 0; j < 2 * n; j += 1) a[col][j] /= d;

    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = a[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j += 1) a[r][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row.slice(n));
}

// [x, y, w, h] -> [cx, cy, w, h]
export function boxToMeasurement(box) {
  const [x, y, w, h] = box;
  return [x + w / 2, y + h / 2, Math.max(w, 1e-3), Math.max(h, 1e-3)];
}

// [cx, cy, w, h] -> [x, y, w, h]
export function measurementToBox(mean) {
  const [cx, cy, w, h] = mean;
  return [cx - w / 2, cy - h / 2, w, h];
}

const MOTION = (() => {
  const f = identity(2 * NDIM);
  for (let i = 0; i < NDIM; i += 1) f[i][NDIM + i] = 1;
  return f;
})();
const MOTION_T = transpose(MOTION);
const UPDATE = (() => {
  const h = zeros(NDIM, 2 * NDIM);
  for (let i = 0; i < NDIM; i += 1) h[i][i] = 1;
  return h;
})();
const UPDATE_T = transpose(UPDATE);

export function initiate(measurement) {
  const w = measurement[2];
  const h = measurement[3];
  const mean = [...measurement, 0, 0, 0, 0];
  const std = [
    2 * STD_POSITION * w, 2 * STD_POSITION * h, 2 * STD_POSITION * w, 2 * STD_POSITION * h,
    10 * STD_VELOCITY * w, 10 * STD_VELOCITY * h, 10 * STD_VELOCITY * w, 10 * STD_VELOCITY * h,
  ];
  const covariance = zeros(2 * NDIM, 2 * NDIM);
  for (let i = 0; i < 2 * NDIM; i += 1) covariance[i][i] = std[i] * std[i];
  return { mean, covariance };
}

export function predict(state) {
  const w = Math.max(state.mean[2], 1e-3);
  const h = Math.max(state.mean[3], 1e-3);
  const std = [
    STD_POSITION * w, STD_POSITION * h, STD_POSITION * w, STD_POSITION * h,
    STD_VELOCITY * w, STD_VELOCITY * h, STD_VELOCITY * w, STD_VELOCITY * h,
  ];
  const q = zeros(2 * NDIM, 2 * NDIM);
  for (let i = 0; i < 2 * NDIM; i += 1) q[i][i] = std[i] * std[i];

  state.mean = matvec(MOTION, state.mean);
  state.covariance = addInto(matmul(matmul(MOTION, state.covariance), MOTION_T), q);
  return state;
}

function project(state) {
  const w = Math.max(state.mean[2], 1e-3);
  const h = Math.max(state.mean[3], 1e-3);
  const std = [STD_POSITION * w, STD_POSITION * h, STD_POSITION * w, STD_POSITION * h];
  const r = zeros(NDIM, NDIM);
  for (let i = 0; i < NDIM; i += 1) r[i][i] = std[i] * std[i];

  return {
    mean: matvec(UPDATE, state.mean),
    covariance: addInto(matmul(matmul(UPDATE, state.covariance), UPDATE_T), r),
  };
}

export function update(state, measurement) {
  const projected = project(state);
  const inverse = invert(projected.covariance);
  // A singular innovation covariance means the filter has degenerated; snapping
  // to the measurement is a safe reset.
  if (!inverse) {
    const fresh = initiate(measurement);
    state.mean = fresh.mean;
    state.covariance = fresh.covariance;
    return state;
  }

  const gain = matmul(matmul(state.covariance, UPDATE_T), inverse);
  const innovation = measurement.map((z, i) => z - projected.mean[i]);

  state.mean = state.mean.map((m, i) => m + gain[i].reduce((sum, g, j) => sum + g * innovation[j], 0));

  const correction = matmul(gain, matmul(UPDATE, state.covariance));
  state.covariance = state.covariance.map((row, i) => row.map((c, j) => c - correction[i][j]));
  return state;
}
