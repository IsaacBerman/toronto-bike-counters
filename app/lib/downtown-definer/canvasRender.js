// Client-only canvas rendering for the share card. Produces a single image with
// the user's polygon and the crowd heatmap side by side, each over a real (muted)
// street basemap with the area outside the city dimmed, under a bold "civic data"
// header. Basemap tiles come from CARTO Voyager, which shows major roads/labels
// and sends CORS headers, so the canvas stays untainted and toBlob() works.

const MARGIN = 44;
const HEADER_H = 150;
const FOOTER_H = 72;
const GAP = 24;

const ACCENT = '#e8590c';
const INK = '#16150f';
const INK_2 = '#57554b';
const PAPER = '#f3f2ec';
const PANEL = '#ffffff';

const TILE = 256;
const TILE_SUBDOMAINS = ['a', 'b', 'c', 'd'];

// ---- Web-mercator helpers ----

function lngLatToWorld(lng, lat, z) {
  const worldPx = TILE * 2 ** z;
  const x = ((lng + 180) / 360) * worldPx;
  const s = Math.max(-0.9999, Math.min(0.9999, Math.sin((lat * Math.PI) / 180)));
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldPx;
  return [x, y];
}

// Fit the city bbox into a rect, remembering mercator origin/scale/zoom so the
// basemap tiles line up with the overlays.
function setupMercator(bbox, rect) {
  const [minLng, minLat, maxLng, maxLat] = bbox;

  let z = 18;
  for (let zz = 0; zz <= 18; zz++) {
    const [xa, ya] = lngLatToWorld(minLng, maxLat, zz);
    const [xb, yb] = lngLatToWorld(maxLng, minLat, zz);
    if (Math.abs(xb - xa) >= rect.w || Math.abs(yb - ya) >= rect.h) {
      z = zz;
      break;
    }
  }

  const [xTL, yTL] = lngLatToWorld(minLng, maxLat, z);
  const [xBR, yBR] = lngLatToWorld(maxLng, minLat, z);
  const spanX = xBR - xTL;
  const spanY = yBR - yTL;
  const scale = Math.min(rect.w / spanX, rect.h / spanY);
  const ox = rect.x + (rect.w - spanX * scale) / 2;
  const oy = rect.y + (rect.h - spanY * scale) / 2;

  const project = (lng, lat) => {
    const [px, py] = lngLatToWorld(lng, lat, z);
    return [ox + (px - xTL) * scale, oy + (py - yTL) * scale];
  };

  return { z, xTL, yTL, xBR, yBR, scale, ox, oy, project };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function drawBasemap(ctx, m, rect) {
  const tileMinX = Math.floor(m.xTL / TILE);
  const tileMaxX = Math.floor(m.xBR / TILE);
  const tileMinY = Math.floor(m.yTL / TILE);
  const tileMaxY = Math.floor(m.yBR / TILE);
  const dest = TILE * m.scale;

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.fillStyle = '#eef0f2';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  const jobs = [];
  let sub = 0;
  for (let tx = tileMinX; tx <= tileMaxX; tx++) {
    for (let ty = tileMinY; ty <= tileMaxY; ty++) {
      const subdomain = TILE_SUBDOMAINS[sub++ % TILE_SUBDOMAINS.length];
      const url = `https://${subdomain}.basemaps.cartocdn.com/rastertiles/voyager/${m.z}/${tx}/${ty}@2x.png`;
      const dx = m.ox + (tx * TILE - m.xTL) * m.scale;
      const dy = m.oy + (ty * TILE - m.yTL) * m.scale;
      jobs.push(
        loadImage(url)
          .then((img) => ctx.drawImage(img, dx, dy, dest, dest))
          .catch(() => {})
      );
    }
  }
  await Promise.all(jobs);
  ctx.restore();
}

// ---- Overlay drawing ----

function polygonRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function traceRings(ctx, project, rings) {
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

function drawBoundaryMask(ctx, m, rect, boundary) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  for (const rings of polygonRings(boundary)) {
    for (const ring of rings) {
      ring.forEach(([lng, lat], index) => {
        const [x, y] = m.project(lng, lat);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
  }
  ctx.fillStyle = 'rgba(243, 242, 236, 0.72)';
  ctx.fill('evenodd');
  ctx.restore();

  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  for (const rings of polygonRings(boundary)) {
    traceRings(ctx, m.project, rings);
    ctx.stroke();
  }
}

function drawUserPolygon(ctx, m, rect, points) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  traceRings(ctx, m.project, [points.map(([lat, lng]) => [lng, lat])]);
  ctx.fillStyle = 'rgba(232, 89, 12, 0.32)';
  ctx.fill();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

function drawChoropleth(ctx, m, rect, grid) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  for (const feature of grid.features) {
    if (feature.properties.noData) continue;
    // Slightly more translucent than the interactive map so basemap roads
    // remain legible through the heatmap in the shared image.
    const op = feature.properties.opacity ?? 0.8;
    // Stroke at half the fill opacity so overlapping strokes on shared hex edges
    // don't read as dark seams while still closing hairline gaps.
    const strokeOp = op / 2;
    ctx.fillStyle = feature.properties.color;
    ctx.strokeStyle = feature.properties.color;
    ctx.lineWidth = 1;
    for (const rings of polygonRings(feature.geometry)) {
      traceRings(ctx, m.project, rings);
      ctx.globalAlpha = op;
      ctx.fill();
      ctx.globalAlpha = strokeOp;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawPanelLabel(ctx, rect, label, color) {
  ctx.font = '700 20px Archivo, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const text = label.toUpperCase();
  const padX = 12;
  const w = ctx.measureText(text).width + padX * 2;
  const h = 34;
  const x = rect.x + 12;
  const y = rect.y + 12;
  ctx.fillStyle = PANEL;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillText(text, x + padX, y + h / 2 + 1);
  ctx.textBaseline = 'alphabetic';
}

async function drawPanel(ctx, rect, { bbox, boundary, points, grid, label, labelColor }) {
  const m = setupMercator(bbox, rect);
  await drawBasemap(ctx, m, rect);
  drawBoundaryMask(ctx, m, rect, boundary);
  if (points) drawUserPolygon(ctx, m, rect, points);
  if (grid) drawChoropleth(ctx, m, rect, grid);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  drawPanelLabel(ctx, rect, label, labelColor);
}

function drawChrome(ctx, W, H, kicker, title, subtitle) {
  ctx.fillStyle = PANEL;
  ctx.fillRect(0, 0, W, HEADER_H);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(MARGIN, 44, 18, 18);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = ACCENT;
  ctx.font = '700 22px Archivo, system-ui, sans-serif';
  ctx.fillText(kicker.toUpperCase(), MARGIN + 30, 60);

  ctx.fillStyle = INK;
  ctx.font = '800 54px Archivo, system-ui, sans-serif';
  ctx.fillText(title, MARGIN, 118);

  ctx.fillStyle = INK_2;
  ctx.font = '600 22px Archivo, system-ui, sans-serif';
  ctx.fillText(subtitle, MARGIN, H - 30);
  ctx.textAlign = 'right';
  ctx.fillStyle = ACCENT;
  ctx.fillText('observingthecity.ca', W - MARGIN, H - 30);
  ctx.textAlign = 'left';

  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, HEADER_H);
  ctx.lineTo(W, HEADER_H);
  ctx.stroke();
}

async function createCanvas(W, H) {
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* fonts optional */
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  return { canvas, ctx };
}

// Single share image. With a user polygon it renders two panels side by side
// (My downtown | Everyone's downtown); without one it renders just the heatmap.
export async function renderShareCard({ cityName, boundary, bbox, yourPoints, grid, submissionCount, score }) {
  const hasYours = yourPoints && yourPoints.length >= 3;
  const yourLabel = score != null ? `My downtown · Score: ${score}` : 'My downtown';
  const W = hasYours ? 1680 : 1080;
  const H = hasYours ? 1000 : 1080;
  const { canvas, ctx } = await createCanvas(W, H);

  const panelTop = HEADER_H + 16;
  const panelH = H - FOOTER_H - 16 - panelTop;

  if (hasYours) {
    const panelW = (W - MARGIN * 2 - GAP) / 2;
    await drawPanel(ctx, { x: MARGIN, y: panelTop, w: panelW, h: panelH }, {
      bbox,
      boundary,
      points: yourPoints,
      label: yourLabel,
      labelColor: ACCENT,
    });
    await drawPanel(ctx, { x: MARGIN + panelW + GAP, y: panelTop, w: panelW, h: panelH }, {
      bbox,
      boundary,
      grid,
      label: "Everyone's downtown",
      labelColor: INK,
    });
  } else {
    await drawPanel(ctx, { x: MARGIN, y: panelTop, w: W - MARGIN * 2, h: panelH }, {
      bbox,
      boundary,
      grid,
      label: "Everyone's downtown",
      labelColor: INK,
    });
  }

  drawChrome(
    ctx,
    W,
    H,
    'Where is downtown?',
    cityName,
    `Based on ${submissionCount} definition${submissionCount === 1 ? '' : 's'}`
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
