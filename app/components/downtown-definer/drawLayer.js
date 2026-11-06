// The click-to-place polygon drawing layer, shared by CityMap (Downtown
// Definer, Where would you live?) and the Bike Share station map so a shape
// looks and handles the same everywhere.
//
// `shapes` is a list of [lat, lng] rings. Only the active one gets draggable
// vertices; the rest render as quiet context so a click meant for the map
// isn't swallowed by an earlier shape. `onVertexMove(areaIndex, pointIndex,
// [lat, lng])` fires when a vertex is dropped. Returns a layer group (not yet
// added to the map), or null when there is nothing to draw.
export function buildDrawLayer(L, shapes, activeIndex, onVertexMove) {
  if (!shapes.some((shape) => shape && shape.length > 0)) return null;

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
        onVertexMove?.(areaIndex, index, [ll.lat, ll.lng]);
      });
      marker.addTo(group);
      markers.push(marker);
    });
  });

  return group;
}
