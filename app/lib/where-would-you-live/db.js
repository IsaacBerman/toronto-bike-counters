import { getPool, query } from '../db-pool.js';

// Both tables are created lazily on first use (same pattern as the downtown
// heatmap cache) so a deploy doesn't need a manual migration step. db/schema.sql
// carries the same DDL for a fresh database.
let tablesReady = null;
function ensureTables() {
  if (!tablesReady) {
    tablesReady = getPool()
      .query(
        `CREATE TABLE IF NOT EXISTS live_submissions (
           id SERIAL PRIMARY KEY,
           city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
           submitter_hash TEXT NOT NULL,
           resident BOOLEAN NOT NULL,
           raw_polygons JSONB NOT NULL,
           clipped_polygons JSONB,
           zone_id INTEGER,
           zone_lng DOUBLE PRECISION,
           zone_lat DOUBLE PRECISION,
           ip_hash TEXT,
           created_at TIMESTAMPTZ DEFAULT now(),
           UNIQUE (city_id, submitter_hash)
         );
         CREATE TABLE IF NOT EXISTS live_heatmap_cache (
           city_id INTEGER PRIMARY KEY REFERENCES cities(id) ON DELETE CASCADE,
           resident_count INTEGER NOT NULL,
           nonresident_count INTEGER NOT NULL,
           algo_version INTEGER NOT NULL,
           counts JSONB NOT NULL,
           updated_at TIMESTAMPTZ DEFAULT now()
         );
         CREATE TABLE IF NOT EXISTS live_zone_grids (
           city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
           zone_id INTEGER NOT NULL,
           submission_count INTEGER NOT NULL,
           algo_version INTEGER NOT NULL,
           layout_sig TEXT NOT NULL,
           counts JSONB NOT NULL,
           updated_at TIMESTAMPTZ DEFAULT now(),
           PRIMARY KEY (city_id, zone_id)
         );
         ALTER TABLE live_submissions ADD COLUMN IF NOT EXISTS zone_id INTEGER;
         ALTER TABLE live_submissions ADD COLUMN IF NOT EXISTS zone_lng DOUBLE PRECISION;
         ALTER TABLE live_submissions ADD COLUMN IF NOT EXISTS zone_lat DOUBLE PRECISION;`
      )
      .catch((error) => {
        tablesReady = null;
        throw error;
      });
  }
  return tablesReady;
}

// zoneId/zoneCenter describe the coarse zone the submitter said they live in —
// optional, and never any finer than the zone. The center is the zone square's
// own midpoint (identical for everyone who picks it, not the person's location);
// storing it means a future change to the zone layout can be re-derived from
// existing rows instead of orphaning them.
export async function insertLiveSubmission({
  cityId, submitterHash, resident, rawPolygons, clippedPolygons, zoneId, zoneCenter, ipHash,
}) {
  await ensureTables();
  const rows = await query(
    `INSERT INTO live_submissions
       (city_id, submitter_hash, resident, raw_polygons, clipped_polygons, zone_id, zone_lng, zone_lat, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (city_id, submitter_hash) DO NOTHING
     RETURNING id`,
    [
      cityId,
      submitterHash,
      resident,
      JSON.stringify(rawPolygons),
      clippedPolygons ? JSON.stringify(clippedPolygons) : null,
      zoneId ?? null,
      zoneCenter?.[0] ?? null,
      zoneCenter?.[1] ?? null,
      ipHash || null,
    ]
  );
  return rows.length > 0;
}

// Submissions from this IP in the last 24h, for the per-IP rate limit. Fails
// open (0): the limit is an abuse brake, not a gate worth breaking submits for.
export async function countRecentLiveSubmissionsByIp(ipHash) {
  if (!ipHash) return 0;
  try {
    await ensureTables();
    const rows = await query(
      `SELECT COUNT(*)::int AS n FROM live_submissions
       WHERE ip_hash = $1 AND created_at > now() - interval '24 hours'`,
      [ipHash]
    );
    return rows[0]?.n ?? 0;
  } catch (error) {
    console.error('Error counting recent live submissions by IP:', error);
    return 0;
  }
}

export async function getLiveSubmissionByHash(cityId, submitterHash) {
  try {
    await ensureTables();
    const rows = await query(
      `SELECT raw_polygons, resident, zone_id FROM live_submissions
       WHERE city_id = $1 AND submitter_hash = $2 LIMIT 1`,
      [cityId, submitterHash]
    );
    return rows[0] || null;
  } catch (error) {
    console.error('Error loading live submission:', error);
    return null;
  }
}

