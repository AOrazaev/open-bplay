// Named play persistence: save/list/load/delete full court snapshots
// (tokens + lines), organized into a nestable folder hierarchy, as JSON
// in localStorage — mirrors the persistence pattern used in the
// `rotations` app, but keyed by play name/folder rather than being a
// single autosave, since a play-drawing tool needs a library of distinct
// (and organizable) plays rather than "resume where I left off."
//
// The library is a flat array of entries; each is either a folder or a
// play, distinguished by `type`. `parentId` (null = library root) is what
// gives the flat array its tree shape — a folder is just an entry other
// entries can point at as their parent, so nesting is "for free" and
// cascading delete/move only ever have to walk this one array.
//   folder: { id, type: 'folder', name, parentId }
//   play:   { id, type: 'play', name, parentId, frames, savedAt }
// (`frames` is an array of { tokens, lines } steps — Checkpoint 6's
// multi-step plays. Plays saved before that feature has a legacy
// top-level { tokens, lines } instead of `frames`; loadPlaySnapshot below
// migrates that into a single-frame array on load.)

const PLAYS_STORAGE_KEY = 'play-drawing-saved-plays-v1';

function loadLibrary() {
  try {
    const saved = JSON.parse(localStorage.getItem(PLAYS_STORAGE_KEY));
    if (Array.isArray(saved)) {
      // Migrate pre-folders saves (a flat list of plays with no
      // type/parentId) into the current shape, so existing localStorage
      // data from before this feature still loads instead of vanishing.
      return saved.map(entry => ({
        type: 'play',
        parentId: null,
        ...entry,
      }));
    }
  } catch (_) {}
  return [];
}

// A separate key from the library itself: this is pure sidebar UI state
// (which folder is selected as the save location, which folders are
// expanded) rather than saved-play data, so it's kept out of the schema
// tested/migrated above.
const PLAYS_VIEW_STATE_KEY = 'play-drawing-plays-view-state-v1';

// The court's own working state (current tokens/lines, independent of
// any saved play) — a lightweight autosave so a reload restores whatever
// was on the court, the same way a saved play restores its own snapshot.
const COURT_AUTOSAVE_KEY = 'play-drawing-court-autosave-v1';

function loadCourtAutosave() {
  try {
    const normalized = normalizeFrames(JSON.parse(localStorage.getItem(COURT_AUTOSAVE_KEY)));
    if (normalized) return normalized;
  } catch (_) {}
  return null;
}

function persistCourtAutosave(frames, currentFrameIndex) {
  localStorage.setItem(COURT_AUTOSAVE_KEY, JSON.stringify({ frames, currentFrameIndex }));
}

function loadViewState() {
  try {
    const state = JSON.parse(localStorage.getItem(PLAYS_VIEW_STATE_KEY));
    if (state && typeof state === 'object') {
      return {
        currentFolderId: state.currentFolderId ?? null,
        expandedFolderIds: Array.isArray(state.expandedFolderIds) ? state.expandedFolderIds : [],
      };
    }
  } catch (_) {}
  return { currentFolderId: null, expandedFolderIds: [] };
}

function persistViewState(currentFolderId, expandedFolderIds) {
  localStorage.setItem(PLAYS_VIEW_STATE_KEY, JSON.stringify({
    currentFolderId,
    expandedFolderIds: [...expandedFolderIds],
  }));
}

function persistLibrary(library) {
  localStorage.setItem(PLAYS_STORAGE_KEY, JSON.stringify(library));
}

