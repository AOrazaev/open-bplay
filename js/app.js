// Top-level wiring / bootstrap: canvas setup, token state, toolbar buttons,
// and pointer-driven drag/remove interactions. Loaded last.

const courtCanvas = document.querySelector('#courtCanvas');
const addOffenseBtn = document.querySelector('#addOffense');
const addDefenseBtn = document.querySelector('#addDefense');
const addBallBtn = document.querySelector('#addBall');
const clearCourtBtn = document.querySelector('#clearCourt');

let tokens = [];
let dragState = null; // { id, pointerId }

const redraw = setupCourtCanvas(courtCanvas, (ctx, map) => {
  drawTokens(ctx, tokens, map);
  updateToolbarState();
});

function updateToolbarState() {
  const offenseCount = tokens.filter(t => t.type === TOKEN_TYPES.OFFENSE).length;
  const defenseCount = tokens.filter(t => t.type === TOKEN_TYPES.DEFENSE).length;
  const ballCount = tokens.filter(t => t.type === TOKEN_TYPES.BALL).length;
  addOffenseBtn.disabled = offenseCount >= MAX_OFFENSE_TOKENS;
  addDefenseBtn.disabled = defenseCount >= MAX_DEFENSE_TOKENS;
  addBallBtn.disabled = ballCount >= 1;
}

addOffenseBtn.addEventListener('click', () => {
  const count = tokens.filter(t => t.type === TOKEN_TYPES.OFFENSE).length;
  if (count >= MAX_OFFENSE_TOKENS) return;
  const spot = nextOffenseSpot(count);
  tokens.push(createToken(TOKEN_TYPES.OFFENSE, String(count + 1), spot.x, spot.y));
  redraw();
});

addDefenseBtn.addEventListener('click', () => {
  const count = tokens.filter(t => t.type === TOKEN_TYPES.DEFENSE).length;
  if (count >= MAX_DEFENSE_TOKENS) return;
  const spot = nextDefenseSpot(count);
  tokens.push(createToken(TOKEN_TYPES.DEFENSE, '', spot.x, spot.y));
  redraw();
});

addBallBtn.addEventListener('click', () => {
  if (tokens.some(t => t.type === TOKEN_TYPES.BALL)) return;
  tokens.push(createToken(TOKEN_TYPES.BALL, '', COURT_WIDTH_FT / 2, COURT_LENGTH_FT - 20));
  redraw();
});

clearCourtBtn.addEventListener('click', () => {
  tokens = [];
  dragState = null;
  redraw();
});

courtCanvas.addEventListener('pointerdown', (e) => {
  const { x, y } = clientPointToFeet(courtCanvas, e.clientX, e.clientY);
  const hit = findTokenAt(tokens, x, y);
  if (!hit) return;
  dragState = { id: hit.id, pointerId: e.pointerId };
  courtCanvas.setPointerCapture(e.pointerId);
});

courtCanvas.addEventListener('pointermove', (e) => {
  if (!dragState || dragState.pointerId !== e.pointerId) return;
  const token = tokens.find(t => t.id === dragState.id);
  if (!token) return;
  const { x, y } = clientPointToFeet(courtCanvas, e.clientX, e.clientY);
  const clamped = clampToCourt(x, y);
  token.x = clamped.x;
  token.y = clamped.y;
  redraw();
});

function endDrag(e) {
  if (!dragState || dragState.pointerId !== e.pointerId) return;
  if (courtCanvas.hasPointerCapture(e.pointerId)) courtCanvas.releasePointerCapture(e.pointerId);
  dragState = null;
}

courtCanvas.addEventListener('pointerup', endDrag);
courtCanvas.addEventListener('pointercancel', endDrag);

courtCanvas.addEventListener('dblclick', (e) => {
  const { x, y } = clientPointToFeet(courtCanvas, e.clientX, e.clientY);
  const hit = findTokenAt(tokens, x, y);
  if (!hit) return;
  tokens = tokens.filter(t => t.id !== hit.id);
  redraw();
});

window.addEventListener('resize', redraw);
