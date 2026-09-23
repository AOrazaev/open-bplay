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

// Constant on-court speed (feet/second) used to derive how long a frame
// transition's playback animation takes, and clamps on that derived
// duration so a tiny nudge doesn't look instant and a full-court sprint
// doesn't take forever. See frameTransitionDurationMs below for why a
// constant speed (rather than a constant duration) is what makes every
// token's animated movement look equally "fast", regardless of how far
// it travels.
const FRAME_PLAYBACK_SPEED_FT_PER_SEC = 14;
const MIN_FRAME_TRANSITION_MS = 350;
const MAX_FRAME_TRANSITION_MS = 1800;

function tokenTravelDistanceFt(fromTok, toTok) {
  return Math.hypot(toTok.x - fromTok.x, toTok.y - fromTok.y);
}

// How long (ms) the playback animation from `fromFrame` to `toFrame`
// should run: long enough, at FRAME_PLAYBACK_SPEED_FT_PER_SEC, for its
// farthest-traveling token (matched by id across the two frames) to
// cover its distance — clamped to a sane min/max. Every matched token
// then moves at (approximately) that same real-world speed: shorter
// movements simply finish before this duration elapses and hold in
// place, rather than every token being forced to cover a different
// distance in the same fixed time (which is what made short moves look
// sluggish and long moves look like they were "running" to catch up).
function frameTransitionDurationMs(fromFrame, toFrame) {
  const toById = new Map(toFrame.tokens.map(tok => [tok.id, tok]));
  let maxDistanceFt = 0;
  fromFrame.tokens.forEach(fromTok => {
    const toTok = toById.get(fromTok.id);
    if (toTok) maxDistanceFt = Math.max(maxDistanceFt, tokenTravelDistanceFt(fromTok, toTok));
  });
  const ms = (maxDistanceFt / FRAME_PLAYBACK_SPEED_FT_PER_SEC) * 1000;
  return Math.min(MAX_FRAME_TRANSITION_MS, Math.max(MIN_FRAME_TRANSITION_MS, ms));
}

// Interpolates token positions between two frames' token sets, matched
// by id, for the frame-sequence playback preview at `elapsedMs` into a
// transition lasting `segmentDurationMs` (see frameTransitionDurationMs).
// A token present in both frames moves toward its target at the shared
// FRAME_PLAYBACK_SPEED_FT_PER_SEC — its *own* travel distance decides how
// much of the segment it actually needs, so a short move completes early
// and simply holds rather than crawling for the whole segment. A token
// unique to one side has no position to interpolate from/to, so it's
// only shown by cross-fading it in/out via alpha over the full segment.
function interpolateFrameTokens(fromTokens, toTokens, elapsedMs, segmentDurationMs) {
  const toById = new Map(toTokens.map(tok => [tok.id, tok]));
  const fromById = new Map(fromTokens.map(tok => [tok.id, tok]));
  const segmentT = segmentDurationMs > 0 ? Math.min(1, elapsedMs / segmentDurationMs) : 1;
  const result = [];

  fromTokens.forEach(fromTok => {
    const toTok = toById.get(fromTok.id);
    if (toTok) {
      const distanceFt = tokenTravelDistanceFt(fromTok, toTok);
      const ownDurationMs = Math.min(segmentDurationMs, (distanceFt / FRAME_PLAYBACK_SPEED_FT_PER_SEC) * 1000);
      const localT = ownDurationMs > 0 ? Math.min(1, elapsedMs / ownDurationMs) : 1;
      result.push({
        ...fromTok,
        x: fromTok.x + (toTok.x - fromTok.x) * localT,
        y: fromTok.y + (toTok.y - fromTok.y) * localT,
      });
    } else {
      result.push({ ...fromTok, alpha: 1 - segmentT });
    }
  });
  toTokens.forEach(toTok => {
    if (!fromById.has(toTok.id)) {
      result.push({ ...toTok, alpha: segmentT });
    }
  });

  return result;
}
