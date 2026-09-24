const { test, expect } = require('@playwright/test');

async function spawnTokenAt(page, type, xFt, yFt) {
  const chipBox = await page.locator(`.tray-chip[data-type="${type}"]`).boundingBox();
  const targetPoint = await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('#courtCanvas');
    return courtFeetToClientPoint(canvas, x, y);
  }, { x: xFt, y: yFt });

  await page.mouse.move(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 5 });
  await page.mouse.up();
}

test.describe('Checkpoint 6 — multi-step plays (frames)', () => {
  test.use({ viewport: { width: 900, height: 1000 } });

  test('a new play starts as a single frame, and Add Frame duplicates the current one', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 1 of 1');
    await expect(page.locator('#deleteFrameBtn')).toBeDisabled();

    await spawnTokenAt(page, 'offense', 10, 30);
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(1);

    await page.click('#addFrameBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 2 of 2');
    // Duplicated from frame 1, so the token carries over.
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(1);
    await expect(page.locator('#deleteFrameBtn')).toBeEnabled();
  });

  test('Prev/Next navigate between frames, each keeping its own tokens', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.click('#addFrameBtn');
    // Now on frame 2 (duplicated); add a second token only here.
    await spawnTokenAt(page, 'defense', 15, 25);
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(2);

    await page.click('#prevFrameBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 1 of 2');
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(1);
    await expect(page.locator('#prevFrameBtn')).toBeDisabled();

    await page.click('#nextFrameBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 2 of 2');
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(2);
    await expect(page.locator('#nextFrameBtn')).toBeDisabled();
  });

  test('Delete Frame removes the current frame and cannot go below one frame', async ({ page }) => {
    await page.goto('/');
    await page.click('#addFrameBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 2 of 2');

    await page.click('#deleteFrameBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 1 of 1');
    await expect(page.locator('#deleteFrameBtn')).toBeDisabled();
  });

  test('Clear resets the whole frame sequence back to a single empty frame', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.click('#addFrameBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 2 of 2');

    await page.click('#clearCourt');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 1 of 1');
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(0);
  });

  test('the frame sequence and current frame survive a reload', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.click('#addFrameBtn');
    await spawnTokenAt(page, 'defense', 15, 25);
    await expect(page.locator('#frameLabel')).toHaveText('Frame 2 of 2');

    await page.reload();
    await expect(page.locator('#frameLabel')).toHaveText('Frame 2 of 2');
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(2);

    await page.click('#prevFrameBtn');
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(1);
  });

  test('a saved multi-frame play round-trips through save and load', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.click('#addFrameBtn');
    await spawnTokenAt(page, 'defense', 15, 25);
    await page.fill('#playNameInput', 'Two Steps');
    await page.click('#savePlayBtn');

    await page.click('#clearCourt');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 1 of 1');

    await page.locator('.play-name', { hasText: 'Two Steps' }).click();
    await expect(page.locator('#frameLabel')).toHaveText('Frame 1 of 2');
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(1);

    await page.click('#nextFrameBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 2 of 2');
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(2);
  });

  test('a legacy single-snapshot autosave (pre-frames) still loads as a single frame', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('play-drawing-court-autosave-v1', JSON.stringify({
        tokens: [{ id: 'legacy-1', type: 'offense', label: '1', x: 10, y: 30 }],
        lines: [],
      }));
    });
    await page.goto('/');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 1 of 1');
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(1);
  });

  test('a legacy single-snapshot saved play (pre-frames) still loads as a single frame', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('play-drawing-saved-plays-v1', JSON.stringify([
        {
          id: 'legacy-play-1',
          type: 'play',
          name: 'Old Save',
          parentId: null,
          tokens: [{ id: 'legacy-1', type: 'offense', label: '1', x: 10, y: 30 }],
          lines: [],
          savedAt: Date.now(),
        },
      ]));
    });
    await page.goto('/');
    await page.locator('.play-name', { hasText: 'Old Save' }).click();
    await expect(page.locator('#frameLabel')).toHaveText('Frame 1 of 1');
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(1);
  });

  test('Play animates through the sequence and lands on the last frame when it finishes', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.click('#addFrameBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 2 of 2');
    await page.click('#prevFrameBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 1 of 2');

    await page.click('#playFramesBtn');
    await expect(page.locator('#playFramesBtn')).toHaveText('■ Stop');
    // Buttons that would interfere with playback are disabled while it runs.
    await expect(page.locator('#addFrameBtn')).toBeDisabled();

    // Playback runs a single transition (frame 1 -> 2); its duration is
    // derived from the farthest-traveling token (clamped to a minimum),
    // so this waits for it to finish on its own rather than clicking
    // Stop, to also verify auto-completion.
    await expect(page.locator('#playFramesBtn')).toHaveText('▶ Play', { timeout: 3000 });
    // Finishing playback on its own leaves you on the last frame, not
    // back where Play was pressed from.
    await expect(page.locator('#frameLabel')).toHaveText('Frame 2 of 2');
    await expect(page.locator('#addFrameBtn')).toBeEnabled();
  });

  test('manually pressing Stop mid-playback returns to the frame Play was pressed from', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.click('#addFrameBtn');
    await page.click('#prevFrameBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 1 of 2');

    await page.click('#playFramesBtn');
    await expect(page.locator('#playFramesBtn')).toHaveText('■ Stop');
    await page.click('#playFramesBtn'); // Stop before it finishes on its own

    await expect(page.locator('#playFramesBtn')).toHaveText('▶ Play');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 1 of 2');
  });

  test('playback moves tokens at a constant speed, so a short move finishes before a long one', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const fromFrame = {
        tokens: [
          { id: 'short', type: 'offense', label: '1', x: 10, y: 10 },
          { id: 'long', type: 'offense', label: '2', x: 0, y: 0 },
        ],
        lines: [],
      };
      const toFrame = {
        tokens: [
          { id: 'short', type: 'offense', label: '1', x: 11, y: 10 }, // 1 ft
          { id: 'long', type: 'offense', label: '2', x: 40, y: 0 }, // 40 ft
        ],
        lines: [],
      };
      const durationMs = frameTransitionDurationMs(fromFrame, toFrame);
      // Sample partway through: the short move should already be at its
      // destination (it needed far less time at the shared speed), while
      // the long move should still be under way.
      const midway = interpolateFrameTokens(fromFrame.tokens, toFrame.tokens, durationMs * 0.4, durationMs);
      const short = midway.find(t => t.id === 'short');
      const long = midway.find(t => t.id === 'long');
      return { durationMs, shortX: short.x, longX: long.x };
    });

    expect(result.shortX).toBeCloseTo(11, 1); // arrived already
    expect(result.longX).toBeGreaterThan(0);
    expect(result.longX).toBeLessThan(40); // still travelling
  });

  test('Apply Arrows is disabled until the current frame has at least one line', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await expect(page.locator('#advanceFrameBtn')).toBeDisabled();

    await page.locator('.tool-btn[data-tool="cut"]').click();
    const start = await page.evaluate(() => {
      const canvas = document.querySelector('#courtCanvas');
      return courtFeetToClientPoint(canvas, tokens[0].x, tokens[0].y);
    });
    const target = await page.evaluate(() => {
      const canvas = document.querySelector('#courtCanvas');
      return courtFeetToClientPoint(canvas, 30, 20);
    });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 5 });
    await page.mouse.up();

    await expect(page.locator('#advanceFrameBtn')).toBeEnabled();
  });

  test('Apply Arrows creates a new frame with the origin token moved to its cut/dribble arrow endpoint', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);

    await page.locator('.tool-btn[data-tool="cut"]').click();
    const start = await page.evaluate(() => {
      const canvas = document.querySelector('#courtCanvas');
      return courtFeetToClientPoint(canvas, tokens[0].x, tokens[0].y);
    });
    const target = await page.evaluate(() => {
      const canvas = document.querySelector('#courtCanvas');
      return courtFeetToClientPoint(canvas, 30, 20);
    });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 5 });
    await page.mouse.up();

    await page.click('#advanceFrameBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 2 of 2');

    const state = await page.evaluate(() => ({
      pos: { x: tokens[0].x, y: tokens[0].y },
      lineCount: lines.length,
    }));
    expect(state.pos.x).toBeCloseTo(30, 0);
    expect(state.pos.y).toBeCloseTo(20, 0);
    // The new frame starts blank, ready for the next step to be drawn.
    expect(state.lineCount).toBe(0);
  });

  test('Apply Arrows carries the ball along with a dribble line, so it is not left behind', async ({ page }) => {
    // Exercises advanceFrameByArrows directly (rather than drawing a real
    // line via the UI) because the player and ball start at the exact
    // same point here, and clicking to start a drag would grab whichever
    // token is last in the array — a separate hit-testing detail, not
    // what this test is about.
    await page.goto('/');
    const result = await page.evaluate(() => {
      const frame = {
        tokens: [
          { id: 'player', type: 'offense', label: '1', x: 10, y: 30 },
          { id: 'ball', type: 'ball', x: 10, y: 30 }, // in the dribbler's hands
        ],
        lines: [
          { id: 'l1', type: 'dribble', originTokenId: 'player', endTokenId: null, endPoint: { x: 30, y: 20 } },
        ],
      };
      const advanced = advanceFrameByArrows(frame);
      const player = advanced.tokens.find(t => t.id === 'player');
      const ball = advanced.tokens.find(t => t.id === 'ball');
      return { player: { x: player.x, y: player.y }, ball: { x: ball.x, y: ball.y } };
    });
    expect(result.player.x).toBeCloseTo(30, 0);
    expect(result.player.y).toBeCloseTo(20, 0);
    expect(result.ball.x).toBeCloseTo(30, 0);
    expect(result.ball.y).toBeCloseTo(20, 0);
  });

  test('Apply Arrows moves the ball (not the passer) along a pass line', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30); // passer
    await spawnTokenAt(page, 'offense', 30, 20); // receiver
    await spawnTokenAt(page, 'ball', 10, 30); // ball starts with the passer

    await page.locator('.tool-btn[data-tool="pass"]').click();
    const start = await page.evaluate(() => {
      const canvas = document.querySelector('#courtCanvas');
      return courtFeetToClientPoint(canvas, tokens[0].x, tokens[0].y);
    });
    const target = await page.evaluate(() => {
      const canvas = document.querySelector('#courtCanvas');
      return courtFeetToClientPoint(canvas, tokens[1].x, tokens[1].y);
    });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 5 });
    await page.mouse.up();

    await page.click('#advanceFrameBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 2 of 2');

    const state = await page.evaluate(() => {
      const ball = tokens.find(t => t.type === 'ball');
      const passer = tokens.find(t => t.label === '1');
      return { ball: { x: ball.x, y: ball.y }, passer: { x: passer.x, y: passer.y } };
    });
    // The ball moved to the receiver's spot; the passer stayed put.
    expect(state.ball.x).toBeCloseTo(30, 0);
    expect(state.ball.y).toBeCloseTo(20, 0);
    expect(state.passer.x).toBeCloseTo(10, 0);
    expect(state.passer.y).toBeCloseTo(30, 0);
  });
});

