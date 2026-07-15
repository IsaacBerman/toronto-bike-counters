import { NextResponse } from 'next/server';
import { getCityBySlug, getSubmissionByHash } from '../../../lib/downtown-definer/db';
import {
  getSubmitterIdentity,
  readSubmittedCities,
  IDENTITY_COOKIE,
} from '../../../lib/downtown-definer/identity';

// Reports whether the current visitor (by identity cookie) has already
// submitted a definition for this city, and returns their stored raw polygon
// so the client can jump straight to the results view.
export async function GET(request) {
  const citySlug = request.nextUrl.searchParams.get('city');
  if (!citySlug) {
    return NextResponse.json({ error: 'A city is required.' }, { status: 400 });
  }

  // No submitted-cities cookie for this city means this browser never
  // submitted here — answer without any DB work (the overwhelmingly common
  // case; the client normally doesn't even call us then). A lost
  // submitted-cities cookie is still caught: submitting returns a 409 that
  // restores it, and the follow-up status call takes the DB path.
  if (!readSubmittedCities(request).includes(citySlug)) {
    return NextResponse.json({ submitted: false, yourPolygon: null });
  }

  const city = await getCityBySlug(citySlug);
  if (!city) {
    return NextResponse.json({ error: 'City not found.' }, { status: 404 });
  }

  const { hash, newCookieValue } = getSubmitterIdentity(request);
  const existing = await getSubmissionByHash(city.id, hash);

  const response = NextResponse.json({
    submitted: !!existing,
    yourPolygon: existing?.raw_polygon || null,
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
