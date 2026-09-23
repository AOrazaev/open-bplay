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

async function toClientPoint(page, xFt, yFt) {
  return page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('#courtCanvas');
    return courtFeetToClientPoint(canvas, x, y);
  }, { x: xFt, y: yFt });
}

async function dragFromTokenTo(page, tokenIndex, xFt, yFt) {
  const start = await page.evaluate((i) => {
    const canvas = document.querySelector('#courtCanvas');
    return courtFeetToClientPoint(canvas, tokens[i].x, tokens[i].y);
  }, tokenIndex);
  const target = await toClientPoint(page, xFt, yFt);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 5 });
  await page.mouse.up();
}

test.describe('Checkpoint 4 — save/load plays (localStorage)', () => {
  test.use({ viewport: { width: 900, height: 1000 } });

  test('saving a play adds it to the list, and it is the only option available to load', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await spawnTokenAt(page, 'offense', 30, 20);

    await page.fill('#playNameInput', 'Horns Set');
    await page.click('#savePlayBtn');

    const options = await page.locator('#savedPlaysSelect option').allTextContents();
    expect(options).toEqual(['Horns Set']);
    await expect(page.locator('#loadPlayBtn')).toBeEnabled();
    await expect(page.locator('#deletePlayBtn')).toBeEnabled();
  });

  test('loading a saved play restores its tokens and lines, replacing the current court', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await spawnTokenAt(page, 'offense', 30, 20);
    await page.locator('.tool-btn[data-tool="pass"]').click();
    await dragFromTokenTo(page, 0, 30, 20); // pass from token 0 to token 1 (attaches)
    await expect.poll(() => page.evaluate(() => lines.length)).toBe(1);

    await page.fill('#playNameInput', 'Two Man Game');
    await page.click('#savePlayBtn');

    // Clear the court, then load the saved play back.
    await page.click('#clearCourt');
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(0);
    await expect.poll(() => page.evaluate(() => lines.length)).toBe(0);

    await page.selectOption('#savedPlaysSelect', { label: 'Two Man Game' });
    await page.click('#loadPlayBtn');

    const restored = await page.evaluate(() => ({
      tokenCount: tokens.length,
      lineCount: lines.length,
      lineAttached: lines[0] && lines[0].endTokenId != null,
    }));
    expect(restored.tokenCount).toBe(2);
    expect(restored.lineCount).toBe(1);
    expect(restored.lineAttached).toBe(true);
    // The name field should reflect what was just loaded, so re-saving
    // updates the same play instead of prompting for a new name.
    await expect(page.locator('#playNameInput')).toHaveValue('Two Man Game');
  });

  test('saving again under the same name overwrites the play instead of duplicating it', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.fill('#playNameInput', 'Iso');
    await page.click('#savePlayBtn');

    await spawnTokenAt(page, 'offense', 20, 20);
    await page.fill('#playNameInput', 'Iso');
    await page.click('#savePlayBtn');

    const options = await page.locator('#savedPlaysSelect option').allTextContents();
    expect(options).toEqual(['Iso']);
    const tokenCount = await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('play-drawing-saved-plays-v1'));
      return saved[0].tokens.length;
    });
    expect(tokenCount).toBe(2);
  });

  test('deleting a saved play removes it from the list and localStorage', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.fill('#playNameInput', 'Temp Play');
    await page.click('#savePlayBtn');
    await expect.poll(() => page.locator('#savedPlaysSelect option').count()).toBe(1);

    await page.selectOption('#savedPlaysSelect', { label: 'Temp Play' });
    await page.click('#deletePlayBtn');

    const options = await page.locator('#savedPlaysSelect option').allTextContents();
    expect(options).toEqual(['No saved plays']);
    await expect(page.locator('#loadPlayBtn')).toBeDisabled();
    await expect(page.locator('#deletePlayBtn')).toBeDisabled();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('play-drawing-saved-plays-v1')));
    expect(saved).toEqual([]);
  });

  test('saved plays persist across a page reload', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await spawnTokenAt(page, 'defense', 15, 30);
    await page.fill('#playNameInput', 'Reload Test');
    await page.click('#savePlayBtn');

    await page.reload();
    const options = await page.locator('#savedPlaysSelect option').allTextContents();
    expect(options).toEqual(['Reload Test']);

    await page.selectOption('#savedPlaysSelect', { label: 'Reload Test' });
    await page.click('#loadPlayBtn');
    const counts = await page.evaluate(() => ({
      offense: tokens.filter(t => t.type === TOKEN_TYPES.OFFENSE).length,
      defense: tokens.filter(t => t.type === TOKEN_TYPES.DEFENSE).length,
    }));
    expect(counts).toEqual({ offense: 1, defense: 1 });
  });
});
