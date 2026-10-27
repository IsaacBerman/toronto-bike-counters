'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { CANDIDATE_COLORS_2026, OTHER_COLOR, fmt } from './results';
import { NEEDLE, surname } from './needle-model';
import { HISTORY_UNTIL, POLLS_CLOSE } from '../../lib/elections-live';

export { NEEDLE, computeNeedle } from './needle-model';

// Chow on the right in her campaign colour; the challenger on the left in
// theirs (grey for anyone without one).
const A_COLOR = CANDIDATE_COLORS_2026[NEEDLE.a];
const colorOf = (name) => CANDIDATE_COLORS_2026[name] ?? OTHER_COLOR;

// The rim shades smoothly from the challenger's colour through grey at a
// toss-up to Chow's, as [p, colour, opacity] stops. Only the middle and the
// two ends are labelled.
const gradientStops = (bColor) => [
  [0, bColor, 1],
  [0.2, bColor, 0.6],
  [0.4, '#d6d4ca', 1],
  [0.6, '#d6d4ca', 1],
  [0.8, A_COLOR, 0.6],
  [1, A_COLOR, 1],
];
const LABELS = [[0.025, 'Safe'], [0.5, 'Toss-up'], [0.975, 'Safe']];

// The dial is the top half of a bike wheel: a tire around the outside, the
// probability bands as the rim, laced spokes and a hub. The pointer is the CN
// Tower, turning on the hub.
const CX = 160;
const CY = 168;
const R_TIRE = 146; // centre line of the tire
const R_OUT = 140; // outer edge of the rim (the bands)
const R_IN = 112; // inner edge of the rim
const R_HUB = 11;

// p = 0 is the far left (the challenger), 1 the far right (Chow).
const pt = (p, r) => {
  const a = Math.PI * (1 - p);
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
};

function bandPath(p0, p1) {
  const [x0, y0] = pt(p0, R_OUT);
  const [x1, y1] = pt(p1, R_OUT);
  const [x2, y2] = pt(p1, R_IN);
  const [x3, y3] = pt(p0, R_IN);
  return `M${x0},${y0} A${R_OUT},${R_OUT} 0 0 1 ${x1},${y1} L${x2},${y2} A${R_IN},${R_IN} 0 0 0 ${x3},${y3} Z`;
}

// Spokes leave the hub at a tangent, alternately leading and trailing, so
// they cross the way a laced wheel's do. Only the top half is drawn.
const SPOKES = Array.from({ length: 19 }, (_, i) => i / 18).flatMap((p, i) => {
  const [x1, y1] = pt(p, R_IN - 1);
  const lean = (i % 2 ? 1 : -1) * 0.075;
  const [x0, y0] = pt(Math.min(1, Math.max(0, p + lean * 6)), R_HUB - 3);
  return [{ x0, y0, x1, y1 }];
});

// Tire tread: short ticks across the tire.
const TREAD = Array.from({ length: 37 }, (_, i) => i / 36).map((p) => {
  const [x0, y0] = pt(p, R_TIRE - 2.5);
  const [x1, y1] = pt(p, R_TIRE + 2.5);
  return { x0, y0, x1, y1 };
});

// The CN Tower, drawn pointing straight up from the hub (its base at 0, its
// antenna tip at -L), in the real tower's proportions: the main pod about
// 60–66% of the way up, the SkyPod at about 80%, the antenna above that.
const L = R_OUT - 4;
const at = (f) => (-f * L).toFixed(1);
const TOWER = [
  'M-7,0',
  `L-2.8,${at(0.58)}`, `L-6,${at(0.6)}`, `L-12,${at(0.62)}`, `L-12,${at(0.65)}`, `L-5,${at(0.67)}`,
  `L-1.8,${at(0.68)}`, `L-1.8,${at(0.79)}`, `L-4.2,${at(0.8)}`, `L-4.2,${at(0.825)}`, `L-1.2,${at(0.835)}`,
  `L-0.6,${-L}`, `L0.6,${-L}`,
  `L1.2,${at(0.835)}`, `L4.2,${at(0.825)}`, `L4.2,${at(0.8)}`, `L1.8,${at(0.79)}`, `L1.8,${at(0.68)}`,
  `L5,${at(0.67)}`, `L12,${at(0.65)}`, `L12,${at(0.62)}`, `L6,${at(0.6)}`, `L2.8,${at(0.58)}`,
  'L7,0', 'Z',
].join(' ');

