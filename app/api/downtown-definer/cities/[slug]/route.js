import { NextResponse } from 'next/server';
import { getCityBySlug } from '../../../../lib/downtown-definer/db';

export async function GET(request, { params }) {
  const { slug } = await params;
  const city = await getCityBySlug(slug);

  if (!city) {
    return NextResponse.json({ error: 'City not found.' }, { status: 404 });
  }

  // A city's boundary never changes, so let the edge cache serve it.
  return NextResponse.json(
    { city },
    { headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=86400' } }
  );
}
