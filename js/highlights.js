// Highlight model: freehand translucent strokes used to draw attention to
// an area of the court (spacing, a gap to attack, help-side space, etc.),
// independent of any token — unlike movement lines, a highlight isn't
// attached to a player and doesn't move/animate between frames. Pure data
// + drawing/hit-testing helpers, no DOM/event wiring (that lives in
// app.js) — mirrors the split used for lines.js/tokens.js. Depends on
// distanceToSegment, defined in lines.js (loaded before this file).

// Minimum spacing (feet) between consecutive recorded points while
// dragging a stroke — keeps the point array reasonably small without
// visibly faceting the freehand path.
const HIGHLIGHT_MIN_POINT_SPACING_FT = 0.4;
// How close (in feet) a pointer must land to a stroke's path to hit it
// for deletion — wider than a line's, since the stroke itself is drawn
// much thicker.
const HIGHLIGHT_HIT_RADIUS_FT = 1.8;

const HIGHLIGHT_WIDTH_FT = 2.6;
const HIGHLIGHT_COLOR = 'rgba(255, 209, 0, 0.35)';

function createHighlightStroke(points) {
  return { id: crypto.randomUUID(), points };
}

// Draws a single highlight stroke as one continuous rounded-cap/join path,
// so its own self-overlaps don't double up the translucent color —
// separate overlapping strokes still stack, the same way a real
// highlighter marker does. `options.preview` renders it fainter, used
// while the user is still dragging one out.
function drawHighlightStroke(ctx, stroke, map, options = {}) {
  if (!stroke.points || stroke.points.length < 2) return;
  const pathPx = stroke.points.map(p => map.toPx(p.x, p.y));

  ctx.save();
  ctx.globalAlpha = options.preview ? 0.6 : 1;
  ctx.strokeStyle = HIGHLIGHT_COLOR;
  ctx.lineWidth = Math.max(6, map.scale * HIGHLIGHT_WIDTH_FT);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pathPx.forEach((px, i) => (i === 0 ? ctx.moveTo(px.x, px.y) : ctx.lineTo(px.x, px.y)));
  ctx.stroke();
  ctx.restore();
}

function drawHighlights(ctx, highlights, map) {
  highlights.forEach(stroke => drawHighlightStroke(ctx, stroke, map));
}

// Finds the topmost (last-drawn) highlight stroke within hitRadiusFt of
// the given court-space point, sampling each of its segments — used for
// double-click delete, mirroring findLineAt's approach for lines.
function findHighlightAt(highlights, xFt, yFt, hitRadiusFt = HIGHLIGHT_HIT_RADIUS_FT) {
  for (let i = highlights.length - 1; i >= 0; i--) {
    const stroke = highlights[i];
    let minDist = Infinity;
    for (let s = 0; s < stroke.points.length - 1; s++) {
      const p1 = stroke.points[s];
      const p2 = stroke.points[s + 1];
      const d = distanceToSegment(xFt, yFt, p1.x, p1.y, p2.x, p2.y);
      if (d < minDist) minDist = d;
    }
    if (minDist <= hitRadiusFt) return stroke;
  }
  return null;
}
