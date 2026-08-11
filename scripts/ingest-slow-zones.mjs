// Manual/local slow-zone ingest: scrapes the TTC page and writes today's
// snapshot to the DB, same as the daily cron. Reads DATABASE_URL (or
// NEW_DATABASE_URL) from the environment or .env.local.
//
//   node scripts/ingest-slow-zones.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!process.env.DATABASE_URL) {
  const envFile = path.join(root, '.env.local');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^(NEW_DATABASE_URL|DATABASE_URL)="?([^"]+)"?$/);
      if (m) process.env.DATABASE_URL = m[2];
    }
  }
}

const { fetchSlowZones } = await import('../app/lib/slow-zones/scrape.js');
const { saveSnapshot } = await import('../app/lib/slow-zones/db.js');

const { asOf, zones } = await fetchSlowZones();
const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
const zoneTotal = await saveSnapshot(day, asOf, zones);
console.log(`Saved ${zones.length} rows (${zoneTotal} zones) for ${day} — TTC page timestamp: ${asOf}`);
process.exit(0);
