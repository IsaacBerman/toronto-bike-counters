// Roll the City's trip-level Bike Share archives up into daily departures per
// station, so a station's history comes from real rider trips rather than
// from bikeraccoon's polling of the live feed.
//
// Why this exists: bikeraccoon infers trips from changes in each dock's bike
// count, so a rebalancing truck emptying or filling a station reads as dozens
// of trips. Station 7997 shows ~3,900 departures in July 2025 on bikeraccoon
// against 329 in the City's file. The archive is one row per rider trip and
// only ever carries member and casual users (checked 2019 through 2026), so
// operator moves are not in it at all; rows of any other user type are still
// dropped in case one appears.
//
// Input:  the bikeshare-ridership-YYYY.zip resources on Toronto's CKAN portal
//         (~1.7 GB for 2019-2026), kept in ~/.cache/bikeshare-ridership and
//         downloaded again only when the City republishes a year.
// Output: public/bikeshare-stations/<station id>.json, one per station —
//         departures per local day, positionally encoded from the station's
//         first trip (`start`) to the archive's last day (`end`), so a day
//         with no rider trips is a real 0.
//
// The archive is published in arrears, so rerun `npm run build:bikeshare-stations`
// when a new quarter lands. Days past `end` fall back to bikeraccoon at runtime
// (see stationDataUtils.js).
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { ckanResources, archivePath, csvMembers } from './lib/bikeshare-archive.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const OUTPUT = path.join(root, 'public', 'bikeshare-stations');

// The station view shows the last seven years, so fetch that many calendar
// years back; years given on the command line win.
const years = process.argv.slice(2).filter((a) => /^\d{4}$/.test(a));
const thisYear = new Date().getFullYear();
const WANTED = years.length ? years.map(Number) : range(thisYear - 7, thisYear);

// station id -> Map(date -> departures)
const counts = new Map();
let latest = '';

const resources = await ckanResources();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bikeshare-stations-'));
try {
  for (const year of WANTED) {
    const resource = resources.get(year);
    if (!resource) {
      console.warn(`no bikeshare-ridership-${year}.zip published; skipping`);
      continue;
    }
    const zipPath = await archivePath(resource);
    for await (const { name, stream } of csvMembers(zipPath, tmp)) {
      const rows = await tallyCsv(name, stream);
      console.log(`  ${path.basename(name)}: ${rows.toLocaleString()} trips`);
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (!counts.size) throw new Error('no trips tallied; refusing to write an empty directory');

fs.rmSync(OUTPUT, { recursive: true, force: true });
fs.mkdirSync(OUTPUT, { recursive: true });
let bytes = 0;
for (const [station, days] of counts) {
  const start = [...days.keys()].sort()[0];
  const trips = [];
  for (let day = new Date(`${start}T00:00:00Z`); iso(day) <= latest; day.setUTCDate(day.getUTCDate() + 1)) {
    trips.push(days.get(iso(day)) ?? 0);
  }
  const file = path.join(OUTPUT, `${station}.json`);
  fs.writeFileSync(file, JSON.stringify({ start, end: latest, trips }));
  bytes += fs.statSync(file).size;
}

console.log(
  `\nwrote ${counts.size} stations to ${path.relative(root, OUTPUT)}/, ` +
    `through ${latest}, ${(bytes / 1e6).toFixed(1)} MB`
);

/**
 * Tally one CSV's rider trips by start station and local day.
 *
 * The header changes over the years — "Start Station Id" with a BOM and
 * MM/DD/YYYY times up to 2023, "Start_Station_Id" with ISO times from 2024,
 * and a Bike_Model column after User_Type — so columns are found by name.
 * The station id and start time sit before the quoted station names and the
 * user type after them, among fields that never contain commas, so a plain
 * split counted from either end finds them without a CSV parser.
 */
async function tallyCsv(name, stream) {
  let station, time, typeFromEnd;
  let tallied = 0;
  let skipped = 0;
  for await (const line of readline.createInterface({ input: stream, crlfDelay: Infinity })) {
    if (station === undefined) {
      const columns = line.replace(/^﻿/, '').split(',').map((c) => c.toLowerCase().replace(/[\s_]+/g, ''));
      station = columns.indexOf('startstationid');
      time = columns.indexOf('starttime');
      typeFromEnd = columns.length - columns.indexOf('usertype');
      if (station < 0 || time < 0 || typeFromEnd > columns.length) {
        throw new Error(`${name}: missing a start station, start time or user type column`);
      }
      continue;
    }
    if (!line) continue;
    const fields = line.split(',');
    if (!/member|casual/i.test(fields[fields.length - typeFromEnd])) {
      skipped++;
      continue;
    }
    const id = parseInt(fields[station], 10);
    const date = localDate(fields[time]);
    if (!id || !date) {
      skipped++;
      continue;
    }
    let days = counts.get(id);
    if (!days) counts.set(id, (days = new Map()));
    days.set(date, (days.get(date) ?? 0) + 1);
    if (date > latest) latest = date;
    tallied++;
  }
  if (skipped) console.warn(`  ${path.basename(name)}: skipped ${skipped} row(s) without a station, date or rider type`);
  return tallied;
}

/** "2025-09-01 00:00:03" or "09/01/2025 00:00" -> "2025-09-01". */
function localDate(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const match = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(value);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : null;
}

function range(from, to) {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function iso(date) {
  return date.toISOString().slice(0, 10);
}
