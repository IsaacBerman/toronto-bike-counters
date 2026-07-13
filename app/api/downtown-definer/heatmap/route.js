import { NextResponse } from 'next/server';
import {
  getCityBySlug,
  getClippedPolygonsForCity,
  getClippedSubmissionCount,
  getHeatmapCache,
  saveHeatmapCache,
} from '../../../lib/downtown-definer/db';
import { buildCompactGrid, HEATMAP_ALGO_VERSION } from '../../../lib/downtown-definer/geo';

// Let Vercel's edge cache the heatmap so repeat views of a popular city are
// served from the CDN — no function invocation, no DB query. With large
// samples one more vote barely changes the map, so even a day of staleness is
// invisible to viewers, and each edge region hits the function (and wakes the
// DB) at most about once a day per city — the measured ~4 heatmap cache
// misses/min at 1h TTL were what kept the Neon compute from ever suspending.
// The submitter still sees their own vote immediately (their post-submit
// fetch cache-busts with a timestamp + no-store).
const EDGE_CACHE = { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' };

// In-memory grid cache (per warm instance), keyed by city slug. Reused while the
// submission count is unchanged so we skip both the DB read and the rebuild.
const gridCache = new Map(); // slug -> { count, payload, ts }
const CACHE_TTL_MS = 30 * 60 * 1000;
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
    return NextResponse.json(cached.payload, { headers: EDGE_CACHE });
  }

  // 2) Persistent compact-grid cache — send the tiny { params, rle } straight
  //    through (the client rebuilds the geometry), with no polygon download.
  const dbCache = await getHeatmapCache(city.id);
  if (
    dbCache &&
    dbCache.submission_count === count &&
    dbCache.algo_version === HEATMAP_ALGO_VERSION &&
    dbCache.counts?.params
  ) {
    const payload = { grid: dbCache.counts, submissionCount: count };
    rememberInMemory(citySlug, count, payload);
    return NextResponse.json(payload, { headers: EDGE_CACHE });
  }

  // 3) Full recompute: read the polygons once, build the compact grid, persist it.
  const clippedPolygons = await getClippedPolygonsForCity(city.id);
  const compact = buildCompactGrid(city.boundary, city.bbox, clippedPolygons);
  const payload = { grid: compact, submissionCount: clippedPolygons.length };

  await saveHeatmapCache(city.id, clippedPolygons.length, HEATMAP_ALGO_VERSION, compact);
  rememberInMemory(citySlug, clippedPolygons.length, payload);

  return NextResponse.json(payload, { headers: EDGE_CACHE });
}
