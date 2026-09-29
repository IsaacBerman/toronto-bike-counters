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
//         downloaded to a temp dir (~226 MB for a full year; nothing is kept).
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
import os from 'os';
import path from 'path';
import readline from 'readline';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const OUTPUT = path.join(root, 'public', 'bikeshare-hourly.json');
const PACKAGE = 'bike-share-toronto-ridership-data';
const CKAN = `https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=${PACKAGE}`;

// Years to fetch. The runtime only ever asks for a two-week window ending a
// year ago, so the current and previous calendar years always cover it; a year
// given on the command line wins, for backfilling further.
const years = process.argv.slice(2).filter((a) => /^\d{4}$/.test(a));
const thisYear = new Date().getFullYear();
const WANTED = years.length ? years.map(Number) : [thisYear - 1, thisYear];

// trips per local hour, keyed `YYYY-MM-DD|H`
const counts = new Map();

const resources = await ckanResources();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bikeshare-hourly-'));
try {
  for (const year of WANTED) {
    const resource = resources.get(year);
    if (!resource) {
      console.warn(`no bikeshare-ridership-${year}.zip published; skipping`);
      continue;
    }
    const zipPath = path.join(tmp, `${year}.zip`);
    process.stdout.write(`${year}: downloading… `);
    await download(resource, zipPath);
    const size = fs.statSync(zipPath).size;
    process.stdout.write(`${(size / 1e6).toFixed(0)} MB\n`);
    for (const member of centralDirectory(zipPath)) {
      if (!member.name.toLowerCase().endsWith('.csv')) continue;
      const rows = await tallyMember(zipPath, member);
      console.log(`  ${member.name}: ${rows.toLocaleString()} trips`);
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
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

/** Map of year -> download URL for each bikeshare-ridership-YYYY.zip. */
async function ckanResources() {
  const response = await fetch(CKAN);
  if (!response.ok) throw new Error(`CKAN ${response.status}`);
  const { result } = await response.json();
  const found = new Map();
  for (const resource of result.resources) {
    const match = /^bikeshare-ridership-(\d{4})\.zip$/.exec(resource.name);
    if (match) found.set(Number(match[1]), resource.url);
  }
  return found;
}

async function download(url, dest) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  await fs.promises.writeFile(dest, response.body);
}

/**
 * The zip members, read out of the central directory at the end of the file.
 *
 * Node ships no zip reader, and these archives are far too big to hold
 * uncompressed in memory (a year of trips is ~1 GB of CSV), so the members are
 * located here and then inflated one at a time as streams.
 */
function centralDirectory(zipPath) {
  const size = fs.statSync(zipPath).size;
  const tailLength = Math.min(size, 0x10000 + 22); // max comment + EOCD record
  const tail = Buffer.alloc(tailLength);
  const fd = fs.openSync(zipPath, 'r');
  try {
    fs.readSync(fd, tail, 0, tailLength, size - tailLength);
  } finally {
    fs.closeSync(fd);
  }

  const eocd = tail.lastIndexOf('PK\x05\x06', 'latin1');
  if (eocd < 0) throw new Error(`${zipPath}: no end-of-central-directory record`);
  const entries = tail.readUInt16LE(eocd + 10);
  const directoryStart = tail.readUInt32LE(eocd + 16);

  const directory = Buffer.alloc(tail.readUInt32LE(eocd + 12));
  const fd2 = fs.openSync(zipPath, 'r');
  try {
    fs.readSync(fd2, directory, 0, directory.length, directoryStart);
  } finally {
    fs.closeSync(fd2);
  }

  const members = [];
  let at = 0;
  for (let i = 0; i < entries; i++) {
    if (directory.readUInt32LE(at) !== 0x02014b50) throw new Error(`${zipPath}: bad directory entry ${i}`);
    const nameLength = directory.readUInt16LE(at + 28);
    members.push({
      name: directory.slice(at + 46, at + 46 + nameLength).toString('utf8'),
      method: directory.readUInt16LE(at + 10),
      compressedSize: directory.readUInt32LE(at + 20),
      localHeader: directory.readUInt32LE(at + 42),
    });
    at += 46 + nameLength + directory.readUInt16LE(at + 30) + directory.readUInt16LE(at + 32);
  }
  return members;
}

/**
 * Inflate one member and tally its trips by local hour.
 *
 * Start_Time is the fourth column and every column before it is numeric, so
 * the field is taken by splitting on the first few commas rather than running
 * a CSV parser over millions of rows — the quoted station names that would
 * need one all sit after it.
 */
async function tallyMember(zipPath, member) {
  // The local header's extra field can differ in length from the central
  // directory's, so the data offset has to come from the local header itself.
  const header = Buffer.alloc(30);
  const fd = fs.openSync(zipPath, 'r');
  try {
    fs.readSync(fd, header, 0, 30, member.localHeader);
  } finally {
    fs.closeSync(fd);
  }
  if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`${member.name}: bad local header`);
  const dataStart = member.localHeader + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);

  let stream = fs.createReadStream(zipPath, { start: dataStart, end: dataStart + member.compressedSize - 1 });
  if (member.method === 8) stream = stream.pipe(zlib.createInflateRaw());
  else if (member.method !== 0) throw new Error(`${member.name}: unsupported compression ${member.method}`);

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
