import { NextResponse } from 'next/server';
import { getHistory } from '../../../lib/slow-zones/db';

export const dynamic = 'force-dynamic';

// Data changes when the crons ingest (see vercel.json): 15:00 UTC after the
// TTC's morning update, and 21:00 UTC to pick up anything they posted in the
// afternoon. Cache at the edge until shortly after whichever comes next, so
// the DB wakes at most twice a day per edge region — same spirit as the
// downtown-definer cache policy. These hours must track vercel.json; a cache
// that outlasts an ingest hides that ingest until the following day.
const INGEST_HOURS_UTC = [15, 21];

function secondsUntilNextIngest() {
  const now = new Date();
  const candidates = [];
  for (const dayOffset of [0, 1]) {
    for (const hour of INGEST_HOURS_UTC) {
      const t = new Date(now);
      t.setUTCDate(t.getUTCDate() + dayOffset);
      t.setUTCHours(hour, 15, 0, 0); // 15 min buffer for the cron to finish
      if (t > now) candidates.push(t);
    }
  }
  const next = Math.min(...candidates);
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
