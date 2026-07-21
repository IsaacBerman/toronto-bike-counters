'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LabelList,
  ReferenceLine,
} from 'recharts';
import {
  MODE_GROUPS,
  GROUP_BY_ID,
  GROUP_CONTENTS,
  STACK_ORDER,
  SUSTAINABLE_GROUPS,
  TRANSFORMTO,
  SHORT_BUCKETS,
  wardGroupTotals,
  cityGroupTotals,
  groupSum,
  groupShare,
  groupPercents,
  sustainableShareOf,
  mixHex,
} from '../../lib/tts';

const WardMap = dynamic(() => import('./WardMap'), { ssr: false });

const RAMP_BASE = '#f1efe6'; // near-paper tint the choropleth fades toward at ~0
const SUSTAIN_COLOR = '#0f9d63'; // green for the sustainable / TransformTO ramp
const NEON = '#12e000'; // neon-green outline for wards that hit the 2030 goal
const ACCENT = '#e8590c';
const INK = '#16150f';
const INK2 = '#57554b';
const INK3 = '#8a887c';
const fmt = new Intl.NumberFormat('en-CA');

// "Colour map by" options: the five mode groups plus sustainable (TransformTO).
const COLOR_OPTIONS = [
  { id: 'sustainable', label: 'Sustainable', color: SUSTAIN_COLOR },
  ...MODE_GROUPS.map((g) => ({ id: g.id, label: g.label, color: g.color })),
];

