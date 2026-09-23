// Top-level wiring / bootstrap: canvas setup, token/line state, tray-driven
// spawn-dragging, tool-driven line-drawing, and pointer-driven move/remove
// interactions. Loaded last.

const courtCanvas = document.querySelector('#courtCanvas');
const trayChips = [...document.querySelectorAll('.tray-chip')];
const clearCourtBtn = document.querySelector('#clearCourt');
const toolButtons = [...document.querySelectorAll('.tool-btn')];

let tokens = [];
let lines = [];
let dragState = null; // { id, pointerId } — dragging an existing court token
let spawnDrag = null; // { type, label, pointerId, preview: {x,y} | null } — dragging a new token in from the tray
let lineDrag = null; // { type, originTokenId, pointerId, current: {x,y} } — drawing a new line from a token
let activeTool = null; // one of LINE_TYPES, or null for plain move mode
let selectedLineId = null; // line currently showing its curve/endpoint handles
let curveDrag = null; // { lineId, pointerId } — dragging a selected line's curve handle
let endpointDrag = null; // { lineId, pointerId } — dragging a selected line's free-endpoint handle

const redraw = setupCourtCanvas(courtCanvas, (ctx, map) => {
  drawLines(ctx, lines, tokens, map);
  drawTokens(ctx, tokens, map);
  if (spawnDrag && spawnDrag.preview) {
    drawToken(ctx, { type: spawnDrag.type, label: spawnDrag.label, x: spawnDrag.preview.x, y: spawnDrag.preview.y }, map);
  }
  if (lineDrag) {
    const previewLine = { type: lineDrag.type, originTokenId: lineDrag.originTokenId, endTokenId: null, endPoint: lineDrag.current };
    drawLine(ctx, previewLine, tokens, map, { preview: true });
  }
  if (selectedLineId) {
    const selectedLine = lines.find(l => l.id === selectedLineId);
    if (selectedLine) drawLineHandles(ctx, selectedLine, tokens, map);
    else selectedLineId = null; // line was removed elsewhere (e.g. cascade delete)
  }
  updateTrayState();
});

// Removes a token and cascades to any lines attached to it as either
// endpoint, so a deleted token never leaves a dangling line reference.
function removeToken(id) {
  tokens = tokens.filter(t => t.id !== id);
  lines = lines.filter(l => l.originTokenId !== id && l.endTokenId !== id);
}

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
  lines = [];
  dragState = null;
  lineDrag = null;
  selectedLineId = null;
  curveDrag = null;
  endpointDrag = null;
  redraw();
});

// --- Tool palette: pick a line type to draw, or click the active tool
// again to return to plain move mode. ------------------------------------

function updateToolPalette() {
  toolButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tool === activeTool));
}

toolButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    activeTool = activeTool === btn.dataset.tool ? null : btn.dataset.tool;
    updateToolPalette();
  });
});
updateToolPalette();

// --- Court: drag an existing token to move it, or drag it past the court
// boundary to remove it (dropping outside deletes; dropping inside just
// relocates it, matching the tray-spawn drop semantics). When a line tool
// is active, dragging from a token draws a line instead of moving it.
// When no tool is active, clicking a line selects it (showing its curve
// and/or free-endpoint handles) so those can be dragged to reshape it;
// clicking empty space deselects. -----------------------------------------

courtCanvas.addEventListener('pointerdown', (e) => {
  const { x, y } = clientPointToFeet(courtCanvas, e.clientX, e.clientY);

  if (!activeTool && selectedLineId) {
    const selectedLine = lines.find(l => l.id === selectedLineId);
    if (selectedLine) {
      const controlFt = lineControlPointFt(selectedLine, tokens);
      if (controlFt && Math.hypot(x - controlFt.x, y - controlFt.y) <= LINE_HANDLE_HIT_RADIUS_FT) {
        curveDrag = { lineId: selectedLine.id, pointerId: e.pointerId };
        courtCanvas.setPointerCapture(e.pointerId);
        return;
      }
      if (!selectedLine.endTokenId) {
        const pts = resolveLineEndpoints(selectedLine, tokens);
        if (pts && Math.hypot(x - pts.end.x, y - pts.end.y) <= LINE_HANDLE_HIT_RADIUS_FT) {
          endpointDrag = { lineId: selectedLine.id, pointerId: e.pointerId };
          courtCanvas.setPointerCapture(e.pointerId);
          return;
        }
      }
    }
  }

  const hit = findTokenAt(tokens, x, y);
  if (hit) {
    if (activeTool) {
      lineDrag = { type: activeTool, originTokenId: hit.id, pointerId: e.pointerId, current: { x, y } };
      courtCanvas.setPointerCapture(e.pointerId);
      redraw();
      return;
    }
    selectedLineId = null; // picking up a token deselects any line
    dragState = { id: hit.id, pointerId: e.pointerId };
    courtCanvas.setPointerCapture(e.pointerId);
    return;
  }

  if (!activeTool) {
    const hitLine = findLineAt(lines, tokens, x, y);
    selectedLineId = hitLine ? hitLine.id : null;
    redraw();
  }
});

