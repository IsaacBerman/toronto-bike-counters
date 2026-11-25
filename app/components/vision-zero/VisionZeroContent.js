'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ReferenceArea, Cell, usePlotArea,
} from 'recharts';
import { X } from 'lucide-react';
import { cartoTileUrl, CARTO_ATTRIBUTION, CARTO_SUBDOMAINS } from '../../lib/basemapTiles';

const INK = '#16150f';
const INK2 = '#57554b';
const INK3 = '#8a887c';
const GRID = '#e5e3da';
const PAPER = '#f3f2ec';

// Policy milestones drawn on the trend charts. `month` places the line on the
// monthly timeline; `year` on the annual one.
// `yearPos` is where in that year's bar the line falls.
const EVENTS = [
  { year: 2016, month: '2016-07', date: 'Jul 2016', label: 'Vision Zero plan adopted', major: true },
  { year: 2019, month: '2019-07', date: 'Jul 2019', label: 'Vision Zero 2.0' },
  { year: 2020, month: '2020-07', date: 'Jul 2020', label: 'Speed cameras start' },
  { year: 2025, month: '2025-11', date: 'Nov 14, 2025', label: 'Speed cameras banned', yearPos: 'end' },
];
const VZ_YEAR = 2016;
const BASELINE = [2011, 2015];

const USERS = [
  { key: 'pedestrian', label: 'Pedestrians', one: 'Pedestrian', color: '#2a78d6' },
  { key: 'cyclist', label: 'Cyclists', one: 'Cyclist', color: '#eb6834' },
  { key: 'motorcyclist', label: 'Motorcyclists', one: 'Motorcyclist', color: '#1baf7a' },
  { key: 'driver', label: 'Drivers', one: 'Driver', color: '#eda100' },
  { key: 'passenger', label: 'Passengers', one: 'Passenger', color: '#e87ba4' },
  { key: 'other', label: 'Micromobility & other', one: 'Micromobility/other', color: '#008300' },
];

const FACTORS = [
  'Aggressive driving',
  'Distracted driving',
  'Red light running',
  'Heavy truck',
  'Older adult involved',
  'School-age child involved',
];

// Year-comparison lines get their own colours in the order years are added.
const YEAR_COLORS = [INK, '#2a78d6', '#eb6834', '#6250d6', '#1baf7a'];

const FATAL_COLOR = '#96201c';
const SERIOUS_COLOR = '#f0926f';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const AGE_BINS = [
  [0, 14, '0–14'], [15, 24, '15–24'], [25, 34, '25–34'], [35, 44, '35–44'],
  [45, 54, '45–54'], [55, 64, '55–64'], [65, 74, '65–74'], [75, 200, '75+'],
];

const SEVERITY = [
  ['ksi', 'Killed or seriously injured'],
  ['fatal', 'Killed'],
  ['serious', 'Seriously injured'],
];

const tooltipBox = {
  background: '#ffffff',
  border: `1px solid ${GRID}`,
  borderRadius: 6,
  fontSize: 12,
  color: INK,
  padding: '8px 10px',
  boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
};

function fmtDate(iso, opts = { month: 'short', day: 'numeric' }) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-CA', opts);
}

function pct(now, before) {
  if (!before) return null;
  return ((now - before) / before) * 100;
}

function heading(severity) {
  if (severity === 'fatal') return 'People killed';
  if (severity === 'serious') return 'People seriously injured';
  return 'People killed or seriously injured';
}

// Decode the compact rows once into objects with the date parts every view
// needs.
function decode(raw) {
  const epoch = Date.parse(`${raw.epoch}T00:00:00Z`);
  return raw.rows.map(([day, hour, fatal, user, ward, age, lat, lon, collision, flags]) => {
    const d = new Date(epoch + day * 86400000);
    const month = d.getUTCMonth();
    return {
      year: d.getUTCFullYear(),
      month,
      md: (month + 1) * 100 + d.getUTCDate(),
      dow: (d.getUTCDay() + 6) % 7,
      iso: d.toISOString().slice(0, 10),
      hour,
      fatal: fatal === 1,
      user,
      ward,
      age,
      lat: lat == null ? null : 43 + lat / 1e5,
      lon: lon == null ? null : lon / 1e5 - 80,
      collision,
      flags,
    };
  });
}

// ---------- small pieces ----------

