// Build the compact dataset the /toronto-travel page consumes, from two raw
// TTS iDRS cross-tab exports (survey years 2001, 2006, 2011, 2016, 2022):
//
//   data/tts_crosstabs_travel_ward_length.txt  — ALL trips. Long format,
//       trip length in metres, modes as single-letter codes.
//   data/mode-share-commute.txt                — COMMUTE trips (home-based work
//       or school, trip_purp 1|2). Wide CSV, trip length in km, modes as labels.
//
// Both are folded to the same shape: data[year][ward][bucket][modeCode], with
//   1. trip length binned into distance buckets, and
//   2. wards projected onto the current 25-ward model — 2001–2016 counts are
//      apportioned from the former 44-ward model by the area-weighted crosswalk
//      in scripts/ward44to25.json (2022 already uses 25 wards).
//
// Output: public/tts/mode-share.json = { meta, datasets: { all, commute } }.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const OUTPUT = path.join(root, 'public', 'tts', 'mode-share.json');
const CROSSWALK = path.join(__dirname, 'ward44to25.json');
const ALL_TXT = path.join(root, 'data', 'tts_crosstabs_travel_ward_length.txt');
const COMMUTE_TXT = path.join(root, 'data', 'mode-share-commute.txt');

const BUCKETS = [
  { id: 'lt1', label: '< 1 km', minKm: 0, maxKm: 1 },
  { id: '1to2', label: '1–2 km', minKm: 1, maxKm: 2 },
  { id: '2to5', label: '2–5 km', minKm: 2, maxKm: 5 },
  { id: '5to10', label: '5–10 km', minKm: 5, maxKm: 10 },
  { id: '10to20', label: '10–20 km', minKm: 10, maxKm: 20 },
  { id: '20plus', label: '20 km+', minKm: 20, maxKm: Infinity },
];
function bucketForKm(km) {
  for (const b of BUCKETS) if (km >= b.minKm && km < b.maxKm) return b.id;
  return '20plus';
}

// Primary-mode codes, verbatim from the 2022 TTS Data Guide (Nov 2024).
const MODES = {
  D: 'Auto driver',
  P: 'Auto passenger',
  B: 'Public transit',
  G: 'GO Rail',
  J: 'GO Rail + transit',
  W: 'Walk',
  C: 'Bicycle',
  E: 'E-scooter / e-mobility',
  M: 'Motorcycle',
  S: 'School bus',
  T: 'Taxi',
  U: 'Paid rideshare',
  O: 'Other',
};

// Full labels as they appear in the commute (wide) export -> mode code.
const LABEL_TO_CODE = {
  'Auto driver': 'D',
  'Auto passenger': 'P',
  'Transit excluding GO rail': 'B',
  'GO rail only': 'G',
  'Joint GO rail and local transit': 'J',
  Walk: 'W',
  Cycle: 'C',
  'E-scooter': 'E',
  Motorcycle: 'M',
  'School bus': 'S',
  'Taxi passenger': 'T',
  'Paid rideshare': 'U',
  Other: 'O',
  Unknown: 'O',
};

const { newNames, crosswalk } = JSON.parse(fs.readFileSync(CROSSWALK, 'utf8'));

function makeAdder(data) {
  return function add(year, ward, bucket, mode, n) {
    const y = (data[year] ??= {});
    const w = (y[ward] ??= {});
    const b = (w[bucket] ??= {});
    b[mode] = (b[mode] ?? 0) + n;
  };
}

// Apportion a raw (year, ward, bucket, mode, count) onto the 25-ward model.
function place(add, year, rawWard, bucket, mode, count) {
  if (year === 2022) {
    add(year, rawWard, bucket, mode, count);
  } else {
    const shares = crosswalk[rawWard];
    if (!shares) return;
    for (const [newWard, frac] of Object.entries(shares)) {
      add(year, +newWard, bucket, mode, count * frac);
    }
  }
}

