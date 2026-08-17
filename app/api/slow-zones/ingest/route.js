import { NextResponse } from 'next/server';
import { fetchSlowZones } from '../../../lib/slow-zones/scrape';
import { saveSnapshot, logIngestRun } from '../../../lib/slow-zones/db';

export const dynamic = 'force-dynamic';

// Vercel stamps its own user agent on cron invocations, which is what
// distinguishes "the schedule fired" from "someone hit the URL" in the run log.
// Without it, a manual repair looks identical to a healthy cron.
function invocationSource(request) {
  const ua = request.headers.get('user-agent') || '';
  return /vercel-cron/i.test(ua) ? 'cron' : `manual (${ua.slice(0, 60) || 'no user-agent'})`;
}

// Daily Vercel cron target (see vercel.json). Vercel sends
// "Authorization: Bearer $CRON_SECRET" when that env var is set.
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const source = invocationSource(request);
  const startedAt = Date.now();
  // Toronto's calendar day, not UTC's (the cron fires in UTC).
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  console.log(`[slow-zones:ingest] start source=${source} day=${day}`);
  try {
    const { asOf, zones } = await fetchSlowZones();
    const fetchedMs = Date.now() - startedAt;
    console.log(
      `[slow-zones:ingest] scraped as_of="${asOf}" rows=${zones.length} in ${fetchedMs}ms`
    );
    const zoneTotal = await saveSnapshot(day, asOf, zones);
    const durationMs = Date.now() - startedAt;
    console.log(
      `[slow-zones:ingest] saved day=${day} zone_total=${zoneTotal} in ${durationMs}ms ` +
        `(scrape ${fetchedMs}ms, write ${durationMs - fetchedMs}ms)`
    );
    await logIngestRun({
      source, ok: true, day, asOf, rowCount: zones.length, zoneTotal, durationMs,
    });
    return NextResponse.json({ ok: true, day, asOf, rows: zones.length, zoneTotal });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = String(error?.message || error);
    console.error(`[slow-zones:ingest] FAILED day=${day} after ${durationMs}ms: ${message}`);
    await logIngestRun({ source, ok: false, day, durationMs, error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
