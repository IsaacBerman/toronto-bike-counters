'use client';

import { useEffect, useState } from 'react';

// Geometry in viewBox units. Ground is y = 60.
const WHEEL_R = 13;
const REAR = [16, 47];
const FRONT = [66, 47];
const BB = [37, 48];
const CRANK = 5;
const HIP = [30, 20];
const THIGH = 17.5;
const SHIN = 17.5;

// Speeds are tied together so nothing skids: road speed = wheel spin × radius,
// and the crank turns once per GEAR wheel revolutions.
const CADENCE = 0.8; // crank revolutions per second
const GEAR = 2;
const WHEEL_W = CADENCE * GEAR * 2 * Math.PI; // rad/s
const SPEED = WHEEL_W * WHEEL_R; // units/s
const DASH = 14; // road dash period

const ink = { stroke: 'var(--ink)' };
const ink3 = { stroke: 'var(--ink-3)' };
const accent = { stroke: 'var(--accent)' };

// Two-bone IK: knee position for a leg from hip to foot, bending forward.
function knee(hip, foot) {
  const dx = foot[0] - hip[0];
  const dy = foot[1] - hip[1];
  const d = Math.min(Math.hypot(dx, dy), THIGH + SHIN - 0.01);
  const a = Math.acos((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d));
  const base = Math.atan2(dy, dx);
  const k1 = [hip[0] + THIGH * Math.cos(base + a), hip[1] + THIGH * Math.sin(base + a)];
  const k2 = [hip[0] + THIGH * Math.cos(base - a), hip[1] + THIGH * Math.sin(base - a)];
  return k1[0] > k2[0] ? k1 : k2;
}

function Leg({ phase, style, width, opacity }) {
  const foot = [BB[0] + CRANK * Math.cos(phase), BB[1] + CRANK * Math.sin(phase)];
  const k = knee(HIP, foot);
  return (
    <g opacity={opacity}>
      <polyline
        points={`${HIP[0]},${HIP[1]} ${k[0]},${k[1]} ${foot[0]},${foot[1]}`}
        fill="none"
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={style}
      />
      <line x1={BB[0]} y1={BB[1]} x2={foot[0]} y2={foot[1]} strokeWidth="1.6" strokeLinecap="round" style={ink} />
      <line x1={foot[0] - 2} y1={foot[1]} x2={foot[0] + 2.5} y2={foot[1]} strokeWidth="2" strokeLinecap="round" style={ink} />
    </g>
  );
}

function Wheel({ c, angle }) {
  const deg = (angle * 180) / Math.PI;
  return (
    <g>
      <circle cx={c[0]} cy={c[1]} r={WHEEL_R} fill="none" strokeWidth="2.4" style={ink} />
      <g transform={`rotate(${deg} ${c[0]} ${c[1]})`}>
        {[0, 30, 60, 90, 120, 150].map((s) => (
          <line
            key={s}
            x1={c[0]}
            y1={c[1] - WHEEL_R + 1}
            x2={c[0]}
            y2={c[1] + WHEEL_R - 1}
            transform={`rotate(${s} ${c[0]} ${c[1]})`}
            strokeWidth="0.6"
            style={ink3}
          />
        ))}
        {/* Valve, so the spin reads clearly */}
        <circle cx={c[0]} cy={c[1] - WHEEL_R + 2} r="0.9" style={{ fill: 'var(--accent)' }} />
      </g>
      <circle cx={c[0]} cy={c[1]} r="1.4" style={{ fill: 'var(--ink)' }} />
    </g>
  );
}

export default function BikeLoader({ label }) {
  const [t, setT] = useState(0.35);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf;
    const start = performance.now();
    const tick = (now) => {
      setT((now - start) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const wheel = t * WHEEL_W;
  const crank = wheel / GEAR;
  const offset = (t * SPEED) % DASH;
  // A small bob of the upper body on each pedal stroke.
  const bob = Math.sin(crank * 2) * 0.35;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3" style={{ background: 'var(--paper)' }}>
      <svg width="240" height="124" viewBox="-24 -4 130 68" role="img" aria-label={label}>
        <defs>
          <linearGradient id="bike-loader-fade" x1="0" x2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.2" stopColor="#fff" stopOpacity="1" />
            <stop offset="0.8" stopColor="#fff" stopOpacity="1" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id="bike-loader-mask">
            <rect x="-24" y="-4" width="130" height="68" fill="url(#bike-loader-fade)" />
          </mask>
        </defs>

        {/* Road, scrolling at the bike's speed */}
        <g mask="url(#bike-loader-mask)">
          <line x1="-24" y1="60.2" x2="106" y2="60.2" strokeWidth="1" style={ink} />
          <line
            x1="-24"
            y1="63"
            x2="106"
            y2="63"
            strokeWidth="1"
            strokeDasharray="7 7"
            strokeDashoffset={offset}
            style={ink3}
          />
          {/* Speed streaks trailing the rider */}
          {[[12, 1.1], [26, 0.7], [40, 1.3]].map(([y, k], i) => {
            const len = 10 + 4 * i;
            const x = 8 - (((t * SPEED * k) + i * 37) % 60);
            return (
              <line key={i} x1={x} y1={y} x2={x + len} y2={y} strokeWidth="0.8" strokeLinecap="round" style={ink3} opacity="0.5" />
            );
          })}
        </g>

        {/* Far leg, behind the frame */}
        <Leg phase={crank + Math.PI} style={ink3} width="2.6" opacity="0.8" />

        <Wheel c={REAR} angle={wheel} />
        <Wheel c={FRONT} angle={wheel} />

        {/* Chain */}
        <g strokeWidth="0.6" style={ink3}>
          <line x1={BB[0]} y1={BB[1] - 3.5} x2={REAR[0]} y2={REAR[1] - 2} />
          <line x1={BB[0]} y1={BB[1] + 3.5} x2={REAR[0]} y2={REAR[1] + 2} />
        </g>
        <circle cx={BB[0]} cy={BB[1]} r="3.5" fill="none" strokeWidth="1" style={ink} />

        {/* Frame */}
        <g fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={accent}>
          <polyline points={`${REAR[0]},${REAR[1]} ${BB[0]},${BB[1]} 30,26 ${REAR[0]},${REAR[1]}`} />
          <polyline points={`30,26 58,26 ${BB[0]},${BB[1]}`} />
        </g>
        <line x1="58" y1="24" x2={FRONT[0]} y2={FRONT[1]} strokeWidth="2" strokeLinecap="round" style={ink} />
        <line x1="30" y1="26" x2="29" y2="22" strokeWidth="1.6" style={ink} />
        <line x1="25" y1="21.5" x2="33" y2="21.5" strokeWidth="2.6" strokeLinecap="round" style={ink} />
        <polyline points="58,24 59,19 63,19.5" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={ink} />

        {/* Rider */}
        <g transform={`translate(0 ${bob})`}>
          <line x1={HIP[0]} y1={HIP[1]} x2="49" y2="9" strokeWidth="3.4" strokeLinecap="round" style={ink} />
          <polyline points="49,9 55,15 62,19" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={ink} />
          <circle cx="53.5" cy="4.5" r="3.6" style={{ fill: 'var(--ink)' }} />
        </g>

        {/* Near leg, in front of the frame */}
        <Leg phase={crank} style={ink} width="3" opacity="1" />
      </svg>
      <div className="text-base font-sans" style={{ color: 'var(--ink-2)' }}>{label}</div>
    </div>
  );
}
