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
import { MODES, peakTotals, fullTotals, sum, fmt, fmtDate, isModeOn, visibleModes } from './modes';

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

function CountTooltip({ active, payload, metric, picked }) {
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
            <tr key={mode.key} style={{ opacity: isModeOn(picked, mode.key) ? 1 : 0.4 }}>
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
export default function IntersectionModeChart({
  intersection,
  metric,
  window: win,
  pickedModes,
  onToggleMode,
}) {
  const shown = useMemo(() => visibleModes(pickedModes), [pickedModes]);

  const data = useMemo(() => {
    // The file stores newest first; a time axis reads the other way.
    return [...intersection.counts].reverse().map((count, index) => {
      const raw = win === 'full' ? fullTotals(count) : peakTotals(count);
      // Shares are always out of everything counted, filtered or not: "bikes
      // were 4% of this intersection" is the number that carries, and a
      // bikes-only chart denominated by bikes would read 100% every year.
      const total = sum(raw);
      const values = Object.fromEntries(MODES.map((m, i) => [m.key, raw[i]]));
      // Topmost non-empty segment *of what's plotted*, so the rounded cap lands
      // on the bar's actual top rather than a hidden mode.
      let topKey = null;
      for (let i = MODES.length - 1; i >= 0; i--) {
        if (raw[i] > 0 && isModeOn(pickedModes, MODES[i].key)) { topKey = MODES[i].key; break; }
      }
      const plotted = Object.fromEntries(
        MODES.map((m, i) => [m.key, metric === 'share' && total ? (raw[i] / total) * 100 : raw[i]])
      );
      return {
        date: count[0],
        // The x axis keys off this, and it has to be unique per bar. A quarter
        // of these intersections were counted more than once in the same year,
        // and a category axis with repeated values collapses them: the band
        // scale dedupes its domain, so every bar sharing a year resolved to one
        // row and the tooltip showed that row's date and numbers for all of
        // them. Thirteen intersections were even counted twice on one date, so
        // the index goes in too. The tick formatter puts the year back.
        key: `${count[0]}#${index}`,
        year: count[0].slice(0, 4),
        hours: count[1],
        total,
        values,
        topKey,
        ...plotted,
      };
    });
  }, [intersection, metric, win, pickedModes]);

  // Every bar carries its year. Past about a dozen counts they stop fitting
  // upright, so they tilt — thinning them out instead would leave bars with no
  // label, and an intersection counted three times in one year needs all three
  // years showing to read as three separate counts.
  const angled = data.length > 12;

  // Recharts orders the legend for itself, which here came out alphabetical.
  // Stating it keeps the keys in stacking order, top of the bar downwards, so
  // the legend reads the way the bar does. Every mode stays listed whatever the
  // filter, because the legend is also how you change the filter.
  const legendPayload = [...MODES].reverse().map((mode) => ({
    value: mode.label,
    id: mode.key,
    type: 'circle',
    color: mode.color,
    inactive: !isModeOn(pickedModes, mode.key),
  }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={380}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="key"
            tickFormatter={(value) => String(value).slice(0, 4)}
            tick={{ fill: INK3, fontSize: angled ? 10 : 12 }}
            stroke={GRID}
            interval={0}
            angle={angled ? -45 : 0}
            textAnchor={angled ? 'end' : 'middle'}
            height={angled ? 52 : 28}
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
          <Tooltip
            content={<CountTooltip metric={metric} picked={pickedModes} />}
            cursor={{ fill: 'rgba(0,0,0,0.04)' }}
          />
          <Legend
            verticalAlign="top"
            height={30}
            iconSize={9}
            payload={legendPayload}
            // The chart's legend is the same filter the map's legend is, so a
            // reader who is looking at the bars can change modes without
            // scrolling back up.
            onClick={(entry) => onToggleMode?.(entry.id)}
            wrapperStyle={{ cursor: onToggleMode ? 'pointer' : undefined }}
            // The swatch carries the identity; the label stays in ink, which is
            // legible where a light series hue would not be.
            formatter={(value, entry) => (
              <span style={{ color: INK, opacity: entry?.inactive ? 0.45 : 1 }}>{value}</span>
            )}
          />
          {shown.map((mode) => (
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
