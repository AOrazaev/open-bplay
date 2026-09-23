// Named play persistence: save/list/load/delete full court snapshots
// (tokens + lines) as JSON in localStorage — mirrors the persistence
// pattern used in the `rotations` app, but keyed by play name instead of
// being a single autosave, since a play-drawing tool needs a library of
// distinct plays rather than "resume where I left off."

const PLAYS_STORAGE_KEY = 'play-drawing-saved-plays-v1';

function loadSavedPlays() {
  try {
    const saved = JSON.parse(localStorage.getItem(PLAYS_STORAGE_KEY));
    if (Array.isArray(saved)) return saved;
  } catch (_) {}
  return [];
}

function persistSavedPlays(plays) {
  localStorage.setItem(PLAYS_STORAGE_KEY, JSON.stringify(plays));
}

// Saves a snapshot of the given tokens/lines under `name`, returning the
// updated plays array (plays is mutated in place and also returned, so
// callers can use either style). Re-saving under a name that already
// exists overwrites that play in place rather than creating a duplicate,
// so "load, tweak, save" naturally updates the same entry.
function saveNamedPlay(plays, name, tokens, lines) {
  const tokensSnapshot = structuredClone(tokens);
  const linesSnapshot = structuredClone(lines);
  const existing = plays.find(p => p.name === name);
  if (existing) {
    existing.tokens = tokensSnapshot;
    existing.lines = linesSnapshot;
    existing.savedAt = Date.now();
  } else {
    plays.push({ id: crypto.randomUUID(), name, tokens: tokensSnapshot, lines: linesSnapshot, savedAt: Date.now() });
  }
  return plays;
}

// Returns a deep copy of a saved play's tokens/lines, safe to assign
// directly into the live court state without aliasing the stored copy
// (so further edits to the loaded play don't silently mutate storage
// until the user explicitly saves again).
function loadPlaySnapshot(play) {
  return { tokens: structuredClone(play.tokens), lines: structuredClone(play.lines) };
}

function deleteNamedPlay(plays, id) {
  return plays.filter(p => p.id !== id);
}
