import { NextResponse } from 'next/server';
import {
  getCityBySlug,
  getClippedPolygonsForCity,
  getClippedSubmissionCount,
} from '../../../lib/downtown-definer/db';
import { buildHeatmapGrid } from '../../../lib/downtown-definer/geo';

export const dynamic = 'force-dynamic';

// In-memory cache of the computed grid, keyed by city slug. Reused while the
// city's submission count is unchanged, so we skip the expensive grid rebuild
// on repeat views. Lives on the (warm) serverless instance — a cold start just
// recomputes once. Self-invalidates when a new submission changes the count.
const gridCache = new Map(); // slug -> { count, payload, ts }
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_CITIES = 24;

export async function GET(request) {
  const citySlug = request.nextUrl.searchParams.get('city');
  if (!citySlug) {
    return NextResponse.json({ error: 'A city is required.' }, { status: 400 });
  }

  const city = await getCityBySlug(citySlug);
  if (!city) {
    return NextResponse.json({ error: 'City not found.' }, { status: 404 });
  }

  const count = await getClippedSubmissionCount(city.id);
  const cached = gridCache.get(citySlug);
  if (cached && cached.count === count && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json(cached.payload);
  }

  const clippedPolygons = await getClippedPolygonsForCity(city.id);
  const grid = buildHeatmapGrid(city.boundary, city.bbox, clippedPolygons);
  const payload = { grid, submissionCount: clippedPolygons.length };

  gridCache.set(citySlug, { count: clippedPolygons.length, payload, ts: Date.now() });
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

  return NextResponse.json(payload);
}
