import { NextResponse } from 'next/server';
import { getCityBySlug } from '../../../lib/downtown-definer/db';
import { liveCityView } from '../../../lib/where-would-you-live/cityView';

// The boundary this tool draws and measures against. Usually identical to the
// one in `cities`; for a handful of cities stored as their small central
// municipality it's a wider one set just for this tool. Boundaries never change,
// so this caches for a week — and the common "no override" answer is a few bytes.
const EDGE_CACHE = { 'Cache-Control': 'public, s-maxage=604800, stale-while-revalidate=2592000' };

export async function GET(request) {
  const citySlug = request.nextUrl.searchParams.get('city');
  if (!citySlug) {
    return NextResponse.json({ error: 'A city is required.' }, { status: 400 });
  }

  const city = await getCityBySlug(citySlug);
  if (!city) {
    return NextResponse.json({ error: 'City not found.' }, { status: 404 });
  }

  const view = await liveCityView(city);
  if (!view.liveBoundaryOverride) {
    // Nothing to send: the client already has the standard boundary.
    return NextResponse.json({ override: false }, { headers: EDGE_CACHE });
  }
  return NextResponse.json(
    { override: true, boundary: view.boundary, bbox: view.bbox },
    { headers: EDGE_CACHE }
  );
}
