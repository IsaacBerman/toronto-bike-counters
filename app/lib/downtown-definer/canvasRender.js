const CANVAS_SIZE = 1080;
const PADDING = 90;

// Client-only canvas rendering for share cards. Deliberately draws no basemap
// tiles (just the city outline + a shape) so it never depends on OSM tile
// CORS/canvas-taint behaviour.

function makeProjector(bbox) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const midLat = (minLat + maxLat) / 2;
  const cos = Math.cos((midLat * Math.PI) / 180) || 1;
  const w = (maxLng - minLng) * cos;
  const h = maxLat - minLat;
  const available = CANVAS_SIZE - PADDING * 2;
  const scale = Math.min(available / w, available / h);
  const offsetX = PADDING + (available - w * scale) / 2;
  const offsetY = PADDING + (available - h * scale) / 2;

  return function project(lng, lat) {
    const x = offsetX + (lng - minLng) * cos * scale;
    const y = CANVAS_SIZE - offsetY - (lat - minLat) * scale;
    return [x, y];
  };
}

function polygonRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function tracePolygon(ctx, project, rings) {
  ctx.beginPath();
  for (const ring of rings) {
    ring.forEach(([lng, lat], index) => {
      const [x, y] = project(lng, lat);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
}

function drawBoundary(ctx, project, boundary) {
  ctx.fillStyle = '#f9f9f7';
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 3;
  for (const rings of polygonRings(boundary)) {
    tracePolygon(ctx, project, rings);
    ctx.fill('evenodd');
    ctx.stroke();
  }
}

function drawUserPolygon(ctx, project, points) {
  const rings = [[...points.map(([lat, lng]) => [lng, lat])]];
  ctx.fillStyle = 'rgba(37, 99, 235, 0.35)';
  ctx.strokeStyle = '#1d4ed8';
  ctx.lineWidth = 3;
  tracePolygon(ctx, project, rings[0]);
  ctx.fill();
  ctx.stroke();
}

function drawChoropleth(ctx, project, grid) {
  for (const feature of grid.features) {
    ctx.globalAlpha = feature.properties.opacity ?? 0.8;
    ctx.fillStyle = feature.properties.color;
    for (const rings of polygonRings(feature.geometry)) {
      tracePolygon(ctx, project, rings);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawChrome(ctx, title, subtitle) {
  ctx.fillStyle = '#0b0b0b';
  ctx.font = '600 40px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(title, PADDING, 28);

  ctx.fillStyle = '#52514e';
  ctx.font = '400 24px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText(subtitle, PADDING, 78);

  ctx.fillStyle = '#898781';
  ctx.font = '400 20px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('observingthecity.ca/downtown-definer', CANVAS_SIZE - PADDING, CANVAS_SIZE - 46);
  ctx.textAlign = 'left';
}

function createCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fcfcfb';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  return { canvas, ctx };
}

export function renderYourPolygonCard({ cityName, boundary, bbox, points }) {
  const { canvas, ctx } = createCanvas();
  const project = makeProjector(bbox);
  drawBoundary(ctx, project, boundary);
  drawUserPolygon(ctx, project, points);
  drawChrome(ctx, `My ${cityName} downtown`, 'via DowntownDefiner');
  return canvas;
}

export function renderHeatmapCard({ cityName, boundary, bbox, grid, submissionCount }) {
  const { canvas, ctx } = createCanvas();
  const project = makeProjector(bbox);
  drawBoundary(ctx, project, boundary);
  drawChoropleth(ctx, project, grid);
  drawChrome(
    ctx,
    `${cityName}'s downtown, defined`,
    `${submissionCount} submission${submissionCount === 1 ? '' : 's'} · via DowntownDefiner`
  );
  return canvas;
}

export function canvasToFile(canvas, filename) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Could not generate image.'));
        return;
      }
      resolve(new File([blob], filename, { type: 'image/png' }));
    }, 'image/png');
  });
}
