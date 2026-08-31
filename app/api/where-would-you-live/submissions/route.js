import { NextResponse } from 'next/server';
import { getCityBySlug } from '../../../lib/downtown-definer/db';
import {
  insertLiveSubmission,
  countRecentLiveSubmissionsByIp,
  getLiveHeatmapCache,
  saveLiveHeatmapCache,
  getLiveZoneGrid,
  saveLiveZoneGrid,
  getLiveSubmissionsForZone,
  setLiveSubmissionZone,
} from '../../../lib/where-would-you-live/db';
import {
  clipAreasToBoundary,
  incrementLiveCompact,
  buildZoneGrid,
  incrementZoneGrid,
  LIVE_HEATMAP_ALGO_VERSION,
} from '../../../lib/where-would-you-live/geo';
import { cachedZoneLayout } from '../../../lib/where-would-you-live/zoneCache';
import { liveCityView } from '../../../lib/where-would-you-live/cityView';
import { zoneCenterLngLat, zoneLayoutSignature } from '../../../lib/where-would-you-live/zoneGrid';
import {
  getSubmitterIdentity,
  getClientIpHash,
  withSubmittedCityFor,
  IDENTITY_COOKIE,
  LIVE_SUBMITTED_CITIES_COOKIE,
} from '../../../lib/downtown-definer/identity';

// Deliberately very high: identity is per-browser-cookie, so the IP cap only
// exists to brake bulk abuse (scripted cookie-clearing). A shared egress IP
// (Apple Private Relay, campus NAT) won't reach it in normal use.
const SUBMISSIONS_PER_IP_PER_DAY = 500;
// Enough for "a few neighbourhoods I'd consider", low enough that one
// submission can't blow up the rasterising cost for everyone else.
const MAX_AREAS = 12;
const MAX_POINTS_PER_AREA = 200;

// Readable by client JS (httpOnly: false) so the app can skip the status call
// entirely for cities this browser never submitted for.
function markCitySubmitted(response, request, slug) {
  response.cookies.set(LIVE_SUBMITTED_CITIES_COOKIE, withSubmittedCityFor(request, LIVE_SUBMITTED_CITIES_COOKIE, slug), {
    httpOnly: false,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  });
}

// Fold the new submission into the cached compact grid (O(cells), no boundary
// or polygon re-read) instead of forcing a full recompute on the next view.
// Best-effort: a missing/stale cache is left alone and the next heatmap view
// rebuilds it once. A lost update (concurrent submits) leaves the cached counts
// short of the real counts, which the heatmap route detects and self-heals.
async function foldIntoHeatmapCache(city, clippedPolygons, resident) {
  try {
    const cache = await getLiveHeatmapCache(city.id);
    if (!cache || cache.algo_version !== LIVE_HEATMAP_ALGO_VERSION || !cache.counts?.params) return;
    const compact = cache.counts; // { params, rleIn, rleOut }
    incrementLiveCompact(compact, clippedPolygons, resident);
    await saveLiveHeatmapCache(
      city.id,
      cache.resident_count + (resident ? 1 : 0),
      cache.nonresident_count + (resident ? 0 : 1),
      LIVE_HEATMAP_ALGO_VERSION,
      compact
    );
  } catch (error) {
    console.error('Live heatmap incremental update failed:', error);
  }
}

// A zone's grid is born here, on the first answer from that zone, and is folded
// into on every answer after. Nothing is written for a zone nobody has answered
// from, which is why the vast majority of cities store no zone rows at all.
// Best-effort: if this fails or the stored row turns out to be stale, the read
// path rebuilds that one zone from its own answers.
async function foldIntoZoneGrid(city, zoneId, clippedPolygons) {
  if (zoneId == null) return;
  try {
    const layoutSig = zoneLayoutSignature(cachedZoneLayout(city));
    const existing = await getLiveZoneGrid(city.id, zoneId);
    if (
      existing &&
      existing.algo_version === LIVE_HEATMAP_ALGO_VERSION &&
      existing.layout_sig === layoutSig &&
      existing.counts?.params
    ) {
      const grid = existing.counts;
      incrementZoneGrid(grid, clippedPolygons);
      await saveLiveZoneGrid(
        city.id, zoneId, existing.submission_count + 1, LIVE_HEATMAP_ALGO_VERSION, layoutSig, grid
      );
      return;
    }
    // First answer from this zone (or a row laid out against different squares):
    // build it from just this zone's answers — normally the one just inserted.
    const polygons = await getLiveSubmissionsForZone(city.id, zoneId);
    const grid = buildZoneGrid(city.boundary, city.bbox, polygons);
    await saveLiveZoneGrid(
      city.id, zoneId, polygons.length, LIVE_HEATMAP_ALGO_VERSION, layoutSig, grid
    );
  } catch (error) {
    console.error('Live zone grid update failed:', error);
  }
}

