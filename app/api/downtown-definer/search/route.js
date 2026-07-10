import { NextResponse } from 'next/server';
import { searchCities } from '../../../lib/downtown-definer/nominatim';

export const dynamic = 'force-dynamic';

// In-memory cache of recent searches so repeated queries don't re-hit Nominatim
// (whose public server rate-limits). Per warm instance; a cold start just repopulates.
const cache = new Map(); // normalized q -> { suggestions, ts }
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
const MIN_LENGTH = 3;

export async function GET(request) {
  const raw = (request.nextUrl.searchParams.get('q') || '').trim();
  const key = raw.toLowerCase();
  if (key.length < MIN_LENGTH) {
    return NextResponse.json({ suggestions: [] });
  }

  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json({ suggestions: cached.suggestions });
  }

  try {
    const suggestions = await searchCities(raw);
    cache.set(key, { suggestions, ts: Date.now() });
    if (cache.size > CACHE_MAX) {
      cache.delete(cache.keys().next().value); // evict oldest-inserted
    }
    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error('City search failed:', error);
    // Serve a stale cached result if we have one; otherwise signal the outage.
    if (cached) {
      return NextResponse.json({ suggestions: cached.suggestions, stale: true });
    }
    return NextResponse.json({ suggestions: [], error: true });
  }
}
