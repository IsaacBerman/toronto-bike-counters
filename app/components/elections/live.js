'use client';

import { useEffect, useState } from 'react';
import { POLLS_CLOSE, isElectionNight, nextCheckDelay } from '../../lib/elections-live';
import { fmt, sum, CANDIDATE_COLORS_2026 } from './results';

export { liveDatasets } from './live-data';

/**
 * Polls /api/election-results while `enabled`: once a minute from poll close,
 * once a day before that (waking at poll close regardless). `feed` only
 * changes identity when the City publishes something new, so the map isn't
 * rebuilt for an unchanged file; `fetchedAt` is when our server last pulled
 * from the City.
 */
export function useLiveResults(enabled) {
  const [feed, setFeed] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let checking = false;
    // When the next check is due. A short local tick compares against the
    // clock instead of trusting one long timer: browsers can fire a timer set
    // hours ahead late after the computer sleeps, which could miss poll close.
    let due = 0;
    const check = async () => {
      if (checking) return;
      checking = true;
      let failed = false;
      try {
        const res = await fetch('/api/election-results');
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        if (cancelled) return;
        setFeed((prev) => (prev && prev.seq === body.seq ? prev : body));
        setFetchedAt(body.fetchedAt);
        setError(null);
      } catch (e) {
        // Keep showing the last good results; the next check retries.
        failed = true;
        if (!cancelled) setError({ message: e.message, at: new Date().toISOString() });
      }
      // A failed check retries within a minute, even in the daily phase.
      due = Date.now() + Math.min(nextCheckDelay(), failed ? 60000 : Infinity);
      checking = false;
    };
    const tick = () => { if (!cancelled && Date.now() >= due) check(); };
    // Coming back to the tab checks straight away if a check came due.
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    check();
    const timer = setInterval(tick, 10 * 1000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', tick);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', tick);
    };
  }, [enabled]);

  return { feed, fetchedAt, error };
}

const TZ = 'America/Toronto';
function clock(ms) {
  const sameDay = new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ }) === new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  return new Date(ms).toLocaleString('en-CA', {
    timeZone: TZ,
    ...(sameDay ? {} : { month: 'short', day: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function ago(seconds) {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// Chow and Bradford's citywide mayoral totals, big enough to read at a glance.
const HEADLINE = ['Olivia Chow', 'Brad Bradford'];

function MayorTotals({ mayor }) {
  const city = new Map();
  for (const ward of Object.values(mayor.wards)) {
    ward.cand.forEach((c, i) => city.set(c, (city.get(c) ?? 0) + ward.totals[i]));
  }
  const total = sum([...city.values()]);
  if (!total) return null;
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-2" style={{ fontVariantNumeric: 'tabular-nums' }}>
      {HEADLINE.map((name) => {
        const votes = city.get(mayor.candidates.indexOf(name)) ?? 0;
        return (
          <div key={name} className="flex items-baseline gap-2">
            <span className="inline-block w-3 h-3 rounded-sm self-center" style={{ background: CANDIDATE_COLORS_2026[name] }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{name.split(' ').slice(-1)[0]}</span>
            <span className="dd-title text-3xl" style={{ color: 'var(--ink)' }}>{((votes / total) * 100).toFixed(1)}%</span>
            <span className="text-xs" style={{ color: 'var(--ink-3)' }}>{fmt(votes)} votes</span>
          </div>
        );
      })}
    </div>
  );
}

// The strip above the live map: what state the night is in, how much is
// counted, Chow and Bradford's totals, and a ticking "last checked".
export function LiveStatus({ data, mayor, fetchedAt, seq, error }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const night = isElectionNight(now);
  const { polls = 0, pollsReceived = 0 } = data?.reporting ?? {};
  const complete = polls > 0 && pollsReceived >= polls;
  const checked = fetchedAt ? Date.parse(fetchedAt) : null;

  return (
    <div className="mb-4 dd-panel p-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {night ? (
          <>
            <p className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--ink)' }}>
              {!complete && <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: '#e34948' }} />}
              {complete ? 'All polls reporting' : 'Unofficial results, counting'}
              <span className="font-normal" style={{ color: 'var(--ink-2)' }}>
                · {fmt(pollsReceived)} of {fmt(polls)} polls reporting
              </span>
            </p>
            <div className="mt-2 h-1.5 rounded-sm w-64 max-w-full" style={{ background: 'var(--paper)' }}>
              <div className="h-full rounded-sm" style={{ width: `${polls ? (pollsReceived / polls) * 100 : 0}%`, background: 'var(--ink)' }} />
            </div>
            {mayor && <div className="mt-3"><MayorTotals mayor={mayor} /></div>}
          </>
        ) : (
          <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
            <span className="font-semibold" style={{ color: 'var(--ink)' }}>Polls close at 8 p.m. on Monday, October 26.</span>{' '}
            Unofficial results will appear here as the City reports them.
          </p>
        )}
      </div>
      <div className="text-xs text-right" style={{ color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
        {checked ? (
          <p>
            Last checked <span style={{ color: 'var(--ink-2)' }}>{clock(checked)}</span> · {ago(Math.max(0, Math.round((now - checked) / 1000)))}
          </p>
        ) : (
          <p>Checking…</p>
        )}
        {night && seq > POLLS_CLOSE && <p>City last published {clock(seq)}</p>}
        {error && <p style={{ color: 'var(--ink-2)' }}>Couldn&rsquo;t reach the City at {clock(Date.parse(error.at))}, retrying</p>}
      </div>
    </div>
  );
}
