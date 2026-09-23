// Frame-bar wiring (Checkpoint 6): navigate the current play's frame
// sequence, add/delete frames, and preview it as an animated playback.
// Depends on globals declared in app.js (frames, currentFrameIndex,
// tokens, lines, syncCurrentFrame, persistCourtState, resetInteractionState,
// redraw, playbackTokens) and on the pure helpers in js/frames.js
// (cloneFrame, advanceFrameByArrows, frameTransitionDurationMs,
// interpolateFrameTokens).

const prevFrameBtn = document.querySelector('#prevFrameBtn');
const nextFrameBtn = document.querySelector('#nextFrameBtn');
const addFrameBtn = document.querySelector('#addFrameBtn');
const advanceFrameBtn = document.querySelector('#advanceFrameBtn');
const deleteFrameBtn = document.querySelector('#deleteFrameBtn');
const playFramesBtn = document.querySelector('#playFramesBtn');
const frameLabelEl = document.querySelector('#frameLabel');

let playbackHandle = null; // requestAnimationFrame id while playback is running
let playbackStartIndex = 0; // frame Play was pressed from, restored when it stops

function isPlaying() {
  return playbackHandle !== null;
}

// Reflects `frames`/`currentFrameIndex` in the frame bar's label and
// button enabled-state. Called after every navigation/add/delete, and by
// app.js after Clear/loading a play replaces the whole sequence.
function updateFrameBar() {
  frameLabelEl.textContent = `Frame ${currentFrameIndex + 1} of ${frames.length}`;
  prevFrameBtn.disabled = isPlaying() || currentFrameIndex === 0;
  nextFrameBtn.disabled = isPlaying() || currentFrameIndex === frames.length - 1;
  deleteFrameBtn.disabled = isPlaying() || frames.length <= 1;
  addFrameBtn.disabled = isPlaying();
  // Only meaningful once at least one arrow has been drawn on this frame.
  advanceFrameBtn.disabled = isPlaying() || lines.length === 0;
  playFramesBtn.disabled = isPlaying() ? false : frames.length <= 1;
}

// Switches the live tokens/lines to point at `index` (assumed already a
// valid slot in `frames`), without touching whatever is at the outgoing
// index first — used by deleteFrameBtn below, since the frame being
// switched *away from* there was just removed from the array entirely,
// so there is nothing to sync back into it.
function applyFrameSwitch(index) {
  currentFrameIndex = index;
  tokens = frames[currentFrameIndex].tokens;
  lines = frames[currentFrameIndex].lines;
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

// Stops any running playback animation and restores the frame that was
// showing before Play was pressed — this is a preview, not a navigation
// action, so it always leaves you back where you started.
function stopPlayback() {
  if (playbackHandle !== null) cancelAnimationFrame(playbackHandle);
  playbackHandle = null;
  playbackTokens = null;
  playFramesBtn.textContent = '▶ Play';
  goToFrame(playbackStartIndex);
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
    redraw();

    if (elapsedMs >= segmentDurationMs) {
      segment++;
      if (segment >= frames.length - 1) {
        stopPlayback();
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
