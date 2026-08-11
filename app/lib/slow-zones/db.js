import { Pool } from 'pg';

let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error('Missing DATABASE_URL (or POSTGRES_URL) environment variable');
    }
    // Neon (and most hosted Postgres) require TLS; a local dev database does not.
    const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
    pool = new Pool({
      connectionString,
      ssl: isLocal ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

// Two tables: one row per ingest day (so a day with zero zones still charts
// as zero, not a gap), and one row per zone per day.
let tablesReady = null;
function ensureTables() {
  if (!tablesReady) {
    tablesReady = getPool()
      .query(
        `CREATE TABLE IF NOT EXISTS slow_zone_days (
           day DATE PRIMARY KEY,
           as_of TEXT,
           zone_total SMALLINT NOT NULL,
           captured_at TIMESTAMPTZ DEFAULT now()
         );
         CREATE TABLE IF NOT EXISTS slow_zones (
           id SERIAL PRIMARY KEY,
           day DATE NOT NULL REFERENCES slow_zone_days(day) ON DELETE CASCADE,
           line SMALLINT NOT NULL,
           location TEXT NOT NULL,
           direction TEXT,
           from_station TEXT,
           to_station TEXT,
           zone_count SMALLINT NOT NULL DEFAULT 1,
           defect_m INTEGER,
           distance_m INTEGER,
           track_pct SMALLINT,
           reduced_kmh SMALLINT,
           normal_kmh SMALLINT,
           reason TEXT,
           target TEXT
         );
         CREATE INDEX IF NOT EXISTS slow_zones_day_idx ON slow_zones(day)`
      )
      .catch((error) => {
        tablesReady = null;
        throw error;
      });
  }
  return tablesReady;
}

// Replace the given day's snapshot (idempotent — re-running an ingest for the
// same day overwrites rather than duplicates).
export async function saveSnapshot(day, asOf, zones) {
  await ensureTables();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM slow_zone_days WHERE day = $1', [day]);
    const zoneTotal = zones.reduce((sum, z) => sum + (z.zoneCount || 1), 0);
    await client.query(
      'INSERT INTO slow_zone_days (day, as_of, zone_total) VALUES ($1, $2, $3)',
      [day, asOf, zoneTotal]
    );
    for (const z of zones) {
      await client.query(
        `INSERT INTO slow_zones
           (day, line, location, direction, from_station, to_station, zone_count,
            defect_m, distance_m, track_pct, reduced_kmh, normal_kmh, reason, target)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          day, z.line, z.location, z.direction, z.fromStation, z.toStation,
          z.zoneCount, z.defectM, z.distanceM, z.trackPct, z.reducedKmh,
          z.normalKmh, z.reason, z.target,
        ]
      );
    }
    await client.query('COMMIT');
    return zoneTotal;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getHistory() {
  await ensureTables();
  const { rows: days } = await getPool().query(
    'SELECT day::text, as_of, zone_total FROM slow_zone_days ORDER BY day'
  );
  const { rows: zones } = await getPool().query(
    `SELECT day::text, line, location, direction, from_station, to_station,
            zone_count, defect_m, distance_m, track_pct, reduced_kmh, normal_kmh,
            reason, target
     FROM slow_zones ORDER BY day, line, id`
  );
  return { days, zones };
}
