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
         CREATE INDEX IF NOT EXISTS slow_zones_day_idx ON slow_zones(day);
         CREATE TABLE IF NOT EXISTS slow_zone_ingest_runs (
           id SERIAL PRIMARY KEY,
           ran_at TIMESTAMPTZ DEFAULT now(),
           source TEXT,
           ok BOOLEAN NOT NULL,
           day DATE,
           as_of TEXT,
           row_count SMALLINT,
           zone_total SMALLINT,
           duration_ms INTEGER,
           error TEXT
         );
         CREATE INDEX IF NOT EXISTS slow_zone_ingest_runs_ran_at_idx
           ON slow_zone_ingest_runs(ran_at DESC)`
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

// One row per ingest attempt, success or failure. Vercel's runtime log
// retention is far shorter than this job's cadence, so a daily failure is
// usually unreadable by the time anyone notices the gap. A row here outlives
// that, and its *absence* is the diagnosis that matters: no row for a day
// means the cron never fired at all, as opposed to firing and erroring.
//
// Best-effort by design. Logging must never be the reason an ingest fails, and
// when the database itself is the thing that's broken there is nowhere to
// write anyway — that case shows up as a missing row, same as a cron no-show.
export async function logIngestRun(run) {
  try {
    await ensureTables();
    await getPool().query(
      `INSERT INTO slow_zone_ingest_runs
         (source, ok, day, as_of, row_count, zone_total, duration_ms, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        run.source, run.ok, run.day ?? null, run.asOf ?? null,
        run.rowCount ?? null, run.zoneTotal ?? null, run.durationMs ?? null,
        run.error ?? null,
      ]
    );
  } catch (error) {
    console.error('[slow-zones:ingest] could not record run:', error.message);
  }
}

export async function getRecentIngestRuns(limit = 20) {
  await ensureTables();
  const { rows } = await getPool().query(
    `SELECT ran_at, source, ok, day::text, as_of, row_count, zone_total,
            duration_ms, error
     FROM slow_zone_ingest_runs ORDER BY ran_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

// Health of the ingest pipeline, for the admin page. The run log only starts
// from the day it shipped, so the days actually missing from the record are
// reported alongside it — that part reads the snapshots themselves and so
// covers the whole history, including outages that predate the log.
export async function getIngestHealth(limit = 20) {
  await ensureTables();
  const runs = await getRecentIngestRuns(limit);
  const { rows: gapRows } = await getPool().query(
    `SELECT to_char(d, 'YYYY-MM-DD') AS day
     FROM generate_series(
            GREATEST(
              (SELECT MIN(day) FROM slow_zone_days),
              (now() AT TIME ZONE 'America/Toronto')::date - INTERVAL '60 days'
            ),
            (now() AT TIME ZONE 'America/Toronto')::date,
            INTERVAL '1 day'
          ) AS d
     WHERE NOT EXISTS (SELECT 1 FROM slow_zone_days s WHERE s.day = d::date)
     ORDER BY d DESC`
  );
  const { rows: lastRows } = await getPool().query(
    `SELECT day::text, as_of, zone_total, captured_at
     FROM slow_zone_days ORDER BY day DESC LIMIT 1`
  );
  return {
    runs,
    missingDays: gapRows.map((r) => r.day),
    lastSnapshot: lastRows[0] || null,
  };
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
