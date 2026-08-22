import { booleanPointInPolygon } from '@turf/turf';
import {
  buildGridSkeleton,
  geometryBbox,
  clipPolygonToBoundary,
  pointsToPolygonGeometry,
} from '../downtown-definer/geo.js';
import {
  makeLocalProjector,
  cellCenterFromIndex,
  encodeRLE,
  decodeRLE,
} from '../downtown-definer/heatmapGrid.js';

// Bump when the stored grid's geometry or encoding changes, so an older cached
// grid is treated as a miss instead of being read as if it were current.
// (1 = flat-top hex grid shared with the downtown heatmap, counts split into
// resident / non-resident RLE arrays over the SAME cell layout; 2 = added a
// coarse zone-to-zone matrix; 3 = replaced that matrix with a full-resolution
// destination grid per origin zone, so picking a zone filters the hex heatmap
// exactly like the resident / non-resident filters do.)
export const LIVE_HEATMAP_ALGO_VERSION = 3;

// A submission is a set of areas, so a cell must be counted at most once per
// submitter even when their areas overlap. This wraps one submission's clipped
// geometries with the bboxes needed to reject most cells without a real
// point-in-polygon test.
function prepareSubmission(clippedPolygons) {
  const parts = clippedPolygons.map((geometry) => ({
    feature: { type: 'Feature', properties: {}, geometry },
    bbox: geometryBbox(geometry),
  }));
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const part of parts) {
    if (part.bbox[0] < minLng) minLng = part.bbox[0];
    if (part.bbox[1] < minLat) minLat = part.bbox[1];
    if (part.bbox[2] > maxLng) maxLng = part.bbox[2];
    if (part.bbox[3] > maxLat) maxLat = part.bbox[3];
  }
  return { parts, bbox: [minLng, minLat, maxLng, maxLat] };
}

// True if [lng, lat] falls in any of the submission's areas.
function coversPoint(submission, center) {
  const bb = submission.bbox;
  if (center[0] < bb[0] || center[0] > bb[2] || center[1] < bb[1] || center[1] > bb[3]) return false;
  for (const part of submission.parts) {
    const pb = part.bbox;
    if (center[0] < pb[0] || center[0] > pb[2] || center[1] < pb[1] || center[1] > pb[3]) continue;
    if (booleanPointInPolygon(center, part.feature)) return true;
  }
  return false;
}

// areas: array of [lat, lng] point lists as drawn. Returns the raw geometries
// (what the user drew, for showing their own map back to them) and the
// geometries clipped to the city, dropping any area that misses the city
// entirely. Areas with fewer than 3 points are ignored.
export function clipAreasToBoundary(areas, boundary) {
  const raw = [];
  const clipped = [];
  for (const points of areas) {
    if (!Array.isArray(points) || points.length < 3) continue;
    const clippedGeometry = clipPolygonToBoundary(points, boundary);
    if (!clippedGeometry) continue;
    raw.push(pointsToPolygonGeometry(points));
    clipped.push(clippedGeometry);
  }
  return { raw, clipped };
}

// Full rebuild of the resident / non-resident arrays from every submission.
// Both share ONE cell layout (it comes from the boundary alone), so the client
// adds them elementwise to get "everyone" without another request.
// Zone grids are deliberately NOT built here: a zone's row is created the first
// time somebody answers from it (see buildZoneGrid), so cities where nobody
// named a zone — the overwhelming majority — store nothing at all.
export function buildLiveCompactGrid(boundary, bbox, submissions) {
  const { params, counts } = buildGridSkeleton(boundary, bbox);
  const residentCounts = counts;
  const nonResidentCounts = counts.slice();
  const resident = [];
  const nonResident = [];
  for (const submission of submissions) {
    if (!submission.clippedPolygons?.length) continue;
    (submission.resident ? resident : nonResident).push(prepareSubmission(submission.clippedPolygons));
  }

  const cosA = Math.cos(params.angle), sinA = Math.sin(params.angle);
  const proj = makeLocalProjector(params.lng0, params.lat0);

  for (let i = 0; i < residentCounts.length; i++) {
    if (residentCounts[i] < 0) continue; // outside the boundary
    const center = cellCenterFromIndex(params, i, cosA, sinA, proj);
    let inCount = 0;
    for (const s of resident) if (coversPoint(s, center)) inCount++;
    let outCount = 0;
    for (const s of nonResident) if (coversPoint(s, center)) outCount++;
    residentCounts[i] = inCount;
    nonResidentCounts[i] = outCount;
  }

  return { params, rleIn: encodeRLE(residentCounts), rleOut: encodeRLE(nonResidentCounts) };
}

// One zone's destination grid, over the same cell layout as everything else, so
// picking a zone filters the hex heatmap exactly like the resident /
// non-resident filters do. Built from just that zone's answers — normally a
// single one, the moment somebody first answers from there.
export function buildZoneGrid(boundary, bbox, clippedPolygonsPerSubmission) {
  const { params, counts } = buildGridSkeleton(boundary, bbox);
  const submissions = clippedPolygonsPerSubmission
    .filter((polygons) => polygons?.length)
    .map((polygons) => prepareSubmission(polygons));

  const cosA = Math.cos(params.angle), sinA = Math.sin(params.angle);
  const proj = makeLocalProjector(params.lng0, params.lat0);

  for (let i = 0; i < counts.length; i++) {
    if (counts[i] < 0) continue;
    const center = cellCenterFromIndex(params, i, cosA, sinA, proj);
    let n = 0;
    for (const s of submissions) if (coversPoint(s, center)) n++;
    counts[i] = n;
  }
  return { params, rle: encodeRLE(counts) };
}

// Fold one more answer into a zone's stored grid (in place) — the same O(cells)
// step the resident / non-resident arrays get, so a submit never re-reads or
// re-rasterises anybody else's answers.
export function incrementZoneGrid(zoneGrid, clippedPolygons) {
  const { params } = zoneGrid;
  const counts = decodeRLE(zoneGrid.rle);
  const cosA = Math.cos(params.angle), sinA = Math.sin(params.angle);
  const proj = makeLocalProjector(params.lng0, params.lat0);
  const areas = prepareSubmission(clippedPolygons);

  for (let i = 0; i < counts.length; i++) {
    if (counts[i] < 0) continue;
    const center = cellCenterFromIndex(params, i, cosA, sinA, proj);
    if (coversPoint(areas, center)) counts[i]++;
  }
  zoneGrid.rle = encodeRLE(counts);
  return zoneGrid;
}

// Fold one new submission into an existing compact grid (in place), so a submit
// costs O(cells) CPU instead of re-reading and re-rasterising every submission
// in the city. Only the array for the submitter's own residency answer moves.
export function incrementLiveCompact(compact, clippedPolygons, resident) {
  const { params } = compact;
  const key = resident ? 'rleIn' : 'rleOut';
  const counts = decodeRLE(compact[key]);
  const cosA = Math.cos(params.angle), sinA = Math.sin(params.angle);
  const proj = makeLocalProjector(params.lng0, params.lat0);
  const submission = prepareSubmission(clippedPolygons);

  for (let i = 0; i < counts.length; i++) {
    if (counts[i] < 0) continue;
    const center = cellCenterFromIndex(params, i, cosA, sinA, proj);
    if (coversPoint(submission, center)) counts[i]++;
  }
  compact[key] = encodeRLE(counts);
  return compact;
}
