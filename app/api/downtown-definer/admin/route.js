import { NextResponse } from 'next/server';
import { Pool } from 'pg';

// TEMPORARY secret-gated read-only stats endpoint (gated by IP_HASH_SALT):
//   ?action=size  -> database + table sizes and row counts
// Remove this route once done.
export async function GET(request) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (!secret || secret !== process.env.IP_HASH_SALT) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    if (request.nextUrl.searchParams.get('action') === 'size') {
      const { rows } = await pool.query(`
        SELECT
          pg_database_size(current_database()) AS db_bytes,
          pg_total_relation_size('submissions') AS submissions_bytes,
          pg_total_relation_size('cities') AS cities_bytes,
          (SELECT COUNT(*) FROM submissions) AS submission_count,
          (SELECT COUNT(*) FROM cities) AS city_count
      `);
      const r = rows[0];
      const mb = (b) => +(Number(b) / (1024 * 1024)).toFixed(3);
      return NextResponse.json({
        database_mb: mb(r.db_bytes),
        submissions_mb: mb(r.submissions_bytes),
        cities_mb: mb(r.cities_bytes),
        submission_count: Number(r.submission_count),
        city_count: Number(r.city_count),
      });
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  } finally {
    await pool.end();
  }
}
