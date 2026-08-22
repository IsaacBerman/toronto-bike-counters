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

-- "Where would you live?": one submission per browser per city, but each
-- submission holds SEVERAL areas (raw_polygons / clipped_polygons are arrays of
-- geometries). `resident` is the visitor's own answer to "do you live within
-- this city's boundaries?", which is what the three result filters split on.
-- The app also creates this table lazily on first use.
CREATE TABLE IF NOT EXISTS live_submissions (
  id SERIAL PRIMARY KEY,
  city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  submitter_hash TEXT NOT NULL,
  resident BOOLEAN NOT NULL,
  raw_polygons JSONB NOT NULL,
  clipped_polygons JSONB,
  -- Optional, and deliberately coarse: the ~2km+ zone the submitter said they
  -- live in, plus that zone square's own center (the same point for everyone who
  -- picks it, not the person's location). No finer location is ever collected.
  zone_id INTEGER,
  zone_lng DOUBLE PRECISION,
  zone_lat DOUBLE PRECISION,
  ip_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (city_id, submitter_hash)
);

-- Both filters share one cell layout, so one row holds both count arrays
-- ({ params, rleIn, rleOut }) and the client derives the "everyone" view by
-- adding them — three maps from a single cached response.
CREATE TABLE IF NOT EXISTS live_heatmap_cache (
  city_id INTEGER PRIMARY KEY REFERENCES cities(id) ON DELETE CASCADE,
  resident_count INTEGER NOT NULL,
  nonresident_count INTEGER NOT NULL,
  algo_version INTEGER NOT NULL,
  counts JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- One destination grid per origin zone, over the same cell layout as the main
-- heatmap, so picking a zone filters the hex map exactly like the resident /
-- non-resident filters do. Rows are created LAZILY: a zone's row is born the
-- first time somebody answers from it and is folded into on every answer after,
-- so a city where nobody named a zone stores nothing at all. layout_sig pins the
-- row to the zone squares it was built against; a mismatch means rebuild rather
-- than serve. The app also creates this table lazily on first use.
CREATE TABLE IF NOT EXISTS live_zone_grids (
  city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  zone_id INTEGER NOT NULL,
  submission_count INTEGER NOT NULL,
  algo_version INTEGER NOT NULL,
  layout_sig TEXT NOT NULL,
  counts JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (city_id, zone_id)
);
