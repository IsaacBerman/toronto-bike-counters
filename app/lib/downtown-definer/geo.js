import {
  polygon as turfPolygon,
  feature as turfFeature,
  featureCollection,
  intersect,
  booleanPointInPolygon,
  area as turfArea,
} from '@turf/turf';
import {
  CELL_SIZE_METERS,
  MAX_CELLS,
  makeLocalProjector,
  rotate,
  cellCenterFromIndex,
  hexCenterXY,
  hexColSpacing,
  hexRowSpacing,
  encodeRLE,
  decodeRLE,
} from './heatmapGrid.js';

function pointsToRing(points) {
  const ring = points.map(([lat, lng]) => [lng, lat]);
  const [firstLng, firstLat] = ring[0];
  const [lastLng, lastLat] = ring[ring.length - 1];
  if (firstLng !== lastLng || firstLat !== lastLat) {
    ring.push([firstLng, firstLat]);
  }
  return ring;
}

// points: array of [lat, lng] as drawn by the user. Returns a GeoJSON Polygon geometry.
export function pointsToPolygonGeometry(points) {
  return turfPolygon([pointsToRing(points)]).geometry;
}

// points: array of [lat, lng] as drawn by the user (at least 3 points).
// boundary: GeoJSON Polygon/MultiPolygon for the city.
// Returns the clipped geometry (Polygon/MultiPolygon), or null if there's no overlap.
export function clipPolygonToBoundary(points, boundary) {
  try {
    const candidate = turfPolygon([pointsToRing(points)]);
    const boundaryFeature = turfFeature(boundary);
    const clipped = intersect(featureCollection([candidate, boundaryFeature]));
    if (!clipped || !clipped.geometry) return null;
    if (turfArea(clipped) <= 0) return null;
    return clipped.geometry;
  } catch (error) {
    console.error('Error clipping polygon to boundary:', error);
    return null;
  }
}

// [minLng, minLat, maxLng, maxLat] of a Polygon/MultiPolygon geometry.
export function geometryBbox(geometry) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const scan = (coords) => {
    for (const c of coords) {
      if (typeof c[0] === 'number') {
        if (c[0] < minLng) minLng = c[0];
        if (c[0] > maxLng) maxLng = c[0];
        if (c[1] < minLat) minLat = c[1];
        if (c[1] > maxLat) maxLat = c[1];
      } else {
        scan(c);
      }
    }
  };
  scan(geometry.coordinates);
  return [minLng, minLat, maxLng, maxLat];
}

// Convex hull of the boundary's vertices, in projected meters (open ring), or
// null. Monotone chain, done here rather than via turf's convex(): that pulls in
// concaveman, which throws "RBush is not a constructor" once bundled, and the
// catch below quietly turned every grid axis-aligned instead of city-aligned.
// Hulling in projected space is equivalent — the projection is a linear scale,
// so it preserves which points are on the hull — and skips a round trip.
function hullPointsXY(boundary, proj) {
  const points = [];
  const scan = (coords) => {
    for (const c of coords) {
      if (typeof c[0] === 'number') points.push(proj.toXY(c[0], c[1]));
      else scan(c);
    }
  };
  scan(boundary.coordinates);
  if (points.length < 3) return null;

  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower = [];
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  return hull.length >= 3 ? hull : null;
}

// Orientation (radians) of the minimum-area bounding rectangle of a point set —
// by the rotating-calipers theorem it aligns with one of the hull's edges.
function minAreaRectAngle(points) {
  let bestAngle = 0;
  let bestArea = Infinity;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    const a = Math.atan2(y2 - y1, x2 - x1);
    const cos = Math.cos(-a);
    const sin = Math.sin(-a);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of points) {
      const rx = x * cos - y * sin;
      const ry = x * sin + y * cos;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }
    const areaRect = (maxX - minX) * (maxY - minY);
    if (areaRect < bestArea) {
      bestArea = areaRect;
      bestAngle = a;
    }
  }
  return bestAngle;
}

// Bump when the grid geometry/order changes, so a stored compact grid from an
// older algorithm is treated as a cache miss instead of misaligned. (2 = compact
// square grid; 3 = flat-top hexagonal cells., 4 = back to 280m, 5 = 200m cells,
// 75k cell cap, and RLE-encoded counts: { params, rle } instead of
// { params, counts })
export const HEATMAP_ALGO_VERSION = 5;

