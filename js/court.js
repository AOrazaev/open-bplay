// Pure half-court geometry + drawing. No DOM lookups beyond the canvas
// context passed in, so this is easy to unit-test headlessly and to reuse
// later for image export (mirrors the `rotations` app's js/algorithm.js /
// js/export.js split).

// Real-world half-court dimensions in feet (NBA-ish half-court: baseline to
// half-court line). Used purely as a coordinate system — everything is
// scaled to fit the canvas at render time.
const COURT_WIDTH_FT = 50;
const COURT_LENGTH_FT = 47;
const THREE_POINT_ARC_RADIUS_FT = 23.75;
const THREE_POINT_CORNER_X_FT = 3;

// Geometry for the three-point line's straight corner segments and the arc
// joining them: the corner segment's top endpoint must sit exactly
// `THREE_POINT_ARC_RADIUS_FT` away from the hoop, or the straight line and
// the arc won't meet cleanly (this was previously computed relative to the
// baseline instead of the hoop, leaving a visible gap/overlap).
function threePointGeometry(hoopFt) {
  const cornerXFt = THREE_POINT_CORNER_X_FT;
  const halfWidthFt = COURT_WIDTH_FT / 2;
  const straightHeightFt = Math.sqrt(Math.max(0, THREE_POINT_ARC_RADIUS_FT ** 2 - (halfWidthFt - cornerXFt) ** 2));
  const cornerTopY = hoopFt.y - straightHeightFt;
  return {
    cornerXFt,
    leftCornerTopFt: { x: cornerXFt, y: cornerTopY },
    rightCornerTopFt: { x: COURT_WIDTH_FT - cornerXFt, y: cornerTopY },
  };
}


// Converts a court-space point (feet, origin at top-left of the drawn
// half-court, y increasing toward half-court) into canvas pixels for a
// canvas of the given size, preserving aspect ratio with a small margin.
function courtToCanvas(widthPx, heightPx) {
  const margin = Math.min(widthPx, heightPx) * 0.04;
  const scale = Math.min(
    (widthPx - margin * 2) / COURT_WIDTH_FT,
    (heightPx - margin * 2) / COURT_LENGTH_FT,
  );
  const offsetX = (widthPx - COURT_WIDTH_FT * scale) / 2;
  const offsetY = (heightPx - COURT_LENGTH_FT * scale) / 2;
  return {
    scale,
    toPx: (xFt, yFt) => ({ x: offsetX + xFt * scale, y: offsetY + yFt * scale }),
    toFt: (xPx, yPx) => ({ x: (xPx - offsetX) / scale, y: (yPx - offsetY) / scale }),
  };
}

