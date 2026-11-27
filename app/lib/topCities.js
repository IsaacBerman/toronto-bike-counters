import { unstable_cache } from 'next/cache';
import { getPool } from './db-pool.js';

// The drawing tools have a page for every city anyone has looked up (thousands),
// and nearly all of them have no submissions. Those are thin pages to a search
// engine, so only the most-used cities are left indexable; the rest get
// noindex but still work and can be shared.
export const INDEXED_CITY_LIMIT = 100;

// One query per tool, cached for a day in Next's data cache (shared across
// function instances), so city page views don't wake the database.
const TABLES = {
  downtown: 'submissions',
  live: 'live_submissions',
};

const topSlugs = unstable_cache(
  async (tool) => {
    const { rows } = await getPool().query(
      `SELECT c.slug FROM cities c
       JOIN ${TABLES[tool]} s ON s.city_id = c.id
       GROUP BY c.slug
       ORDER BY COUNT(*) DESC, c.slug
       LIMIT $1`,
      [INDEXED_CITY_LIMIT]
    );
    return rows.map((r) => r.slug);
  },
  ['top-city-slugs'],
  { revalidate: 86400 }
);

/**
 * Robots metadata for a tool's city page: undefined (indexable) for the top
 * cities, noindex for the rest. If the database can't be reached it errs on
 * the side of indexable, so a hiccup never hides the popular cities.
 */
export async function cityRobots(tool, slug) {
  try {
    const slugs = await topSlugs(tool);
    return slugs.includes(slug) ? undefined : { index: false, follow: true };
  } catch (error) {
    console.error(`Top cities lookup failed for ${tool}:`, error);
    return undefined;
  }
}
