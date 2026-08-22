import { buildZoneLayout } from './zones.js';

// Per-instance memo of the zone layout. Deriving it means a convex hull over a
// detailed city boundary, which is the only non-trivial cost in the zone path —
// and the answer never changes for a given city.
const layoutCache = new Map(); // slug -> layout
const CACHE_MAX = 40;

export function cachedZoneLayout(city) {
  const hit = layoutCache.get(city.slug);
  if (hit) return hit;
  const layout = buildZoneLayout(city.boundary, city.bbox);
  layoutCache.set(city.slug, layout);
  if (layoutCache.size > CACHE_MAX) layoutCache.delete(layoutCache.keys().next().value);
  return layout;
}
