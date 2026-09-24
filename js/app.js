// Top-level wiring / bootstrap: canvas setup, token/line state, tray-driven
// spawn-dragging, tool-driven line-drawing, and pointer-driven move/remove
// interactions. Loaded after plays.js/sidebar.js, before frames-ui.js and
// export.js (which both depend on globals declared here).

const courtCanvas = document.querySelector('#courtCanvas');
const trayChips = [...document.querySelectorAll('.tray-chip')];
const clearCourtBtn = document.querySelector('#clearCourt');
const toolButtons = [...document.querySelectorAll('.tool-btn')];
const playNameInput = document.querySelector('#playNameInput');
const savePlayBtn = document.querySelector('#savePlayBtn');
const newFolderBtn = document.querySelector('#newFolderBtn');
const playsLocationEl = document.querySelector('#playsLocation');
const playsTreeEl = document.querySelector('#playsTree');

let frames = createInitialFrames();
let currentFrameIndex = 0;

// Restore whatever was on the court at the end of the last session (if
// anything), independent of the saved-plays library — a lightweight
// autosave rather than a named play, so simply leaving the tab and
// coming back doesn't lose in-progress work.
const courtAutosave = loadCourtAutosave();
if (courtAutosave) {
  frames = courtAutosave.frames;
  currentFrameIndex = courtAutosave.currentFrameIndex;
}

let tokens = frames[currentFrameIndex].tokens;
let lines = frames[currentFrameIndex].lines;
let highlights = frames[currentFrameIndex].highlights;

// Writes the live tokens/lines/highlights back into the frames array at
// the current index — needed before persisting or switching frames,
// since these are frequently *reassigned* (e.g. `tokens = tokens.filter(...)`)
// rather than mutated in place, which would otherwise leave the frames
// array holding a stale reference.
function syncCurrentFrame() {
  frames[currentFrameIndex] = { tokens, lines, highlights };
}

// Persists the current frame sequence as the court autosave. Called after
// every action that settles into a new stable state (a drag/create/
// delete finishing, a play loading, Clear, a frame switch) rather than on
// every intermediate redraw, so an in-progress drag isn't writing to
// localStorage on every pointermove.
function persistCourtState() {
  syncCurrentFrame();
  persistCourtAutosave(frames, currentFrameIndex);
}

let dragState = null; // { id, pointerId } — dragging an existing court token
let spawnDrag = null; // { type, label, pointerId, preview: {x,y} | null } — dragging a new token in from the tray
let lineDrag = null; // { type, originTokenId, pointerId, current: {x,y} } — drawing a new line from a token
let highlightDrag = null; // { pointerId, points: [{x,y}] } — drawing a new freehand highlight stroke
let activeTool = null; // one of LINE_TYPES, 'highlight', or null for plain move mode
let selectedLineId = null; // line currently showing its curve/endpoint handles
let curveDrag = null; // { lineId, pointerId } — dragging a selected line's curve handle
let endpointDrag = null; // { lineId, pointerId } — dragging a selected line's free-endpoint handle
let playbackTokens = null; // non-null only while frame-sequence playback (js/frames-ui.js) is animating
let playbackHighlights = null; // the source frame's highlights for the segment currently animating

