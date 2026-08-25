// Build the compact dataset the /toronto-travel page consumes, from the raw
// TTS iDRS cross-tab exports (survey years 2001, 2006, 2011, 2016, 2022):
//
//   data/tts_crosstabs_travel_ward_length.txt  — ALL trips, by trip length.
//   data/mode-share-commute.txt                — COMMUTE trips (home-based work
//       or school, trip_purp 1|2), by trip length.
//   data/work_distance.txt                     — WORK trips (trip_purp 1), by
//       trip length.
//   data/school_distance.txt                   — SCHOOL trips (trip_purp 2), by
//       trip length.
//   data/school_age.txt                        — SCHOOL trips by age of person.
//   data/tts_work.txt, data/tts_school.txt     — the same work / school totals
//       with no third dimension; parsed only to check the splits above.
//
// A cross-tab has three slots (row, column, table) and mode × ward already
// takes two, so age and trip length can never appear in the same export. That
// is the one shape the data can't have, and it drives the UI: the school age
// bands are a dataset of their own, and selecting one drops the distance
// filter.
//
// Everything folds to data[year][ward][bucket][modeCode], where the bucket
// level is distance bands (lt1 … 20plus) for every dataset except schoolAge,
// which holds age groups (elementary / high / post / unknown). The UI's 'all'
// selector sums every bucket either way, so the same helpers read them all.
//
// Formats vary by export: some are long (one row per ward × mode), some wide
// CSV with modes down the side, some wide with wards down the side. Three
// parsers below, one per shape.
//
// Wards are projected onto the current 25-ward model — 2001–2016 counts are
// apportioned from the former 44-ward model by the area-weighted crosswalk in
// scripts/ward44to25.json (2022 already uses 25 wards).
//
// Output: public/tts/mode-share.json = { meta, datasets }.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const OUTPUT = path.join(root, 'public', 'tts', 'mode-share.json');
const CROSSWALK = path.join(__dirname, 'ward44to25.json');
const ALL_TXT = path.join(root, 'data', 'tts_crosstabs_travel_ward_length.txt');
const COMMUTE_TXT = path.join(root, 'data', 'mode-share-commute.txt');
const WORK_TXT = path.join(root, 'data', 'work_distance.txt');
const SCHOOL_TXT = path.join(root, 'data', 'school_distance.txt');
const SCHOOL_AGE_TXT = path.join(root, 'data', 'school_age.txt');
const WORK_TOTAL_TXT = path.join(root, 'data', 'tts_work.txt');
const SCHOOL_TOTAL_TXT = path.join(root, 'data', 'tts_school.txt');

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

// School-trip age bands, by the age the grade normally maps to in Ontario:
// kindergarten–grade 8 ends at 13, grades 9–12 run 14–17, 18+ is
// college/university and adult education. The export is single years of age,
// so these cutoffs are the only thing to change if you want them elsewhere.
const AGE_GROUPS = [
  { id: 'elementary', label: 'Elementary (Gr. 8 & under)', short: 'Elementary', maxAge: 13 },
  { id: 'high', label: 'High school', short: 'High school', minAge: 14, maxAge: 17 },
  { id: 'post', label: 'College / university +', short: 'College +', minAge: 18 },
];
function ageGroupFor(age) {
  for (const g of AGE_GROUPS) {
    if (age >= (g.minAge ?? 0) && age <= (g.maxAge ?? Infinity)) return g.id;
  }
  return 'unknown';
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

// Full labels as they appear in the wide exports -> mode code.
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

// ---- Parser 1: long format, one row per ward × mode, trip_m in metres ----
// The all-trips export lists mode first, the purpose-split exports list ward
// first; `order` picks the column layout.
function parseLong(file, order) {
  const data = {};
  const add = makeAdder(data);
  const YEAR_RE = /^Trip (\d{4})\s*$/;
  const TABLE_RE = /^TABLE\s*:\s*trip_m \(([^)]*)\)/;
  const wardFirst = order === 'ward-mode';
  const ROW_RE = wardFirst
    ? /^\s*(\d+)\s+([A-Z])\s+(\d+)\s*$/
    : /^\s*([A-Z])\s+(\d+)\s+(\d+)\s*$/;
  let year = null;
  let bucket = null;
  let rows = 0;
  let skipped = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    let m;
    if ((m = line.match(YEAR_RE))) { year = +m[1]; bucket = null; continue; }
    // A trip_m of "Unknown" has no distance to bin, so its block is dropped
    // rather than left to fall into the previous block's bucket.
    if ((m = line.match(TABLE_RE))) {
      bucket = /^\d+$/.test(m[1]) ? bucketForKm(+m[1] / 1000) : null;
      continue;
    }
    if (year && (m = line.match(ROW_RE))) {
      const mode = wardFirst ? m[2] : m[1];
      const ward = wardFirst ? +m[1] : +m[2];
      if (!MODES[mode]) continue;
      if (!bucket) { skipped += +m[3]; continue; }
      rows++;
      place(add, year, ward, bucket, mode, +m[3]);
    }
  }
  return { data, rows, skipped };
}

