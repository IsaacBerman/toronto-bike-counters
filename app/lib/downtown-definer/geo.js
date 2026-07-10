import {
  polygon as turfPolygon,
  feature as turfFeature,
  featureCollection,
  intersect,
  booleanPointInPolygon,
  area as turfArea,
  convex,
} from '@turf/turf';

// Warm sequential "heatmap" ramp (13 steps, ColorBrewer YlOrRd-style).
// Low agreement reads pale yellow, peak consensus reads deep red.
const HEATMAP_RAMP = [
  '#ffffcc', '#fff3af', '#ffe692', '#fed976', '#febf5a', '#fea647',
  '#fd8d3c', '#fc6330', '#f43d25', '#e31a1c', '#ca0923', '#a90026', '#800026',
];

// Faint neutral fill for cells inside the city that nobody marked as downtown,
// rendered at low opacity (see buildHeatmapGrid) so "no votes" stays distinct
// from the ramp's pale-yellow low end.
export const NO_DATA_COLOR = '#dcdcd6';

export function colorForIntensity(intensity) {
  const clamped = Math.max(0, Math.min(1, intensity));
  const index = Math.round(clamped * (HEATMAP_RAMP.length - 1));
  return HEATMAP_RAMP[index];
}

// Cell opacity by relative bucket (same 13 buckets used for hue): the very
// lowest bucket is faint (0.2); every bucket above it ramps 0.5 -> 0.8.
const CELL_LOWEST_OPACITY = 0.1; // bucket 0
const CELL_MIN_OPACITY = 0.5; // bucket 1
const CELL_MAX_OPACITY = 0.8; // top bucket

export function opacityForIntensity(intensity) {
  const clamped = Math.max(0, Math.min(1, intensity));
  const lastBucket = HEATMAP_RAMP.length - 1; // 12
  const bucket = Math.round(clamped * lastBucket); // 0..12
  if (bucket === 0) return CELL_LOWEST_OPACITY;
  const t = (bucket - 1) / (lastBucket - 1); // bucket 1 -> 0, top -> 1
  return CELL_MIN_OPACITY + (CELL_MAX_OPACITY - CELL_MIN_OPACITY) * t;
}

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

const DEG = Math.PI / 180;
const METERS_PER_DEG_LAT = 111320;

// Fixed physical cell size (meters). Chosen so Toronto's long axis is ~150 cells
// wide; every city uses this same size, so cells are the same size regardless of
// the city's geographical extent.
const CELL_SIZE_METERS = 282;
// Safety cap so an unusually large boundary can't explode compute — the cell
// size grows if the grid would otherwise exceed this many cells.
const MAX_CELLS = 45000;

// Local equirectangular projection (meters) around an origin — accurate enough
// at city scale and lets us build a rotated, physically-square grid.
function makeLocalProjector(lng0, lat0) {
  const kx = Math.cos(lat0 * DEG) * METERS_PER_DEG_LAT;
  const ky = METERS_PER_DEG_LAT;
  return {
    toXY: (lng, lat) => [(lng - lng0) * kx, (lat - lat0) * ky],
    toLngLat: (x, y) => [lng0 + x / kx, lat0 + y / ky],
  };
}

function rotate(x, y, cos, sin) {
  return [x * cos - y * sin, x * sin + y * cos];
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

// Builds a fixed-cell-size grid, rotated to align with the city's minimum-area
// bounding rectangle (so it tends to follow the street grid), keeps only cells
// whose center is inside the boundary, and colors each by how many submissions
// cover its center. Returns a GeoJSON FeatureCollection ready to render.
export function buildHeatmapGrid(boundary, bbox, clippedPolygons) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const proj = makeLocalProjector((minLng + maxLng) / 2, (minLat + maxLat) / 2);

  // Grid orientation from the convex hull's min-area rectangle.
  const hull = hullPointsXY(boundary, proj);
  const angle = hull && hull.length >= 3 ? minAreaRectAngle(hull) : 0;
  const cosA = Math.cos(angle), sinA = Math.sin(angle); // rotated frame -> meters
  const cosI = Math.cos(-angle), sinI = Math.sin(-angle); // meters -> rotated frame

  // Extent of the city in the rotated (grid-aligned) frame.
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
  const rWidth = rMaxX - rMinX;
  const rHeight = rMaxY - rMinY;

  // Fixed cell size, enlarged only if needed to stay under the cell cap.
  let cell = CELL_SIZE_METERS;
  const estCells = Math.ceil(rWidth / cell) * Math.ceil(rHeight / cell);
  if (estCells > MAX_CELLS) cell *= Math.sqrt(estCells / MAX_CELLS);

  const boundaryFeature = { type: 'Feature', properties: {}, geometry: boundary };
  const submissionFeatures = clippedPolygons.map((geometry) => ({
    type: 'Feature',
    properties: {},
    geometry,
  }));

  const features = [];
  let maxCount = 0;

  const nx = Math.ceil(rWidth / cell);
  const ny = Math.ceil(rHeight / cell);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const rx = rMinX + ix * cell;
      const ry = rMinY + iy * cell;

      const [cx, cy] = rotate(rx + cell / 2, ry + cell / 2, cosA, sinA);
      const center = proj.toLngLat(cx, cy);
      if (!booleanPointInPolygon(center, boundaryFeature)) continue;

      let count = 0;
      for (const f of submissionFeatures) {
        if (booleanPointInPolygon(center, f)) count++;
      }
      if (count > maxCount) maxCount = count;

      const corners = [
        [rx, ry],
        [rx + cell, ry],
        [rx + cell, ry + cell],
        [rx, ry + cell],
      ].map(([px, py]) => {
        const [x, y] = rotate(px, py, cosA, sinA);
        return proj.toLngLat(x, y);
      });

      features.push({
        type: 'Feature',
        properties: { count },
        geometry: { type: 'Polygon', coordinates: [[...corners, corners[0]]] },
      });
    }
  }

  for (const feature of features) {
    const { count } = feature.properties;
    // Hue and opacity both track the relative bucket (count / maxCount): the
    // lowest bucket is faint, the highest is solid, so low-agreement areas
    // recede and consensus areas stand out.
    const noData = count === 0;
    const intensity = maxCount > 0 ? count / maxCount : 0;
    feature.properties.noData = noData;
    feature.properties.intensity = intensity;
    feature.properties.color = noData ? NO_DATA_COLOR : colorForIntensity(intensity);
    feature.properties.opacity = noData ? 0.12 : opacityForIntensity(intensity);
  }

  return { type: 'FeatureCollection', features, maxCount };
}
