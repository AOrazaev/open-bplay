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

  test('Play animates through the sequence and returns to the starting frame', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.click('#addFrameBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 2 of 2');

    await page.click('#playFramesBtn');
    await expect(page.locator('#playFramesBtn')).toHaveText('■ Stop');
    // Buttons that would interfere with playback are disabled while it runs.
    await expect(page.locator('#addFrameBtn')).toBeDisabled();

    // Playback runs two ~700ms transitions (frame 1 -> 2 -> back is not
    // looped; it's a single forward pass) — wait for it to finish on its
    // own rather than clicking Stop, to also verify auto-completion.
    await expect(page.locator('#playFramesBtn')).toHaveText('▶ Play', { timeout: 3000 });
    await expect(page.locator('#frameLabel')).toHaveText('Frame 2 of 2');
    await expect(page.locator('#addFrameBtn')).toBeEnabled();
  });
});
