// Frame-bar wiring (Checkpoint 6): navigate the current play's frame
// sequence, add/delete frames, preview it as an animated playback, and
// render the Frames sidebar tab's thumbnail list. Depends on globals
// declared in app.js (frames, currentFrameIndex, tokens, lines,
// syncCurrentFrame, persistCourtState, resetInteractionState, redraw,
// playbackTokens), on the pure helpers in js/frames.js (cloneFrame,
// advanceFrameByArrows, frameTransitionDurationMs, interpolateFrameTokens),
// and on drawCourt/courtToCanvas/COURT_WIDTH_FT/COURT_LENGTH_FT from
// court.js plus drawLines/drawTokens from lines.js/tokens.js for the
// thumbnails.

const prevFrameBtn = document.querySelector('#prevFrameBtn');
const nextFrameBtn = document.querySelector('#nextFrameBtn');
const stepPrevFrameBtn = document.querySelector('#stepPrevFrameBtn');
const stepNextFrameBtn = document.querySelector('#stepNextFrameBtn');
const addFrameBtn = document.querySelector('#addFrameBtn');
const advanceFrameBtn = document.querySelector('#advanceFrameBtn');
const deleteFrameBtn = document.querySelector('#deleteFrameBtn');
const playFramesBtn = document.querySelector('#playFramesBtn');
const frameLabelEl = document.querySelector('#frameLabel');
const framesListEl = document.querySelector('#framesList');

let playbackHandle = null; // requestAnimationFrame id while playback is running
let playbackStartIndex = 0; // frame Play was pressed from, restored when it stops

function isPlaying() {
  return playbackHandle !== null;
}

// Renders one frame's { tokens, lines } onto a small offscreen canvas for
// the Frames tab's thumbnail list — reuses the same drawCourt/drawLines/
// drawTokens functions the live canvas and image export use. The CSS
// display size is controlled by .frame-thumb-canvas (width: 100%); the
// backing store is rendered well above that so it stays sharp even at
// the sidebar's max width, and scaled further by devicePixelRatio so it
// isn't soft on high-DPI/retina screens either.
const FRAME_THUMB_WIDTH_PX = 420;

function renderFrameThumbCanvas(frameTokens, frameLines, frameHighlights) {
  const dpr = window.devicePixelRatio || 1;
  const widthPx = Math.round(FRAME_THUMB_WIDTH_PX * dpr);
  const heightPx = Math.round(widthPx * (COURT_LENGTH_FT / COURT_WIDTH_FT));
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  drawCourt(ctx, canvas.width, canvas.height);
  const map = courtToCanvas(canvas.width, canvas.height);
  drawHighlights(ctx, frameHighlights || [], map);
  drawLines(ctx, frameLines, frameTokens, map);
  drawTokens(ctx, frameTokens, map);
  return canvas;
}

// Rebuilds the Frames tab's thumbnail list from `frames`. The current
// frame's own tokens/lines/highlights are read from the live globals
// rather than `frames[currentFrameIndex]`, since those are only written
// back into `frames` by syncCurrentFrame() — reading the live globals
// instead means an in-progress edit (e.g. a line just drawn) shows up in
// its thumbnail immediately, without needing a sync call.
function renderFramesPanel() {
  framesListEl.innerHTML = '';
  frames.forEach((frame, index) => {
    const isCurrent = index === currentFrameIndex;
    const frameTokens = isCurrent ? tokens : frame.tokens;
    const frameLines = isCurrent ? lines : frame.lines;
    const frameHighlights = isCurrent ? highlights : frame.highlights;

    const item = document.createElement('div');
    item.className = 'frame-thumb';
    if (isCurrent) item.classList.add('current');

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'frame-thumb-select';
    selectBtn.title = `Go to frame ${index + 1}`;

    const canvas = renderFrameThumbCanvas(frameTokens, frameLines, frameHighlights);
    canvas.className = 'frame-thumb-canvas';
    const label = document.createElement('span');
    label.className = 'frame-thumb-label';
    label.textContent = `Frame ${index + 1}`;

    selectBtn.append(canvas, label);
    selectBtn.addEventListener('click', () => {
      if (index !== currentFrameIndex) goToFrame(index);
    });

    const actions = document.createElement('div');
    actions.className = 'frame-thumb-actions';
    const duplicateBtn = createTreeButton('frame-thumb-duplicate-btn', '⧉', `Duplicate frame ${index + 1}`, () => duplicateFrameAt(index));
    const deleteBtn = createTreeButton('frame-thumb-delete-btn', '🗑', `Delete frame ${index + 1}`, () => deleteFrameAt(index));
    if (frames.length <= 1) deleteBtn.disabled = true;
    actions.append(duplicateBtn, deleteBtn);

    item.append(selectBtn, actions);
    framesListEl.appendChild(item);
  });
}

