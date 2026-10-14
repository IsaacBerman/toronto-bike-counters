// Shared reading of the City's trip-level Bike Share archives
// (bikeshare-ridership-YYYY.zip on Toronto's CKAN portal), for the build
// scripts that roll them up.
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

export const PACKAGE = 'bike-share-toronto-ridership-data';
const CKAN = `https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=${PACKAGE}`;

// Downloaded archives are kept here and shared with the ward and daily builds
// in dash.raccoon.bike (scripts/ridership_archives.py), which follow the same
// rule: a file is current while its size matches the portal's and its
// manifest record, if any, matches the portal's size and last_modified.
export const CACHE = path.join(os.homedir(), '.cache', 'bikeshare-ridership');
const MANIFEST = path.join(CACHE, 'manifest.json');

/** Map of year -> CKAN resource for each bikeshare-ridership-YYYY.zip. */
export async function ckanResources() {
  const response = await fetch(CKAN);
  if (!response.ok) throw new Error(`CKAN ${response.status}`);
  const { result } = await response.json();
  const found = new Map();
  for (const resource of result.resources) {
    const match = /^bikeshare-ridership-(\d{4})\.zip$/.exec(resource.name);
    if (match) found.set(Number(match[1]), resource);
  }
  return found;
}

/**
 * Local path of a year's archive, downloading it only when the cached copy is
 * missing or the City has republished the year since.
 */
export async function archivePath(resource) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, resource.name);
  const stamp = { last_modified: resource.last_modified ?? null, size: resource.size ?? null };
  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
  const recorded = manifest[resource.name];
  const current =
    fs.existsSync(file) &&
    fs.statSync(file).size === stamp.size &&
    (!recorded || (recorded.size === stamp.size && recorded.last_modified === stamp.last_modified));
  if (current) {
    console.log(`${resource.name}: cached`);
  } else {
    process.stdout.write(`${resource.name}: downloading ${((stamp.size ?? 0) / 1e6).toFixed(0)} MB… `);
    const response = await fetch(resource.url);
    if (!response.ok) throw new Error(`${resource.url} -> ${response.status}`);
    await fs.promises.writeFile(`${file}.part`, response.body);
    fs.renameSync(`${file}.part`, file);
    process.stdout.write('done\n');
  }
  manifest[resource.name] = stamp;
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
  return file;
}

/**
 * The zip members, read out of the central directory at the end of the file.
 *
 * Node ships no zip reader, and these archives are far too big to hold
 * uncompressed in memory (a year of trips is ~1 GB of CSV), so the members are
 * located here and then inflated one at a time as streams.
 */
export function centralDirectory(zipPath) {
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

/** A readable stream of one member's uncompressed bytes. */
export function memberStream(zipPath, member) {
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

  const stream = fs.createReadStream(zipPath, { start: dataStart, end: dataStart + member.compressedSize - 1 });
  if (member.method === 8) return stream.pipe(zlib.createInflateRaw());
  if (member.method === 0) return stream;
  throw new Error(`${member.name}: unsupported compression ${member.method}`);
}

/**
 * Every CSV in an archive, as {name, stream}, including CSVs inside zips
 * inside it — 2022's November file ships as a zip within the year's zip. A
 * nested zip is written out under `tmp` so its own directory can be read.
 */
export async function* csvMembers(zipPath, tmp) {
  for (const member of centralDirectory(zipPath)) {
    const lower = member.name.toLowerCase();
    if (lower.endsWith('.csv')) {
      yield { name: member.name, stream: memberStream(zipPath, member) };
    } else if (lower.endsWith('.zip')) {
      const nested = path.join(tmp, `nested-${path.basename(member.name)}`);
      await fs.promises.writeFile(nested, memberStream(zipPath, member));
      try {
        yield* csvMembers(nested, tmp);
      } finally {
        fs.rmSync(nested, { force: true });
      }
    }
  }
}
