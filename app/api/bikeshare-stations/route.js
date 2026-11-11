import { NextResponse } from 'next/server';

// Every Bike Share station with its average trips a day over the last two
// weeks, for the station map.
//
// The map used to make both bikeraccoon calls itself, one after the other:
// the station list (~180 KB) and then every station's daily activity (~15,000
// rows, ~2.4 MB, uncompressed). All it needs from them is one number per
// station, so this does the join once and returns ~1,100 short rows.
//
// Built as a static response that Next regenerates at most once an hour, so
// every region shares one copy and the function runs ~24 times a day rather
// than per region per cache expiry. Two-week averages barely move in an hour.
// force-static keeps it static even though the upstream fetches are no-store;
// the activity response is over the 2 MB fetch-cache limit anyway.
export const dynamic = 'force-static';
export const revalidate = 3600;

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
  // Throwing, rather than returning an error response, makes a failed
  // regeneration keep serving the last good copy.
  if (!stationsRes.ok || !activityRes.ok) throw new Error('Station data unavailable');
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

  return NextResponse.json({ stations: rows });
}
