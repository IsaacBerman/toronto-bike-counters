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

CREATE TABLE IF NOT EXISTS submissions (
  id SERIAL PRIMARY KEY,
  city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  submitter_hash TEXT NOT NULL,
  raw_polygon JSONB NOT NULL,
  clipped_polygon JSONB,
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
