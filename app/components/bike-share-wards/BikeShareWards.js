'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  DATA_NOTES,
  DOWNTOWN,
  WARD_COUNT,
  buildWardProfiles,
  fetchLiveMonths,
  fetchWardData,
} from '../../lib/bikeshareWards';
import { mixHex } from '../../lib/tts';

const WardMap = dynamic(() => import('../toronto-travel/WardMap'), { ssr: false });

const RAMP_BASE = '#f1efe6'; // near-paper tint the choropleth fades toward at ~0
const ACCENT = '#e8590c';
const INK = '#16150f';
const INK2 = '#57554b';
const INK3 = '#8a887c';
const CLASSIC = '#1b6fb8';
const ELECTRIC = '#0f9d63';
const fmt = new Intl.NumberFormat('en-CA');
const int = (v) => fmt.format(Math.round(v));
const compact = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : int(v));
const NO_WARDS = []; // stable empty reference for the pre-load render

// ?ward=13 -> 13, anything else -> 'city'. A ward number that isn't one of the
// 25 is treated as no selection rather than left to miss the profile lookup.
function wardFromSearch(search) {
  const raw = new URLSearchParams(search).get('ward');
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= WARD_COUNT ? n : 'city';
}

// The five ways to shade the map. `year` marks the ones that move with the year
// selector; density and spacing describe the network as it stands today.
const METRICS = [
  {
    id: 'density',
    label: 'Stations per km²',
    color: ELECTRIC,
    get: (w) => w.density,
    format: (v) => v.toFixed(2),
    log: true,
  },
  {
    id: 'spacing',
    label: 'Spacing between docks',
    color: CLASSIC,
    get: (w) => w.medianSpacing,
    format: (v) => `${Math.round(v)} m`,
    // A short walk to the next dock is the good end, so the ramp runs backwards.
    invert: true,
  },
  {
    id: 'trips',
    label: 'Trips started',
    color: ACCENT,
    get: (w, y) => w.byYear.find((r) => r.year === y)?.trips ?? 0,
    format: int,
    year: true,
    log: true,
  },
  {
    id: 'stations',
    label: 'Stations active',
    color: '#7a4fb5',
    get: (w, y) => w.byYear.find((r) => r.year === y)?.stations ?? 0,
    format: int,
    year: true,
  },
  {
    id: 'ebike',
    label: 'E-bike share',
    color: '#b5892f',
    get: (w, y) => {
      const r = w.byYear.find((x) => x.year === y);
      if (!r || r.electric == null || !(r.classic + r.electric)) return null;
      return (100 * r.electric) / (r.classic + r.electric);
    },
    format: (v) => `${v.toFixed(1)}%`,
    year: true,
  },
];

/**
 * The ward profile. Standalone it owns its own ?ward= param; embedded in the
 * bike-counters page it is handed `ward` and `onSelectWard` instead, because
 * that page already owns the query string and two writers would fight over it.
 */
