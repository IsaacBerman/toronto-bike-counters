'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { LINES, segmentsBetween, spanBetween, segmentLabel } from '../../lib/slow-zones/stations';
import { VALUE_OF_TIME, zoneDailyRiders } from '../../lib/slow-zones/ridership';

const ACCENT = '#e8590c';
const INK = '#16150f';
const INK2 = '#57554b';
const INK3 = '#8a887c';
const GRID = '#e5e3da';

// Severity ramp: one hue, light -> dark as the restriction tightens
// (validated ordinal ramp on the paper surface). 0 km/h means trains are
// held/diverted through the zone.
const SEVERITY = [
  { max: 0, color: '#5f0a18', label: '0 km/h (stopped)' },
  { max: 15, color: '#96201c', label: '≤ 15 km/h' },
  { max: 25, color: '#c23a24', label: '16–25 km/h' },
  { max: 35, color: '#dd6746', label: '26–35 km/h' },
  { max: Infinity, color: '#f0926f', label: '36+ km/h' },
];

function severityFor(reducedKmh) {
  return SEVERITY.find((s) => reducedKmh <= s.max) || SEVERITY[SEVERITY.length - 1];
}

// Estimated added travel time for one pass through a zone: its slow-track
// length at the reduced speed vs. the normal speed. The length column is
// already the row's total across its (xN) patches, so no multiplier. A
// 0 km/h zone is counted at the TTC's stated 10 km/h crawl.
function zoneDelayMin(z) {
  if (!z.defect_m || !z.normal_kmh) return 0;
  const reduced = Math.max(z.reduced_kmh ?? 0, 10);
  return Math.max((z.defect_m / 1000) * 60 * (1 / reduced - 1 / z.normal_kmh), 0);
}

function formatDelay(min) {
  if (min >= 1) return `${(Math.round(min * 10) / 10).toLocaleString()} min`;
  return `${Math.round(min * 60)} s`;
}

// Riders crossing the zone daily x added minutes -> person-hours -> dollars.
function zoneImpact(z) {
  const riders = zoneDailyRiders(z);
  const delay = zoneDelayMin(z);
  if (riders == null || delay <= 0) return { riders, personHours: null, cost: null };
  const personHours = (riders * delay) / 60;
  return { riders, personHours, cost: personHours * VALUE_OF_TIME };
}

function formatMoney(cost) {
  if (cost == null) return '—';
  if (cost >= 1000) return `$${(Math.round(cost / 100) / 10).toLocaleString()}k`;
  return `$${Math.round(cost).toLocaleString()}`;
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

// The TTC states removal targets as "Early <Month>" / "Late <Month>", or TBD.
// Rank them chronologically, counting forward from the snapshot's own month so
// the order survives a year boundary — an "Early January" target on a December
// snapshot is next month, not eleven months ago. Returns null for TBD and
// anything unparseable, which the table's null handling pins last.
function targetRank(target, refMonth) {
  const m = String(target ?? '').trim().match(/^(early|mid|late)\s+([a-z]+)$/i);
  if (!m) return null;
  const monthIdx = MONTHS.indexOf(m[2].toLowerCase());
  if (monthIdx < 0) return null;
  const half = { early: 0, mid: 1, late: 2 }[m[1].toLowerCase()];
  return ((monthIdx - refMonth + 12) % 12) * 3 + half;
}

// Compact axis ticks. The cumulative series reaches millions over a long
// history, so short-scale past $1M keeps the axis from crowding.
function formatAxisMoney(v) {
  if (v >= 1e6) return `$${Math.round(v / 1e5) / 10}M`;
  if (v >= 1000) return `$${Math.round(v / 1000)}k`;
  return `$${v}`;
}

function formatDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

const chartTooltipStyle = {
  background: '#ffffff',
  border: `1px solid ${GRID}`,
  borderRadius: 8,
  fontSize: 12,
  color: INK,
};

function StatTile({ label, value, unit }) {
  return (
    <div className="dd-panel-ruled p-4">
      <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: INK3 }}>
        {label}
      </p>
      <p className="dd-title text-3xl" style={{ color: INK }}>
        {value}
        {unit && (
          <span className="text-base font-normal ml-1" style={{ color: INK2 }}>
            {unit}
          </span>
        )}
      </p>
    </div>
  );
}