// ---- Parser 1: ALL trips (long format, metres, letter codes) ----
function parseAll() {
  const data = {};
  const add = makeAdder(data);
  const YEAR_RE = /^Trip (\d{4})\s*$/;
  const TABLE_RE = /^TABLE\s*:\s*trip_m \((\d+)\)/;
  const ROW_RE = /^\s*([A-Z])\s+(\d+)\s+(\d+)\s*$/;
  let year = null;
  let bucket = null;
  let rows = 0;
  for (const line of fs.readFileSync(ALL_TXT, 'utf8').split('\n')) {
    let m;
    if ((m = line.match(YEAR_RE))) { year = +m[1]; continue; }
    if ((m = line.match(TABLE_RE))) { bucket = bucketForKm(+m[1] / 1000); continue; }
    if (year && bucket && (m = line.match(ROW_RE))) {
      const mode = m[1];
      if (!MODES[mode]) continue;
      rows++;
      place(add, year, +m[2], bucket, mode, +m[3]);
    }
  }
  return { data, rows };
}

// ---- Parser 2: COMMUTE trips (wide CSV, km, labels) ----
function parseCommute() {
  const data = {};
  const add = makeAdder(data);
  let year = null;
  let bucket = null;
  let wardHeader = null;
  let rows = 0;
  for (const raw of fs.readFileSync(COMMUTE_TXT, 'utf8').split('\n')) {
    const line = raw.replace(/\r$/, '');
    let m;
    if ((m = line.match(/^Trip (\d{4})\s*$/))) { year = +m[1]; continue; }
    if ((m = line.match(/^Table:\s*(\d+)\s*$/))) { bucket = bucketForKm(+m[1]); continue; }
    if (line.startsWith(',')) {
      wardHeader = line.slice(1).split(',').map((s) => parseInt(s, 10));
      continue;
    }
    if (!year || !bucket || !wardHeader) continue;
    const comma = line.indexOf(',');
    if (comma < 1) continue;
    const label = line.slice(0, comma);
    const code = LABEL_TO_CODE[label];
    if (!code) continue;
    const counts = line.slice(comma + 1).split(',');
    rows++;
    for (let i = 0; i < wardHeader.length; i++) {
      const ward = wardHeader[i];
      const count = parseInt(counts[i], 10);
      if (!ward || !count) continue;
      place(add, year, ward, bucket, code, count);
    }
  }
  return { data, rows };
}

function roundTrim(data) {
  for (const y of Object.values(data)) {
    for (const w of Object.values(y)) {
      for (const bKey of Object.keys(w)) {
        const b = w[bKey];
        for (const mk of Object.keys(b)) {
          b[mk] = Math.round(b[mk]);
          if (b[mk] === 0) delete b[mk];
        }
        if (Object.keys(b).length === 0) delete w[bKey];
      }
    }
  }
  return data;
}

const all = parseAll();
const commute = parseCommute();
roundTrim(all.data);
roundTrim(commute.data);

const years = Object.keys(all.data).map(Number).sort((a, b) => a - b);
const out = {
  meta: {
    source: 'Transportation Tomorrow Survey (Data Management Group, University of Toronto)',
    generated: new Date().toISOString().slice(0, 10),
    years,
    modes: MODES,
    modeOrder: ['D', 'P', 'B', 'G', 'J', 'W', 'C', 'E', 'M', 'S', 'T', 'U', 'O'],
    buckets: BUCKETS.map(({ id, label }) => ({ id, label })),
    wardNames: newNames,
    target: {
      // TransformTO: 75% of trips to work or school by walking, cycling or
      // transit by 2030. Sustainable = walk + cycle + transit mode groups.
      name: 'TransformTO',
      share: 0.75,
      year: 2030,
      sustainableGroups: ['transit', 'walk', 'cycle'],
      appliesTo: 'commute',
    },
    note:
      'Trips by primary mode, household ward, and straight-line trip length. ' +
      'Wards use the current 25-ward model; 2001–2016 counts are apportioned ' +
      'from the former 44-ward model by area-weighted crosswalk. "Commute" = ' +
      'home-based work or school trips.',
  },
  datasets: { all: all.data, commute: commute.data },
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(out));
console.log(`all: parsed ${all.rows.toLocaleString()} rows; commute: parsed ${commute.rows.toLocaleString()} rows`);
console.log(`years ${years.join(', ')}`);
console.log(`Wrote ${OUTPUT} (${(fs.statSync(OUTPUT).size / 1024).toFixed(0)} KB)`);
