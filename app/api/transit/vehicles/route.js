import { NextResponse } from 'next/server';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

// Live surface-vehicle positions for the transit map. Proxies TTC's
// GTFS-realtime VehiclePositions feed because the browser can't read it
// directly (raw protobuf + no CORS headers on bustime.ttc.ca). We decode it
// here and hand the client a slim JSON array.
//
// Subway is NOT in this feed (TTC's realtime GTFS is surface-only); subway
// trains come from the NTAS prediction endpoint via a separate route.
const VEHICLES_URL = 'https://bustime.ttc.ca/gtfsrt/vehicles';

// route_short_name -> 'bus'|'streetcar'|'subway', generated from the official
// static GTFS by scripts/build-transit.mjs (npm run build:transit).
import ROUTE_TYPES from '../../../lib/transit/route-types.json';

function classify(routeId) {
  return ROUTE_TYPES[String(routeId)] || 'bus';
}

// The feed refreshes every ~20s; let Vercel's edge cache absorb repeat hits so
// we neither hammer TTC nor re-decode protobuf per viewer. Same edge-cache
// discipline as the downtown-definer routes.
const EDGE_CACHE = {
  'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
};

export async function GET() {
  let feed;
  try {
    const res = await fetch(VEHICLES_URL, {
      headers: { 'User-Agent': 'observingthecity/transit-live' },
      // don't let Next cache the upstream fetch itself; the edge cache above
      // is what we rely on, keyed on our response.
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `upstream ${res.status}` },
        { status: 502 },
      );
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);
  } catch (err) {
    return NextResponse.json(
      { error: 'feed unavailable', detail: String(err?.message || err) },
      { status: 502 },
    );
  }

  const vehicles = [];
  for (const entity of feed.entity) {
    const v = entity.vehicle;
    if (!v?.position) continue;
    const routeId = v.trip?.routeId || null;
    vehicles.push({
      id: v.vehicle?.id || entity.id,
      lat: v.position.latitude,
      lon: v.position.longitude,
      bearing: v.position.bearing ?? null,
      routeId,
      type: routeId ? classify(routeId) : 'bus',
      // seconds since epoch of this fix, for staleness / interpolation timing
      ts: v.timestamp ? Number(v.timestamp) : null,
    });
  }

  return NextResponse.json(
    {
      updatedAt: feed.header?.timestamp ? Number(feed.header.timestamp) : null,
      count: vehicles.length,
      vehicles,
    },
    { headers: EDGE_CACHE },
  );
}
