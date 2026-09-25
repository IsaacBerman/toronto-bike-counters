'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cartoTileUrl, CARTO_ATTRIBUTION, CARTO_SUBDOMAINS } from '../../lib/basemapTiles';
import { MODES, peakTotals, sum, fmt, fmtDate } from './modes';

// 95th percentile of a latest count's peak-window volume. Circles are area-
// proportional up to this and flat above it, so the handful of enormous
// suburban arterials don't shrink everything downtown to a dot.
const REF_VOLUME = 13000;

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// Pie radius in CSS pixels at zoom 12, before the zoom factor below.
function baseRadius(total) {
  return 2.2 + 6.5 * Math.sqrt(Math.min(total, REF_VOLUME) / REF_VOLUME);
}

// Pies grow as you zoom in. Counted intersections sit about ten pixels apart at
// city-wide zoom, so the pies have to be smaller than that there or the map
// silts up into one solid disc; by street level there is room to read a slice.
function zoomFactor(zoom) {
  return Math.min(3, Math.max(0.5, Math.pow(1.45, zoom - 12)));
}

// A Leaflet circle marker that paints a pie instead of a disc. Extending
// CircleMarker rather than drawing a free-standing canvas keeps Leaflet's own
// panning, culling, hit-testing and event plumbing — which is what makes six
// thousand of these affordable.
function definePieMarker(L) {
  return L.CircleMarker.extend({
    _updatePath() {
      const ctx = this._renderer?._ctx;
      if (!ctx) return;
      const { x, y } = this._point;
      const r = this._radius;
      const { slices, total, active } = this.options;

      if (total > 0) {
        let start = -Math.PI / 2; // 12 o'clock
        for (let i = 0; i < slices.length; i++) {
          if (!slices[i]) continue;
          const end = start + (slices[i] / total) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.arc(x, y, r, start, end);
          ctx.closePath();
          ctx.fillStyle = MODES[i].color;
          ctx.fill();
          // The gap between slices, in the basemap's stead — only once the pie
          // is big enough that a 1px separator costs less than it buys.
          if (r >= 9) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          start = end;
        }
      }

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = active ? '#16150f' : 'rgba(255,255,255,0.85)';
      ctx.lineWidth = active ? 3 : 1;
      ctx.stroke();
    },
  });
}

function tooltipHtml(intersection) {
  const latest = intersection.counts[0];
  const values = peakTotals(latest);
  const total = sum(values);
  const rows = MODES.map((mode, i) => {
    const share = total ? Math.round((values[i] / total) * 100) : 0;
    return `<tr>
      <td style="padding-right:6px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${mode.color}"></span></td>
      <td style="padding-right:8px">${mode.label}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums">${fmt(values[i])}</td>
      <td style="text-align:right;padding-left:8px;opacity:0.65">${share}%</td>
    </tr>`;
  }).join('');
  return `<div style="font-size:12px">
    <div style="font-weight:700;margin-bottom:2px">${escapeHtml(intersection.name)}</div>
    <div style="opacity:0.7;margin-bottom:4px">Latest count ${fmtDate(latest[0])}${
      intersection.counts.length > 1 ? ` · ${intersection.counts.length} counts since ${intersection.counts[intersection.counts.length - 1][0].slice(0, 4)}` : ''
    }</div>
    <table style="border-collapse:collapse">${rows}</table>
    <div style="margin-top:4px;opacity:0.7">Click to chart this intersection</div>
  </div>`;
}

/**
 * Every counted intersection as a pie of its most recent count's modal split.
 * Clicking one calls onSelect with its id.
 */
