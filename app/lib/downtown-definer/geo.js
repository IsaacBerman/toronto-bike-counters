import {
  polygon as turfPolygon,
  feature as turfFeature,
  featureCollection,
  intersect,
  booleanPointInPolygon,
  area as turfArea,
  convex,
} from '@turf/turf';
import {
  CELL_SIZE_METERS,
  MAX_CELLS,
  makeLocalProjector,
  rotate,
  cellCenterFromIndex,
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
function geometryBbox(geometry) {
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

// Convex hull of the boundary, projected to meters (open ring), or null.
function hullPointsXY(boundary, proj) {
  try {
    const hull = convex({ type: 'Feature', properties: {}, geometry: boundary });
    const ring = hull?.geometry?.coordinates?.[0];
    if (!ring || ring.length < 4) return null;
    return ring.slice(0, -1).map(([lng, lat]) => proj.toXY(lng, lat));
  } catch {
    return null;
  }
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
// older algorithm is treated as a cache miss instead of misaligned. (2 = the
// compact { params, counts } format.)
export const HEATMAP_ALGO_VERSION = 2;

// Grid parameters + inside/outside layout, from the boundary alone (no votes).
// `counts` is length nx*ny: -1 = outside the city, 0 = inside with no votes yet.
function buildGridSkeleton(boundary, bbox) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const lng0 = (minLng + maxLng) / 2;
  const lat0 = (minLat + maxLat) / 2;
  const proj = makeLocalProjector(lng0, lat0);

  const hull = hullPointsXY(boundary, proj);
  const angle = hull && hull.length >= 3 ? minAreaRectAngle(hull) : 0;
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
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
  let cell = CELL_SIZE_METERS;
  const estCells = Math.ceil((rMaxX - rMinX) / cell) * Math.ceil((rMaxY - rMinY) / cell);
  if (estCells > MAX_CELLS) cell *= Math.sqrt(estCells / MAX_CELLS);

  const nx = Math.ceil((rMaxX - rMinX) / cell);
  const ny = Math.ceil((rMaxY - rMinY) / cell);
  const params = { lng0, lat0, angle, cell, rMinX, rMinY, nx, ny };

  const boundaryFeature = { type: 'Feature', properties: {}, geometry: boundary };
  const counts = new Array(nx * ny).fill(-1);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const [cx, cy] = rotate(rMinX + ix * cell + cell / 2, rMinY + iy * cell + cell / 2, cosA, sinA);
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
  return { params, counts };
}

// Fold one new vote into an existing compact grid (in place). Inside cells are
// known from counts (>= 0) and their centers are derived from params, so this
// needs neither the boundary nor a re-read of other submissions — O(cells).
export function incrementCompactCounts(compact, clippedGeometry) {
  const { params, counts } = compact;
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
  return compact;
}