const redraw = setupCourtCanvas(courtCanvas, (ctx, map) => {
  if (playbackTokens) {
    // During playback we show the departing frame's highlights alongside
    // the interpolated token positions, but no lines, selection handles,
    // or in-progress drag previews — a clean animated preview of how the
    // play's frames flow together.
    drawHighlights(ctx, playbackHighlights || [], map);
    drawTokens(ctx, playbackTokens, map);
    return;
  }
  drawHighlights(ctx, highlights, map);
  drawLines(ctx, lines, tokens, map);
  drawTokens(ctx, tokens, map);
  if (spawnDrag && spawnDrag.preview) {
    drawToken(ctx, { type: spawnDrag.type, label: spawnDrag.label, x: spawnDrag.preview.x, y: spawnDrag.preview.y }, map);
  }
  if (lineDrag) {
    const previewLine = { type: lineDrag.type, originTokenId: lineDrag.originTokenId, endTokenId: null, endPoint: lineDrag.current };
    drawLine(ctx, previewLine, tokens, map, { preview: true });
  }
  if (highlightDrag && highlightDrag.points.length >= 2) {
    drawHighlightStroke(ctx, { points: highlightDrag.points }, map, { preview: true });
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
  persistCourtState();
  recordHistory();
  updateFrameBar(); // refresh this frame's thumbnail, and Apply Arrows' enabled state if a cascaded line was its last one
}

function countOf(type) {
  return tokens.filter(t => t.type === type).length;
}

function maxFor(type) {
  if (type === TOKEN_TYPES.OFFENSE) return MAX_OFFENSE_TOKENS;
  if (type === TOKEN_TYPES.DEFENSE) return MAX_DEFENSE_TOKENS;
  return 1; // ball
}

// Smallest jersey number (as a string) not currently in use among offense
// tokens — using count+1 instead would collide once a middle-numbered
// token (e.g. #3 of 5) was removed and a new one spawned, since the
// remaining count no longer matches the highest label in use.
function nextOffenseLabel() {
  const used = new Set(tokens.filter(t => t.type === TOKEN_TYPES.OFFENSE).map(t => t.label));
  for (let i = 1; i <= MAX_OFFENSE_TOKENS; i++) {
    if (!used.has(String(i))) return String(i);
  }
  return String(MAX_OFFENSE_TOKENS + 1); // unreachable while spawning is capped at MAX_OFFENSE_TOKENS
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
    const label = type === TOKEN_TYPES.OFFENSE ? nextOffenseLabel() : '';
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
      persistCourtState();
      recordHistory();
      updateFrameBar(); // refresh this frame's thumbnail with the newly spawned token
    }
    redraw();
  }

  chip.addEventListener('pointerup', endSpawnDrag);
  chip.addEventListener('pointercancel', endSpawnDrag);
});

// Cancels any in-progress drag/selection state — used both by Clear (which
// also wipes tokens/lines) and by Load (which replaces them wholesale), so
// neither leaves a stale drag/handle referencing tokens or lines that no
// longer exist.
function resetInteractionState() {
  dragState = null;
  spawnDrag = null;
  lineDrag = null;
  highlightDrag = null;
  selectedLineId = null;
  curveDrag = null;
  endpointDrag = null;
}

clearCourtBtn.addEventListener('click', () => {
  frames = createInitialFrames();
  currentFrameIndex = 0;
  tokens = frames[0].tokens;
  lines = frames[0].lines;
  highlights = frames[0].highlights;
  resetInteractionState();
  persistCourtState();
  recordHistory();
  updateFrameBar();
  redraw();
});

// --- Plays: save/load/delete named plays, organized into folders -------
// (Checkpoint 4, extended with a nestable folder hierarchy)

let library = loadLibrary();

// Restore the sidebar's view state (selected save-location folder, which
// folders are expanded) from its last session, dropping any ids that no
// longer correspond to a folder in the library (e.g. it was deleted, or
// this is a fresh/cleared localStorage) so a stale reference can't leave
// the tree stuck looking for a folder that isn't there anymore.
const savedViewState = loadViewState();
const isValidFolderId = (id) => id != null && library.some(e => e.type === 'folder' && e.id === id);
// The folder new saves/subfolders land in — null means the library root.
// Selected by clicking a folder's name in the tree.
let currentFolderId = isValidFolderId(savedViewState.currentFolderId) ? savedViewState.currentFolderId : null;
// Which folders are expanded in the tree — persisted so a reload doesn't
// re-collapse everything the user had opened.
const expandedFolderIds = new Set(savedViewState.expandedFolderIds.filter(isValidFolderId));

function updatePlaysLocationLabel() {
  playsLocationEl.textContent = `Saving to: ${folderPath(library, currentFolderId).join(' / ')}`;
  // Already at the root — nothing to navigate to, so don't dangle a
  // clickable-looking no-op.
  playsLocationEl.disabled = currentFolderId === null;
}

// The only way to select a folder as the save/create location was
// clicking its name in the tree — with no way back to the root, the
// first folder you selected became "stuck" as the destination for every
// subsequent "+ Folder"/save. This label doubles as a root breadcrumb.
playsLocationEl.addEventListener('click', () => {
  if (currentFolderId === null) return;
  currentFolderId = null;
  renderPlaysTree();
});