// A margin as whoever is ahead: "Chow +4.2" or "Bradford +1.3".
const marginText = (x, rival) => `${x >= 0 ? NEEDLE.aShort : rival} +${Math.abs(x * 100).toFixed(1)}`;
const pctText = (p, allIn) => (!allIn && p >= 0.995 ? '>99' : p <= 0.005 && !allIn ? '<1' : Math.round(p * 100));
const clock = (ms) => new Date(ms).toLocaleTimeString('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit' });

// Eases a number toward its target over `ms`, picking up from wherever it is
// if the target changes mid-swing. Driven from JavaScript so the tower can use
// SVG's own rotate(), which every browser pivots correctly — CSS rotation of
// SVG shapes has swung around the wrong point in older mobile Safari.
// People who've asked for reduced motion get the new value straight away.
function useEased(target, ms = 1200) {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const from = current.current;
    if (reduce || from === target) {
      current.current = target;
      setValue(target);
      return undefined;
    }
    const start = performance.now();
    let frame;
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const v = from + (target - from) * (1 - (1 - t) ** 3);
      current.current = v;
      setValue(v);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return value;
}

export function Needle({ needle, history, seq, reporting }) {
  const gradientId = useId();
  const waiting = !needle || needle.waiting;
  const p = waiting ? 0.5 : needle.p;
  const angle = useEased((p - 0.5) * 180);
  const rival = surname(needle?.challenger ?? NEEDLE.b);
  const bColor = colorOf(needle?.challenger ?? NEEDLE.b);
  const leader = p >= 0.5 ? NEEDLE.aShort : rival;
  const rows = waiting ? [] : nightRows(history, needle, seq);

  return (
    <div className="dd-panel">
      <div className="p-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <h2 className="dd-title text-lg" style={{ color: 'var(--ink)' }}>Who will win?</h2>
      </div>
      <div className="p-4">
        <svg viewBox="-44 0 408 196" className="w-full" role="img"
          aria-label={waiting ? 'Dial waiting for results' : `${leader} ${pctText(Math.max(p, 1 - p), needle.allIn)}% likely to win`}>
          {SPOKES.map((sp, i) => (
            <line key={i} x1={sp.x0} y1={sp.y0} x2={sp.x1} y2={sp.y1} stroke="var(--ink-3)" strokeOpacity="0.55" strokeWidth="0.8" />
          ))}
          <defs>
            {/* Horizontal, so each stop sits where its p falls on the arc. */}
            <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={CX - R_OUT} y1="0" x2={CX + R_OUT} y2="0">
              {gradientStops(bColor).map(([gp, color, opacity]) => (
                <stop key={gp} offset={(1 - Math.cos(Math.PI * gp)) / 2} stopColor={color} stopOpacity={opacity} />
              ))}
            </linearGradient>
          </defs>
          <path d={bandPath(0, 1)} fill={`url(#${gradientId})`} fillOpacity={waiting ? 0.35 : 1} />
          <path d={`M${CX - R_TIRE},${CY} A${R_TIRE},${R_TIRE} 0 0 1 ${CX + R_TIRE},${CY}`} fill="none" stroke="#2b2a26" strokeWidth="9" />
          {TREAD.map((t, i) => (
            <line key={i} x1={t.x0} y1={t.y0} x2={t.x1} y2={t.y1} stroke="#57554b" strokeWidth="1.2" />
          ))}
          {LABELS.map(([lp, label], i) => {
            const [x, y] = pt(lp, R_TIRE + 11);
            return (
              <text key={i} x={x} y={y + 4} fontSize="12.5" textAnchor={lp < 0.45 ? 'end' : lp > 0.55 ? 'start' : 'middle'}
                fill="var(--ink-3)">{label}</text>
            );
          })}
          <text x={CX - (R_OUT + R_IN) / 2} y={CY + 22} fontSize="14" fontWeight="700" textAnchor="middle" fill="var(--ink-2)">{rival} win</text>
          <text x={CX + (R_OUT + R_IN) / 2} y={CY + 22} fontSize="14" fontWeight="700" textAnchor="middle" fill="var(--ink-2)">{NEEDLE.aShort} win</text>
          <g transform={`rotate(${angle.toFixed(2)} ${CX} ${CY})`}>
            <path d={TOWER} transform={`translate(${CX},${CY})`} fill={waiting ? 'var(--ink-3)' : 'var(--ink)'} />
          </g>
          <circle cx={CX} cy={CY} r={R_HUB} fill={waiting ? 'var(--ink-3)' : 'var(--ink)'} />
          <circle cx={CX} cy={CY} r="3.5" fill="var(--panel)" />
        </svg>

        {waiting ? (
          <p className="text-sm text-center mt-2" style={{ color: 'var(--ink-2)' }}>
            The tower starts moving once votes are counted after polls close at 8 p.m.
          </p>
        ) : (
          <>
            <p className="text-center mt-1">
              <span className="dd-title text-2xl" style={{ color: 'var(--ink)' }}>
                {leader} {pctText(Math.max(p, 1 - p), needle.allIn)}%
              </span>
              <span className="text-sm ml-1.5" style={{ color: 'var(--ink-2)' }}>
                {needle.allIn ? 'all polls reporting' : 'chance of winning'}
              </span>
            </p>
            <ShareChart rows={rows} challenger={needle.challenger ?? NEEDLE.b} />
            <MarginChart rows={rows} rival={rival} bColor={bColor} />
            <ChanceChart rows={rows} rival={rival} bColor={bColor} />
            <dl className="mt-3 pt-3 text-xs grid grid-cols-[1fr_auto] gap-x-3 gap-y-1" style={{ borderTop: '1px solid var(--line)', color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
              <dt>Projected margin</dt>
              <dd className="text-right font-semibold" style={{ color: 'var(--ink)' }}>{marginText(needle.projected, rival)}</dd>
              <dt>Polls reporting</dt>
              <dd className="text-right">{fmt(reporting?.pollsReceived ?? 0)} of {fmt(reporting?.polls ?? 0)}</dd>
              <dt>Expected vote counted</dt>
              <dd className="text-right">{Math.round(needle.share * 100)}%</dd>
            </dl>
          </>
        )}
      </div>
    </div>
  );
}

// The needle's path over the night: one point per results file the City
// published. Three charts share this: Chow and her challenger's vote shares,
// the projected margin, and the chance of winning.
const W = 300;
const H = 118;
const M = { l: 34, r: 8, t: 8, b: 18 };

// `times` are the points' timestamps; each line has a colour and one value per
// time (null where it has none). With `mid`, the area between the first line
// and it is shaded in Chow's colour above and the challenger's below.
// `sides` names who the top and bottom of the chart belong to, in their colours.
function NightChart({ title, legend, times, lines, lo, hi, mid, ticks, sides, bColor, tip, aria }) {
  const clipId = useId();
  const [hover, setHover] = useState(null);
  if (times.length < 2) return null;

  // Poll close on the left, the latest update on the right, so the line
  // always fills the chart and stretches as the night goes on. Once the count
  // settled (HISTORY_UNTIL), the clock stops: each later change gets its own
  // small, equal step after a dashed line, however long it took to come in.
  const t0 = Math.min(POLLS_CLOSE, times[0]);
  const late = times.filter((t) => t > HISTORY_UNTIL).length;
  const t1 = late ? HISTORY_UNTIL : Math.max(times[times.length - 1], t0 + 60 * 1000);
  const plotW = W - M.l - M.r;
  const lateW = Math.min(0.25, 0.015 * late) * plotW;
  const onTime = times.length - late;
  const xs = times.map((t, i) => (i < onTime
    ? M.l + ((Math.min(t, t1) - t0) / (t1 - t0)) * (plotW - lateW)
    : M.l + plotW - lateW + ((i - onTime + 1) / late) * lateW));
  const cutX = M.l + plotW - lateW;
  const y = (v) => M.t + ((hi - Math.min(hi, Math.max(lo, v))) / (hi - lo)) * (H - M.t - M.b);
  const pathOf = (values) => {
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${xs[i].toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const main = pathOf(lines[0].values);
  const area = mid != null
    ? `${main}L${xs[xs.length - 1].toFixed(1)},${y(mid)}L${xs[0].toFixed(1)},${y(mid)}Z`
    : null;

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i;
    setHover(best);
  };

  return (
    <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
      <p className="text-xs font-semibold mb-1" style={{ color: 'var(--ink-2)' }}>{title}</p>
      {legend}
      <div className="relative">
        {/* Touch: a tap shows that point, dragging sideways scrubs the night, and
            vertical swipes still scroll the page. The readout stays up after a
            tap rather than vanishing as the finger lifts. */}
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ touchAction: 'pan-y' }}
          onPointerMove={onMove} onPointerDown={onMove}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(null); }}
          role="img" aria-label={aria}>
          {area && (
            <defs>
              <clipPath id={`${clipId}a`}><rect x="0" y="0" width={W} height={y(mid)} /></clipPath>
              <clipPath id={`${clipId}b`}><rect x="0" y={y(mid)} width={W} height={H} /></clipPath>
            </defs>
          )}
          {ticks.map(({ v, label }) => (
            <g key={v}>
              <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray={v === mid ? '3 3' : undefined} />
              <text x={M.l - 4} y={y(v) + 3} fontSize="9" textAnchor="end" fill="var(--ink-3)">{label}</text>
            </g>
          ))}
          {sides && (
            <>
              <text x={M.l + 3} y={M.t + 9} fontSize="9" fontWeight="700" fill={sides.top.color}>{sides.top.label}</text>
              <text x={M.l + 3} y={H - M.b - 3} fontSize="9" fontWeight="700" fill={sides.bottom.color}>{sides.bottom.label}</text>
            </>
          )}
          {area && (
            <>
              <path d={area} fill={A_COLOR} fillOpacity="0.2" clipPath={`url(#${clipId}a)`} />
              <path d={area} fill={bColor} fillOpacity="0.2" clipPath={`url(#${clipId}b)`} />
            </>
          )}
          {lines.map((ln, i) => (
            <path key={i} d={i ? pathOf(ln.values) : main} fill="none" stroke={ln.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {late > 0 && <line x1={cutX} x2={cutX} y1={M.t} y2={H - M.b} stroke="var(--ink-3)" strokeDasharray="2 2" />}
          <text x={M.l} y={H - 4} fontSize="9" fill="var(--ink-3)">{clock(t0)}</text>
          <text x={late ? cutX : W - M.r} y={H - 4} fontSize="9" textAnchor="end" fill="var(--ink-3)">{clock(t1)}</text>
          {hover != null && (
            <g>
              <line x1={xs[hover]} x2={xs[hover]} y1={M.t} y2={H - M.b} stroke="var(--ink-3)" />
              {lines.map((ln, i) => ln.values[hover] != null && (
                <circle key={i} cx={xs[hover]} cy={y(ln.values[hover])} r="4" fill={ln.color} stroke="var(--panel)" strokeWidth="2" />
              ))}
            </g>
          )}
        </svg>
        {hover != null && (
          <div className="absolute pointer-events-none text-xs rounded px-2 py-1 whitespace-nowrap"
            style={{
              left: `${(xs[hover] / W) * 100}%`,
              top: 0,
              transform: `translateX(${xs[hover] > W / 2 ? '-105%' : '5%'})`,
              background: 'var(--ink)',
              color: '#fff',
              fontVariantNumeric: 'tabular-nums',
            }}>
            {/* A list stacks one row per line, so a three-way readout stays
                narrow enough to fit beside the cursor. */}
            {Array.isArray(tip(hover))
              ? <>{clock(times[hover])}{tip(hover).map((t) => <div key={t}>{t}</div>)}</>
              : <>{clock(times[hover])} · {tip(hover)}</>}
          </div>
        )}
      </div>
    </div>
  );
}

// History points are [seq, p, share, projected, shares]; the current reading
// is added if the server's history hasn't caught up to it. Once every poll is
// in, the City keeps republishing the same final count; those repeats are
// dropped so the charts end when the count did instead of squeezing the night
// against the left edge for anyone looking the next day. Compared loosely,
// since the database stores readings at lower precision than the live one.
const same = (a, b) => [1, 2, 3].every((i) => Math.abs(a[i] - b[i]) < 1e-5);
function nightRows(history, needle, seq) {
  // Only tonight: the City's first file with votes can still carry its
  // pre-election timestamp, which would stretch the charts back weeks.
  const rows = (history ?? []).filter((r) => r[0] >= POLLS_CLOSE);
  if (seq && (!rows.length || rows[rows.length - 1][0] < seq)) {
    rows.push([seq, needle.p, needle.share, needle.projected, needle.topShares ?? null]);
  }
  // After the count settled, only changes count: a republished file with the
  // same reading adds no step.
  for (let i = rows.length - 1; i > 0; i--) {
    if (rows[i][0] > HISTORY_UNTIL && same(rows[i], rows[i - 1])) rows.splice(i, 1);
  }
  if (needle.allIn) while (rows.length > 1 && same(rows[rows.length - 1], rows[rows.length - 2])) rows.pop();
  return rows;
}

const pct1 = (v) => `${(v * 100).toFixed(1)}%`;
const chanceText = (p, rival) => (p >= 0.5 ? `${NEEDLE.aShort} ${pctText(p)}%` : `${rival} ${pctText(1 - p)}%`);

function ShareChart({ rows, challenger }) {
  const usable = rows.filter((r) => Array.isArray(r[4]) && r[4].length);
  if (usable.length < 2) return null;
  // Chow and her challenger, ordered by where they stand now.
  const latest = new Map(usable[usable.length - 1][4]);
  const names = [NEEDLE.a, challenger].sort((a, b) => (latest.get(b) ?? 0) - (latest.get(a) ?? 0));
  const lines = names.map((n) => ({
    name: n,
    color: colorOf(n),
    values: usable.map((r) => r[4].find(([m]) => m === n)?.[1] ?? null),
  }));
  // Zero to just above the leader's best, in steps of 10 points.
  const top = Math.min(1, Math.max(0.2, Math.ceil(Math.max(...lines.flatMap((l) => l.values.filter((v) => v != null))) * 1.05 / 0.1) * 0.1));
  const ticks = [0, top / 2, top].map((v) => ({ v, label: `${Math.round(v * 100)}%` }));
  return (
    <NightChart
      title="Vote share over time"
      legend={(
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-1 text-xs" style={{ color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
          {lines.map((l) => (
            <span key={l.name} className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: l.color }} />
              {surname(l.name)} {latest.has(l.name) ? pct1(latest.get(l.name)) : ''}
            </span>
          ))}
        </div>
      )}
      times={usable.map((r) => r[0])}
      lines={lines}
      lo={0}
      hi={top}
      ticks={ticks}
      tip={(i) => lines.filter((l) => l.values[i] != null).map((l) => `${surname(l.name)} ${pct1(l.values[i])}`)}
      aria={`Vote share over time: ${lines.map((l) => `${surname(l.name)} ${latest.has(l.name) ? pct1(latest.get(l.name)) : ''}`).join(', ')}`}
    />
  );
}

function ChanceChart({ rows, rival, bColor }) {
  const values = rows.map((r) => r[1]);
  return (
    <NightChart
      title="Chance of winning over time"
      times={rows.map((r) => r[0])}
      lines={[{ color: 'var(--ink)', values }]}
      lo={0}
      hi={1}
      mid={0.5}
      ticks={[{ v: 0, label: '100%' }, { v: 0.5, label: '50/50' }, { v: 1, label: '100%' }]}
      sides={{ top: { label: NEEDLE.aShort, color: A_COLOR }, bottom: { label: rival, color: bColor } }}
      bColor={bColor}
      tip={(i) => chanceText(values[i], rival)}
      aria={`Chance of winning moved from ${chanceText(values[0], rival)} to ${chanceText(values[values.length - 1], rival)}`}
    />
  );
}

function MarginChart({ rows, rival, bColor }) {
  const values = rows.map((r) => r[3]);
  // Symmetric around a tie, wide enough for the biggest swing so far, in
  // steps of 5 points.
  const top = Math.max(0.05, Math.ceil((Math.max(...values.map((v) => Math.abs(v)), 0) * 1.1) / 0.05) * 0.05);
  const pts = (v) => `+${Math.round(Math.abs(v) * 100)}`;
  return (
    <NightChart
      title="Projected margin over time"
      times={rows.map((r) => r[0])}
      lines={[{ color: 'var(--ink)', values }]}
      lo={-top}
      hi={top}
      mid={0}
      ticks={[{ v: -top, label: pts(-top) }, { v: 0, label: 'Tie' }, { v: top, label: pts(top) }]}
      sides={{ top: { label: NEEDLE.aShort, color: A_COLOR }, bottom: { label: rival, color: bColor } }}
      bColor={bColor}
      tip={(i) => marginText(values[i], rival)}
      aria={`Projected margin moved from ${marginText(values[0], rival)} to ${marginText(values[values.length - 1], rival)}`}
    />
  );
}
