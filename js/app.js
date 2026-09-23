// Top-level wiring / bootstrap: canvas setup, token state, tray-driven
// spawn-dragging, and pointer-driven move/remove interactions. Loaded last.

const courtCanvas = document.querySelector('#courtCanvas');
const trayChips = [...document.querySelectorAll('.tray-chip')];
const clearCourtBtn = document.querySelector('#clearCourt');

let tokens = [];
let dragState = null; // { id, pointerId } — dragging an existing court token
let spawnDrag = null; // { type, label, pointerId, preview: {x,y} | null } — dragging a new token in from the tray

const redraw = setupCourtCanvas(courtCanvas, (ctx, map) => {
  drawTokens(ctx, tokens, map);
  if (spawnDrag && spawnDrag.preview) {
    drawToken(ctx, { type: spawnDrag.type, label: spawnDrag.label, x: spawnDrag.preview.x, y: spawnDrag.preview.y }, map);
  }
  updateTrayState();
});

function countOf(type) {
  return tokens.filter(t => t.type === type).length;
}

function maxFor(type) {
  if (type === TOKEN_TYPES.OFFENSE) return MAX_OFFENSE_TOKENS;
  if (type === TOKEN_TYPES.DEFENSE) return MAX_DEFENSE_TOKENS;
  return 1; // ball
}

function updateTrayState() {
  trayChips.forEach(chip => {
    const type = chip.dataset.type;
    const atCap = countOf(type) >= maxFor(type);
    chip.classList.toggle('disabled', atCap);
    chip.setAttribute('aria-disabled', String(atCap));
    const countEl = chip.querySelector('.tray-chip-count');
    countEl.textContent = `${countOf(type)}/${maxFor(type)}`;
  });
}

// --- Tray: drag a template chip onto the court to spawn a new token -----

trayChips.forEach(chip => {
  const type = chip.dataset.type;

  chip.addEventListener('pointerdown', (e) => {
    if (countOf(type) >= maxFor(type)) return;
    const label = type === TOKEN_TYPES.OFFENSE ? String(countOf(type) + 1) : '';
    spawnDrag = { type, label, pointerId: e.pointerId, preview: null };
    chip.setPointerCapture(e.pointerId);
    redraw();
  });

  chip.addEventListener('pointermove', (e) => {
    if (!spawnDrag || spawnDrag.pointerId !== e.pointerId) return;
    const { x, y } = clientPointToFeet(courtCanvas, e.clientX, e.clientY);
    spawnDrag.preview = isWithinCourt(x, y) ? { x, y } : null;
    redraw();
  });

  function endSpawnDrag(e) {
    if (!spawnDrag || spawnDrag.pointerId !== e.pointerId) return;
    if (chip.hasPointerCapture(e.pointerId)) chip.releasePointerCapture(e.pointerId);
    const { type: dropType, label, preview } = spawnDrag;
    spawnDrag = null;
    if (preview && countOf(dropType) < maxFor(dropType)) {
      tokens.push(createToken(dropType, label, preview.x, preview.y));
    }
    redraw();
  }

  chip.addEventListener('pointerup', endSpawnDrag);
  chip.addEventListener('pointercancel', endSpawnDrag);
});

clearCourtBtn.addEventListener('click', () => {
  tokens = [];
  dragState = null;
  redraw();
});

// --- Court: drag an existing token to move it, or drag it past the court
// boundary to remove it (dropping outside deletes; dropping inside just
// relocates it, matching the tray-spawn drop semantics). -----------------

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
  token.x = x;
  token.y = y;
  token.removing = !isWithinCourt(x, y);
  redraw();
});

function endDrag(e) {
  if (!dragState || dragState.pointerId !== e.pointerId) return;
  if (courtCanvas.hasPointerCapture(e.pointerId)) courtCanvas.releasePointerCapture(e.pointerId);
  const token = tokens.find(t => t.id === dragState.id);
  dragState = null;
  if (token && token.removing) {
    tokens = tokens.filter(t => t.id !== token.id);
  } else if (token) {
    token.removing = false;
  }
  redraw();
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