// Reflects `frames`/`currentFrameIndex` in the frame bar's label and
// button enabled-state, and refreshes the Frames tab's thumbnails. Called
// after every navigation/add/delete, and by app.js after Clear/loading a
// play replaces the whole sequence, or a line is drawn/deleted.
function updateFrameBar() {
  frameLabelEl.textContent = `Frame ${currentFrameIndex + 1} of ${frames.length}`;
  prevFrameBtn.disabled = isPlaying() || currentFrameIndex === 0;
  nextFrameBtn.disabled = isPlaying() || currentFrameIndex === frames.length - 1;
  stepPrevFrameBtn.disabled = isPlaying() || currentFrameIndex === 0;
  stepNextFrameBtn.disabled = isPlaying() || currentFrameIndex === frames.length - 1;
  deleteFrameBtn.disabled = isPlaying() || frames.length <= 1;
  addFrameBtn.disabled = isPlaying();
  // Only meaningful once at least one arrow has been drawn on this frame.
  advanceFrameBtn.disabled = isPlaying() || lines.length === 0;
  playFramesBtn.disabled = isPlaying() ? false : frames.length <= 1;
  renderFramesPanel();
}

// Switches the live tokens/lines/highlights to point at `index` (assumed
// already a valid slot in `frames`), without touching whatever is at the
// outgoing index first — used by deleteFrameBtn below, since the frame
// being switched *away from* there was just removed from the array
// entirely, so there is nothing to sync back into it.
function applyFrameSwitch(index) {
  currentFrameIndex = index;
  tokens = frames[currentFrameIndex].tokens;
  lines = frames[currentFrameIndex].lines;
  highlights = frames[currentFrameIndex].highlights;
  resetInteractionState();
  persistCourtState();
  updateFrameBar();
  redraw();
}

// Switches the live tokens/lines to a different frame index, syncing the
// outgoing frame back into the array first so no in-progress edits are
// lost.
function goToFrame(index) {
  syncCurrentFrame();
  applyFrameSwitch(index);
}

// Inserts a copy of frames[index] right after it, from the Frames tab's
// per-thumbnail duplicate button — unlike goToFrame/applyFrameSwitch,
// this never touches the live tokens/lines/highlights globals or resets
// interaction state: whichever frame is currently active keeps the exact
// same object reference (just possibly at a shifted index), so an
// in-progress edit on it is untouched. `syncCurrentFrame()` still runs
// first so duplicating the *current* frame captures its latest edits.
function duplicateFrameAt(index) {
  syncCurrentFrame();
  const duplicated = cloneFrame(frames[index]);
  frames.splice(index + 1, 0, duplicated);
  if (currentFrameIndex > index) currentFrameIndex++;
  persistCourtState();
  updateFrameBar();
}

// Removes frames[index], from either the toolbar Delete Frame button
// (index === currentFrameIndex) or a thumbnail's per-frame delete button
// (any index). Refuses to remove the last remaining frame — a play
// always needs at least one. Deleting the frame currently being edited
// mirrors applyFrameSwitch's existing behavior (no sync-back, since it's
// being discarded); deleting any other frame just shifts
// currentFrameIndex down if it came after the removed one, leaving the
// live tokens/lines/highlights globals untouched.
function deleteFrameAt(index) {
  if (frames.length <= 1) return;
  if (index === currentFrameIndex) {
    frames.splice(index, 1);
    applyFrameSwitch(Math.min(index, frames.length - 1));
    return;
  }
  syncCurrentFrame();
  frames.splice(index, 1);
  if (currentFrameIndex > index) currentFrameIndex--;
  persistCourtState();
  updateFrameBar();
}

prevFrameBtn.addEventListener('click', () => {
  if (currentFrameIndex > 0) goToFrame(currentFrameIndex - 1);
});

nextFrameBtn.addEventListener('click', () => {
  if (currentFrameIndex < frames.length - 1) goToFrame(currentFrameIndex + 1);
});

