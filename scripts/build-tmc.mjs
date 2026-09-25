// Shrink the City's raw turning-movement-count exports into just what the
// intersection-counts page needs.
//
// Input:  data/tmc_raw_data_<decade>.csv — the full City export, one row per
//         count per 15-minute bin per intersection, with 44 separate movement
//         columns (approach x turn x vehicle class, plus per-approach ped and
//         bike totals). ~1.07M rows / 262 MB across the five decade files.
// Output: public/tmc-counts.json — one entry per intersection, each carrying
//         its coordinates and every count ever taken there reduced to five
//         mode totals.
//
// Two totals are kept per count, because counts are not all the same length:
// about 88% run 8 hours and the rest run 14, so raw totals are not comparable
// between them. `peak` sums only the 7:30-9:30 and 16:00-18:00 bins, the window
// every single count in the export covers, which is what the page charts.
// `full` keeps the whole count for reference alongside its length in hours.
//
// Regenerate with `npm run build:tmc` when a new export lands.
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const DATA_DIR = path.join(root, 'data');
const OUTPUT = path.join(root, 'public', 'tmc-counts.json');

// The bins every count shares: 07:30-09:29 and 16:00-17:59, as minutes from
// midnight. Verified against the export — all 30,900 counts cover all 16 bins.
const PEAK_WINDOWS = [[7 * 60 + 30, 9 * 60 + 30], [16 * 60, 18 * 60]];
const PEAK_MINUTES = PEAK_WINDOWS.reduce((sum, [a, b]) => sum + (b - a), 0);

// Column groups summed into each mode. Cars, trucks and buses are each split
// across four approaches x three turns; peds and bikes are per-approach only.
const APPROACHES = ['n', 's', 'e', 'w'];
const TURNS = ['r', 't', 'l'];
const MODE_COLUMNS = {
  cars: APPROACHES.flatMap((a) => TURNS.map((t) => `${a}_appr_cars_${t}`)),
  trucks: APPROACHES.flatMap((a) => TURNS.map((t) => `${a}_appr_truck_${t}`)),
  buses: APPROACHES.flatMap((a) => TURNS.map((t) => `${a}_appr_bus_${t}`)),
  peds: APPROACHES.map((a) => `${a}_appr_peds`),
  bikes: APPROACHES.map((a) => `${a}_appr_bike`),
};
const MODES = Object.keys(MODE_COLUMNS);

// Splits one CSV line. Only location_name is ever quoted, but it does contain
// commas ("Bloor St W / Palmerston Blvd"), so the quote state has to be tracked.
function splitCsv(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') cur += c;
      else if (line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const files = fs
  .readdirSync(DATA_DIR)
  .filter((f) => /^tmc_raw_data_\d{4}_\d{4}\.csv$/.test(f))
  .sort();
if (files.length === 0) {
  console.error(`No tmc_raw_data_*.csv files in ${DATA_DIR}`);
  process.exit(1);
}

// count_id -> one accumulating count record.
const counts = new Map();
let rows = 0;
let skipped = 0;

for (const file of files) {
  const rl = readline.createInterface({
    input: fs.createReadStream(path.join(DATA_DIR, file)),
    crlfDelay: Infinity,
  });

  // Resolved once per file from its header rather than assumed by position —
  // the decade files are separate exports and need not agree on column order.
  let col = null;
  let modeIdx = null;

  for await (const line of rl) {
    if (!line) continue;
    if (!col) {
      const header = splitCsv(line);
      col = Object.fromEntries(header.map((h, i) => [h, i]));
      modeIdx = MODES.map((m) => MODE_COLUMNS[m].map((name) => {
        const i = col[name];
        if (i === undefined) throw new Error(`${file}: missing column ${name}`);
        return i;
      }));
      continue;
    }

    const f = splitCsv(line);
    const id = f[col.count_id];
    const date = f[col.count_date];
    const lat = Number(f[col.latitude]);
    const lon = Number(f[col.longitude]);
    if (!id || !date || !Number.isFinite(lat) || !Number.isFinite(lon)) { skipped++; continue; }
    rows++;

    let rec = counts.get(id);
    if (!rec) {
      // centreline_id is the stable intersection key; a handful of rows carry
      // none, so those fall back to their rounded position.
      const centreline = f[col.centreline_id];
      rec = {
        date,
        name: f[col.location_name],
        place: centreline || `@${lat.toFixed(5)},${lon.toFixed(5)}`,
        lat,
        lon,
        bins: 0,
        peakBins: 0,
        full: new Array(MODES.length).fill(0),
        peak: new Array(MODES.length).fill(0),
      };
      counts.set(id, rec);
    }

    const start = f[col.start_time]; // "2023-09-26T06:30:00"
    const minute = Number(start.slice(11, 13)) * 60 + Number(start.slice(14, 16));
    const inPeak = PEAK_WINDOWS.some(([a, b]) => minute >= a && minute < b);
    rec.bins++;
    if (inPeak) rec.peakBins++;

    for (let m = 0; m < modeIdx.length; m++) {
      let sum = 0;
      for (const i of modeIdx[m]) sum += Number(f[i]) || 0;
      rec.full[m] += sum;
      if (inPeak) rec.peak[m] += sum;
    }
  }
  console.log(`read ${file} — ${rows.toLocaleString()} rows so far`);
}

// Group counts into intersections, newest first so the page can read the most
// recent breakdown off the front without sorting, and so the name and position
// below come from the latest count rather than a decades-old one.
const places = new Map();
for (const rec of counts.values()) {
  let place = places.get(rec.place);
  if (!place) {
    place = { id: rec.place, counts: [] };
    places.set(rec.place, place);
  }
  place.counts.push(rec);
}

const partialPeak = [];
const intersections = [...places.values()].map((place) => {
  place.counts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const latest = place.counts[0];
  for (const c of place.counts) {
    if (c.peakBins !== PEAK_MINUTES / 15) partialPeak.push(`${c.date} ${c.name}`);
  }
  return {
    id: place.id,
    name: latest.name,
    lat: Number(latest.lat.toFixed(5)),
    lon: Number(latest.lon.toFixed(5)),
    // [date, hours, ...peak totals, ...full totals] — positional to keep the
    // file small; `modes` in the header names the five totals in each half.
    counts: place.counts.map((c) => [
      c.date,
      Math.round((c.bins / 4) * 10) / 10,
      ...c.peak,
      ...c.full,
    ]),
  };
});

// Busiest first: the map draws in this order, so the biggest intersections end
// up on top of their neighbours rather than buried under them.
intersections.sort((a, b) => {
  const total = (i) => i.counts[0].slice(2, 2 + MODES.length).reduce((s, v) => s + v, 0);
  return total(b) - total(a);
});

const out = {
  source: 'City of Toronto turning movement counts (TMC)',
  generated: new Date().toISOString().slice(0, 10),
  modes: MODES,
  peakWindow: { label: '7:30–9:30 AM and 4:00–6:00 PM', hours: PEAK_MINUTES / 60 },
  intersections,
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(out));

const size = fs.statSync(OUTPUT).size;
console.log(
  `\n${rows.toLocaleString()} rows (${skipped} skipped) -> ${counts.size.toLocaleString()} counts ` +
  `at ${intersections.length.toLocaleString()} intersections`
);
if (partialPeak.length) {
  console.warn(`${partialPeak.length} count(s) do not cover the full peak window, e.g. ${partialPeak[0]}`);
}
console.log(`wrote ${path.relative(root, OUTPUT)} (${(size / 1e6).toFixed(1)} MB)`);