// One small query for the filter totals AND the per-zone tallies. The zone
// tallies shade the zone selector and tell the read path how many answers a
// zone's stored grid ought to contain, so they have to be current — computing
// them here rather than caching them means they can never drift.
export async function getLiveCounts(cityId) {
  try {
    await ensureTables();
    const rows = await query(
      `SELECT resident, zone_id, COUNT(*)::int AS n FROM live_submissions
       WHERE city_id = $1 AND clipped_polygons IS NOT NULL
       GROUP BY resident, zone_id`,
      [cityId]
    );
    let resident = 0;
    let nonresident = 0;
    const zoneTotals = {};
    for (const row of rows) {
      if (row.resident) resident += row.n;
      else nonresident += row.n;
      if (row.zone_id != null) zoneTotals[row.zone_id] = (zoneTotals[row.zone_id] || 0) + row.n;
    }
    return { resident, nonresident, zoneTotals };
  } catch (error) {
    console.error('Error counting live submissions:', error);
    return { resident: 0, nonresident: 0, zoneTotals: {} };
  }
}

// The only query that moves real volume, so it runs only on a full rebuild
// (cold persistent cache or an algorithm-version bump).
export async function getLiveSubmissionsForCity(cityId) {
  try {
    await ensureTables();
    const rows = await query(
      `SELECT resident, clipped_polygons, zone_id, zone_lng, zone_lat FROM live_submissions
       WHERE city_id = $1 AND clipped_polygons IS NOT NULL`,
      [cityId]
    );
    return rows.map((row) => ({
      resident: row.resident,
      clippedPolygons: row.clipped_polygons,
      zoneId: row.zone_id,
      zoneCenter: row.zone_lng != null && row.zone_lat != null ? [row.zone_lng, row.zone_lat] : null,
    }));
  } catch (error) {
    console.error('Error loading live submissions:', error);
    return [];
  }
}

export async function getLiveHeatmapCache(cityId) {
  try {
    await ensureTables();
    const rows = await query(
      `SELECT resident_count, nonresident_count, algo_version, counts
       FROM live_heatmap_cache WHERE city_id = $1`,
      [cityId]
    );
    return rows[0] || null;
  } catch (error) {
    console.error('Error reading live heatmap cache:', error);
    return null;
  }
}

export async function saveLiveHeatmapCache(cityId, residentCount, nonResidentCount, algoVersion, counts) {
  try {
    await ensureTables();
    await query(
      `INSERT INTO live_heatmap_cache (city_id, resident_count, nonresident_count, algo_version, counts, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (city_id) DO UPDATE
         SET resident_count = $2, nonresident_count = $3, algo_version = $4, counts = $5, updated_at = now()`,
      [cityId, residentCount, nonResidentCount, algoVersion, JSON.stringify(counts)]
    );
  } catch (error) {
    console.error('Error writing live heatmap cache:', error);
  }
}

// A single zone's stored destination grid. Rows exist only for zones somebody
// has actually answered from — they are created on submit, not up front.
export async function getLiveZoneGrid(cityId, zoneId) {
  try {
    await ensureTables();
    const rows = await query(
      `SELECT submission_count, algo_version, layout_sig, counts
       FROM live_zone_grids WHERE city_id = $1 AND zone_id = $2`,
      [cityId, zoneId]
    );
    return rows[0] || null;
  } catch (error) {
    console.error('Error reading live zone grid:', error);
    return null;
  }
}

export async function saveLiveZoneGrid(cityId, zoneId, submissionCount, algoVersion, layoutSig, counts) {
  try {
    await ensureTables();
    await query(
      `INSERT INTO live_zone_grids
         (city_id, zone_id, submission_count, algo_version, layout_sig, counts, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (city_id, zone_id) DO UPDATE
         SET submission_count = $3, algo_version = $4, layout_sig = $5, counts = $6, updated_at = now()`,
      [cityId, zoneId, submissionCount, algoVersion, layoutSig, JSON.stringify(counts)]
    );
  } catch (error) {
    console.error('Error writing live zone grid:', error);
  }
}

// Just the answers from one zone — the read behind creating or healing a single
// zone's grid. Far smaller than the whole city: usually one row.
export async function getLiveSubmissionsForZone(cityId, zoneId) {
  try {
    await ensureTables();
    const rows = await query(
      `SELECT clipped_polygons FROM live_submissions
       WHERE city_id = $1 AND zone_id = $2 AND clipped_polygons IS NOT NULL`,
      [cityId, zoneId]
    );
    return rows.map((row) => row.clipped_polygons);
  } catch (error) {
    console.error('Error loading zone submissions:', error);
    return [];
  }
}
