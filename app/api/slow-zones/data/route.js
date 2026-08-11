import { NextResponse } from 'next/server';
import { getHistory } from '../../../lib/slow-zones/db';

export const dynamic = 'force-dynamic';

// Data changes once a day (cron ingest), so cache hard at the edge to keep
// Neon compute near zero — same policy as the downtown-definer routes.
const EDGE_CACHE = { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' };

export async function GET() {
  try {
    const history = await getHistory();
    return NextResponse.json(history, { headers: EDGE_CACHE });
  } catch (error) {
    console.error('Slow-zone data fetch failed:', error);
    return NextResponse.json({ error: 'Failed to load data' }, { status: 500 });
  }
}
