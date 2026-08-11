'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { LINES, segmentsBetween, spanBetween, segmentLabel } from '../../lib/slow-zones/stations';

const ACCENT = '#e8590c';
const INK = '#16150f';
const INK2 = '#57554b';
const INK3 = '#8a887c';
const GRID = '#e5e3da';

// Severity ramp: one hue, light -> dark as the restriction tightens
// (validated ordinal ramp on the paper surface). 0 km/h means trains are
// held/diverted through the zone.
const SEVERITY = [
  { max: 0, color: '#6e0d1d', label: '0 km/h (stopped)' },
  { max: 15, color: '#b02818', label: '≤ 15 km/h' },
  { max: 25, color: '#d95f43', label: '16–25 km/h' },
  { max: Infinity, color: '#f0926f', label: '26+ km/h' },
];

function severityFor(reducedKmh) {
  return SEVERITY.find((s) => reducedKmh <= s.max) || SEVERITY[SEVERITY.length - 1];
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

function ChartPanel({ title, subtitle, children }) {
  return (
    <div className="dd-panel-ruled p-4">
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

  // Estimated added travel time for one pass through a zone: its slow-track
  // length at the reduced speed vs. the normal speed. The length column is
  // already the row's total across its (xN) patches, so no multiplier. A
  // 0 km/h zone is counted at the TTC's stated 10 km/h crawl.
  const zoneDelayMin = (z) => {
    if (!z.defect_m || !z.normal_kmh) return 0;
    const reduced = Math.max(z.reduced_kmh ?? 0, 10);
    return Math.max((z.defect_m / 1000) * 60 * (1 / reduced - 1 / z.normal_kmh), 0);
  };

  // Per-day chart series: zone count and total estimated delay.
  const perDay = useMemo(() => {
    const delayByDay = {};
    const trackByDay = {};
    for (const z of zones) {
      delayByDay[z.day] = (delayByDay[z.day] || 0) + zoneDelayMin(z);
      trackByDay[z.day] = (trackByDay[z.day] || 0) + (z.defect_m || 0);
    }
    return days.map((d) => ({
      day: d.day,
      label: formatDay(d.day),
      zones: d.zone_total,
      delayMin: Math.round((delayByDay[d.day] || 0) * 10) / 10,
      trackKm: Math.round((trackByDay[d.day] || 0) / 100) / 10,
    }));
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
    const draw = () => {
      const overlay = overlayRef.current;
      if (!overlay || !map || !L) return;
      overlay.clearLayers();
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
        const tooltip =
          `<b>${zone.location}</b><br/>` +
          `${zone.reduced_kmh} km/h (normal ${zone.normal_kmh} km/h)<br/>` +
          `${zone.defect_m ?? '?'} m of track · target: ${zone.target || 'TBD'}`;
        // Dark casing under a thick severity stroke: restricted segments stay
        // structurally distinct from base lines even without color vision.
        L.polyline([a2, b2], { color: INK, weight: 9, opacity: 0.85 }).addTo(overlay);
        L.polyline([a2, b2], { color, weight: 5, opacity: 1 })
          .bindTooltip(tooltip, { sticky: true })
          .addTo(overlay);
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        const mid = map.layerPointToLatLng([(pA.x + pB.x) / 2 + ox, (pA.y + pB.y) / 2 + oy]);
        L.marker(mid, {
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: '',
            iconSize: [14, 14],
            iconAnchor: [7, 7],
            html:
              `<div style="transform:rotate(${angle.toFixed(1)}deg);font-size:10px;` +
              `line-height:14px;text-align:center;color:#ffffff;` +
              `text-shadow:0 0 2px rgba(0,0,0,0.9)">➤</div>`,
          }),
        }).addTo(overlay);
      }
    };
    import('leaflet').then((mod) => {
      if (disposed) return;
      L = mod.default || mod;
      map = mapInstanceRef.current;
      if (!map) return;
      draw();
      map.on('zoomend', draw);
    });
    return () => {
      disposed = true;
      mapInstanceRef.current?.off('zoomend', draw);
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

  return (
    <div className="min-h-screen" style={{ background: 'var(--paper)' }}>
      <div className="container mx-auto px-4 max-w-5xl py-12">
        <p className="dd-kicker mb-3">Observing the City</p>
        <h1 className="dd-title text-4xl sm:text-5xl mb-4" style={{ color: INK }}>
          TTC Slow Zones
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed mb-8" style={{ color: INK2 }}>
          Where subway trains are running below normal speed. Reduced speed zones
          (&ldquo;slow orders&rdquo;) are posted by the TTC and captured here once a day,
          so the history builds over time. One zone can add one to three minutes to a trip.
        </p>

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
              <select
                id="sz-day"
                value={selectedDay || ''}
                onChange={(e) => setSelectedDay(e.target.value)}
                className="dd-panel px-3 py-1.5 text-sm rounded border"
                style={{ color: INK, borderColor: GRID }}
              >
                {days.map((d) => (
                  <option key={d.day} value={d.day}>
                    {formatDay(d.day)}
                  </option>
                ))}
              </select>
              {selectedMeta?.as_of && (
                <span className="text-xs" style={{ color: INK3 }}>
                  TTC page timestamp: {selectedMeta.as_of}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
              <StatTile label="Slow zones" value={selectedMeta?.zone_total ?? 0} />
              <StatTile label="Est. added time" value={totalDelayMin} unit="min" />
              <StatTile label="Slow track" value={slowTrackM.toLocaleString()} unit="m" />
            </div>

            <div className="dd-panel-ruled p-4 mb-6">
              <h3 className="font-bold text-sm mb-2" style={{ color: INK }}>
                Slow zones on the network — {selectedDay ? formatDay(selectedDay) : ''}
              </h3>
              <div ref={mapRef} className="h-[440px] w-full rounded" />
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs" style={{ color: INK2 }}>
                {SEVERITY.map((s) => (
                  <span key={s.label} className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-4 h-1.5 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </span>
                ))}
                <span>➤ direction of travel</span>
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

            <div className="grid md:grid-cols-2 gap-6 mb-6">
              <ChartPanel title="Slow zones per day" subtitle="Total zones in effect each day">
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={perDay} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={{ stroke: GRID }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={chartTooltipStyle} labelStyle={{ color: INK2 }} />
                    <Area type="monotone" dataKey="zones" name="Slow zones" stroke={ACCENT} strokeWidth={2} fill={ACCENT} fillOpacity={0.12} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartPanel>
              <ChartPanel
                title="Estimated delay per day"
                subtitle="Added minutes riding through every zone once, from slow-track length and speed cut"
              >
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={perDay} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={{ stroke: GRID }} />
                    <YAxis tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={chartTooltipStyle} labelStyle={{ color: INK2 }} />
                    <Area type="monotone" dataKey="delayMin" name="Est. delay (min)" stroke={ACCENT} strokeWidth={2} fill={ACCENT} fillOpacity={0.12} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartPanel>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <ChartPanel title="Slow track per day" subtitle="Total km of track under reduced speed">
                <ResponsiveContainer width="100%" height={Math.max(topSegments.length * 34, 220)}>
                  <AreaChart data={perDay} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={{ stroke: GRID }} />
                    <YAxis tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={chartTooltipStyle} labelStyle={{ color: INK2 }} />
                    <Area type="monotone" dataKey="trackKm" name="Slow track (km)" stroke={ACCENT} strokeWidth={2} fill={ACCENT} fillOpacity={0.12} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartPanel>
              <div>
                <ChartPanel
                  title="Segments with the most slow zones"
                  subtitle="Cumulative zone-days per segment between adjacent stations, all time"
                >
                  <ResponsiveContainer width="100%" height={Math.max(topSegments.length * 34, 120)}>
                    <BarChart data={topSegments} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke={GRID} horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={{ stroke: GRID }} />
                      <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 11, fill: INK2 }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={chartTooltipStyle} labelStyle={{ color: INK2 }} />
                      <Bar dataKey="zoneDays" name="Zone-days" fill={ACCENT} radius={[0, 4, 4, 0]} barSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartPanel>
              </div>
            </div>

            <div className="dd-panel-ruled p-4 mt-6 overflow-x-auto">
              <h3 className="font-bold text-sm mb-3" style={{ color: INK }}>
                All zones — {selectedDay ? formatDay(selectedDay) : ''}
              </h3>
              <table className="w-full text-sm" style={{ color: INK2 }}>
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide" style={{ color: INK3 }}>
                    <th className="py-1.5 pr-3">Location</th>
                    <th className="py-1.5 pr-3">Speed</th>
                    <th className="py-1.5 pr-3">Normal</th>
                    <th className="py-1.5 pr-3">Length</th>
                    <th className="py-1.5">Target removal</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedZones.map((z, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: GRID }}>
                      <td className="py-1.5 pr-3">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle"
                          style={{ background: severityFor(z.reduced_kmh).color }}
                        />
                        <span style={{ color: INK }}>Line {z.line}</span> · {z.location}
                      </td>
                      <td className="py-1.5 pr-3 font-bold" style={{ color: INK }}>
                        {z.reduced_kmh} km/h
                      </td>
                      <td className="py-1.5 pr-3">{z.normal_kmh} km/h</td>
                      <td className="py-1.5 pr-3">{z.defect_m?.toLocaleString() ?? '—'} m</td>
                      <td className="py-1.5">{z.target || 'TBD'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs mt-6" style={{ color: INK3 }}>
              Source:{' '}
              <a
                href="https://www.ttc.ca/riding-the-ttc/Updates/Reduced-Speed-Zones"
                target="_blank"
                rel="noopener noreferrer"
                className="dd-link-accent"
              >
                TTC Reduced Speed Zones
              </a>
              , captured daily. Zone counts include multi-zone segments (&ldquo;x2&rdquo;).
            </p>
          </>
        )}
      </div>
    </div>
  );
}
