import { NextResponse } from 'next/server';
import { Pool } from 'pg';

// Admin API — guarded by middleware.js (Basic Auth). GET returns cities +
// stats; POST performs { action: 'delete' | 'merge' }.
export const dynamic = 'force-dynamic';

function makePool() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  return new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
}

const mb = (bytes) => +(Number(bytes) / (1024 * 1024)).toFixed(2);

async function ensureLabelColumn(pool) {
  await pool.query('ALTER TABLE cities ADD COLUMN IF NOT EXISTS label TEXT');
}

export async function GET(request) {
  // TEMPORARY (remove after Neon migration): reveal the DB connection strings
  // from the runtime env — they're marked sensitive in Vercel so the dashboard
  // and CLI can't show them, but the deployed function still receives them.
  // Guarded by the same Basic Auth as the rest of the admin API.
  if (request.nextUrl.searchParams.get('action') === 'reveal-db') {
    return NextResponse.json({
      DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED || null,
      POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL_NON_POOLING || null,
      DATABASE_URL: process.env.DATABASE_URL || null,
    });
  }

  const pool = makePool();
  try {
    await ensureLabelColumn(pool);
    const cities = await pool.query(
      `SELECT c.id, c.slug, c.name, c.label, c.osm_id, COUNT(s.id)::int AS submissions
       FROM cities c LEFT JOIN submissions s ON s.city_id = c.id
       GROUP BY c.id ORDER BY submissions DESC, c.name`
    );
    const stats = await pool.query(`
      SELECT pg_database_size(current_database()) AS db_bytes,
             pg_total_relation_size('submissions') AS submissions_bytes,
             (SELECT COUNT(*) FROM submissions) AS submission_count,
             (SELECT COUNT(*) FROM cities) AS city_count
    `);
    const s = stats.rows[0];
    return NextResponse.json({
      cities: cities.rows,
      stats: {
        database_mb: mb(s.db_bytes),
        submissions_mb: mb(s.submissions_bytes),
        submission_count: Number(s.submission_count),
        city_count: Number(s.city_count),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  } finally {
    await pool.end();
  }
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const pool = makePool();
  try {
    if (body.action === 'edit') {
      if (!body.slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });
      await ensureLabelColumn(pool);
      const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null;
      const { rows } = await pool.query(
        'UPDATE cities SET label = $1 WHERE slug = $2 RETURNING slug',
        [label, body.slug]
      );
      if (!rows.length) return NextResponse.json({ error: 'city not found' }, { status: 404 });
      return NextResponse.json({ ok: true, slug: rows[0].slug, label });
    }

    if (body.action === 'delete') {
      if (!body.slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });
      const { rows } = await pool.query('DELETE FROM cities WHERE slug = $1 RETURNING slug', [body.slug]);
      if (!rows.length) return NextResponse.json({ error: 'city not found' }, { status: 404 });
      return NextResponse.json({ ok: true, deleted: rows[0].slug });
    }

    if (body.action === 'merge') {
      const { from, to } = body;
      if (!from || !to || from === to) {
        return NextResponse.json({ error: 'distinct from and to required' }, { status: 400 });
      }
      const ids = await pool.query('SELECT id, slug FROM cities WHERE slug = ANY($1)', [[from, to]]);
      const fromCity = ids.rows.find((r) => r.slug === from);
      const toCity = ids.rows.find((r) => r.slug === to);
      if (!fromCity || !toCity) return NextResponse.json({ error: 'city not found' }, { status: 404 });

      const moved = await pool.query(
        `UPDATE submissions s SET city_id = $1
         WHERE s.city_id = $2
           AND NOT EXISTS (
             SELECT 1 FROM submissions t WHERE t.city_id = $1 AND t.submitter_hash = s.submitter_hash
           )
         RETURNING s.id`,
        [toCity.id, fromCity.id]
      );
      await pool.query('DELETE FROM submissions WHERE city_id = $1', [fromCity.id]);
      await pool.query('DELETE FROM cities WHERE id = $1', [fromCity.id]);
      return NextResponse.json({ ok: true, moved: moved.rowCount, deleted: from });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  } finally {
    await pool.end();
  }
}
