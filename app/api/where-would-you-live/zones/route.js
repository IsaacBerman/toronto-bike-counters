import { NextResponse } from 'next/server';
import { getCityBySlug } from '../../../lib/downtown-definer/db';
import { cachedZoneLayout } from '../../../lib/where-would-you-live/zoneCache';

// The zone layout is a pure function of the city boundary — it exists before
// anyone has answered anything, and it never changes unless the boundary does.
// So it can be cached hard: a week at the edge, a month stale. A few hundred
// bytes, no submission data, nothing personal.
const EDGE_CACHE = { 'Cache-Control': 'public, s-maxage=604800, stale-while-revalidate=2592000' };

export async function GET(request) {
  const citySlug = request.nextUrl.searchParams.get('city');
  if (!citySlug) {
    return NextResponse.json({ error: 'A city is required.' }, { status: 400 });
  }

  const city = await getCityBySlug(citySlug); // served from the in-memory city cache
  if (!city) {
    return NextResponse.json({ error: 'City not found.' }, { status: 404 });
  }

  return NextResponse.json({ zoneLayout: cachedZoneLayout(city) }, { headers: EDGE_CACHE });
}
