'use client';

import { useEffect, useRef, useState } from 'react';

// Choropleth of Toronto's 25 wards. Each ward is filled by `wardStyles[ward]`
// (a { fillColor, label } computed by the parent from the current mode / year /
// distance selection). Clicking a ward calls onSelectWard; the selected ward
// gets a heavy outline. The layer is built once, then re-styled in place when
// the selection changes — rebuilding on every control change flickered.
export default function WardMap({
  geo,
  cityBoundary,
  citySelected,
  wardStyles,
  selectedWard,
  onSelectWard,
  className,
}) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const LRef = useRef(null);
  const layersRef = useRef(new Map()); // ward -> leaflet layer
  const cityLayerRef = useRef(null);
  const onSelectRef = useRef(onSelectWard);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelectWard;
  }, [onSelectWard]);

  // Init map once.
  useEffect(() => {
    let cancelled = false;
    import('leaflet').then((L) => {
      import('leaflet/dist/leaflet.css');
      if (cancelled || !elRef.current || mapRef.current) return;
      const map = L.map(elRef.current, { zoomSnap: 0.25, scrollWheelZoom: false });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors © CARTO',
        subdomains: 'abcd',
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
      setReady(false);
    };
  }, []);

  // Build the ward layer once geo + map are ready.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map || !geo || layersRef.current.size) return;

    const gj = L.geoJSON(geo, {
      style: { color: '#ffffff', weight: 1, fillColor: '#dddddd', fillOpacity: 0.85 },
      onEachFeature: (feature, layer) => {
        const ward = feature.properties.ward;
        layersRef.current.set(ward, layer);
        layer.on('click', () => onSelectRef.current?.(ward));
        layer.on('mouseover', () => layer.setStyle({ weight: 2.5 }));
        layer.on('mouseout', () => {
          if (ward !== selectedWardRef.current) layer.setStyle({ weight: 1 });
        });
        layer.bindTooltip('', { sticky: true, direction: 'top', opacity: 1 });
      },
    }).addTo(map);

    map.fitBounds(gj.getBounds(), { padding: [8, 8] });
  }, [geo, ready]);

  // Keep a ref to the selected ward so the mouseout handler (bound once) knows
  // not to reset the outline of the currently-selected ward.
  const selectedWardRef = useRef(selectedWard);
  useEffect(() => {
    selectedWardRef.current = selectedWard;
  }, [selectedWard]);

  // Re-style when selection / values change.
  useEffect(() => {
    if (!wardStyles) return;
    let selectedLayer = null;
    for (const [ward, layer] of layersRef.current) {
      const s = wardStyles[ward];
      const isSel = ward === selectedWard;
      layer.setStyle({
        fillColor: s?.fillColor ?? '#dddddd',
        fillOpacity: 0.9,
        color: isSel ? '#16150f' : s?.strokeColor ?? '#ffffff',
        weight: isSel ? 3 : s?.strokeWeight ?? 1,
      });
      // Bring emphasised wards (goal outline) to the front so their coloured
      // border paints over neighbours' white borders instead of being hidden
      // by them. The selected ward is raised last so it stays topmost.
      if (s?.strokeColor && layer.bringToFront) layer.bringToFront();
      if (isSel) selectedLayer = layer;
      if (s?.label) layer.setTooltipContent(s.label);
    }
    if (selectedLayer?.bringToFront) selectedLayer.bringToFront();
  }, [wardStyles, selectedWard, ready]);

  // City-boundary highlight: shown only when "Entire City" is selected. A heavy
  // ink outline around the whole city, kept on top of every ward border.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map || !cityBoundary) return;
    if (cityLayerRef.current) {
      cityLayerRef.current.remove();
      cityLayerRef.current = null;
    }
    if (!citySelected) return;
    cityLayerRef.current = L.geoJSON(cityBoundary, {
      style: { color: '#16150f', weight: 4, fill: false, interactive: false },
    }).addTo(map);
    cityLayerRef.current.bringToFront();
  }, [cityBoundary, citySelected, ready]);

  return (
    <div
      ref={elRef}
      className={className || 'h-[520px] w-full rounded'}
      style={{ background: '#fbf6ee' }}
    />
  );
}
