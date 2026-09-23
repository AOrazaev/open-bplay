// Token model: offense/defense player markers and the ball. Pure data +
// drawing/hit-testing helpers, no DOM/event wiring (that lives in app.js) —
// mirrors the `rotations` app's split between algorithm/render code.

const TOKEN_TYPES = { OFFENSE: 'offense', DEFENSE: 'defense', BALL: 'ball' };
const TOKEN_RADIUS_FT = 1.3;
const MAX_OFFENSE_TOKENS = 5;
const MAX_DEFENSE_TOKENS = 5;
// How close a ball token's center must be to a player's before we treat it
// as "held by" that player for drawing purposes (e.g. right after a
// dribble/pass arrow is applied, which moves both to the same point).
const BALL_CARRY_THRESHOLD_FT = TOKEN_RADIUS_FT;
// How far, in feet, a carried ball is nudged away from the hoop — enough
// to read as offset from the player's number rather than dead-center on
// it, while still overlapping the player (per design: "intersects, but
// not on the dot center").
const BALL_CARRY_OFFSET_FT = TOKEN_RADIUS_FT * 0.85;

function createToken(type, label, xFt, yFt) {
  return { id: crypto.randomUUID(), type, label: label || '', x: xFt, y: yFt };
}

function drawToken(ctx, token, map) {
  const px = map.toPx(token.x, token.y);
  const r = TOKEN_RADIUS_FT * map.scale;

  ctx.save();
  // Dragging a token out past the court boundary marks it for removal on
  // release — fade it out and tint it red so that's obvious before the
  // user lets go.
  if (token.removing) {
    ctx.globalAlpha = 0.45;
  } else if (token.alpha != null) {
    // Set only during frame-sequence playback, to cross-fade a token that
    // only exists on one side of a frame transition (see
    // interpolateFrameTokens in js/frames.js).
    ctx.globalAlpha = token.alpha;
  }

  if (token.type === TOKEN_TYPES.DEFENSE) {
    ctx.strokeStyle = token.removing ? '#ff2d2d' : '#ff6b6b';
    ctx.lineWidth = Math.max(2, r * 0.35);
    ctx.beginPath();
    ctx.moveTo(px.x - r * 0.7, px.y - r * 0.7);
    ctx.lineTo(px.x + r * 0.7, px.y + r * 0.7);
    ctx.moveTo(px.x + r * 0.7, px.y - r * 0.7);
    ctx.lineTo(px.x - r * 0.7, px.y + r * 0.7);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (token.type === TOKEN_TYPES.BALL) {
    ctx.fillStyle = token.removing ? '#ff6b6b' : '#f5a623';
    ctx.beginPath();
    ctx.arc(px.x, px.y, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2b1400';
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Offense token: filled circle with a jersey-style number.
  ctx.fillStyle = token.removing ? '#ff6b6b' : '#3b82f6';
  ctx.beginPath();
  ctx.arc(px.x, px.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#0b1020';
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${Math.round(r * 1.1)}px Inter, ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(token.label, px.x, px.y + r * 0.05);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

function drawTokens(ctx, tokens, map) {
  // Draw the ball last so it always renders on top of player tokens,
  // regardless of spawn/array order (e.g. when a player and the ball
  // overlap at a frame's start/end position).
  const players = tokens.filter(t => t.type !== TOKEN_TYPES.BALL);
  const balls = tokens.filter(t => t.type === TOKEN_TYPES.BALL);
  players.forEach(token => drawToken(ctx, token, map));
  balls.forEach(token => {
    const pos = ballDrawPositionFt(token, players);
    drawToken(ctx, pos === token ? token : { ...token, x: pos.x, y: pos.y }, map);
  });
}

// When a ball sits on/near a player (e.g. right after applying a
// dribble/pass arrow, which moves both to the same point), returns a
// nudged { x, y } for *drawing only* — offset away from the hoop along the
// ray from HOOP_FT through the player, so the ball reads as held out
// toward half-court rather than centered on the player's number. Actual
// token data (and hit-testing) are untouched; only the drawn pixel moves.
// Returns the original token unchanged when no player is close enough.
function ballDrawPositionFt(ballToken, playerTokens) {
  const carrier = playerTokens.find(
    t => Math.hypot(t.x - ballToken.x, t.y - ballToken.y) <= BALL_CARRY_THRESHOLD_FT
  );
  if (!carrier) return ballToken;

  let dx = carrier.x - HOOP_FT.x;
  let dy = carrier.y - HOOP_FT.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.01) {
    // Degenerate case: carrier is essentially standing on the hoop.
    dx = 0;
    dy = -1;
  } else {
    dx /= dist;
    dy /= dist;
  }
  return { x: carrier.x + dx * BALL_CARRY_OFFSET_FT, y: carrier.y + dy * BALL_CARRY_OFFSET_FT };
}

// Finds the topmost (last-drawn) token within hitRadiusFt of the given
// court-space point, or null if none qualify. Used for pointer hit-testing.
function findTokenAt(tokens, xFt, yFt, hitRadiusFt = TOKEN_RADIUS_FT * 1.3) {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (Math.hypot(t.x - xFt, t.y - yFt) <= hitRadiusFt) return t;
  }
  return null;
}

// A token is considered "on the court" only while its center is within the
// court rectangle. Dragging an existing token past this boundary (or
// dropping a tray-spawned token outside it) removes/cancels it instead of
// placing it.
function isWithinCourt(xFt, yFt) {
  return xFt >= 0 && xFt <= COURT_WIDTH_FT && yFt >= 0 && yFt <= COURT_LENGTH_FT;
}
