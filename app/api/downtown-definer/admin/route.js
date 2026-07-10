import { NextResponse } from 'next/server';
import { Pool } from 'pg';

// TEMPORARY secret-gated maintenance endpoint (gated by IP_HASH_SALT):
//   ?action=list                        list cities with submission counts
//   ?action=merge&from=<slug>&to=<slug> move submissions from -> to, delete from
//   ?action=delete&slug=<slug>          delete a city (cascades its submissions)
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

    if (action === 'list') {
      const { rows } = await pool.query(
        `SELECT c.id, c.slug, c.name, c.osm_id, COUNT(s.id)::int AS submissions
         FROM cities c LEFT JOIN submissions s ON s.city_id = c.id
         GROUP BY c.id ORDER BY c.name`
      );
      return NextResponse.json({ cities: rows });
    }

    if (action === 'merge') {
      const from = request.nextUrl.searchParams.get('from');
      const to = request.nextUrl.searchParams.get('to');
      if (!from || !to) return NextResponse.json({ error: 'from and to required' }, { status: 400 });
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