// The city's own frame: a local meter projection plus the rotation that aligns
// with the boundary's minimum-area bounding rectangle, and the extent in that
// rotated space. Both the hex heatmap grid and the coarse zone grid are laid
// out in this frame, so they share an orientation and read as one system.
export function computeRotatedFrame(boundary, bbox) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const lng0 = (minLng + maxLng) / 2;
  const lat0 = (minLat + maxLat) / 2;
  const proj = makeLocalProjector(lng0, lat0);

  const hull = hullPointsXY(boundary, proj);
  const angle = hull && hull.length >= 3 ? minAreaRectAngle(hull) : 0;
  const cosI = Math.cos(-angle), sinI = Math.sin(-angle);

  const extentPts = hull || [
    proj.toXY(minLng, minLat), proj.toXY(maxLng, minLat),
    proj.toXY(maxLng, maxLat), proj.toXY(minLng, maxLat),
  ];
  let rMinX = Infinity, rMaxX = -Infinity, rMinY = Infinity, rMaxY = -Infinity;
  for (const [x, y] of extentPts) {
    const [rx, ry] = rotate(x, y, cosI, sinI);
    if (rx < rMinX) rMinX = rx;
    if (rx > rMaxX) rMaxX = rx;
    if (ry < rMinY) rMinY = ry;
    if (ry > rMaxY) rMaxY = ry;
  }
  return { lng0, lat0, angle, rMinX, rMinY, rMaxX, rMaxY };
}

// Grid parameters + inside/outside layout, from the boundary alone (no votes).
// `counts` is length nx*ny: -1 = outside the city, 0 = inside with no votes yet.
export function buildGridSkeleton(boundary, bbox) {
  const { lng0, lat0, angle, rMinX, rMinY, rMaxX, rMaxY } = computeRotatedFrame(boundary, bbox);
  const proj = makeLocalProjector(lng0, lat0);
  const cosA = Math.cos(angle), sinA = Math.sin(angle);

  const width = rMaxX - rMinX;
  const height = rMaxY - rMinY;
  // Flat-top hex circumradius from the target spacing; coarsen if a huge city
  // would exceed the cell cap.
  let r = CELL_SIZE_METERS / Math.sqrt(3);
  const estCells = Math.ceil(width / hexColSpacing(r) + 1) * Math.ceil(height / hexRowSpacing(r) + 1);
  if (estCells > MAX_CELLS) r *= Math.sqrt(estCells / MAX_CELLS);

  const nx = Math.ceil(width / hexColSpacing(r)) + 1;
  const ny = Math.ceil(height / hexRowSpacing(r)) + 1;
  const params = { lng0, lat0, angle, r, rMinX, rMinY, nx, ny };

  const boundaryFeature = { type: 'Feature', properties: {}, geometry: boundary };
  const counts = new Array(nx * ny).fill(-1);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const [hx, hy] = hexCenterXY(r, rMinX, rMinY, ix, iy);
      const [cx, cy] = rotate(hx, hy, cosA, sinA);
      const center = proj.toLngLat(cx, cy);
      if (booleanPointInPolygon(center, boundaryFeature)) counts[iy * nx + ix] = 0;
    }
  }
  return { params, counts };
}

// Full build of the compact grid { params, counts } from the boundary + all
// submissions. Only runs on a cold cache / algorithm change.
export function buildCompactGrid(boundary, bbox, clippedPolygons) {
  const { params, counts } = buildGridSkeleton(boundary, bbox);
  const submissions = clippedPolygons.map((geometry) => ({
    feature: { type: 'Feature', properties: {}, geometry },
    bbox: geometryBbox(geometry),
  }));
  const cosA = Math.cos(params.angle), sinA = Math.sin(params.angle);
  const proj = makeLocalProjector(params.lng0, params.lat0);

  for (let i = 0; i < counts.length; i++) {
    if (counts[i] < 0) continue; // outside the boundary
    const center = cellCenterFromIndex(params, i, cosA, sinA, proj);
    const clng = center[0];
    const clat = center[1];
    let count = 0;
    for (const s of submissions) {
      const bb = s.bbox;
      if (clng < bb[0] || clng > bb[2] || clat < bb[1] || clat > bb[3]) continue;
      if (booleanPointInPolygon(center, s.feature)) count++;
    }
    counts[i] = count;
  }
  return { params, rle: encodeRLE(counts) };
}

// Fold one new vote into an existing compact grid (in place). Inside cells are
// known from counts (>= 0) and their centers are derived from params, so this
// needs neither the boundary nor a re-read of other submissions — O(cells).
export function incrementCompactCounts(compact, clippedGeometry) {
  const { params } = compact;
  const counts = compact.counts || decodeRLE(compact.rle);
  const cosA = Math.cos(params.angle), sinA = Math.sin(params.angle);
  const proj = makeLocalProjector(params.lng0, params.lat0);
  const bb = geometryBbox(clippedGeometry);
  const feature = { type: 'Feature', properties: {}, geometry: clippedGeometry };
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] < 0) continue;
    const center = cellCenterFromIndex(params, i, cosA, sinA, proj);
    if (center[0] < bb[0] || center[0] > bb[2] || center[1] < bb[1] || center[1] > bb[3]) continue;
    if (booleanPointInPolygon(center, feature)) counts[i]++;
  }
  if (compact.rle) compact.rle = encodeRLE(counts);
  else compact.counts = counts;
  return compact;
}
