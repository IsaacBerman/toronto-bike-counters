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
 *
 * With `byWard` set the polls make way for the 25 wards, filled by
 * `wardStyleFor(ward)` — for the votes the City only reports by ward.
 */
export default function ElectionMap({
  data, styleFor, tooltipFor, selectedPoll, selectedWard, focusWard, onSelectPoll,
  byWard, wardStyleFor, wardTooltipFor, onSelectWard,
}) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const LRef = useRef(null);
  const rendererRef = useRef(null);
  const pollsRef = useRef(null);
  const wardsRef = useRef(null);
  const wardFillsRef = useRef(null);
  const byKeyRef = useRef(new Map());
  const wardBoundsRef = useRef(new Map());
  const styleRef = useRef(styleFor);
  const tooltipRef = useRef(tooltipFor);
  const onSelectRef = useRef(onSelectPoll);
  const wardStyleRef = useRef(wardStyleFor);
  const wardTooltipRef = useRef(wardTooltipFor);
  const onSelectWardRef = useRef(onSelectWard);
  const selectedRef = useRef(selectedPoll);
  const [ready, setReady] = useState(false);

  useEffect(() => { styleRef.current = styleFor; }, [styleFor]);
  useEffect(() => { tooltipRef.current = tooltipFor; }, [tooltipFor]);
  useEffect(() => { onSelectRef.current = onSelectPoll; }, [onSelectPoll]);
  useEffect(() => { wardStyleRef.current = wardStyleFor; }, [wardStyleFor]);
  useEffect(() => { wardTooltipRef.current = wardTooltipFor; }, [wardTooltipFor]);
  useEffect(() => { onSelectWardRef.current = onSelectWard; }, [onSelectWard]);

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
    });
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

    // Ward fills sit in their own layer, swapped in for the polls. The
    // outlines below stay separate so they draw on top of either.
    const wardStyleOf = (w) => ({ ...wardStyleRef.current(w), ...BASE_STROKE, weight: 0 });
    const wardFills = L.geoJSON(data.wardOutlines, {
      renderer: rendererRef.current,
      style: (f) => wardStyleOf(f.properties.w),
    });
    wardFills.bindTooltip((layer) => wardTooltipRef.current(layer.feature.properties.w), {
      sticky: true,
      direction: 'top',
      opacity: 1,
    });
    wardFills.on('click', (e) => onSelectWardRef.current?.(e.layer.feature.properties.w));
    wardFills.on('mouseover', (e) => e.layer.setStyle({ fillOpacity: Math.min(1, wardStyleOf(e.layer.feature.properties.w).fillOpacity + 0.12) }));
    wardFills.on('mouseout', (e) => e.layer.setStyle(wardStyleOf(e.layer.feature.properties.w)));
    wardFillsRef.current = wardFills;

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
      wardFills.remove();
      wards.remove();
      byKey.clear();
      wardBounds.clear();
      pollsRef.current = null;
      wardFillsRef.current = null;
      wardsRef.current = null;
    };
  }, [data, ready]);

  // Swap polls for ward fills, keeping the outlines on top.
  useEffect(() => {
    const map = mapRef.current;
    const polls = pollsRef.current;
    const wardFills = wardFillsRef.current;
    if (!map || !polls || !wardFills) return;
    if (byWard) {
      polls.remove();
      wardFills.addTo(map);
    } else {
      wardFills.remove();
      polls.addTo(map);
    }
    wardsRef.current?.bringToFront();
  }, [byWard, data, ready]);

  useEffect(() => {
    const wardFills = wardFillsRef.current;
    if (!wardFills || !wardStyleFor) return;
    wardFills.eachLayer((layer) => layer.setStyle({ ...wardStyleFor(layer.feature.properties.w), ...BASE_STROKE, weight: 0 }));
  }, [wardStyleFor, data, ready]);

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
