import { NextResponse } from 'next/server';
import { getHistory } from '../../../lib/slow-zones/db';

export const dynamic = 'force-dynamic';

// Data changes once a day (the 15:00 UTC cron ingest — 10/11am Toronto, after
// the TTC's morning update), so cache at the edge until shortly after the next
// ingest — the DB wakes at most once per day per edge region, same spirit as
// the downtown-definer cache policy.
function secondsUntilNextIngest() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(15, 15, 0, 0); // 15 min buffer for the cron to finish
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return Math.max(Math.floor((next - now) / 1000), 300);
}

export async function GET() {
  try {
    const history = await getHistory();
    return NextResponse.json(history, {
      headers: {
        'Cache-Control': `public, s-maxage=${secondsUntilNextIngest()}, stale-while-revalidate=604800`,
      },
    });
  } catch (error) {
    console.error('Slow-zone data fetch failed:', error);
    return NextResponse.json({ error: 'Failed to load data' }, { status: 500 });
  }
}
