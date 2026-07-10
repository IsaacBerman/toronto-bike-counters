'use client';

import { useEffect, useRef, useState } from 'react';

// A single reusable Leaflet map for DowntownDefiner. It always shows the
// city boundary, and layers one more thing on top depending on `mode`:
//   - 'drawing': click-to-add-point polygon the user is drawing (`points`, `onMapClick`)
//   - 'static': one fixed polygon to display (`polygon`)
//   - 'choropleth': a pre-colored GeoJSON grid (`grid`, features carry properties.color)
export default function CityMap({ boundary, bbox, mode, points, onMapClick, onVertexMove, staticPoints, grid, className }) {
  const mapRef = useRef(null);
  const leafletMapRef = useRef(null);
  const leafletRef = useRef(null);
  const boundaryLayerRef = useRef(null);
  const drawLayerRef = useRef(null);
  const staticLayerRef = useRef(null);
  const choroplethLayerRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const bboxRef = useRef(bbox);
  const onMapClickRef = useRef(onMapClick);
  const onVertexMoveRef = useRef(onVertexMove);
  // Leaflet loads asynchronously; flip this to true once the map exists so the
  // layer effects below re-run (a ref assignment alone wouldn't re-render).
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    onMapClickRef.current = onMapClick;
    onVertexMoveRef.current = onVertexMove;
  }, [onMapClick, onVertexMove]);

  // Init map once.
  useEffect(() => {
    let cancelled = false;

    import('leaflet').then((L) => {
      import('leaflet/dist/leaflet.css');
      if (cancelled || !mapRef.current || leafletMapRef.current) return;

      const map = L.map(mapRef.current, { center: [43.6532, -79.3832], zoom: 12 });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);

      map.on('click', (e) => {
        onMapClickRef.current?.([e.latlng.lat, e.latlng.lng]);
      });

      leafletRef.current = L;
      leafletMapRef.current = map;
      setMapReady(true);

      // Keep the map filling its container and re-fit to the city whenever the
      // container is resized (breakpoint changes, late layout). Without this,
      // two maps initialising together can lock in different sizes/zoom.
      if (typeof ResizeObserver !== 'undefined' && mapRef.current) {
        const ro = new ResizeObserver(() => {
          if (!leafletMapRef.current) return;
          leafletMapRef.current.invalidateSize();
          const b = bboxRef.current;
          if (b) {
            const [minLng, minLat, maxLng, maxLat] = b;
            leafletMapRef.current.fitBounds([[minLat, minLng], [maxLat, maxLng]]);
          }
        });
        ro.observe(mapRef.current);
        resizeObserverRef.current = ro;
      }
    });

    return () => {
      cancelled = true;
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
      setMapReady(false);
    };
  }, []);

  // Boundary layer + fit bounds.
  useEffect(() => {
    const L = leafletRef.current;
    const map = leafletMapRef.current;
    if (!L || !map || !boundary) return;

    if (boundaryLayerRef.current) {
      boundaryLayerRef.current.remove();
    }

    boundaryLayerRef.current = L.geoJSON(boundary, {
      style: { color: '#334155', weight: 2, fillOpacity: 0.03, interactive: false },
    }).addTo(map);

    bboxRef.current = bbox;
    if (bbox) {
      map.invalidateSize();
      const [minLng, minLat, maxLng, maxLat] = bbox;
      map.fitBounds([[minLat, minLng], [maxLat, maxLng]]);
    }
  }, [boundary, bbox, mapReady]);

  // Drawing layer (points + vertex markers).
  useEffect(() => {
    const L = leafletRef.current;
    const map = leafletMapRef.current;
    if (!L || !map) return;

    if (drawLayerRef.current) {
      drawLayerRef.current.remove();
      drawLayerRef.current = null;
    }

    if (mode !== 'drawing' || !points || points.length === 0) return;

    const group = L.layerGroup();
    const poly =
      points.length >= 2
        ? L.polygon(points, {
            color: '#2563eb',
            weight: 2,
            fillOpacity: 0.15,
            dashArray: points.length < 3 ? '6 4' : null,
          }).addTo(group)
        : null;

    // Draggable vertices: markers (not circleMarkers) so they can be moved.
    const markers = [];
    points.forEach((point, index) => {
      const isLast = index === points.length - 1;
      const size = isLast ? 18 : 16;
      const fill = isLast ? '#fbbf24' : '#3b82f6';
      const icon = L.divIcon({
        className: 'dd-vertex',
        html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${fill};border:2px solid #fff;box-shadow:0 0 0 1px rgba(29,78,216,0.9);cursor:grab;"></div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      const marker = L.marker(point, { icon, draggable: true, autoPan: true, keyboard: false });
      // Live-update the polygon outline while dragging (no React state churn).
      marker.on('drag', () => {
        if (poly) poly.setLatLngs(markers.map((mk) => mk.getLatLng()));
      });
      // Commit the moved vertex to state on release.
      marker.on('dragend', () => {
        const ll = marker.getLatLng();
        onVertexMoveRef.current?.(index, [ll.lat, ll.lng]);
      });
      marker.addTo(group);
      markers.push(marker);
    });

    group.addTo(map);
    drawLayerRef.current = group;
  }, [mode, points, mapReady]);

  // Static polygon layer (e.g. "your submission").
  useEffect(() => {
    const L = leafletRef.current;
    const map = leafletMapRef.current;
    if (!L || !map) return;

    if (staticLayerRef.current) {
      staticLayerRef.current.remove();
      staticLayerRef.current = null;
    }

    if (mode !== 'static' || !staticPoints || staticPoints.length < 3) return;

    staticLayerRef.current = L.polygon(staticPoints, {
      color: '#2563eb',
      weight: 2,
      fillColor: '#3b82f6',
      fillOpacity: 0.25,
      interactive: false,
    }).addTo(map);
  }, [mode, staticPoints, mapReady]);

  // Choropleth grid layer.
  useEffect(() => {
    const L = leafletRef.current;
    const map = leafletMapRef.current;
    if (!L || !map) return;

    if (choroplethLayerRef.current) {
      choroplethLayerRef.current.remove();
      choroplethLayerRef.current = null;
    }

    if (mode !== 'choropleth' || !grid) return;

    // Group voted cells by their bucket color so hovering one can outline the
    // whole bucket. No-data cells stay non-interactive.
    const colorGroups = new Map();
    let activeColor = null;
    let clearTimer = null;

    const tooltip = L.tooltip({ sticky: true, direction: 'top', offset: [0, -4], opacity: 1 });

    function resetActive() {
      if (activeColor && colorGroups.has(activeColor)) {
        for (const lyr of colorGroups.get(activeColor)) lyr.setStyle({ weight: 0 });
      }
      activeColor = null;
    }

    function clearHover() {
      resetActive();
      if (map.hasLayer(tooltip)) map.removeLayer(tooltip);
    }

    const layer = L.geoJSON(grid, {
      style: (feature) => ({
        color: feature.properties.color,
        weight: 0,
        fillColor: feature.properties.color,
        fillOpacity: feature.properties.opacity ?? 0.75,
        interactive: !feature.properties.noData,
      }),
      onEachFeature: (feature, lyr) => {
        if (feature.properties.noData) return;
        const color = feature.properties.color;
        if (!colorGroups.has(color)) colorGroups.set(color, []);
        colorGroups.get(color).push(lyr);

        const pct = feature.properties.pct ?? 0;
        lyr.on('mouseover', (e) => {
          if (clearTimer) {
            clearTimeout(clearTimer);
            clearTimer = null;
          }
          if (activeColor !== color) {
            resetActive();
            for (const other of colorGroups.get(color)) other.setStyle({ weight: 1, color: '#000' });
            activeColor = color;
          }
          tooltip.setContent(`${pct}% of people agree this is in downtown`);
          tooltip.setLatLng(e.latlng);
          if (!map.hasLayer(tooltip)) tooltip.addTo(map);
        });
        lyr.on('mousemove', (e) => tooltip.setLatLng(e.latlng));
        // Small delay so moving between adjacent cells doesn't flicker; only
        // clears when the pointer actually leaves the heatmap.
        lyr.on('mouseout', () => {
          clearTimer = setTimeout(clearHover, 60);
        });
      },
    }).addTo(map);

    choroplethLayerRef.current = layer;

    return () => {
      if (clearTimer) clearTimeout(clearTimer);
      if (map.hasLayer(tooltip)) map.removeLayer(tooltip);
    };
  }, [mode, grid, mapReady]);

  return <div ref={mapRef} className={className || 'h-96 w-full rounded-lg border border-gray-200'} />;
}
