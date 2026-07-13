'use client';

import { useEffect, useRef, useState } from 'react';

// A single reusable Leaflet map for DowntownDefiner. It always shows the
// city boundary, and layers one more thing on top depending on `mode`:
//   - 'drawing': click-to-add-point polygon the user is drawing (`points`, `onMapClick`)
//   - 'static': one fixed polygon to display (`polygon`)
//   - 'choropleth': a pre-colored GeoJSON grid (`grid`, features carry properties.color)
// Fit the map to a [minLng, minLat, maxLng, maxLat] frame, but only once the
// container actually has a size. Two maps initialising together (the results
// view) can call fitBounds while flex layout hasn't settled and the container is
// still 0-wide; fitBounds then locks in a bogus zoom (looks like "no zoom-in").
// Retry on the next frame until the container is real, then fit deterministically.
function fitToFrame(map, frame, attempt = 0) {
  if (!map || !frame || !map._container || !map._container.isConnected) return;  
  const [minLng, minLat, maxLng, maxLat] = frame;
  map.fitBounds([[minLat, minLng], [maxLat, maxLng]]);
}

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
    fitToFrame(map, fit);
    
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

    // ==========================================
    // Build contours from the grid
    // ==========================================
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

    // Build contours for each bucket level
    const levelSegs = Array.from({ length: maxBucket + 1 }, () => []);
    for (const { seg, buckets } of edges.values()) {
      for (let k = 0; k <= maxBucket; k++) {
        let inSet = 0;
        for (const b of buckets) if (b >= k) inSet += 1;
        if (inSet === 1) levelSegs[k].push(seg);
      }
    }

    // ==========================================
    // Build FILL polygons from contours
    // ==========================================
    function buildPolygonsFromContours(segments) {
      if (segments.length === 0) return [];
      
      // Build a graph of connected segments
      const graph = new Map();
      for (const seg of segments) {
        const key1 = `${seg[0][0]},${seg[0][1]}`;
        const key2 = `${seg[1][0]},${seg[1][1]}`;
        if (!graph.has(key1)) graph.set(key1, []);
        if (!graph.has(key2)) graph.set(key2, []);
        graph.get(key1).push({ point: seg[1], key: key2 });
        graph.get(key2).push({ point: seg[0], key: key1 });
      }
      
      // Find closed loops
      const visited = new Set();
      const polygons = [];
      
      for (const [startKey, connections] of graph) {
        if (visited.has(startKey)) continue;
        
        let currentKey = startKey;
        let currentPoint = null;
        const path = [];
        const pathKeys = new Set();
        let foundCycle = false;
        let prevKey = null;
        let attempts = 0;
        const maxAttempts = graph.size * 2;
        
        while (attempts < maxAttempts) {
          attempts++;
          const neighbors = graph.get(currentKey) || [];
          
          let nextNeighbor = null;
          for (const neighbor of neighbors) {
            if (neighbor.key !== prevKey) {
              nextNeighbor = neighbor;
              break;
            }
          }
          
          if (!nextNeighbor) break;
          
          prevKey = currentKey;
          currentKey = nextNeighbor.key;
          currentPoint = nextNeighbor.point;
          
          if (currentKey === startKey && path.length > 2) {
            foundCycle = true;
            break;
          }
          
          if (pathKeys.has(currentKey)) break;
          pathKeys.add(currentKey);
          if (currentPoint) path.push(currentPoint);
        }
        
        if (foundCycle && path.length > 2) {
          const firstPoint = segments.find(s => 
            (s[0][0] === path[0][0] && s[0][1] === path[0][1]) ||
            (s[1][0] === path[0][0] && s[1][1] === path[0][1])
          );
          if (firstPoint) {
            const firstPt = [firstPoint[0][0], firstPoint[0][1]];
            path.push(firstPt);
            polygons.push(path);
            
            for (const p of path) {
              const key = `${p[0]},${p[1]}`;
              visited.add(key);
            }
          }
        }
      }
      
      return polygons;
    }

    // Build fill polygons for each bucket level
    const fillPolygonsByBucket = {};
    for (let k = 0; k <= maxBucket; k++) {
      const segs = levelSegs[k];
      if (segs.length === 0) continue;
      
      const polygons = buildPolygonsFromContours(segs);
      fillPolygonsByBucket[k] = polygons;
    }

    // ==========================================
    // Calculate adjusted opacities for stacked layers
    // ==========================================
    // We want the final visual opacity to range from ~0.5 for lowest bucket to ~0.8 for highest
    // With compounding, we need much smaller per-layer opacities
    const targetOpacities = {};
    const numBuckets = maxBucket + 1;
    
    // Calculate what opacity each layer needs to achieve the target cumulative opacity
    // Using formula: finalOpacity = 1 - (1 - opacity1) * (1 - opacity2) * ...
    // We want: lowest bucket (0) -> ~0.5, highest bucket (maxBucket) -> ~0.8
    for (let k = 0; k <= maxBucket; k++) {
      const t = k / maxBucket; // 0 to 1
      // Target cumulative opacity: 0.5 at bottom, 0.8 at top
      const targetCumulative = 0.5 + t * 0.3;
      
      // Calculate the per-layer opacity needed to achieve this cumulative effect
      // Since layers are additive, we need to distribute the opacity
      // For simplicity, we'll use a small base opacity that compounds
      // With 5 layers, to reach 0.5-0.8, each layer needs ~0.13-0.25
      const baseOpacity = 0.08 + t * 0.12;
      targetOpacities[k] = Math.min(baseOpacity, 0.3);
    }

    // ==========================================
    // Create fill layers (one per bucket, stacked)
    // ==========================================
    const fillLayers = [];
    for (let k = 0; k <= maxBucket; k++) {
      const polygons = fillPolygonsByBucket[k] || [];
      if (polygons.length === 0) continue;
      
      const features = polygons.map(polyCoords => ({
        type: 'Feature',
        properties: {
          bucket: k,
          color: bucketColor[k] || '#000000',
          opacity: targetOpacities[k] || 0.1
        },
        geometry: {
          type: 'Polygon',
          coordinates: [polyCoords.map(p => [p[1], p[0]])]
        }
      }));
      
      const layer = L.geoJSON(features, {
        style: (f) => ({
          stroke: false,
          weight: 0,
          fillColor: f.properties.color,
          fillOpacity: f.properties.opacity,
          interactive: false,
        }),
      });
      fillLayers.push(layer);
    }

    // ==========================================
    // Contour outlines - colored, not white (only white on hover)
    // ==========================================
    // These are the base contours - each bucket gets its colored outline
    const baseContours = levelSegs.map((segs, k) => {
      if (segs.length === 0) return null;
      return L.polyline(segs, {
        color: bucketColor[k] || '#000000',
        weight: 1.5,
        opacity: 0.4,
        interactive: false,
      });
    }).filter(Boolean);

    // White outlines for hover (shown when a bucket is active)
    let hoverWhiteOutlines = null;

    let activeLevel = null;
    let whiteLayer = null;
    let blackLayer = null;
    let clearTimer = null;
    let sticky = false;
    const tooltip = L.tooltip({ sticky: true, direction: 'top', offset: [0, -4], opacity: 1 });

    function clearHover() {
      if (whiteLayer) { map.removeLayer(whiteLayer); whiteLayer = null; }
      if (blackLayer) { map.removeLayer(blackLayer); blackLayer = null; }
      activeLevel = null;
      sticky = false;
      if (map.hasLayer(tooltip)) map.removeLayer(tooltip);
    }

    function showFor(b, pct, ring, latlng) {
      if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
      }
      if (activeLevel !== b) {
        if (whiteLayer) map.removeLayer(whiteLayer);
        // Show white outline for this bucket level
        const segs = levelSegs[b] || [];
        if (segs.length > 0) {
          whiteLayer = L.polyline(segs, { 
            color: '#ffffff', 
            weight: 2.5, 
            interactive: false 
          }).addTo(map);
        }
        activeLevel = b;
      }
      if (blackLayer) map.removeLayer(blackLayer);
      blackLayer = L.polyline(ring, { color: '#000000', weight: 2.5, interactive: false }).addTo(map);

      tooltip.setContent(`${pct}% of people agree this is in downtown`);
      tooltip.setLatLng(latlng);
      if (!map.hasLayer(tooltip)) tooltip.addTo(map);
    }

    function onMapClick() {
      clearHover();
    }
    map.on('click', onMapClick);

    // INVISIBLE hit-test layer
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
        lyr.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          sticky = true;
          showFor(b, pct, ring, e.latlng);
        });
        lyr.on('mouseout', () => {
          if (sticky) return;
          clearTimer = setTimeout(clearHover, 60);
        });
      },
    });

    // Combine all layers
    const layer = L.layerGroup([
      ...fillLayers,
      ...baseContours,
      cellLayer
    ]).addTo(map);
    choroplethLayerRef.current = layer;

    return () => {
      map.off('click', onMapClick);
      if (clearTimer) clearTimeout(clearTimer);
      clearHover();
    };
  }, [mode, grid, mapReady]);

  return <div ref={mapRef} className={className || 'h-96 w-full rounded-lg border border-gray-200'} />;
}