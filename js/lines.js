// Movement-line model: cut/pass/screen/dribble annotations drawn from an
// origin token to either another token or a free court point. Pure data +
// drawing/hit-testing helpers, no DOM/event wiring (that lives in app.js) —
// mirrors the split used for tokens.js.

const LINE_TYPES = { CUT: 'cut', PASS: 'pass', SCREEN: 'screen', DRIBBLE: 'dribble' };
// How close (in feet) a pointer must land to a line's curve/endpoint handle
// to grab it, once the line is selected.
const LINE_HANDLE_HIT_RADIUS_FT = 1.4;

// `end` is either { tokenId } (line follows that token as it moves) or
// { x, y } (line ends at a fixed court point). `curveHandle` is a 2D offset
// { alongFt, perpFt } of the curve's handle point from the straight
// start→end chord's own midpoint, measured along the chord's own axes
// (alongFt: toward end when positive; perpFt: perpendicular) — both 0
// means straight. Letting the handle move along the chord (not just
// perpendicular) is what allows a "mostly straight, bends near one end"
// shape instead of only a symmetric arch.
function createLine(type, originTokenId, end) {
  return {
    id: crypto.randomUUID(),
    type,
    originTokenId,
    endTokenId: end.tokenId || null,
    endPoint: end.tokenId ? null : { x: end.x, y: end.y },
    curveHandle: { alongFt: 0, perpFt: 0 },
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

// The start→end chord's own local coordinate frame: a unit vector along it
// (ux,uy), a unit vector perpendicular to it (px,py), its midpoint, and
// half its length. Everything about a line's curve handle is expressed
// relative to this frame, so it stays sensible as the chord itself moves
// (e.g. when an attached token is dragged).
function chordBasis(startFt, endFt) {
  const dx = endFt.x - startFt.x;
  const dy = endFt.y - startFt.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  return {
    ux: dx / length,
    uy: dy / length,
    px: -dy / length,
    py: dx / length,
    midFt: { x: (startFt.x + endFt.x) / 2, y: (startFt.y + endFt.y) / 2 },
    halfLenFt: length / 2,
  };
}

const DEFAULT_CURVE_HANDLE = { alongFt: 0, perpFt: 0 };

// The curve handle's actual court-space position: the chord's midpoint,
// shifted alongFt along the chord and perpFt across it. Because this is
// exactly where the interpolating Catmull-Rom curve (see
// catmullRomSamplePoints) is built to pass through, the handle always sits
// precisely on the visible curve — no separate "raw control point" needed.
function resolveHandlePointFt(startFt, endFt, curveHandle) {
  const basis = chordBasis(startFt, endFt);
  if (!basis) return { x: (startFt.x + endFt.x) / 2, y: (startFt.y + endFt.y) / 2 };
  const { midFt, ux, uy, px, py } = basis;
  const { alongFt, perpFt } = curveHandle || DEFAULT_CURVE_HANDLE;
  return { x: midFt.x + ux * alongFt + px * perpFt, y: midFt.y + uy * alongFt + py * perpFt };
}

// Inverse of resolveHandlePointFt: given a pointer position, finds the
// { alongFt, perpFt } that would place the curve handle there. Used while
// dragging a line's curve handle. Clamps alongFt so the handle can't reach
// all the way to (or past) start/end, which would degenerate the curve.
function offsetFromChord(startFt, endFt, pointFt) {
  const basis = chordBasis(startFt, endFt);
  if (!basis) return { alongFt: 0, perpFt: 0 };
  const { midFt, ux, uy, px, py, halfLenFt } = basis;
  const relX = pointFt.x - midFt.x;
  const relY = pointFt.y - midFt.y;
  const maxAlongFt = halfLenFt * 0.9;
  const alongFt = Math.max(-maxAlongFt, Math.min(maxAlongFt, relX * ux + relY * uy));
  const perpFt = relX * px + relY * py;
  return { alongFt, perpFt };
}

function reflectAcross(pivotFt, pointFt) {
  return { x: 2 * pivotFt.x - pointFt.x, y: 2 * pivotFt.y - pointFt.y };
}

function lerpPt(a, b, frac) {
  return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
}

// Catmull-Rom position at parameter t (0..1) between p1 and p2, using p0
// and p3 as the neighboring points that shape the tangents. p(0) = p1 and
// p(1) = p2 exactly.
//
// Uses *centripetal* parametrization (knot spacing scaled by
// distance^0.5) rather than the simpler uniform formula. Our curve
// handle can sit very close to one endpoint (large alongFt), making the
// two chord segments wildly unequal in length — uniform Catmull-Rom
// loops/cusps badly in exactly that case (visible as a "hook" near the
// short segment, with a wildly wrong tangent for the arrowhead).
// Centripetal parametrization is the standard fix: it stays loop-free
// for any point spacing. See https://en.wikipedia.org/wiki/Centripetal_Catmull%E2%80%93Rom_spline
function catmullRomPoint(p0, p1, p2, p3, t) {
  const alpha = 0.5;
  const d01 = Math.max(Math.hypot(p1.x - p0.x, p1.y - p0.y), 1e-6);
  const d12 = Math.max(Math.hypot(p2.x - p1.x, p2.y - p1.y), 1e-6);
  const d23 = Math.max(Math.hypot(p3.x - p2.x, p3.y - p2.y), 1e-6);
  const t0 = 0;
  const t1 = t0 + d01 ** alpha;
  const t2 = t1 + d12 ** alpha;
  const t3 = t2 + d23 ** alpha;
  const tt = t1 + t * (t2 - t1);

  const a1 = lerpPt(p0, p1, (tt - t0) / (t1 - t0));
  const a2 = lerpPt(p1, p2, (tt - t1) / (t2 - t1));
  const a3 = lerpPt(p2, p3, (tt - t2) / (t3 - t2));
  const b1 = lerpPt(a1, a2, (tt - t0) / (t2 - t0));
  const b2 = lerpPt(a2, a3, (tt - t1) / (t3 - t1));
  return lerpPt(b1, b2, (tt - t1) / (t2 - t1));
}

// Samples a Catmull-Rom spline that interpolates exactly through
// startFt -> handleFt -> endFt (two segments), synthesizing tangent-shaping
// "phantom" points before startFt and after endFt by reflecting handleFt
// across each. When handleFt is exactly the chord's midpoint, all five
// points (phantom, start, handle, end, phantom) are collinear and evenly
// spaced, which makes Catmull-Rom reduce to the straight line between
// start and end — so a curveHandle of {0,0} still renders/hit-tests
// identically to a plain straight line.
function catmullRomSamplePoints(startFt, handleFt, endFt, stepsPerSegment = 20) {
  const beforeFt = reflectAcross(startFt, handleFt);
  const afterFt = reflectAcross(endFt, handleFt);
  const points = [];
  for (let i = 0; i <= stepsPerSegment; i++) {
    points.push(catmullRomPoint(beforeFt, startFt, handleFt, endFt, i / stepsPerSegment));
  }
  for (let i = 1; i <= stepsPerSegment; i++) {
    points.push(catmullRomPoint(startFt, handleFt, endFt, afterFt, i / stepsPerSegment));
  }
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

// Same idea as squigglePoints below, but the wave rides along an arbitrary
// sampled baseline (e.g. a curved Catmull-Rom path) instead of a straight
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

// Kept as a standalone helper (used directly by a regression test and
// available for any straight-baseline squiggle needs) — equivalent to
// squiggleAlongBase() over a plain two-point straight path.
function squigglePoints(startFt, endFt, amplitudeFt = 0.6, waveLengthFt = 3) {
  const length = Math.hypot(endFt.x - startFt.x, endFt.y - startFt.y);
  if (length === 0) return [startFt, endFt];
  const steps = Math.max(8, Math.round(length / (waveLengthFt / 8)));
  const baseFt = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    baseFt.push({ x: startFt.x + (endFt.x - startFt.x) * t, y: startFt.y + (endFt.y - startFt.y) * t });
  }
  return squiggleAlongBase(baseFt, amplitudeFt, waveLengthFt);
}

// Returns the geometric path (in feet, start→end) used to render/hit-test
// a line: a Catmull-Rom curve through start/handle/end for cut/pass/screen
// (curveHandle={0,0} renders as a straight line), or the dribble squiggle
// riding along that same curved baseline.
function linePathPoints(line, pts) {
  const curveHandle = line.curveHandle || DEFAULT_CURVE_HANDLE;
  const handleFt = resolveHandlePointFt(pts.start, pts.end, curveHandle);
  if (line.type === LINE_TYPES.DRIBBLE) {
    const chordLenFt = Math.hypot(pts.end.x - pts.start.x, pts.end.y - pts.start.y);
    const stepsPerSegment = Math.max(16, Math.round(chordLenFt / (3 / 8) / 2));
    return squiggleAlongBase(catmullRomSamplePoints(pts.start, handleFt, pts.end, stepsPerSegment));
  }
  return catmullRomSamplePoints(pts.start, handleFt, pts.end);
}

// The curve handle's court-space position for a line — see
// resolveHandlePointFt. Used both to render the handle and to hit-test
// grabbing it.
function lineControlPointFt(line, tokens) {
  const pts = resolveLineEndpoints(line, tokens);
  if (!pts) return null;
  return resolveHandlePointFt(pts.start, pts.end, line.curveHandle || DEFAULT_CURVE_HANDLE);
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

