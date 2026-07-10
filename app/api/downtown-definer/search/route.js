import { NextResponse } from 'next/server';
import { searchCities } from '../../../lib/downtown-definer/nominatim';

export async function GET(request) {
  const q = request.nextUrl.searchParams.get('q');
  if (!q || q.trim().length < 2) {
    return NextResponse.json({ suggestions: [] });
  }
  const suggestions = await searchCities(q.trim());
  return NextResponse.json({ suggestions });
}
