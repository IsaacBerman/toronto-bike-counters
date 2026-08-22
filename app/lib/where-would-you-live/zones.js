import { area as turfArea, booleanPointInPolygon } from '@turf/turf';
import { computeRotatedFrame } from '../downtown-definer/geo.js';
import { makeLocalProjector, rotate } from '../downtown-definer/heatmapGrid.js';
import { zoneSideMeters, zoneIdAt, ZONE_LAYOUT_VERSION } from './zoneGrid.js';

// The zone layout for a city, from its boundary alone — deterministic, so the
// same city always produces the same squares with the same ids, and the layout
// exists before anyone has answered anything. Laid out in the same rotated
// frame as the hex heatmap so the two grids share the city's orientation.
// Only zones whose center falls inside the boundary are kept.
export function buildZoneLayout(boundary, bbox) {
  const { lng0, lat0, angle, rMinX, rMinY, rMaxX, rMaxY } = computeRotatedFrame(boundary, bbox);
  const areaM2 = turfArea({ type: 'Feature', properties: {}, geometry: boundary });
  const side = zoneSideMeters(areaM2);
  const nx = Math.max(1, Math.ceil((rMaxX - rMinX) / side));
  const ny = Math.max(1, Math.ceil((rMaxY - rMinY) / side));

  const proj = makeLocalProjector(lng0, lat0);
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  const boundaryFeature = { type: 'Feature', properties: {}, geometry: boundary };

  const ids = [];
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const [x, y] = rotate(rMinX + (ix + 0.5) * side, rMinY + (iy + 0.5) * side, cosA, sinA);
      if (booleanPointInPolygon(proj.toLngLat(x, y), boundaryFeature)) ids.push(iy * nx + ix);
    }
  }
  return { version: ZONE_LAYOUT_VERSION, lng0, lat0, angle, side, rMinX, rMinY, nx, ny, ids };
}

// The zone a submission belongs to under the CURRENT layout. Rows store the
// zone square's own center alongside its id precisely so this survives a layout
// change: re-deriving from the center re-homes an old row into the right new
// square, where a bare id would silently point at whatever square now holds
// that index. The id is only a fallback for rows written before centers existed.
export function resolveOriginZone(layout, submission) {
  const center = submission.zoneCenter;
  if (center) {
    const id = zoneIdAt(layout, center[0], center[1]);
    if (id != null) return id;
  }
  return submission.zoneId ?? null;
}
