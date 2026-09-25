'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import IntersectionModeChart from './IntersectionModeChart';
import { MODES, peakTotals, fullTotals, sum, fmt, fmtDate, isModeOn, describeModes } from './modes';

// Leaflet plus six thousand pies is the heaviest thing on the page; keep it out
// of the bundle until the browser is actually drawing it.
const IntersectionMap = dynamic(() => import('./IntersectionMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full rounded flex items-center justify-center" style={{ height: 560, background: 'var(--paper)' }}>
      <p className="text-sm" style={{ color: 'var(--ink-3)' }}>Loading map…</p>
    </div>
  ),
});

const SINCE_OPTIONS = [
  { value: 2020, label: 'Counted since 2020' },
  { value: 2010, label: 'Counted since 2010' },
  { value: 2000, label: 'Counted since 2000' },
  { value: 0, label: 'All counts since 1984' },
];

export default function IntersectionCountsContent() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [since, setSince] = useState(2020);
  const [metric, setMetric] = useState('volume'); // 'volume' | 'share'
  const [win, setWin] = useState('peak'); // 'peak' | 'full'
  // Which modes the map and chart are showing. Empty means all of them — see
  // isModeOn — so the default state needs no special case.
  const [pickedModes, setPickedModes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const router = useRouter();
  const searchParams = useSearchParams();
  const initialId = useRef(searchParams.get('at'));
  const chartRef = useRef(null);
  // Only a click on the map should pull the page down to the chart; restoring a
  // shared link or a back-button hop should not.
  const scrollOnNextSelect = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/tmc-counts.json')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        const wanted = d.intersections.find((i) => i.id === initialId.current);
        setSelectedId(wanted ? wanted.id : d.intersections[0]?.id ?? null);
      })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (selectedId) router.replace(`?at=${encodeURIComponent(selectedId)}`, { scroll: false });
  }, [selectedId, router]);

  const shown = useMemo(() => {
    if (!data) return [];
    if (!since) return data.intersections;
    return data.intersections.filter((i) => Number(i.counts[0][0].slice(0, 4)) >= since);
  }, [data, since]);

  const selected = useMemo(
    () => data?.intersections.find((i) => i.id === selectedId) ?? null,
    [data, selectedId]
  );

  const handleSelect = useCallback((id) => {
    scrollOnNextSelect.current = true;
    setSelectedId(id);
  }, []);

  // Turning off the last picked mode lands back on the empty list, which is the
  // show-everything state — so a reader can never filter the map down to
  // nothing at all.
  const handleToggleMode = useCallback((key) => {
    setPickedModes((picked) =>
      picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key]
    );
  }, []);

  const handleShowAllModes = useCallback(() => setPickedModes([]), []);

  useEffect(() => {
    if (!scrollOnNextSelect.current || !selected) return;
    scrollOnNextSelect.current = false;
    chartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selected]);

  if (error) {
    return (
      <div className="min-h-screen pt-10" style={{ background: 'var(--paper)' }}>
        <div className="container mx-auto px-4 max-w-7xl">
          <div className="dd-panel p-6">
            <p style={{ color: 'var(--ink-2)' }}>Could not load the count data ({error}).</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--paper)' }}>
        <p className="text-xl font-sans" style={{ color: 'var(--ink-2)' }}>
          Loading intersection counts…
        </p>
      </div>
    );
  }

  const totalCounts = data.intersections.reduce((s, i) => s + i.counts.length, 0);

  return (
    <div className="min-h-screen pt-4 pb-10" style={{ background: 'var(--paper)' }}>
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="mb-4">
          <h1 className="dd-title text-4xl sm:text-5xl mb-2" style={{ color: 'var(--ink)' }}>
            Toronto Intersection Counts
          </h1>
        </div>

        <div className="mb-4 dd-panel-ruled p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <label htmlFor="sinceSelect" className="dd-kicker" style={{ color: 'var(--ink-2)' }}>
              Show
            </label>
            <select
              id="sinceSelect"
              value={since}
              onChange={(e) => setSince(Number(e.target.value))}
              className="dd-select"
            >
              {SINCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="dd-panel-ruled p-4 sm:p-6">
          <IntersectionMap
            intersections={shown}
            selectedId={selectedId}
            onSelect={handleSelect}
            pickedModes={pickedModes}
            onToggleMode={handleToggleMode}
            onShowAllModes={handleShowAllModes}
          />
        </div>

        <div ref={chartRef} className="mt-6 scroll-mt-4">
          {selected ? (
            <div className="dd-panel overflow-hidden">
              <div className="p-4 flex flex-wrap items-end justify-between gap-3" style={{ borderBottom: '1px solid var(--line)' }}>
                <div>
                  <h2 className="dd-title text-xl" style={{ color: 'var(--ink)' }}>
                    {selected.name}
                  </h2>
                  <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
                    {selected.counts.length === 1
                      ? `One count, ${fmtDate(selected.counts[0][0])}`
                      : `${selected.counts.length} counts, ${selected.counts[selected.counts.length - 1][0].slice(0, 4)}–${selected.counts[0][0].slice(0, 4)}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="flex items-center gap-2">
                    <label htmlFor="metricSelect" className="dd-kicker" style={{ color: 'var(--ink-2)' }}>
                      Show
                    </label>
                    <select
                      id="metricSelect"
                      value={metric}
                      onChange={(e) => setMetric(e.target.value)}
                      className="dd-select"
                    >
                      <option value="volume">Counts</option>
                      <option value="share">Share</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <label htmlFor="windowSelect" className="dd-kicker" style={{ color: 'var(--ink-2)' }}>
                      Window
                    </label>
                    <select
                      id="windowSelect"
                      value={win}
                      onChange={(e) => setWin(e.target.value)}
                      className="dd-select"
                    >
                      <option value="peak">Peak hours (comparable)</option>
                      <option value="full">Whole count</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="p-4">
                <IntersectionModeChart
                  intersection={selected}
                  metric={metric}
                  window={win}
                  pickedModes={pickedModes}
                  onToggleMode={handleToggleMode}
                />
                <LatestSplit intersection={selected} win={win} picked={pickedModes} />
                <p className="text-xs mt-4 leading-relaxed" style={{ color: 'var(--ink-3)' }}>
                  {win === 'peak' ? (
                    <>
                      Bars cover {data.peakWindow.label} — the {data.peakWindow.hours} hours every
                      count in the City&rsquo;s export shares, so counts from different years line
                      up. Most counts run 8 hours in all and the rest run 14; switch to{' '}
                      <b>Whole count</b> to see each count&rsquo;s full total instead.
                    </>
                  ) : (
                    <>
                      Bars cover each count&rsquo;s whole duration, which is <b>not</b> the same
                      from count to count — most run 8 hours, some run 14, and a taller bar can
                      simply mean a longer count. Switch to <b>Peak hours</b> to compare like
                      with like.
                    </>
                  )}{' '}
                  Pedestrians and cyclists are counted per approach; cars, trucks and buses per
                  turning movement.
                  {pickedModes.length > 0 && (
                    <>
                      {' '}Showing {describeModes(pickedModes)} only — shares stay out of
                      everything counted, so they will not add up to 100%.
                    </>
                  )}
                </p>
              </div>
            </div>
          ) : (
            <div className="dd-panel p-6 text-center">
              <p style={{ color: 'var(--ink-3)' }}>Click an intersection on the map to chart it.</p>
            </div>
          )}
        </div>

        <div className="mt-8 dd-panel p-6">
          <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
            Turning movement counts from the{' '}
            <a
              href="https://open.toronto.ca/dataset/traffic-volumes-at-intersections-for-all-modes/"
              target="_blank"
              rel="noopener noreferrer"
              className="dd-link-accent"
            >
              City of Toronto Open Data Portal
            </a>
            . {fmt(totalCounts)} counts at {fmt(data.intersections.length)} intersections,
            1984 to {data.intersections[0]?.counts[0][0].slice(0, 4)}. Counts are one-off
            surveys.
          </p>
        </div>
      </div>
    </div>
  );
}

// The most recent count as plain numbers under the chart — the reader who wants
// the value rather than the bar, and the table view the colour encoding owes.
function LatestSplit({ intersection, win, picked }) {
  const latest = intersection.counts[0];
  const values = win === 'full' ? fullTotals(latest) : peakTotals(latest);
  const total = sum(values);
  return (
    <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--line)' }}>
      <p className="dd-kicker mb-2" style={{ color: 'var(--ink-2)' }}>
        Most recent count · {fmtDate(latest[0])} · {latest[1]} hours
      </p>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {MODES.map((mode, i) => (
          <div
            key={mode.key}
            className="flex items-center gap-2"
            style={{ opacity: isModeOn(picked, mode.key) ? 1 : 0.45 }}
          >
            <span
              className="inline-block rounded-full shrink-0"
              style={{ width: 10, height: 10, background: mode.color }}
            />
            <div>
              <div className="text-xs" style={{ color: 'var(--ink-3)' }}>{mode.label}</div>
              <div className="text-base font-semibold" style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                {fmt(values[i])}
                <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--ink-3)' }}>
                  {total ? `${Math.round((values[i] / total) * 100)}%` : '0%'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
