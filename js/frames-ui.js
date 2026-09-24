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

    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'frame-thumb';
    if (isCurrent) item.classList.add('current');
    item.title = `Go to frame ${index + 1}`;

    const canvas = renderFrameThumbCanvas(frameTokens, frameLines, frameHighlights);
    canvas.className = 'frame-thumb-canvas';
    const label = document.createElement('span');
    label.className = 'frame-thumb-label';
    label.textContent = `Frame ${index + 1}`;

    item.append(canvas, label);
    item.addEventListener('click', () => {
      if (index !== currentFrameIndex) goToFrame(index);
    });
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
  if (frames.length <= 1) return;
  frames.splice(currentFrameIndex, 1);
  applyFrameSwitch(Math.min(currentFrameIndex, frames.length - 1));
});

// Stops any running playback animation. `restoreIndex` decides where the
// frame bar lands: manually pressing Stop mid-playback returns to the
// frame Play was pressed from (a preview should leave you where you were),
// while playback finishing on its own leaves you on the last frame instead.
function stopPlayback(restoreIndex = playbackStartIndex) {
  if (playbackHandle !== null) cancelAnimationFrame(playbackHandle);
  playbackHandle = null;
  playbackTokens = null;
  playbackHighlights = null;
  playFramesBtn.textContent = '▶ Play';
  goToFrame(restoreIndex);
}

playFramesBtn.addEventListener('click', () => {
  if (isPlaying()) {
    stopPlayback();
    return;
  }
  if (frames.length <= 1) return;

  syncCurrentFrame();
  playbackStartIndex = currentFrameIndex;
  playFramesBtn.textContent = '■ Stop';
  playbackHandle = -1; // truthy placeholder so isPlaying() is true before the first rAF fires
  updateFrameBar();

  let segment = 0; // index of the frames[segment] -> frames[segment+1] transition
  let segmentStart = null; // performance.now() timestamp the current segment began
  let segmentDurationMs = frameTransitionDurationMs(frames[0], frames[1]);

  function tick(now) {
    if (segmentStart === null) segmentStart = now;
    const elapsedMs = now - segmentStart;
    playbackTokens = interpolateFrameTokens(frames[segment].tokens, frames[segment + 1].tokens, elapsedMs, segmentDurationMs);
    playbackHighlights = frames[segment].highlights;
    redraw();

    if (elapsedMs >= segmentDurationMs) {
      segment++;
      if (segment >= frames.length - 1) {
        stopPlayback(frames.length - 1);
        return;
      }
      segmentStart = now;
      segmentDurationMs = frameTransitionDurationMs(frames[segment], frames[segment + 1]);
    }
    playbackHandle = requestAnimationFrame(tick);
  }

  playbackHandle = requestAnimationFrame(tick);
});

updateFrameBar();
