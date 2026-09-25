// Shrink the raw Toronto cycling-counter export into just what the bike-counters
// page needs.
//
// Input:  data/cycling-counts.csv — the full City export (8 columns, one row
//         per counter-direction-day), plus data/cycling-counts-locations.csv
//         for where each counter physically sits.
// Output: public/cycling-counts.json — daily volumes grouped by counter, with
//         the two directions summed per day (exactly what processCounterData
//         does at runtime), the five unused columns dropped, and a lat/lon
//         attached so the counter map can place it.
//
// The page keys everything off location_name, so that string is preserved
// verbatim. Regenerate with `npm run build:cycling` when a new export lands.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const INPUT = path.join(root, 'data', 'cycling-counts.csv');
const LOCATIONS = path.join(root, 'data', 'cycling-counts-locations.csv');
const TMC = path.join(root, 'public', 'tmc-counts.json');
const OUTPUT = path.join(root, 'public', 'cycling-counts.json');

const csv = fs.readFileSync(INPUT, 'utf8');
const { data, errors } = Papa.parse(csv, { header: true, skipEmptyLines: true });
if (errors.length) console.warn(`${errors.length} parse warning(s); first:`, errors[0]);

// location_name -> Map(date -> summed volume)
const byLocation = new Map();
// location_name -> the columns the coordinate lookup below needs: the
// direction ids that join to the locations export, and the street names it
// falls back to when that export has not caught up with a new counter.
const siteInfo = new Map();
let usedRows = 0;
for (const row of data) {
  const location = row.location_name;
  const date = row.dt;
  const volume = parseInt(row.daily_volume, 10);
  if (!location || !date || !Number.isFinite(volume)) continue; // matches page's filter
  usedRows++;
  let dates = byLocation.get(location);
  if (!dates) {
    dates = new Map();
    byLocation.set(location, dates);
    siteInfo.set(location, { dirIds: new Set(), main: row.linear_name_full, side: row.side_street });
  }
  siteInfo.get(location).dirIds.add(row.location_dir_id);
  dates.set(date, (dates.get(date) ?? 0) + volume);
}

const coords = resolveCoordinates(siteInfo);

const counters = [...byLocation.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([location, dateMap]) => {
    const dates = [...dateMap.keys()].sort(); // ISO dates sort lexicographically
    return {
      location,
      ...(coords.get(location) ?? {}), // lat/lon, omitted entirely when unknown
      dates,
      volumes: dates.map((d) => dateMap.get(d)),
    };
  });

const out = {
  source: 'City of Toronto cycling volumes (permanent counters)',
  generated: new Date().toISOString().slice(0, 10),
  counters,
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(out));

const inKB = (fs.statSync(INPUT).size / 1024).toFixed(0);
const outKB = (fs.statSync(OUTPUT).size / 1024).toFixed(0);
const points = counters.reduce((s, c) => s + c.dates.length, 0);
const unplaced = counters.filter((c) => c.lat === undefined);
console.log(`Read ${data.length.toLocaleString()} rows (${usedRows.toLocaleString()} used).`);
console.log(`${counters.length} counters, ${points.toLocaleString()} counter-days.`);
console.log(`${counters.length - unplaced.length} counters placed on the map.`);
if (unplaced.length) {
  console.warn(`No coordinates for ${unplaced.length}: ${unplaced.map((c) => c.location).join('; ')}`);
}
console.log(`${INPUT.split('/').pop()} ${inKB} KB  ->  ${OUTPUT.split('/').pop()} ${outKB} KB`);

// Where each counter sits. The City publishes this in a separate locations
// export, joined on location_dir_id — but that export lags the counts one, so
// the newest counters are missing from it entirely. Those fall back to the
// intersection geometry in public/tmc-counts.json (see scripts/build-tmc.mjs),
// matched on the cross streets the counts export already names. Anything still
// unresolved is left without coordinates and simply omitted from the map.
function resolveCoordinates(siteInfo) {
  const out = new Map();

  const locRows = Papa.parse(fs.readFileSync(LOCATIONS, 'utf8'), {
    header: true,
    skipEmptyLines: true,
  }).data;
  const locByDirId = new Map(locRows.map((r) => [r.location_dir_id, r]));

  for (const [location, info] of siteInfo) {
    const rows = [...info.dirIds].map((id) => locByDirId.get(id)).filter(Boolean);
    const points = rows
      .map((r) => [Number(r.latitude), Number(r.longitude)])
      .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
    if (!points.length) continue;
    // A counter's two directions are logged a few metres apart; the midpoint
    // is the counter.
    out.set(location, {
      lat: round5(points.reduce((s, p) => s + p[0], 0) / points.length),
      lon: round5(points.reduce((s, p) => s + p[1], 0) / points.length),
    });
  }

  const missing = [...siteInfo.keys()].filter((l) => !out.has(l));
  if (missing.length === 0) return out;

  if (!fs.existsSync(TMC)) {
    console.warn(`${missing.length} counter(s) not in the locations export and no ${path.basename(TMC)} to fall back on; run build:tmc first.`);
    return out;
  }
  const intersections = JSON.parse(fs.readFileSync(TMC, 'utf8')).intersections.map((i) => ({
    ...i,
    // "Chesswood Dr / Vanley Cres (South)" -> ['chesswood dr', 'vanley cres south']
    parts: i.name.split('/').map(normStreet),
  }));

  for (const location of missing) {
    const { main, side } = siteInfo.get(location);
    // The cross street, from whichever of the two spellings is more specific.
    // side_street holds one name; location_name's suffix can hold the pair a
    // counter is named for — "north of Pape Ave/Donlands Ave" — and naming
    // both is what makes that junction findable.
    const fromName = location.replace(/\s*\([^)]*\)\s*$/, '').split(/,\s*\w+ of\s+/)[1];
    const sides = [fromName, side]
      .map((v) => String(v ?? '').split('/').map(normStreet).filter(Boolean))
      .sort((a, b) => b.length - a.length)[0];
    if (!sides.length) continue;

    const has = (candidate, street) =>
      candidate.parts.some((p) => p === street || p.startsWith(`${street} `));

    // Both the road the counter is on and its cross street, which is the
    // unambiguous case. Failing that the cross streets alone, but only when
    // they pin down exactly one intersection: that covers counters named for a
    // junction the road itself is not part of (Millwood Rd at Pape/Donlands).
    const mainStreet = normStreet(main);
    let hits = intersections.filter(
      (c) => has(c, mainStreet) && sides.every((s) => has(c, s))
    );
    if (hits.length === 0) hits = intersections.filter((c) => sides.every((s) => has(c, s)));
    if (hits.length !== 1) continue;

    out.set(location, { lat: hits[0].lat, lon: hits[0].lon });
    console.log(`  placed "${location}" from TMC intersection "${hits[0].name}"`);
  }

  return out;
}

function normStreet(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function round5(n) {
  return Number(n.toFixed(5));
}
