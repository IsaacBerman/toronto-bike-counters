import { query } from './db-pool';
import { HISTORY_UNTIL, LIVE_UNTIL, POLLS_CLOSE } from './elections-live';

// Chow's chance of winning each time the City published new results on
// election night, so the chart under the needle can show the whole night to
// someone who only just arrived. One row per published file (the feed's seq),
// so every edge region recording the same file writes it once.
let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = query(
      `CREATE TABLE IF NOT EXISTS needle_history (
         seq BIGINT PRIMARY KEY,
         p REAL NOT NULL,
         projected REAL NOT NULL,
         share REAL NOT NULL,
         challenger TEXT,
         shares JSONB,
         recorded_at TIMESTAMPTZ DEFAULT now()
       )`
    )
      // The leading candidates' vote shares, as [name, share] pairs, came
      // later; adds the column to a table made before them.
      .then(() => query('ALTER TABLE needle_history ADD COLUMN IF NOT EXISTS shares JSONB'))
      .catch((e) => {
        tableReady = null;
        throw e;
      });
  }
  return tableReady;
}

const toPoints = (rows) => rows.map((r) => [Number(r.seq), r.p, r.share, r.projected, r.shares ?? null]);
const SELECT = 'SELECT seq, p, share, projected, shares FROM needle_history ORDER BY seq';

// After the count settled the history rarely changes, so each server instance
// reads it once and keeps it, and only goes back to the database when a
// late poll actually moves the reading.
let frozen = null;

// Compared loosely, since the database stores readings at lower precision.
const sameReading = (row, needle) => row
  && Math.abs(row[1] - needle.p) < 1e-5
  && Math.abs(row[2] - needle.share) < 1e-5
  && Math.abs(row[3] - needle.projected) < 1e-5;

const INSERT = `INSERT INTO needle_history (seq, p, projected, share, challenger, shares)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (seq) DO NOTHING`;
const insertArgs = (seq, needle) => [seq, needle.p, needle.projected, needle.share, needle.challenger, JSON.stringify(needle.topShares ?? null)];

/**
 * Records this reading (during election night only) and returns the history
 * as [seq, p, share, projected, shares] points, oldest first. Before poll
 * close the database isn't touched at all; after the count settled, only a
 * changed reading is written.
 */
export async function recordNeedle(seq, needle, now = Date.now()) {
  if (now < POLLS_CLOSE) return [];
  if (now >= HISTORY_UNTIL) {
    if (!frozen) frozen = query(SELECT).then(toPoints);
    let points;
    try {
      points = await frozen;
    } catch (e) {
      frozen = null;
      throw e;
    }
    const last = points[points.length - 1];
    if (now < LIVE_UNTIL && needle && !needle.waiting && seq && Number(seq) > (last?.[0] ?? 0) && !sameReading(last, needle)) {
      await query(INSERT, insertArgs(seq, needle));
      frozen = query(SELECT).then(toPoints);
      return frozen;
    }
    return points;
  }
  await ensureTable();
  // A file timestamped before poll close is the City's pre-election one,
  // even if it already carries votes; its time would distort the chart.
  if (needle && !needle.waiting && seq && Number(seq) >= POLLS_CLOSE) {
    await query(INSERT, insertArgs(seq, needle));
  }
  return toPoints(await query(SELECT));
}
