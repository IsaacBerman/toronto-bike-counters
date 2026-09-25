'use client';

import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { MODES, peakTotals, fullTotals, sum, fmt, fmtDate } from './modes';

const INK = '#16150f';
const INK3 = '#8a887c';
const GRID = '#e2e0d6';
const SURFACE = '#ffffff';

// Stacked segments are separated by a gap in the surface colour rather than an
// outline, and the top of each bar — the only free end in a stack — carries the
// 4px rounded data-end. Anything shorter than the gap is drawn solid, since
// trimming it would erase the segment.
function StackSegment(props) {
  const { x, y, width, height, fill, payload, modeKey } = props;
  if (!(height > 0)) return null;
  const gap = height > 3 ? 2 : 0;
  const h = height - gap;
  const rounded = payload?.topKey === modeKey && h > 5;
  const r = rounded ? Math.min(4, width / 2, h) : 0;
  if (!r) return <rect x={x} y={y + gap} width={width} height={h} fill={fill} />;
  return (
    <path
      d={`M${x},${y + gap + h} L${x},${y + gap + r} Q${x},${y + gap} ${x + r},${y + gap}
          L${x + width - r},${y + gap} Q${x + width},${y + gap} ${x + width},${y + gap + r}
          L${x + width},${y + gap + h} Z`}
      fill={fill}
    />
  );
}

function CountTooltip({ active, payload, metric }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div
      className="p-3 rounded-lg shadow-lg font-sans text-sm"
      style={{ background: SURFACE, border: `1px solid ${GRID}`, zIndex: 9999 }}
    >
      <p className="font-semibold mb-0.5" style={{ color: INK }}>{fmtDate(row.date)}</p>
      <p className="text-xs mb-2" style={{ color: INK3 }}>
        {row.hours}-hour count · {fmt(row.total)} in the peak window
      </p>
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {[...MODES].reverse().map((mode) => (
            <tr key={mode.key}>
              <td style={{ paddingRight: 6 }}>
                <span
                  className="inline-block rounded-full"
                  style={{ width: 8, height: 8, background: mode.color }}
                />
              </td>
              <td style={{ paddingRight: 10, color: INK }}>{mode.label}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: INK }}>
                {fmt(row.values[mode.key])}
              </td>
              <td style={{ textAlign: 'right', paddingLeft: 10, color: INK3 }}>
                {row.total ? Math.round((row.values[mode.key] / row.total) * 100) : 0}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {metric === 'share' && (
        <p className="text-xs mt-2" style={{ color: INK3 }}>Bars show share; counts shown for reference.</p>
      )}
    </div>
  );
}

/**
 * How one intersection's traffic splits between modes, one bar per count, in
 * date order. Counts are charted over the four-hour window every count in the
 * City's export shares, so bars from different years are comparable.
 */
export default function IntersectionModeChart({ intersection, metric, window: win }) {
  const data = useMemo(() => {
    // The file stores newest first; a time axis reads the other way.
    return [...intersection.counts].reverse().map((count) => {
      const raw = win === 'full' ? fullTotals(count) : peakTotals(count);
      const total = sum(raw);
      const values = Object.fromEntries(MODES.map((m, i) => [m.key, raw[i]]));
      // Topmost non-empty segment, so only that one gets the rounded cap.
      let topKey = null;
      for (let i = MODES.length - 1; i >= 0; i--) {
        if (raw[i] > 0) { topKey = MODES[i].key; break; }
      }
      const plotted = Object.fromEntries(
        MODES.map((m, i) => [m.key, metric === 'share' && total ? (raw[i] / total) * 100 : raw[i]])
      );
      return {
        date: count[0],
        year: count[0].slice(0, 4),
        hours: count[1],
        total,
        values,
        topKey,
        ...plotted,
      };
    });
  }, [intersection, metric, win]);

  // Aim for roughly a dozen year labels however many counts there are; a dozen
  // counts or fewer get one each.
  const interval = Math.max(0, Math.ceil(data.length / 12) - 1);

  // Recharts orders the legend for itself, which here came out alphabetical.
  // Stating it keeps the keys in stacking order, top of the bar downwards, so
  // the legend reads the way the bar does.
  const legendPayload = [...MODES].reverse().map((mode) => ({
    value: mode.label,
    id: mode.key,
    type: 'circle',
    color: mode.color,
  }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={380}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 28 }}>
          <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="year"
            tick={{ fill: INK3, fontSize: 12 }}
            stroke={GRID}
            interval={interval}
            height={28}
          />
          <YAxis
            tick={{ fill: INK3, fontSize: 12 }}
            stroke={GRID}
            width={52}
            domain={metric === 'share' ? [0, 100] : [0, 'auto']}
            ticks={metric === 'share' ? [0, 25, 50, 75, 100] : undefined}
            tickFormatter={
              metric === 'share'
                ? (v) => `${v}%`
                : (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)
            }
            label={{
              value: metric === 'share' ? 'Share of traffic' : 'People and vehicles counted',
              angle: -90,
              position: 'insideLeft',
              offset: 4,
              style: { textAnchor: 'middle', fill: INK3, fontSize: 12 },
            }}
          />
          <Tooltip content={<CountTooltip metric={metric} />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
          <Legend
            verticalAlign="top"
            height={30}
            iconSize={9}
            payload={legendPayload}
            // The swatch carries the identity; the label stays in ink, which is
            // legible where a light series hue would not be.
            formatter={(value) => <span style={{ color: INK }}>{value}</span>}
          />
          {MODES.map((mode) => (
            <Bar
              key={mode.key}
              dataKey={mode.key}
              name={mode.label}
              stackId="modes"
              fill={mode.color}
              maxBarSize={24}
              isAnimationActive={false}
              shape={<StackSegment modeKey={mode.key} />}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
