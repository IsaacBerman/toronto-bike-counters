import { NextResponse } from 'next/server';
import { getCityBySlug } from '../../../lib/downtown-definer/db';
import { getLiveSubmissionByHash } from '../../../lib/where-would-you-live/db';
import {
  getSubmitterIdentity,
  readSubmittedCitiesFor,
  IDENTITY_COOKIE,
  LIVE_SUBMITTED_CITIES_COOKIE,
} from '../../../lib/downtown-definer/identity';

// Whether this visitor (by identity cookie) already answered for this city, and
// the areas they drew, so the client can go straight to the results view.
export async function GET(request) {
  const citySlug = request.nextUrl.searchParams.get('city');
  if (!citySlug) {
    return NextResponse.json({ error: 'A city is required.' }, { status: 400 });
  }

  // No entry for this city in the submitted-cities cookie means this browser
  // never submitted here — answer without touching the database at all. That's
  // the overwhelmingly common case (the client normally doesn't even call us
  // then). A lost cookie still self-heals: submitting returns a 409 that
  // restores it, and the follow-up status call takes the DB path.
  if (!readSubmittedCitiesFor(request, LIVE_SUBMITTED_CITIES_COOKIE).includes(citySlug)) {
    return NextResponse.json({ submitted: false, yourPolygons: null, resident: null, zoneId: null });
  }

  const city = await getCityBySlug(citySlug);
  if (!city) {
    return NextResponse.json({ error: 'City not found.' }, { status: 404 });
  }

  const { hash, newCookieValue } = getSubmitterIdentity(request);
  const existing = await getLiveSubmissionByHash(city.id, hash);

  const response = NextResponse.json({
    submitted: !!existing,
    yourPolygons: existing?.raw_polygons || null,
    resident: existing?.resident ?? null,
    zoneId: existing?.zone_id ?? null,
  });
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
