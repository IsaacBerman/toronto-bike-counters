import { getPool, query } from '../db-pool.js';

// Cities (and their large, immutable boundaries) rarely change, so cache them in
// memory. This is the key egress saver — the full boundary was previously
// re-downloaded from the DB on every heatmap/status/city request.
const CITY_CACHE_TTL = 30 * 60 * 1000;
const CITY_CACHE_MAX = 40;
let citiesCache = null; // { rows, ts }
const cityBySlugCache = new Map(); // slug -> { row, ts }

function cacheCity(slug, row) {
  cityBySlugCache.set(slug, { row, ts: Date.now() });
  if (cityBySlugCache.size > CITY_CACHE_MAX) {
    cityBySlugCache.delete(cityBySlugCache.keys().next().value);
  }
}

export function invalidateCityCaches() {
  citiesCache = null;
  cityBySlugCache.clear();
}

export async function getCities() {
  if (citiesCache && Date.now() - citiesCache.ts < CITY_CACHE_TTL) return citiesCache.rows;
  try {
    const rows = await query('SELECT id, slug, name, label FROM cities ORDER BY name ASC');
    citiesCache = { rows, ts: Date.now() };
    return rows;
  } catch (error) {
    console.error('Error loading cities:', error);
    return citiesCache?.rows || [];
  }
}

export async function getCityBySlug(slug) {
  const cached = cityBySlugCache.get(slug);
  if (cached && Date.now() - cached.ts < CITY_CACHE_TTL) return cached.row;
  try {
    const rows = await query('SELECT * FROM cities WHERE slug = $1 LIMIT 1', [slug]);
    const row = rows[0] || null;
    if (row) cacheCity(slug, row);
    return row;
  } catch (error) {
    console.error('Error loading city:', error);
    return cached?.row || null;
  }
}

export async function getCityByOsm(osmType, osmId) {
  if (!osmId) return null;
  try {
    const rows = await query(
      'SELECT * FROM cities WHERE osm_type = $1 AND osm_id = $2 LIMIT 1',
      [osmType, osmId]
    );
    return rows[0] || null;
  } catch (error) {
    console.error('Error loading city by osm id:', error);
    return null;
  }
}

export async function insertCity({ slug, name, displayName, boundary, bbox, osmType, osmId }) {
  const rows = await query(
    `INSERT INTO cities (slug, name, display_name, boundary, bbox, osm_type, osm_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (slug) DO NOTHING
     RETURNING *`,
    [slug, name, displayName, JSON.stringify(boundary), JSON.stringify(bbox), osmType || null, osmId || null]
  );
  invalidateCityCaches(); // new city should appear in the cached list right away
  if (rows[0]) return rows[0];
  return getCityBySlug(slug);
}

// Lazily adds the ip_hash column (rate-limit signal, not identity) so deploys
// don't need a manual migration — same pattern as ensureHeatmapTable.
let ipHashColumnReady = null;
function ensureIpHashColumn() {
  if (!ipHashColumnReady) {
    ipHashColumnReady = getPool()
      .query('ALTER TABLE submissions ADD COLUMN IF NOT EXISTS ip_hash TEXT')
      .catch((error) => {
        ipHashColumnReady = null;
        throw error;
      });
  }
  return ipHashColumnReady;
}

export async function insertSubmission({ cityId, submitterHash, rawPolygon, clippedPolygon, ipHash }) {
  await ensureIpHashColumn();
  const rows = await query(
    `INSERT INTO submissions (city_id, submitter_hash, raw_polygon, clipped_polygon, ip_hash)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (city_id, submitter_hash) DO NOTHING
     RETURNING id`,
    [cityId, submitterHash, JSON.stringify(rawPolygon), clippedPolygon ? JSON.stringify(clippedPolygon) : null, ipHash || null]
  );
  return rows.length > 0;
}

// Submissions from this IP in the last 24h, for the per-IP rate limit. Fails
// open (0): the limit is an abuse brake, not a gate worth breaking submits for.
export async function countRecentSubmissionsByIp(ipHash) {
  if (!ipHash) return 0;
  try {
    await ensureIpHashColumn();
    const rows = await query(
      `SELECT COUNT(*)::int AS n FROM submissions
       WHERE ip_hash = $1 AND created_at > now() - interval '24 hours'`,
      [ipHash]
    );
    return rows[0]?.n ?? 0;
  } catch (error) {
    console.error('Error counting recent submissions by IP:', error);
    return 0;
  }
}

export async function getSubmissionByHash(cityId, submitterHash) {
  try {
    const rows = await query(
      'SELECT raw_polygon FROM submissions WHERE city_id = $1 AND submitter_hash = $2 LIMIT 1',
      [cityId, submitterHash]
    );
    return rows[0] || null;
  } catch (error) {
    console.error('Error loading submission:', error);
    return null;
  }
}

export async function getClippedSubmissionCount(cityId) {
  try {
    const rows = await query(
      'SELECT COUNT(*)::int AS n FROM submissions WHERE city_id = $1 AND clipped_polygon IS NOT NULL',
      [cityId]
    );
    return rows[0]?.n ?? 0;
  } catch (error) {
    console.error('Error counting submissions:', error);
    return 0;
  }
}

export async function getClippedPolygonsForCity(cityId) {
  try {
    const rows = await query(
      'SELECT clipped_polygon FROM submissions WHERE city_id = $1 AND clipped_polygon IS NOT NULL',
      [cityId]
    );
    return rows.map((row) => row.clipped_polygon);
  } catch (error) {
    console.error('Error loading submissions:', error);
    return [];
  }
}

// Persistent heatmap cache: stores just the per-cell vote counts (tiny) so a
// cold instance can rebuild the grid without re-downloading every submission
// polygon from the DB (the main remaining egress source).
let heatmapTableReady = null;
function ensureHeatmapTable() {
  if (!heatmapTableReady) {
    heatmapTableReady = getPool()
      .query(
        `CREATE TABLE IF NOT EXISTS heatmap_cache (
           city_id INTEGER PRIMARY KEY REFERENCES cities(id) ON DELETE CASCADE,
           submission_count INTEGER NOT NULL,
           algo_version INTEGER NOT NULL,
           counts JSONB NOT NULL,
           updated_at TIMESTAMPTZ DEFAULT now()
         )`
      )
      .catch((error) => {
        heatmapTableReady = null;
        throw error;
      });
  }
  return heatmapTableReady;
}

export async function getHeatmapCache(cityId) {
  try {
    await ensureHeatmapTable();
    const rows = await query(
      'SELECT submission_count, algo_version, counts FROM heatmap_cache WHERE city_id = $1',
      [cityId]
    );
    return rows[0] || null;
  } catch (error) {
    console.error('Error reading heatmap cache:', error);
    return null;
  }
}

export async function saveHeatmapCache(cityId, submissionCount, algoVersion, counts) {
  try {
    await ensureHeatmapTable();
    await query(
      `INSERT INTO heatmap_cache (city_id, submission_count, algo_version, counts, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (city_id) DO UPDATE
         SET submission_count = $2, algo_version = $3, counts = $4, updated_at = now()`,
      [cityId, submissionCount, algoVersion, JSON.stringify(counts)]
    );
  } catch (error) {
    console.error('Error writing heatmap cache:', error);
  }
}