export default function BikeShareWards({ embedded = false, ward: controlledWard, onSelectWard }) {
  const controlled = typeof onSelectWard === 'function';
  const [geo, setGeo] = useState(null);
  const [cityBoundary, setCityBoundary] = useState(null);
  const [profiles, setProfiles] = useState(null);
  const [err, setErr] = useState(null);

  const [metricId, setMetricId] = useState('density');
  const [year, setYear] = useState(null);
  const [grain, setGrain] = useState('year'); // 'year' | 'month'
  const [internalWard, setInternalWard] = useState('city');
  const ward = controlled ? (controlledWard ?? 'city') : internalWard;
  const [lastWard, setLastWard] = useState(13); // Toronto Centre, the densest ward

  // The selected ward lives in the URL as ?ward=13, so one ward's profile can be
  // linked to directly. Mount reads it, popstate follows the back button, and
  // selectWard pushes each change.
  useEffect(() => {
    if (controlled) return undefined;
    const readUrl = () => wardFromSearch(window.location.search);
    const apply = (w) => {
      setInternalWard(w);
      if (w !== 'city') setLastWard(w);
    };
    apply(readUrl());
    const onPop = () => apply(readUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [controlled]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('/tts/wards25.geojson').then((r) => r.json()),
      fetch('/tts/city-boundary.geojson').then((r) => r.json()),
      fetchWardData(),
    ])
      .then(async ([g, cb, data]) => {
        if (!alive) return;
        setGeo(g);
        setCityBoundary(cb);
        // Render the archive immediately, then top it up: the live tail is a
        // handful of extra requests and shouldn't hold the page hostage.
        const archiveOnly = buildWardProfiles({ data, geo: g });
        setProfiles(archiveOnly);
        setYear(archiveOnly.lastFullYear);
        const live = await fetchLiveMonths(data.cutoff).catch(() => []);
        if (!alive || !live.length) return;
        setProfiles(buildWardProfiles({ data, geo: g, live }));
      })
      .catch((e) => alive && setErr(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, []);

  const selectWard = (w) => {
    if (w !== 'city') setLastWard(w);
    if (controlled) {
      onSelectWard(w);
      return;
    }
    setInternalWard(w);
    const url = new URL(window.location.href);
    if (w === 'city') url.searchParams.delete('ward');
    else url.searchParams.set('ward', String(w));
    // Only a real change earns a history entry, or clicking the ward you are
    // already on would stack up entries that Back has to walk through.
    if (url.href !== window.location.href) window.history.pushState({ ward: w }, '', url);
  };

  const metric = METRICS.find((m) => m.id === metricId) ?? METRICS[0];
  const isCity = ward === 'city';
  // Kept referentially stable so the memos below don't recompute every render.
  const rows = useMemo(() => profiles?.wards ?? NO_WARDS, [profiles]);
  const selected = isCity ? null : profiles?.byWard.get(ward);

  // Choropleth fill. Ridership and density span two orders of magnitude across
  // the city, so those ramps are logarithmic — on a linear ramp every ward
  // outside the core collapses into the same near-empty tint.
  const wardStyles = useMemo(() => {
    if (!rows.length) return null;
    const vals = rows.map((w) => metric.get(w, year)).filter((v) => v != null && Number.isFinite(v));
    if (!vals.length) return null;
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const norm = (v) => {
      if (hi === lo) return 1;
      if (metric.log) {
        const l = (x) => Math.log10(Math.max(x, 1e-6) + 1);
        return (l(v) - l(lo)) / (l(hi) - l(lo));
      }
      return (v - lo) / (hi - lo);
    };
    const styles = {};
    for (const w of rows) {
      const v = metric.get(w, year);
      const t = v == null || !Number.isFinite(v) ? 0 : norm(v);
      styles[w.ward] = {
        fillColor: mixHex(RAMP_BASE, metric.color, 0.12 + 0.88 * (metric.invert ? 1 - t : t)),
        label: `<b>${w.name}</b><br/>${metric.label}: ${
          v == null ? 'not recorded' : metric.format(v)
        }${metric.year ? ` · ${year}` : ''}`,
      };
    }
    return styles;
  }, [rows, metric, year]);

  const scatter = useMemo(
    () =>
      rows.map((w) => ({
        ward: w.ward,
        name: w.name,
        x: w.kmFromDowntown,
        y: w.density,
        spacing: w.medianSpacing,
        stations: w.stations,
      })),
    [rows]
  );

  const spacingRanked = useMemo(
    () =>
      [...rows]
        .filter((w) => w.medianSpacing != null)
        .sort((a, b) => a.medianSpacing - b.medianSpacing)
        .map((w) => ({ ward: w.ward, name: w.name, spacing: Math.round(w.medianSpacing) })),
    [rows]
  );

  // E-bike share per ward for the selected year, highest first. Only 2024 on
  // has a bike model at all, so this falls back to the most recent year that
  // does rather than rendering 25 empty bars.
  const ebikeYear = useMemo(() => {
    const has = (y) =>
      rows.some((w) => {
        const r = w.byYear.find((x) => x.year === y);
        return r && r.electric != null && r.classic + r.electric > 0;
      });
    if (has(year)) return year;
    return [...(profiles?.years ?? [])].reverse().find(has) ?? null;
  }, [rows, year, profiles]);

  const ebikeRanked = useMemo(() => {
    if (ebikeYear == null) return [];
    return rows
      .map((w) => {
        const r = w.byYear.find((x) => x.year === ebikeYear);
        const total = r ? (r.classic ?? 0) + (r.electric ?? 0) : 0;
        if (!r || r.electric == null || !total) return null;
        return {
          ward: w.ward,
          name: w.name,
          share: (100 * r.electric) / total,
          electric: r.electric,
          classic: r.classic,
          km: w.kmFromDowntown,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.share - a.share);
  }, [rows, ebikeYear]);

  const cityEbikeShare = useMemo(() => {
    if (!ebikeRanked.length) return null;
    const e = ebikeRanked.reduce((a, r) => a + r.electric, 0);
    const c = ebikeRanked.reduce((a, r) => a + r.classic, 0);
    return e + c ? (100 * e) / (e + c) : null;
  }, [ebikeRanked]);

  if (err)
    return (
      <Shell embedded={embedded}>
        <div className="dd-panel-ruled p-5">
          <p className="text-sm" style={{ color: INK }}>
            <b>Could not load the ward data.</b>
          </p>
          <p className="text-sm mt-2" style={{ color: INK2 }}>
            {err}. This page reads <code>/bikeshare-wards.json</code>, built from the City&rsquo;s
            ridership archives by <code>build_bikeshare_wards.py</code> in the dash.raccoon.bike
            repo. If the file is missing, run that script to generate it.
          </p>
        </div>
      </Shell>
    );

  if (!profiles || !geo || year == null)
    return (
      <Shell embedded={embedded}>
        <p className="text-sm" style={{ color: INK2 }}>
          Loading Bike Share ward data…
        </p>
      </Shell>
    );

  const city = profiles.city;
  const source = isCity ? city : selected;
  const series = grain === 'year' ? source.byYear : source.monthly;
  const yearRow = source.byYear.find((r) => r.year === year);
  // Only the rows where a bike model was recorded, with the e-bike share
  // precomputed so the bar labels don't recompute it per render.
  const modelSeries = series
    .filter((r) => r.electric != null && r.classic + r.electric > 0)
    .map((r) => ({ ...r, share: (100 * r.electric) / (r.classic + r.electric) }));
  const hasModel = modelSeries.length > 0;

  return (
    <Shell embedded={embedded}>
      {!embedded && (
        <h1 className="dd-title text-4xl sm:text-5xl mb-8" style={{ color: INK }}>
          Bike Share by Ward
        </h1>
      )}

      <div className="dd-panel-ruled p-4 sm:p-5 grid gap-4 sm:grid-cols-4">
        <Stat label="Stations placed" value={int(city.stations)} note="across all 25 wards" />
        <Stat
          label="Median gap to next dock"
          value={`${Math.round(city.medianSpacing)} m`}
          note="citywide"
        />
        <Stat
          label={`Trips started, ${year}`}
          value={compact(yearRowCity(city, year)?.trips ?? 0)}
          note={
            yearRowCity(city, year)?.estimatedMonths > 0
              ? `${yearRowCity(city, year).estimatedMonths} of ${yearRowCity(city, year).months} months estimated`
              : yearRowCity(city, year)?.partial
                ? 'year still in progress'
                : 'full year'
          }
        />
        <Stat
          label="Density range"
          value={`${Math.round(
            Math.max(...rows.map((w) => w.density)) / Math.min(...rows.map((w) => w.density))
          )}×`}
          note="densest ward vs sparsest"
        />
      </div>

      <div className="dd-panel-ruled p-4 sm:p-5 mt-6 grid gap-5 md:grid-cols-2">
        <Control label="Colour map by">
          <div className="flex flex-wrap gap-1.5">
            {METRICS.map((m) => (
              <Swatch
                key={m.id}
                active={metricId === m.id}
                color={m.color}
                label={m.label}
                onClick={() => setMetricId(m.id)}
              />
            ))}
          </div>
        </Control>
        <Control label="Year">
          <Segmented
            options={profiles.years.map((y) => ({
              id: y,
              label: y === profiles.currentYear ? `${y}*` : String(y),
            }))}
            value={year}
            onChange={setYear}
          />
          <p className="text-xs mt-2 leading-relaxed" style={{ color: INK3 }}>
            {metric.year ? (
              <>Shading follows the selected year.</>
            ) : (
              <>
                <b style={{ color: INK2 }}>{metric.label}</b> describes the network as it stands
                today, so the year does not change the map — it still drives the charts below.
              </>
            )}{' '}
            The archive ends at {profiles.cutoff}.
          </p>
        </Control>
      </div>

      <div className="grid lg:grid-cols-2 gap-5 mt-6">
        <div className="dd-panel p-3 self-start">
          <div className="flex items-center justify-between gap-2 mb-2 px-1">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isCity}
                onChange={(e) => selectWard(e.target.checked ? 'city' : lastWard)}
                className="h-4 w-4"
                style={{ accentColor: INK }}
              />
              <span className="text-xs font-bold" style={{ color: isCity ? INK : INK2 }}>
                Entire City
              </span>
            </label>
            <p className="text-xs" style={{ color: INK3 }}>
              {isCity ? 'Click a ward to profile it' : 'Click the map to change ward'}
            </p>
          </div>
          <WardMap
            geo={geo}
            cityBoundary={cityBoundary}
            citySelected={isCity}
            wardStyles={wardStyles}
            selectedWard={ward}
            onSelectWard={selectWard}
            className="h-[440px] sm:h-[520px] w-full rounded"
          />
          <p className="text-xs mt-3 px-1" style={{ color: INK3 }}>
            Shaded by {metric.label.toLowerCase()}
            {metric.invert ? ' (darkest = docks closest together)' : ' (darkest = highest)'}
            {metric.log ? ' · logarithmic ramp' : ''}
          </p>
        </div>

        <div className="dd-panel-ruled p-5">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="dd-title text-2xl" style={{ color: INK }}>
              {isCity ? 'Entire City' : selected.name}
            </h2>
            <span className="text-xs font-bold" style={{ color: INK3 }}>
              {isCity ? 'CITY OF TORONTO' : `WARD ${ward}`}
            </span>
          </div>
          <p className="text-xs mt-1 mb-4" style={{ color: INK3 }}>
            {int(yearRow?.stations ?? 0)} stations · {int(yearRow?.trips ?? 0)} trips started ·{' '}
            {year}
            {yearRow?.partial ? ` (${yearRow.months} months)` : ''}
            {yearRow?.estimatedMonths > 0 && (
              <>
                {' · '}
                <span style={{ color: ACCENT }}>
                  {yearRow.estimatedMonths} month{yearRow.estimatedMonths === 1 ? '' : 's'}{' '}
                  estimated
                </span>
              </>
            )}
          </p>

          {!isCity && (
            <>
              <div className="flex flex-wrap gap-1.5 mb-5">
                <Rank label="Density" rank={selected.rank.density} of={selected.rank.of} />
                <Rank label="Tightest spacing" rank={selected.rank.spacing} of={selected.rank.of} />
                <Rank label="Trips" rank={selected.rank.trips} of={selected.rank.of} />
              </div>
              <div className="grid grid-cols-3 gap-3 mb-5">
                <Stat
                  label="Stations"
                  value={int(selected.stations)}
                  note={`${selected.density.toFixed(2)} per km²`}
                  small
                />
                <Stat
                  label="Median gap"
                  value={`${Math.round(selected.medianSpacing)} m`}
                  note={`city ${Math.round(city.medianSpacing)} m`}
                  small
                />
                <Stat
                  label="Trips per station"
                  value={selected.tripsPerStation ? int(selected.tripsPerStation) : '—'}
                  note={String(selected.latestFull.year)}
                  small
                />
              </div>
            </>
          )}

          <div className="mb-4">
            <Segmented
              options={[
                { id: 'year', label: 'By year' },
                { id: 'month', label: 'By month' },
              ]}
              value={grain}
              onChange={setGrain}
            />
          </div>

          <ChartBlock
            title="Trips started"
            subtitle={grain === 'year' ? 'Departures per year' : 'Departures per month'}
          >
            {grain === 'year' ? (
              <BarChart data={series} margin={{ top: 14, right: 4, bottom: 0, left: 4 }}>
                <XAxis dataKey="year" tick={{ fontSize: 10, fill: INK3 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip content={<SeriesTooltip field="trips" unit="trips" />} cursor={false} />
                <Bar isAnimationActive={false} dataKey="trips" radius={[3, 3, 0, 0]}>
                  {series.map((r) => (
                    <Cell key={r.year} fill={r.partial ? mixHex(RAMP_BASE, ACCENT, 0.45) : ACCENT} />
                  ))}
                  <LabelList
                    dataKey="trips"
                    position="top"
                    formatter={compact}
                    style={{ fontSize: 9, fill: INK3, fontWeight: 700 }}
                  />
                </Bar>
              </BarChart>
            ) : (
              <AreaChart data={series} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 9, fill: INK3 }}
                  axisLine={false}
                  tickLine={false}
                  interval={11}
                  tickFormatter={(m) => m.slice(0, 4)}
                />
                <YAxis hide />
                <Tooltip content={<SeriesTooltip field="trips" unit="trips" />} cursor={false} />
                {profiles.estimatedMonths.length > 0 && (
                  <ReferenceLine
                    x={profiles.archiveCutoff}
                    stroke={INK3}
                    strokeDasharray="2 2"
                    label={{ value: 'archive ends', position: 'insideTopRight', fontSize: 9, fill: INK3 }}
                  />
                )}
                <Area isAnimationActive={false} dataKey="trips" stroke={ACCENT} fill={mixHex(RAMP_BASE, ACCENT, 0.35)} strokeWidth={1.5} />
              </AreaChart>
            )}
          </ChartBlock>

          <ChartBlock
            title="Stations active"
            subtitle={grain === 'year' ? 'Peak docks in service that year' : 'Docks that started a trip'}
          >
            {grain === 'year' ? (
              <BarChart data={series} margin={{ top: 14, right: 4, bottom: 0, left: 4 }}>
                <XAxis dataKey="year" tick={{ fontSize: 10, fill: INK3 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip content={<SeriesTooltip field="stations" unit="stations" />} cursor={false} />
                <Bar isAnimationActive={false} dataKey="stations" radius={[3, 3, 0, 0]}>
                  {series.map((r) => (
                    <Cell key={r.year} fill={r.partial ? mixHex(RAMP_BASE, '#7a4fb5', 0.45) : '#7a4fb5'} />
                  ))}
                  <LabelList dataKey="stations" position="top" style={{ fontSize: 9, fill: INK3, fontWeight: 700 }} />
                </Bar>
              </BarChart>
            ) : (
              <AreaChart data={series} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 9, fill: INK3 }}
                  axisLine={false}
                  tickLine={false}
                  interval={11}
                  tickFormatter={(m) => m.slice(0, 4)}
                />
                <YAxis hide />
                <Tooltip content={<SeriesTooltip field="stations" unit="stations" />} cursor={false} />
                <Area isAnimationActive={false} dataKey="stations" stroke="#7a4fb5" fill={mixHex(RAMP_BASE, '#7a4fb5', 0.35)} strokeWidth={1.5} />
              </AreaChart>
            )}
          </ChartBlock>

          {hasModel && (
            <ChartBlock
              title="Classic against e-bike"
              subtitle="The archive records a bike model only from 2024"
            >
              {/* Only three years carry a bike model, which is too few to read
                  as an area — bars there, and the shape only once the monthly
                  view gives it enough points to be a shape. */}
              {grain === 'year' ? (
                <BarChart data={modelSeries} margin={{ top: 14, right: 8, bottom: 0, left: 8 }}>
                  <XAxis dataKey="year" tick={{ fontSize: 10, fill: INK3 }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip content={<ModelTooltip />} cursor={false} />
                  <Bar isAnimationActive={false} dataKey="classic" stackId="m" fill={CLASSIC} />
                  <Bar isAnimationActive={false} dataKey="electric" stackId="m" fill={ELECTRIC} radius={[3, 3, 0, 0]}>
                    <LabelList
                      dataKey="share"
                      position="top"
                      formatter={(v) => `${v.toFixed(0)}% e`}
                      style={{ fontSize: 9, fill: INK3, fontWeight: 700 }}
                    />
                  </Bar>
                </BarChart>
              ) : (
                <AreaChart data={modelSeries} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 9, fill: INK3 }}
                    axisLine={false}
                    tickLine={false}
                    interval={5}
                  />
                  <YAxis hide />
                  <Tooltip content={<ModelTooltip />} cursor={false} />
                  <Area isAnimationActive={false} dataKey="classic" stackId="m" stroke={CLASSIC} fill={CLASSIC} fillOpacity={0.75} strokeWidth={0} />
                  <Area isAnimationActive={false} dataKey="electric" stackId="m" stroke={ELECTRIC} fill={ELECTRIC} fillOpacity={0.75} strokeWidth={0} />
                </AreaChart>
              )}
            </ChartBlock>
          )}

          <p className="text-xs leading-relaxed" style={{ color: INK3 }}>
            Trips are counted where they started. Docks retired before the station feed recorded
            them cannot be placed, which costs the early years:{' '}
            {city.byYear
              .filter((r) => r.placed < 0.98)
              .map((r) => `${r.year} ${(r.placed * 100).toFixed(0)}%`)
              .join(' · ') || 'over 98% placed throughout'}
            .
          </p>
        </div>
      </div>

      <div className="dd-panel-ruled p-5 mt-6">
        <h2 className="dd-title text-2xl mb-1" style={{ color: INK }}>
          Station spacing by ward
        </h2>
        <p className="text-sm mb-4" style={{ color: INK3 }}>
          Average spacing between docks
        </p>
        <div style={{ width: '100%', height: 25 * 23 + 30 }}>
          <ResponsiveContainer>
            <BarChart data={spacingRanked} layout="vertical" margin={{ top: 0, right: 46, bottom: 0, left: 4 }}>
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={168}
                tick={{ fontSize: 10, fill: INK2 }}
                axisLine={false}
                tickLine={false}
              />
              <ReferenceLine
                x={city.medianSpacing}
                stroke={INK3}
                strokeDasharray="3 3"
                label={{ value: 'city median', position: 'top', fontSize: 10, fill: INK3 }}
              />
              <Tooltip
                cursor={false}
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <TooltipBox>
                      <b>{payload[0].payload.name}</b>
                      <br />
                      {payload[0].value} m to the nearest dock
                    </TooltipBox>
                  ) : null
                }
              />
              <Bar isAnimationActive={false} dataKey="spacing" radius={[0, 3, 3, 0]} onClick={(d) => selectWard(d.ward)} cursor="pointer">
                {spacingRanked.map((r) => (
                  <Cell key={r.ward} fill={r.ward === ward ? INK : CLASSIC} />
                ))}
                <LabelList
                  dataKey="spacing"
                  position="right"
                  formatter={(v) => `${v} m`}
                  style={{ fontSize: 10, fill: INK3, fontWeight: 700 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {ebikeRanked.length > 0 && (
        <div className="dd-panel-ruled p-5 mt-6">
          <h2 className="dd-title text-2xl mb-1" style={{ color: INK }}>
            E-bike share by ward
          </h2>
          <p className="text-sm mb-4" style={{ color: INK3 }}>
            Share of the ward&rsquo;s trips taken on an e-bike, {ebikeYear}
          </p>
          <div style={{ width: '100%', height: ebikeRanked.length * 23 + 30 }}>
            <ResponsiveContainer>
              <BarChart data={ebikeRanked} layout="vertical" margin={{ top: 0, right: 46, bottom: 0, left: 4 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={168}
                  tick={{ fontSize: 10, fill: INK2 }}
                  axisLine={false}
                  tickLine={false}
                />
                {cityEbikeShare != null && (
                  <ReferenceLine
                    x={cityEbikeShare}
                    stroke={INK3}
                    strokeDasharray="3 3"
                    label={{ value: 'city average', position: 'top', fontSize: 10, fill: INK3 }}
                  />
                )}
                <Tooltip
                  cursor={false}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload;
                    return (
                      <TooltipBox>
                        <b>{p.name}</b>
                        <br />
                        {p.share.toFixed(1)}% of trips on an e-bike
                        <br />
                        {int(p.electric)} e-bike · {int(p.classic)} classic
                        <br />
                        {p.km.toFixed(1)} km from {DOWNTOWN.label}
                      </TooltipBox>
                    );
                  }}
                />
                <Bar isAnimationActive={false} dataKey="share" radius={[0, 3, 3, 0]} onClick={(d) => selectWard(d.ward)} cursor="pointer">
                  {ebikeRanked.map((r) => (
                    <Cell key={r.ward} fill={r.ward === ward ? INK : ELECTRIC} />
                  ))}
                  <LabelList
                    dataKey="share"
                    position="right"
                    formatter={(v) => `${v.toFixed(1)}%`}
                    style={{ fontSize: 10, fill: INK3, fontWeight: 700 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {ebikeYear !== year && (
            <p className="text-xs mt-3" style={{ color: INK3 }}>
              {year} records no bike model, so this shows {ebikeYear} — the most recent year that
              does. The archive first distinguishes classic from e-bike in 2024.
            </p>
          )}
        </div>
      )}

      <div className="dd-panel-ruled p-5 mt-6">
        <h2 className="dd-title text-2xl mb-4" style={{ color: INK }}>
          Station density by distance from downtown
        </h2>
        <div style={{ width: '100%', height: 340 }}>
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 8, right: 16, bottom: 30, left: 4 }}>
              <XAxis
                type="number"
                dataKey="x"
                tick={{ fontSize: 11, fill: INK3 }}
                tickFormatter={(v) => `${v} km`}
                label={{
                  value: `Ward centre, distance from ${DOWNTOWN.label}`,
                  position: 'insideBottom',
                  offset: -18,
                  fontSize: 11,
                  fill: INK3,
                }}
              />
              <YAxis
                type="number"
                dataKey="y"
                tick={{ fontSize: 11, fill: INK3 }}
                label={{ value: 'Stations per km²', angle: -90, position: 'insideLeft', fontSize: 11, fill: INK3 }}
              />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload;
                  return (
                    <TooltipBox>
                      <b>{p.name}</b>
                      <br />
                      {p.y.toFixed(2)} stations per km²
                      <br />
                      {p.stations} docks · {Math.round(p.spacing)} m apart
                      <br />
                      {p.x.toFixed(1)} km from {DOWNTOWN.label}
                    </TooltipBox>
                  );
                }}
              />
              <Scatter isAnimationActive={false} data={scatter} onClick={(d) => selectWard(d.ward)} cursor="pointer">
                {scatter.map((p) => (
                  <Cell key={p.ward} fill={p.ward === ward ? INK : ELECTRIC} r={p.ward === ward ? 8 : 5} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      <p className="text-xs mt-6 leading-relaxed" style={{ color: INK3 }}>
        {DATA_NOTES[0]} Built {profiles.generated}, covering {profiles.months[0]} to{' '}
        {profiles.cutoff}.
      </p>
    </Shell>
  );
}

// City rows carry no `year` key collision with ward rows, but the city series is
// built separately, so this keeps the lookup in one place.
function yearRowCity(city, year) {
  return city.byYear.find((r) => r.year === year);
}

function Shell({ children, embedded }) {
  if (embedded) return <>{children}</>;
  return (
    <div style={{ background: 'var(--paper)', minHeight: '70vh' }}>
      <div className="container mx-auto px-4 max-w-6xl pt-4 pb-8 sm:pb-12">{children}</div>
    </div>
  );
}

function Stat({ label, value, note, small = false }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide" style={{ color: INK3 }}>
        {label}
      </p>
      <p className={small ? 'dd-title text-xl' : 'dd-title text-3xl'} style={{ color: INK }}>
        {value}
      </p>
      {note && (
        <p className="text-xs" style={{ color: INK3 }}>
          {note}
        </p>
      )}
    </div>
  );
}

function Rank({ label, rank, of }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold"
      style={{ background: '#e9e7de', color: INK2 }}
    >
      {label}
      <b style={{ color: INK }}>
        #{rank}
        <span style={{ color: INK3, fontWeight: 600 }}> / {of}</span>
      </b>
    </span>
  );
}

function Control({ label, children }) {
  return (
    <div>
      <p className="dd-kicker mb-2" style={{ color: INK3 }}>
        {label}
      </p>
      {children}
    </div>
  );
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="inline-flex flex-wrap gap-1 p-1 rounded" style={{ background: '#e9e7de' }}>
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className="px-2.5 py-1.5 rounded text-xs font-bold transition-colors"
            style={{
              background: active ? 'var(--panel)' : 'transparent',
              color: active ? INK : INK2,
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Swatch({ active, color, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-bold transition-all"
      style={{
        background: active ? 'var(--panel)' : '#e9e7de',
        color: active ? INK : INK2,
        border: `1.5px solid ${active ? color : 'transparent'}`,
      }}
    >
      <span className="inline-block h-3 w-3 rounded-sm" style={{ background: color }} />
      {label}
    </button>
  );
}

function ChartBlock({ title, subtitle, children }) {
  return (
    <div className="mb-5">
      <h3 className="text-sm font-bold" style={{ color: INK }}>
        {title}
      </h3>
      <p className="text-xs mb-2" style={{ color: INK3 }}>
        {subtitle}
      </p>
      <div style={{ width: '100%', height: 180 }}>
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </div>
  );
}

function TooltipBox({ children }) {
  return (
    <div
      className="dd-panel px-2.5 py-1.5 text-xs"
      style={{ color: INK2, boxShadow: '0 4px 12px rgba(0,0,0,0.10)' }}
    >
      {children}
    </div>
  );
}

function SeriesTooltip({ active, payload, field, unit }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <TooltipBox>
      <b style={{ color: INK }}>{row.month ?? row.year}</b>
      {row.partial ? ` (${row.months} months)` : ''}
      <br />
      {int(row[field])} {unit}
      {(row.estimated || row.estimatedMonths > 0) && (
        <>
          <br />
          <span style={{ color: ACCENT }}>
            {row.estimatedMonths > 0 && !row.estimated
              ? `${row.estimatedMonths} of ${row.months} months estimated from the live feed`
              : 'estimated from the live feed'}
          </span>
        </>
      )}
      {row.placed != null && row.placed < 0.98 && (
        <>
          <br />
          {(row.placed * 100).toFixed(0)}% of trips placeable
        </>
      )}
    </TooltipBox>
  );
}

function ModelTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  const total = (r.classic ?? 0) + (r.electric ?? 0);
  return (
    <TooltipBox>
      <b style={{ color: INK }}>{r.month ?? r.year}</b>
      <br />
      <span style={{ color: CLASSIC }}>■</span> Classic {int(r.classic ?? 0)}
      <br />
      <span style={{ color: ELECTRIC }}>■</span> E-bike {int(r.electric ?? 0)}
      {total > 0 && ` (${((100 * (r.electric ?? 0)) / total).toFixed(0)}%)`}
    </TooltipBox>
  );
}
