import { NextResponse } from 'next/server';
import { Pool } from 'pg';

// TEMPORARY one-off endpoint to create the DowntownDefiner tables against the
// deployed Neon database (whose connection string is injected at runtime but
// can't be pulled locally because it's marked sensitive). Gated by IP_HASH_SALT.
// Remove this route once the tables exist.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS cities (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT,
  boundary JSONB NOT NULL,
  bbox JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS submissions (
  id SERIAL PRIMARY KEY,
  city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  submitter_hash TEXT NOT NULL,
  raw_polygon JSONB NOT NULL,
  clipped_polygon JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (city_id, submitter_hash)
);
`;

export async function GET(request) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (!secret || secret !== process.env.IP_HASH_SALT) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    return NextResponse.json({ error: 'No database connection string configured.' }, { status: 500 });
  }

  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await pool.query(SCHEMA);
    const tables = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    return NextResponse.json({ ok: true, tables: tables.rows.map((r) => r.table_name) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  } finally {
    await pool.end();
  }
}
