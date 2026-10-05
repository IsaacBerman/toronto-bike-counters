'use client';

import { useEffect, useRef, useState } from 'react';
import { cartoTileUrl, CARTO_ATTRIBUTION, CARTO_SUBDOMAINS } from '../../lib/basemapTiles';

const BASE_STROKE = { color: '#ffffff', weight: 0.5, opacity: 0.9 };
const HOVER_STROKE = { color: '#16150f', weight: 1.5, opacity: 1 };
const SELECTED_STROKE = { color: '#16150f', weight: 2.5, opacity: 1 };

const pollKey = (p) => `${p.w}-${p.s}`;

/**
 * Every voting subdivision in a race, filled by `styleFor(properties)`. The
 * layer is built once per race and restyled in place when the view changes;
 * clicking a poll calls onSelectPoll with its properties.
 */
export default function ElectionMap({ data, styleFor, tooltipFor, selectedPoll, selectedWard, focusWard, onSelectPoll }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const LRef = useRef(null);
  const rendererRef = useRef(null);
  const pollsRef = useRef(null);
  const wardsRef = useRef(null);
  const byKeyRef = useRef(new Map());
  const wardBoundsRef = useRef(new Map());
  const styleRef = useRef(styleFor);
  const tooltipRef = useRef(tooltipFor);
  const onSelectRef = useRef(onSelectPoll);
  const selectedRef = useRef(selectedPoll);
  const [ready, setReady] = useState(false);

  useEffect(() => { styleRef.current = styleFor; }, [styleFor]);
  useEffect(() => { tooltipRef.current = tooltipFor; }, [tooltipFor]);
  useEffect(() => { onSelectRef.current = onSelectPoll; }, [onSelectPoll]);

  // Init the map once.
  useEffect(() => {
    let cancelled = false;
    let ro;
    import('leaflet').then((L) => {
      import('leaflet/dist/leaflet.css');
      if (cancelled || !elRef.current || mapRef.current) return;
      const map = L.map(elRef.current, {
        center: [43.72, -79.38],
        zoom: 11,
        zoomSnap: 0.25,
        scrollWheelZoom: false,
      });
      // Labels go on their own pane above the fills, so street names stay
      // readable through a fully shaded poll.
      L.tileLayer(cartoTileUrl('rastertiles/voyager_nolabels'), {
        attribution: CARTO_ATTRIBUTION,
        subdomains: CARTO_SUBDOMAINS,
        maxZoom: 20,
      }).addTo(map);
      map.createPane('labels');
      // Above the overlay pane (400) but below tooltips (650).
      map.getPane('labels').style.zIndex = 450;
      map.getPane('labels').style.pointerEvents = 'none';
      L.tileLayer(cartoTileUrl('rastertiles/voyager_only_labels'), {
        subdomains: CARTO_SUBDOMAINS,
        maxZoom: 20,
        pane: 'labels',
      }).addTo(map);
      LRef.current = L;
      rendererRef.current = L.canvas({ padding: 0.2 });
      mapRef.current = map;
      setReady(true);
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => map.invalidateSize());
        ro.observe(elRef.current);
      }
    });
    return () => {
      cancelled = true;
      ro?.disconnect();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setReady(false);
    };
  }, []);

  // Build the polls and ward outlines for the current race.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map || !data) return undefined;

    const byKey = byKeyRef.current;
    byKey.clear();
    const styleOf = (p) => ({
      ...styleRef.current(p),
      ...(selectedRef.current && pollKey(p) === pollKey(selectedRef.current) ? SELECTED_STROKE : BASE_STROKE),
    });

    const polls = L.geoJSON(data.polls, {
      renderer: rendererRef.current,
      style: (f) => styleOf(f.properties),
      onEachFeature: (f, layer) => byKey.set(pollKey(f.properties), layer),
    }).addTo(map);
    // Bound on the group, so one handler and one tooltip cover every poll.
    polls.bindTooltip((layer) => tooltipRef.current(layer.feature.properties), {
      sticky: true,
      direction: 'top',
      opacity: 1,
    });
    polls.on('click', (e) => onSelectRef.current?.(e.layer.feature.properties));
    polls.on('mouseover', (e) => e.layer.setStyle(HOVER_STROKE));
    polls.on('mouseout', (e) => e.layer.setStyle(styleOf(e.layer.feature.properties)));
    pollsRef.current = polls;

    const wardBounds = wardBoundsRef.current;
    wardBounds.clear();
    const wards = L.geoJSON(data.wardOutlines, {
      renderer: rendererRef.current,
      interactive: false,
      style: { color: '#16150f', weight: 1.25, opacity: 0.7, fill: false },
      onEachFeature: (f, layer) => wardBounds.set(f.properties.w, layer),
    }).addTo(map);
    wardsRef.current = wards;

    return () => {
      polls.remove();
      wards.remove();
      byKey.clear();
      wardBounds.clear();
      pollsRef.current = null;
      wardsRef.current = null;
    };
  }, [data, ready]);

  // Restyle in place when the view changes.
  useEffect(() => {
    const polls = pollsRef.current;
    if (!polls) return;
    polls.eachLayer((layer) => {
      const p = layer.feature.properties;
      const selected = selectedPoll && pollKey(p) === pollKey(selectedPoll);
      layer.setStyle({ ...styleFor(p), ...(selected ? SELECTED_STROKE : BASE_STROKE) });
    });
    selectedRef.current = selectedPoll;
    if (selectedPoll) byKeyRef.current.get(pollKey(selectedPoll))?.bringToFront();
  }, [styleFor, selectedPoll, data, ready]);

  // The selected ward's outline is drawn heavier.
  useEffect(() => {
    for (const [ward, layer] of wardBoundsRef.current) {
      layer.setStyle(ward === selectedWard ? { weight: 3, opacity: 1 } : { weight: 1.25, opacity: 0.7 });
      if (ward === selectedWard) layer.bringToFront();
    }
  }, [selectedWard, data, ready]);

  // Zoom to a ward when one is picked from the menu, or back out to the city.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusWard) return;
    if (focusWard.ward) {
      const layer = wardBoundsRef.current.get(focusWard.ward);
      if (layer) map.fitBounds(layer.getBounds(), { padding: [20, 20] });
    } else if (pollsRef.current) {
      map.fitBounds(pollsRef.current.getBounds(), { padding: [10, 10] });
    }
  }, [focusWard, data, ready]);

  return <div ref={elRef} className="w-full rounded" style={{ height: 'min(72vh, 640px)', minHeight: 420, background: 'var(--paper)' }} />;
}
