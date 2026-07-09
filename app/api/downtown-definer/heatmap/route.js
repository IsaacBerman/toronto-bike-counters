import { NextResponse } from 'next/server';
import { getCityBySlug, getClippedPolygonsForCity } from '../../../lib/downtown-definer/db';
import { buildHeatmapGrid } from '../../../lib/downtown-definer/geo';

export async function GET(request) {
  const citySlug = request.nextUrl.searchParams.get('city');
  if (!citySlug) {
    return NextResponse.json({ error: 'A city is required.' }, { status: 400 });
  }

  const city = await getCityBySlug(citySlug);
  if (!city) {
    return NextResponse.json({ error: 'City not found.' }, { status: 404 });
  }

  const clippedPolygons = await getClippedPolygonsForCity(city.id);
  const grid = buildHeatmapGrid(city.boundary, city.bbox, clippedPolygons);

  return NextResponse.json({ grid, submissionCount: clippedPolygons.length });
}