// Draws a half-court (baseline at the bottom, half-court line at the top)
// onto the given 2D context, sized to widthPx x heightPx.
function drawCourt(ctx, widthPx, heightPx) {
  const theme = {
    fill: '#17233d',
    paint: '#1c2c4d',
    line: '#e8ecf5',
  };
  const map = courtToCanvas(widthPx, heightPx);
  const lineWidth = Math.max(1.5, map.scale * 0.08);

  ctx.clearRect(0, 0, widthPx, heightPx);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Court background (bounding rectangle).
  const topLeft = map.toPx(0, 0);
  const bottomRight = map.toPx(COURT_WIDTH_FT, COURT_LENGTH_FT);
  ctx.fillStyle = theme.fill;
  ctx.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);

  ctx.strokeStyle = theme.line;
  ctx.lineWidth = lineWidth;

  // Court boundary.
  ctx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);

  // Paint / key (16ft wide, 19ft from baseline to free-throw line).
  const paintWidthFt = 16;
  const paintHeightFt = 19;
  const paintLeftFt = (COURT_WIDTH_FT - paintWidthFt) / 2;
  const paintTop = map.toPx(paintLeftFt, COURT_LENGTH_FT - paintHeightFt);
  const paintBottom = map.toPx(paintLeftFt + paintWidthFt, COURT_LENGTH_FT);
  ctx.fillStyle = theme.paint;
  ctx.fillRect(paintTop.x, paintTop.y, paintBottom.x - paintTop.x, paintBottom.y - paintTop.y);
  ctx.strokeRect(paintTop.x, paintTop.y, paintBottom.x - paintTop.x, paintBottom.y - paintTop.y);

  // Free-throw circle, centered at the free-throw line, radius 6ft. Solid
  // arc facing the paint, dashed arc facing away (the standard court marking).
  const ftCenterFt = { x: COURT_WIDTH_FT / 2, y: COURT_LENGTH_FT - paintHeightFt };
  const ftCenterPx = map.toPx(ftCenterFt.x, ftCenterFt.y);
  const ftRadiusPx = 6 * map.scale;
  ctx.beginPath();
  ctx.arc(ftCenterPx.x, ftCenterPx.y, ftRadiusPx, Math.PI, 0);
  ctx.stroke();
  ctx.setLineDash([lineWidth * 1.5, lineWidth * 1.5]);
  ctx.beginPath();
  ctx.arc(ftCenterPx.x, ftCenterPx.y, ftRadiusPx, 0, Math.PI);
  ctx.stroke();
  ctx.setLineDash([]);

  // Restricted area arc under the basket, radius 4ft, hoop set 5.25ft off
  // the baseline.
  const hoopFt = { x: COURT_WIDTH_FT / 2, y: COURT_LENGTH_FT - 5.25 };
  const hoopPx = map.toPx(hoopFt.x, hoopFt.y);
  ctx.beginPath();
  ctx.arc(hoopPx.x, hoopPx.y, 4 * map.scale, Math.PI, 0);
  ctx.stroke();

  // Hoop + backboard.
  ctx.beginPath();
  ctx.arc(hoopPx.x, hoopPx.y, 0.75 * map.scale, 0, Math.PI * 2);
  ctx.stroke();
  const backboardPx = map.toPx(COURT_WIDTH_FT / 2, COURT_LENGTH_FT - 4);
  ctx.beginPath();
  ctx.moveTo(backboardPx.x - 3 * map.scale, backboardPx.y);
  ctx.lineTo(backboardPx.x + 3 * map.scale, backboardPx.y);
  ctx.stroke();

  // Three-point line: corner segments straight up from the baseline, joined
  // by an arc of radius 23.75ft centered on the hoop.
  const { cornerXFt, leftCornerTopFt, rightCornerTopFt } = threePointGeometry(hoopFt);
  const leftCornerTopPx = map.toPx(leftCornerTopFt.x, leftCornerTopFt.y);
  const rightCornerTopPx = map.toPx(rightCornerTopFt.x, rightCornerTopFt.y);
  const leftBaselinePx = map.toPx(cornerXFt, COURT_LENGTH_FT);
  const rightBaselinePx = map.toPx(COURT_WIDTH_FT - cornerXFt, COURT_LENGTH_FT);

  ctx.beginPath();
  ctx.moveTo(leftBaselinePx.x, leftBaselinePx.y);
  ctx.lineTo(leftCornerTopPx.x, leftCornerTopPx.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(rightBaselinePx.x, rightBaselinePx.y);
  ctx.lineTo(rightCornerTopPx.x, rightCornerTopPx.y);
  ctx.stroke();

  const angleToLeftCorner = Math.atan2(leftCornerTopFt.y - hoopFt.y, leftCornerTopFt.x - hoopFt.x);
  const angleToRightCorner = Math.atan2(rightCornerTopFt.y - hoopFt.y, rightCornerTopFt.x - hoopFt.x);
  ctx.beginPath();
  ctx.arc(hoopPx.x, hoopPx.y, THREE_POINT_ARC_RADIUS_FT * map.scale, angleToLeftCorner, angleToRightCorner);
  ctx.stroke();

  // Half-court line at the top edge.
  const halfLeft = map.toPx(0, 0);
  const halfRight = map.toPx(COURT_WIDTH_FT, 0);
  ctx.beginPath();
  ctx.moveTo(halfLeft.x, halfLeft.y);
  ctx.lineTo(halfRight.x, halfRight.y);
  ctx.stroke();
}

// Sizes the canvas's backing store for the current devicePixelRatio (so
// lines stay crisp on high-DPI displays) and (re)draws the court. Returns a
// `redraw()` function so callers (e.g. a resize listener) can repaint
// without recomputing the DPR setup.
function setupCourtCanvas(canvas) {
  const ctx = canvas.getContext('2d');

  function redraw() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const widthPx = Math.max(1, Math.round(rect.width * dpr));
    const heightPx = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== widthPx || canvas.height !== heightPx) {
      canvas.width = widthPx;
      canvas.height = heightPx;
    }
    drawCourt(ctx, canvas.width, canvas.height);
  }

  redraw();
  return redraw;
}