function Chip({ active, onClick, color, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-bold cursor-pointer transition-colors"
      style={{
        background: active ? INK : 'var(--panel)',
        color: active ? '#fff' : INK2,
        border: `1.5px solid ${active ? INK : 'var(--line)'}`,
      }}
    >
      {color && (
        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color, opacity: active ? 1 : 0.45 }} />
      )}
      {children}
    </button>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded overflow-hidden" style={{ border: '1.5px solid var(--line)' }}>
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className="px-2.5 py-1.5 text-xs font-bold cursor-pointer"
          style={value === key ? { background: INK, color: '#fff' } : { background: 'var(--panel)', color: INK2 }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Panel({ title, controls, children, className = '' }) {
  return (
    <section className={`dd-panel-ruled p-4 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="font-bold text-base" style={{ color: INK }}>{title}</h2>
        {controls && <div className="flex flex-wrap items-center gap-2">{controls}</div>}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div className="dd-panel-ruled p-4">
      <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: INK3 }}>{label}</p>
      <p className="dd-title text-3xl sm:text-4xl" style={{ color: INK }}>{value}</p>
      {sub && <p className="text-xs mt-1.5" style={{ color: INK2 }}>{sub}</p>}
    </div>
  );
}

function Change({ value }) {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  if (rounded === 0) return '0%';
  return `${rounded > 0 ? '▲' : '▼'} ${Math.abs(rounded)}%`;
}

// Milestone label drawn above the plot. Each milestone gets its own row so
// labels never overlap however narrow the chart gets.
// Milestone label drawn above the plot. On a wide chart each milestone gets
// its own row of text; on a narrow one the text can't fit, so the lines get
// numbered badges keyed in the list under the chart.
const NARROW_PLOT = 520;

function EventLabel({ viewBox, text, row, major }) {
  const plot = usePlotArea();
  if (!viewBox) return null;
  const { x, y } = viewBox;
  if (plot && plot.width < NARROW_PLOT) {
    // Alternate heights so badges for close-together milestones don't touch.
    const cy = y - 20 - (row % 2) * 19;
    return (
      <g>
        <line x1={x} x2={x} y1={cy + 8} y2={y} stroke={major ? INK : INK3} strokeWidth={major ? 1.5 : 1} />
        <circle cx={x} cy={cy} r={8} fill={major ? INK : '#fff'} stroke={major ? INK : INK3} strokeWidth={1.25} />
        <text x={x} y={cy + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill={major ? '#fff' : INK}>
          {row + 1}
        </text>
      </g>
    );
  }
  const ty = y - 44 + row * 12;
  // Flip to the left of the line when the text would run off the plot.
  const flip = plot && x + 4 + text.length * 6 > plot.x + plot.width;
  return (
    <g>
      <line x1={x} x2={x} y1={ty - 9} y2={y} stroke={major ? INK : INK3} strokeWidth={major ? 1.5 : 1} />
      <text x={flip ? x - 4 : x + 4} y={ty} textAnchor={flip ? 'end' : 'start'} fontSize={11} fontWeight={major ? 700 : 500} fill={major ? INK : INK2}>
        {text}
      </text>
    </g>
  );
}

// Key for the numbered badges, shown only where the chart is narrow enough to
// use them (the sm breakpoint lines up with NARROW_PLOT).
function EventKey() {
  return (
    <ol className="sm:hidden mt-2 flex flex-col gap-0.5 text-xs" style={{ color: INK2 }}>
      {EVENTS.map((e, i) => (
        <li key={e.label} className="flex items-center gap-1.5">
          <span
            className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold"
            style={e.major ? { background: INK, color: '#fff' } : { border: `1.25px solid ${INK3}`, color: INK }}
          >
            {i + 1}
          </span>
          {e.label}, {e.date}
        </li>
      ))}
    </ol>
  );
}

function eventLines(keyFor, position) {
  return EVENTS.map((e, i) => (
    <ReferenceLine
      key={e.label}
      x={keyFor(e)}
      position={position ? position(e) : undefined}
      stroke={e.major ? INK : INK3}
      strokeWidth={e.major ? 1.5 : 1}
      strokeDasharray={e.major ? undefined : '3 3'}
      ifOverflow="extendDomain"
      label={<EventLabel text={e.label} row={i} major={e.major} />}
    />
  ));
}

function StackTooltip({ active, payload, label, partialNote }) {
  if (!active || !payload?.length) return null;
  const items = payload.filter((p) => p.value > 0).reverse();
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div style={tooltipBox}>
      <p className="font-bold mb-1">{label}{partialNote && String(label) === partialNote.key ? ` (to ${partialNote.text})` : ''}</p>
      {items.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 justify-between" style={{ minWidth: 150 }}>
          <span className="inline-flex items-center gap-1.5" style={{ color: INK2 }}>
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-semibold">{p.value}</span>
        </p>
      ))}
      {items.length > 1 && (
        <p className="flex justify-between font-bold mt-1 pt-1" style={{ borderTop: `1px solid ${GRID}` }}>
          <span>Total</span><span>{total}</span>
        </p>
      )}
    </div>
  );
}

function LinesTooltip({ active, payload, label, fmt = (v) => v }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={tooltipBox}>
      <p className="font-bold mb-1">{label}</p>
      {payload.filter((p) => p.value != null).map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 justify-between" style={{ minWidth: 140 }}>
          <span className="inline-flex items-center gap-1.5" style={{ color: INK2 }}>
            <span className="inline-block w-3 h-0.5" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-semibold">{fmt(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

// ---------- map ----------

function KsiMap({ people, places }) {
  const mapRef = useRef(null);
  const mapObj = useRef(null);
  const layerRef = useRef(null);
  const leafletRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    import('leaflet').then((mod) => {
      if (disposed || !mapRef.current) return;
      import('leaflet/dist/leaflet.css');
      const L = mod.default || mod;
      leafletRef.current = L;
      const map = L.map(mapRef.current, { preferCanvas: true, zoomSnap: 0.5, scrollWheelZoom: false });
      map.fitBounds([[43.58, -79.64], [43.86, -79.12]]);
      L.tileLayer(cartoTileUrl('light_all'), {
        attribution: CARTO_ATTRIBUTION,
        subdomains: CARTO_SUBDOMAINS,
        maxZoom: 19,
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapObj.current = map;
      setReady(true);
    });
    return () => {
      disposed = true;
      mapObj.current?.remove();
      mapObj.current = null;
    };
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const layer = layerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();

    const byCollision = new Map();
    for (const p of people) {
      if (p.lat == null) continue;
      let c = byCollision.get(p.collision);
      if (!c) {
        c = { lat: p.lat, lon: p.lon, iso: p.iso, hour: p.hour, people: [], fatal: false };
        byCollision.set(p.collision, c);
      }
      c.people.push(p);
      if (p.fatal) c.fatal = true;
    }
    // Fatal collisions last so they draw on top.
    const list = [...byCollision.entries()].sort((a, b) => a[1].fatal - b[1].fatal);
    for (const [id, c] of list) {
      const marker = L.circleMarker([c.lat, c.lon], {
        radius: c.fatal ? 5 : 3.5,
        color: '#ffffff',
        weight: 1,
        fillColor: c.fatal ? FATAL_COLOR : SERIOUS_COLOR,
        fillOpacity: 0.9,
      });
      marker.bindPopup(() => {
        const rows = c.people.map((p) => {
          const age = p.age >= 0 ? `, ${p.age}` : '';
          return `<div>${USERS[p.user].one}${age}: <b>${p.fatal ? 'killed' : 'seriously injured'}</b></div>`;
        }).join('');
        const time = c.hour >= 0 ? `, ${String(c.hour).padStart(2, '0')}:00` : '';
        return `<div style="font-family:inherit;font-size:12px;line-height:1.45">
          <div style="font-weight:700">${places[id] || 'Unknown location'}</div>
          <div style="color:${INK2};margin-bottom:4px">${fmtDate(c.iso, { year: 'numeric', month: 'short', day: 'numeric' })}${time}</div>
          ${rows}</div>`;
      });
      marker.addTo(layer);
    }
  }, [ready, people, places]);

  return <div ref={mapRef} className="h-[460px] w-full rounded" style={{ background: PAPER }} />;
}

// ---------- page ----------

export default function VisionZeroContent() {
  const [raw, setRaw] = useState(null);
  const [error, setError] = useState(null);

  const [severity, setSeverity] = useState('ksi');
  const [users, setUsers] = useState(() => new Set(USERS.map((_, i) => i)));
  const [ward, setWard] = useState(0);
  const [factor, setFactor] = useState(-1);

  const [trendView, setTrendView] = useState('year');
  const [samePeriod, setSamePeriod] = useState(false);
  const [showTable, setShowTable] = useState(false);

  const [compareMode, setCompareMode] = useState('cumulative');
  const [compareYears, setCompareYears] = useState(null);
  const [showBaseline, setShowBaseline] = useState(true);

  const [fromYear, setFromYear] = useState(null);
  const [toYear, setToYear] = useState(null);
  const [hoverCell, setHoverCell] = useState(null);

  useEffect(() => {
    fetch('/vision-zero-ksi.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then(setRaw)
      .catch((e) => setError(String(e.message || e)));
  }, []);

  const people = useMemo(() => (raw ? decode(raw) : []), [raw]);
  const lastDate = raw?.lastDate;
  const curYear = lastDate ? Number(lastDate.slice(0, 4)) : null;
  const cutMD = lastDate ? Number(lastDate.slice(5, 7)) * 100 + Number(lastDate.slice(8, 10)) : 1231;
  const cutLabel = lastDate ? fmtDate(lastDate) : '';
  const years = useMemo(() => {
    if (!curYear) return [];
    return Array.from({ length: curYear - 2006 + 1 }, (_, i) => 2006 + i);
  }, [curYear]);

  useEffect(() => {
    if (!curYear) return;
    setCompareYears((v) => v ?? [curYear, curYear - 1]);
    setFromYear((v) => v ?? curYear - 4);
    setToYear((v) => v ?? curYear);
  }, [curYear]);

  const sevOk = (p) => (severity === 'fatal' ? p.fatal : severity === 'serious' ? !p.fatal : true);

  // Everything except severity, so the tiles can show killed and injured
  // side by side.
  const base = useMemo(() => people.filter((p) => users.has(p.user)
    && (!ward || p.ward === ward)
    && (factor < 0 || (p.flags & (1 << factor)))), [people, users, ward, factor]);
  const filtered = useMemo(() => base.filter(sevOk), [base, severity]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeUsers = USERS.map((u, i) => ({ ...u, i })).filter((u) => users.has(u.i));

  // ----- tiles -----
  const tiles = useMemo(() => {
    if (!curYear) return null;
    const ytd = (p, y) => p.year === y && p.md <= cutMD;
    const count = (list, y) => list.filter((p) => ytd(p, y)).length;
    const killed = base.filter((p) => p.fatal);
    const injured = base.filter((p) => !p.fatal);
    const nBase = BASELINE[1] - BASELINE[0] + 1;
    let baseSum = 0;
    for (let y = BASELINE[0]; y <= BASELINE[1]; y += 1) baseSum += count(filtered, y);
    return {
      killed: count(killed, curYear),
      killedPrev: count(killed, curYear - 1),
      injured: count(injured, curYear),
      injuredPrev: count(injured, curYear - 1),
      now: count(filtered, curYear),
      prev: count(filtered, curYear - 1),
      baseline: baseSum / nBase,
    };
  }, [base, filtered, curYear, cutMD]);

  // ----- annual -----
  const annual = useMemo(() => years.map((y) => {
    const row = { year: String(y) };
    USERS.forEach((u) => { row[u.key] = 0; });
    return row;
  }), [years]);
  const annualData = useMemo(() => {
    const rows = annual.map((r) => ({ ...r }));
    for (const p of filtered) {
      if (samePeriod && p.md > cutMD) continue;
      const r = rows[p.year - 2006];
      if (r) r[USERS[p.user].key] += 1;
    }
    return rows;
  }, [annual, filtered, samePeriod, cutMD]);

  // ----- monthly timeline -----
  const monthly = useMemo(() => {
    if (!curYear) return [];
    const lastMonth = Number(lastDate.slice(5, 7)) - 1;
    const counts = new Map();
    for (const p of filtered) {
      const k = p.year * 12 + p.month;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const out = [];
    for (let y = 2006; y <= curYear; y += 1) {
      for (let m = 0; m < 12; m += 1) {
        if (y === curYear && m > lastMonth) break;
        out.push({ key: `${y}-${String(m + 1).padStart(2, '0')}`, label: `${MONTHS[m]} ${y}`, value: counts.get(y * 12 + m) || 0 });
      }
    }
    // Rolling 12-month average, stopping before the partial last month.
    const lastDay = Number(lastDate.slice(8, 10));
    const complete = lastDay >= 28 ? out.length : out.length - 1;
    for (let i = 11; i < complete; i += 1) {
      let s = 0;
      for (let j = i - 11; j <= i; j += 1) s += out[j].value;
      out[i].avg = Math.round((s / 12) * 10) / 10;
    }
    return out;
  }, [filtered, curYear, lastDate]);

  // ----- year comparison -----
  const compareData = useMemo(() => {
    if (!compareYears || !curYear) return [];
    const lastMonth = Number(lastDate.slice(5, 7)) - 1;
    const grid = {};
    for (const p of filtered) {
      (grid[p.year] ||= Array(12).fill(0))[p.month] += 1;
    }
    const baseAvg = Array(12).fill(0);
    for (let y = BASELINE[0]; y <= BASELINE[1]; y += 1) {
      (grid[y] || Array(12).fill(0)).forEach((v, m) => { baseAvg[m] += v / (BASELINE[1] - BASELINE[0] + 1); });
    }
    const series = {};
    for (const y of compareYears) {
      const vals = grid[y] || Array(12).fill(0);
      let run = 0;
      series[y] = vals.map((v, m) => {
        if (y === curYear && m > lastMonth) return null;
        run += v;
        return compareMode === 'cumulative' ? run : v;
      });
    }
    let runB = 0;
    const baseSeries = baseAvg.map((v) => {
      runB += v;
      return Math.round((compareMode === 'cumulative' ? runB : v) * 10) / 10;
    });
    return MONTHS.map((m, i) => {
      const row = { month: m, baseline: baseSeries[i] };
      for (const y of compareYears) row[y] = series[y][i];
      return row;
    });
  }, [filtered, compareYears, compareMode, curYear, lastDate]);

  const yearColor = (y) => YEAR_COLORS[(compareYears || []).indexOf(y) % YEAR_COLORS.length];

  // ----- period views -----
  const inPeriod = useMemo(() => {
    if (fromYear == null) return [];
    const lo = Math.min(fromYear, toYear);
    const hi = Math.max(fromYear, toYear);
    return filtered.filter((p) => p.year >= lo && p.year <= hi);
  }, [filtered, fromYear, toYear]);

  const byWard = useMemo(() => {
    if (!raw) return [];
    // Ignores the ward filter so the selected ward can be seen against the rest.
    const lo = Math.min(fromYear, toYear);
    const hi = Math.max(fromYear, toYear);
    const counts = {};
    for (const p of people) {
      if (!users.has(p.user) || !sevOk(p) || p.year < lo || p.year > hi || !p.ward) continue;
      if (factor >= 0 && !(p.flags & (1 << factor))) continue;
      counts[p.ward] = (counts[p.ward] || 0) + 1;
    }
    return Object.entries(raw.wards)
      .map(([n, name]) => ({ n: Number(n), name, count: counts[n] || 0 }))
      .sort((a, b) => b.count - a.count);
  }, [raw, people, users, severity, factor, fromYear, toYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const byAge = useMemo(() => AGE_BINS.map(([lo, hi, label]) => {
    const row = { label };
    USERS.forEach((u) => { row[u.key] = 0; });
    for (const p of inPeriod) if (p.age >= lo && p.age <= hi) row[USERS[p.user].key] += 1;
    return row;
  }), [inPeriod]);

  const heat = useMemo(() => {
    const g = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const p of inPeriod) if (p.hour >= 0) g[p.dow][p.hour] += 1;
    const max = Math.max(1, ...g.flat());
    return { g, max };
  }, [inPeriod]);

  const factorShares = useMemo(() => FACTORS.map((label, i) => {
    const n = inPeriod.filter((p) => p.flags & (1 << i)).length;
    return { label, i, n, share: inPeriod.length ? n / inPeriod.length : 0 };
  }), [inPeriod]);

  if (error) {
    return <p className="py-20 text-center" style={{ color: INK2 }}>Could not load data ({error}).</p>;
  }

  const toggleUser = (i) => {
    setUsers((prev) => {
      const next = new Set(prev);
      if (next.has(i)) {
        if (next.size === 1) return prev;
        next.delete(i);
      } else next.add(i);
      return next;
    });
  };
  const allUsers = users.size === USERS.length;

  const addYear = (y) => {
    if (!y) return;
    setCompareYears((v) => (v.includes(y) || v.length >= YEAR_COLORS.length ? v : [...v, y]));
  };
  const removeYear = (y) => setCompareYears((v) => v.filter((x) => x !== y));

  const wardName = ward && raw ? `Ward ${ward} ${raw.wards[ward]}` : null;
  const periodLabel = fromYear === toYear ? `${fromYear}` : `${Math.min(fromYear, toYear)}–${Math.max(fromYear, toYear)}`;
  const partialNote = curYear && !samePeriod ? { key: String(curYear), text: cutLabel } : null;
  const maxWard = Math.max(1, ...byWard.map((w) => w.count));

  return (
    <div className="min-h-screen" style={{ background: 'var(--paper)' }}>
      <div className="container mx-auto px-4 max-w-6xl pt-4 pb-12">
        <h1 className="dd-title text-4xl sm:text-5xl mb-4" style={{ color: INK }}>
          Toronto Vision Zero Dashboard
        </h1>

        {!raw ? (
          <p className="dd-title text-xl py-20 text-center" style={{ color: INK2 }}>Loading…</p>
        ) : (
          <>
            {/* Filters */}
            <div
              className="sm:sticky top-0 z-[500] -mx-4 px-4 py-3 mb-5 flex flex-col gap-2"
              style={{ background: PAPER, borderBottom: '1px solid var(--line)' }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Segmented value={severity} onChange={setSeverity} options={SEVERITY} />
                <select
                  className="dd-select dd-select-chevron"
                  style={{ padding: '0.35rem 2rem 0.35rem 0.6rem', fontSize: '0.75rem' }}
                  value={ward}
                  onChange={(e) => setWard(Number(e.target.value))}
                  aria-label="Ward"
                >
                  <option value={0}>All wards</option>
                  {Object.entries(raw.wards).map(([n, name]) => (
                    <option key={n} value={n}>{n}. {name}</option>
                  ))}
                </select>
                <select
                  className="dd-select dd-select-chevron"
                  style={{ padding: '0.35rem 2rem 0.35rem 0.6rem', fontSize: '0.75rem' }}
                  value={factor}
                  onChange={(e) => setFactor(Number(e.target.value))}
                  aria-label="Collision factor"
                >
                  <option value={-1}>Any collision</option>
                  {FACTORS.map((f, i) => <option key={f} value={i}>{f}</option>)}
                </select>
                <span className="text-xs ml-auto" style={{ color: INK3 }}>Data to {fmtDate(lastDate, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip active={allUsers} onClick={() => setUsers(new Set(USERS.map((_, i) => i)))}>All road users</Chip>
                {USERS.map((u, i) => (
                  <Chip key={u.key} active={!allUsers && users.has(i)} color={u.color} onClick={() => (allUsers ? setUsers(new Set([i])) : toggleUser(i))}>
                    {u.label}
                  </Chip>
                ))}
              </div>
            </div>

            {/* Tiles */}
            <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: INK3 }}>
              {curYear} to {cutLabel}{wardName ? ` · ${wardName}` : ''}
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <Tile label="Killed" value={tiles.killed} sub={`${tiles.killedPrev} in same period of ${curYear - 1}`} />
              <Tile label="Seriously injured" value={tiles.injured} sub={`${tiles.injuredPrev} in same period of ${curYear - 1}`} />
              <Tile
                label={`vs. ${curYear - 1}`}
                value={<Change value={pct(tiles.now, tiles.prev)} />}
                sub={`${tiles.now} vs. ${tiles.prev} ${severity === 'fatal' ? 'killed' : severity === 'serious' ? 'seriously injured' : 'KSI'}`}
              />
              <Tile
                label="vs. before Vision Zero"
                value={<Change value={pct(tiles.now, tiles.baseline)} />}
                sub={`${BASELINE[0]}–${String(BASELINE[1]).slice(2)} average: ${Math.round(tiles.baseline)}`}
              />
            </div>

            {/* Trend */}
            <Panel
              className="mb-6"
              title={`${heading(severity)} by ${trendView}`}
              controls={(
                <>
                  <Segmented value={trendView} onChange={setTrendView} options={[['year', 'Year'], ['month', 'Month']]} />
                  {trendView === 'year' && (
                    <>
                      <Segmented
                        value={samePeriod ? 'ytd' : 'full'}
                        onChange={(v) => setSamePeriod(v === 'ytd')}
                        options={[['full', 'Full year'], ['ytd', `Jan 1–${cutLabel}`]]}
                      />
                      <Segmented value={showTable ? 'table' : 'chart'} onChange={(v) => setShowTable(v === 'table')} options={[['chart', 'Chart'], ['table', 'Table']]} />
                    </>
                  )}
                </>
              )}
            >
              {trendView === 'year' && !showTable && (
                <>
                  <ResponsiveContainer width="100%" height={340}>
                    <BarChart data={annualData} margin={{ top: 54, right: 8, bottom: 0, left: -18 }} barCategoryGap="18%">
                      <CartesianGrid stroke={GRID} vertical={false} />
                      <ReferenceArea x1={String(VZ_YEAR)} x2={String(curYear)} fill={PAPER} fillOpacity={0.9} ifOverflow="extendDomain" />
                      <XAxis dataKey="year" tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={6}
                        tickFormatter={(y) => (Number(y) === curYear && !samePeriod ? `${y}*` : y)} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={false} />
                      <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} content={<StackTooltip partialNote={partialNote} />} />
                      {activeUsers.map((u, idx) => (
                        <Bar key={u.key} dataKey={u.key} name={u.label} stackId="a" fill={u.color}
                          stroke="#fff" strokeWidth={1}
                          radius={idx === activeUsers.length - 1 ? [3, 3, 0, 0] : 0} isAnimationActive={false}>
                          {annualData.map((r) => (
                            <Cell key={r.year} fillOpacity={Number(r.year) === curYear && !samePeriod ? 0.5 : 1} />
                          ))}
                        </Bar>
                      ))}
                      {eventLines((e) => String(e.year), (e) => e.yearPos || 'middle')}
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs" style={{ color: INK2 }}>
                    {activeUsers.map((u) => (
                      <span key={u.key} className="inline-flex items-center gap-1.5">
                        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: u.color }} />{u.label}
                      </span>
                    ))}
                    {!samePeriod && <span className="ml-auto" style={{ color: INK3 }}>* to {cutLabel}</span>}
                  </div>
                  <EventKey />
                </>
              )}

              {trendView === 'year' && showTable && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs tabular-nums">
                    <thead>
                      <tr style={{ color: INK3 }}>
                        <th className="text-left py-1.5 pr-3 font-bold">Year</th>
                        {activeUsers.map((u) => <th key={u.key} className="text-right py-1.5 px-2 font-bold">{u.label}</th>)}
                        <th className="text-right py-1.5 pl-2 font-bold">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...annualData].reverse().map((r) => (
                        <tr key={r.year} style={{ borderTop: `1px solid ${GRID}`, color: INK }}>
                          <td className="py-1.5 pr-3 font-bold">{r.year}{Number(r.year) === curYear && !samePeriod ? '*' : ''}</td>
                          {activeUsers.map((u) => <td key={u.key} className="text-right py-1.5 px-2">{r[u.key]}</td>)}
                          <td className="text-right py-1.5 pl-2 font-bold">{activeUsers.reduce((s, u) => s + r[u.key], 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {trendView === 'month' && (
                <>
                  <ResponsiveContainer width="100%" height={340}>
                    <LineChart data={monthly} margin={{ top: 54, right: 8, bottom: 0, left: -18 }}>
                      <CartesianGrid stroke={GRID} vertical={false} />
                      <ReferenceArea x1={EVENTS[0].month} x2={monthly[monthly.length - 1]?.key} fill={PAPER} fillOpacity={0.9} ifOverflow="extendDomain" />
                      <XAxis dataKey="key" tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={{ stroke: GRID }}
                        ticks={monthly.filter((m) => m.key.endsWith('-01') && Number(m.key.slice(0, 4)) % 2 === 0).map((m) => m.key)}
                        tickFormatter={(k) => k.slice(0, 4)} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={false} />
                      <Tooltip content={<LinesTooltip />} labelFormatter={() => ''}
                        cursor={{ stroke: INK3, strokeWidth: 1 }} />
                      <Line dataKey="value" name="Month" stroke="#9fb9da" strokeWidth={1.25} dot={false} isAnimationActive={false} />
                      <Line dataKey="avg" name="12-month average" stroke="#2a78d6" strokeWidth={2.5} dot={false} isAnimationActive={false} connectNulls={false} />
                      {eventLines((e) => e.month)}
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs" style={{ color: INK2 }}>
                    <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 h-px" style={{ background: '#9fb9da', height: 2 }} />Monthly</span>
                    <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4" style={{ background: '#2a78d6', height: 3 }} />12-month average</span>
                  </div>
                  <EventKey />
                </>
              )}
            </Panel>

            {/* Compare years */}
            <Panel
              className="mb-6"
              title="Compare years"
              controls={<Segmented value={compareMode} onChange={setCompareMode} options={[['cumulative', 'Running total'], ['monthly', 'Per month']]} />}
            >
              <div className="flex flex-wrap items-center gap-1.5 mb-3">
                {(compareYears || []).map((y) => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => removeYear(y)}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-bold cursor-pointer"
                    style={{ background: 'var(--panel)', border: '1.5px solid var(--line)', color: INK }}
                    aria-label={`Remove ${y}`}
                  >
                    <span className="inline-block w-3 h-[3px] rounded" style={{ background: yearColor(y) }} />
                    {y}
                    <X size={12} color={INK3} />
                  </button>
                ))}
                {compareYears && compareYears.length < YEAR_COLORS.length && (
                  <select
                    className="dd-select dd-select-chevron"
                    style={{ padding: '0.3rem 2rem 0.3rem 0.6rem', fontSize: '0.75rem' }}
                    value=""
                    onChange={(e) => addYear(Number(e.target.value))}
                    aria-label="Add a year"
                  >
                    <option value="">+ Add year</option>
                    {[...years].reverse().filter((y) => !compareYears.includes(y)).map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                )}
                <label className="inline-flex items-center gap-1.5 text-xs font-bold ml-1 cursor-pointer" style={{ color: INK2 }}>
                  <input type="checkbox" checked={showBaseline} onChange={(e) => setShowBaseline(e.target.checked)} />
                  {BASELINE[0]}–{String(BASELINE[1]).slice(2)} average
                </label>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={compareData} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={{ stroke: GRID }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<LinesTooltip fmt={(v) => (Number.isInteger(v) ? v : v.toFixed(1))} />} cursor={{ stroke: INK3, strokeWidth: 1 }} />
                  {showBaseline && (
                    <Line dataKey="baseline" name={`${BASELINE[0]}–${String(BASELINE[1]).slice(2)} avg`} stroke={INK3} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                  )}
                  {(compareYears || []).map((y) => (
                    <Line key={y} dataKey={String(y)} name={y === curYear ? `${y} (to ${cutLabel})` : String(y)} stroke={yearColor(y)}
                      strokeWidth={y === curYear ? 2.75 : 2} dot={{ r: 2.5, strokeWidth: 0, fill: yearColor(y) }}
                      activeDot={{ r: 4.5, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} connectNulls={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </Panel>

            {/* Period */}
            <div className="flex flex-wrap items-center gap-2 mb-3 mt-10">
              <h2 className="dd-title text-2xl mr-2" style={{ color: INK }}>Where and who</h2>
              <select className="dd-select dd-select-chevron" style={{ padding: '0.35rem 2rem 0.35rem 0.6rem', fontSize: '0.75rem' }}
                value={fromYear ?? ''} onChange={(e) => setFromYear(Number(e.target.value))} aria-label="From year">
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <span className="text-xs font-bold" style={{ color: INK3 }}>to</span>
              <select className="dd-select dd-select-chevron" style={{ padding: '0.35rem 2rem 0.35rem 0.6rem', fontSize: '0.75rem' }}
                value={toYear ?? ''} onChange={(e) => setToYear(Number(e.target.value))} aria-label="To year">
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <div className="flex gap-1.5">
                <Chip active={fromYear === 2006 && toYear === VZ_YEAR - 1} onClick={() => { setFromYear(2006); setToYear(VZ_YEAR - 1); }}>Before Vision Zero</Chip>
                <Chip active={fromYear === VZ_YEAR + 1 && toYear === curYear} onClick={() => { setFromYear(VZ_YEAR + 1); setToYear(curYear); }}>Since Vision Zero</Chip>
              </div>
            </div>

            <Panel className="mb-6" title={`${heading(severity)}, ${periodLabel} · ${inPeriod.length.toLocaleString()}`}>
              <KsiMap people={inPeriod} places={raw.places} />
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs" style={{ color: INK2 }}>
                <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: FATAL_COLOR }} />Fatal collision</span>
                <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full" style={{ background: SERIOUS_COLOR }} />Serious injury collision</span>
              </div>
            </Panel>

            <div className="grid lg:grid-cols-2 gap-6 mb-6">
              <Panel title="By ward">
                <div>
                  {byWard.map((w) => {
                    const selected = ward === w.n;
                    return (
                      <button
                        key={w.n}
                        type="button"
                        onClick={() => setWard(selected ? 0 : w.n)}
                        className="w-full grid grid-cols-[minmax(0,11rem)_1fr_2.5rem] items-center gap-2 py-[3px] text-xs text-left cursor-pointer rounded hover:bg-[var(--paper)]"
                        title={selected ? 'Show all wards' : `Filter to Ward ${w.n}`}
                      >
                        <span className="truncate" style={{ color: selected ? INK : INK2, fontWeight: selected ? 700 : 500 }}>
                          {w.n}. {w.name}
                        </span>
                        <span className="h-3 rounded-r" style={{ width: `${(w.count / maxWard) * 100}%`, background: selected ? INK : (ward ? '#c9c6b8' : '#2a78d6') }} />
                        <span className="text-right tabular-nums font-semibold" style={{ color: INK }}>{w.count}</span>
                      </button>
                    );
                  })}
                </div>
              </Panel>

              <div className="flex flex-col gap-6">
                <Panel title="By age">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={byAge} margin={{ top: 4, right: 4, bottom: 0, left: -22 }} barCategoryGap="16%">
                      <CartesianGrid stroke={GRID} vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: INK3 }} tickLine={false} axisLine={{ stroke: GRID }} interval={0} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={false} />
                      <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} content={<StackTooltip />} />
                      {activeUsers.map((u, idx) => (
                        <Bar key={u.key} dataKey={u.key} name={u.label} stackId="a" fill={u.color} stroke="#fff" strokeWidth={1}
                          radius={idx === activeUsers.length - 1 ? [3, 3, 0, 0] : 0} isAnimationActive={false} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </Panel>

                <Panel title="Collision factors">
                  <div className="flex flex-col gap-1.5">
                    {factorShares.map((f) => (
                      <button
                        key={f.label}
                        type="button"
                        onClick={() => setFactor(factor === f.i ? -1 : f.i)}
                        className="grid grid-cols-[11rem_1fr_3rem] items-center gap-2 text-xs text-left cursor-pointer rounded hover:bg-[var(--paper)]"
                        title={`${f.n.toLocaleString()} people`}
                      >
                        <span style={{ color: factor === f.i ? INK : INK2, fontWeight: factor === f.i ? 700 : 500 }}>{f.label}</span>
                        <span className="h-3 rounded-r" style={{ width: `${f.share * 100}%`, background: factor === f.i ? INK : '#6250d6' }} />
                        <span className="text-right tabular-nums font-semibold" style={{ color: INK }}>{Math.round(f.share * 100)}%</span>
                      </button>
                    ))}
                  </div>
                </Panel>
              </div>
            </div>

            <Panel className="mb-6" title="Day and hour">
              <div className="overflow-x-auto">
                <div className="min-w-[560px]" onMouseLeave={() => setHoverCell(null)}>
                  <div className="grid gap-[2px]" style={{ gridTemplateColumns: '2.25rem repeat(24, minmax(0, 1fr))' }}>
                    {heat.g.map((row, d) => (
                      <div key={DAYS[d]} className="contents">
                        <span className="text-xs font-semibold self-center" style={{ color: INK3 }}>{DAYS[d]}</span>
                        {row.map((v, h) => {
                          const t = v / heat.max;
                          return (
                            <span
                              key={h}
                              onMouseEnter={() => setHoverCell({ d, h, v })}
                              onClick={() => setHoverCell({ d, h, v })}
                              className="h-6 rounded-[2px]"
                              style={{
                                background: v ? `color-mix(in oklab, ${FATAL_COLOR} ${Math.round(8 + t * 92)}%, #fbf1ea)` : '#f6f5f0',
                                outline: hoverCell && hoverCell.d === d && hoverCell.h === h ? `2px solid ${INK}` : 'none',
                              }}
                            />
                          );
                        })}
                      </div>
                    ))}
                    <span />
                    {Array.from({ length: 24 }, (_, h) => (
                      <span key={h} className="text-[10px] text-center" style={{ color: INK3 }}>{h % 3 === 0 ? h : ''}</span>
                    ))}
                  </div>
                </div>
              </div>
              <p className="text-xs mt-2 h-4" style={{ color: INK2 }}>
                {hoverCell
                  ? `${DAYS[hoverCell.d]} ${String(hoverCell.h).padStart(2, '0')}:00–${String(hoverCell.h + 1).padStart(2, '0')}:00 · ${hoverCell.v} ${hoverCell.v === 1 ? 'person' : 'people'}`
                  : ''}
              </p>
            </Panel>

            <p className="text-xs" style={{ color: INK3 }}>
              Counts people, not collisions. Source: Toronto Police Service KSI data via{' '}
              <a className="dd-link-accent" href={raw.source} target="_blank" rel="noopener noreferrer">City of Toronto Open Data</a>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
