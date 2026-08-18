// Everything painted on top of the video frame. This runs on the same canvas
// that gets encoded, so what the user watches during the pass is exactly what
// lands in the downloaded file — counts included.

import { GROUPS, totalOf } from './tracker';

const COLOR_BY_GROUP = Object.fromEntries(GROUPS.map((g) => [g.key, g.color]));
const INK = '#16150f';

// One scale factor drives every stroke and font so the overlay looks the same
// on a 640px clip and a 1080p one.
function scaleFor(width) {
  return Math.max(1, width / 640);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// The line is vertical by definition, so a crossing is simply rightward or
// leftward and the scoreboard's arrows say which. Nothing to label.
export function drawCountingLine(ctx, line, width, { active = true, hovered = false } = {}) {
  const s = scaleFor(width);
  const top = Math.min(line.y1, line.y2);
  const bottom = Math.max(line.y1, line.y2);
  const stroke = active ? (hovered ? '#cf4e08' : '#e8590c') : '#8a887c';
  // Thicken on hover as well as darkening: the colour shift alone is easy to
  // miss against a busy street scene.
  const weight = (hovered ? 4.5 : 3) * s;

  ctx.save();
  ctx.lineCap = 'round';

  // White halo underneath keeps the line legible over dark asphalt.
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = weight + 3 * s;
  ctx.beginPath();
  ctx.moveTo(line.x, top);
  ctx.lineTo(line.x, bottom);
  ctx.stroke();

  ctx.strokeStyle = stroke;
  ctx.lineWidth = weight;
  ctx.beginPath();
  ctx.moveTo(line.x, top);
  ctx.lineTo(line.x, bottom);
  ctx.stroke();

  // Handles are inset slightly so they stay fully on canvas when the line runs
  // the full height of the frame, which is where it starts.
  const inset = 7 * s;
  for (const y of [top + inset, bottom - inset]) {
    ctx.beginPath();
    ctx.arc(line.x, y, (hovered ? 8 : 7) * s, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 3 * s;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }

  ctx.restore();
}

function drawBox(ctx, track, s, frameIndex, coastDrawFrames, flashFrames) {
  const [x, y, w, h] = track.displayBox || track.box;
  const color = COLOR_BY_GROUP[track.group] || INK;
  // The tick and the shading share one window, so a tick on screen always means
  // the tally just moved. Left on permanently, the tick reads as a fresh count
  // every frame it survives and the number appears not to follow it.
  const justCounted = track.counted && frameIndex - track.countedAtFrame < flashFrames;
  // A coasting track (detector dropped it for a frame or two) stays on screen,
  // dimmed, instead of blinking out and back.
  const coasting = track.misses > 0;

  ctx.save();
  if (coasting) ctx.globalAlpha = Math.max(0.35, 1 - track.misses / (coastDrawFrames + 1));

  ctx.lineWidth = (justCounted ? 4 : 2) * s;
  ctx.strokeStyle = color;
  if (coasting) ctx.setLineDash([6 * s, 4 * s]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);

  if (justCounted) {
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = coasting ? 0.5 : 1;
  }

  const label = justCounted
    ? `${track.className} ✓${track.direction === 'right' ? '→' : '←'}`
    : track.className;
  ctx.font = `700 ${10 * s}px system-ui, sans-serif`;
  const padding = 4 * s;
  const textWidth = ctx.measureText(label).width;
  const chipH = 15 * s;
  const chipY = Math.max(0, y - chipH);

  ctx.fillStyle = color;
  ctx.fillRect(x, chipY, textWidth + padding * 2, chipH);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + padding, chipY + chipH / 2);
  ctx.restore();
}

function drawScoreboard(ctx, counts, groups, width, { time, duration }) {
  const s = scaleFor(width);
  const pad = 10 * s;
  const rowH = 22 * s;
  const panelW = 210 * s;
  const panelH = rowH * groups.length + 34 * s;
  const x = 12 * s;
  const y = 12 * s;

  ctx.save();
  ctx.fillStyle = 'rgba(22,21,15,0.82)';
  roundRect(ctx, x, y, panelW, panelH, 5 * s);
  ctx.fill();

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  ctx.font = `700 ${9 * s}px system-ui, sans-serif`;
  ctx.fillText('CROSSINGS COUNTED', x + pad, y + 13 * s);

  if (duration) {
    ctx.textAlign = 'right';
    ctx.fillText(`${time.toFixed(1)}s / ${duration.toFixed(1)}s`, x + panelW - pad, y + 13 * s);
    ctx.textAlign = 'left';
  }

  groups.forEach((group, i) => {
    const rowY = y + 30 * s + rowH * i + rowH / 2;

    ctx.fillStyle = group.color;
    roundRect(ctx, x + pad, rowY - 5 * s, 10 * s, 10 * s, 2 * s);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = `600 ${11 * s}px system-ui, sans-serif`;
    ctx.fillText(group.label, x + pad + 16 * s, rowY);

    const count = counts[group.key];
    ctx.textAlign = 'right';
    ctx.font = `800 ${15 * s}px system-ui, sans-serif`;
    ctx.fillText(String(totalOf(count)), x + panelW - pad - 48 * s, rowY);

    ctx.font = `600 ${9.5 * s}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(`→${count.right} ←${count.left}`, x + panelW - pad, rowY);
    ctx.textAlign = 'left';
  });

  ctx.restore();
}

export function drawAnnotations(ctx, {
  tracks, counts, groups, line, width, frameIndex, time, duration,
  showBoxes = true, coastDrawFrames = 4, flashFrames = 5,
}) {
  const s = scaleFor(width);
  ctx.save();
  if (showBoxes) {
    for (const track of tracks) {
      // One-frame blips never get drawn; coasting tracks do, up to a point.
      if (track.hits >= 2 && track.misses <= coastDrawFrames) {
        drawBox(ctx, track, s, frameIndex, coastDrawFrames, flashFrames);
      }
    }
  }
  drawCountingLine(ctx, line, width);
  drawScoreboard(ctx, counts, groups, width, { time, duration });
  ctx.restore();
}
