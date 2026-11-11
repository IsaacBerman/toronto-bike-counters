// components/StationMap.js
'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { buildDrawLayer } from './downtown-definer/drawLayer';

// Stations inside a drawn area are ringed in the site accent; the rest fade
// back while any area is closed, so the selection reads at a glance.
const SELECTED_STROKE = '#e8590c';

// `areas` is a list of [lat, lng] rings. They live here so a click re-renders
// only the map, not the page and its big trend chart; `onAreasChange` hands
// each change to the parent without state, so they survive a trip to the
// chart and back (`initialAreas`). `onChartStations(ids)` opens the combined
// chart.
export default function StationMap({ onStationSelect, initialAreas, onAreasChange, onChartStations }) {
  const [areas, setAreasState] = useState(initialAreas);
  const setAreas = (next) => {
    setAreasState(next);
    onAreasChange(next);
  };
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  // Coming back from the chart with areas already drawn, carry on drawing.
  const [drawing, setDrawing] = useState(() => areas.some((area) => area.length > 0));
  const [activeArea, setActiveArea] = useState(() => Math.max(areas.length - 1, 0));
  const mapRef = useRef(null);
  const leafletRef = useRef(null);
  const leafletMapRef = useRef(null);
  const markersRef = useRef([]);
  const drawLayerRef = useRef(null);
  // Leaflet handlers are bound once, so they read the latest props through refs.
  const drawingRef = useRef(drawing);
  const addPointRef = useRef(null);
  const onStationSelectRef = useRef(onStationSelect);

  useEffect(() => {
    let cancelled = false;

    // Fetch the map library alongside the stations rather than after them;
    // the init effect below then finds it already loaded.
    import('leaflet').catch(() => {});

    async function loadStations() {
      try {
        // One pre-joined, edge-cached list: stations with their trips a day
        // (see app/api/bikeshare-stations).
        const response = await fetch('/api/bikeshare-stations');
        if (!response.ok) throw new Error(`Stations ${response.status}`);
        const { stations: stationsWithActivity } = await response.json();

        if (!cancelled) {
          if (stationsWithActivity.length === 0) setError('No stations found');
          else setStations(stationsWithActivity);
          setLoading(false);
        }
      } catch (err) {
        console.error('Error loading stations:', err);
        if (!cancelled) {
          setError('Failed to load station data. Please try again later.');
          setLoading(false);
        }
      }
    }

    loadStations();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    drawingRef.current = drawing;
    onStationSelectRef.current = onStationSelect;
  });

  // Initialize the Leaflet map once the stations are in.
  useEffect(() => {
    if (loading || stations.length === 0 || !mapRef.current) return undefined;
    let cancelled = false;

    import('leaflet').then((L) => {
      import('leaflet/dist/leaflet.css');
      if (cancelled || !mapRef.current || leafletMapRef.current) return;

      // preferCanvas: ~1,200 circles as SVG nodes made every restyle slow.
      const map = L.map(mapRef.current, {
        center: [43.6532, -79.3832],
        zoom: 12,
        preferCanvas: true
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);

      map.on('click', (e) => {
        if (drawingRef.current) addPointRef.current?.([e.latlng.lat, e.latlng.lng]);
      });

      // Add markers
      const maxTrips = Math.max(...stations.map(s => s.dailyTrips || 0), 1);

      markersRef.current = stations.map(station => {
        const radius = !station.dailyTrips ? 6 : 8 + (station.dailyTrips / maxTrips) * 20;
        const color = station.dailyTrips > 400 ? '#dc2626' :
                     station.dailyTrips > 200 ? '#f59e0b' :
                     station.dailyTrips > 100 ? '#ffff00' :
                     station.dailyTrips > 50 ? '#00ff00' :
                     station.dailyTrips > 0 ? '#3b82f6' :  "#000";

        const marker = L.circleMarker([station.lat, station.lon], {
          radius: radius,
          fillColor: color,
          color: '#000',
          weight: 1,
          opacity: 1,
          fillOpacity: 0.7
        }).addTo(map);

        marker.bindTooltip(
          `<strong>${escapeHtml(station.name || station.station_id)}</strong><br>${Math.round(station.dailyTrips)} trips a day`,
          { direction: 'top', offset: [0, -radius] }
        );

        // While drawing, a station under the pointer is just more map: the
        // tap places a point there instead of opening the station.
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          if (drawingRef.current) addPointRef.current?.([e.latlng.lat, e.latlng.lng]);
          else onStationSelectRef.current(station.station_id);
        });

        return { marker, station, state: 'base' };
      });

      leafletRef.current = L;
      leafletMapRef.current = map;
      setMapReady(true);
    }).catch(err => {
      console.error('Error loading Leaflet:', err);
      if (!cancelled) setError('Failed to load map');
    });

    return () => {
      cancelled = true;
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
      markersRef.current = [];
      setMapReady(false);
    };
  }, [loading, stations]);

  const closedAreas = useMemo(() => areas.filter((area) => area.length >= 3), [areas]);

  const selectedIds = useMemo(() => {
    if (closedAreas.length === 0) return [];
    return stations
      .filter((station) => closedAreas.some((area) => pointInRing(station.lat, station.lon, area)))
      .map((station) => station.station_id);
  }, [stations, closedAreas]);

  // Restyle markers for the current selection, touching only the ones whose
  // state changed.
  const anyArea = closedAreas.length > 0;
  useEffect(() => {
    if (!mapReady) return;
    const selected = new Set(selectedIds);
    for (const entry of markersRef.current) {
      const state = selected.has(entry.station.station_id) ? 'selected' : anyArea ? 'faded' : 'base';
      if (state === entry.state) continue;
      entry.state = state;
      entry.marker.setStyle(MARKER_STYLES[state]);
      if (state === 'selected') entry.marker.bringToFront();
    }
  }, [selectedIds, anyArea, mapReady]);

  // Drawn areas. Shown whenever there are any; only the active area gets
  // draggable points, and only while drawing.
  useEffect(() => {
    const L = leafletRef.current;
    const map = leafletMapRef.current;
    if (!L || !map) return;

    if (drawLayerRef.current) {
      drawLayerRef.current.remove();
      drawLayerRef.current = null;
    }

    const group = buildDrawLayer(L, areas, drawing ? activeArea : -1, moveVertex);
    if (!group) return;
    group.addTo(map);
    drawLayerRef.current = group;
    // moveVertex only closes over areas, which is listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas, activeArea, drawing, mapReady]);

  const activePoints = areas[activeArea] || [];

  function updateArea(index, update) {
    setAreas(areas.map((area, i) => (i === index ? update(area) : area)));
  }

  addPointRef.current = (point) => updateArea(activeArea, (area) => [...area, point]);

  function moveVertex(areaIndex, pointIndex, point) {
    updateArea(areaIndex, (area) => area.map((existing, j) => (j === pointIndex ? point : existing)));
  }

  function undoPoint() {
    updateArea(activeArea, (area) => area.slice(0, -1));
  }

  function startNewArea() {
    const next = [...areas.filter((area) => area.length > 0), []];
    setAreas(next);
    setActiveArea(next.length - 1);
  }

  function removeArea(index) {
    const next = areas.filter((_, i) => i !== index);
    const kept = next.length ? next : [[]];
    setAreas(kept);
    setActiveArea((active) => Math.min(active > index ? active - 1 : active, kept.length - 1));
  }

  function clearAreas() {
    setAreas([[]]);
    setActiveArea(0);
  }

  // Backspace removes the last point of the area being drawn.
  useEffect(() => {
    if (!drawing) return undefined;
    function handleKeyDown(e) {
      if (e.key === 'Backspace' && document.activeElement?.tagName !== 'INPUT') undoPoint();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // Loading state
  if (loading) {
    return (
      <div className="h-[28rem] md:h-[38rem] bg-gray-100 rounded-lg flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
          <p className="text-gray-500">Loading stations...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="h-[28rem] md:h-[38rem] bg-gray-100 rounded-lg flex items-center justify-center">
        <div className="text-center text-red-600">
          <p className="font-semibold">Error loading map</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  // No stations state
  if (stations.length === 0) {
    return (
      <div className="h-[28rem] md:h-[38rem] bg-gray-100 rounded-lg flex items-center justify-center">
        <p className="text-gray-500">No stations available</p>
      </div>
    );
  }

  const hasPoints = areas.some((area) => area.length > 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setDrawing((d) => !d)}
          className={drawing ? 'dd-btn dd-btn-primary' : 'dd-btn dd-btn-ghost'}
          aria-pressed={drawing}
        >
          {drawing ? 'Done drawing' : 'Draw areas'}
        </button>
        {selectedIds.length > 0 && (
          <button onClick={() => onChartStations(selectedIds)} className="dd-btn dd-btn-primary ml-auto">
            Chart {selectedIds.length} {selectedIds.length === 1 ? 'station' : 'stations'} →
          </button>
        )}
      </div>
      {drawing && (
        <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
          Tap the map to place points. Place at least 3 points to form an area. Drag any point to
          adjust it. Press &ldquo;New area&rdquo; to add another.
        </p>
      )}

      <div className="relative">
        <div ref={mapRef} className="h-[28rem] md:h-[38rem] w-full rounded-lg border border-gray-200" />
        <div className="absolute bottom-4 left-4 bg-white p-2 rounded-lg shadow-lg text-xs">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-blue-500 inline-block"></span>
            <span>Low (0-500 trips)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-yellow-500 inline-block"></span>
            <span>Medium (500-1000 trips)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-red-500 inline-block"></span>
            <span>High (1000+ trips)</span>
          </div>
        </div>
      </div>

      {(drawing || hasPoints) && (
        <div className="flex flex-wrap items-center gap-2">
          {drawing && areas.map((_, index) => {
            const active = index === activeArea;
            return (
              <span
                key={index}
                className={active ? 'dd-btn dd-btn-primary' : 'dd-btn dd-btn-ghost'}
                style={areas.length > 1 ? { paddingRight: '0.5rem', gap: '0.35rem' } : undefined}
              >
                <button onClick={() => setActiveArea(index)} className="font-bold">
                  Area {index + 1}
                </button>
                {areas.length > 1 && (
                  <button
                    onClick={() => removeArea(index)}
                    aria-label={`Remove area ${index + 1}`}
                    className="px-1 leading-none opacity-60 hover:opacity-100"
                  >
                    ×
                  </button>
                )}
              </span>
            );
          })}
          {drawing && (
            <>
              <button onClick={startNewArea} disabled={activePoints.length < 3} className="dd-btn dd-btn-ghost">
                + New area
              </button>
              <button onClick={undoPoint} disabled={activePoints.length === 0} className="dd-btn dd-btn-ghost">
                ↶ Undo point
              </button>
            </>
          )}
          <button onClick={clearAreas} disabled={!hasPoints} className="dd-btn dd-btn-ghost">
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

const MARKER_STYLES = {
  selected: { color: SELECTED_STROKE, weight: 3, opacity: 1, fillOpacity: 0.9 },
  faded: { color: '#000', weight: 1, opacity: 0.3, fillOpacity: 0.2 },
  base: { color: '#000', weight: 1, opacity: 1, fillOpacity: 0.7 },
};

// Ray casting: is (lat, lng) inside the ring of [lat, lng] points?
function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
