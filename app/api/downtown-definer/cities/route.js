import { NextResponse } from 'next/server';
import { getCities, getCityBySlug, getCityByOsm, insertCity } from '../../../lib/downtown-definer/db';
import { fetchCityBoundary, slugify } from '../../../lib/downtown-definer/nominatim';

export async function GET() {
  const cities = await getCities();
  // Cities change rarely — let the edge cache serve the dropdown list for a
  // long while. A newly added city may take up to ~6 h to appear for other
  // users (the person who added it sees it immediately on their own client,
  // and anyone can still reach any city via search, which creates it on
  // demand), in exchange for far fewer function invocations and DB wakes.
  return NextResponse.json(
    { cities },
    { headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=86400' } }
  );
}

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const name = body?.name?.trim();

  if (!name) {
    return NextResponse.json({ error: 'City name is required.' }, { status: 400 });
  }

  const slug = slugify(name);
  if (!slug) {
    return NextResponse.json({ error: 'City name is required.' }, { status: 400 });
  }

  const existing = await getCityBySlug(slug);
  if (existing) {
    return NextResponse.json({ city: existing });
  }

  const boundaryData = await fetchCityBoundary(name);
  if (!boundaryData) {
    return NextResponse.json({ error: `Could not find a boundary for "${name}".` }, { status: 404 });
  }

  // De-duplicate on the resolved OpenStreetMap entity so different names for the
  // same place (e.g. "New York" / "New York City" / "NYC") collapse to one city.
  const existingByOsm = await getCityByOsm(boundaryData.osmType, boundaryData.osmId);
  if (existingByOsm) {
    return NextResponse.json({ city: existingByOsm });
  }

  const city = await insertCity({
    slug,
    name,
    displayName: boundaryData.displayName,
    boundary: boundaryData.boundary,
    bbox: boundaryData.bbox,
    osmType: boundaryData.osmType,
    osmId: boundaryData.osmId,
  });

  return NextResponse.json({ city });
}
