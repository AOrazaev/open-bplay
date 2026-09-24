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

test.describe('Checkpoint 7 — undo/redo', () => {
  test.use({ viewport: { width: 900, height: 1000 } });

  test('Undo starts disabled, and becomes enabled after the first edit', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#undoBtn')).toBeDisabled();
    await expect(page.locator('#redoBtn')).toBeDisabled();

    await spawnTokenAt(page, 'offense', 10, 30);
    await expect(page.locator('#undoBtn')).toBeEnabled();
    await expect(page.locator('#redoBtn')).toBeDisabled();
  });

  test('Undo reverts a token spawn, and Redo brings it back', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(1);

    await page.click('#undoBtn');
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(0);
    await expect(page.locator('#undoBtn')).toBeDisabled();
    await expect(page.locator('#redoBtn')).toBeEnabled();

    await page.click('#redoBtn');
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(1);
    await expect(page.locator('#redoBtn')).toBeDisabled();
  });

  test('a new edit after Undo truncates the redo branch', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.click('#undoBtn');
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(0);

    await spawnTokenAt(page, 'defense', 15, 25);
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(1);
    await expect(page.locator('#redoBtn')).toBeDisabled();

    await page.click('#undoBtn');
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(0);
    // Redo should land on the *second* spawn (defense), not the truncated
    // first one (offense).
    await page.click('#redoBtn');
    const type = await page.evaluate(() => tokens[0].type);
    expect(type).toBe('defense');
  });

  test('Undo/Redo cover frame-level edits: Add Frame and Delete Frame', async ({ page }) => {
    await page.goto('/');
    await page.click('#addFrameBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 2 of 2');

    await page.click('#undoBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 1 of 1');

    await page.click('#redoBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 2 of 2');

    await page.click('#deleteFrameBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 1 of 1');

    await page.click('#undoBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 2 of 2');
  });

  test('pure frame navigation (Prev/Next/thumbnail click) is not undoable', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.click('#addFrameBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 2 of 2');

    await page.click('#prevFrameBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 1 of 2');
    // The last recorded history entry is still "Add Frame" — Undo should
    // undo *that*, not the navigation, taking us back to a single frame.
    await page.click('#undoBtn');
    await expect(page.locator('#frameLabel')).toHaveText('Frame 1 of 1');
    // The token spawned before Add Frame was pressed is unaffected —
    // only the frame-add itself was undone.
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(1);
  });

  test('Ctrl+Z / Ctrl+Y keyboard shortcuts trigger undo/redo, but not while a text input is focused', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(1);

    await page.keyboard.press('Control+z');
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(0);

    await page.keyboard.press('Control+y');
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(1);

    // Typing "z"/"y" (even with Ctrl) while the play-name field is
    // focused must not trigger undo/redo.
    await page.click('#playNameInput');
    await page.keyboard.press('Control+z');
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(1);
  });

  test('loading a different play resets history, so Undo cannot reach into the previous play', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.fill('#playNameInput', 'Play A');
    await page.click('#savePlayBtn');

    await page.click('#clearCourt');
    await spawnTokenAt(page, 'defense', 15, 25);
    await page.fill('#playNameInput', 'Play B');
    await page.click('#savePlayBtn');

    await expect(page.locator('#undoBtn')).toBeEnabled();
    await page.click('.play-name:has-text("Play A")');
    await expect.poll(() => page.evaluate(() => tokens[0]?.type)).toBe('offense');
    await expect(page.locator('#undoBtn')).toBeDisabled();
  });
});