addFrameBtn.addEventListener('click', () => {
  syncCurrentFrame();
  const duplicated = cloneFrame(frames[currentFrameIndex]);
  frames.splice(currentFrameIndex + 1, 0, duplicated);
  goToFrame(currentFrameIndex + 1);
});

advanceFrameBtn.addEventListener('click', () => {
  if (lines.length === 0) return;
  syncCurrentFrame();
  const advanced = advanceFrameByArrows(frames[currentFrameIndex]);
  frames.splice(currentFrameIndex + 1, 0, advanced);
  goToFrame(currentFrameIndex + 1);
});

deleteFrameBtn.addEventListener('click', () => {
  deleteFrameAt(currentFrameIndex);
});

// Stops any running playback animation (whether a full Play run or a
// single-step ‹◀›/‹▶› transition). `restoreIndex` decides where the frame
// bar lands: manually pressing Stop mid-Play returns to the frame Play
// was pressed from (a preview should leave you where you were), while
// playback finishing on its own — either the full sequence or a single
// step — lands on whichever frame it was headed to (passed explicitly by
// animateThroughFrames when a segment run completes).
function stopPlayback(restoreIndex = playbackStartIndex) {
  if (playbackHandle !== null) cancelAnimationFrame(playbackHandle);
  playbackHandle = null;
  playbackTokens = null;
  playbackHighlights = null;
  playFramesBtn.textContent = '▶ Play';
  goToFrame(restoreIndex);
}

// Animates through `indices` (an ordered list of frame indices, each
// adjacent pair becoming one transition segment) — the shared engine
// behind both the full-sequence Play button (indices = every frame, in
// order) and the single-step ‹◀›/‹▶› buttons (indices = just [current,
// neighbor]). `manualStopRestoreIndex` is only used if playback is
// interrupted mid-run by pressing Stop (only reachable from the full Play
// button, since the step buttons don't expose a Stop control) — for a
// full Play run that's back where it started; a completed run (whether
// it plays out naturally or is stopped after finishing) always lands on
// `indices`' last frame.
function animateThroughFrames(indices, manualStopRestoreIndex) {
  if (indices.length < 2) return;
  syncCurrentFrame();
  playbackStartIndex = manualStopRestoreIndex;
  playbackHandle = -1; // truthy placeholder so isPlaying() is true before the first rAF fires
  updateFrameBar();

  let segment = 0; // position within `indices` of the transition currently animating
  let segmentStart = null; // performance.now() timestamp the current segment began
  let segmentDurationMs = frameTransitionDurationMs(frames[indices[0]], frames[indices[1]]);

  function tick(now) {
    if (segmentStart === null) segmentStart = now;
    const elapsedMs = now - segmentStart;
    const fromFrame = frames[indices[segment]];
    const toFrame = frames[indices[segment + 1]];
    playbackTokens = interpolateFrameTokens(fromFrame.tokens, toFrame.tokens, elapsedMs, segmentDurationMs);
    playbackHighlights = interpolateFrameHighlights(fromFrame.highlights, toFrame.highlights, elapsedMs, segmentDurationMs);
    redraw();

    if (elapsedMs >= segmentDurationMs) {
      segment++;
      if (segment >= indices.length - 1) {
        stopPlayback(indices[indices.length - 1]);
        return;
      }
      segmentStart = now;
      segmentDurationMs = frameTransitionDurationMs(frames[indices[segment]], frames[indices[segment + 1]]);
    }
    playbackHandle = requestAnimationFrame(tick);
  }

  playbackHandle = requestAnimationFrame(tick);
}

playFramesBtn.addEventListener('click', () => {
  if (isPlaying()) {
    stopPlayback();
    return;
  }
  if (frames.length <= 1) return;
  playFramesBtn.textContent = '■ Stop';
  animateThroughFrames(frames.map((_, i) => i), currentFrameIndex);
});

stepPrevFrameBtn.addEventListener('click', () => {
  if (isPlaying() || currentFrameIndex === 0) return;
  animateThroughFrames([currentFrameIndex, currentFrameIndex - 1], currentFrameIndex - 1);
});

stepNextFrameBtn.addEventListener('click', () => {
  if (isPlaying() || currentFrameIndex === frames.length - 1) return;
  animateThroughFrames([currentFrameIndex, currentFrameIndex + 1], currentFrameIndex + 1);
});

updateFrameBar();
