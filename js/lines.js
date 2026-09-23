// Movement-line model: cut/pass/screen/dribble annotations drawn from an
// origin token to either another token or a free court point. Pure data +
// drawing/hit-testing helpers, no DOM/event wiring (that lives in app.js) —
// mirrors the split used for tokens.js.

const LINE_TYPES = { CUT: 'cut', PASS: 'pass', SCREEN: 'screen', DRIBBLE: 'dribble' };

// `end` is either { tokenId } (line follows that token as it moves) or
// { x, y } (line ends at a fixed court point).
function createLine(type, originTokenId, end) {
  return {
    id: crypto.randomUUID(),
    type,
    originTokenId,
    endTokenId: end.tokenId || null,
    endPoint: end.tokenId ? null : { x: end.x, y: end.y },
  };
}

// Resolves a line's current start/end court-space points from live token
// positions. Returns null if the origin (or an attached end) token no
// longer exists — callers should have cascade-deleted such lines already,
// but this keeps rendering/hit-testing defensive.
function resolveLineEndpoints(line, tokens) {
  const origin = tokens.find(t => t.id === line.originTokenId);
  if (!origin) return null;
  if (line.endTokenId) {
    const endToken = tokens.find(t => t.id === line.endTokenId);
    if (!endToken) return null;
    return { start: { x: origin.x, y: origin.y }, end: { x: endToken.x, y: endToken.y } };
  }
  return { start: { x: origin.x, y: origin.y }, end: line.endPoint };
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Finds the topmost (last-drawn) line within hitRadiusFt of the given
// court-space point, approximating curved (dribble) lines with their
// straight start→end segment, which is accurate enough for hit-testing.
function findLineAt(lines, tokens, xFt, yFt, hitRadiusFt = 1.2) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const pts = resolveLineEndpoints(lines[i], tokens);
    if (!pts) continue;
    const d = distanceToSegment(xFt, yFt, pts.start.x, pts.start.y, pts.end.x, pts.end.y);
    if (d <= hitRadiusFt) return lines[i];
  }
  return null;
}

// Shortens the end point back toward the start by `pullBackFt`, so arrows
// and ticks don't get drawn underneath the destination token's circle.
function pullBackPoint(startFt, endFt, pullBackFt) {
  const dx = endFt.x - startFt.x;
  const dy = endFt.y - startFt.y;
  const length = Math.hypot(dx, dy);
  if (length <= pullBackFt) return { x: startFt.x, y: startFt.y };
  const ratio = (length - pullBackFt) / length;
  return { x: startFt.x + dx * ratio, y: startFt.y + dy * ratio };
}

// Samples a sine-wave "squiggle" path between two court-space points, used
// to draw dribble lines. Pure geometry so it's unit-testable without a
// canvas.
function squigglePoints(startFt, endFt, amplitudeFt = 0.6, waveLengthFt = 3) {
  const dx = endFt.x - startFt.x;
  const dy = endFt.y - startFt.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [startFt, endFt];
  const ux = dx / length;
  const uy = dy / length;
  // Perpendicular unit vector.
  const px = -uy;
  const py = ux;
  const steps = Math.max(8, Math.round(length / (waveLengthFt / 8)));
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const alongFt = t * length;
    // Taper the wave to zero at both ends (sin(t*PI)) so the path always
    // starts/ends exactly on startFt/endFt, regardless of how the overall
    // length divides into wavelengths.
    const taper = Math.sin(t * Math.PI);
    const offset = amplitudeFt * Math.sin((alongFt / waveLengthFt) * Math.PI * 2) * taper;
    points.push({
      x: startFt.x + ux * alongFt + px * offset,
      y: startFt.y + uy * alongFt + py * offset,
    });
  }
  return points;
}

