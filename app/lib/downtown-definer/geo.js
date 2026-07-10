import {
  polygon as turfPolygon,
  feature as turfFeature,
  featureCollection,
  intersect,
  booleanPointInPolygon,
  area as turfArea,
} from '@turf/turf';

// Sequential blue ramp (light -> dark), light-surface variant.
// Source: dataviz skill reference palette, "sequential hue" (blue), 100-700 steps.
// Valid for continuous sequential encoding (heatmaps/choropleths) where the
// lightest step recedes toward the surface for near-zero values.
const SEQUENTIAL_RAMP = [
  '#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7',
  '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b',
];

// Faint neutral fill for cells inside the city that nobody marked as downtown.
export const NO_DATA_COLOR = '#e8eaed';

export function colorForIntensity(intensity) {
  const clamped = Math.max(0, Math.min(1, intensity));
  const index = Math.round(clamped * (SEQUENTIAL_RAMP.length - 1));
  return SEQUENTIAL_RAMP[index];
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
export function buildHeatmapGrid(boundary, bbox, clippedPolygons, targetCellsAlongLongSide = 200) {
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
    // Normalize votes over 1..maxCount so a single vote already reads as "warm"
    // and the busiest cells reach the darkest step. Zero-vote cells get a faint
    // neutral fill so the hotspots stand out instead of a sea of pale blue.
    const noData = count === 0;
    const intensity = maxCount > 0 ? count / maxCount : 0;
    feature.properties.noData = noData;
    feature.properties.intensity = intensity;
    feature.properties.color = noData ? NO_DATA_COLOR : colorForIntensity(intensity);
    feature.properties.opacity = noData ? 0.25 : 0.8;
  }

  return { type: 'FeatureCollection', features, maxCount };
}
