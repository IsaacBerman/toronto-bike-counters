// Bike Share Toronto, cut by city ward.
//
// The body of this comes from one static file, /bikeshare-wards.json, built
// from the City's trip-level ridership archives by build_bikeshare_wards.py in
// the dash.raccoon.bike repo: monthly per ward, columnar — one array per ward
// per series, aligned to `months`.
//
// The archive used to be the whole story here and it is still the authority.
// bikeraccoon, which infers trips by polling the public feed, is missing 47
// whole days of 2025 (chunks of August, September, October and December), and
// plotting those absences as zeroes read on the page as a 20% collapse in
// ridership that never happened.
//
// But the City publishes in arrears, so the archive stops months behind. The
// tail past its cutoff is filled from bikeraccoon after all — as an explicit
// estimate, every such month flagged `estimated`, never silently blended. Where
// both sources exist the estimate has run ~3% under the City's count, so the
// two are close but not interchangeable.
//
// Read DATA_NOTES before adding a chart: several things neither source can say
// are listed there.

import { area as turfArea, centroid as turfCentroid } from '@turf/turf';

// Old City Hall, Queen & Bay — the fixed reference the "distance from downtown"
// axis is measured against, so the downtown/suburb gradient rests on a named
// landmark rather than on a boundary we drew ourselves.
export const DOWNTOWN = { lat: 43.6534, lon: -79.3841, label: 'Queen & Bay' };

// Toronto's wards are numbered 1..25 with no gaps, which is what lets a ward
// read out of the URL be validated before the data has finished loading.
export const WARD_COUNT = 25;

const KM_PER_DEG_LAT = 110.574;
const kmPerDegLon = (lat) => 111.32 * Math.cos((lat * Math.PI) / 180);

// Planar distance in metres. Across one city the error against a great-circle
// distance sits far below the precision anything here is reported at, and the
// spacing pass runs this a million times.
export function metresBetween(a, b) {
  const kx = kmPerDegLon(43.7);
  return Math.hypot((a.lon - b.lon) * kx, (a.lat - b.lat) * KM_PER_DEG_LAT) * 1000;
}

export async function fetchWardData() {
  const res = await fetch('/bikeshare-wards.json');
  if (!res.ok) throw new Error('Could not load /bikeshare-wards.json');
  return res.json();
}

// --------------------------------------------------------------------------
// The tail the City hasn't published yet
// --------------------------------------------------------------------------

const RACCOON_KEY = 'YIOJaaLtLdazfrG7GVwcyAybB2WfpmSaxtCUx6gxLBw';

const addMonth = (m, n) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const lastDayOf = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
};

// The last month that has actually finished, in Toronto. The current month is
// still accruing, and a part-month plotted beside full ones reads as a crash.
function lastCompleteMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year').value;
  const mo = parts.find((p) => p.type === 'month').value;
  return addMonth(`${y}-${mo}`, -1);
}

/**
 * Months after the archive's cutoff, filled from bikeraccoon.
 *
 * The City publishes its ridership archive in arrears, so the most recent
 * months have no authoritative count. Those come from bikeraccoon instead,
 * which infers trips by polling the public feed — a genuine estimate, and one
 * that has run about 3% under the City's own count in the years where both
 * exist. Every row this returns is flagged `estimated` so the page can say so.
 *
 * One request per month: `frequency=y` collapses whatever range it is given
 * into a single row per station, and the same range asked for daily is ~3.7 MB
 * a month rather than ~170 KB.
 *
 * A failure here is not fatal — the archive still renders on its own.
 */
