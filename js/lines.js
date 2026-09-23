// Movement-line model: cut/pass/screen/dribble annotations drawn from an
// origin token to either another token or a free court point. Pure data +
// drawing/hit-testing helpers, no DOM/event wiring (that lives in app.js) —
// mirrors the split used for tokens.js.

const LINE_TYPES = { CUT: 'cut', PASS: 'pass', SCREEN: 'screen', DRIBBLE: 'dribble' };
// How close (in feet) a pointer must land to a line's curve/endpoint handle
// to grab it, once the line is selected.
const LINE_HANDLE_HIT_RADIUS_FT = 1.4;

// `end` is either { tokenId } (line follows that token as it moves) or
// { x, y } (line ends at a fixed court point). `curveOffsetFt` is the
// perpendicular distance (from the straight start→end chord) of the point
// the visible curve/baseline passes through at its midpoint (0 = straight)
// — for dribble lines this bends the baseline the squiggle rides along.
function createLine(type, originTokenId, end) {
  return {
    id: crypto.randomUUID(),
    type,
    originTokenId,
    endTokenId: end.tokenId || null,
    endPoint: end.tokenId ? null : { x: end.x, y: end.y },
    curveOffsetFt: 0,
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

// Offsets the midpoint of start→end perpendicular to that axis by
// distFt. Shared by the on-curve handle point and the raw Bézier control
// point below, which are related but not equal — see resolveControlPoint.
function offsetPointFt(startFt, endFt, distFt) {
  const midFt = { x: (startFt.x + endFt.x) / 2, y: (startFt.y + endFt.y) / 2 };
  const dx = endFt.x - startFt.x;
  const dy = endFt.y - startFt.y;
  const length = Math.hypot(dx, dy);
  if (length === 0 || !distFt) return midFt;
  const px = -dy / length;
  const py = dx / length;
  return { x: midFt.x + px * distFt, y: midFt.y + py * distFt };
}

// curveOffsetFt is defined as the perpendicular distance (from the
// straight start→end chord) of the point the visible curve actually
// passes through at its midpoint (t=0.5) — i.e. what the user sees and
// drags. For a quadratic Bézier, B(0.5) = 0.5*chordMidpoint + 0.5*M, so
// hitting an on-curve offset of curveOffsetFt requires the *raw* control
// point M to be offset by curveOffsetFt*2. curveOffsetFt=0 still collapses
// this exactly onto the midpoint, so it renders/hit-tests identically to
// a straight line.
function resolveControlPoint(startFt, endFt, curveOffsetFt) {
  return offsetPointFt(startFt, endFt, (curveOffsetFt || 0) * 2);
}

// Given a pointer position, finds the curveOffsetFt (on-curve, not raw
// control-point offset — see resolveControlPoint) that would make the
// curve pass through the projection of that pointer. Used while dragging
// a line's curve handle.
function perpendicularOffset(startFt, endFt, pointFt) {
  const dx = endFt.x - startFt.x;
  const dy = endFt.y - startFt.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return 0;
  const px = -dy / length;
  const py = dx / length;
  return (pointFt.x - startFt.x) * px + (pointFt.y - startFt.y) * py;
}

function quadraticPoint(startFt, controlFt, endFt, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * startFt.x + 2 * mt * t * controlFt.x + t * t * endFt.x,
    y: mt * mt * startFt.y + 2 * mt * t * controlFt.y + t * t * endFt.y,
  };
}

// Samples a quadratic Bézier curve from start to end via controlFt. When
// controlFt is exactly the start→end midpoint this reduces mathematically
// to the straight line between them, so curveOffsetFt=0 renders/hit-tests
// identically to the old plain-line behavior.
function bezierSamplePoints(startFt, controlFt, endFt, steps = 20) {
  const points = [];
  for (let i = 0; i <= steps; i++) points.push(quadraticPoint(startFt, controlFt, endFt, i / steps));
  return points;
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

// Same idea as squigglePoints, but the wave rides along an arbitrary
// sampled baseline (e.g. a curved Bézier path) instead of a straight
// start→end axis — used to draw a dribble line that's also been bent via
// its curve handle. Waves/tapers by cumulative arc length along the
// baseline, and offsets each sample perpendicular to its local tangent
// (estimated from neighboring baseline points), so the wave stays aligned
// with the bend instead of just rippling across a straight axis.
function squiggleAlongBase(baseFt, amplitudeFt = 0.6, waveLengthFt = 3) {
  const cumFt = [0];
  for (let i = 1; i < baseFt.length; i++) {
    cumFt.push(cumFt[i - 1] + Math.hypot(baseFt[i].x - baseFt[i - 1].x, baseFt[i].y - baseFt[i - 1].y));
  }
  const totalLenFt = cumFt[cumFt.length - 1];
  if (totalLenFt === 0) return baseFt;
  return baseFt.map((point, i) => {
    const t = cumFt[i] / totalLenFt;
    // Taper to zero at both ends, same reasoning as squigglePoints, so the
    // wavy path still starts/ends exactly on the baseline's own endpoints.
    const taper = Math.sin(t * Math.PI);
    const offset = amplitudeFt * Math.sin((cumFt[i] / waveLengthFt) * Math.PI * 2) * taper;
    const prev = baseFt[Math.max(0, i - 1)];
    const next = baseFt[Math.min(baseFt.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const tangentLen = Math.hypot(dx, dy) || 1;
    const px = -dy / tangentLen;
    const py = dx / tangentLen;
    return { x: point.x + px * offset, y: point.y + py * offset };
  });
}

// Returns the geometric path (in feet, start→end) used to render/hit-test
// a line: a quadratic curve for cut/pass/screen (curveOffsetFt=0 renders as
// a straight line), or the dribble squiggle — which itself rides along a
// curved baseline once curveOffsetFt is non-zero (see squiggleAlongBase).
function linePathPoints(line, pts) {
  const curveOffsetFt = line.curveOffsetFt || 0;
  if (line.type === LINE_TYPES.DRIBBLE) {
    if (!curveOffsetFt) return squigglePoints(pts.start, pts.end);
    const controlFt = resolveControlPoint(pts.start, pts.end, curveOffsetFt);
    const chordLenFt = Math.hypot(pts.end.x - pts.start.x, pts.end.y - pts.start.y);
    const baseSteps = Math.max(24, Math.round(chordLenFt / (3 / 8)));
    return squiggleAlongBase(bezierSamplePoints(pts.start, controlFt, pts.end, baseSteps));
  }
  const controlFt = resolveControlPoint(pts.start, pts.end, curveOffsetFt);
  return bezierSamplePoints(pts.start, controlFt, pts.end);
}

// The curve handle's court-space position for a line. This is the point
// the visible curve/baseline actually passes through (see
// resolveControlPoint's doc comment), not the raw Bézier control point, so
// the handle sits exactly on the curve the user sees and drags
// intuitively — including for dribble lines, whose squiggle rides along
// this same bent baseline.
function lineControlPointFt(line, tokens) {
  const pts = resolveLineEndpoints(line, tokens);
  if (!pts) return null;
  return offsetPointFt(pts.start, pts.end, line.curveOffsetFt || 0);
}

// Shortens a sampled path by pullBackFt, measured back from its last point
// along the path itself (not a straight-line shortcut), so arrows/ticks
// stay attached to curved and wavy paths alike.
function trimPathEnd(pathFt, pullBackFt) {
  if (pathFt.length < 2 || pullBackFt <= 0) return pathFt;
  const trimmed = pathFt.slice();
  let remaining = pullBackFt;
  while (trimmed.length > 1 && remaining > 0) {
    const last = trimmed[trimmed.length - 1];
    const prev = trimmed[trimmed.length - 2];
    const segLen = Math.hypot(last.x - prev.x, last.y - prev.y);
    if (segLen <= remaining) {
      trimmed.pop();
      remaining -= segLen;
    } else {
      const ratio = (segLen - remaining) / segLen;
      trimmed[trimmed.length - 1] = { x: prev.x + (last.x - prev.x) * ratio, y: prev.y + (last.y - prev.y) * ratio };
      remaining = 0;
    }
  }
  return trimmed;
}

// Finds the topmost (last-drawn) line within hitRadiusFt of the given
// court-space point, sampling each line's actual curved/wavy path so
// clicks land correctly even where a bent line bulges away from its
// straight start→end axis.
function findLineAt(lines, tokens, xFt, yFt, hitRadiusFt = 1.2) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const pts = resolveLineEndpoints(line, tokens);
    if (!pts) continue;
    const pathFt = linePathPoints(line, pts);
    let minDist = Infinity;
    for (let s = 0; s < pathFt.length - 1; s++) {
      const d = distanceToSegment(xFt, yFt, pathFt[s].x, pathFt[s].y, pathFt[s + 1].x, pathFt[s + 1].y);
      if (d < minDist) minDist = d;
    }
    if (minDist <= hitRadiusFt) return line;
  }
  return null;
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
  const pathFt = trimPathEnd(linePathPoints(line, pts), pullBackFt);
  if (pathFt.length < 2) return;
  const pathPx = pathFt.map(p => map.toPx(p.x, p.y));

  const lineWidthPx = Math.max(2, map.scale * 0.12);
  const arrowSizePx = Math.max(6, map.scale * 0.9);
  // The screen tick is a standalone symbol (not just an arrowhead tip), so
  // it needs to read clearly against a player token — sized close to the
  // token's own diameter, and noticeably thicker than the line itself.
  const tickSizePx = Math.max(10, map.scale * 1.3);
  const tickLineWidthPx = Math.max(4, map.scale * 0.32);

  ctx.save();
  if (options.preview) ctx.globalAlpha = 0.55;
  ctx.strokeStyle = '#f6f7fb';
  ctx.fillStyle = '#f6f7fb';
  ctx.lineWidth = lineWidthPx;
  ctx.lineCap = 'round';
  ctx.setLineDash(line.type === LINE_TYPES.PASS ? [lineWidthPx * 1.8, lineWidthPx * 1.4] : []);

  ctx.beginPath();
  pathPx.forEach((px, i) => (i === 0 ? ctx.moveTo(px.x, px.y) : ctx.lineTo(px.x, px.y)));
  ctx.stroke();
  ctx.setLineDash([]);

  // Orient the arrowhead/tick along the path's actual final segment (not a
  // straight start→end direction), so it stays attached to and aligned
  // with curved or wavy lines alike.
  const tailFromPx = pathPx[pathPx.length - 2];
  const tailToPx = pathPx[pathPx.length - 1];
  if (line.type === LINE_TYPES.SCREEN) {
    ctx.lineWidth = tickLineWidthPx;
    drawScreenTick(ctx, tailFromPx, tailToPx, tickSizePx);
  } else {
    drawArrowhead(ctx, tailFromPx, tailToPx, arrowSizePx);
  }

  ctx.restore();
}

function drawLines(ctx, lines, tokens, map) {
  lines.forEach(line => drawLine(ctx, line, tokens, map));
}

// Draws the selected-line handles: a curve handle at the control point, and
// an endpoint handle at the line's current end — draggable in both
// directions: dragging a free end moves it, and dragging an attached end
// detaches it from its token (re-attaching if dropped on another token).
// Every line type (including dribble) shows a curve handle now — see
// linePathPoints/squiggleAlongBase.
function drawLineHandles(ctx, line, tokens, map) {
  const pts = resolveLineEndpoints(line, tokens);
  if (!pts) return;
  const handleRadiusPx = Math.max(5, map.scale * 0.7);

  ctx.save();
  ctx.fillStyle = '#0b1020';
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = Math.max(1.5, map.scale * 0.08);

  const controlFt = lineControlPointFt(line, tokens);
  if (controlFt) {
    const controlPx = map.toPx(controlFt.x, controlFt.y);
    ctx.beginPath();
    ctx.arc(controlPx.x, controlPx.y, handleRadiusPx, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  {
    const endPx = map.toPx(pts.end.x, pts.end.y);
    if (line.endTokenId) {
      // Attached: draw a ring around (not on top of) the token, sized
      // wider than it, with a dark halo underneath the accent stroke so
      // it stays visible regardless of the token's own fill color
      // (an accent-colored ring alone is invisible on offense tokens,
      // which are filled with that same accent color).
      const ringRadiusPx = TOKEN_RADIUS_FT * map.scale + Math.max(4, map.scale * 0.25);
      ctx.beginPath();
      ctx.arc(endPx.x, endPx.y, ringRadiusPx, 0, Math.PI * 2);
      ctx.strokeStyle = '#0b1020';
      ctx.lineWidth = Math.max(3, map.scale * 0.18);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(endPx.x, endPx.y, ringRadiusPx, 0, Math.PI * 2);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = Math.max(1.5, map.scale * 0.08);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(endPx.x, endPx.y, handleRadiusPx, 0, Math.PI * 2);
      ctx.fillStyle = '#0b1020';
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = Math.max(1.5, map.scale * 0.08);
      ctx.fill();
      ctx.stroke();
    }
  }

  ctx.restore();
}

