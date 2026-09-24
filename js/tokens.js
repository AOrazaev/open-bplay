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

// This is the ball-and-player rendering position — the actual token data
// stays untouched. Straight-line drag/reordering is fine here, but see the
// note in ballDrawPositionFt() below about why the offset must fade in
// smoothly rather than snap on/off at BALL_CARRY_THRESHOLD_FT.
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

// When a ball is near a player (e.g. right after applying a dribble/pass
// arrow, which moves both to the same point), returns a nudged { x, y }
// for *drawing only* — offset away from the hoop along the ray from
// HOOP_FT through the player, so the ball reads as held out toward
// half-court rather than centered on the player's number. Actual token
// data (and hit-testing) are untouched; only the drawn pixel moves.
//
// The nudge fades in smoothly as distance shrinks from
// BALL_CARRY_THRESHOLD_FT (no nudge at all — draws at the ball's own
// position) down to 0 (full nudge). This blend matters during frame
// playback: the ball and its carrier don't always travel at exactly the
// same interpolated speed, so the gap between them can drift back and
// forth across a hard on/off threshold several times per animation —
// which would otherwise make the ball visibly snap in and out of its
// nudged spot mid-play.
function ballDrawPositionFt(ballToken, playerTokens) {
  let carrier = null;
  let carrierDistFt = Infinity;
  playerTokens.forEach(t => {
    const d = Math.hypot(t.x - ballToken.x, t.y - ballToken.y);
    if (d < carrierDistFt) {
      carrierDistFt = d;
      carrier = t;
    }
  });
  if (!carrier || carrierDistFt >= BALL_CARRY_THRESHOLD_FT) return ballToken;

  let dx = carrier.x - HOOP_FT.x;
  let dy = carrier.y - HOOP_FT.y;
  const hoopDistFt = Math.hypot(dx, dy);
  if (hoopDistFt < 0.01) {
    // Degenerate case: carrier is essentially standing on the hoop.
    dx = 0;
    dy = -1;
  } else {
    dx /= hoopDistFt;
    dy /= hoopDistFt;
  }

  const blend = 1 - carrierDistFt / BALL_CARRY_THRESHOLD_FT; // 0 at the edge, 1 when coincident
  const nudgedX = carrier.x + dx * BALL_CARRY_OFFSET_FT;
  const nudgedY = carrier.y + dy * BALL_CARRY_OFFSET_FT;
  return {
    x: ballToken.x + (nudgedX - ballToken.x) * blend,
    y: ballToken.y + (nudgedY - ballToken.y) * blend,
  };
}

// Finds the ball (if any) currently "held by" playerToken — i.e. the ball
// is within BALL_CARRY_THRESHOLD_FT of it *and* playerToken is the
// nearest player token to that ball (same possession rule ballDrawPositionFt
// uses for the draw-time nudge). Used to drag a carried ball along
// live while its carrier is being dragged, so the ball doesn't get left
// behind mid-move the way it would if possession were only recomputed on
// drop.
function findCarriedBallId(tokens, playerId) {
  const player = tokens.find(t => t.id === playerId);
  if (!player || player.type === TOKEN_TYPES.BALL) return null;
  const players = tokens.filter(t => t.type !== TOKEN_TYPES.BALL);
  const balls = tokens.filter(t => t.type === TOKEN_TYPES.BALL);
  for (const ball of balls) {
    let carrier = null;
    let carrierDistFt = Infinity;
    players.forEach(t => {
      const d = Math.hypot(t.x - ball.x, t.y - ball.y);
      if (d < carrierDistFt) {
        carrierDistFt = d;
        carrier = t;
      }
    });
    if (carrier && carrier.id === playerId && carrierDistFt < BALL_CARRY_THRESHOLD_FT) return ball.id;
  }
  return null;
}

// Finds the token nearest to the given court-space point, within
// hitRadiusFt, or null if none qualify. Used for pointer hit-testing.
//
// Picks the *nearest* token rather than just the first one found within
// range — this matters once a ball is carried near a player (see
// findCarriedBallId), since both are then within hit radius of a click
// on the player, and the player being the exact click target should win.
// Exact ties (most commonly a fully coincident ball+player, or several
// stacked players) fall back to drawTokens' visual z-order (balls drawn
// last/on top of players, each group in its own array order), so clicking
// dead-center on a stack still grabs whichever one is visually on top.
function findTokenAt(tokens, xFt, yFt, hitRadiusFt = TOKEN_RADIUS_FT * 1.3) {
  const players = tokens.filter(t => t.type !== TOKEN_TYPES.BALL);
  const balls = tokens.filter(t => t.type === TOKEN_TYPES.BALL);
  const topmostFirst = [...balls].reverse().concat([...players].reverse());
  let best = null;
  let bestDistFt = Infinity;
  for (const t of topmostFirst) {
    const d = Math.hypot(t.x - xFt, t.y - yFt);
    if (d <= hitRadiusFt && d < bestDistFt) {
      best = t;
      bestDistFt = d;
    }
  }
  return best;
}

// A token is considered "on the court" only while its center is within the
// court rectangle. Dragging an existing token past this boundary (or
// dropping a tray-spawned token outside it) removes/cancels it instead of
// placing it.
function isWithinCourt(xFt, yFt) {
  return xFt >= 0 && xFt <= COURT_WIDTH_FT && yFt >= 0 && yFt <= COURT_LENGTH_FT;
}
