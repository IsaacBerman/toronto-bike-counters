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

async function query(text, params) {
  const result = await getPool().query(text, params);
  return result.rows;
}

export async function getCities() {
  try {
    return await query('SELECT id, slug, name FROM cities ORDER BY name ASC');
  } catch (error) {
    console.error('Error loading cities:', error);
    return [];
  }
}

export async function getCityBySlug(slug) {
  try {
    const rows = await query('SELECT * FROM cities WHERE slug = $1 LIMIT 1', [slug]);
    return rows[0] || null;
  } catch (error) {
    console.error('Error loading city:', error);
    return null;
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
  if (rows[0]) return rows[0];
  return getCityBySlug(slug);
}

export async function insertSubmission({ cityId, submitterHash, rawPolygon, clippedPolygon }) {
  const rows = await query(
    `INSERT INTO submissions (city_id, submitter_hash, raw_polygon, clipped_polygon)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (city_id, submitter_hash) DO NOTHING
     RETURNING id`,
    [cityId, submitterHash, JSON.stringify(rawPolygon), clippedPolygon ? JSON.stringify(clippedPolygon) : null]
  );
  return rows.length > 0;
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
