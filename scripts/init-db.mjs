import { readFileSync } from 'node:fs';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('Missing DATABASE_URL (or POSTGRES_URL) environment variable.');
  process.exit(1);
}

const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
const client = new pg.Client({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');

await client.connect();
await client.query(schema);
console.log('Database schema is up to date.');
await client.end();
