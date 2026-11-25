// Pull the City's KSI collision dataset and shrink it to what the Vision Zero
// page needs.
//
// Input:  "Motor Vehicle Collisions Involving Killed or Seriously Injured
//         Persons" on the City's CKAN portal (published by Toronto Police).
//         One row per person involved in a KSI collision, 2006 onward,
//         including the uninjured drivers and passengers.
// Output: public/vision-zero-ksi.json — one compact row per person who was
//         killed (injury = Fatal) or seriously injured (injury = Major).
//
// Run `npm run build:vision-zero` whenever the City republishes, then commit
// the JSON. Pass --file <path> to build from a CSV already on disk.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.join(__dirname, '..', 'public', 'vision-zero-ksi.json');

const PACKAGE = 'motor-vehicle-collisions-involving-killed-or-seriously-injured-persons';
const CKAN = `https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=${PACKAGE}`;
const SOURCE_PAGE = `https://open.toronto.ca/dataset/${PACKAGE}/`;

// Day 0 for the compact date column.
const EPOCH = Date.UTC(2006, 0, 1);

// Order matters: the page indexes into these lists.
const USERS = ['pedestrian', 'cyclist', 'motorcyclist', 'driver', 'passenger', 'other'];
const USER_MAP = {
  pedestrian: 0,
  cyclist: 1,
  motorcyclist: 2,
  driver: 3,
  passenger: 4,
  other_micromobility: 5,
  other: 5,
  owner: 3,
};

// Collision-level yes/no columns, packed into one bitmask per row.
const FLAGS = ['aggressive', 'distracted', 'red_light', 'heavy_truck', 'older_adult', 'school_child'];

async function loadCsv() {
  const fileArg = process.argv.indexOf('--file');
  if (fileArg !== -1) return fs.readFileSync(process.argv[fileArg + 1], 'utf8');

  const meta = await fetch(CKAN);
  if (!meta.ok) throw new Error(`CKAN ${meta.status}`);
  const { result } = await meta.json();
  // The WGS84 CSV. Looked up by name each run because the download URL
  // changes whenever the City re-uploads.
  const resource = result.resources.find(
    (r) => r.format === 'CSV' && /4326/.test(r.name),
  );
  if (!resource) throw new Error(`${PACKAGE} has no 4326 CSV resource`);
  console.log(`Downloading ${resource.name} (refreshed ${result.last_refreshed})`);
  const res = await fetch(resource.url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  return res.text();
}

function wardLabel(name) {
  // "Spadina-Fort York (10)" -> [10, "Spadina-Fort York"]
  const m = String(name || '').match(/^(.*)\s+\((\d+)\)$/);
  return m ? [Number(m[2]), m[1].trim()] : null;
}

async function main() {
  const text = await loadCsv();
  const { data, errors } = Papa.parse(text, { header: true, skipEmptyLines: true });
  if (errors.length) console.warn(`${errors.length} CSV parse warnings`);

  const required = ['collision_id', 'accdate', 'injury', 'road_user', 'wardname', 'invage', 'latitude', 'longitude'];
  for (const col of required) {
    if (!(col in data[0])) throw new Error(`Column "${col}" missing. The City changed the schema.`);
  }

  const wards = {};
  const collisions = new Map();
  const places = [];
  const rows = [];
  const unknownUsers = new Set();
  let lastDay = 0;

  for (const r of data) {
    if (r.injury !== 'Fatal' && r.injury !== 'Major') continue;
    const m = String(r.accdate).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}))?/);
    if (!m) continue;
    const day = Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - EPOCH) / 86400000);
    lastDay = Math.max(lastDay, day);

    let user = USER_MAP[r.road_user];
    if (user == null) {
      unknownUsers.add(r.road_user);
      user = 5;
    }

    const ward = wardLabel(r.wardname);
    if (ward) wards[ward[0]] = ward[1];

    if (!collisions.has(r.collision_id)) {
      collisions.set(r.collision_id, collisions.size);
      places.push([r.stname1, r.stname2, r.stname3].map((s) => (s || '').trim()).filter(Boolean).join(' & '));
    }

    let flags = 0;
    FLAGS.forEach((f, i) => {
      if (r[f] === 'true') flags |= 1 << i;
    });

    const lat = Number(r.latitude);
    const lon = Number(r.longitude);
    const age = r.invage === '' ? -1 : Number(r.invage);

    rows.push([
      day,
      m[4] == null ? -1 : Number(m[4]),
      r.injury === 'Fatal' ? 1 : 0,
      user,
      ward ? ward[0] : 0,
      Number.isFinite(age) ? age : -1,
      // 1e-5 degrees is about a metre. Offsets keep the numbers short.
      Number.isFinite(lat) && lat ? Math.round((lat - 43) * 1e5) : null,
      Number.isFinite(lon) && lon ? Math.round((lon + 80) * 1e5) : null,
      collisions.get(r.collision_id),
      flags,
    ]);
  }

  if (unknownUsers.size) console.warn(`Counted as "other": ${[...unknownUsers].join(', ')}`);

  rows.sort((a, b) => a[0] - b[0] || a[8] - b[8]);
  const lastDate = new Date(EPOCH + lastDay * 86400000).toISOString().slice(0, 10);

  const out = {
    builtAt: new Date().toISOString().slice(0, 10),
    lastDate,
    source: SOURCE_PAGE,
    epoch: '2006-01-01',
    columns: ['day', 'hour', 'fatal', 'user', 'ward', 'age', 'lat', 'lon', 'collision', 'flags'],
    users: USERS,
    flags: FLAGS,
    wards,
    rows,
    // Street names for each collision, indexed by the row's collision column.
    places,
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(out));

  const fatal = rows.filter((r) => r[2]).length;
  console.log(
    `Wrote ${rows.length} people (${fatal} killed) through ${lastDate} to ${path.relative(process.cwd(), OUTPUT)} `
    + `(${(fs.statSync(OUTPUT).size / 1024).toFixed(0)} KB)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
