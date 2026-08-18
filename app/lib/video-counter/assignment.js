// Hungarian algorithm (Jonker-Volgenant shortest augmenting path, O(n^3)).
//
// Greedy matching takes each best-looking pair in turn and can strand a track
// whose only good partner was already claimed. This finds the assignment that
// minimises total cost across the whole frame, which is what stops two vehicles
// passing each other from swapping identities.

const BIG = 1e6;

/**
 * @param {number[][]} cost rows = tracks, cols = detections
 * @param {number} maxCost pairs above this are rejected after solving
 * @returns {[number, number][]} [rowIndex, colIndex] pairs
 */
export function solveAssignment(cost, maxCost = Infinity) {
  const rows = cost.length;
  const cols = rows ? cost[0].length : 0;
  if (!rows || !cols) return [];

  // The algorithm below needs rows <= cols; solve the transpose otherwise.
  if (rows > cols) {
    const flipped = Array.from({ length: cols }, (_, j) =>
      Array.from({ length: rows }, (_, i) => cost[i][j]));
    return solveAssignment(flipped, maxCost).map(([j, i]) => [i, j]);
  }

  const u = new Array(rows + 1).fill(0);
  const v = new Array(cols + 1).fill(0);
  const p = new Array(cols + 1).fill(0);
  const way = new Array(cols + 1).fill(0);

  for (let i = 1; i <= rows; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(cols + 1).fill(Infinity);
    const used = new Array(cols + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;

      for (let j = 1; j <= cols; j += 1) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }

      for (let j = 0; j <= cols; j += 1) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  const pairs = [];
  for (let j = 1; j <= cols; j += 1) {
    const i = p[j];
    if (i > 0 && cost[i - 1][j - 1] <= maxCost && cost[i - 1][j - 1] < BIG) {
      pairs.push([i - 1, j - 1]);
    }
  }
  return pairs;
}

export const FORBIDDEN = BIG;
