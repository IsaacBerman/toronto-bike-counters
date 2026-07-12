// Shared, dependency-free (no turf) heatmap grid math. Safe to import on the
// client. The server computes a COMPACT grid ({ params, counts }) and the client
// expands it back into the exact same GeoJSON FeatureCollection it used to be
// sent — so the payload is tiny but everything downstream is unchanged.

export const HEATMAP_RAMP = [
  '#ffffcc', '#fff3af', '#ffe692', '#fed976', '#febf5a', '#fea647',
  '#fd8d3c', '#fc6330', '#f43d25', '#e31a1c', '#ca0923', '#a90026', '#800026',
];
export const NO_DATA_COLOR = '#dcdcd6';

const CELL_LOWEST_OPACITY = 0.1;
const CELL_MIN_OPACITY = 0.5;
const CELL_MAX_OPACITY = 0.8;

export const DEG = Math.PI / 180;
export const METERS_PER_DEG_LAT = 111320;
export const CELL_SIZE_METERS = 282;
export const MAX_CELLS = 45000;

export const round4 = (n) => Math.round(n * 1e4) / 1e4;
export const round2 = (n) => Math.round(n * 100) / 100;

export function colorForIntensity(intensity) {
  const clamped = Math.max(0, Math.min(1, intensity));
  return HEATMAP_RAMP[Math.round(clamped * (HEATMAP_RAMP.length - 1))];
}

export function opacityForIntensity(intensity) {
  const clamped = Math.max(0, Math.min(1, intensity));
  const lastBucket = HEATMAP_RAMP.length - 1;
  const bucket = Math.round(clamped * lastBucket);
  if (bucket === 0) return CELL_LOWEST_OPACITY;
  const t = (bucket - 1) / (lastBucket - 1);
  return CELL_MIN_OPACITY + (CELL_MAX_OPACITY - CELL_MIN_OPACITY) * t;
}

// Local equirectangular projection (meters) around an origin.
export function makeLocalProjector(lng0, lat0) {
  const kx = Math.cos(lat0 * DEG) * METERS_PER_DEG_LAT;
  const ky = METERS_PER_DEG_LAT;
  return {
    toXY: (lng, lat) => [(lng - lng0) * kx, (lat - lat0) * ky],
    toLngLat: (x, y) => [lng0 + x / kx, lat0 + y / ky],
  };
}

export function rotate(x, y, cos, sin) {
  return [x * cos - y * sin, x * sin + y * cos];
}

// Properties for one cell given its vote count (matches the old finalizeGrid).
export function cellProperties(count, maxCount, totalSubmissions) {
  if (count === 0) {
    return { noData: true, color: NO_DATA_COLOR, opacity: 0.12 };
  }
  const intensity = maxCount > 0 ? count / maxCount : 0;
  const bucket = Math.round(Math.max(0, Math.min(1, intensity)) * (HEATMAP_RAMP.length - 1));
  return {
    color: HEATMAP_RAMP[bucket],
    opacity: round2(opacityForIntensity(intensity)),
    pct: totalSubmissions > 0 ? Math.max(1, Math.round((count / totalSubmissions) * 100)) : 0,
    b: bucket,
  };
}

// Center [lng, lat] of the cell at linear index `i` (iy*nx + ix), from params.
export function cellCenterFromIndex(params, i, cosA, sinA, proj) {
  const { cell, rMinX, rMinY, nx } = params;
  const ix = i % nx;
  const iy = Math.floor(i / nx);
  const [cx, cy] = rotate(rMinX + ix * cell + cell / 2, rMinY + iy * cell + cell / 2, cosA, sinA);
  return proj.toLngLat(cx, cy);
}

// Expand a compact grid { params, counts } into a GeoJSON FeatureCollection,
// identical to what the heatmap endpoint used to return. `counts` is length
// nx*ny: -1 = outside the city (skipped), otherwise the vote count.
export function expandCompactGrid(compact, submissionCount) {
  const { params, counts } = compact;
  const { cell, rMinX, rMinY, nx, angle, lng0, lat0 } = params;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const proj = makeLocalProjector(lng0, lat0);

  let maxCount = 0;
  for (const c of counts) if (c > maxCount) maxCount = c;

  const features = [];
  for (let i = 0; i < counts.length; i++) {
    const count = counts[i];
    if (count < 0) continue; // outside the boundary
    const ix = i % nx;
    const iy = Math.floor(i / nx);
    const rx = rMinX + ix * cell;
    const ry = rMinY + iy * cell;
    const ring = [
      [rx, ry],
      [rx + cell, ry],
      [rx + cell, ry + cell],
      [rx, ry + cell],
    ].map(([px, py]) => {
      const [x, y] = rotate(px, py, cosA, sinA);
      const [lng, lat] = proj.toLngLat(x, y);
      return [round4(lng), round4(lat)];
    });
    ring.push(ring[0]);
    features.push({
      type: 'Feature',
      properties: cellProperties(count, maxCount, submissionCount),
      geometry: { type: 'Polygon', coordinates: [ring] },
    });
  }
  return { type: 'FeatureCollection', features, maxCount };
}
