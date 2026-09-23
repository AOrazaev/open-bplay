// Multi-step play data helpers (Checkpoint 6): a play is a sequence of
// frames, each an independent { tokens, lines } snapshot. Pure data
// helpers only — no DOM/event wiring (that lives in js/frames-ui.js),
// mirrors the split used by court.js/tokens.js/lines.js.

// A brand-new play starts as a single empty frame.
function createInitialFrames() {
  return [{ tokens: [], lines: [] }];
}

function cloneFrame(frame) {
  return { tokens: structuredClone(frame.tokens), lines: structuredClone(frame.lines) };
}

// Accepts whatever a legacy (pre-frames) single-snapshot shape or the
// current frames-array shape looks like, and always returns a valid
// { frames, currentFrameIndex } — used by both the court autosave and
// saved-play loading paths so each only has to call this once rather
// than duplicating the same migration logic twice.
function normalizeFrames(raw) {
  if (raw && Array.isArray(raw.frames) && raw.frames.length > 0 &&
      raw.frames.every(f => f && Array.isArray(f.tokens) && Array.isArray(f.lines))) {
    const currentFrameIndex = Number.isInteger(raw.currentFrameIndex)
      ? Math.min(Math.max(raw.currentFrameIndex, 0), raw.frames.length - 1)
      : 0;
    return { frames: raw.frames, currentFrameIndex };
  }
  // Legacy shape: a single { tokens, lines } snapshot with no frames.
  if (raw && Array.isArray(raw.tokens) && Array.isArray(raw.lines)) {
    return { frames: [{ tokens: raw.tokens, lines: raw.lines }], currentFrameIndex: 0 };
  }
  return null;
}

// Linearly interpolates token positions between two frames' token sets,
// matched by id, for the frame-sequence playback preview. `t` is 0..1.
// A token present in both frames slides between its two positions. A
// token unique to one side is only shown near that side's end of the
// transition (cross-fading it in/out via alpha) rather than popping in
// abruptly, since it has no matching position to interpolate from/to.
function interpolateFrameTokens(fromTokens, toTokens, t) {
  const toById = new Map(toTokens.map(tok => [tok.id, tok]));
  const fromById = new Map(fromTokens.map(tok => [tok.id, tok]));
  const result = [];

  fromTokens.forEach(fromTok => {
    const toTok = toById.get(fromTok.id);
    if (toTok) {
      result.push({
        ...fromTok,
        x: fromTok.x + (toTok.x - fromTok.x) * t,
        y: fromTok.y + (toTok.y - fromTok.y) * t,
      });
    } else {
      result.push({ ...fromTok, alpha: 1 - t });
    }
  });
  toTokens.forEach(toTok => {
    if (!fromById.has(toTok.id)) {
      result.push({ ...toTok, alpha: t });
    }
  });

  return result;
}
