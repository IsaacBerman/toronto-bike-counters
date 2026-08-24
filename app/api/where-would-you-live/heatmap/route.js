import { NextResponse } from 'next/server';
import { getCityBySlug } from '../../../lib/downtown-definer/db';
import {
  getLiveCounts,
  getLiveSubmissionsForCity,
  getLiveSubmissionsForZone,
  getLiveHeatmapCache,
  saveLiveHeatmapCache,
  getLiveZoneGrid,
  saveLiveZoneGrid,
} from '../../../lib/where-would-you-live/db';
import {
  buildLiveCompactGrid,
  buildZoneGrid,
  LIVE_HEATMAP_ALGO_VERSION,
} from '../../../lib/where-would-you-live/geo';
import { cachedZoneLayout } from '../../../lib/where-would-you-live/zoneCache';
import { liveCityView } from '../../../lib/where-would-you-live/cityView';
import { zoneLayoutSignature } from '../../../lib/where-would-you-live/zoneGrid';

// Same caching contract as the downtown heatmap: a day at the edge, a week
// stale-while-revalidate. One more answer barely moves a map built from many,
// so staleness is invisible, and each edge region wakes the DB at most about
// once a day per city (and per zone). The submitter still sees their own answer
// immediately — their post-submit fetch cache-busts with a timestamp + no-store.
const EDGE_CACHE = { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' };

// The base response serves the resident / non-resident / everyone filters from
// one payload: the two count arrays share a cell layout, so the client adds them
// rather than asking for a third grid. A zone filter is one extra request the
// first time that zone is opened, then it's on the CDN like everything else.
const gridCache = new Map(); // slug -> { resident, nonresident, payload, ts }
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_CITIES = 24;

function rememberInMemory(slug, resident, nonresident, payload) {
  gridCache.set(slug, { resident, nonresident, payload, ts: Date.now() });
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

// One zone's grid. The row is normally already there — it was created the first
// time somebody answered from this zone and incremented on every answer since.
// It's only built here when it's missing, stale, or was laid out against
// different squares, and even then the read is just that zone's answers.
async function serveZoneGrid(city, zoneId, expectedCount) {
  if (!expectedCount) {
    return NextResponse.json({ zoneId, grid: null, count: 0 }, { headers: EDGE_CACHE });
  }
  const layoutSig = zoneLayoutSignature(cachedZoneLayout(city));
  const cached = await getLiveZoneGrid(city.id, zoneId);
  if (
    cached &&
    cached.algo_version === LIVE_HEATMAP_ALGO_VERSION &&
    cached.layout_sig === layoutSig &&
    cached.submission_count === expectedCount &&
    cached.counts?.params
  ) {
    return NextResponse.json(
      { zoneId, grid: cached.counts, count: expectedCount },
      { headers: EDGE_CACHE }
    );
  }

  const polygons = await getLiveSubmissionsForZone(city.id, zoneId);
  const grid = buildZoneGrid(city.boundary, city.bbox, polygons);
  await saveLiveZoneGrid(city.id, zoneId, polygons.length, LIVE_HEATMAP_ALGO_VERSION, layoutSig, grid);
  return NextResponse.json(
    { zoneId, grid, count: polygons.length },
    { headers: EDGE_CACHE }
  );
}

export async function GET(request) {
  const citySlug = request.nextUrl.searchParams.get('city');
  if (!citySlug) {
    return NextResponse.json({ error: 'A city is required.' }, { status: 400 });
  }

  const row = await getCityBySlug(citySlug); // served from the in-memory city cache
  if (!row) {
    return NextResponse.json({ error: 'City not found.' }, { status: 404 });
  }
  // Wider boundary where one is set for this tool (Melbourne is stored as the
  // 38 km2 City of Melbourne, which is the downtown answer, not this one).
  const city = await liveCityView(row);

  // Filter totals + the per-zone tallies, in one small grouped query.
  const counts = await getLiveCounts(city.id);

  const zoneParam = request.nextUrl.searchParams.get('zone');
  if (zoneParam != null) {
    const zoneId = Number(zoneParam);
    if (!Number.isInteger(zoneId)) {
      return NextResponse.json({ error: 'Invalid zone.' }, { status: 400 });
    }
    return serveZoneGrid(city, zoneId, counts.zoneTotals[zoneId] || 0);
  }

  // 1) Warm in-memory grid cache.
  const cached = gridCache.get(citySlug);
  if (
    cached &&
    cached.resident === counts.resident &&
    cached.nonresident === counts.nonresident &&
    Date.now() - cached.ts < CACHE_TTL_MS
  ) {
    return NextResponse.json({ ...cached.payload, zoneTotals: counts.zoneTotals }, { headers: EDGE_CACHE });
  }

  const zoneLayout = cachedZoneLayout(city);

  // 2) Persistent compact-grid cache — the tiny { params, rleIn, rleOut } goes
  //    straight through; the client rebuilds the hex geometry itself.
  const dbCache = await getLiveHeatmapCache(city.id);
  if (
    dbCache &&
    dbCache.resident_count === counts.resident &&
    dbCache.nonresident_count === counts.nonresident &&
    dbCache.algo_version === LIVE_HEATMAP_ALGO_VERSION &&
    dbCache.counts?.params
  ) {
    const payload = {
      grid: dbCache.counts,
      zoneLayout,
      residentCount: counts.resident,
      nonResidentCount: counts.nonresident,
    };
    rememberInMemory(citySlug, counts.resident, counts.nonresident, payload);
    return NextResponse.json({ ...payload, zoneTotals: counts.zoneTotals }, { headers: EDGE_CACHE });
  }

  // 3) Full recompute: read every submission once, rasterise, persist.
  const submissions = await getLiveSubmissionsForCity(city.id);
  const compact = buildLiveCompactGrid(city.boundary, city.bbox, submissions);
  let residentCount = 0;
  let nonResidentCount = 0;
  for (const submission of submissions) {
    if (!submission.clippedPolygons?.length) continue;
    if (submission.resident) residentCount++;
    else nonResidentCount++;
  }
  const payload = { grid: compact, zoneLayout, residentCount, nonResidentCount };

  await saveLiveHeatmapCache(city.id, residentCount, nonResidentCount, LIVE_HEATMAP_ALGO_VERSION, compact);
  rememberInMemory(citySlug, residentCount, nonResidentCount, payload);

  return NextResponse.json({ ...payload, zoneTotals: counts.zoneTotals }, { headers: EDGE_CACHE });
}
