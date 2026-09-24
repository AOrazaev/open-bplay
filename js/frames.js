// Multi-step play data helpers (Checkpoint 6): a play is a sequence of
// frames, each an independent { tokens, lines, highlights } snapshot. Pure
// data helpers only — no DOM/event wiring (that lives in js/frames-ui.js),
// mirrors the split used by court.js/tokens.js/lines.js.

// A brand-new play starts as a single empty frame.
function createInitialFrames() {
  return [{ tokens: [], lines: [], highlights: [] }];
}

function cloneFrame(frame) {
  return {
    tokens: structuredClone(frame.tokens),
    lines: structuredClone(frame.lines),
    highlights: structuredClone(frame.highlights || []),
  };
}

// Builds the *next* frame's starting point by applying every line drawn
// in `frame` as a movement, rather than just duplicating positions
// as-is (that's what plain "+ Frame" does). A cut/dribble/screen line
// moves its own origin token to the line's endpoint — that's the player
// performing the action. A dribble line also drags along any ball token
// that was in that player's hands beforehand, so the ball doesn't get
// left behind mid-dribble. A pass line instead moves the ball token
// (only when there's exactly one on the court — otherwise there's no
// unambiguous "the ball" to move) to the endpoint, since a pass is the
// ball changing hands, not the passer relocating. Tokens with no line
// keep their position (e.g. a defender who didn't move, or the ball
// when nothing passed it). The new frame starts with no lines of its
// own — those describe the transition *into* it, not out of it — ready
// for the next step to be drawn fresh.
function advanceFrameByArrows(frame) {
  const newTokens = structuredClone(frame.tokens);
  const tokensById = new Map(newTokens.map(t => [t.id, t]));

  frame.lines.forEach(line => {
    const pts = resolveLineEndpoints(line, frame.tokens);
    if (!pts) return;
    if (line.type === LINE_TYPES.PASS) {
      const ballTokens = newTokens.filter(t => t.type === TOKEN_TYPES.BALL);
      if (ballTokens.length === 1) {
        ballTokens[0].x = pts.end.x;
        ballTokens[0].y = pts.end.y;
      }
      return;
    }
    const mover = tokensById.get(line.originTokenId);
    if (mover) {
      mover.x = pts.end.x;
      mover.y = pts.end.y;
    }
    if (line.type === LINE_TYPES.DRIBBLE) {
      // Dribbling means the ball travels with the player, not just the
      // player's own dot — move any ball token that was in the player's
      // hands (i.e. co-located with them) before the move to the same
      // endpoint, so it doesn't get left behind.
      const originalOrigin = frame.tokens.find(t => t.id === line.originTokenId);
      if (originalOrigin) {
        newTokens
          .filter(t => t.type === TOKEN_TYPES.BALL &&
            Math.hypot(t.x - originalOrigin.x, t.y - originalOrigin.y) <= BALL_CARRY_THRESHOLD_FT)
          .forEach(ball => {
            ball.x = pts.end.x;
            ball.y = pts.end.y;
          });
      }
    }
  });

  // Highlights annotate a specific moment's spacing rather than describing
  // a movement to carry forward, so — like lines — the advanced frame
  // starts without them, ready for fresh annotations.
  return { tokens: newTokens, lines: [], highlights: [] };
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
    // Frames saved before the highlight feature existed have no
    // `highlights` field — default it to empty rather than requiring a
    // one-off migration pass.
    const frames = raw.frames.map(f => (Array.isArray(f.highlights) ? f : { ...f, highlights: [] }));
    return { frames, currentFrameIndex };
  }
  // Legacy shape: a single { tokens, lines } snapshot with no frames.
  if (raw && Array.isArray(raw.tokens) && Array.isArray(raw.lines)) {
    return { frames: [{ tokens: raw.tokens, lines: raw.lines, highlights: [] }], currentFrameIndex: 0 };
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
