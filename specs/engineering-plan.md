# Play Drawing App — Engineering Plan

## North star

A static, zero-build, GitHub Pages–servable web app for drawing basketball
plays: place players/ball on a court, draw movement (cuts, passes, screens,
dribbles), save/load named plays locally, and export a play as an image —
mirroring the architecture and constraints of the `rotations` app (plain
HTML/CSS/JS, no bundler, no framework, works when `index.html` is opened
directly from disk, localStorage-only persistence).

## Constraints (carried over from `rotations`)

- No build step, no npm dependencies at runtime — plain `<script>` files.
- Must work opened directly via `file://` as well as served statically.
- All persistence is client-side (localStorage); no backend.
- Organize JS into small single-purpose files under `js/` from the start
  (avoid the single-monolith-then-split rework we did in `rotations`).
- Cover core interactions with Playwright tests as they're built.

## Checkpoints

### Checkpoint 1 — Static court render
Render a half-court on `<canvas>` (lines, arc, key, three-point line) at a
fixed aspect ratio, resizing to fit the window. No interactivity yet. Proves
out the coordinate system and visual theme everything else builds on.

### Checkpoint 2 — Place & drag tokens
Add player tokens (5 offense, labeled 1-5) and a ball token onto the court.
Click/tap to add, drag to reposition, delete via a control. This is the
minimum viable "set up a play."

### Checkpoint 3 — Draw movement lines
Tool palette to draw from a token: cut (solid arrow), pass (dashed arrow),
screen (perpendicular tick mark), dribble (squiggly line). Lines attach to
their origin token and stay editable/deletable.

### Checkpoint 4 — Save/load plays (localStorage)
Name and save the current court state (token positions + lines) as JSON in
localStorage; list saved plays; load or delete a saved play. Mirrors the
persistence pattern used in `rotations`.

### Checkpoint 5 — Export as image
Reuse the `rotations` canvas-export approach: render the play to an offscreen
canvas and copy to clipboard / download as PNG.

### Checkpoint 6 — Multi-step plays (stretch)
Sequence of frames (e.g. frame 1 → frame 2) to show a play developing over
time, with simple next/prev navigation and optional playback animation
interpolating token positions between frames.

## Out of scope for now

- Accounts, sharing/collaboration, or any server component.
- Full-court plays / transition drawing (half-court only until requested).
- Defense AI or scouting-report style annotations beyond basic X markers.