// Creates a small text button used for the tree's inline icon actions
// (expand/collapse, add-subfolder, delete) — kept as one helper so every
// row builds them identically.
function createTreeButton(className, label, ariaLabel, onClick) {
  const btn = document.createElement('button');
  btn.className = className;
  btn.textContent = label;
  btn.setAttribute('aria-label', ariaLabel);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

// Swaps a folder/play row's name element for a text input pre-filled
// with its current name, so the user can rename it in place (or, for a
// freshly created folder, give it its first real name) without a
// window.prompt() dialog. Committing (Enter/blur) with a non-empty,
// trimmed name renames it; Escape or an empty name cancels/reverts.
function startRename(entry, nameEl) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = entry.name;
  input.maxLength = 60;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let settled = false;
  function commit() {
    if (settled) return;
    settled = true;
    const newName = input.value.trim();
    if (newName) {
      library = renameEntry(library, entry.id, newName);
      persistLibrary(library);
    }
    renderPlaysTree();
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { settled = true; renderPlaysTree(); }
  });
  input.addEventListener('blur', commit);
}

function renderPlaysTreeChildren(container, parentId, depth) {
  const children = childrenOf(library, parentId);
  if (children.length === 0 && depth === 0) {
    const empty = document.createElement('li');
    empty.className = 'plays-tree-empty';
    empty.textContent = 'No saved plays yet.';
    container.appendChild(empty);
    return;
  }

  children.forEach(entry => {
    const li = document.createElement('li');
    li.dataset.id = entry.id;
    li.dataset.type = entry.type;
    const row = document.createElement('div');
    row.className = 'plays-tree-row';
    if (entry.type === 'folder' && entry.id === currentFolderId) row.classList.add('current');

    if (entry.type === 'folder') {
      const expanded = expandedFolderIds.has(entry.id);
      const toggleBtn = createTreeButton('toggle-btn', expanded ? '▾' : '▸', `${expanded ? 'Collapse' : 'Expand'} ${entry.name}`, () => {
        if (expanded) expandedFolderIds.delete(entry.id); else expandedFolderIds.add(entry.id);
        renderPlaysTree();
      });

      const nameEl = document.createElement('button');
      nameEl.className = 'folder-name';
      nameEl.textContent = entry.name;
      nameEl.title = 'Select as save location';
      // Double-click is detected via the click event's own `detail` count
      // (2 on the second click) rather than a separate `dblclick`
      // listener: the first click's handler re-renders the tree (to show
      // the new "current" selection), which detaches this exact button
      // from the document. A `dblclick` fired afterwards would then be
      // racing against — and targeting — an already-removed node, so the
      // rename input silently never appears. Branching on `detail` lets
      // us catch the second click *before* triggering that re-render.
      nameEl.addEventListener('click', (e) => {
        if (e.detail >= 2) {
          startRename(entry, nameEl);
          return;
        }
        currentFolderId = entry.id;
        expandedFolderIds.add(entry.id);
        renderPlaysTree();
      });

      const addSubfolderBtn = createTreeButton('add-subfolder-btn', '+', `New folder inside ${entry.name}`, () => {
        currentFolderId = entry.id;
        expandedFolderIds.add(entry.id);
        createFolderAndRename(entry.id);
      });
      const deleteBtn = createTreeButton('delete-btn', '×', `Delete ${entry.name}`, () => deleteEntryAndReconcile(entry));

      row.append(toggleBtn, nameEl, addSubfolderBtn, deleteBtn);
      li.appendChild(row);

      if (expanded) {
        const childList = document.createElement('ul');
        childList.className = 'plays-tree-children';
        renderPlaysTreeChildren(childList, entry.id, depth + 1);
        li.appendChild(childList);
      }
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'toggle-btn';
      const nameEl = document.createElement('button');
      nameEl.className = 'play-name';
      nameEl.textContent = entry.name;
      nameEl.title = 'Load this play';
      // See the folder-name click handler above for why double-click is
      // detected via `e.detail` here rather than a separate `dblclick`
      // listener — loading a play also re-renders the tree, which would
      // otherwise detach this button before a real `dblclick` could fire.
      nameEl.addEventListener('click', (e) => {
        if (e.detail >= 2) {
          startRename(entry, nameEl);
          return;
        }
        loadPlayEntry(entry);
      });
      const deleteBtn = createTreeButton('delete-btn', '×', `Delete ${entry.name}`, () => deleteEntryAndReconcile(entry));

      row.append(spacer, nameEl, deleteBtn);
      li.appendChild(row);
    }

    container.appendChild(li);
  });
}

