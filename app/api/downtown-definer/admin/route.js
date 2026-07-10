import { NextResponse } from 'next/server';
import { Pool } from 'pg';

// TEMPORARY secret-gated maintenance endpoint (gated by IP_HASH_SALT):
//   ?action=migrate            add osm_type/osm_id columns
//   ?action=list               list cities with display_name + submission counts
//   ?action=delete&slug=<slug> delete a city (cascades its submissions)
// Remove this route once cleanup is done.
export async function GET(request) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (!secret || secret !== process.env.IP_HASH_SALT) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    const action = request.nextUrl.searchParams.get('action');

    if (action === 'migrate') {
      await pool.query('ALTER TABLE cities ADD COLUMN IF NOT EXISTS osm_type TEXT');
      await pool.query('ALTER TABLE cities ADD COLUMN IF NOT EXISTS osm_id TEXT');
      return NextResponse.json({ ok: true, migrated: true });
    }

    if (action === 'list') {
      const { rows } = await pool.query(
        `SELECT c.id, c.slug, c.name, c.display_name, c.osm_type, c.osm_id,
                COUNT(s.id)::int AS submissions
         FROM cities c
         LEFT JOIN submissions s ON s.city_id = c.id
         GROUP BY c.id
         ORDER BY c.name`
      );
      return NextResponse.json({ cities: rows });
    }

    if (action === 'delete') {
      const slug = request.nextUrl.searchParams.get('slug');
      if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });
      const { rows } = await pool.query('DELETE FROM cities WHERE slug = $1 RETURNING slug', [slug]);
      return NextResponse.json({ ok: true, deleted: rows.map((r) => r.slug) });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  } finally {
    await pool.end();
  }
}
