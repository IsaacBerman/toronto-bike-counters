'use client';

import { useId, useState } from 'react';
import { CANDIDATE_COLORS_2026, OTHER_COLOR, fmt } from './results';
import { NEEDLE, surname } from './needle-model';
import { POLLS_CLOSE } from '../../lib/elections-live';

export { NEEDLE, computeNeedle } from './needle-model';

// Chow on the right in her campaign colour; the challenger on the left in
// theirs (grey for anyone without one).
const A_COLOR = CANDIDATE_COLORS_2026[NEEDLE.a];
const colorOf = (name) => CANDIDATE_COLORS_2026[name] ?? OTHER_COLOR;

// Probability bands, as the dial labels them.
const bands = (bColor) => [
  [0, 0.05, bColor, 1],
  [0.05, 0.25, bColor, 0.6],
  [0.25, 0.4, bColor, 0.28],
  [0.4, 0.6, '#d6d4ca', 1],
  [0.6, 0.75, A_COLOR, 0.28],
  [0.75, 0.95, A_COLOR, 0.6],
  [0.95, 1, A_COLOR, 1],
];
const TICKS = [[0.05, 'Very likely'], [0.25, 'Likely'], [0.5, 'Tossup'], [0.75, 'Likely'], [0.95, 'Very likely']];

const CX = 160;
const CY = 158;
const R_OUT = 140;
const R_IN = 100;

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

