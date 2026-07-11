import { NextResponse } from 'next/server';
import {
  getCityBySlug,
  getClippedPolygonsForCity,
  getClippedSubmissionCount,
  getHeatmapCache,
  saveHeatmapCache,
} from '../../../lib/downtown-definer/db';
import {
  buildGridCells,
  countVotesForCells,
  finalizeGrid,
  HEATMAP_ALGO_VERSION,
} from '../../../lib/downtown-definer/geo';

export const dynamic = 'force-dynamic';

// In-memory grid cache (per warm instance), keyed by city slug. Reused while the
// submission count is unchanged so we skip both the DB read and the rebuild.
const gridCache = new Map(); // slug -> { count, payload, ts }
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_CITIES = 24;

function rememberInMemory(slug, count, payload) {
  gridCache.set(slug, { count, payload, ts: Date.now() });
  if (gridCache.size > CACHE_MAX_CITIES) {
    let oldestKey = null;
    let oldestTs = Infinity;
    for (const [key, value] of gridCache) {
      if (value.ts < oldestTs) {
        oldestTs = value.ts;
        oldestKey = key;
      }
    }
    if (oldestKey) gridCache.delete(oldestKey);
  }
}

export async function GET(request) {
  const citySlug = request.nextUrl.searchParams.get('city');
  if (!citySlug) {
    return NextResponse.json({ error: 'A city is required.' }, { status: 400 });
  }

  const city = await getCityBySlug(citySlug); // boundary is served from the in-memory city cache
  if (!city) {
    return NextResponse.json({ error: 'City not found.' }, { status: 404 });
  }

  const count = await getClippedSubmissionCount(city.id); // small COUNT query

  // 1) Warm in-memory grid cache.
  const cached = gridCache.get(citySlug);
  if (cached && cached.count === count && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json(cached.payload);
  }

  // 2) Persistent counts cache — rebuild geometry from the (cached) boundary and
  //    the stored counts, avoiding a full download of every submission polygon.
  const dbCache = await getHeatmapCache(city.id);
  if (
    dbCache &&
    dbCache.submission_count === count &&
    dbCache.algo_version === HEATMAP_ALGO_VERSION &&
    Array.isArray(dbCache.counts)
  ) {
    const cells = buildGridCells(city.boundary, city.bbox);
    if (cells.length === dbCache.counts.length) {
      const grid = finalizeGrid(cells, dbCache.counts, count);
      const payload = { grid, submissionCount: count };
      rememberInMemory(citySlug, count, payload);
      return NextResponse.json(payload);
    }
  }

  // 3) Full recompute: read the polygons once, count, and persist the counts.
  const clippedPolygons = await getClippedPolygonsForCity(city.id);
  const cells = buildGridCells(city.boundary, city.bbox);
  const counts = countVotesForCells(cells, clippedPolygons);
  const grid = finalizeGrid(cells, counts, clippedPolygons.length);
  const payload = { grid, submissionCount: clippedPolygons.length };

  await saveHeatmapCache(city.id, clippedPolygons.length, HEATMAP_ALGO_VERSION, counts);
  rememberInMemory(citySlug, clippedPolygons.length, payload);

  return NextResponse.json(payload);
}
