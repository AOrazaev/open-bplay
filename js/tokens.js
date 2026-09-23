// Token model: offense/defense player markers and the ball. Pure data +
// drawing/hit-testing helpers, no DOM/event wiring (that lives in app.js) —
// mirrors the `rotations` app's split between algorithm/render code.

const TOKEN_TYPES = { OFFENSE: 'offense', DEFENSE: 'defense', BALL: 'ball' };
const TOKEN_RADIUS_FT = 1.3;
const MAX_OFFENSE_TOKENS = 5;
const MAX_DEFENSE_TOKENS = 5;

// Default formation spots (feet) for the first 5 offense tokens added, so
// tokens don't all stack on top of each other before the user drags them.
const DEFAULT_OFFENSE_SPOTS = [
  { x: 6, y: 44 },
  { x: 44, y: 44 },
  { x: 14, y: 34 },
  { x: 36, y: 34 },
  { x: 25, y: 24 },
];

function createToken(type, label, xFt, yFt) {
  return { id: crypto.randomUUID(), type, label: label || '', x: xFt, y: yFt };
}

// Picks a default spot for the next offense token based on how many offense
// tokens already exist (falls back to court center if the formation list is
// exhausted, e.g. if MAX_OFFENSE_TOKENS is raised later).
function nextOffenseSpot(existingOffenseCount) {
  return DEFAULT_OFFENSE_SPOTS[existingOffenseCount] || { x: COURT_WIDTH_FT / 2, y: COURT_LENGTH_FT / 2 };
}

// Defense tokens default a few feet toward the basket (larger y = closer to
// baseline) from the matching offense spot, so a fresh defense token doesn't
// land exactly on top of its offensive counterpart.
function nextDefenseSpot(existingDefenseCount) {
  const base = DEFAULT_OFFENSE_SPOTS[existingDefenseCount] || { x: COURT_WIDTH_FT / 2, y: COURT_LENGTH_FT / 2 };
  return { x: base.x, y: Math.min(COURT_LENGTH_FT - 2, base.y + 4) };
}

function drawToken(ctx, token, map) {
  const px = map.toPx(token.x, token.y);
  const r = TOKEN_RADIUS_FT * map.scale;

  if (token.type === TOKEN_TYPES.DEFENSE) {
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth = Math.max(2, r * 0.35);
    ctx.beginPath();
    ctx.moveTo(px.x - r * 0.7, px.y - r * 0.7);
    ctx.lineTo(px.x + r * 0.7, px.y + r * 0.7);
    ctx.moveTo(px.x + r * 0.7, px.y - r * 0.7);
    ctx.lineTo(px.x - r * 0.7, px.y + r * 0.7);
    ctx.stroke();
    return;
  }

  if (token.type === TOKEN_TYPES.BALL) {
    ctx.fillStyle = '#f5a623';
    ctx.beginPath();
    ctx.arc(px.x, px.y, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2b1400';
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.stroke();
    return;
  }

  // Offense token: filled circle with a jersey-style number.
  ctx.fillStyle = '#3b82f6';
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
}

function drawTokens(ctx, tokens, map) {
  tokens.forEach(token => drawToken(ctx, token, map));
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

// Keeps a token's center within the court bounds (with a small margin so it
// doesn't get dragged half off the edge).
function clampToCourt(xFt, yFt) {
  const margin = TOKEN_RADIUS_FT * 0.5;
  return {
    x: Math.min(COURT_WIDTH_FT - margin, Math.max(margin, xFt)),
    y: Math.min(COURT_LENGTH_FT - margin, Math.max(margin, yFt)),
  };
}
