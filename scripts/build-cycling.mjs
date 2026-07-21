// Shrink the raw Toronto cycling-counter export into just what the bike-counters
// page needs.
//
// Input:  data/cycling_counts_june_26.csv — the full City export (8 columns,
//         one row per counter-direction-day).
// Output: public/cycling-counts.json — daily volumes grouped by counter, with
//         the two directions summed per day (exactly what processCounterData
//         does at runtime) and the five unused columns dropped.
//
// The page keys everything off location_name, so that string is preserved
// verbatim. Regenerate with `npm run build:cycling` when a new export lands.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const INPUT = path.join(root, 'data', 'cycling_counts_june_26.csv');
const OUTPUT = path.join(root, 'public', 'cycling-counts.json');

const csv = fs.readFileSync(INPUT, 'utf8');
const { data, errors } = Papa.parse(csv, { header: true, skipEmptyLines: true });
if (errors.length) console.warn(`${errors.length} parse warning(s); first:`, errors[0]);

// location_name -> Map(date -> summed volume)
const byLocation = new Map();
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
  }
  dates.set(date, (dates.get(date) ?? 0) + volume);
}

const counters = [...byLocation.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([location, dateMap]) => {
    const dates = [...dateMap.keys()].sort(); // ISO dates sort lexicographically
    return {
      location,
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
console.log(`Read ${data.length.toLocaleString()} rows (${usedRows.toLocaleString()} used).`);
console.log(`${counters.length} counters, ${points.toLocaleString()} counter-days.`);
console.log(`${INPUT.split('/').pop()} ${inKB} KB  ->  ${OUTPUT.split('/').pop()} ${outKB} KB`);
