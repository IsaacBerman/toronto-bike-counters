import {
  polygon as turfPolygon,
  feature as turfFeature,
  featureCollection,
  intersect,
  booleanPointInPolygon,
  area as turfArea,
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

// Builds a square grid over the city bbox, keeps only cells whose center is
// inside the boundary, and colors each by how many submissions cover its
// center. Returns a GeoJSON FeatureCollection ready to render as-is.
export function buildHeatmapGrid(boundary, bbox, clippedPolygons, targetCellsAlongLongSide = 150) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const lngSpan = maxLng - minLng;
  const latSpan = maxLat - minLat;
  const cellSize = Math.max(lngSpan, latSpan) / targetCellsAlongLongSide;

  const boundaryFeature = { type: 'Feature', properties: {}, geometry: boundary };
  const submissionFeatures = clippedPolygons.map((geometry) => ({
    type: 'Feature',
    properties: {},
    geometry,
  }));

  const features = [];
  let maxCount = 0;

  for (let lat = minLat; lat < maxLat; lat += cellSize) {
    for (let lng = minLng; lng < maxLng; lng += cellSize) {
      const centerLng = lng + cellSize / 2;
      const centerLat = lat + cellSize / 2;
      const center = [centerLng, centerLat];

      if (!booleanPointInPolygon(center, boundaryFeature)) continue;

      const count = submissionFeatures.reduce(
        (total, feature) => (booleanPointInPolygon(center, feature) ? total + 1 : total),
        0
      );
      maxCount = Math.max(maxCount, count);

      features.push({
        type: 'Feature',
        properties: { count },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [lng, lat],
            [lng + cellSize, lat],
            [lng + cellSize, lat + cellSize],
            [lng, lat + cellSize],
            [lng, lat],
          ]],
        },
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