courtCanvas.addEventListener('pointermove', (e) => {
  if (curveDrag && curveDrag.pointerId === e.pointerId) {
    const line = lines.find(l => l.id === curveDrag.lineId);
    const pts = line && resolveLineEndpoints(line, tokens);
    if (pts) {
      const { x, y } = clientPointToFeet(courtCanvas, e.clientX, e.clientY);
      line.curveOffsetFt = perpendicularOffset(pts.start, pts.end, { x, y });
    }
    redraw();
    return;
  }
  if (endpointDrag && endpointDrag.pointerId === e.pointerId) {
    const line = lines.find(l => l.id === endpointDrag.lineId);
    if (line) line.endPoint = clientPointToFeet(courtCanvas, e.clientX, e.clientY);
    redraw();
    return;
  }
  if (lineDrag && lineDrag.pointerId === e.pointerId) {
    lineDrag.current = clientPointToFeet(courtCanvas, e.clientX, e.clientY);
    redraw();
    return;
  }
  if (!dragState || dragState.pointerId !== e.pointerId) return;
  const token = tokens.find(t => t.id === dragState.id);
  if (!token) return;
  const { x, y } = clientPointToFeet(courtCanvas, e.clientX, e.clientY);
  token.x = x;
  token.y = y;
  token.removing = !isWithinCourt(x, y);
  redraw();
});

// Minimum drag distance (feet) before a line is actually created, so a
// pointerdown/pointerup on the same spot doesn't leave a zero-length line.
const MIN_LINE_LENGTH_FT = 1;

function endDrag(e) {
  if (curveDrag && curveDrag.pointerId === e.pointerId) {
    if (courtCanvas.hasPointerCapture(e.pointerId)) courtCanvas.releasePointerCapture(e.pointerId);
    curveDrag = null;
    redraw();
    return;
  }
  if (endpointDrag && endpointDrag.pointerId === e.pointerId) {
    if (courtCanvas.hasPointerCapture(e.pointerId)) courtCanvas.releasePointerCapture(e.pointerId);
    endpointDrag = null;
    redraw();
    return;
  }
  if (lineDrag && lineDrag.pointerId === e.pointerId) {
    if (courtCanvas.hasPointerCapture(e.pointerId)) courtCanvas.releasePointerCapture(e.pointerId);
    const { type, originTokenId, current } = lineDrag;
    lineDrag = null;
    const origin = tokens.find(t => t.id === originTokenId);
    if (origin) {
      const targetToken = findTokenAt(tokens.filter(t => t.id !== originTokenId), current.x, current.y);
      const end = targetToken ? { x: targetToken.x, y: targetToken.y } : current;
      if (Math.hypot(end.x - origin.x, end.y - origin.y) >= MIN_LINE_LENGTH_FT) {
        lines.push(createLine(type, originTokenId, targetToken ? { tokenId: targetToken.id } : current));
        // Auto-deselect the tool after a successful draw so the user
        // doesn't accidentally start a second line on their next drag.
        activeTool = null;
        updateToolPalette();
      }
    }
    redraw();
    return;
  }

  if (!dragState || dragState.pointerId !== e.pointerId) return;
  if (courtCanvas.hasPointerCapture(e.pointerId)) courtCanvas.releasePointerCapture(e.pointerId);
  const token = tokens.find(t => t.id === dragState.id);
  dragState = null;
  if (token && token.removing) {
    removeToken(token.id);
  } else if (token) {
    token.removing = false;
  }
  redraw();
}

courtCanvas.addEventListener('pointerup', endDrag);
courtCanvas.addEventListener('pointercancel', endDrag);

courtCanvas.addEventListener('dblclick', (e) => {
  const { x, y } = clientPointToFeet(courtCanvas, e.clientX, e.clientY);
  const hitToken = findTokenAt(tokens, x, y);
  if (hitToken) {
    removeToken(hitToken.id);
    redraw();
    return;
  }
  const hitLine = findLineAt(lines, tokens, x, y);
  if (hitLine) {
    if (selectedLineId === hitLine.id) selectedLineId = null;
    lines = lines.filter(l => l.id !== hitLine.id);
    redraw();
  }
});

window.addEventListener('resize', redraw);
