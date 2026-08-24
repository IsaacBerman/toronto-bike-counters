import { getLiveCityBoundary } from './db.js';

// The city as THIS tool sees it: the same row, but with a wider boundary
// swapped in where one has been set. Every live route that touches geometry —
// clipping a submission, building the hex grid, laying out zones — must go
// through this, or the grid and the answers would be built against different
// shapes. The downtown tool never calls it and is unaffected.
export async function liveCityView(city) {
  if (!city) return city;
  const override = await getLiveCityBoundary(city.id);
  if (!override?.boundary || !override?.bbox) return city;
  return { ...city, boundary: override.boundary, bbox: override.bbox, liveBoundaryOverride: true };
}