function renderPlaysTree() {
  playsTreeEl.innerHTML = '';
  renderPlaysTreeChildren(playsTreeEl, null, 0);
  updatePlaysLocationLabel();
  // Every call site that changes currentFolderId/expandedFolderIds also
  // re-renders the tree, so persisting here is the one place needed to
  // keep the sidebar's view state surviving a reload.
  persistViewState(currentFolderId, expandedFolderIds);
}

function loadPlayEntry(entry) {
  const snapshot = loadPlaySnapshot(entry);
  frames = snapshot.frames;
  currentFrameIndex = 0;
  tokens = frames[0].tokens;
  lines = frames[0].lines;
  highlights = frames[0].highlights;
  resetInteractionState();
  playNameInput.value = entry.name;
  currentFolderId = entry.parentId;
  renderPlaysTree();
  persistCourtState();
  resetHistory();
  updateFrameBar();
  redraw();
}

// Deletes a folder/play, then makes sure `currentFolderId` still points
// at a folder that still exists — stepping up to the deleted folder's
// own parent if the current folder was it (or was nested inside it).
function deleteEntryAndReconcile(entry) {
  const steppingOutOfCurrent = entry.type === 'folder' && isWithinSubtree(library, currentFolderId, entry.id);
  library = deleteEntry(library, entry.id);
  persistLibrary(library);
  if (steppingOutOfCurrent) currentFolderId = entry.parentId;
  renderPlaysTree();
}

// Creates a new folder under `parentId` with a placeholder name, then
// immediately drops it into rename mode so the user can type its real
// name right away (Explorer/Finder-style "New Folder" creation).
function createFolderAndRename(parentId) {
  const name = uniqueSiblingName(library, parentId, 'New Folder');
  library = createFolder(library, name, parentId);
  persistLibrary(library);
  renderPlaysTree();
  const newEntry = library[library.length - 1];
  const nameEl = playsTreeEl.querySelector(`li[data-id="${newEntry.id}"] > .plays-tree-row > .folder-name`);
  if (nameEl) startRename(newEntry, nameEl);
}

newFolderBtn.addEventListener('click', () => createFolderAndRename(currentFolderId));

savePlayBtn.addEventListener('click', () => {
  const name = playNameInput.value.trim();
  if (!name) return;
  syncCurrentFrame();
  library = saveNamedPlay(library, name, frames, currentFolderId);
  persistLibrary(library);
  renderPlaysTree();
});