export default function TravelExplorer() {
  const [json, setJson] = useState(null);
  const [geo, setGeo] = useState(null);
  const [cityBoundary, setCityBoundary] = useState(null);
  const [err, setErr] = useState(null);

  const [tripSet, setTripSet] = useState('commute'); // 'all' | 'commute'
  const [colorBy, setColorBy] = useState('sustainable');
  const [year, setYear] = useState(2022);
  const [bucket, setBucket] = useState('under5'); // default to the goal's distance band
  const [ward, setWard] = useState('city'); // 'city' = whole city, or a ward number
  const [lastWard, setLastWard] = useState(13); // most recent ward focus (Toronto Centre default)

  // Selecting a ward remembers it, so un-checking "Entire City" can return to it.
  const selectWard = (w) => {
    setWard(w);
    if (w !== 'city') setLastWard(w);
  };

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('/tts/mode-share.json').then((r) => r.json()),
      fetch('/tts/wards25.geojson').then((r) => r.json()),
      fetch('/tts/city-boundary.geojson').then((r) => r.json()),
    ])
      .then(([d, g, cb]) => {
        if (!alive) return;
        setJson(d);
        setGeo(g);
        setCityBoundary(cb);
      })
      .catch((e) => alive && setErr(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const meta = json?.meta;
  const dataset = json?.datasets?.[tripSet];
  const commute = json?.datasets?.commute;
  const years = meta?.years ?? [];
  const buckets = meta?.buckets ?? [];
  const wardNames = meta?.wardNames ?? {};
  const bucketLabel =
    bucket === 'all'
      ? 'all distances'
      : bucket === 'under5'
        ? 'under 5 km'
        : buckets.find((b) => b.id === bucket)?.label ?? bucket;
  const isCommute = tripSet === 'commute';
  const isCity = ward === 'city';
  // The goal line is only meaningful for the < 5 km bands it's defined on.
  const bucketIsShort = bucket === 'under5' || SHORT_BUCKETS.includes(bucket);
  // The "colour map by" selection is echoed as an outline on the matching
  // segment(s) of the over-time chart.
  const highlightGroups = colorBy === 'sustainable' ? SUSTAINABLE_GROUPS : [colorBy];

  // Group totals for the current subject (a ward, or the whole city).
  const totalsFor = (d, y, w, b) =>
    w === 'city' ? cityGroupTotals(d, y, b) : wardGroupTotals(d, y, w, b);

  // ---- Map fill styling ----
  const wardStyles = useMemo(() => {
    if (!dataset || !geo) return {};
    const wardIds = geo.features.map((f) => f.properties.ward);
    const styles = {};
    if (colorBy === 'sustainable') {
      for (const w of wardIds) {
        const totals = wardGroupTotals(dataset, year, w, bucket);
        const share = sustainableShareOf(totals);
        const t = Math.min(share / 0.8, 1); // absolute scale so colour ~ tracks 75%
        // The 2030 goal is a fixed property of the ward: sustainable share of
        // its under-5 km commute trips — independent of the view's filters.
        const goalShare = commute
          ? sustainableShareOf(wardGroupTotals(commute, year, w, 'under5'))
          : 0;
        const atGoal = goalShare >= TRANSFORMTO.share;
        styles[w] = {
          fillColor: groupSum(totals) > 0 ? mixHex(RAMP_BASE, SUSTAIN_COLOR, t) : '#e9e7de',
          strokeColor: atGoal ? NEON : undefined,
          strokeWeight: atGoal ? 3.5 : undefined,
          label: `<b>${wardNames[w]}</b><br>${(share * 100).toFixed(0)}% sustainable (${bucketLabel})${
            atGoal ? '<br>✓ meets 2030 goal' : ''
          }`,
        };
      }
    } else {
      const g = GROUP_BY_ID[colorBy];
      const shares = {};
      let max = 0;
      for (const w of wardIds) {
        const s = groupShare(dataset, year, w, bucket, colorBy);
        shares[w] = s;
        if (s > max) max = s;
      }
      for (const w of wardIds) {
        const t = max > 0 ? shares[w] / max : 0;
        styles[w] = {
          fillColor: mixHex(RAMP_BASE, g.color, t),
          label: `<b>${wardNames[w]}</b><br>${(shares[w] * 100).toFixed(0)}% ${g.label.toLowerCase()}`,
        };
      }
    }
    return styles;
  }, [dataset, commute, geo, colorBy, year, bucket, bucketLabel, wardNames]);

  // ---- TransformTO tracker (commute, under 5 km, selected year) ----
  const tracker = useMemo(() => {
    if (!commute) return null;
    const city = cityGroupTotals(commute, year, 'under5');
    const share = sustainableShareOf(city);
    const idx = years.indexOf(year);
    const prevYear = idx > 0 ? years[idx - 1] : null;
    const prevShare = prevYear
      ? sustainableShareOf(cityGroupTotals(commute, prevYear, 'under5'))
      : null;
    let atGoal = 0;
    for (const w of Object.keys(commute[year] ?? {})) {
      if (sustainableShareOf(wardGroupTotals(commute, year, w, 'under5')) >= TRANSFORMTO.share)
        atGoal += 1;
    }
    return { share, prevYear, prevShare, atGoal };
  }, [commute, year, years]);

  // ---- Detail panel data (respects tripSet; subject = ward or whole city) ----
  const overTime = useMemo(() => {
    if (!dataset) return [];
    return years.map((y) => {
      const p = groupPercents(totalsFor(dataset, y, ward, bucket));
      return { name: String(y), ...p };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, years, ward, bucket]);

  const byDistance = useMemo(() => {
    if (!dataset) return [];
    return buckets.map((b) => {
      const p = groupPercents(totalsFor(dataset, year, ward, b.id));
      return { name: b.label, ...p };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, buckets, year, ward]);

  const subjectTotals = dataset ? totalsFor(dataset, year, ward, bucket) : null;
  const subjectTripCount = subjectTotals ? groupSum(subjectTotals) : 0;
  // The subject's standing against the 2030 goal (under-5 km commute trips).
  const goalShare = commute ? sustainableShareOf(totalsFor(commute, year, ward, 'under5')) : 0;

  if (err)
    return (
      <div className="container mx-auto px-4 max-w-6xl py-16">
        <p style={{ color: INK2 }}>Could not load the data ({err}).</p>
      </div>
    );
  if (!json || !geo)
    return (
      <div className="container mx-auto px-4 max-w-6xl py-24 text-center">
        <p className="dd-title text-xl" style={{ color: INK2 }}>
          Loading Toronto travel data…
        </p>
      </div>
    );

  return (
    <div style={{ background: 'var(--paper)' }}>
      <div className="container mx-auto px-4 max-w-6xl py-8 sm:py-12">
        {/* Intro */}
        <h1 className="dd-title text-4xl sm:text-5xl mb-4" style={{ color: INK }}>
          TransformTO Tracking
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed mb-8" style={{ color: INK2 }}>
          Data from the Transportation Tomorrow Survey. Track progress toward{' '}
          <b style={{ color: INK }}>TransformTO</b>, the City&rsquo;s goal of{' '}
          <b style={{ color: INK }}>
            75% of work and school trips under 5 km by walking, cycling or transit by 2030
          </b>
          .
        </p>

        {/* TransformTO tracker */}
        {tracker && <TransformTracker tracker={tracker} year={year} />}

        {/* Controls */}
        <div className="dd-panel-ruled p-4 sm:p-5 mt-6 grid gap-5 md:grid-cols-2">
          <Control label="Trips">
            <Segmented
              options={[
                { id: 'all', label: 'All trips' },
                { id: 'commute', label: 'Commute (work / school)' },
              ]}
              value={tripSet}
              onChange={setTripSet}
            />
          </Control>
          <Control label="Survey year">
            <Segmented
              options={years.map((y) => ({ id: y, label: String(y) }))}
              value={year}
              onChange={setYear}
            />
          </Control>
          <Control label="Colour map by">
            <div className="flex flex-wrap gap-1.5">
              {COLOR_OPTIONS.map((o) => (
                <Swatch
                  key={o.id}
                  active={colorBy === o.id}
                  color={o.color}
                  label={o.label}
                  onClick={() => setColorBy(o.id)}
                />
              ))}
            </div>
          </Control>
          <Control label="Trip distance">
            <Segmented
              options={[
                { id: 'all', label: 'All' },
                { id: 'under5', label: '< 5 km ★' },
                ...buckets.map((b) => ({ id: b.id, label: b.label })),
              ]}
              value={bucket}
              onChange={setBucket}
            />
          </Control>
        </div>

        {/* Map + detail */}
        <div className="grid lg:grid-cols-2 gap-5 mt-6">
          <div className="dd-panel p-3">
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
                {isCity ? 'Click a ward to focus it' : 'Click the map or a ward to change focus'}
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
            <div className="flex items-center justify-between flex-wrap gap-2 mt-3 px-1">
              <p className="text-xs" style={{ color: INK3 }}>
                {colorBy === 'sustainable'
                  ? `Shaded by walk + cycle + transit share · neon-green outline = meets 2030 goal`
                  : `Shaded by ${GROUP_BY_ID[colorBy].label.toLowerCase()} share (darkest = highest)`}
              </p>
              <p className="text-xs font-semibold" style={{ color: INK3 }}>
                {year} · {bucketLabel}
              </p>
            </div>
          </div>

          {/* Ward / city detail */}
          <div className="dd-panel-ruled p-5">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h2 className="dd-title text-2xl" style={{ color: INK }}>
                {isCity ? 'Entire City' : wardNames[ward]}
              </h2>
              <span className="text-xs font-bold" style={{ color: INK3 }}>
                {isCity ? 'CITY OF TORONTO' : `WARD ${ward}`}
              </span>
            </div>
            <p className="text-xs mt-1 mb-4" style={{ color: INK3 }}>
              {fmt.format(Math.round(subjectTripCount))} {isCommute ? 'work/school' : ''} trips ·{' '}
              {year} · {bucketLabel}
            </p>

            {isCommute && <WardGoalBadge share={goalShare} city={isCity} />}

            <ChartBlock
              title={`Mode share over time`}
              subtitle={`${isCommute ? 'Work & school trips' : 'All trips'} · ${bucketLabel}`}
            >
              <StackedShareChart
                data={overTime}
                goal={isCommute && bucketIsShort}
                highlight={highlightGroups}
                highlightColor={colorBy === 'sustainable' ? NEON : INK}
              />
            </ChartBlock>

            <ChartBlock
              title="Mode share by trip distance"
              subtitle={`${isCommute ? 'Work & school trips' : 'All trips'} · ${year}`}
            >
              <StackedShareChart
                data={byDistance}
                goal={false}
                angledTicks
                highlight={highlightGroups}
                highlightColor={colorBy === 'sustainable' ? NEON : INK}
              />
            </ChartBlock>

            <Legend />
          </div>
        </div>

        {/* Source */}
        <p className="text-xs mt-6 leading-relaxed" style={{ color: INK3 }}>
          Source: Transportation Tomorrow Survey (Data Management Group, University of Toronto),
          2001–2022. Wards use the current 25-ward model; 2001–2016 counts are apportioned from the
          former 44-ward model by area-weighted crosswalk, so pre-2022 ward figures are estimates.
          &ldquo;Sustainable&rdquo; = walking, cycling (incl. e-mobility) and transit.
        </p>
      </div>
    </div>
  );
}

/* ---------------- Sub-components ---------------- */

function TransformTracker({ tracker, year }) {
  const { share, prevYear, prevShare, atGoal } = tracker;
  const pct = share * 100;
  const goalPct = TRANSFORMTO.share * 100;
  const progress = Math.min(share / TRANSFORMTO.share, 1) * 100;
  const delta = prevShare != null ? (share - prevShare) * 100 : null;
  const hit = share >= TRANSFORMTO.share;
  return (
    <div className="dd-panel-ruled p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="dd-kicker mb-1">TransformTO Tracker · {year}</p>
          <div className="flex items-baseline gap-3">
            <span className="dd-title text-5xl" style={{ color: hit ? SUSTAIN_COLOR : INK }}>
              {pct.toFixed(1)}%
            </span>
            {delta != null && (
              <span
                className="text-sm font-bold"
                style={{ color: delta >= 0 ? '#006300' : '#b4342f' }}
              >
                {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)} pts vs {prevYear}
              </span>
            )}
          </div>
          <p className="text-sm mt-1" style={{ color: INK2 }}>
            of work &amp; school trips <b style={{ color: INK }}>under 5 km</b> by walking, cycling
            or transit — goal is <b style={{ color: INK }}>75% by 2030</b>
          </p>
        </div>
        <div className="text-right">
          <span className="dd-title text-4xl" style={{ color: INK }}>
            {atGoal}
            <span className="text-xl" style={{ color: INK3 }}>
              /25
            </span>
          </span>
          <p className="text-xs mt-1" style={{ color: INK2 }}>
            wards already at the goal
          </p>
        </div>
      </div>
      {/* Progress bar */}
      <div className="mt-4">
        <div className="relative h-3 rounded-full overflow-hidden" style={{ background: '#e2e0d6' }}>
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${progress}%`, background: SUSTAIN_COLOR }}
          />
        </div>
        <div className="flex justify-between mt-1 text-xs" style={{ color: INK3 }}>
          <span>0%</span>
          <span style={{ color: ACCENT, fontWeight: 700 }}>2030 target · {goalPct}%</span>
        </div>
      </div>
    </div>
  );
}

function WardGoalBadge({ share, city }) {
  const hit = share >= TRANSFORMTO.share;
  const pct = (share * 100).toFixed(0);
  return (
    <div
      className="flex items-center gap-2 mb-4 px-3 py-2 rounded"
      style={{
        background: hit ? 'rgba(15,157,99,0.10)' : 'rgba(232,89,12,0.08)',
        border: `1px solid ${hit ? 'rgba(15,157,99,0.35)' : 'rgba(232,89,12,0.25)'}`,
      }}
    >
      <span className="text-sm font-bold" style={{ color: hit ? SUSTAIN_COLOR : ACCENT }}>
        {hit ? '✓' : '→'}
      </span>
      <span className="text-sm" style={{ color: INK2 }}>
        <b style={{ color: INK }}>{pct}%</b> of {city ? "the city's " : ''}under-5 km commutes
        sustainable —{' '}
        {hit ? 'meets the 2030 goal' : `${(75 - share * 100).toFixed(0)} pts below the 75% goal`}
      </span>
    </div>
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
      <div style={{ width: '100%', height: 210 }}>
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </div>
  );
}

function StackedShareChart({ data, goal, angledTicks, highlight = [], highlightColor = INK }) {
  return (
    <BarChart data={data} margin={{ top: 4, right: goal ? 48 : 8, bottom: angledTicks ? 18 : 4, left: 0 }}>
      <XAxis
        dataKey="name"
        tick={{ fill: INK3, fontSize: 11 }}
        stroke="#c3c2b7"
        interval={0}
        angle={angledTicks ? -30 : 0}
        textAnchor={angledTicks ? 'end' : 'middle'}
        height={angledTicks ? 40 : 20}
      />
      <YAxis
        domain={[0, 100]}
        ticks={[0, 25, 50, 75, 100]}
        tickFormatter={(v) => `${v}%`}
        tick={{ fill: INK3, fontSize: 11 }}
        stroke="#c3c2b7"
        width={36}
      />
      <Tooltip content={<ShareTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
      {goal && (
        <ReferenceLine
          y={75}
          stroke={ACCENT}
          strokeDasharray="5 4"
          strokeWidth={1.5}
          label={{ value: 'Goal', position: 'right', fill: ACCENT, fontSize: 10, fontWeight: 700 }}
        />
      )}
      {STACK_ORDER.map((gid) => {
        const g = GROUP_BY_ID[gid];
        const on = highlight.includes(gid);
        // Outer edges of the highlighted band: bottom edge on its lowest group,
        // top edge on its highest — never the internal boundaries between them.
        const drawBottom = on && gid === highlight[0];
        const drawTop = on && gid === highlight[highlight.length - 1];
        return (
          <Bar
            key={gid}
            dataKey={gid}
            stackId="s"
            fill={g.color}
            isAnimationActive={false}
            shape={on ? <HighlightSeg color={highlightColor} top={drawTop} bottom={drawBottom} /> : undefined}
          >
            <LabelList
              dataKey={gid}
              position="center"
              formatter={(v) => (v >= 9 ? `${Math.round(v)}` : '')}
              style={{ fill: '#fff', fontSize: 10, fontWeight: 700 }}
            />
          </Bar>
        );
      })}
    </BarChart>
  );
}

// Custom bar shape for a highlighted segment: the normal fill plus a coloured
// border on its left/right sides, and the top/bottom edge only when this
// segment is the top/bottom of the highlighted band. Edges are inset by half
// the stroke width so the next stacked segment can't paint over them.
function HighlightSeg({ x, y, width, height, fill, color, top, bottom }) {
  const w = 2.5;
  const i = w / 2;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} />
      <line x1={x + i} y1={y} x2={x + i} y2={y + height} stroke={color} strokeWidth={w} />
      <line x1={x + width - i} y1={y} x2={x + width - i} y2={y + height} stroke={color} strokeWidth={w} />
      {top && <line x1={x} y1={y + i} x2={x + width} y2={y + i} stroke={color} strokeWidth={w} />}
      {bottom && (
        <line x1={x} y1={y + height - i} x2={x + width} y2={y + height - i} stroke={color} strokeWidth={w} />
      )}
    </g>
  );
}

function ShareTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const rows = STACK_ORDER.map((gid) => {
    const g = GROUP_BY_ID[gid];
    const entry = payload.find((p) => p.dataKey === gid);
    return { g, val: entry?.value ?? 0 };
  }).filter((r) => r.val >= 0.5);
  return (
    <div
      className="rounded p-2.5 text-xs"
      style={{ background: 'var(--panel)', border: '1px solid #e2e0d6', boxShadow: '0 4px 14px rgba(0,0,0,0.1)' }}
    >
      <p className="font-bold mb-1" style={{ color: INK }}>
        {label}
      </p>
      {rows.map(({ g, val }) => (
        <div key={g.id} className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: g.color }} />
          <span style={{ color: INK2 }}>{g.label}</span>
          <span className="ml-auto font-bold tabular-nums" style={{ color: INK }}>
            {val.toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
      {MODE_GROUPS.map((g) => (
        <span key={g.id} className="inline-flex items-center gap-1.5 text-xs" title={GROUP_CONTENTS[g.id]} style={{ color: INK2 }}>
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: g.color }} />
          {g.label}
        </span>
      ))}
    </div>
  );
}
