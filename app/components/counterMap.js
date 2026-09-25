// counterMap.js
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadCounterSites } from '../lib/dataUtils';
import { cartoTileUrl, CARTO_ATTRIBUTION, CARTO_SUBDOMAINS } from '../lib/basemapTiles';

// Sequential blue, light -> dark: one hue, because the circles encode a single
// magnitude. The light end is the ordinal floor rather than the ramp's palest
// step, so the smallest circles still read against the basemap.
const RAMP = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'];
// Upper bound of each ramp step, in bikes counted so far this year.
const BREAKS = [50000, 150000, 300000, 500000, Infinity];
const NO_DATA = '#a8a69b';
// What each ramp step means, for the legend.
const RAMP_LABELS = ['under 50k', '50–150k', '150–300k', '300–500k', '500k+'];

const fmt = (n) => n.toLocaleString();
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function colorFor(total) {
  if (!total) return NO_DATA;
  return RAMP[BREAKS.findIndex((b) => total < b)];
}

// Area-proportional: the eye reads a circle by its area, so the radius goes as
// the square root. The floor keeps a quiet counter clickable.
function radiusFor(total, max) {
  if (!total) return 5;
  return 6 + 20 * Math.sqrt(total / max);
}

/**
 * The permanent counters on a map, sized and shaded by how many bikes each has
 * counted so far in `year`. Clicking one selects it in the chart above.
 *
 * `counters` are the processed counters (location + outlier-cleaned daily
 * data); coordinates come from the same generated file the daily counts do.
 */
export default function CounterMap({ counters, selected, onSelect, year }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const LRef = useRef(null);
  const markersRef = useRef(new Map()); // location -> circleMarker
  const onSelectRef = useRef(onSelect);
  const selectedRef = useRef(selected);
  const [sites, setSites] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  useEffect(() => {
    let cancelled = false;
    loadCounterSites().then((s) => { if (!cancelled) setSites(s); });
    return () => { cancelled = true; };
  }, []);

  // Year-to-date volume per counter, from the same outlier-cleaned series the
  // chart draws, so the map and the chart above it can never disagree.
  const totals = useMemo(() => {
    const out = new Map();
    for (const counter of counters) {
      let sum = 0;
      for (const point of counter.data) {
        if (point.date.startsWith(String(year))) sum += point.volume;
      }
      out.set(counter.location, sum);
    }
    return out;
  }, [counters, year]);

  // Init the map once.
  useEffect(() => {
    let cancelled = false;
    const markers = markersRef.current;
    import('leaflet').then((L) => {
      import('leaflet/dist/leaflet.css');
      if (cancelled || !elRef.current || mapRef.current) return;
      const map = L.map(elRef.current, { zoomSnap: 0.25, scrollWheelZoom: false });
      L.tileLayer(cartoTileUrl('rastertiles/voyager'), {
        attribution: CARTO_ATTRIBUTION,
        subdomains: CARTO_SUBDOMAINS,
        maxZoom: 20,
      }).addTo(map);
      LRef.current = L;
      mapRef.current = map;
      setReady(true);
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => map.invalidateSize());
        ro.observe(elRef.current);
      }
    });
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markers.clear();
      setReady(false);
    };
  }, []);

  // Build the circles once the map and the coordinates are both in.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map || !sites || markersRef.current.size) return;

    const max = Math.max(...totals.values(), 1);
    // Counters with nothing this year are drawn first so the live ones land on
    // top: a retired counter sits a few metres from its replacement and would
    // otherwise hide it.
    const ordered = [...sites]
      .filter((s) => totals.has(s.location))
      .sort((a, b) => (totals.get(a.location) || 0) - (totals.get(b.location) || 0));

    for (const site of ordered) {
      const total = totals.get(site.location) || 0;
      const marker = L.circleMarker([site.lat, site.lon], {
        radius: radiusFor(total, max),
        fillColor: colorFor(total),
        fillOpacity: 0.85,
        // The surface-colour ring that keeps overlapping circles readable —
        // it is the spacer, not an outline.
        color: '#ffffff',
        weight: 2,
      }).addTo(map);

      marker.bindTooltip(
        `<b>${escapeHtml(site.location)}</b><br>${total ? `${fmt(total)} bikes in ${year}` : `No counts in ${year}`}`,
        { direction: 'top', opacity: 1 }
      );
      marker.on('click', () => onSelectRef.current?.(site.location));
      markersRef.current.set(site.location, marker);
    }

    map.fitBounds(L.latLngBounds(ordered.map((s) => [s.lat, s.lon])), { padding: [26, 26] });
  }, [sites, totals, ready, year]);

  // Mark the selected counter in place rather than rebuilding the layer.
  useEffect(() => {
    for (const [location, marker] of markersRef.current) {
      const on = location === selected;
      marker.setStyle({ color: on ? '#16150f' : '#ffffff', weight: on ? 3 : 2 });
      if (on) marker.bringToFront();
    }
  }, [selected, sites, ready]);

  return (
    <div>
      <div ref={elRef} className="w-full rounded" style={{ height: 440, background: 'var(--paper)' }} />
      <div className="mt-3 text-xs" style={{ color: 'var(--ink-2)' }}>
        <span className="font-semibold">Bikes counted in {year}</span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-1.5">
          {RAMP.map((c, i) => (
            <span key={c} className="flex items-center gap-1.5">
              <span
                className="inline-block rounded-full shrink-0"
                style={{ width: 10 + i * 4, height: 10 + i * 4, background: c, border: '1.5px solid #fff' }}
              />
              <span>{RAMP_LABELS[i]}</span>
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block rounded-full shrink-0"
              style={{ width: 10, height: 10, background: NO_DATA, border: '1.5px solid #fff' }}
            />
            <span>none this year</span>
          </span>
        </div>
      </div>
    </div>
  );
}