export default function IntersectionMap({ intersections, selectedId, onSelect }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const LRef = useRef(null);
  const PieRef = useRef(null);
  const rendererRef = useRef(null);
  const groupRef = useRef(null);
  const byIdRef = useRef(new Map()); // intersection id -> marker
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  // Precomputed once per filter change: the slice values and the untruncated
  // total each pie is drawn from.
  const pies = useMemo(
    () => intersections.map((i) => {
      const slices = peakTotals(i.counts[0]);
      return { intersection: i, slices, total: sum(slices) };
    }),
    [intersections]
  );

  // Init the map once.
  useEffect(() => {
    let cancelled = false;
    import('leaflet').then((L) => {
      import('leaflet/dist/leaflet.css');
      if (cancelled || !elRef.current || mapRef.current) return;
      const map = L.map(elRef.current, {
        center: [43.72, -79.37],
        zoom: 11,
        zoomSnap: 0.25,
        scrollWheelZoom: false,
      });
      L.tileLayer(cartoTileUrl('rastertiles/voyager'), {
        attribution: CARTO_ATTRIBUTION,
        subdomains: CARTO_SUBDOMAINS,
        maxZoom: 20,
      }).addTo(map);
      LRef.current = L;
      PieRef.current = definePieMarker(L);
      rendererRef.current = L.canvas({ padding: 0.15 });
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

  // (Re)build the pies whenever the filtered set changes.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const PieMarker = PieRef.current;
    if (!L || !map || !PieMarker) return undefined;

    const byId = byIdRef.current;
    byId.clear();
    const factor = zoomFactor(map.getZoom());
    const markers = pies.map(({ intersection, slices, total }) => {
      const marker = new PieMarker([intersection.lat, intersection.lon], {
        radius: baseRadius(total) * factor,
        renderer: rendererRef.current,
        slices,
        total,
        intersection,
        active: false,
        // A click on a pie selects that intersection and stops there, rather
        // than also reaching the map underneath.
        bubblingMouseEvents: false,
      });
      byId.set(intersection.id, marker);
      return marker;
    });

    // One group, so the click handler and the tooltip are bound once rather
    // than six thousand times.
    const group = L.featureGroup(markers).addTo(map);
    group.on('click', (e) => {
      const layer = e.propagatedFrom || e.layer;
      if (layer?.options?.intersection) onSelectRef.current?.(layer.options.intersection.id);
    });
    // Leaflet hands a group's tooltip the child layer the pointer is actually
    // over, so one tooltip covers every pie.
    group.bindTooltip((layer) => tooltipHtml(layer.options.intersection), {
      sticky: true,
      direction: 'top',
      opacity: 1,
    });
    groupRef.current = group;

    // Radii are in screen pixels, so they have to be restated on every zoom.
    const onZoom = () => {
      const f = zoomFactor(map.getZoom());
      for (let i = 0; i < markers.length; i++) {
        markers[i].setRadius(baseRadius(pies[i].total) * f);
      }
    };
    map.on('zoomend', onZoom);

    return () => {
      map.off('zoomend', onZoom);
      group.remove();
      byId.clear();
      groupRef.current = null;
    };
  }, [pies, ready]);

  // Outline the selected pie without rebuilding the layer.
  const prevSelected = useRef(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const clear = byIdRef.current.get(prevSelected.current);
    if (clear) {
      clear.options.active = false;
      clear.redraw();
    }
    const mark = byIdRef.current.get(selectedId);
    if (mark) {
      mark.options.active = true;
      mark.bringToFront();
      mark.redraw();
    }
    prevSelected.current = selectedId;
  }, [selectedId, pies, ready]);

  return (
    <div>
      <div ref={elRef} className="w-full rounded" style={{ height: 560, background: 'var(--paper)' }} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-xs" style={{ color: 'var(--ink-2)' }}>
        <span className="font-semibold">Share of traffic</span>
        {MODES.map((mode) => (
          <span key={mode.key} className="flex items-center gap-1.5">
            <span
              className="inline-block rounded-full shrink-0"
              style={{ width: 10, height: 10, background: mode.color }}
            />
            <span>{mode.label}</span>
          </span>
        ))}
        <span style={{ color: 'var(--ink-3)' }}>Bigger pie = more traffic counted.</span>
      </div>
    </div>
  );
}
