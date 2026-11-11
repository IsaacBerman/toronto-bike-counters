import { NextResponse } from 'next/server';

// Every Bike Share station with its average trips a day over the last two
// weeks, for the station map.
//
// The map used to make both bikeraccoon calls itself, one after the other:
// the station list (~180 KB) and then every station's daily activity (~15,000
// rows, ~2.4 MB, uncompressed). All it needs from them is one number per
// station, so this does the join once, returns ~1,100 short rows, and lets the
// edge cache serve that to everyone for 15 minutes.

const KEY = 'YIOJaaLtLdazfrG7GVwcyAybB2WfpmSaxtCUx6gxLBw';
const DAYS = 13; // full days before today; today counts as the part elapsed

// Today's date and the fraction of it elapsed, in Toronto.
function torontoNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  const today = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day));
  const fraction = (+parts.hour * 3600 + +parts.minute * 60 + +parts.second) / 86400;
  return { today, fraction };
}

const stamp = (d) => d.toISOString().slice(0, 10).replaceAll('-', '') + '00';

export async function GET() {
  const { today, fraction } = torontoNow();
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - DAYS);

  const [stationsRes, activityRes] = await Promise.all([
    fetch('https://api.raccoon.bike/stations?system=bike_share_toronto', { cache: 'no-store' }),
    fetch(
      `https://api.raccoon.bike/activity?system=bike_share_toronto&feed=station&start=${stamp(start)}&end=${stamp(today)}&frequency=d&station=all&key=${KEY}`,
      { cache: 'no-store' }
    ),
  ]);
  if (!stationsRes.ok || !activityRes.ok) {
    return NextResponse.json({ error: 'Station data unavailable' }, { status: 502 });
  }
  const [{ data: stations = [] }, { data: activity = [] }] = await Promise.all([stationsRes.json(), activityRes.json()]);

  const trips = new Map();
  for (const row of activity) {
    trips.set(row.station_id, (trips.get(row.station_id) || 0) + (row.trips || 0));
  }

  const rows = stations.map((s) => ({
    station_id: s.station_id,
    name: s.name,
    lat: Math.round(s.lat * 1e5) / 1e5,
    lon: Math.round(s.lon * 1e5) / 1e5,
    dailyTrips: Math.round(((trips.get(s.station_id) || 0) / (DAYS + fraction)) * 10) / 10,
  }));

  return NextResponse.json(
    { stations: rows },
    { headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' } }
  );
}
