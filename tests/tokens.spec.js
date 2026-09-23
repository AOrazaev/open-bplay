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

test.describe('Checkpoint 2 — tray-driven place & drag tokens', () => {
  test.use({ viewport: { width: 900, height: 1000 } });

  test('spawning offense/defense/ball tokens from the tray is capped correctly', async ({ page }) => {
    await page.goto('/');

    for (let i = 0; i < 5; i++) await spawnTokenAt(page, 'offense', 5 + i * 8, 30);
    for (let i = 0; i < 5; i++) await spawnTokenAt(page, 'defense', 5 + i * 8, 35);
    await spawnTokenAt(page, 'ball', 25, 10);
    // Extra drops past the cap should be no-ops.
    await spawnTokenAt(page, 'offense', 25, 20);
    await spawnTokenAt(page, 'defense', 25, 20);
    await spawnTokenAt(page, 'ball', 25, 12);

    const counts = await page.evaluate(() => ({
      offense: tokens.filter(t => t.type === TOKEN_TYPES.OFFENSE).length,
      defense: tokens.filter(t => t.type === TOKEN_TYPES.DEFENSE).length,
      ball: tokens.filter(t => t.type === TOKEN_TYPES.BALL).length,
    }));

    expect(counts.offense).toBe(5);
    expect(counts.defense).toBe(5);
    expect(counts.ball).toBe(1);
    await expect(page.locator('.tray-chip[data-type="offense"]')).toHaveClass(/disabled/);
    await expect(page.locator('.tray-chip[data-type="defense"]')).toHaveClass(/disabled/);
    await expect(page.locator('.tray-chip[data-type="ball"]')).toHaveClass(/disabled/);
  });

  test('offense tokens are labeled 1-5 in spawn order', async ({ page }) => {
    await page.goto('/');
    for (let i = 0; i < 5; i++) await spawnTokenAt(page, 'offense', 5 + i * 8, 30);
    const labels = await page.evaluate(() => tokens.filter(t => t.type === TOKEN_TYPES.OFFENSE).map(t => t.label));
    expect(labels).toEqual(['1', '2', '3', '4', '5']);
  });

  test('dropping a tray chip outside the court does not spawn a token', async ({ page }) => {
    await page.goto('/');
    const chipBox = await page.locator('.tray-chip[data-type="offense"]').boundingBox();
    await page.mouse.move(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
    await page.mouse.down();
    // Release back over the tray itself — well outside the court bounds.
    await page.mouse.move(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2, { steps: 3 });
    await page.mouse.up();

    const count = await page.evaluate(() => tokens.length);
    expect(count).toBe(0);
  });

  test('dragging an existing token moves it to the drop location', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);

    const before = await page.evaluate(() => ({ x: tokens[0].x, y: tokens[0].y }));
    const startPoint = await page.evaluate(({ x, y }) => {
      const canvas = document.querySelector('#courtCanvas');
      return courtFeetToClientPoint(canvas, x, y);
    }, before);

    const targetFt = { x: 30, y: 20 };
    const targetPoint = await page.evaluate(({ x, y }) => {
      const canvas = document.querySelector('#courtCanvas');
      return courtFeetToClientPoint(canvas, x, y);
    }, targetFt);

    await page.mouse.move(startPoint.x, startPoint.y);
    await page.mouse.down();
    await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 5 });
    await page.mouse.up();

    const after = await page.evaluate(() => ({ x: tokens[0].x, y: tokens[0].y }));
    expect(after.x).toBeCloseTo(targetFt.x, 0);
    expect(after.y).toBeCloseTo(targetFt.y, 0);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(5);
  });

  test('dragging a token outside the court removes it', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(1);

    const startPoint = await page.evaluate(() => {
      const canvas = document.querySelector('#courtCanvas');
      return courtFeetToClientPoint(canvas, tokens[0].x, tokens[0].y);
    });
    // Drag far outside the court (negative feet coordinates) and release there.
    const outsidePoint = await page.evaluate(() => {
      const canvas = document.querySelector('#courtCanvas');
      return courtFeetToClientPoint(canvas, -20, -20);
    });

    await page.mouse.move(startPoint.x, startPoint.y);
    await page.mouse.down();
    await page.mouse.move(outsidePoint.x, outsidePoint.y, { steps: 5 });
    await page.mouse.up();

    const count = await page.evaluate(() => tokens.length);
    expect(count).toBe(0);
  });

  test('double-clicking a token removes it', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 25, 30);
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(1);

    const point = await page.evaluate(() => {
      const canvas = document.querySelector('#courtCanvas');
      return courtFeetToClientPoint(canvas, tokens[0].x, tokens[0].y);
    });
    await page.mouse.dblclick(point.x, point.y);

    const count = await page.evaluate(() => tokens.length);
    expect(count).toBe(0);
  });

  test('clear button removes all tokens and re-enables tray chips', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await spawnTokenAt(page, 'defense', 20, 30);
    await spawnTokenAt(page, 'ball', 25, 10);

    await page.locator('#clearCourt').click();

    const count = await page.evaluate(() => tokens.length);
    expect(count).toBe(0);
    await expect(page.locator('.tray-chip[data-type="offense"]')).not.toHaveClass(/disabled/);
    await expect(page.locator('.tray-chip[data-type="defense"]')).not.toHaveClass(/disabled/);
    await expect(page.locator('.tray-chip[data-type="ball"]')).not.toHaveClass(/disabled/);
  });
});