const signed = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}`;
const pctText = (p, allIn) => (!allIn && p >= 0.995 ? '>99' : p <= 0.005 && !allIn ? '<1' : Math.round(p * 100));
const clock = (ms) => new Date(ms).toLocaleTimeString('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit' });

export function Needle({ needle, history, seq }) {
  const waiting = !needle || needle.waiting;
  const p = waiting ? 0.5 : needle.p;
  const rival = surname(needle?.challenger ?? NEEDLE.b);
  const bColor = colorOf(needle?.challenger ?? NEEDLE.b);
  const leader = p >= 0.5 ? NEEDLE.aShort : rival;

  return (
    <div className="dd-panel">
      <div className="p-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <h2 className="dd-title text-lg" style={{ color: 'var(--ink)' }}>Who will win?</h2>
      </div>
      <div className="p-4">
        <svg viewBox="-34 0 388 178" className="w-full" role="img"
          aria-label={waiting ? 'Needle waiting for results' : `${leader} ${pctText(Math.max(p, 1 - p), needle.allIn)}% likely to win`}>
          {bands(bColor).map(([p0, p1, color, opacity]) => (
            <path key={p0} d={bandPath(p0, p1)} fill={color} fillOpacity={waiting ? opacity * 0.35 : opacity} stroke="var(--panel)" strokeWidth="2" />
          ))}
          {TICKS.map(([tp, label], i) => {
            const [x, y] = pt(tp, R_OUT + 9);
            return (
              <text key={i} x={x} y={y} fontSize="8.5" textAnchor={tp < 0.5 ? 'end' : tp > 0.5 ? 'start' : 'middle'}
                fill="var(--ink-3)">{label}</text>
            );
          })}
          <text x={CX - R_OUT + (R_OUT - R_IN) / 2} y={CY + 16} fontSize="10.5" fontWeight="700" textAnchor="middle" fill="var(--ink-2)">{rival} win</text>
          <text x={CX + R_OUT - (R_OUT - R_IN) / 2} y={CY + 16} fontSize="10.5" fontWeight="700" textAnchor="middle" fill="var(--ink-2)">{NEEDLE.aShort} win</text>
          <g style={{ transform: `rotate(${(p - 0.5) * 180}deg)`, transformOrigin: `${CX}px ${CY}px`, transition: 'transform 1.2s cubic-bezier(.3,.7,.3,1)' }}>
            <path d={`M${CX - 4},${CY} L${CX},${CY - R_OUT + 6} L${CX + 4},${CY} Z`} fill={waiting ? 'var(--ink-3)' : 'var(--ink)'} />
          </g>
          <circle cx={CX} cy={CY} r="9" fill={waiting ? 'var(--ink-3)' : 'var(--ink)'} />
        </svg>

        {waiting ? (
          <p className="text-sm text-center mt-2" style={{ color: 'var(--ink-2)' }}>
            The needle starts moving once votes are counted after polls close at 8 p.m.
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
            <ChanceChart history={history} needle={needle} seq={seq} rival={rival} bColor={bColor} />
            <dl className="mt-3 pt-3 text-xs grid grid-cols-[1fr_auto] gap-x-3 gap-y-1" style={{ borderTop: '1px solid var(--line)', color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
              <dt>Projected margin, Chow over {rival}</dt>
              <dd className="text-right font-semibold" style={{ color: 'var(--ink)' }}>{signed(needle.projected)}</dd>
              <dt>Chow&rsquo;s margin vs 2023, counted wards</dt>
              <dd className="text-right">{signed(needle.swing)} pts</dd>
              <dt>Wards reporting</dt>
              <dd className="text-right">{fmt(needle.wardsReporting)} of 25</dd>
              <dt>Expected vote counted</dt>
              <dd className="text-right">{Math.round(needle.share * 100)}%</dd>
            </dl>
          </>
        )}
      </div>
    </div>
  );
}

// Chow's chance over the night: one point per results file the City published.
const W = 300;
const H = 118;
const M = { l: 30, r: 8, t: 8, b: 18 };

function ChanceChart({ history, needle, seq, rival, bColor }) {
  const clipId = useId();
  const [hover, setHover] = useState(null);
  const points = [...(history ?? [])].map(([t, p]) => [t, p]);
  // The current reading, if the server's history hasn't caught up to it.
  if (seq && (!points.length || points[points.length - 1][0] < seq)) points.push([seq, needle.p]);
  if (points.length < 2) return null;

  const t0 = Math.min(POLLS_CLOSE, points[0][0]);
  const t1 = Math.max(points[points.length - 1][0], t0 + 2 * 60 * 60 * 1000);
  const x = (t) => M.l + ((t - t0) / (t1 - t0)) * (W - M.l - M.r);
  const y = (p) => M.t + (1 - p) * (H - M.t - M.b);
  const line = points.map(([t, p], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(p).toFixed(1)}`).join('');
  const last = points[points.length - 1];
  const area = `${line}L${x(last[0]).toFixed(1)},${y(0.5)}L${x(points[0][0]).toFixed(1)},${y(0.5)}Z`;

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const t = t0 + (((e.clientX - box.left) / box.width) * W - M.l) / (W - M.l - M.r) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i][0] - t) < Math.abs(points[best][0] - t)) best = i;
    setHover(best);
  };
  const h = hover != null ? points[hover] : null;

  return (
    <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
      <p className="text-xs font-semibold mb-1" style={{ color: 'var(--ink-2)' }}>Chow&rsquo;s chance of winning through the night</p>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onPointerMove={onMove} onPointerLeave={() => setHover(null)}
          role="img" aria-label={`Chow's chance moved from ${Math.round(points[0][1] * 100)}% to ${Math.round(last[1] * 100)}%`}>
          <defs>
            <clipPath id={`${clipId}a`}><rect x="0" y="0" width={W} height={y(0.5)} /></clipPath>
            <clipPath id={`${clipId}b`}><rect x="0" y={y(0.5)} width={W} height={H} /></clipPath>
          </defs>
          {[0, 0.5, 1].map((p) => (
            <g key={p}>
              <line x1={M.l} x2={W - M.r} y1={y(p)} y2={y(p)} stroke="var(--line)" strokeDasharray={p === 0.5 ? '3 3' : undefined} />
              <text x={M.l - 4} y={y(p) + 3} fontSize="9" textAnchor="end" fill="var(--ink-3)">{p * 100}%</text>
            </g>
          ))}
          <path d={area} fill={A_COLOR} fillOpacity="0.2" clipPath={`url(#${clipId}a)`} />
          <path d={area} fill={bColor} fillOpacity="0.2" clipPath={`url(#${clipId}b)`} />
          <path d={line} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <text x={M.l} y={H - 4} fontSize="9" fill="var(--ink-3)">{clock(t0)}</text>
          <text x={W - M.r} y={H - 4} fontSize="9" textAnchor="end" fill="var(--ink-3)">{clock(t1)}</text>
          {h && (
            <g>
              <line x1={x(h[0])} x2={x(h[0])} y1={M.t} y2={H - M.b} stroke="var(--ink-3)" />
              <circle cx={x(h[0])} cy={y(h[1])} r="4" fill="var(--ink)" stroke="var(--panel)" strokeWidth="2" />
            </g>
          )}
        </svg>
        {h && (
          <div className="absolute pointer-events-none text-xs rounded px-2 py-1 whitespace-nowrap"
            style={{
              left: `${(x(h[0]) / W) * 100}%`,
              top: 0,
              transform: `translateX(${x(h[0]) > W / 2 ? '-105%' : '5%'})`,
              background: 'var(--ink)',
              color: '#fff',
              fontVariantNumeric: 'tabular-nums',
            }}>
            {clock(h[0])} · {h[1] >= 0.5 ? `Chow ${pctText(h[1])}%` : `${rival} ${pctText(1 - h[1])}%`}
          </div>
        )}
      </div>
    </div>
  );
}
