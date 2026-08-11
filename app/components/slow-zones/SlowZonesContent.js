'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { LINES, segmentsBetween, segmentLabel } from '../../lib/slow-zones/stations';

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

  // Per-day chart series: zone count and total speed drop
  // (sum of zone_count × (normal − reduced) across that day's zones).
  const perDay = useMemo(() => {
    const dropByDay = {};
    for (const z of zones) {
      const drop = (z.normal_kmh ?? 0) - (z.reduced_kmh ?? 0);
      dropByDay[z.day] = (dropByDay[z.day] || 0) + (z.zone_count || 1) * Math.max(drop, 0);
    }
    return days.map((d) => ({
      day: d.day,
      label: formatDay(d.day),
      zones: d.zone_total,
      speedDrop: dropByDay[d.day] || 0,
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

  // Worst (lowest) reduced speed per segment for the selected day, for the map.
  const segmentSeverity = useMemo(() => {
    const worst = {};
    for (const z of selectedZones) {
      for (const seg of segmentsBetween(z.line, z.from_station, z.to_station)) {
        const key = `${z.line}:${seg[0]}`;
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
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!mapReady || !overlay) return;
    import('leaflet').then((L) => {
      overlay.clearLayers();
      for (const zone of Object.values(segmentSeverity)) {
        const stations = LINES[zone.line].stations;
        const latlngs = [zone.seg[0], zone.seg[1]].map((i) => [stations[i][1], stations[i][2]]);
        const color = severityFor(zone.reduced_kmh).color;
        // Dark casing under a thick severity stroke: restricted segments stay
        // structurally distinct from base lines even without color vision.
        L.polyline(latlngs, { color: INK, weight: 10, opacity: 0.85 }).addTo(overlay);
        L.polyline(latlngs, { color, weight: 6, opacity: 1 })
          .bindTooltip(
            `<b>${zone.location}</b><br/>` +
              `${zone.reduced_kmh} km/h (normal ${zone.normal_kmh} km/h)<br/>` +
              `${zone.defect_m ?? '?'} m of track · target: ${zone.target || 'TBD'}`,
            { sticky: true }
          )
          .addTo(overlay);
      }
    });
  }, [mapReady, segmentSeverity]);

  if (error) {
    return (
      <div className="min-h-screen py-20 text-center" style={{ background: 'var(--paper)' }}>
        <p style={{ color: INK2 }}>Could not load slow-zone data ({error}).</p>
      </div>
    );
  }

  const totalDrop = selectedZones.reduce(
    (sum, z) => sum + (z.zone_count || 1) * Math.max((z.normal_kmh ?? 0) - (z.reduced_kmh ?? 0), 0),
    0
  );
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
              <StatTile label="Total speed drop" value={totalDrop} unit="km/h" />
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
                title="Total speed drop per day"
                subtitle="Sum of (normal − reduced) km/h across all zones"
              >
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={perDay} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={{ stroke: GRID }} />
                    <YAxis tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={chartTooltipStyle} labelStyle={{ color: INK2 }} />
                    <Area type="monotone" dataKey="speedDrop" name="Speed drop (km/h)" stroke={ACCENT} strokeWidth={2} fill={ACCENT} fillOpacity={0.12} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartPanel>
            </div>

            <ChartPanel
              title="Segments with the most slow zones"
              subtitle="Cumulative zone-days per segment between adjacent stations, all time"
            >
              <ResponsiveContainer width="100%" height={Math.max(topSegments.length * 34, 120)}>
                <BarChart data={topSegments} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 60 }}>
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={{ stroke: GRID }} />
                  <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 11, fill: INK2 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={chartTooltipStyle} labelStyle={{ color: INK2 }} />
                  <Bar dataKey="zoneDays" name="Zone-days" fill={ACCENT} radius={[0, 4, 4, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>

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
