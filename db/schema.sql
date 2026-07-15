CREATE TABLE IF NOT EXISTS cities (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT,
  boundary JSONB NOT NULL,
  bbox JSONB NOT NULL,
  osm_type TEXT,
  osm_id TEXT,
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- submitter_hash is the salted hash of the browser's identity cookie (rows
-- from before the cookie-identity switch used a salted IP hash instead).
-- ip_hash is a salted client-IP hash used only for the per-IP submission
-- rate limit, never as identity; it is NULL on pre-switch rows (the app also
-- adds this column lazily via ALTER TABLE ... IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS submissions (
  id SERIAL PRIMARY KEY,
  city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  submitter_hash TEXT NOT NULL,
  raw_polygon JSONB NOT NULL,
  clipped_polygon JSONB,
  ip_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (city_id, submitter_hash)
);

-- Persistent heatmap cache: per-cell vote counts, so the grid can be rebuilt
-- without re-reading every submission polygon.
CREATE TABLE IF NOT EXISTS heatmap_cache (
  city_id INTEGER PRIMARY KEY REFERENCES cities(id) ON DELETE CASCADE,
  submission_count INTEGER NOT NULL,
  algo_version INTEGER NOT NULL,
  counts JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
