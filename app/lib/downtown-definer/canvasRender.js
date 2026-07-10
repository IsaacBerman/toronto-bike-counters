// Client-only canvas rendering for share cards. Draws a real (muted) street
// basemap behind the city outline and the user's polygon / heatmap, then a
// bold "civic data" header. Basemap tiles come from CARTO Positron, which sends
// CORS headers, so the canvas stays untainted and toBlob() works everywhere.

const CANVAS_SIZE = 1080;
const MARGIN = 44;
const HEADER_H = 150;
const FOOTER_H = 72;

const MAP_X = MARGIN;
const MAP_Y = HEADER_H;
const MAP_W = CANVAS_SIZE - MARGIN * 2;
const MAP_H = CANVAS_SIZE - HEADER_H - FOOTER_H;

const ACCENT = '#e8590c';
const INK = '#16150f';
const INK_2 = '#57554b';
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

// Build a projector that fits the city bbox into the map area, and remember the
// mercator origin/scale/zoom so the basemap tiles line up with the overlays.
function setupMercator(bbox) {
  const [minLng, minLat, maxLng, maxLat] = bbox;

  // Pick the first zoom where the bbox meets or exceeds the map area, then scale
  // down to fit — keeps tiles sharp rather than upscaled.
  let z = 18;
  for (let zz = 0; zz <= 18; zz++) {
    const [xa, ya] = lngLatToWorld(minLng, maxLat, zz);
    const [xb, yb] = lngLatToWorld(maxLng, minLat, zz);
    if (Math.abs(xb - xa) >= MAP_W || Math.abs(yb - ya) >= MAP_H) {
      z = zz;
      break;
    }
  }

  const [xTL, yTL] = lngLatToWorld(minLng, maxLat, z); // top-left corner
  const [xBR, yBR] = lngLatToWorld(maxLng, minLat, z); // bottom-right corner
  const spanX = xBR - xTL;
  const spanY = yBR - yTL;
  const scale = Math.min(MAP_W / spanX, MAP_H / spanY);
  const drawW = spanX * scale;
  const drawH = spanY * scale;
  const ox = MAP_X + (MAP_W - drawW) / 2;
  const oy = MAP_Y + (MAP_H - drawH) / 2;

  function project(lng, lat) {
    const [px, py] = lngLatToWorld(lng, lat, z);
    return [ox + (px - xTL) * scale, oy + (py - yTL) * scale];
  }

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

async function drawBasemap(ctx, m) {
  const tileMinX = Math.floor(m.xTL / TILE);
  const tileMaxX = Math.floor(m.xBR / TILE);
  const tileMinY = Math.floor(m.yTL / TILE);
  const tileMaxY = Math.floor(m.yBR / TILE);
  const dest = TILE * m.scale;

  ctx.save();
  ctx.beginPath();
  ctx.rect(MAP_X, MAP_Y, MAP_W, MAP_H);
  ctx.clip();

  // Fallback backdrop in case tiles fail to load.
  ctx.fillStyle = '#eef0f2';
  ctx.fillRect(MAP_X, MAP_Y, MAP_W, MAP_H);

  const jobs = [];
  let sub = 0;
  for (let tx = tileMinX; tx <= tileMaxX; tx++) {
    for (let ty = tileMinY; ty <= tileMaxY; ty++) {
      const subdomain = TILE_SUBDOMAINS[sub++ % TILE_SUBDOMAINS.length];
      const url = `https://${subdomain}.basemaps.cartocdn.com/light_all/${m.z}/${tx}/${ty}@2x.png`;
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

// Dim everything outside the city boundary so the eye stays on the city.
function drawBoundaryMask(ctx, m, boundary) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(MAP_X, MAP_Y, MAP_W, MAP_H);
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

  // Crisp outline of the city.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  for (const rings of polygonRings(boundary)) {
    traceRings(ctx, m.project, rings);
    ctx.stroke();
  }
}

function drawUserPolygon(ctx, m, points) {
  const rings = [points.map(([lat, lng]) => [lng, lat])];
  traceRings(ctx, m.project, rings);
  ctx.fillStyle = 'rgba(232, 89, 12, 0.32)';
  ctx.fill();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawChoropleth(ctx, m, grid) {
  for (const feature of grid.features) {
    if (feature.properties.noData) continue; // let the basemap show through empty cells
    ctx.globalAlpha = feature.properties.opacity ?? 0.8;
    ctx.fillStyle = feature.properties.color;
    for (const rings of polygonRings(feature.geometry)) {
      traceRings(ctx, m.project, rings);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawChrome(ctx, kicker, title, subtitle) {
  // Header band
  ctx.fillStyle = PANEL;
  ctx.fillRect(0, 0, CANVAS_SIZE, HEADER_H);
  // Accent block
  ctx.fillStyle = ACCENT;
  ctx.fillRect(MARGIN, 44, 18, 18);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = ACCENT;
  ctx.font = '700 22px Archivo, system-ui, sans-serif';
  ctx.fillText(kicker.toUpperCase(), MARGIN + 30, 60);

  ctx.fillStyle = INK;
  ctx.font = '800 54px Archivo, system-ui, sans-serif';
  ctx.fillText(title, MARGIN, 118);

  // Footer
  ctx.fillStyle = INK_2;
  ctx.font = '600 22px Archivo, system-ui, sans-serif';
  ctx.fillText(subtitle, MARGIN, CANVAS_SIZE - 30);
  ctx.textAlign = 'right';
  ctx.fillStyle = ACCENT;
  ctx.fillText('observingthecity.ca', CANVAS_SIZE - MARGIN, CANVAS_SIZE - 30);
  ctx.textAlign = 'left';

  // Header divider
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, HEADER_H);
  ctx.lineTo(CANVAS_SIZE, HEADER_H);
  ctx.stroke();
}

async function createCard() {
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* fonts optional */
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f3f2ec';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  return { canvas, ctx };
}

export async function renderYourPolygonCard({ cityName, boundary, bbox, points }) {
  const { canvas, ctx } = await createCard();
  const m = setupMercator(bbox);
  await drawBasemap(ctx, m);
  drawBoundaryMask(ctx, m, boundary);
  drawUserPolygon(ctx, m, points);
  drawChrome(ctx, 'My downtown', `${cityName}`, 'How I define downtown · DowntownDefiner');
  return canvas;
}

export async function renderHeatmapCard({ cityName, boundary, bbox, grid, submissionCount }) {
  const { canvas, ctx } = await createCard();
  const m = setupMercator(bbox);
  await drawBasemap(ctx, m);
  drawBoundaryMask(ctx, m, boundary);
  drawChoropleth(ctx, m, grid);
  drawChrome(
    ctx,
    'Downtown, defined',
    `${cityName}`,
    `${submissionCount} definition${submissionCount === 1 ? '' : 's'} · DowntownDefiner`
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