// Day picker. A native <select> is an OS popup on macOS/iOS: it positions
// itself so the *selected* row lands under the cursor, so picking a middle day
// opens the menu over the control instead of below it. This is a listbox so
// the panel always drops downward from the button, whatever is selected.
function DayPicker({ id, days, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const listRef = useRef(null);

  const selectedIndex = Math.max(days.findIndex((d) => d.day === value), 0);

  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  // Keep the highlighted row in view when opening on a long history.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const openWith = (index) => {
    setActive(index);
    setOpen(true);
  };

  const commit = (index) => {
    const day = days[index]?.day;
    if (day) onChange(day);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openWith(selectedIndex);
      }
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, days.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(days.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      commit(active);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        onClick={() => (open ? setOpen(false) : openWith(selectedIndex))}
        onKeyDown={onKeyDown}
        className="dd-panel px-3 py-1.5 text-sm rounded border inline-flex items-center gap-2 cursor-pointer"
        style={{ color: INK, borderColor: GRID }}
      >
        {value ? formatDay(value) : ''}
        <span aria-hidden="true" style={{ color: INK2, fontSize: 15, lineHeight: 1 }}>▾</span>
      </button>
      {open && (
        <ul
          id={`${id}-listbox`}
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          className="absolute left-0 top-full mt-1 min-w-full max-h-64 overflow-y-auto rounded border py-1 shadow-lg"
          // Above Leaflet's panes/controls (400-800), which share the root
          // stacking context and would otherwise paint over the open list.
          style={{ background: 'var(--panel, #ffffff)', borderColor: GRID, zIndex: 1000 }}
        >
          {days.map((d, i) => {
            const isSelected = d.day === value;
            const isActive = i === active;
            return (
              <li
                key={d.day}
                role="option"
                aria-selected={isSelected}
                data-active={isActive}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(i)}
                className="px-3 py-1.5 text-sm cursor-pointer whitespace-nowrap"
                style={{
                  background: isActive ? ACCENT : 'transparent',
                  color: isActive ? '#ffffff' : INK,
                  fontWeight: isSelected ? 700 : 400,
                }}
              >
                {formatDay(d.day)}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ChartBlock({ title, subtitle, children }) {
  return (
    <div>
      <h3 className="font-bold text-sm mb-0.5" style={{ color: INK }}>{title}</h3>
      <p className="text-xs mb-3" style={{ color: INK3 }}>{subtitle}</p>
      {children}
    </div>
  );
}

export default function SlowZonesContent() {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [sort, setSort] = useState({ key: 'delay_min', dir: -1 });
  const [chartTab, setChartTab] = useState('delay');
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const overlayRef = useRef(null);

  useEffect(() => {
    fetch('/api/slow-zones/data')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        setHistory(data);
        if (data.days.length > 0) setSelectedDay(data.days[data.days.length - 1].day);
      })
      .catch((err) => setError(err.message));
  }, []);

  const days = history?.days || [];
  const zones = history?.zones || [];
  const selectedZones = useMemo(
    () => zones.filter((z) => z.day === selectedDay),
    [zones, selectedDay]
  );
  const selectedMeta = days.find((d) => d.day === selectedDay);

  const sortedZones = useMemo(() => {
    const { dir } = sort;
    // "Target removal" sorts on its chronological rank, not its text, or
    // "Early October" would land before "Early September".
    const key = sort.key === 'target' ? 'target_rank' : sort.key;
    const refMonth = selectedDay ? Number(selectedDay.split('-')[1]) - 1 : 0;
    return selectedZones.map((z) => {
      const impact = zoneImpact(z);
      return {
        ...z,
        delay_min: zoneDelayMin(z),
        riders_day: impact.riders,
        person_hours: impact.personHours,
        cost_day: impact.cost,
        target_rank: targetRank(z.target, refMonth),
      };
    }).sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return cmp * dir;
    });
  }, [selectedZones, sort, selectedDay]);

  const toggleSort = (key) =>
    setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }));

  // Per-day chart series: zone count, total estimated delay, slow track, and
  // estimated daily + running cumulative cost.
  const perDay = useMemo(() => {
    const delayByDay = {};
    const trackByDay = {};
    const costByDay = {};
    for (const z of zones) {
      delayByDay[z.day] = (delayByDay[z.day] || 0) + zoneDelayMin(z);
      trackByDay[z.day] = (trackByDay[z.day] || 0) + (z.defect_m || 0);
      costByDay[z.day] = (costByDay[z.day] || 0) + (zoneImpact(z).cost || 0);
    }
    let runningCost = 0;
    return days.map((d) => {
      runningCost += costByDay[d.day] || 0;
      return {
        day: d.day,
        label: formatDay(d.day),
        zones: d.zone_total,
        delayMin: Math.round((delayByDay[d.day] || 0) * 10) / 10,
        trackKm: Math.round((trackByDay[d.day] || 0) / 100) / 10,
        cost: Math.round(costByDay[d.day] || 0),
        cumulativeCost: Math.round(runningCost),
      };
    });
  }, [days, zones]);

  // Segments ranked by cumulative zone-days (a segment with 2 zones for 3
  // days scores 6).
  const topSegments = useMemo(() => {
    const counts = {};
    for (const z of zones) {
      for (const seg of segmentsBetween(z.line, z.from_station, z.to_station)) {
        const key = `${z.line}:${seg[0]}`;
        counts[key] ??= { label: segmentLabel(z.line, seg), line: z.line, zoneDays: 0 };
        counts[key].zoneDays += z.zone_count || 1;
      }
    }
    return Object.values(counts).sort((a, b) => b.zoneDays - a.zoneDays).slice(0, 10);
  }, [zones]);

  // Worst (lowest) reduced speed per segment *and direction* for the selected
  // day, for the map. The segment pair is kept in travel order so the map can
  // offset each direction to its own side and point arrows the right way.
  const segmentSeverity = useMemo(() => {
    const worst = {};
    for (const z of selectedZones) {
      for (const seg of spanBetween(z.line, z.from_station, z.to_station)) {
        const key = `${z.line}:${Math.min(seg[0], seg[1])}:${z.direction || ''}`;
        if (!(key in worst) || z.reduced_kmh < worst[key].reduced_kmh) {
          worst[key] = { seg, ...z };
        }
      }
    }
    return worst;
  }, [selectedZones]);

  // Initialize the Leaflet map once the data (and therefore the map div) has
  // rendered, drawing the static network.
  const hasData = days.length > 0;
  useEffect(() => {
    if (!hasData || !mapRef.current || mapInstanceRef.current) return;
    let cancelled = false;
    import('leaflet').then((L) => {
      import('leaflet/dist/leaflet.css');
      if (cancelled || !mapRef.current || mapInstanceRef.current) return;
      const map = L.map(mapRef.current, { zoomSnap: 0.5 });
      const allStations = Object.values(LINES).flatMap((l) => l.stations);
      map.fitBounds(
        L.latLngBounds(allStations.map(([, lat, lng]) => [lat, lng])),
        { padding: [20, 20] }
      );
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors © CARTO',
        maxZoom: 18,
      }).addTo(map);
      for (const line of Object.values(LINES)) {
        L.polyline(line.stations.map(([, lat, lng]) => [lat, lng]), {
          color: line.color, weight: 3, opacity: 0.9,
        }).addTo(map);
        for (const [name, lat, lng] of line.stations) {
          L.circleMarker([lat, lng], {
            radius: 2.5, color: '#ffffff', weight: 1, fillColor: INK, fillOpacity: 0.9,
          })
            .bindTooltip(name)
            .addTo(map);
        }
      }
      overlayRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
      setMapReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [hasData]);

  // Tear the map down only on unmount.
  useEffect(
    () => () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        overlayRef.current = null;
      }
    },
    []
  );

  // Redraw the severity overlay whenever the selected day's zones change.
  // Each direction is offset to the right of its travel direction (so a
  // segment slowed both ways shows two parallel strips) with arrows along the
  // path. Offsets are computed in pixel space and redrawn on zoom so the
  // separation stays constant on screen.
  useEffect(() => {
    if (!mapReady || !overlayRef.current) return;
    let disposed = false;
    let map;
    let L;
    let tip;
    let hitSegments = [];
    const draw = () => {
      const overlay = overlayRef.current;
      if (!overlay || !map || !L) return;
      overlay.clearLayers();
      hitSegments = [];
      for (const zone of Object.values(segmentSeverity)) {
        const stations = LINES[zone.line].stations;
        const [ai, bi] = zone.seg;
        const pA = map.latLngToLayerPoint([stations[ai][1], stations[ai][2]]);
        const pB = map.latLngToLayerPoint([stations[bi][1], stations[bi][2]]);
        const dx = pB.x - pA.x;
        const dy = pB.y - pA.y;
        const len = Math.hypot(dx, dy) || 1;
        // Right of travel in screen coords (y down): rotate (dx,dy) by +90°.
        const OFFSET_PX = 5;
        const ox = (-dy / len) * OFFSET_PX;
        const oy = (dx / len) * OFFSET_PX;
        const a2 = map.layerPointToLatLng([pA.x + ox, pA.y + oy]);
        const b2 = map.layerPointToLatLng([pB.x + ox, pB.y + oy]);
        const color = severityFor(zone.reduced_kmh).color;
        const delay = zoneDelayMin(zone);
        const impact = zoneImpact(zone);
        const tooltip =
          `<b>${zone.location}</b><br/>` +
          `${zone.reduced_kmh} km/h (normal ${zone.normal_kmh} km/h)<br/>` +
          `${zone.defect_m ?? '?'} m of track · target: ${zone.target || 'TBD'}` +
          (delay > 0 ? `<br/>est. delay +${formatDelay(delay)}` : '') +
          (impact.cost != null
            ? `<br/>≈${impact.riders.toLocaleString()} riders/day · est. ${formatMoney(impact.cost)}/day`
            : '');
        // Dark casing under a thick severity stroke: restricted segments stay
        // structurally distinct from base lines even without color vision.
        L.polyline([a2, b2], { color: INK, weight: 10, opacity: 0.85, interactive: false }).addTo(overlay);
        L.polyline([a2, b2], { color, weight: 6, opacity: 1, interactive: false }).addTo(overlay);
        // Tooltip hits are resolved by nearest-line-centre at the map level
        // (see onPointer below), so overlapping directions stay individually
        // tappable; record this segment's pixel geometry for that.
        hitSegments.push({ ax: pA.x + ox, ay: pA.y + oy, bx: pB.x + ox, by: pB.y + oy, tooltip });
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        const mid = map.layerPointToLatLng([(pA.x + pB.x) / 2 + ox, (pA.y + pB.y) / 2 + oy]);
        // Simple two-stroke chevron, drawn centred in its box so it rotates
        // about the line midpoint.
        L.marker(mid, {
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: '',
            iconSize: [14, 14],
            iconAnchor: [7, 7],
            html:
              `<div style="transform:rotate(${angle.toFixed(1)}deg);width:14px;height:14px;` +
              `filter:drop-shadow(0 0 1px rgba(0,0,0,0.8))">` +
              `<svg width="14" height="14" viewBox="0 0 14 14">` +
              `<path d="M4.5 3.5 L10 7 L4.5 10.5" fill="none" stroke="#ffffff" ` +
              `stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`,
          }),
        }).addTo(overlay);
      }
    };
    // Distance in px from a point to a segment, for nearest-zone hit testing.
    const distToSegment = (px, py, s) => {
      const dx = s.bx - s.ax;
      const dy = s.by - s.ay;
      const t = Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(px - (s.ax + t * dx), py - (s.ay + t * dy));
    };
    // Show the tooltip of whichever zone's line centre is closest to the
    // pointer (within a finger-sized radius) — with parallel directional
    // strips this picks the one you're actually nearer to.
    const HIT_RADIUS_PX = 16;
    const onPointer = (e) => {
      if (!map || !tip) return;
      const p = e.layerPoint;
      let best = null;
      let bestDist = HIT_RADIUS_PX;
      for (const s of hitSegments) {
        const d = distToSegment(p.x, p.y, s);
        if (d < bestDist) {
          bestDist = d;
          best = s;
        }
      }
      if (best) {
        tip.setContent(best.tooltip).setLatLng(e.latlng);
        map.openTooltip(tip);
      } else {
        map.closeTooltip(tip);
      }
    };
    import('leaflet').then((mod) => {
      if (disposed) return;
      L = mod.default || mod;
      map = mapInstanceRef.current;
      if (!map) return;
      tip = L.tooltip({ direction: 'top', offset: [0, -10] });
      draw();
      map.on('zoomend', draw);
      map.on('mousemove', onPointer);
      map.on('click', onPointer);
    });
    return () => {
      disposed = true;
      const m = mapInstanceRef.current;
      if (m) {
        m.off('zoomend', draw);
        m.off('mousemove', onPointer);
        m.off('click', onPointer);
        if (tip) m.closeTooltip(tip);
      }
    };
  }, [mapReady, segmentSeverity]);

  if (error) {
    return (
      <div className="min-h-screen py-20 text-center" style={{ background: 'var(--paper)' }}>
        <p style={{ color: INK2 }}>Could not load slow-zone data ({error}).</p>
      </div>
    );
  }

  const totalDelayMin = Math.round(selectedZones.reduce((sum, z) => sum + zoneDelayMin(z), 0) * 10) / 10;
  const slowTrackM = selectedZones.reduce((sum, z) => sum + (z.defect_m || 0), 0);
  const totalPersonHours = selectedZones.reduce((sum, z) => sum + (zoneImpact(z).personHours || 0), 0);
  const totalCost = totalPersonHours * VALUE_OF_TIME;

  return (
    <div className="min-h-screen" style={{ background: 'var(--paper)' }}>
      <div className="container mx-auto px-4 max-w-5xl pt-4 pb-12">
        <h1 className="dd-title text-4xl sm:text-5xl mb-4" style={{ color: INK }}>
          TTC Slow Zones
        </h1>
        {!history ? (
          <p className="dd-title text-xl py-20 text-center" style={{ color: INK2 }}>
            Loading…
          </p>
        ) : days.length === 0 ? (
          <p className="py-20 text-center" style={{ color: INK2 }}>
            No snapshots collected yet — the first daily capture will appear here.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <label className="text-xs font-bold" style={{ color: INK2 }} htmlFor="sz-day">
                Snapshot day
              </label>
              <DayPicker
                id="sz-day"
                days={days}
                value={selectedDay}
                onChange={setSelectedDay}
              />
              {selectedMeta?.as_of && (
                <span className="text-xs" style={{ color: INK3 }}>
                  TTC page timestamp: {selectedMeta.as_of}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <StatTile label="Slow zones" value={selectedMeta?.zone_total ?? 0} />
              <StatTile label="Est. added time" value={totalDelayMin} unit="min" />
              <StatTile label="Slow track" value={slowTrackM.toLocaleString()} unit="m" />
              <StatTile
                label="Est. cost"
                value={totalCost >= 1000 ? `$${Math.round(totalCost / 1000).toLocaleString()}k` : `$${Math.round(totalCost)}`}
                unit="/day"
              />
            </div>

            <div className="dd-panel-ruled p-4 mb-6">
              <h3 className="font-bold text-sm mb-2" style={{ color: INK }}>
                Slow zones on the network — {selectedDay ? formatDay(selectedDay) : ''}
              </h3>
              <div ref={mapRef} className="h-[440px] w-full rounded" />
              <p className="text-xs mt-2" style={{ color: INK3 }}>
                Hover or click a highlighted segment to see data on that zone.
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs" style={{ color: INK2 }}>
                {SEVERITY.map((s) => (
                  <span key={s.label} className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-4 h-1.5 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </span>
                ))}
                <span>
                  <span className="font-bold" aria-hidden="true">›</span> direction of travel
                </span>
                <span className="inline-flex items-center gap-1.5 ml-auto">
                  {Object.values(LINES).map((l) => (
                    <span key={l.name} className="inline-flex items-center gap-1 mr-2">
                      <span className="inline-block w-4 h-0.5" style={{ background: l.color }} />
                      {l.name.split(' (')[0]}
                    </span>
                  ))}
                </span>
              </div>
            </div>

            <div className="dd-panel-ruled p-4 mb-6">
              <div className="flex flex-wrap gap-2 mb-3">
                {[
                  ['delay', 'Delay'],
                  ['cost', 'Cost'],
                  ['track', 'Length'],
                  ['zones', 'Zones'],
                  ['segments', 'Segments'],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setChartTab(id)}
                    className="px-2.5 py-1.5 rounded text-xs font-bold transition-colors cursor-pointer"
                    style={
                      chartTab === id
                        ? { background: ACCENT, color: '#ffffff' }
                        : { background: 'var(--paper)', color: INK2 }
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              {chartTab === 'zones' && (
                <ChartBlock title="Slow zones per day" subtitle="Total zones in effect each day">
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={perDay} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
                      <CartesianGrid stroke={GRID} vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={{ stroke: GRID }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={chartTooltipStyle} labelStyle={{ color: INK2 }} />
                      <Area type="monotone" dataKey="zones" name="Slow zones" stroke={ACCENT} strokeWidth={2} fill={ACCENT} fillOpacity={0.12} />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartBlock>
              )}
              {chartTab === 'delay' && (
                <ChartBlock
                  title="Estimated delay per day"
                  subtitle="Added minutes riding through every zone once, from slow-track length and speed cut"
                >
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={perDay} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                      <CartesianGrid stroke={GRID} vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={{ stroke: GRID }} />
                      <YAxis tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={chartTooltipStyle} labelStyle={{ color: INK2 }} />
                      <Area type="monotone" dataKey="delayMin" name="Est. delay (min)" stroke={ACCENT} strokeWidth={2} fill={ACCENT} fillOpacity={0.12} />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartBlock>
              )}
              {chartTab === 'cost' && (
                <ChartBlock
                  title="Estimated cost of slow zones"
                  subtitle={`Daily and cumulative rider time cost at $${VALUE_OF_TIME}/hr — see method below`}
                >
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={perDay} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke={GRID} vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={{ stroke: GRID }} />
                      {/* The cumulative figure outgrows the daily one by orders
                          of magnitude within weeks, so each series gets its own
                          scale. The cumulative total is the headline number, so
                          it takes the left axis that reads first. Tick colour
                          keys each axis to its series. */}
                      <YAxis
                        yAxisId="cumulative"
                        tick={{ fontSize: 11, fill: INK2 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={formatAxisMoney}
                      />
                      {/* Twice the tallest bar, so the daily bars fill about the
                          bottom half and leave the cumulative line room to read
                          above them. */}
                      <YAxis
                        yAxisId="daily"
                        orientation="right"
                        domain={[0, (dataMax) => dataMax * 2]}
                        tick={{ fontSize: 11, fill: ACCENT }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={formatAxisMoney}
                      />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        labelStyle={{ color: INK2 }}
                        formatter={(v) => `$${Number(v).toLocaleString()}`}
                      />
                      {/* itemSorter defaults to sorting labels alphabetically,
                          which puts the right-axis series first; turning it off
                          makes the legend follow the order of the series below,
                          so it reads left axis, then right. */}
                      <Legend wrapperStyle={{ fontSize: 11, color: INK2 }} itemSorter={null} />
                      <Line yAxisId="cumulative" type="monotone" dataKey="cumulativeCost" name="Cumulative cost (left)" stroke={INK} strokeWidth={2} dot={{ r: 2.5 }} />
                      <Bar yAxisId="daily" dataKey="cost" name="Daily cost (right)" fill={ACCENT} radius={[3, 3, 0, 0]} barSize={18} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </ChartBlock>
              )}
              {chartTab === 'track' && (
                <ChartBlock title="Slow track per day" subtitle="Total km of track under reduced speed">
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={perDay} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
                      <CartesianGrid stroke={GRID} vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={{ stroke: GRID }} />
                      <YAxis tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={chartTooltipStyle} labelStyle={{ color: INK2 }} />
                      <Area type="monotone" dataKey="trackKm" name="Slow track (km)" stroke={ACCENT} strokeWidth={2} fill={ACCENT} fillOpacity={0.12} />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartBlock>
              )}
              {chartTab === 'segments' && (
                <ChartBlock
                  title="Segments with the most slow zones"
                  subtitle="Cumulative zone-days per segment between adjacent stations, all time"
                >
                  <ResponsiveContainer width="100%" height={Math.max(topSegments.length * 34, 160)}>
                    <BarChart data={topSegments} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke={GRID} horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={{ stroke: GRID }} />
                      <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 11, fill: INK2 }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={chartTooltipStyle} labelStyle={{ color: INK2 }} />
                      <Bar dataKey="zoneDays" name="Zone-days" fill={ACCENT} radius={[0, 4, 4, 0]} barSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartBlock>
              )}
            </div>

            <div className="dd-panel-ruled p-4 mt-6 overflow-x-auto">
              <h3 className="font-bold text-sm mb-3" style={{ color: INK }}>
                All zones — {selectedDay ? formatDay(selectedDay) : ''}
              </h3>
              <table className="w-full text-sm" style={{ color: INK2 }}>
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide" style={{ color: INK3 }}>
                    {[
                      ['line', 'Line'],
                      ['location', 'Location'],
                      ['reduced_kmh', 'Speed'],
                      ['normal_kmh', 'Normal'],
                      ['defect_m', 'Length'],
                      ['delay_min', 'Est. delay'],
                      ['cost_day', 'Est. cost/day'],
                      ['target', 'Target removal'],
                    ].map(([key, label]) => (
                      <th key={key} className="py-1.5 pr-3">
                        <button
                          type="button"
                          onClick={() => toggleSort(key)}
                          className="uppercase tracking-wide font-bold cursor-pointer"
                          style={{ color: sort.key === key ? INK : INK3 }}
                          title={
                            key === 'cost_day'
                              ? `Estimated riders crossing the zone daily × added minutes ÷ 60 × $${VALUE_OF_TIME}/hr value of time (Metrolinx). Hover a value for that zone’s numbers; method and sources below.`
                              : undefined
                          }
                        >
                          {label}
                          {sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedZones.map((z, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: GRID }}>
                      <td className="py-1.5 pr-3" style={{ color: INK }}>
                        Line {z.line}
                      </td>
                      <td className="py-1.5 pr-3">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle"
                          style={{ background: severityFor(z.reduced_kmh).color }}
                        />
                        {z.location}
                      </td>
                      <td className="py-1.5 pr-3 font-bold" style={{ color: INK }}>
                        {z.reduced_kmh} km/h
                      </td>
                      <td className="py-1.5 pr-3">{z.normal_kmh} km/h</td>
                      <td className="py-1.5 pr-3">{z.defect_m?.toLocaleString() ?? '—'} m</td>
                      <td className="py-1.5 pr-3">{z.delay_min > 0 ? `+${formatDelay(z.delay_min)}` : '—'}</td>
                      <td
                        className="py-1.5 pr-3"
                        title={
                          z.cost_day != null
                            ? `≈${z.riders_day.toLocaleString()} riders/day × ${
                                Math.round(z.delay_min * 100) / 100
                              } min ÷ 60 × $${VALUE_OF_TIME}/hr ≈ ${formatMoney(z.cost_day)}/day`
                            : 'No ridership estimate for this zone'
                        }
                      >
                        {formatMoney(z.cost_day)}
                      </td>
                      <td className="py-1.5">{z.target || 'TBD'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="dd-panel-ruled p-4 mt-6 text-xs leading-relaxed" style={{ color: INK2 }}>
              <h3 className="font-bold text-sm mb-2" style={{ color: INK }}>
                Method &amp; sources
              </h3>
              <p className="mb-2">
                <b>Added time per zone</b>: the slow-track length travelled at the reduced speed
                instead of the normal speed,{' '}
                <code>t = L × (1/v_reduced − 1/v_normal)</code>, where L is the zone&rsquo;s
                &ldquo;length of defect&rdquo;.
                The length already totals a row&rsquo;s multiple patches (&ldquo;x2&rdquo;,
                &ldquo;x3&rdquo;), so no multiplier is applied.
              </p>
              <p className="mb-2">
                <b>Riders per zone</b>: estimated from the TTC&rsquo;s published typical-weekday
                station usage with a gravity trip-assignment model. Each station&rsquo;s usage U
                splits evenly into boardings B and alightings A (<code>B = A = U/2</code>); trips
                between stations i and j are assigned as{' '}
                <code>T(i,j) = B(i) × A(j) / (ΣA − A(i))</code>, and a zone&rsquo;s ridership is
                the mean volume crossing its track segments in its direction of travel. The
                model&rsquo;s busiest link (southbound through Bloor-Yonge, ≈156k riders/day) is
                consistent with the TTC&rsquo;s measured peak-point volumes.
              </p>
              <p className="mb-2">
                <b>Cost</b>: rider time lost is first totalled as person-hours,{' '}
                <code>person-hours/day = Σ riders × t ÷ 60</code>, then valued at $
                {VALUE_OF_TIME}/hour:{' '}
                <code>cost/day = person-hours/day × ${VALUE_OF_TIME}</code>. The rate is
                Metrolinx&rsquo;s standard value of time, $18.79/hr in 2021 dollars, converted to
                2026 dollars using Canada CPI, from its{' '}
                <a
                  href="https://assets.metrolinx.com/image/upload/v1663237565/Documents/Metrolinx/Metrolinx-Business-Case-Guidance-Volume-2.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="dd-link-accent"
                >
                  Business Case Manual Volume 2
                </a>{' '}
                (Table 5.8, Economic Case parameters). The cumulative line in the cost chart sums
                the daily figures from the start of data collection. These are order-of-magnitude
                estimates, not measurements.
              </p>
              <p style={{ color: INK3 }}>
                Sources:{' '}
                <a
                  href="https://www.ttc.ca/riding-the-ttc/Updates/Reduced-Speed-Zones"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="dd-link-accent"
                >
                  TTC Reduced Speed Zones
                </a>{' '}
                (captured daily) ·{' '}
                <a
                  href="https://cdn.ttc.ca/-/media/Project/TTC/DevProto/Documents/Home/Transparency-and-accountability/Subway-Ridership-20232024.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="dd-link-accent"
                >
                  TTC Subway Ridership 2023–2024
                </a>{' '}
                (station usage, Sep 2023–Aug 2024) ·{' '}
                <a
                  href="https://www.ttc.ca/about-the-ttc/projects-and-plans/Major-Projects/Line-1-Capacity-Enhancement-Program"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="dd-link-accent"
                >
                  Line 1 Capacity Enhancement Program
                </a>{' '}
                (peak-point calibration) ·{' '}
                <a
                  href="https://assets.metrolinx.com/image/upload/v1663237565/Documents/Metrolinx/Metrolinx-Business-Case-Guidance-Volume-2.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="dd-link-accent"
                >
                  Metrolinx Business Case Manual Vol. 2
                </a>{' '}
                (value of time).
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
