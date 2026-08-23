// Client-only canvas rendering for the "Where would you live?" share card. Built
// from the same primitives as the downtown card so the two look like one family:
// real (muted) street basemap, everything outside the city dimmed, bold header.
//
// The card holds up to three panels — the areas you drew, everyone's heatmap,
// and (when a filter is on) the same heatmap restricted to one group. A zone
// filter also gets the zone square drawn on that panel with a caption, so the
// image explains its own filter to somebody who never saw the site.
import {
  MARGIN,
  HEADER_H,
  FOOTER_H,
  GAP,
  ACCENT,
  INK,
  PANEL,
  setupMercator,
  drawBasemap,
  drawBoundaryMask,
  drawChoropleth,
  traceRings,
  createCanvas,
  drawChrome,
} from '../downtown-definer/canvasRender';

export { canvasToFile } from '../downtown-definer/canvasRender';

// Every area the visitor drew, as one filled shape each.
function drawUserAreas(ctx, m, rect, areas) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  for (const points of areas) {
    if (!points || points.length < 3) continue;
    traceRings(ctx, m.project, [points.map(([lat, lng]) => [lng, lat])]);
    ctx.fillStyle = 'rgba(232, 89, 12, 0.32)';
    ctx.fill();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.restore();
}

// The selected squares. The panel label above already names what the filter is,
// so they carry no caption of their own — they just show WHERE.
function drawZoneOutlines(ctx, m, rect, rings) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();

  for (const ring of rings) {
    const pts = ring.map(([lat, lng]) => m.project(lng, lat));
    // A white keyline under the accent stroke so a square reads clearly over
    // whatever heatmap colour sits beneath it.
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 3.5;
    ctx.stroke();
  }
  ctx.restore();
}

// Same look as the downtown card's panel label, but the type shrinks to fit:
// the filtered panel's label is a full sentence and would otherwise run past
// the edge of a narrow panel in the three-panel layout.
function drawFittedPanelLabel(ctx, rect, label, color) {
  const text = label.toUpperCase();
  const padX = 12;
  const maxTextW = rect.w - 24 - padX * 2;
  let size = 20;
  const font = (px) => `700 ${px}px 'Libre Franklin', system-ui, sans-serif`;
  ctx.font = font(size);
  while (ctx.measureText(text).width > maxTextW && size > 12) {
    size -= 1;
    ctx.font = font(size);
  }

  ctx.textBaseline = 'middle';
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

async function drawPanel(ctx, rect, { bbox, boundary, areas, grid, zoneRings, label, labelColor }) {
  const m = setupMercator(bbox, rect);
  await drawBasemap(ctx, m, rect);
  drawBoundaryMask(ctx, m, rect, boundary);
  if (areas?.length) drawUserAreas(ctx, m, rect, areas);
  if (grid) drawChoropleth(ctx, m, rect, grid);
  if (zoneRings?.length) drawZoneOutlines(ctx, m, rect, zoneRings);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  drawFittedPanelLabel(ctx, rect, label, labelColor);
}

// One share image. Panels, in order: the areas you drew (optional), everyone's
// heatmap, and the filtered heatmap (only when a filter is on).
export async function renderShareCard({
  cityName,
  boundary,
  bbox,
  yourAreas,
  allGrid,
  filteredGrid,
  filterLabel,
  zoneRings,
  totalCount,
  filteredCount,
}) {
  const panels = [];
  if (yourAreas?.length) {
    panels.push({ areas: yourAreas, label: 'Where I would live', labelColor: ACCENT });
  }
  if (allGrid) {
    panels.push({ grid: allGrid, label: 'Where everyone would live', labelColor: INK });
  }
  if (filteredGrid) {
    panels.push({
      grid: filteredGrid,
      zoneRings,
      label: filterLabel,
      labelColor: INK,
    });
  }
  if (panels.length === 0) throw new Error('Nothing to draw.');

  const W = panels.length === 1 ? 1080 : panels.length === 2 ? 1680 : 2280;
  const H = panels.length === 1 ? 1080 : 1000;
  const { canvas, ctx } = await createCanvas(W, H);

  const panelTop = HEADER_H + 16;
  const panelH = H - FOOTER_H - 16 - panelTop;
  const panelW = (W - MARGIN * 2 - GAP * (panels.length - 1)) / panels.length;

  for (let i = 0; i < panels.length; i++) {
    const rect = { x: MARGIN + (panelW + GAP) * i, y: panelTop, w: panelW, h: panelH };
    // Sequential on purpose: panels share one canvas, so drawing order matters.
    await drawPanel(ctx, rect, { bbox, boundary, ...panels[i] });
  }

  const subtitle = filteredGrid
    ? `${totalCount} answer${totalCount === 1 ? '' : 's'} · ${filteredCount} in this filter`
    : `Based on ${totalCount} answer${totalCount === 1 ? '' : 's'}`;
  drawChrome(ctx, W, H, 'Where would you live?', cityName, subtitle);

  return canvas;
}
