'use client';

import { useEffect, useState } from 'react';

export const dynamic = 'force-dynamic';

// Matches the site's default display: title-case, trimmed at the 2nd comma.
function deriveDisplay(name) {
  const parts = (name || '').split(',');
  const trimmed = parts.length > 2 ? parts.slice(0, 2).join(',') : name || '';
  return trimmed
    .toLowerCase()
    .split(/(\s|-)/)
    .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join('');
}

function formatStamp(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// The two crons are ~6h and ~18h apart, so anything past a day without a
// capture means both of a day's attempts went missing — the failure mode that
// went unnoticed for three days in August 2026.
const STALE_AFTER_HOURS = 26;

function hoursSince(ts) {
  return ts ? (Date.now() - new Date(ts).getTime()) / 36e5 : null;
}

// Slow-zone ingest health. Two questions, in order of how often they matter:
// is the record current, and what did the recent runs actually do. A run that
// never happened leaves no row, so the missing-days list is the part that
// catches a cron that stopped firing — the log alone can't show an absence.
function IngestPanel({ ingest, cell }) {
  if (!ingest) return null;
  if (ingest.error) {
    return (
      <div className="dd-panel" style={{ padding: '14px', marginBottom: '18px' }}>
        <p className="dd-kicker" style={{ marginBottom: '8px' }}>Slow-zone ingest</p>
        <p style={{ fontSize: '13px', color: 'var(--accent)' }}>Could not load: {ingest.error}</p>
      </div>
    );
  }

  const { runs = [], missingDays = [], lastSnapshot } = ingest;
  const age = hoursSince(lastSnapshot?.captured_at);
  const stale = age == null || age > STALE_AFTER_HOURS;

  return (
    <div className="dd-panel" style={{ padding: '14px', marginBottom: '18px' }}>
      <p className="dd-kicker" style={{ marginBottom: '8px' }}>Slow-zone ingest</p>

      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', fontSize: '14px', marginBottom: '10px' }}>
        <span>
          Latest snapshot <strong>{lastSnapshot?.day || 'none'}</strong>
          {lastSnapshot?.zone_total != null && <> · {lastSnapshot.zone_total} zones</>}
        </span>
        <span style={{ color: stale ? 'var(--accent)' : 'var(--ink-2)' }}>
          captured <strong>{formatStamp(lastSnapshot?.captured_at)}</strong>
          {age != null && <> ({Math.round(age)}h ago)</>}
          {stale && ' — stale, check the cron'}
        </span>
        <span style={{ color: 'var(--ink-2)' }}>TTC page said {lastSnapshot?.as_of || '—'}</span>
      </div>

      {missingDays.length > 0 && (
        <p style={{ fontSize: '13px', color: 'var(--accent)', marginBottom: '10px' }}>
          <strong>{missingDays.length} day{missingDays.length === 1 ? '' : 's'} with no snapshot:</strong>{' '}
          <span style={{ fontFamily: 'monospace' }}>{missingDays.join(', ')}</span>
        </p>
      )}

      {runs.length === 0 ? (
        <p style={{ fontSize: '13px', color: 'var(--ink-3)' }}>
          No runs logged yet — the run log starts recording from its first ingest after deploy.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Ran at', 'Source', 'Result', 'Day', 'TTC as of', 'Rows', 'Zones', 'ms'].map((h) => (
                  <th key={h} style={{ ...cell, fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((r, i) => (
                <tr key={`${r.ran_at}-${i}`}>
                  <td style={cell}>{formatStamp(r.ran_at)}</td>
                  <td style={{ ...cell, color: 'var(--ink-2)' }}>{r.source}</td>
                  <td style={{ ...cell, color: r.ok ? 'var(--ink)' : 'var(--accent)' }}>
                    {r.ok ? 'ok' : `failed: ${r.error || 'unknown'}`}
                  </td>
                  <td style={{ ...cell, fontFamily: 'monospace' }}>{r.day || '—'}</td>
                  <td style={{ ...cell, color: 'var(--ink-2)' }}>{r.as_of || '—'}</td>
                  <td style={cell}>{r.row_count ?? '—'}</td>
                  <td style={cell}>{r.zone_total ?? '—'}</td>
                  <td style={{ ...cell, color: 'var(--ink-3)' }}>{r.duration_ms ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [mergeFrom, setMergeFrom] = useState('');
  const [mergeTo, setMergeTo] = useState('');
  const [notice, setNotice] = useState(null);
  const [drafts, setDrafts] = useState({});

  async function load() {
    setError(null);
    try {
      const res = await fetch('/api/admin', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      setData(await res.json());
    } catch (e) {
      setError(String(e.message || e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function act(body, confirmMsg) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Action failed');
      setNotice(JSON.stringify(json));
      await load();
    } catch (e) {
      setNotice(`Error: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  const cities = data?.cities || [];
  const f = filter.trim().toLowerCase();
  const shown = f
    ? cities.filter((c) => c.slug.includes(f) || (c.name || '').toLowerCase().includes(f))
    : cities;

  const cell = { padding: '6px 10px', borderBottom: '1px solid var(--line)', textAlign: 'left', fontSize: '13px' };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)', padding: '32px 16px' }}>
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>
        <h1 className="dd-title" style={{ fontSize: '28px', color: 'var(--ink)', marginBottom: '4px' }}>
          Admin
        </h1>
        <p style={{ color: 'var(--ink-2)', fontSize: '14px', marginBottom: '20px' }}>
          Where is Downtown — cities & submissions · slow-zone ingest health
        </p>

        {error && <p style={{ color: 'var(--accent)' }}>{error}</p>}

        {data && (
          <>
            <div className="dd-panel" style={{ padding: '14px', marginBottom: '18px', display: 'flex', gap: '24px', flexWrap: 'wrap', fontSize: '14px' }}>
              <span><strong>{data.stats.city_count}</strong> cities</span>
              <span><strong>{data.stats.submission_count}</strong> submissions</span>
              <span>DB <strong>{data.stats.database_mb} MB</strong></span>
              <span>submissions table <strong>{data.stats.submissions_mb} MB</strong></span>
            </div>

            <IngestPanel ingest={data.ingest} cell={cell} />

            <div className="dd-panel" style={{ padding: '14px', marginBottom: '18px' }}>
              <p className="dd-kicker" style={{ marginBottom: '8px' }}>Merge (moves submissions, deletes source)</p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <input className="dd-input" placeholder="from slug" value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)} />
                <span style={{ color: 'var(--ink-3)' }}>→</span>
                <input className="dd-input" placeholder="to slug" value={mergeTo} onChange={(e) => setMergeTo(e.target.value)} />
                <button
                  className="dd-btn dd-btn-primary"
                  disabled={busy || !mergeFrom.trim() || !mergeTo.trim()}
                  onClick={() => act({ action: 'merge', from: mergeFrom.trim(), to: mergeTo.trim() }, `Merge ${mergeFrom} → ${mergeTo}?`)}
                >
                  Merge
                </button>
              </div>
            </div>

            {notice && (
              <p style={{ fontSize: '13px', color: 'var(--ink-2)', marginBottom: '12px', fontFamily: 'monospace' }}>{notice}</p>
            )}

            <input
              className="dd-input"
              placeholder="Filter cities…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ width: '100%', maxWidth: '360px', marginBottom: '12px' }}
            />

            <div className="dd-panel" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...cell, fontWeight: 700 }}>Name (stored)</th>
                    <th style={{ ...cell, fontWeight: 700 }}>Display name (shown to users)</th>
                    <th style={{ ...cell, fontWeight: 700 }}>Slug</th>
                    <th style={{ ...cell, fontWeight: 700 }}>Subs</th>
                    <th style={{ ...cell, fontWeight: 700 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <tr key={c.id}>
                      <td style={cell}>{c.name}</td>
                      <td style={cell}>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <input
                            className="dd-input"
                            style={{ fontSize: '13px', padding: '4px 8px', width: '180px' }}
                            placeholder={deriveDisplay(c.name)}
                            value={drafts[c.slug] ?? c.label ?? ''}
                            onChange={(e) => setDrafts((d) => ({ ...d, [c.slug]: e.target.value }))}
                          />
                          <button
                            className="dd-btn dd-btn-primary"
                            disabled={busy}
                            onClick={() =>
                              act({ action: 'edit', slug: c.slug, label: drafts[c.slug] ?? c.label ?? '' })
                            }
                          >
                            Save
                          </button>
                        </div>
                      </td>
                      <td style={{ ...cell, fontFamily: 'monospace', color: 'var(--ink-2)' }}>{c.slug}</td>
                      <td style={cell}>{c.submissions}</td>
                      <td style={cell}>
                        <button
                          className="dd-btn dd-btn-ghost"
                          disabled={busy}
                          onClick={() => act({ action: 'delete', slug: c.slug }, `Delete "${c.name}" and its ${c.submissions} submission(s)? This cannot be undone.`)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
