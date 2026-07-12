import { NextResponse } from 'next/server';
import { searchCities } from '../../../lib/downtown-definer/nominatim';

// Search results for a given query are identical for everyone (geocoding), so
// let the edge cache them. This turns most search-as-you-type keystrokes into
// edge HITs — no function invocation, no CPU, no Nominatim call.
const EDGE_CACHE = { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' };
// Errors/empties: cache briefly so a burst of the same query doesn't hammer us,
// but recover quickly.
const SHORT_CACHE = { 'Cache-Control': 'public, s-maxage=30' };

// In-memory cache of recent searches so repeated queries don't re-hit Nominatim
// (whose public server rate-limits). Per warm instance; a cold start just repopulates.
const cache = new Map(); // normalized q -> { suggestions, ts }
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;
const MIN_LENGTH = 3;

export async function GET(request) {
  const raw = (request.nextUrl.searchParams.get('q') || '').trim();
  const key = raw.toLowerCase();
  if (key.length < MIN_LENGTH) {
    return NextResponse.json({ suggestions: [] }, { headers: SHORT_CACHE });
  }

  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json({ suggestions: cached.suggestions }, { headers: EDGE_CACHE });
  }

  try {
    const suggestions = await searchCities(raw);
    cache.set(key, { suggestions, ts: Date.now() });
    if (cache.size > CACHE_MAX) {
      cache.delete(cache.keys().next().value); // evict oldest-inserted
    }
    return NextResponse.json({ suggestions }, { headers: EDGE_CACHE });
  } catch (error) {
    console.error('City search failed:', error);
    // Serve a stale cached result if we have one; otherwise signal the outage.
    if (cached) {
      return NextResponse.json({ suggestions: cached.suggestions, stale: true }, { headers: EDGE_CACHE });
    }
    return NextResponse.json({ suggestions: [], error: true }, { headers: SHORT_CACHE });
  }
}
