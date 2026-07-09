import { NextResponse } from 'next/server';
import { getCityBySlug, getSubmissionByHash } from '../../../lib/downtown-definer/db';
import { getSubmitterIdentity, DEV_IDENTITY_COOKIE } from '../../../lib/downtown-definer/identity';

// Reports whether the current visitor (by IP hash in prod, dev cookie in dev)
// has already submitted a definition for this city, and returns their stored
// raw polygon so the client can jump straight to the results view.
export async function GET(request) {
  const citySlug = request.nextUrl.searchParams.get('city');
  if (!citySlug) {
    return NextResponse.json({ error: 'A city is required.' }, { status: 400 });
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
    response.cookies.set(DEV_IDENTITY_COOKIE, newCookieValue, {
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return response;
}
