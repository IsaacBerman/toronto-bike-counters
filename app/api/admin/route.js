import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { getIngestHealth } from '../../lib/slow-zones/db';
import { buildZoneLayout } from '../../lib/where-would-you-live/zones';
import { zoneIdAt } from '../../lib/where-would-you-live/zoneGrid';

// Admin API — guarded by middleware.js (Basic Auth). GET returns cities +
// stats; POST performs { action: 'delete' | 'merge' }.
export const dynamic = 'force-dynamic';

function makePool() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  return new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
}

const mb = (bytes) => +(Number(bytes) / (1024 * 1024)).toFixed(2);

async function ensureLabelColumn(pool) {
  await pool.query('ALTER TABLE cities ADD COLUMN IF NOT EXISTS label TEXT');
}

export async function GET() {
  const pool = makePool();
  try {
    await ensureLabelColumn(pool);
    const cities = await pool.query(
      `SELECT c.id, c.slug, c.name, c.label, c.osm_id, COUNT(s.id)::int AS submissions
       FROM cities c LEFT JOIN submissions s ON s.city_id = c.id
       GROUP BY c.id ORDER BY submissions DESC, c.name`
    );
    // "Where would you live?" counts, joined in separately so a database that
    // hasn't got that table yet (it's created lazily on first use) still renders
    // the cities list instead of erroring out.
    const liveByCity = new Map();
    try {
      const live = await pool.query(
        'SELECT city_id, COUNT(*)::int AS n FROM live_submissions GROUP BY city_id'
      );
      for (const row of live.rows) liveByCity.set(row.city_id, row.n);
    } catch {
      // table not created yet — every city just reports 0
    }
    for (const city of cities.rows) {
      city.live_submissions = liveByCity.get(city.id) || 0;
    }

    const stats = await pool.query(`
      SELECT pg_database_size(current_database()) AS db_bytes,
             pg_total_relation_size('submissions') AS submissions_bytes,
             (SELECT COUNT(*) FROM submissions) AS submission_count,
             (SELECT COUNT(*) FROM cities) AS city_count
    `);
    const s = stats.rows[0];
    // Slow-zone ingest health is a separate concern from the Downtown data
    // above, and it reads through the slow-zones module's own pool. A failure
    // there shouldn't blank the cities table, so it degrades to an error
    // string in its own section.
    const ingest = await getIngestHealth(25).catch((error) => ({
      error: String(error.message || error),
    }));
    return NextResponse.json({
      cities: cities.rows,
      stats: {
        database_mb: mb(s.db_bytes),
        submissions_mb: mb(s.submissions_bytes),
        submission_count: Number(s.submission_count),
        live_submission_count: [...liveByCity.values()].reduce((total, n) => total + n, 0),
        city_count: Number(s.city_count),
      },
      ingest,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  } finally {
    await pool.end();
  }
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const pool = makePool();
  try {
    if (body.action === 'edit') {
      if (!body.slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });
      await ensureLabelColumn(pool);
      const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null;
      const { rows } = await pool.query(
        'UPDATE cities SET label = $1 WHERE slug = $2 RETURNING slug',
        [label, body.slug]
      );
      if (!rows.length) return NextResponse.json({ error: 'city not found' }, { status: 404 });
      return NextResponse.json({ ok: true, slug: rows[0].slug, label });
    }

    if (body.action === 'delete') {
      if (!body.slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });
      const { rows } = await pool.query('DELETE FROM cities WHERE slug = $1 RETURNING slug', [body.slug]);
      if (!rows.length) return NextResponse.json({ error: 'city not found' }, { status: 404 });
      return NextResponse.json({ ok: true, deleted: rows[0].slug });
    }

    if (body.action === 'merge') {
      const { from, to } = body;
      if (!from || !to || from === to) {
        return NextResponse.json({ error: 'distinct from and to required' }, { status: 400 });
      }
      const ids = await pool.query(
        'SELECT id, slug, boundary, bbox FROM cities WHERE slug = ANY($1)',
        [[from, to]]
      );
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

      // "Where would you live?" answers move too. Without this the source
      // city's delete would cascade them away silently.
      const live = { moved: 0, rehomed: 0, droppedZones: 0 };
      try {
        const liveMoved = await pool.query(
          `UPDATE live_submissions s SET city_id = $1
           WHERE s.city_id = $2
             AND NOT EXISTS (
               SELECT 1 FROM live_submissions t WHERE t.city_id = $1 AND t.submitter_hash = s.submitter_hash
             )
           RETURNING s.id, s.zone_id, s.zone_lng, s.zone_lat`,
          [toCity.id, fromCity.id]
        );
        live.moved = liveMoved.rowCount;

        // A zone_id names a square in the SOURCE city's grid and means nothing
        // in the target's. The stored zone center is a real point, though, so it
        // re-derives to the right square in the target city — and to NULL for
        // anyone whose home falls outside the city they've been merged into.
        // This is exactly why the center is stored beside the id.
        const layout = buildZoneLayout(toCity.boundary, toCity.bbox);
        const inside = new Set(layout.ids);
        const byNewZone = new Map(); // new zone id (or null) -> row ids to set
        for (const row of liveMoved.rows) {
          if (row.zone_lng == null || row.zone_lat == null) continue; // never named a zone
          const derived = zoneIdAt(layout, row.zone_lng, row.zone_lat);
          const next = derived != null && inside.has(derived) ? derived : null;
          if (next == null) live.droppedZones++;
          else live.rehomed++;
          if (next === row.zone_id) continue; // already correct
          if (!byNewZone.has(next)) byNewZone.set(next, []);
          byNewZone.get(next).push(row.id);
        }
        for (const [zoneId, rowIds] of byNewZone) {
          await pool.query('UPDATE live_submissions SET zone_id = $1 WHERE id = ANY($2)', [zoneId, rowIds]);
        }

        await pool.query('DELETE FROM live_submissions WHERE city_id = $1', [fromCity.id]);
        // The target's cached grids were built from a different set of answers.
        // Drop them so the next view rebuilds cleanly from the merged data.
        await pool.query('DELETE FROM live_zone_grids WHERE city_id = $1', [toCity.id]);
        await pool.query('DELETE FROM live_heatmap_cache WHERE city_id = $1', [toCity.id]);
      } catch (error) {
        console.error('Merging live submissions failed:', error);
      }

      await pool.query('DELETE FROM cities WHERE id = $1', [fromCity.id]);
      return NextResponse.json({
        ok: true,
        moved: moved.rowCount,
        movedLive: live.moved,
        zonesRehomed: live.rehomed,
        zonesDropped: live.droppedZones,
        deleted: from,
      });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  } finally {
    await pool.end();
  }
}
