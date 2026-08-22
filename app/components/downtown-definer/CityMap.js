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

export default function CityMap({ boundary, bbox, fitBbox, mode, points, areas, activeAreaIndex = 0, onMapClick, onVertexMove, onAreaVertexMove, staticPoints, staticAreas, grid, cellTooltip, zones, selectedZoneId, onZoneClick, className }) {
  const mapRef = useRef(null);
  const leafletMapRef = useRef(null);
  const leafletRef = useRef(null);
  const boundaryLayerRef = useRef(null);
  const drawLayerRef = useRef(null);
  const staticLayerRef = useRef(null);
  const choroplethLayerRef = useRef(null);
  const zoneLayerRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const bboxRef = useRef(bbox);
  // Frame known at mount (results maps pass fitBbox), so the map can start
  // aimed at the right city instead of a default view.
  const initialFrameRef = useRef(fitBbox || bbox);
  const onMapClickRef = useRef(onMapClick);
  const onVertexMoveRef = useRef(onVertexMove);
  const onAreaVertexMoveRef = useRef(onAreaVertexMove);
  // What a hovered/tapped choropleth cell says. Held in a ref so passing an
  // inline function doesn't tear down and rebuild the whole grid layer.
  const cellTooltipRef = useRef(cellTooltip);
  const onZoneClickRef = useRef(onZoneClick);
  // Leaflet loads asynchronously; flip this to true once the map exists so the
  // layer effects below re-run (a ref assignment alone wouldn't re-render).
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    onMapClickRef.current = onMapClick;
    onVertexMoveRef.current = onVertexMove;
    onAreaVertexMoveRef.current = onAreaVertexMove;
    cellTooltipRef.current = cellTooltip;
    onZoneClickRef.current = onZoneClick;
  }, [onMapClick, onVertexMove, onAreaVertexMove, cellTooltip, onZoneClick]);

  // Init map once.
  useEffect(() => {
    let cancelled = false;

    import('leaflet').then((L) => {
      import('leaflet/dist/leaflet.css');
      if (cancelled || !mapRef.current || leafletMapRef.current) return;

      // zoomSnap < 1 lets fitBounds settle on a fractional zoom that hugs the
      // frame, instead of rounding down a whole level and leaving a big margin.
      // preferCanvas: the choropleth is thousands of hex polygons (plus an
      // invisible per-cell hit layer); as SVG that many interactive DOM nodes
      // makes desktop Safari's hover hit-testing crawl. The canvas renderer
      // draws them in one element and hit-tests geometrically.
      const map = L.map(mapRef.current, { zoomSnap: 0.25, preferCanvas: true });
      // Aim at the city BEFORE the tile layer exists, so the very first tile
      // requests are for the right place — a default center here briefly
      // showed that city's tiles on every map until fitBounds kicked in.
      const frame = initialFrameRef.current;
      if (frame) {
        const [minLng, minLat, maxLng, maxLat] = frame;
        map.fitBounds([[minLat, minLng], [maxLat, maxLng]]);
      } else {
        map.setView([43.6532, -79.3832], 12);
      }
      // Carto's CDN serves tiles far faster than OSM's donated servers, which
      // left the container grey while tiles trickled in. Voyager is Carto's
      // OSM-like style: beige land, blue water, colored roads, green parks.
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors © CARTO',
        subdomains: 'abcd',
        maxZoom: 20,
      }).addTo(map);

      // Rail overlay (OpenRailwayMap): transparent tiles showing rail/subway/tram
      // lines — useful orientation when drawing or reading the heatmap. Kept very
      // light so it reads as faint reference lines (labels fade with it — they're
      // baked into the raster tiles). Tile layers all live in Leaflet's tilePane,
      // below the vector overlayPane, so this sits above the basemap but under
      // the heatmap and drawn polygons in every mode.
      L.tileLayer('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', {
        attribution: 'Rail overlay © <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a> (CC-BY-SA)',
        subdomains: 'abc',
        maxZoom: 19,
        opacity: 0.25,
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

  // Drawing layer (points + vertex markers). One shape by default (`points`),
  // or several (`areas`, for "Where would you live?") — then only the active
  // area gets draggable vertices, and the rest render as quiet context so a
  // click meant for the map isn't swallowed by an earlier shape.
  useEffect(() => {
    const L = leafletRef.current;
    const map = leafletMapRef.current;
    if (!L || !map) return;

    if (drawLayerRef.current) {
      drawLayerRef.current.remove();
      drawLayerRef.current = null;
    }

    if (mode !== 'drawing') return;
    const multi = Array.isArray(areas);
    const shapes = multi ? areas : points ? [points] : [];
    if (!shapes.some((shape) => shape && shape.length > 0)) return;
    const activeIndex = multi ? activeAreaIndex : 0;

    const group = L.layerGroup();

    shapes.forEach((shape, areaIndex) => {
      if (!shape || shape.length === 0) return;
      const isActive = areaIndex === activeIndex;

      const poly =
        shape.length >= 2
          ? L.polygon(shape, {
              color: isActive ? '#2563eb' : '#64748b',
              weight: 2,
              fillOpacity: isActive ? 0.15 : 0.12,
              dashArray: shape.length < 3 ? '6 4' : null,
              interactive: false,
            }).addTo(group)
          : null;

      // Inactive areas are display-only; the active one carries the handles.
      if (!isActive) return;

      // Draggable vertices: markers (not circleMarkers) so they can be moved.
      const markers = [];
      shape.forEach((point, index) => {
        const isLast = index === shape.length - 1;
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
          if (multi) onAreaVertexMoveRef.current?.(areaIndex, index, [ll.lat, ll.lng]);
          else onVertexMoveRef.current?.(index, [ll.lat, ll.lng]);
        });
        marker.addTo(group);
        markers.push(marker);
      });
    });

    group.addTo(map);
    drawLayerRef.current = group;
  }, [mode, points, areas, activeAreaIndex, mapReady]);

  // Static polygon layer (e.g. "your submission").
  useEffect(() => {
    const L = leafletRef.current;
    const map = leafletMapRef.current;
    if (!L || !map) return;

    if (staticLayerRef.current) {
      staticLayerRef.current.remove();
      staticLayerRef.current = null;
    }

    if (mode !== 'static') return;
    const shapes = (Array.isArray(staticAreas) ? staticAreas : staticPoints ? [staticPoints] : []).filter(
      (shape) => Array.isArray(shape) && shape.length >= 3
    );
    if (shapes.length === 0) return;

    const group = L.layerGroup();
    for (const shape of shapes) {
      L.polygon(shape, {
        color: '#2563eb',
        weight: 2,
        fillColor: '#3b82f6',
        fillOpacity: 0.25,
        interactive: false,
      }).addTo(group);
    }
    group.addTo(map);
    staticLayerRef.current = group;
  }, [mode, staticPoints, staticAreas, mapReady]);

  // Coarse zone layer: the handful of big squares people pick from ("which part
  // of town do you live in?") and hover in the results. Drawn as real polygons
  // rather than a picture of a grid, so what you see is exactly the granularity
  // being recorded — there is no finer location behind it.
  useEffect(() => {
    const L = leafletRef.current;
    const map = leafletMapRef.current;
    if (!L || !map) return undefined;

    if (zoneLayerRef.current) {
      zoneLayerRef.current.remove();
      zoneLayerRef.current = null;
    }

    if (!zones?.length) return undefined;

    const group = L.layerGroup();
    const tooltip = L.tooltip({ sticky: true, direction: 'top', offset: [0, -4], opacity: 1 });

    // ONE highlight outline that moves to whichever zone is hovered, rather than
    // restyling each polygon on mouseover/mouseout. Zones tile edge to edge, and
    // the canvas renderer doesn't reliably fire mouseout when the pointer slides
    // straight from one shape into its neighbour — restyling in place left a
    // stuck outline on every zone the pointer crossed. A single overlay can't
    // accumulate: each mouseover just moves it, so at most one is ever lit, and
    // the map's own mouseout clears it on the way out. Same approach the
    // choropleth below uses for its hovered cell.
    let highlight = null;
    let clearTimer = null;

    function clearHighlight() {
      if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
      }
      if (highlight) {
        map.removeLayer(highlight);
        highlight = null;
      }
      if (map.hasLayer(tooltip)) map.removeLayer(tooltip);
    }

    function highlightZone(zone, latlng) {
      if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
      }
      if (highlight) map.removeLayer(highlight);
      highlight = L.polygon(zone.ring, {
        color: '#e8590c',
        weight: 3,
        opacity: 1,
        fill: false,
        interactive: false,
      }).addTo(map);
      if (zone.label) {
        tooltip.setContent(zone.label);
        tooltip.setLatLng(latlng);
        if (!map.hasLayer(tooltip)) tooltip.addTo(map);
      }
    }

    for (const zone of zones) {
      const selected = zone.id === selectedZoneId;
      const layer = L.polygon(zone.ring, {
        color: selected ? '#e8590c' : '#475569',
        weight: selected ? 3 : 1,
        opacity: selected ? 1 : 0.45,
        fillColor: zone.color || '#94a3b8',
        fillOpacity: zone.fillOpacity ?? (selected ? 0.35 : 0.08),
        interactive: true,
      });

      layer.on('mouseover', (e) => highlightZone(zone, e.latlng));
      layer.on('mousemove', (e) => {
        if (map.hasLayer(tooltip)) tooltip.setLatLng(e.latlng);
      });
      layer.on('mouseout', () => {
        // Short grace period: moving between two zones fires mouseout before the
        // neighbour's mouseover, and cancelling the timer there avoids a flicker.
        clearTimer = setTimeout(clearHighlight, 60);
      });
      layer.on('click', (e) => {
        L.DomEvent.stopPropagation(e); // don't also register as a map click
        onZoneClickRef.current?.(zone.id);
      });

      layer.addTo(group);
    }

    group.addTo(map);
    zoneLayerRef.current = group;
    map.on('mouseout', clearHighlight);

    return () => {
      map.off('mouseout', clearHighlight);
      clearHighlight();
    };
  }, [zones, selectedZoneId, mapReady]);

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
    // Build polygons from contours (returns closed rings)
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

    // Get polygons for each bucket level
    const bucketPolygons = {};
    for (let k = 0; k <= maxBucket; k++) {
      const segs = levelSegs[k];
      if (segs.length === 0) continue;
      bucketPolygons[k] = buildPolygonsFromContours(segs);
    }

    // ==========================================
    // Fill each bucket k as {b >= k} minus {b >= k+1} via the EVEN-ODD fill
    // rule: one polygon holding ALL closed loops of contour level k plus ALL
    // loops of level k+1. A point is filled iff it crosses an odd number of
    // loops — i.e. inside {b>=k} but outside {b>=k+1} — which is exactly the
    // b == k area. Parity handles every nesting case (a lower bucket sitting
    // as an island inside a higher one, or higher-in-lower-in-higher) with no
    // containment tests: an island's boundary is itself a level-k loop, so it
    // flips parity and becomes a hole automatically instead of a false shell.
    // ==========================================
    const ringFeatures = [];
    for (let k = 0; k <= maxBucket; k++) {
      const own = bucketPolygons[k] || [];
      if (own.length === 0) continue;
      const above = bucketPolygons[k + 1] || [];
      const rings = [...own, ...above]
        .filter((loop) => loop && loop.length >= 3)
        .map((loop) => loop.map((p) => [p[1], p[0]])); // [lat, lng] -> [lng, lat]
      if (rings.length === 0) continue;
      ringFeatures.push({
        type: 'Feature',
        properties: {
          bucket: k,
          color: bucketColor[k] || '#000000',
          opacity: bucketOpacity[k] || 0.6
        },
        geometry: { type: 'Polygon', coordinates: rings }
      });
    }

    // ==========================================
    // Create fill layer from ring polygons
    // ==========================================
    const fillLayer = L.geoJSON(ringFeatures, {
      style: (f) => ({
        stroke: false,
        weight: 0,
        fillColor: f.properties.color,
        fillOpacity: f.properties.opacity,
        fillRule: 'evenodd', // the bucket-fill parity trick above depends on this
        interactive: false,
      }),
    });

    // ==========================================
    // Contour outlines - colored base, white on hover
    // ==========================================
    const baseContours = levelSegs.map((segs, k) => {
      if (k === 0 || segs.length === 0) return null;
      return L.polyline(segs, {
        color: bucketColor[k] || '#000000',
        weight: 1.5,
        opacity: 0.4,
        interactive: false,
      });
    }).filter(Boolean);

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

      const describe = cellTooltipRef.current;
      tooltip.setContent(
        describe ? describe(pct) : `${pct}% of people agree this is in downtown`
      );
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
      fillLayer,
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

  // Background matches Voyager's land tone so the not-yet-tiled map reads as
  // "map loading", not broken grey (overrides Leaflet's #ddd).
  return (
    <div
      ref={mapRef}
      className={className || 'h-96 w-full rounded-lg border border-gray-200'}
      style={{ background: '#fbf6ee' }}
    />
  );
}