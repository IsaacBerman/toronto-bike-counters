'use client';

import { useEffect, useRef, useState } from 'react';

// A single reusable Leaflet map for DowntownDefiner. It always shows the
// city boundary, and layers one more thing on top depending on `mode`:
//   - 'drawing': click-to-add-point polygon the user is drawing (`points`, `onMapClick`)
//   - 'static': one fixed polygon to display (`polygon`)
//   - 'choropleth': a pre-colored GeoJSON grid (`grid`, features carry properties.color)
export default function CityMap({ boundary, bbox, fitBbox, mode, points, onMapClick, onVertexMove, staticPoints, grid, className }) {
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

      // zoomSnap < 1 lets fitBounds settle on a fractional zoom that hugs the
      // frame, instead of rounding down a whole level and leaving a big margin.
      const map = L.map(mapRef.current, { center: [43.6532, -79.3832], zoom: 12, zoomSnap: 0.25 });
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

    // Frame to fitBbox when provided (e.g. results maps zoom to the consensus +
    // the user's shape), otherwise the full city bbox.
    const fit = fitBbox || bbox;
    bboxRef.current = fit;
    if (fit) {
      map.invalidateSize();
      const [minLng, minLat, maxLng, maxLat] = fit;
      map.fitBounds([[minLat, minLng], [maxLat, maxLng]]);
    }
  }, [boundary, bbox, fitBbox, mapReady]);

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

    // Precompute, for each bucket level k, the white outline of the union of all
    // cells with bucket >= k (a nested "this agreement or higher" contour). An
    // edge is on that union's boundary when exactly one of its two adjacent
    // cells is in the set; a grid-edge cell counts the empty side as "out".
    const edges = new Map(); // edgeKey -> { seg, buckets: number[] }
    const bucketColor = {}; // bucket -> fill color
    const bucketOpacity = {}; // bucket -> fill opacity
    let maxBucket = 0;
    for (const feature of grid.features) {
      if (feature.properties.noData) continue;
      const b = feature.properties.b ?? 0;
      if (b > maxBucket) maxBucket = b;
      if (bucketColor[b] === undefined) {
        bucketColor[b] = feature.properties.color;
        bucketOpacity[b] = feature.properties.opacity ?? 0.6;
      }
      const ring = feature.geometry.coordinates[0]; // closed ring (hexagon = 7 pts)
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i];
        const c = ring[i + 1];
        const ka = `${a[0]},${a[1]}`;
        const kc = `${c[0]},${c[1]}`;
        const key = ka < kc ? `${ka}|${kc}` : `${kc}|${ka}`;
        const found = edges.get(key);
        if (found) found.buckets.push(b);
        else edges.set(key, { seg: [[a[1], a[0]], [c[1], c[0]]], buckets: [b] });
      }
    }

    const levelSegs = Array.from({ length: maxBucket + 1 }, () => []);
    for (const { seg, buckets } of edges.values()) {
      for (let k = 0; k <= maxBucket; k++) {
        let inSet = 0;
        for (const b of buckets) if (b >= k) inSet += 1;
        if (inSet === 1) levelSegs[k].push(seg);
      }
    }
    const levelOutlines = levelSegs.map((segs) =>
      L.polyline(segs, { color: '#ffffff', weight: 2, interactive: false })
    );

    // Always-visible contour for each bucket, drawn on its own boundary in that
    // bucket's fill color. As well as reading like a contour map, these lines sit
    // exactly on the seams between adjacent (differently-colored) bucket regions,
    // covering the hairline anti-aliasing gaps that show when zoomed out.
    const staticContours = levelSegs.map((segs, k) =>
      L.polyline(segs, {
        color: bucketColor[k] ?? '#000000',
        weight: 1.5,
        opacity: bucketOpacity[k] ?? 0.6,
        interactive: false,
      })
    );

    let activeLevel = null;
    let whiteLayer = null;
    let blackLayer = null;
    let clearTimer = null;
    let sticky = false; // set by tap/click so the highlight persists on mobile
    const tooltip = L.tooltip({ sticky: true, direction: 'top', offset: [0, -4], opacity: 1 });

    function clearHover() {
      if (whiteLayer) { map.removeLayer(whiteLayer); whiteLayer = null; }
      if (blackLayer) { map.removeLayer(blackLayer); blackLayer = null; }
      activeLevel = null;
      sticky = false;
      if (map.hasLayer(tooltip)) map.removeLayer(tooltip);
    }

    // Show the contour + tooltip for a cell (shared by hover and tap).
    function showFor(b, pct, ring, latlng) {
      if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
      }
      if (activeLevel !== b) {
        if (whiteLayer) map.removeLayer(whiteLayer);
        whiteLayer = levelOutlines[b] || null;
        if (whiteLayer) whiteLayer.addTo(map);
        activeLevel = b;
      }
      // Black outline around just this cell, drawn last (on top).
      if (blackLayer) map.removeLayer(blackLayer);
      blackLayer = L.polyline(ring, { color: '#000000', weight: 2.5, interactive: false }).addTo(map);

      tooltip.setContent(`${pct}% of people agree this is in downtown`);
      tooltip.setLatLng(latlng);
      if (!map.hasLayer(tooltip)) tooltip.addTo(map);
    }

    // Tapping empty space (or a no-data cell) dismisses a stuck highlight.
    function onMapClick() {
      clearHover();
    }
    map.on('click', onMapClick);

    // VISIBLE fill: merge all cells sharing a color+opacity (i.e. the same
    // bucket) into a single MultiPolygon and fill it in one pass. Because it's
    // one fill, the shared hex edges are interior — no anti-aliased seams and no
    // stroke needed. Rendered non-interactive, below the hit-test layer.
    const groups = new Map(); // `${color}|${opacity}` -> { color, opacity, polys }
    for (const feature of grid.features) {
      const { color, opacity } = feature.properties;
      const key = `${color}|${opacity}`;
      let g = groups.get(key);
      if (!g) {
        g = { color, opacity: opacity ?? 0.75, polys: [] };
        groups.set(key, g);
      }
      g.polys.push(feature.geometry.coordinates); // a Polygon's [ring]
    }
    const mergedFeatures = [...groups.values()].map((g) => ({
      type: 'Feature',
      properties: { color: g.color, opacity: g.opacity },
      geometry: { type: 'MultiPolygon', coordinates: g.polys },
    }));
    const fillLayer = L.geoJSON(mergedFeatures, {
      style: (f) => ({
        stroke: false,
        weight: 0,
        fillColor: f.properties.color,
        fillOpacity: f.properties.opacity,
        interactive: false,
      }),
    });

    // INVISIBLE hit-test layer: the individual cells, transparent but interactive,
    // on top — so the tooltip/contour hover still works per cell.
    const cellLayer = L.geoJSON(grid, {
      style: (feature) => ({
        stroke: false,
        weight: 0,
        fillOpacity: 0,
        interactive: !feature.properties.noData,
      }),
      onEachFeature: (feature, lyr) => {
        if (feature.properties.noData) return;
        const b = feature.properties.b ?? 0;
        const pct = feature.properties.pct ?? 0;
        const ring = feature.geometry.coordinates[0].map(([lng, lat]) => [lat, lng]);

        lyr.on('mouseover', (e) => {
          if (sticky) return;
          showFor(b, pct, ring, e.latlng);
        });
        lyr.on('mousemove', (e) => {
          if (!sticky) tooltip.setLatLng(e.latlng);
        });
        // Tap/click: keep it shown until another tap. Stop the map-click that
        // would otherwise immediately clear it.
        lyr.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          sticky = true;
          showFor(b, pct, ring, e.latlng);
        });
        // Small delay so moving between adjacent cells doesn't flicker; only
        // clears when the pointer actually leaves the heatmap.
        lyr.on('mouseout', () => {
          if (sticky) return;
          clearTimer = setTimeout(clearHover, 60);
        });
      },
    });

    const layer = L.layerGroup([fillLayer, ...staticContours, cellLayer]).addTo(map);
    choroplethLayerRef.current = layer;

    return () => {
      map.off('click', onMapClick);
      if (clearTimer) clearTimeout(clearTimer);
      clearHover();
    };
  }, [mode, grid, mapReady]);

  return <div ref={mapRef} className={className || 'h-96 w-full rounded-lg border border-gray-200'} />;
}
