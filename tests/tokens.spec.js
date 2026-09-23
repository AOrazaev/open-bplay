const { test, expect } = require('@playwright/test');

test.describe('Checkpoint 2 — place & drag tokens', () => {
  test.use({ viewport: { width: 900, height: 1000 } });

  test('adding offense/defense/ball tokens is capped correctly', async ({ page }) => {
    await page.goto('/');

    for (let i = 0; i < 5; i++) await page.locator('#addOffense').click();
    for (let i = 0; i < 5; i++) await page.locator('#addDefense').click();
    await page.locator('#addBall').click();
    // Buttons are disabled once at their cap; force an extra click past the
    // disabled state to confirm the underlying click handler is also a
    // no-op (defense in depth, not just a UI affordance).
    await page.locator('#addOffense').click({ force: true });
    await page.locator('#addDefense').click({ force: true });
    await page.locator('#addBall').click({ force: true });

    const counts = await page.evaluate(() => ({
      offense: tokens.filter(t => t.type === TOKEN_TYPES.OFFENSE).length,
      defense: tokens.filter(t => t.type === TOKEN_TYPES.DEFENSE).length,
      ball: tokens.filter(t => t.type === TOKEN_TYPES.BALL).length,
    }));

    expect(counts.offense).toBe(5);
    expect(counts.defense).toBe(5);
    expect(counts.ball).toBe(1);
    await expect(page.locator('#addOffense')).toBeDisabled();
    await expect(page.locator('#addDefense')).toBeDisabled();
    await expect(page.locator('#addBall')).toBeDisabled();
  });

  test('offense tokens are labeled 1-5 in add order', async ({ page }) => {
    await page.goto('/');
    for (let i = 0; i < 5; i++) await page.locator('#addOffense').click();
    const labels = await page.evaluate(() => tokens.filter(t => t.type === TOKEN_TYPES.OFFENSE).map(t => t.label));
    expect(labels).toEqual(['1', '2', '3', '4', '5']);
  });

  test('dragging a token moves it to the drop location', async ({ page }) => {
    await page.goto('/');
    await page.locator('#addOffense').click();

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

  test('dragging clamps a token to stay within the court bounds', async ({ page }) => {
    await page.goto('/');
    await page.locator('#addOffense').click();

    const startPoint = await page.evaluate(() => {
      const canvas = document.querySelector('#courtCanvas');
      return courtFeetToClientPoint(canvas, tokens[0].x, tokens[0].y);
    });
    // Try to drag far outside the court (negative feet coordinates).
    const outsidePoint = await page.evaluate(() => {
      const canvas = document.querySelector('#courtCanvas');
      return courtFeetToClientPoint(canvas, -20, -20);
    });

    await page.mouse.move(startPoint.x, startPoint.y);
    await page.mouse.down();
    await page.mouse.move(outsidePoint.x, outsidePoint.y, { steps: 5 });
    await page.mouse.up();

    const after = await page.evaluate(() => ({ x: tokens[0].x, y: tokens[0].y }));
    expect(after.x).toBeGreaterThanOrEqual(0);
    expect(after.y).toBeGreaterThanOrEqual(0);
  });

  test('double-clicking a token removes it', async ({ page }) => {
    await page.goto('/');
    await page.locator('#addOffense').click();
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(1);

    const point = await page.evaluate(() => {
      const canvas = document.querySelector('#courtCanvas');
      return courtFeetToClientPoint(canvas, tokens[0].x, tokens[0].y);
    });
    await page.mouse.dblclick(point.x, point.y);

    const count = await page.evaluate(() => tokens.length);
    expect(count).toBe(0);
  });

  test('clear button removes all tokens and re-enables add buttons', async ({ page }) => {
    await page.goto('/');
    await page.locator('#addOffense').click();
    await page.locator('#addDefense').click();
    await page.locator('#addBall').click();

    await page.locator('#clearCourt').click();

    const count = await page.evaluate(() => tokens.length);
    expect(count).toBe(0);
    await expect(page.locator('#addOffense')).toBeEnabled();
    await expect(page.locator('#addDefense')).toBeEnabled();
    await expect(page.locator('#addBall')).toBeEnabled();
  });
});
