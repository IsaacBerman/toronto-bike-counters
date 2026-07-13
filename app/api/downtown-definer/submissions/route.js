import { NextResponse } from 'next/server';
import {
  getCityBySlug,
  insertSubmission,
  getHeatmapCache,
  saveHeatmapCache,
} from '../../../lib/downtown-definer/db';
import {
  clipPolygonToBoundary,
  pointsToPolygonGeometry,
  incrementCompactCounts,
  HEATMAP_ALGO_VERSION,
} from '../../../lib/downtown-definer/geo';
import {
  getSubmitterIdentity,
  withSubmittedCity,
  DEV_IDENTITY_COOKIE,
  SUBMITTED_CITIES_COOKIE,
} from '../../../lib/downtown-definer/identity';

// Readable by client JS (httpOnly: false) so the app can skip the status
// call entirely for cities this browser never submitted for.
function markCitySubmitted(response, request, slug) {
  response.cookies.set(SUBMITTED_CITIES_COOKIE, withSubmittedCity(request, slug), {
    httpOnly: false,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  });
}

// Fold the new vote into the cached compact grid (cheap, O(cells), no boundary
// or polygon re-read) instead of forcing a full recompute on the next view.
// Best-effort: if the cache is missing/stale, we skip and the next heatmap view
// rebuilds it once. A lost update (concurrent submits) leaves the cached count
// short of the real count, which the heatmap route detects and self-heals.
async function foldVoteIntoHeatmapCache(city, clippedPolygon) {
  try {
    const cache = await getHeatmapCache(city.id);
    if (!cache || cache.algo_version !== HEATMAP_ALGO_VERSION || !cache.counts?.params) return;
    const compact = cache.counts; // { params, rle } (column predates the RLE encoding)
    incrementCompactCounts(compact, clippedPolygon);
    await saveHeatmapCache(city.id, cache.submission_count + 1, HEATMAP_ALGO_VERSION, compact);
  } catch (error) {
    console.error('Heatmap incremental update failed:', error);
  }
}

function isValidPoints(points) {
  return (
    Array.isArray(points) &&
    points.length >= 3 &&
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
  const points = body?.points;

  if (!citySlug || !isValidPoints(points)) {
    return NextResponse.json({ error: 'A city and at least 3 points are required.' }, { status: 400 });
  }

  const city = await getCityBySlug(citySlug);
  if (!city) {
    return NextResponse.json({ error: 'City not found.' }, { status: 404 });
  }

  const clippedPolygon = clipPolygonToBoundary(points, city.boundary);
  if (!clippedPolygon) {
    return NextResponse.json(
      { error: "Your shape doesn't overlap this city's boundary at all." },
      { status: 400 }
    );
  }

  const { hash, newCookieValue } = getSubmitterIdentity(request);

  const inserted = await insertSubmission({
    cityId: city.id,
    submitterHash: hash,
    rawPolygon: pointsToPolygonGeometry(points),
    clippedPolygon,
  });

  if (!inserted) {
    const conflict = NextResponse.json(
      { error: "You've already submitted a definition for this city." },
      { status: 409 }
    );
    // Same submitter from a browser without the cookie (cleared, or another
    // device on the same IP): restore it so the follow-up status fetch — and
    // future visits — work as if they'd submitted here.
    markCitySubmitted(conflict, request, city.slug);
    return conflict;
  }

  await foldVoteIntoHeatmapCache(city, clippedPolygon);

  const response = NextResponse.json({ success: true });
  markCitySubmitted(response, request, city.slug);
  if (newCookieValue) {
    response.cookies.set(DEV_IDENTITY_COOKIE, newCookieValue, {
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return response;
}
