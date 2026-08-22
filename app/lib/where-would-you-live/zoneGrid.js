// Coarse "which part of town do you live in?" zones. Dependency-free (no turf)
// so the client can rebuild the exact same squares the server laid out, from a
// handful of numbers instead of a payload full of polygons.
//
// The zones are deliberately blunt: nobody is ever asked for a point. The zone
// IS the location — there is no finer version of it stored anywhere — which is
// why the grid is drawn on screen before anyone picks one.
import { makeLocalProjector, rotate, round6 } from '../downtown-definer/heatmapGrid.js';

// Aim for ~50 zones inside the boundary, but never finer than 2 km on a side:
// in a small city 50 zones would be sharper than most people's sense of their
// own neighbourhood, which is exactly the feeling this design avoids.
export const ZONE_TARGET = 50;
export const ZONE_MIN_SIDE_METERS = 2000;

// Bump when the layout math changes, so stored zone aggregates from an older
// layout are rebuilt instead of being read against squares that have moved.
export const ZONE_LAYOUT_VERSION = 1;

// Short, stable fingerprint of a layout. Stored beside each zone grid so a row
// built against different squares is spotted and rebuilt rather than served as
// if the squares hadn't moved.
export function zoneLayoutSignature(layout) {
  if (!layout) return '';
  return [
    layout.version,
    layout.nx,
    layout.ny,
    Math.round(layout.side),
    layout.angle.toFixed(6),
    Math.round(layout.rMinX),
    Math.round(layout.rMinY),
  ].join(':');
}

export function zoneSideMeters(areaM2) {
  return Math.max(ZONE_MIN_SIDE_METERS, Math.sqrt(areaM2 / ZONE_TARGET));
}

// layout: { lng0, lat0, angle, side, rMinX, rMinY, nx, ny, ids }
// Zone ids are linear indices (iy * nx + ix) into the rotated grid, so an id
// alone re-derives its square from the layout.
export function zoneCenterLngLat(layout, id) {
  const { lng0, lat0, angle, side, rMinX, rMinY, nx } = layout;
  const proj = makeLocalProjector(lng0, lat0);
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  const ix = id % nx;
  const iy = Math.floor(id / nx);
  const [x, y] = rotate(rMinX + (ix + 0.5) * side, rMinY + (iy + 0.5) * side, cosA, sinA);
  return proj.toLngLat(x, y);
}

// The zone's square as [lat, lng] corners, ready for Leaflet.
export function zoneRingLatLng(layout, id) {
  const { lng0, lat0, angle, side, rMinX, rMinY, nx } = layout;
  const proj = makeLocalProjector(lng0, lat0);
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  const ix = id % nx;
  const iy = Math.floor(id / nx);
  const x0 = rMinX + ix * side;
  const y0 = rMinY + iy * side;
  return [
    [x0, y0],
    [x0 + side, y0],
    [x0 + side, y0 + side],
    [x0, y0 + side],
  ].map(([px, py]) => {
    const [x, y] = rotate(px, py, cosA, sinA);
    const [lng, lat] = proj.toLngLat(x, y);
    return [round6(lat), round6(lng)];
  });
}

// The zone containing [lng, lat], or null when the point falls outside the
// grid. Pure index arithmetic in the rotated frame — no polygon tests — so it's
// cheap enough to call per click or per drawn area.
export function zoneIdAt(layout, lng, lat) {
  const { lng0, lat0, angle, side, rMinX, rMinY, nx, ny } = layout;
  const proj = makeLocalProjector(lng0, lat0);
  const [x, y] = proj.toXY(lng, lat);
  const [rx, ry] = rotate(x, y, Math.cos(-angle), Math.sin(-angle));
  const ix = Math.floor((rx - rMinX) / side);
  const iy = Math.floor((ry - rMinY) / side);
  if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) return null;
  return iy * nx + ix;
}

// Every zone in the layout, with the geometry the map needs.
export function expandZoneLayout(layout) {
  if (!layout?.ids) return [];
  return layout.ids.map((id) => ({
    id,
    ring: zoneRingLatLng(layout, id),
    center: zoneCenterLngLat(layout, id),
  }));
}
