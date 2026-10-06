'use client';

import { useMemo, useState } from 'react';
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';

import forecast from './forecast.json';

// A candidate who has ended their campaign is still simulated -- their
// residual ballot share moves the margin -- but they come off the charts and
// the standing. The tables below keep them, because those are the record.
const RUNNING = forecast.candidates.filter(
  (c) => !(forecast.withdrawals ?? {})[c.name],
);

const AXIS_DATE = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' });
const LONG_DATE = new Intl.DateTimeFormat('en-CA', { month: 'long', day: 'numeric', year: 'numeric' });

// Dates in the payload are plain YYYY-MM-DD. Parsing them with `new Date()`
// would read them as UTC midnight and render as the previous day west of
// Greenwich, so they are split by hand.
const parseDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const pct = (value, digits = 1) => `${value.toFixed(digits)}%`;

const winLabel = (p) => {
  if (p >= 0.995) return '>99%';
  if (p <= 0.005 && p > 0) return '<1%';
  return `${Math.round(p * 100)}%`;
};

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div
      className="text-xs rounded px-3 py-2 shadow-sm"
      style={{ background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)' }}
    >
      <div className="font-semibold mb-1">{LONG_DATE.format(parseDay(label))}</div>
      <div style={{ color: 'var(--ink-3)' }} className="mb-1.5">
        {row.forecast
          ? `Projected · ${row.daysOut} days before the vote`
          : `Polling to date · ${row.daysOut} days before the vote`}
      </div>
      {RUNNING.map(({ name, color }) => {
        const c = row[name];
        if (!c) return null;
        return (
          <div key={name} className="flex items-center gap-2 whitespace-nowrap">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
            <span className="w-20">{name}</span>
            <span className="tabular-nums">{pct(c.median)}</span>
            <span className="tabular-nums" style={{ color: 'var(--ink-3)' }}>
              [{c.p5.toFixed(0)}–{c.p95.toFixed(0)}]
            </span>
            <span className="tabular-nums ml-auto pl-2">{winLabel(c.win)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function MayorForecastContent() {
  const [showPolls, setShowPolls] = useState(false);

  const { rows, pivot, latest } = useMemo(() => {
    const data = forecast.track.map((row) => {
      const flat = { date: row.date, daysOut: row.daysOut, forecast: row.forecast };
      forecast.candidates.forEach(({ name }) => {
        const c = row[name];
        flat[name] = c;
        flat[`${name}:band`] = c ? [c.p5, c.p95] : null;
        flat[`${name}:mid`] = c ? c.median : null;
        flat[`${name}:win`] = c ? c.win * 100 : null;
      });
      return flat;
    });
    // The standing is the last point on the charts, not the last polled one.
    // Those differ once something happens after the final poll -- a withdrawal,
    // say -- and the tiles must not disagree with the line above them.
    return {
      rows: data,
      pivot: forecast.lastPollDate,
      latest: data[data.length - 1],
    };
  }, []);


  return (
    <main className="min-h-screen" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <div className="container mx-auto px-4 max-w-5xl py-8">
        <h1 className="dd-title text-3xl sm:text-4xl">2026 Toronto Mayoral projection</h1>

        {/* current standing */}
        <div className="grid gap-3 sm:grid-cols-2 mt-7">
          {RUNNING.map(({ name, color }) => {
            const c = latest?.[name];
            if (!c) return null;
            return (
              <div key={name} className="dd-panel p-4">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-sm" style={{ background: color }} />
                  <span className="font-semibold">{name}</span>
                </div>
                <div className="mt-2 text-3xl font-semibold tabular-nums">{winLabel(c.win)}</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--ink-3)' }}>chance of winning</div>
                <div className="mt-3 text-sm tabular-nums">
                  {pct(c.median)}{' '}
                  <span style={{ color: 'var(--ink-3)' }}>
                    of the vote ({c.p5.toFixed(0)}–{c.p95.toFixed(0)})
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* projected result over time */}
        <section className="mt-10">
          <h2 className="dd-title text-xl">Projected result, as the campaign ran</h2>
          <div className="dd-panel mt-4 p-3 sm:p-4">
            <div style={{ height: 380 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: -18 }}>
                  <CartesianGrid stroke="var(--line)" vertical={false} />
                  <XAxis
                    dataKey="date" tickLine={false} axisLine={{ stroke: 'var(--line)' }}
                    tick={{ fill: 'var(--ink-3)', fontSize: 11 }} minTickGap={28}
                    tickFormatter={(v) => AXIS_DATE.format(parseDay(v))}
                  />
                  <YAxis
                    domain={[25, 60]} ticks={[25, 30, 35, 40, 45, 50, 55, 60]}
                    tickLine={false} axisLine={false}
                    tick={{ fill: 'var(--ink-3)', fontSize: 11 }}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip content={<Tip />} />
                  {RUNNING.map(({ name, color }) => (
                    <Area
                      key={`${name}-band`} dataKey={`${name}:band`} stroke="none"
                      fill={color} fillOpacity={0.16} isAnimationActive={false} connectNulls={false}
                    />
                  ))}
                  {RUNNING.map(({ name, color }) => (
                    <Line
                      key={`${name}-mid`} dataKey={`${name}:mid`} stroke={color} strokeWidth={2}
                      dot={false} isAnimationActive={false} connectNulls={false}
                    />
                  ))}
                  {pivot && (
                    <ReferenceLine
                      x={pivot} stroke="var(--ink-3)" strokeDasharray="4 4"
                      label={{ value: 'latest poll', position: 'insideTopLeft', fill: 'var(--ink-3)', fontSize: 11 }}
                    />
                  )}
                  {(forecast.events ?? []).filter((e) => rows.some((r) => r.date === e.date)).map((e) => (
                    <ReferenceLine
                      key={e.date} x={e.date} stroke="var(--ink-3)"
                      label={{ value: e.label, position: 'insideTopRight', fill: 'var(--ink-3)', fontSize: 11 }}
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        {/* win probability over time */}
        <section className="mt-10">
          <h2 className="dd-title text-xl">Chance of winning, as the campaign ran</h2>
          <div className="dd-panel mt-4 p-3 sm:p-4">
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: -18 }}>
                  <CartesianGrid stroke="var(--line)" vertical={false} />
                  <XAxis
                    dataKey="date" tickLine={false} axisLine={{ stroke: 'var(--line)' }}
                    tick={{ fill: 'var(--ink-3)', fontSize: 11 }} minTickGap={28}
                    tickFormatter={(v) => AXIS_DATE.format(parseDay(v))}
                  />
                  <YAxis
                    domain={[0, 100]} ticks={[0, 25, 50, 75, 100]}
                    tickLine={false} axisLine={false}
                    tick={{ fill: 'var(--ink-3)', fontSize: 11 }}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip content={<Tip />} />
                  <ReferenceLine y={50} stroke="var(--line)" />
                  {RUNNING.map(({ name, color }) => (
                    <Line
                      key={`${name}-win`} dataKey={`${name}:win`} stroke={color} strokeWidth={2}
                      dot={false} isAnimationActive={false} connectNulls={false}
                    />
                  ))}
                  {pivot && <ReferenceLine x={pivot} stroke="var(--ink-3)" strokeDasharray="4 4" />}
                  {(forecast.events ?? []).filter((e) => rows.some((r) => r.date === e.date)).map((e) => (
                    <ReferenceLine key={e.date} x={e.date} stroke="var(--ink-3)" />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        {/* house effects */}
        <section className="mt-10">
          <h2 className="dd-title text-xl">House effects</h2>
          <div className="dd-panel mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <th className="text-left font-semibold px-4 py-2.5">Pollster</th>
                  <th className="text-right font-semibold px-3 py-2.5">Polls</th>
                  {forecast.candidates.map(({ name }) => (
                    <th key={name} className="text-right font-semibold px-4 py-2.5">{name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {forecast.houseEffects.map((row) => (
                  <tr key={row.firm} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td className="px-4 py-2.5">{row.firm}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--ink-3)' }}>
                      {row.polls}
                    </td>
                    {forecast.candidates.map(({ name }) => (
                      <td key={name} className="px-4 py-2.5 text-right tabular-nums">
                        {row[name] == null ? '—'
                          : `${row[name] > 0 ? '+' : ''}${row[name].toFixed(1)}`}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* polls */}
        <section className="mt-10">
          <button
            type="button" className="dd-btn dd-btn-ghost"
            onClick={() => setShowPolls((open) => !open)}
            aria-expanded={showPolls}
          >
            {showPolls ? 'Hide' : 'Show'} the {forecast.polls.length} polls
          </button>
          {showPolls && (
            <div className="dd-panel mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)' }}>
                    <th className="text-left font-semibold px-4 py-2.5">Field dates</th>
                    <th className="text-left font-semibold px-3 py-2.5">Pollster</th>
                    <th className="text-left font-semibold px-3 py-2.5">Method</th>
                    <th className="text-right font-semibold px-3 py-2.5">Sample</th>
                    {forecast.candidates.map(({ name }) => (
                      <th key={name} className="text-right font-semibold px-4 py-2.5">{name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...forecast.polls].reverse().map((poll) => (
                    <tr key={`${poll.firm}-${poll.start}`} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {AXIS_DATE.format(parseDay(poll.start))}
                        {poll.start !== poll.end ? `–${AXIS_DATE.format(parseDay(poll.end))}` : ''}
                      </td>
                      <td className="px-3 py-2.5">{poll.firm}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--ink-3)' }}>{poll.method}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--ink-3)' }}>
                        {poll.n.toLocaleString('en-CA')}
                      </td>
                      {forecast.candidates.map(({ name }) => (
                        <td key={name} className="px-4 py-2.5 text-right tabular-nums">
                          {poll[name] == null ? '—' : `${poll[name]}%`}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="mt-10 text-xs" style={{ color: 'var(--ink-3)' }}>
          Not a prediction anyone should bet on. Poll figures are as published by each firm;
          the model, its assumptions and any errors in them are mine.
        </p>
      </div>
    </main>
  );
}
