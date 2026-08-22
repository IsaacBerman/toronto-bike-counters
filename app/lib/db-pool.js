import { Pool } from 'pg';

// One shared pg pool for every feature that talks to Postgres. Kept in its own
// module (rather than inside downtown-definer/db.js, where it started) so a
// second feature can't accidentally open a second pool against the same Neon
// compute — more connections is the one thing that reliably keeps the compute
// from suspending.
let pool;

export function getPool() {
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

export async function query(text, params) {
  const result = await getPool().query(text, params);
  return result.rows;
}
