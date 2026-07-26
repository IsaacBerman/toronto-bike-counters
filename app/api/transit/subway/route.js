import { NextResponse } from 'next/server';
import SUBWAY_LINES from '../../../lib/transit/subway-lines.json';

// Live subway train positions, reconstructed from TTC's NTAS next-train
// predictions — the TTC realtime GTFS feed is surface-only, and NTAS is what
// every public TTC subway tracker uses. NTAS gives per-platform "next trains
// in N minutes"; it does NOT give train GPS. Reconstruction: walk each line's
// platforms in travel order and wherever a platform's next-train time drops
// below the previous platform's, a train must be in between — place it along
// that segment proportionally to how close it is (SEG_MINUTES ≈ typical
// station-to-station run time).
const NTAS_URL = 'https://ntas.ttc.ca/api/ntas/get-next-train-time/';
const SEG_MINUTES = 2;
const CONCURRENCY = 25;
const FETCH_TIMEOUT_MS = 6000;

// NTAS updates on a ~20s cadence; the edge cache absorbs repeat viewers so
// the ~140-platform fanout runs at most ~3x/min per region.
const EDGE_CACHE = {
  'Cache-Control': 'public, s-maxage=20, stale-while-revalidate=60',
};

async function fetchPlatform(code) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(NTAS_URL + code, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'observingthecity/transit-live' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Fetch all platform codes with a small concurrency pool.
async function fetchAll(codes) {
  const results = new Map();
  let i = 0;
  async function worker() {
    while (i < codes.length) {
      const code = codes[i++];
      results.set(code, await fetchPlatform(code));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

// First "next train in N minutes" for a given line at a platform, or null.
function firstArrival(entries, line) {
  if (!Array.isArray(entries)) return null;
  const e = entries.find((x) => String(x.line) === String(line));
  if (!e || !e.nextTrains) return null;
  const n = parseFloat(String(e.nextTrains).split(',')[0]);
  return Number.isFinite(n) ? n : null;
}

// Compass bearing (deg clockwise from north) from a to b.
function bearing(a, b) {
  const dLon = (b.lon - a.lon) * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dLat = b.lat - a.lat;
  return (Math.atan2(dLon, dLat) * 180) / Math.PI;
}

export async function GET() {
  // Dedupe platform codes across all lines/directions.
  const codes = new Set();
  for (const dirs of Object.values(SUBWAY_LINES)) {
    for (const platforms of Object.values(dirs)) {
      for (const p of platforms) if (p.code) codes.add(String(p.code));
    }
  }

  const byCode = await fetchAll([...codes]);
  let reachable = 0;
  for (const v of byCode.values()) if (v) reachable++;

  const trains = [];
  for (const [line, dirs] of Object.entries(SUBWAY_LINES)) {
    for (const [dirId, platforms] of Object.entries(dirs)) {
      const t = platforms.map((p) =>
        p.code ? firstArrival(byCode.get(String(p.code)), line) : null,
      );
      let ordinal = 0;
      for (let i = 1; i < platforms.length; i++) {
        if (t[i] == null || t[i - 1] == null) continue;
        // Next train at platform i sooner than at the platform behind it —
        // there's a train on this segment.
        if (t[i] < t[i - 1]) {
          const a = platforms[i - 1];
          const b = platforms[i];
          const frac = Math.min(1, Math.max(0.05, 1 - t[i] / SEG_MINUTES));
          trains.push({
            id: `sub:${line}:${dirId}:${ordinal++}`,
            lat: a.lat + (b.lat - a.lat) * frac,
            lon: a.lon + (b.lon - a.lon) * frac,
            bearing: bearing(a, b),
            routeId: line,
            type: 'subway',
            approaching: b.name,
            minutes: t[i],
          });
        }
      }
    }
  }

  // If NTAS was entirely unreachable, say so instead of silently reporting an
  // empty (but "successful") system.
  if (reachable === 0) {
    return NextResponse.json({ error: 'NTAS unreachable' }, { status: 502 });
  }

  return NextResponse.json(
    { count: trains.length, platformsReachable: reachable, trains },
    { headers: EDGE_CACHE },
  );
}
