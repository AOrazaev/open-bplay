// Undo/redo (Checkpoint 7): a linear history of full-court snapshots
// ({ frames, currentFrameIndex }), one entry per completed edit — a
// token/line/highlight change, or a frame being added/duplicated/
// deleted/advanced. Snapshots are plain JSON (no functions or circular
// references), so a deep clone via JSON.parse(JSON.stringify(...)) is
// simple and cheap at this app's scale — no need for a diff/command
// system. Pure frame *navigation* (Prev/Next, clicking a thumbnail, Play/
// step-animate landing on a frame) is intentionally NOT recorded here;
// only the explicit recordHistory() calls sprinkled at each edit's call
// site in app.js/frames-ui.js add a history entry. Depends on globals
// declared in app.js (frames, currentFrameIndex, tokens, lines,
// highlights, resetInteractionState, persistCourtState, redraw) and on
// updateFrameBar/isPlaying from frames-ui.js (loaded just before this).

const HISTORY_LIMIT = 50; // cap so an very long editing session doesn't grow this unboundedly

const undoBtn = document.querySelector('#undoBtn');
const redoBtn = document.querySelector('#redoBtn');

let historyStack = []; // snapshots; historyStack[historyIndex] is the currently-active one
let historyIndex = -1;

function cloneHistorySnapshot() {
  return { frames: JSON.parse(JSON.stringify(frames)), currentFrameIndex };
}

function canUndo() {
  return historyIndex > 0;
}

function canRedo() {
  return historyIndex < historyStack.length - 1;
}

function updateHistoryButtons() {
  undoBtn.disabled = isPlaying() || !canUndo();
  redoBtn.disabled = isPlaying() || !canRedo();
}

// Starts a fresh history with the current state as its only entry — call
// after replacing the whole court wholesale (initial load, loading a
// different saved play), so Undo can't reach back into a previous play's
// edits.
function resetHistory() {
  syncCurrentFrame();
  historyStack = [cloneHistorySnapshot()];
  historyIndex = 0;
  updateHistoryButtons();
}

// Records the current state as a new history entry — call right after an
// edit (token/line/highlight change, or a frame add/duplicate/delete/
// advance) has been persisted. Truncates any "future" entries left over
// from a previous Undo, matching standard editor undo/redo semantics
// (a fresh edit replaces whatever redo branch existed).
function recordHistory() {
  syncCurrentFrame();
  historyStack = historyStack.slice(0, historyIndex + 1);
  historyStack.push(cloneHistorySnapshot());
  if (historyStack.length > HISTORY_LIMIT) historyStack.shift();
  historyIndex = historyStack.length - 1;
  updateHistoryButtons();
}

// Applies a history snapshot to the live court state, bypassing the
// normal edit call sites entirely (it never calls recordHistory itself)
// so undo/redo can't recursively record themselves as new edits.
function restoreHistorySnapshot(snapshot) {
  frames = JSON.parse(JSON.stringify(snapshot.frames));
  currentFrameIndex = snapshot.currentFrameIndex;
  tokens = frames[currentFrameIndex].tokens;
  lines = frames[currentFrameIndex].lines;
  highlights = frames[currentFrameIndex].highlights;
  resetInteractionState();
  persistCourtState();
  updateFrameBar();
  redraw();
}

function undo() {
  if (isPlaying() || !canUndo()) return;
  historyIndex--;
  restoreHistorySnapshot(historyStack[historyIndex]);
  updateHistoryButtons();
}

function redo() {
  if (isPlaying() || !canRedo()) return;
  historyIndex++;
  restoreHistorySnapshot(historyStack[historyIndex]);
  updateHistoryButtons();
}

undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

// Ctrl/Cmd+Z to undo, Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z to redo — skipped
// while focus is in a text input (play name, folder rename) so typing an
// actual "z"/"y" or using the browser's own text-field undo isn't hijacked.
window.addEventListener('keydown', (e) => {
  const target = e.target;
  const isTextInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
  if (isTextInput) return;
  if (!(e.ctrlKey || e.metaKey)) return;

  const key = e.key.toLowerCase();
  if (key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
    e.preventDefault();
    redo();
  }
});

resetHistory();