// ---- Parser 2: wide CSV exports (mode labels down the side, wards across) ----
// `bucketFor` turns a block's "Table: <token>" value into a bucket id, or null
// to drop the block. The token is '' where the export has no table dimension.
function parseWide(file, bucketFor) {
  const data = {};
  const add = makeAdder(data);
  const TABLE_RE = /^Table:\s*(\d*|Unknown)\s*$/;
  let year = null;
  let bucket = null;
  let wardHeader = null;
  let rows = 0;
  let skipped = 0;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.replace(/\r$/, '');
    let m;
    if ((m = line.match(/^Trip (\d{4})\s*$/))) { year = +m[1]; bucket = null; continue; }
    if ((m = line.match(TABLE_RE))) { bucket = bucketFor(m[1]); continue; }
    if (line.startsWith(',')) {
      wardHeader = line.slice(1).split(',').map((s) => parseInt(s, 10));
      continue;
    }
    if (!year || !wardHeader) continue;
    const comma = line.indexOf(',');
    if (comma < 1) continue;
    const label = line.slice(0, comma);
    const code = LABEL_TO_CODE[label];
    if (!code) continue;
    const counts = line.slice(comma + 1).split(',');
    if (!bucket) {
      for (const c of counts) skipped += parseInt(c, 10) || 0;
      continue;
    }
    rows++;
    for (let i = 0; i < wardHeader.length; i++) {
      const ward = wardHeader[i];
      const count = parseInt(counts[i], 10);
      if (!ward || !count) continue;
      place(add, year, ward, bucket, code, count);
    }
  }
  return { data, rows, skipped };
}

// ---- Parser 3: wide CSV, transposed (wards down the side, modes across) ----
// Same blocks as parseWide, but the header row carries the mode labels and each
// data row starts with a ward number.
function parseWideT(file, bucketFor) {
  const data = {};
  const add = makeAdder(data);
  const TABLE_RE = /^Table:\s*(\d*|Unknown)\s*$/;
  let year = null;
  let bucket = null;
  let codes = null;
  let rows = 0;
  let skipped = 0;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.replace(/\r$/, '');
    let m;
    if ((m = line.match(/^Trip (\d{4})\s*$/))) { year = +m[1]; bucket = null; continue; }
    if ((m = line.match(TABLE_RE))) { bucket = bucketFor(m[1]); continue; }
    if (line.startsWith(',')) {
      codes = line.slice(1).split(',').map((label) => LABEL_TO_CODE[label] ?? null);
      continue;
    }
    if (!year || !codes) continue;
    const comma = line.indexOf(',');
    if (comma < 1) continue;
    const head = line.slice(0, comma);
    if (!/^\d+$/.test(head)) continue; // preamble lines that happen to hold commas
    const counts = line.slice(comma + 1).split(',');
    if (!bucket) {
      for (const c of counts) skipped += parseInt(c, 10) || 0;
      continue;
    }
    rows++;
    for (let i = 0; i < codes.length; i++) {
      const count = parseInt(counts[i], 10);
      if (!codes[i] || !count) continue;
      place(add, year, +head, bucket, codes[i], count);
    }
  }
  return { data, rows, skipped };
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

function totalOf(data) {
  let t = 0;
  for (const y of Object.values(data))
    for (const w of Object.values(y))
      for (const b of Object.values(w)) for (const n of Object.values(b)) t += n;
  return t;
}

// Youngest person the survey recorded a trip for, per year: 2001–2016 only
// covered ages 11+, while 2022 goes down to 5. The elementary band is
// therefore not comparable across that break, so the UI footnotes it.
function minAgeByYear(file) {
  const out = {};
  let year = null;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.replace(/\r$/, '');
    let m;
    if ((m = line.match(/^Trip (\d{4})\s*$/))) { year = +m[1]; continue; }
    if (year && (m = line.match(/^Table:\s*(\d+)\s*$/))) {
      const age = +m[1];
      if (out[year] === undefined || age < out[year]) out[year] = age;
    }
  }
  return out;
}