test.describe('Frames sidebar tab — thumbnail previews', () => {
  test.use({ viewport: { width: 900, height: 1000 } });

  test('switching to the Frames tab lists one thumbnail per frame, highlighting the current one', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.click('#addFrameBtn');
    await spawnTokenAt(page, 'defense', 20, 25);
    await page.click('#addFrameBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 3 of 3');

    await page.click('#framesTabBtn');
    const thumbs = page.locator('#framesList .frame-thumb');
    await expect(thumbs).toHaveCount(3);
    // Each thumbnail draws its own <canvas>, one per frame.
    await expect(page.locator('#framesList .frame-thumb-canvas')).toHaveCount(3);
    await expect(thumbs.nth(2)).toHaveClass(/current/);
    await expect(thumbs.nth(0)).not.toHaveClass(/current/);
    await expect(thumbs.nth(2).locator('.frame-thumb-label')).toHaveText('Frame 3');
  });

  test('clicking a thumbnail jumps to that frame', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.click('#addFrameBtn');
    await spawnTokenAt(page, 'defense', 20, 25);

    await page.click('#framesTabBtn');
    await page.locator('#framesList .frame-thumb').nth(0).click();

    await expect(page.locator('#frameLabel')).toHaveText('Frame 1 of 2');
    await expect(page.locator('#framesList .frame-thumb').nth(0)).toHaveClass(/current/);
    await expect(page.locator('#framesList .frame-thumb').nth(1)).not.toHaveClass(/current/);
  });

  test('clicking a thumbnail\'s duplicate button inserts a copy right after it', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.click('#addFrameBtn');
    await spawnTokenAt(page, 'defense', 20, 25);
    // Now on frame 2 of 2; go back to frame 1 so we can verify duplicating
    // a *non-current* frame doesn't disturb the currently active one.
    await page.click('#prevFrameBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 1 of 2');

    await page.click('#framesTabBtn');
    await page.locator('#framesList .frame-thumb').nth(1).locator('.frame-thumb-duplicate-btn').click();

    await expect(page.locator('#framesList .frame-thumb')).toHaveCount(3);
    // Frame 1 is still the active/current frame, just shifted by nothing
    // (the duplicate landed after it, at index 2).
    await expect(page.locator('#frameLabel')).toHaveText('Frame 1 of 3');
    await expect(page.locator('#framesList .frame-thumb').nth(0)).toHaveClass(/current/);
    // The duplicated frame (originally frame 2's defense token) carried
    // over into the new frame 3.
    const frame3Tokens = await page.evaluate(() => frames[2].tokens.length);
    expect(frame3Tokens).toBe(2);
  });

  test('duplicating the current frame keeps it selected and inserts the copy after it', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.click('#framesTabBtn');
    await page.locator('#framesList .frame-thumb').nth(0).locator('.frame-thumb-duplicate-btn').click();

    await expect(page.locator('#framesList .frame-thumb')).toHaveCount(2);
    await expect(page.locator('#frameLabel')).toHaveText('Frame 1 of 2');
    await expect(page.locator('#framesList .frame-thumb').nth(0)).toHaveClass(/current/);
    const frame2Tokens = await page.evaluate(() => frames[1].tokens.length);
    expect(frame2Tokens).toBe(1);
  });

  test('clicking a thumbnail\'s delete button removes a non-current frame, shifting the current index down if needed', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.click('#addFrameBtn');
    await spawnTokenAt(page, 'defense', 20, 25);
    await expect(page.locator('#frameLabel')).toHaveText('Frame 2 of 2');

    await page.click('#framesTabBtn');
    await page.locator('#framesList .frame-thumb').nth(0).locator('.frame-thumb-delete-btn').click();

    await expect(page.locator('#framesList .frame-thumb')).toHaveCount(1);
    // Frame 2 is now frame 1, and stays the current frame — its own
    // tokens/edits were never touched by deleting the other frame. It
    // was duplicated from frame 1 by addFrameBtn, so it carries both the
    // offense token and the defense token spawned onto it.
    await expect(page.locator('#frameLabel')).toHaveText('Frame 1 of 1');
    const tokenCount = await page.evaluate(() => tokens.length);
    expect(tokenCount).toBe(2);
  });

  test('clicking a thumbnail\'s delete button on the current frame switches to a neighboring frame', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.click('#addFrameBtn');
    await spawnTokenAt(page, 'defense', 20, 25);
    await expect(page.locator('#frameLabel')).toHaveText('Frame 2 of 2');

    await page.click('#framesTabBtn');
    await page.locator('#framesList .frame-thumb').nth(1).locator('.frame-thumb-delete-btn').click();

    await expect(page.locator('#framesList .frame-thumb')).toHaveCount(1);
    await expect(page.locator('#frameLabel')).toHaveText('Frame 1 of 1');
    const tokenCount = await page.evaluate(() => tokens.length);
    expect(tokenCount).toBe(1); // back to frame 1's offense-only token
  });

  test('the delete button is disabled when only one frame remains', async ({ page }) => {
    await page.goto('/');
    await page.click('#framesTabBtn');
    await expect(page.locator('#framesList .frame-thumb-delete-btn')).toBeDisabled();
  });

  test('drawing a line on the current frame refreshes its thumbnail without switching tabs', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.click('#framesTabBtn');

    const before = await page.locator('#framesList .frame-thumb-canvas').nth(0).evaluate(c => c.toDataURL());

    await page.click('.tool-btn[data-tool="cut"]');
    const start = await page.evaluate(() => {
      const canvas = document.querySelector('#courtCanvas');
      return courtFeetToClientPoint(canvas, tokens[0].x, tokens[0].y);
    });
    const target = await page.evaluate(() => {
      const canvas = document.querySelector('#courtCanvas');
      return courtFeetToClientPoint(canvas, 30, 20);
    });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => lines.length)).toBe(1);

    const after = await page.locator('#framesList .frame-thumb-canvas').nth(0).evaluate(c => c.toDataURL());
    expect(after).not.toBe(before);
  });

  test('moving, spawning, or removing a token refreshes the current frame thumbnail too', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.click('#framesTabBtn');

    const afterSpawn = await page.locator('#framesList .frame-thumb-canvas').nth(0).evaluate(c => c.toDataURL());

    // Drag the existing token to a new spot.
    const from = await page.evaluate(() => {
      const canvas = document.querySelector('#courtCanvas');
      return courtFeetToClientPoint(canvas, tokens[0].x, tokens[0].y);
    });
    const to = await page.evaluate(() => {
      const canvas = document.querySelector('#courtCanvas');
      return courtFeetToClientPoint(canvas, 25, 15);
    });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => tokens[0].x)).toBeCloseTo(25, 0);

    const afterMove = await page.locator('#framesList .frame-thumb-canvas').nth(0).evaluate(c => c.toDataURL());
    expect(afterMove).not.toBe(afterSpawn);

    // Remove it via double-click.
    const point = await page.evaluate(() => {
      const canvas = document.querySelector('#courtCanvas');
      return courtFeetToClientPoint(canvas, tokens[0].x, tokens[0].y);
    });
    await page.mouse.dblclick(point.x, point.y);
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(0);

    const afterRemove = await page.locator('#framesList .frame-thumb-canvas').nth(0).evaluate(c => c.toDataURL());
    expect(afterRemove).not.toBe(afterMove);
  });
});
