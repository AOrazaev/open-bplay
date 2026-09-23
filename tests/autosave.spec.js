const { test, expect } = require('@playwright/test');

// Drags a chip from the tray onto a court point (feet coordinates) to spawn
// a token there, mirroring how a real user would drag-and-drop.
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

test.describe('Court autosave — in-progress work survives a reload', () => {
  test.use({ viewport: { width: 900, height: 1000 } });

  test('tokens placed on the court are still there after a reload', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await spawnTokenAt(page, 'defense', 15, 30);
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(2);

    await page.reload();

    const counts = await page.evaluate(() => ({
      offense: tokens.filter(t => t.type === TOKEN_TYPES.OFFENSE).length,
      defense: tokens.filter(t => t.type === TOKEN_TYPES.DEFENSE).length,
    }));
    expect(counts).toEqual({ offense: 1, defense: 1 });
  });

  test('clearing the court persists the empty state across a reload', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(1);

    await page.click('#clearCourt');
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(0);

    await page.reload();
    const tokenCount = await page.evaluate(() => tokens.length);
    expect(tokenCount).toBe(0);
  });

  test('loading a saved play updates the autosave to match, not the previous court', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.fill('#playNameInput', 'Autosave Check');
    await page.click('#savePlayBtn');

    await spawnTokenAt(page, 'defense', 20, 20);
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(2);

    await page.locator('.play-name', { hasText: 'Autosave Check' }).click();
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(1);

    await page.reload();
    const tokenCount = await page.evaluate(() => tokens.length);
    expect(tokenCount).toBe(1);
  });
});