renderPlaysTree();


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

  // The highlight tool draws a freehand stroke regardless of what's under
  // the pointer (a token, a selected line's handles, etc.), so it's
  // handled first and bypasses every other hit-test below.
  if (activeTool === 'highlight') {
    highlightDrag = { pointerId: e.pointerId, points: [{ x, y }] };
    courtCanvas.setPointerCapture(e.pointerId);
    redraw();
    return;
  }

  if (!activeTool && selectedLineId) {
    const selectedLine = lines.find(l => l.id === selectedLineId);
    if (selectedLine) {
      const controlFt = lineControlPointFt(selectedLine, tokens);
      if (controlFt && Math.hypot(x - controlFt.x, y - controlFt.y) <= LINE_HANDLE_HIT_RADIUS_FT) {
        curveDrag = { lineId: selectedLine.id, pointerId: e.pointerId };
        courtCanvas.setPointerCapture(e.pointerId);
        return;
      }
      const pts = resolveLineEndpoints(selectedLine, tokens);
      if (pts && Math.hypot(x - pts.end.x, y - pts.end.y) <= LINE_HANDLE_HIT_RADIUS_FT) {
        // Detach immediately, even if the end was attached to a token —
        // this is what lets the user pull an attached arrow end free.
        // If dropped back onto another token it re-attaches (see
        // endDrag); otherwise it's left as a free point.
        selectedLine.endTokenId = null;
        selectedLine.endPoint = pts.end;
        endpointDrag = { lineId: selectedLine.id, pointerId: e.pointerId };
        courtCanvas.setPointerCapture(e.pointerId);
        return;
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
    dragState = {
      id: hit.id,
      pointerId: e.pointerId,
      lastX: hit.x,
      lastY: hit.y,
      // Captured once at drag start (not recomputed per move) so the
      // ball stays attached to this same carrier for the whole drag, even
      // if the drag briefly passes closer to another player mid-move.
      carriedBallId: findCarriedBallId(tokens, hit.id),
    };
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
  if (highlightDrag && highlightDrag.pointerId === e.pointerId) {
    const { x, y } = clientPointToFeet(courtCanvas, e.clientX, e.clientY);
    const last = highlightDrag.points[highlightDrag.points.length - 1];
    if (Math.hypot(x - last.x, y - last.y) >= HIGHLIGHT_MIN_POINT_SPACING_FT) {
      highlightDrag.points.push({ x, y });
    }
    redraw();
    return;
  }
  if (curveDrag && curveDrag.pointerId === e.pointerId) {
    const line = lines.find(l => l.id === curveDrag.lineId);
    const pts = line && resolveLineEndpoints(line, tokens);
    if (pts) {
      const { x, y } = clientPointToFeet(courtCanvas, e.clientX, e.clientY);
      line.curveHandle = offsetFromChord(pts.start, pts.end, { x, y });
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
  // Carry any ball this token picked up at drag-start along by the same
  // delta, so it visibly travels with the player rather than snapping
  // to a new spot only once the drag ends.
  if (dragState.carriedBallId) {
    const ball = tokens.find(t => t.id === dragState.carriedBallId);
    if (ball) {
      ball.x += x - dragState.lastX;
      ball.y += y - dragState.lastY;
    }
  }
  token.x = x;
  token.y = y;
  token.removing = !isWithinCourt(x, y);
  dragState.lastX = x;
  dragState.lastY = y;
  redraw();
});

// Minimum drag distance (feet) before a line is actually created, so a
// pointerdown/pointerup on the same spot doesn't leave a zero-length line.
const MIN_LINE_LENGTH_FT = 1;

function endDrag(e) {
  if (highlightDrag && highlightDrag.pointerId === e.pointerId) {
    if (courtCanvas.hasPointerCapture(e.pointerId)) courtCanvas.releasePointerCapture(e.pointerId);
    const { points } = highlightDrag;
    highlightDrag = null;
    if (points.length >= 2) {
      highlights.push(createHighlightStroke(points));
      persistCourtState();
      recordHistory();
      updateFrameBar();
    }
    redraw();
    return;
  }
  if (curveDrag && curveDrag.pointerId === e.pointerId) {
    if (courtCanvas.hasPointerCapture(e.pointerId)) courtCanvas.releasePointerCapture(e.pointerId);
    curveDrag = null;
    persistCourtState();
    recordHistory();
    redraw();
    return;
  }
  if (endpointDrag && endpointDrag.pointerId === e.pointerId) {
    if (courtCanvas.hasPointerCapture(e.pointerId)) courtCanvas.releasePointerCapture(e.pointerId);
    const line = lines.find(l => l.id === endpointDrag.lineId);
    endpointDrag = null;
    if (line && line.endPoint) {
      const target = findTokenAt(tokens.filter(t => t.id !== line.originTokenId), line.endPoint.x, line.endPoint.y);
      if (target) {
        line.endTokenId = target.id;
        line.endPoint = null;
      }
    }
    persistCourtState();
    recordHistory();
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
        persistCourtState();
        recordHistory();
        updateFrameBar(); // Apply Arrows becomes available once a line exists
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
    removeToken(token.id); // persists internally
  } else if (token) {
    token.removing = false;
    persistCourtState();
    recordHistory();
    updateFrameBar(); // refresh this frame's thumbnail with the token's new position
  }
  redraw();
}

courtCanvas.addEventListener('pointerup', endDrag);
courtCanvas.addEventListener('pointercancel', endDrag);

courtCanvas.addEventListener('dblclick', (e) => {
  const { x, y } = clientPointToFeet(courtCanvas, e.clientX, e.clientY);
  const hitToken = findTokenAt(tokens, x, y);
  if (hitToken) {
    removeToken(hitToken.id); // persists internally
    redraw();
    return;
  }
  const hitLine = findLineAt(lines, tokens, x, y);
  if (hitLine) {
    if (selectedLineId === hitLine.id) selectedLineId = null;
    lines = lines.filter(l => l.id !== hitLine.id);
    persistCourtState();
    recordHistory();
    updateFrameBar(); // Apply Arrows may become disabled again if that was the last line
    redraw();
    return;
  }
  const hitHighlight = findHighlightAt(highlights, x, y);
  if (hitHighlight) {
    highlights = highlights.filter(h => h.id !== hitHighlight.id);
    persistCourtState();
    recordHistory();
    updateFrameBar();
    redraw();
  }
});

window.addEventListener('resize', redraw);
