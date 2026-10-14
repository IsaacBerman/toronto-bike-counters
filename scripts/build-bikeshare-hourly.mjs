// Roll the City's trip-level Bike Share archives up into hourly totals, so the
// hourly chart's year-ago comparison can come from the real ridership files
// rather than from bikeraccoon's polling of the live feed.
//
// Why this exists: bikeraccoon is an inference from polling the public GBFS
// feed, and its Toronto history has holes — a 35-day one from 2025-09-15T12:00
// to 2025-10-20T18:00, which is exactly where the year-ago window sat in
// September 2026. Hours inside a hole came back as no rows at all, which the
// chart could only render as zero. The City's own files have no such gap: they
// are one row per trip with Start_Time to the second, so the hourly shape is a
// plain group-by.
//
// Input:  the bikeshare-ridership-YYYY.zip resources on Toronto's CKAN portal,
//         kept in ~/.cache/bikeshare-ridership and downloaded again only when
//         the City republishes a year.
// Output: public/bikeshare-hourly.json — trips per local hour, positionally
//         encoded: 24 entries per day starting at `start`, so the date and hour
//         of every cell are implied by its index and only the counts are
//         stored. 455 days costs ~43 KB, against ~529 KB for the same numbers
//         as {date, hour, trips} records.
//
// The archive is published in arrears, roughly a quarter behind, so rerun
// `npm run build:bikeshare-hourly` when a new quarter lands. Dates past the end
// of this file fall back to bikeraccoon at runtime (see dataUtils.js).
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { PACKAGE, ckanResources, archivePath, centralDirectory, memberStream } from './lib/bikeshare-archive.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const OUTPUT = path.join(root, 'public', 'bikeshare-hourly.json');

// Years to fetch. The runtime only ever asks for a two-week window ending a
// year ago, so the current and previous calendar years always cover it; a year
// given on the command line wins, for backfilling further.
const years = process.argv.slice(2).filter((a) => /^\d{4}$/.test(a));
const thisYear = new Date().getFullYear();
const WANTED = years.length ? years.map(Number) : [thisYear - 1, thisYear];

// trips per local hour, keyed `YYYY-MM-DD|H`
const counts = new Map();

const resources = await ckanResources();
for (const year of WANTED) {
  const resource = resources.get(year);
  if (!resource) {
    console.warn(`no bikeshare-ridership-${year}.zip published; skipping`);
    continue;
  }
  const zipPath = await archivePath(resource);
  for (const member of centralDirectory(zipPath)) {
    if (!member.name.toLowerCase().endsWith('.csv')) continue;
    const rows = await tallyMember(zipPath, member);
    console.log(`  ${member.name}: ${rows.toLocaleString()} trips`);
  }
}

if (!counts.size) throw new Error('no trips tallied; refusing to write an empty file');

const dates = [...new Set([...counts.keys()].map((k) => k.slice(0, 10)))].sort();
const start = dates[0];
const end = dates[dates.length - 1];

// Positional: 24 cells a day from `start`. Two hours a year are not a usable
// sample and are written as null rather than a number, which the runtime skips
// instead of averaging in:
//   - the hour that spring-forward skips, which has no trips because it never
//     happened locally, and would otherwise read as a real zero;
//   - the hour fall-back repeats, which holds two hours of trips in one cell
//     and reads ~2x high (2025-11-02 01:00 was 1,848 against 777 the day
//     before).
// A genuinely empty hour — four of them over 2025-2026Q1, all deep-winter
// small hours — stays 0, because that is a real count.
const hours = [];
let nulled = 0;
for (let day = new Date(`${start}T00:00:00Z`); iso(day) <= end; day.setUTCDate(day.getUTCDate() + 1)) {
  const date = iso(day);
  const skip = dstAnomalyHour(date);
  for (let hour = 0; hour < 24; hour++) {
    if (hour === skip) {
      hours.push(null);
      nulled++;
    } else {
      hours.push(counts.get(`${date}|${hour}`) ?? 0);
    }
  }
}

fs.writeFileSync(
  OUTPUT,
  JSON.stringify({
    generated: new Date().toISOString(),
    source: `City of Toronto open data, ${PACKAGE}`,
    note: 'trips per local (America/Toronto) hour; 24 cells per day from `start`; null = hour not a usable sample (DST transition)',
    start,
    end,
    hours,
  })
);

const total = hours.reduce((sum, h) => sum + (h ?? 0), 0);
console.log(
  `\nwrote ${path.relative(root, OUTPUT)}: ${start} to ${end}, ` +
    `${hours.length.toLocaleString()} hourly cells (${nulled} null), ` +
    `${total.toLocaleString()} trips, ${(fs.statSync(OUTPUT).size / 1024).toFixed(1)} KB`
);

/**
 * Inflate one member and tally its trips by local hour.
 *
 * Start_Time is the fourth column and every column before it is numeric, so
 * the field is taken by splitting on the first few commas rather than running
 * a CSV parser over millions of rows — the quoted station names that would
 * need one all sit after it.
 */
async function tallyMember(zipPath, member) {
  const stream = memberStream(zipPath, member);

  let tallied = 0;
  let header_seen = false;
  let malformed = 0;
  for await (const line of readline.createInterface({ input: stream, crlfDelay: Infinity })) {
    if (!header_seen) {
      header_seen = true;
      const columns = line.split(',');
      if (columns[3] !== 'Start_Time') throw new Error(`${member.name}: Start_Time is not column 4 (got ${columns[3]})`);
      continue;
    }
    if (!line) continue;
    // "2025-09-01 00:00:03" -> date "2025-09-01", hour 0
    const startTime = line.split(',', 5)[3];
    if (!startTime || startTime.length < 13) {
      malformed++;
      continue;
    }
    const key = `${startTime.slice(0, 10)}|${Number(startTime.slice(11, 13))}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    tallied++;
  }
  if (malformed) console.warn(`  ${member.name}: ${malformed} row(s) without a usable Start_Time`);
  return tallied;
}

/**
 * The local hour on `date` that is not a usable sample, or -1.
 *
 * Derived from the zone's actual offsets rather than from the current
 * second-Sunday-of-March rule, so a legislated change to when the clocks move
 * does not quietly put the null on the wrong hour. A day whose offset differs
 * from the previous day's is a transition: springing forward skips local 02:00,
 * falling back runs local 01:00 twice.
 */
function dstAnomalyHour(date) {
  const offset = offsetAt(date);
  const previous = new Date(`${date}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const before = offsetAt(iso(previous));
  if (offset === before) return -1;
  return offset > before ? 2 : 1;
}

/** America/Toronto's UTC offset in hours at noon on an ISO date. */
function offsetAt(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    timeZoneName: 'shortOffset',
  }).formatToParts(new Date(`${date}T12:00:00Z`));
  const name = parts.find((p) => p.type === 'timeZoneName').value; // "GMT-4"
  return Number(name.replace('GMT', '') || 0);
}

function iso(date) {
  return date.toISOString().slice(0, 10);
}