function isValidArea(points) {
  return (
    Array.isArray(points) &&
    points.length >= 3 &&
    points.length <= MAX_POINTS_PER_AREA &&
    points.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1])
    )
  );
}

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const citySlug = body?.citySlug;
  const areas = body?.areas;
  const resident = body?.resident;
  const requestedZoneId = Number.isInteger(body?.zoneId) ? body.zoneId : null;

  if (typeof resident !== 'boolean') {
    return NextResponse.json({ error: 'Tell us whether you live in the city first.' }, { status: 400 });
  }
  if (
    !citySlug ||
    !Array.isArray(areas) ||
    areas.length === 0 ||
    areas.length > MAX_AREAS ||
    !areas.every(isValidArea)
  ) {
    return NextResponse.json(
      { error: `A city and between 1 and ${MAX_AREAS} areas of at least 3 points each are required.` },
      { status: 400 }
    );
  }

  const row = await getCityBySlug(citySlug);
  if (!row) {
    return NextResponse.json({ error: 'City not found.' }, { status: 404 });
  }
  const city = await liveCityView(row); // wider boundary where one is set

  const { raw, clipped } = clipAreasToBoundary(areas, city.boundary);
  if (clipped.length === 0) {
    return NextResponse.json(
      { error: "None of your areas overlap this city's boundary." },
      { status: 400 }
    );
  }

  // The zone is optional, and only meaningful for someone who lives in the city.
  // The client sends an id; the server resolves the square's own center from the
  // authoritative layout, so nothing finer than a zone is ever accepted, let
  // alone stored.
  let zoneId = null;
  let zoneCenter = null;
  if (resident && requestedZoneId != null) {
    const layout = cachedZoneLayout(city);
    if (layout.ids.includes(requestedZoneId)) {
      zoneId = requestedZoneId;
      zoneCenter = zoneCenterLngLat(layout, zoneId);
    }
  }

  const { hash, newCookieValue } = getSubmitterIdentity(request);

  const ipHash = getClientIpHash(request);
  const recentFromIp = await countRecentLiveSubmissionsByIp(ipHash);
  if (recentFromIp >= SUBMISSIONS_PER_IP_PER_DAY) {
    return NextResponse.json(
      { error: 'Too many submissions from your network today. Please try again tomorrow.' },
      { status: 429 }
    );
  }

  const inserted = await insertLiveSubmission({
    cityId: city.id,
    submitterHash: hash,
    resident,
    rawPolygons: raw,
    clippedPolygons: clipped,
    zoneId,
    zoneCenter,
    ipHash,
  });

  if (!inserted) {
    const conflict = NextResponse.json(
      { error: "You've already answered for this city." },
      { status: 409 }
    );
    // Identity is the browser cookie, so a conflict means this browser already
    // submitted and its submitted-cities cookie was lost or evicted: restore it
    // so the follow-up status fetch — and future visits — work again.
    markCitySubmitted(conflict, request, city.slug);
    return conflict;
  }

  await foldIntoHeatmapCache(city, clipped, resident);
  await foldIntoZoneGrid(city, zoneId, clipped);

  const response = NextResponse.json({ success: true });
  markCitySubmitted(response, request, city.slug);
  if (newCookieValue) {
    response.cookies.set(IDENTITY_COOKIE, newCookieValue, {
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    });
  }
  return response;
}

// The zone question is asked after the areas are already saved, so the answer
// arrives here as an amendment to this browser's existing row rather than as
// part of the insert. Nothing else about the submission can be changed, and a
// zone that is already set stays put.
export async function PATCH(request) {
  const body = await request.json().catch(() => null);
  const citySlug = body?.citySlug;
  const requestedZoneId = Number.isInteger(body?.zoneId) ? body.zoneId : null;

  if (!citySlug || requestedZoneId == null) {
    return NextResponse.json({ error: 'A city and a zone are required.' }, { status: 400 });
  }

  const row = await getCityBySlug(citySlug);
  if (!row) {
    return NextResponse.json({ error: 'City not found.' }, { status: 404 });
  }
  const city = await liveCityView(row);

  // Same rule as the insert: the client sends an id, the server resolves the
  // square's own center from the authoritative layout.
  const layout = cachedZoneLayout(city);
  if (!layout.ids.includes(requestedZoneId)) {
    return NextResponse.json({ error: 'Unknown area.' }, { status: 400 });
  }

  const { hash } = getSubmitterIdentity(request);
  const clipped = await setLiveSubmissionZone(
    city.id,
    hash,
    requestedZoneId,
    zoneCenterLngLat(layout, requestedZoneId)
  );
  if (!clipped) {
    // No row to amend (a lost identity cookie), or one that already carries a
    // zone. Either way the areas that matter are saved, so this is not worth
    // stopping the visitor over — the results are still what they asked for.
    return NextResponse.json({ success: false }, { status: 200 });
  }

  await foldIntoZoneGrid(city, requestedZoneId, clipped);
  return NextResponse.json({ success: true });
}
