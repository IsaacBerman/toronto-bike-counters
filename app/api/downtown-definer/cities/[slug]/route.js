import { NextResponse } from 'next/server';
import { getCityBySlug } from '../../../../lib/downtown-definer/db';

export async function GET(request, { params }) {
  const { slug } = await params;
  const city = await getCityBySlug(slug);

  if (!city) {
    return NextResponse.json({ error: 'City not found.' }, { status: 404 });
  }

  // A city's boundary never changes, so let the edge cache serve it for a day
  // (and stale for a week while revalidating) — deep links to a known city
  // then almost never invoke this function.
  return NextResponse.json(
    { city },
    { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' } }
  );
}