const all = parseLong(ALL_TXT, 'mode-ward');
const commute = parseWide(COMMUTE_TXT, (t) => (/^\d+$/.test(t) ? bucketForKm(+t) : null));
const work = parseLong(WORK_TXT, 'ward-mode');
const school = parseLong(SCHOOL_TXT, 'ward-mode');
// Age takes the third slot instead of trip length, so school-by-age is its own
// dataset rather than another bucketing of `school`.
const schoolAge = parseWideT(SCHOOL_AGE_TXT, (t) =>
  /^\d+$/.test(t) ? ageGroupFor(+t) : 'unknown'
);
// No third dimension at all: parsed only to check the totals above.
const workTotal = parseWide(WORK_TOTAL_TXT, () => 'na');
const schoolTotal = parseWide(SCHOOL_TOTAL_TXT, () => 'na');

const datasets = {
  all: all.data,
  commute: commute.data,
  work: work.data,
  school: school.data,
  schoolAge: schoolAge.data,
};
for (const d of Object.values(datasets)) roundTrim(d);

const years = Object.keys(all.data).map(Number).sort((a, b) => a - b);
const out = {
  meta: {
    source: 'Transportation Tomorrow Survey (Data Management Group, University of Toronto)',
    generated: new Date().toISOString().slice(0, 10),
    years,
    modes: MODES,
    modeOrder: ['D', 'P', 'B', 'G', 'J', 'W', 'C', 'E', 'M', 'S', 'T', 'U', 'O'],
    buckets: BUCKETS.map(({ id, label }) => ({ id, label })),
    ageGroups: AGE_GROUPS.map(({ id, label, short, minAge, maxAge }) => ({
      id,
      label,
      short,
      minAge: minAge ?? null,
      maxAge: maxAge ?? null,
    })),
    // Which filters each trip set can offer. Everything has distance; school
    // also has age, in a dataset of its own (`ageDataset`) that carries no
    // distance — so the UI disables the distance filter while an age band is
    // selected.
    tripSets: [
      { id: 'all', label: 'All trips', noun: 'All trips', filters: ['distance'] },
      {
        id: 'commute',
        label: 'Commute (work + school)',
        noun: 'Work & school trips',
        filters: ['distance'],
      },
      { id: 'work', label: 'Work only', noun: 'Work trips', filters: ['distance'] },
      {
        id: 'school',
        label: 'School only',
        noun: 'School trips',
        filters: ['distance', 'age'],
        ageDataset: 'schoolAge',
      },
    ],
    minAgeSurveyed: minAgeByYear(SCHOOL_AGE_TXT),
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
      'Trips by primary mode, household ward and straight-line trip length, ' +
      'plus school trips by age of person (a separate cross-tab, with no trip ' +
      'length). Wards use the current 25-ward model; 2001–2016 counts are ' +
      'apportioned from the former 44-ward model by area-weighted crosswalk. ' +
      '"Commute" = home-based work or school trips; work and school are the ' +
      'same trips split by purpose.',
  },
  datasets,
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(out));

for (const [name, r] of Object.entries({ all, commute, work, school, schoolAge })) {
  console.log(
    `${name.padEnd(10)} ${r.rows.toLocaleString().padStart(9)} rows, ` +
      `${Math.round(totalOf(datasets[name])).toLocaleString().padStart(10)} trips` +
      (r.skipped ? `  (dropped ${r.skipped.toLocaleString()} of unknown length)` : '')
  );
}
const signed = (n) => `${n >= 0 ? '+' : ''}${Math.round(n).toLocaleString()}`;
console.log('checks (a "dropped" gap above accounts for most of each delta):');
for (const [what, delta] of [
  ['work + school vs commute      ', totalOf(work.data) + totalOf(school.data) - totalOf(commute.data)],
  ['work vs tts_work.txt          ', totalOf(work.data) - totalOf(workTotal.data)],
  ['school vs tts_school.txt      ', totalOf(school.data) - totalOf(schoolTotal.data)],
  ['schoolAge vs school           ', totalOf(schoolAge.data) - totalOf(school.data)],
]) {
  console.log(`  ${what} ${signed(delta)}`);
}
console.log(`years ${years.join(', ')}`);
console.log(`Wrote ${OUTPUT} (${(fs.statSync(OUTPUT).size / 1024).toFixed(0)} KB)`);