export async function fetchLiveMonths(cutoff) {
  const through = lastCompleteMonth();
  const wanted = [];
  for (let m = addMonth(cutoff, 1); m <= through; m = addMonth(m, 1)) wanted.push(m);
  if (!wanted.length) return [];

  const one = async (month) => {
    const stamp = month.replace('-', '');
    const url =
      `https://api.raccoon.bike/activity?system=bike_share_toronto&feed=station&station=all` +
      `&start=${stamp}0100&end=${stamp}${String(lastDayOf(month)).padStart(2, '0')}23` +
      `&frequency=y&key=${RACCOON_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`bikeraccoon ${res.status} for ${month}`);
    const json = await res.json();
    return { month, rows: json.data ?? [] };
  };

  const settled = await Promise.allSettled(wanted.map(one));
  return settled.filter((s) => s.status === 'fulfilled' && s.value.rows.length).map((s) => s.value);
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Rank 1 = highest value, or lowest when asc. Ties share the better rank.
function rankBy(rows, key, { asc = false } = {}) {
  const ordered = rows
    .filter((r) => r[key] != null)
    .sort((a, b) => (asc ? a[key] - b[key] : b[key] - a[key]));
  const ranks = new Map();
  ordered.forEach((r, i) => {
    if (i && ordered[i - 1][key] === r[key]) ranks.set(r.ward, ranks.get(ordered[i - 1].ward));
    else ranks.set(r.ward, i + 1);
  });
  return ranks;
}

// Sum a columnar series over the month indices given, treating null (a month
// the archive records no value for, such as the withheld member/casual window)
// as absent rather than zero — so a suppressed span breaks the line instead of
// plotting a false floor.
function sumOver(series, indices) {
  let total = 0;
  let seen = false;
  for (const i of indices) {
    const v = series?.[i];
    if (v == null) continue;
    total += v;
    seen = true;
  }
  return seen ? total : null;
}

/**
 * Fold the ward file and the ward geometry into one profile per ward.
 *
 * Spacing is each station's distance to its nearest neighbour *anywhere in the
 * network*, summarised by the ward the station stands in. A dock one block from
 * another across the ward line is well served; measuring only within the ward
 * would score it as isolated.
 */
export function buildWardProfiles({ data, geo, live = [] }) {
  // The archive's own months, then whatever bikeraccoon could add past the
  // cutoff. Live months are folded into the same columnar arrays so every
  // consumer below stays indifferent to where a month came from; `estimated`
  // is what tells them apart.
  const rosterWard = new Map(data.roster.map((s) => [String(s.id), s.w]));
  const liveMonths = live.map((l) => l.month).filter((m) => m > data.cutoff);
  const liveByMonth = new Map(
    live.map(({ month, rows }) => {
      const trips = new Map();
      const docks = new Map();
      let placedTrips = 0;
      let allTrips = 0;
      for (const r of rows) {
        const n = r.trips ?? 0;
        allTrips += n;
        const w = rosterWard.get(String(r.station_id));
        if (w == null) continue;
        placedTrips += n;
        trips.set(w, (trips.get(w) ?? 0) + n);
        if (n > 0 || (r.returns ?? 0) > 0) {
          if (!docks.has(w)) docks.set(w, new Set());
          docks.get(w).add(String(r.station_id));
        }
      }
      return [month, { trips, docks, placed: allTrips ? placedTrips / allTrips : 1 }];
    })
  );

  const months = [...data.months, ...liveMonths];
  const estimated = new Set(liveMonths);
  // Extend every columnar series to cover the live months. Trips and stations
  // get real values; the splits bikeraccoon cannot report stay null, which is
  // the same shape the pre-2024 months already use.
  const col = (field, fill) => {
    const out = {};
    for (const w of data.wards) {
      const key = String(w);
      out[key] = [
        ...(data[field][key] ?? []),
        ...liveMonths.map((m) => fill(liveByMonth.get(m), w)),
      ];
    }
    return out;
  };
  data = {
    ...data,
    months,
    trips: col('trips', (b, w) => b?.trips.get(w) ?? 0),
    returns: col('returns', () => 0),
    stations: col('stations', (b, w) => b?.docks.get(w)?.size ?? 0),
    member: col('member', () => null),
    casual: col('casual', () => null),
    member_classic: col('member_classic', () => null),
    member_electric: col('member_electric', () => null),
    casual_classic: col('casual_classic', () => null),
    casual_electric: col('casual_electric', () => null),
    placed: [...data.placed, ...liveMonths.map((m) => liveByMonth.get(m)?.placed ?? 1)],
  };

  const years = [...new Set(months.map((m) => Number(m.slice(0, 4))))].sort();
  const currentYear = years[years.length - 1];
  // Which month slots belong to each year, so a yearly view is a sum over the
  // monthly arrays rather than a second copy of the data.
  const slotsByYear = new Map(years.map((y) => [y, []]));
  months.forEach((m, i) => slotsByYear.get(Number(m.slice(0, 4))).push(i));
  // The last year the archive covers in full; the current one stops at cutoff.
  const monthsIn = (y) => slotsByYear.get(y).length;
  const lastFullYear = [...years].reverse().find((y) => monthsIn(y) === 12) ?? years[0];

  const wardMeta = new Map(
    geo.features.map((f) => {
      const [lon, lat] = turfCentroid(f).geometry.coordinates;
      return [
        f.properties.ward,
        {
          name: f.properties.name,
          feature: f,
          areaKm2: turfArea(f) / 1e6,
          centroid: { lat, lon },
        },
      ];
    })
  );

  // The roster carries each dock's ward already (assigned at build time against
  // this same geometry), but positions still drive spacing and density.
  const roster = data.roster.filter((s) => wardMeta.has(s.w));
  const nearest = new Map();
  for (const s of roster) {
    let best = Infinity;
    for (const t of roster) {
      if (t === s) continue;
      const d = metresBetween(s, t);
      if (d < best) best = d;
    }
    if (Number.isFinite(best)) nearest.set(s.id, best);
  }

  const rows = [...wardMeta.entries()].map(([ward, meta]) => {
    const key = String(ward);
    const mine = roster.filter((s) => s.w === ward);
    const spacings = mine.map((s) => nearest.get(s.id)).filter((d) => d != null);

    // A model total is the joint summed over rider types, and it is null — not
    // zero — for every month before 2024, so the chart breaks there rather than
    // drawing a floor of imaginary zeroes.
    const joint = (a, b, i) => {
      const x = data[a][key]?.[i];
      const y = data[b][key]?.[i];
      return x == null && y == null ? null : (x ?? 0) + (y ?? 0);
    };
    const monthly = months.map((m, i) => ({
      month: m,
      trips: data.trips[key]?.[i] ?? 0,
      returns: data.returns[key]?.[i] ?? 0,
      stations: data.stations[key]?.[i] ?? 0,
      member: data.member[key]?.[i] ?? null,
      casual: data.casual[key]?.[i] ?? null,
      classic: joint('member_classic', 'casual_classic', i),
      electric: joint('member_electric', 'casual_electric', i),
      placed: data.placed[i],
      estimated: estimated.has(m),
    }));

    const byYear = years.map((y) => {
      const slots = slotsByYear.get(y);
      return {
        year: y,
        trips: sumOver(data.trips[key], slots) ?? 0,
        returns: sumOver(data.returns[key], slots) ?? 0,
        // A dock is counted once for the year, not once per month it appeared,
        // so this is the peak monthly roster rather than a sum.
        stations: Math.max(0, ...slots.map((i) => data.stations[key]?.[i] ?? 0)),
        member: sumOver(data.member[key], slots),
        casual: sumOver(data.casual[key], slots),
        classic:
          sumOver(data.member_classic[key], slots) == null
            ? null
            : sumOver(data.member_classic[key], slots) + sumOver(data.casual_classic[key], slots),
        electric:
          sumOver(data.member_electric[key], slots) == null
            ? null
            : sumOver(data.member_electric[key], slots) + sumOver(data.casual_electric[key], slots),
        months: slots.length,
        partial: slots.length < 12,
        // How many of the year's months came from the live feed rather than
        // the City's count, so a mixed year can be labelled as one.
        estimatedMonths: slots.filter((i) => estimated.has(months[i])).length,
      };
    });

    const latestFull = byYear.find((r) => r.year === lastFullYear) ?? byYear[byYear.length - 1];
    return {
      ward,
      name: meta.name,
      areaKm2: meta.areaKm2,
      stations: mine.length,
      density: mine.length / meta.areaKm2,
      medianSpacing: median(spacings),
      monthly,
      byYear,
      latestFull,
      tripsPerStation:
        latestFull && latestFull.stations ? latestFull.trips / latestFull.stations : null,
      kmFromDowntown: metresBetween(meta.centroid, DOWNTOWN) / 1000,
    };
  });

  const densityRank = rankBy(rows, 'density');
  const spacingRank = rankBy(rows, 'medianSpacing', { asc: true }); // 1 = tightest
  const tripsRank = rankBy(
    rows.map((r) => ({ ward: r.ward, trips: r.latestFull?.trips ?? 0 })),
    'trips'
  );
  for (const r of rows) {
    r.rank = {
      density: densityRank.get(r.ward),
      spacing: spacingRank.get(r.ward),
      trips: tripsRank.get(r.ward),
      of: rows.length,
    };
  }

  // Summing a series that is null everywhere must stay null, so an all-null
  // month keeps its gap instead of collapsing to a plotted zero.
  const total = (pick) => {
    let sum = 0;
    let seen = false;
    for (const r of rows) {
      const v = pick(r);
      if (v == null) continue;
      sum += v;
      seen = true;
    }
    return seen ? sum : null;
  };

  const cityMonthly = months.map((m, i) => ({
    month: m,
    trips: rows.reduce((a, r) => a + r.monthly[i].trips, 0),
    returns: rows.reduce((a, r) => a + r.monthly[i].returns, 0),
    stations: rows.reduce((a, r) => a + r.monthly[i].stations, 0),
    classic: total((r) => r.monthly[i].classic),
    electric: total((r) => r.monthly[i].electric),
    placed: data.placed[i],
    estimated: estimated.has(m),
  }));

  const cityByYear = years.map((y, k) => ({
    year: y,
    trips: rows.reduce((a, r) => a + r.byYear[k].trips, 0),
    stations: rows.reduce((a, r) => a + r.byYear[k].stations, 0),
    classic: total((r) => r.byYear[k].classic),
    electric: total((r) => r.byYear[k].electric),
    months: slotsByYear.get(y).length,
    partial: slotsByYear.get(y).length < 12,
    estimatedMonths: slotsByYear.get(y).filter((i) => estimated.has(months[i])).length,
    // Weighted by the month's own volume, so a thin January doesn't pull the
    // year's placement rate around as much as a busy July.
    placed:
      slotsByYear.get(y).reduce((a, i) => a + cityMonthly[i].trips * (data.placed[i] ?? 1), 0) /
      Math.max(1, slotsByYear.get(y).reduce((a, i) => a + cityMonthly[i].trips, 0)),
  }));

  return {
    months,
    years,
    currentYear,
    lastFullYear,
    // Where the archive stops and the live estimate takes over.
    cutoff: data.cutoff,
    archiveCutoff: data.cutoff,
    estimatedMonths: liveMonths,
    generated: data.generated,
    wards: rows,
    byWard: new Map(rows.map((r) => [r.ward, r])),
    city: {
      stations: roster.length,
      areaKm2: [...wardMeta.values()].reduce((a, w) => a + w.areaKm2, 0),
      medianSpacing: median([...nearest.values()]),
      monthly: cityMonthly,
      byYear: cityByYear,
    },
  };
}

export const DATA_NOTES = [
  'Counted from the City of Toronto’s trip-level ridership archives, one row per trip. Months past the archive’s cutoff are estimated from bikeraccoon’s polling of the live feed instead, and marked as estimates wherever they appear.',
  'A ward’s count is trips starting at docks inside it. Returns are trips ending there; neither says where the rider lives.',
  'Docks are placed by their position in Bike Share Toronto’s station feed, snapshotted at each build and accumulated, so a dock retired since its last snapshot keeps the position recorded for it. Trips at docks never snapshotted cannot be placed — the share lost is shown per month.',
  'Classic and e-bike appear only from 2024, when the archive first records a bike model.',
  'The member/casual split is withheld from October 2021 to December 2023: the City’s “Annual Member” label decays out of use over that span and is absent altogether by September 2023.',
];
