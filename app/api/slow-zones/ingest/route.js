import { NextResponse } from 'next/server';
import { fetchSlowZones } from '../../../lib/slow-zones/scrape';
import { saveSnapshot } from '../../../lib/slow-zones/db';

export const dynamic = 'force-dynamic';

// Daily Vercel cron target (see vercel.json). Vercel sends
// "Authorization: Bearer $CRON_SECRET" when that env var is set.
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { asOf, zones } = await fetchSlowZones();
    // Toronto's calendar day, not UTC's (the cron fires in UTC).
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    const zoneTotal = await saveSnapshot(day, asOf, zones);
    return NextResponse.json({ ok: true, day, asOf, rows: zones.length, zoneTotal });
  } catch (error) {
    console.error('Slow-zone ingest failed:', error);
    return NextResponse.json({ error: String(error.message || error) }, { status: 500 });
  }
}