// Children of `parentId` (null = root), folders first, alphabetical
// within each group — the order the sidebar tree renders in.
function childrenOf(library, parentId) {
  return library
    .filter(e => e.parentId === parentId)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

// True if `id` is `subtreeRootId` itself, or nested anywhere underneath
// it (walking up id's own parent chain). Used so that deleting/renaming a
// folder can tell whether the "current" folder was inside it.
function isWithinSubtree(library, id, subtreeRootId) {
  let current = library.find(e => e.id === id);
  while (current) {
    if (current.id === subtreeRootId) return true;
    current = library.find(e => e.id === current.parentId);
  }
  return false;
}

// Picks a name that doesn't collide with an existing sibling (same
// parentId), appending " 2", " 3", etc. as needed — used when creating a
// new folder so "New Folder" doesn't silently shadow an existing one.
function uniqueSiblingName(library, parentId, baseName) {
  const siblingNames = new Set(library.filter(e => e.parentId === parentId).map(e => e.name));
  if (!siblingNames.has(baseName)) return baseName;
  let n = 2;
  while (siblingNames.has(`${baseName} ${n}`)) n++;
  return `${baseName} ${n}`;
}

function createFolder(library, name, parentId) {
  library.push({ id: crypto.randomUUID(), type: 'folder', name, parentId });
  return library;
}

// Saves a snapshot of the given frame sequence under `name` inside folder
// `parentId`, returning the updated library. Re-saving under a name that
// already exists *in the same folder* overwrites that play in place
// rather than creating a duplicate, so "load, tweak, save" naturally
// updates the same entry — the same name is still free to reuse in a
// different folder.
function saveNamedPlay(library, name, frames, parentId) {
  const framesSnapshot = frames.map(cloneFrame);
  const existing = library.find(e => e.type === 'play' && e.name === name && e.parentId === parentId);
  if (existing) {
    existing.frames = framesSnapshot;
    delete existing.tokens; // drop any legacy single-snapshot fields on re-save
    delete existing.lines;
    existing.savedAt = Date.now();
  } else {
    library.push({ id: crypto.randomUUID(), type: 'play', name, parentId, frames: framesSnapshot, savedAt: Date.now() });
  }
  return library;
}

// Returns a deep copy of a saved play's frame sequence, safe to assign
// directly into the live court state without aliasing the stored copy
// (so further edits to the loaded play don't silently mutate storage
// until the user explicitly saves again). Migrates a play saved before
// Checkpoint 6 (a single top-level { tokens, lines }, no `frames`) into
// a one-frame array.
function loadPlaySnapshot(play) {
  const normalized = normalizeFrames(play);
  return { frames: normalized.frames.map(cloneFrame) };
}

// Deletes an entry by id. If it's a folder, cascades to every entry
// nested under it (at any depth) too, so a deleted folder never leaves
// orphaned plays/subfolders still pointing at a parentId that no longer
// exists.
function deleteEntry(library, id) {
  return library.filter(e => !isWithinSubtree(library, e.id, id));
}

function renameEntry(library, id, newName) {
  const entry = library.find(e => e.id === id);
  if (entry) entry.name = newName;
  return library;
}

// --- Export/import: move plays/folders between devices as a plain JSON
// file (localStorage itself never leaves the device it's set on) --------

const LIBRARY_EXPORT_KIND = 'open-bplay-library';
const PLAY_EXPORT_KIND = 'open-bplay-play';
const EXPORT_FORMAT_VERSION = 1;

// Whole-library export: every folder/play as-is (each play's own schema —
// current `frames` or a pre-Checkpoint-6 legacy `{ tokens, lines }` — is
// left untouched, since loadPlaySnapshot's normalizeFrames migrates
// either shape on load anyway, on *any* device).
function buildLibraryExportPayload(library) {
  return { kind: LIBRARY_EXPORT_KIND, version: EXPORT_FORMAT_VERSION, exportedAt: Date.now(), entries: library };
}

// Single-play export: one play entry, with its parentId cleared so
// mergeImportedEntries treats it as a root of the imported batch (i.e.
// anchors it under wherever the *importing* device currently has
// selected, rather than trying to preserve the exporting device's own
// folder structure).
function buildPlayExportPayload(playEntry) {
  return {
    kind: PLAY_EXPORT_KIND,
    version: EXPORT_FORMAT_VERSION,
    exportedAt: Date.now(),
    entries: [{ ...playEntry, parentId: null }],
  };
}

// Parses and shape-validates a File's text as an export payload, or
// returns null for anything that isn't recognizably one of ours (wrong
// JSON shape, a totally unrelated file, corrupted text, etc.) — the only
// signal the importing UI needs to decide whether to proceed or show an
// error.
function parseImportPayload(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (_) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.kind !== LIBRARY_EXPORT_KIND && parsed.kind !== PLAY_EXPORT_KIND) return null;
  if (!Array.isArray(parsed.entries)) return null;
  return parsed;
}

// Like uniqueSiblingName, but suffixes "(2)", "(3)"... instead of " 2",
// " 3" — used only to resolve import naming conflicts, so a merged-in
// duplicate reads distinctly from the auto-numbered "New Folder 2" style
// used when creating a folder.
function uniqueImportName(library, parentId, baseName) {
  const siblingNames = new Set(library.filter(e => e.parentId === parentId).map(e => e.name));
  if (!siblingNames.has(baseName)) return baseName;
  let n = 2;
  while (siblingNames.has(`${baseName} (${n})`)) n++;
  return `${baseName} (${n})`;
}

// Grafts an exported `entries` subtree (see buildLibraryExportPayload /
// buildPlayExportPayload) into `library`, underneath `anchorParentId`,
// without colliding with existing ids or same-level (same parentId)
// names. `entries` must list parents before their children (true of both
// export builders above, since a plain top-to-bottom copy of `library`
// already satisfies that, and a single play has no children to worry
// about) — that ordering lets each child's parentId remap resolve
// through `idMap` before the child itself is processed.
//
// Id collisions (most commonly: re-importing the exact same file, whose
// entries still carry their original ids) get a fresh id rather than
// being skipped/merged — this always keeps both the existing and
// incoming copies, deferring to the name-uniquing below to keep them
// visually distinguishable; nothing here tries to detect "this is really
// the same play" and de-duplicate it.
function mergeImportedEntries(library, entries, anchorParentId) {
  const idMap = new Map(); // original entry id -> id actually used in the merged library
  const merged = [...library];
  entries.forEach(entry => {
    const remappedParentId = entry.parentId == null ? anchorParentId : (idMap.get(entry.parentId) ?? entry.parentId);
    const finalId = merged.some(e => e.id === entry.id) ? crypto.randomUUID() : entry.id;
    idMap.set(entry.id, finalId);
    const name = uniqueImportName(merged, remappedParentId, entry.name);
    merged.push({ ...entry, id: finalId, parentId: remappedParentId, name });
  });
  return merged;
}

// The folder path from root down to `folderId` (inclusive), as an array
// of names — e.g. ['Root', 'Sets', 'Horns']. `folderId === null` is the
// root itself. Used to render the sidebar's "Saving to: ..." breadcrumb.
function folderPath(library, folderId) {
  const names = [];
  let current = folderId == null ? null : library.find(e => e.id === folderId);
  while (current) {
    names.unshift(current.name);
    current = library.find(e => e.id === current.parentId);
  }
  names.unshift('Root');
  return names;
}