function drawArrowhead(ctx, fromPx, toPx, sizePx) {
  const angle = Math.atan2(toPx.y - fromPx.y, toPx.x - fromPx.x);
  const spread = Math.PI / 7;
  ctx.beginPath();
  ctx.moveTo(toPx.x, toPx.y);
  ctx.lineTo(toPx.x + sizePx * Math.cos(angle + Math.PI - spread), toPx.y + sizePx * Math.sin(angle + Math.PI - spread));
  ctx.moveTo(toPx.x, toPx.y);
  ctx.lineTo(toPx.x + sizePx * Math.cos(angle + Math.PI + spread), toPx.y + sizePx * Math.sin(angle + Math.PI + spread));
  ctx.stroke();
}

// Draws a short perpendicular tick centered on `atPx`, oriented across the
// line's direction — the standard "screen" court-diagram symbol.
function drawScreenTick(ctx, fromPx, atPx, sizePx) {
  const angle = Math.atan2(atPx.y - fromPx.y, atPx.x - fromPx.x) + Math.PI / 2;
  ctx.beginPath();
  ctx.moveTo(atPx.x - sizePx * Math.cos(angle), atPx.y - sizePx * Math.sin(angle));
  ctx.lineTo(atPx.x + sizePx * Math.cos(angle), atPx.y + sizePx * Math.sin(angle));
  ctx.stroke();
}

// Draws a single movement line. `options.preview` renders it faded, used
// while the user is still dragging out a new line.
function drawLine(ctx, line, tokens, map, options = {}) {
  const pts = resolveLineEndpoints(line, tokens);
  if (!pts) return;

  const pullBackFt = line.endTokenId ? TOKEN_RADIUS_FT * 1.1 : 0;
  const endFt = pullBackPoint(pts.start, pts.end, pullBackFt);
  const startPx = map.toPx(pts.start.x, pts.start.y);
  const endPx = map.toPx(endFt.x, endFt.y);
  const lineWidthPx = Math.max(2, map.scale * 0.12);
  const arrowSizePx = Math.max(6, map.scale * 0.9);

  ctx.save();
  if (options.preview) ctx.globalAlpha = 0.55;
  ctx.strokeStyle = '#f6f7fb';
  ctx.fillStyle = '#f6f7fb';
  ctx.lineWidth = lineWidthPx;
  ctx.lineCap = 'round';
  ctx.setLineDash([]);

  if (line.type === LINE_TYPES.DRIBBLE) {
    const squiggleFt = squigglePoints(pts.start, endFt);
    const squigglePx = squiggleFt.map(pt => map.toPx(pt.x, pt.y));
    ctx.beginPath();
    squigglePx.forEach((px, i) => {
      if (i === 0) ctx.moveTo(px.x, px.y);
      else ctx.lineTo(px.x, px.y);
    });
    ctx.stroke();
    // Orient the arrowhead along the squiggle's actual final segment (not
    // the straight start→end direction), so it stays attached to and
    // aligned with where the wavy path really ends.
    const lastFromPx = squigglePx[squigglePx.length - 2] || startPx;
    const lastToPx = squigglePx[squigglePx.length - 1];
    drawArrowhead(ctx, lastFromPx, lastToPx, arrowSizePx);
    ctx.restore();
    return;
  }

  if (line.type === LINE_TYPES.PASS) {
    ctx.setLineDash([lineWidthPx * 1.8, lineWidthPx * 1.4]);
  }

  ctx.beginPath();
  ctx.moveTo(startPx.x, startPx.y);
  ctx.lineTo(endPx.x, endPx.y);
  ctx.stroke();
  ctx.setLineDash([]);

  if (line.type === LINE_TYPES.SCREEN) {
    drawScreenTick(ctx, startPx, endPx, arrowSizePx * 0.6);
  } else {
    drawArrowhead(ctx, startPx, endPx, arrowSizePx);
  }

  ctx.restore();
}

function drawLines(ctx, lines, tokens, map) {
  lines.forEach(line => drawLine(ctx, line, tokens, map));
}
