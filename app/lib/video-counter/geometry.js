// Box helpers shared by the detector and the tracker. Boxes are [x, y, w, h]
// in pixels, top-left origin.

export function areaOf(box) {
  return box[2] * box[3];
}

export function centreOf(box) {
  return [box[0] + box[2] / 2, box[1] + box[3] / 2];
}

export function intersectionArea(a, b) {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

export function iou(a, b) {
  const overlap = intersectionArea(a, b);
  if (!overlap) return 0;
  return overlap / (areaOf(a) + areaOf(b) - overlap);
}

// How much of the *smaller* box lies inside the larger one. Catches the case
// IoU misses: a small box sitting entirely within a much bigger one scores low
// on IoU but is plainly the same object seen twice.
export function containment(a, b) {
  const overlap = intersectionArea(a, b);
  if (!overlap) return 0;
  return overlap / Math.min(areaOf(a), areaOf(b));
}
