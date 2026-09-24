const { test, expect } = require('@playwright/test');

async function toClientPoint(page, xFt, yFt) {
  return page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('#courtCanvas');
    return courtFeetToClientPoint(canvas, x, y);
  }, { x: xFt, y: yFt });
}

// Drags out a freehand stroke on the court from (x1,y1) to (x2,y2),
// passing through a midpoint so it's a real multi-point path rather than
// a single click.
async function dragHighlightStroke(page, x1, y1, x2, y2) {
  const start = await toClientPoint(page, x1, y1);
  const mid = await toClientPoint(page, (x1 + x2) / 2, (y1 + y2) / 2);
  const end = await toClientPoint(page, x2, y2);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(mid.x, mid.y, { steps: 5 });
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
}

test.describe('Freehand court highlighter', () => {
  test.use({ viewport: { width: 900, height: 1000 } });

  test('selecting the Highlight tool and dragging on the court creates a stroke with multiple points', async ({ page }) => {
    await page.goto('/');
    await page.locator('.tool-btn[data-tool="highlight"]').click();
    await expect(page.locator('.tool-btn[data-tool="highlight"]')).toHaveClass(/active/);

    await dragHighlightStroke(page, 10, 20, 30, 20);

    const strokeCount = await page.evaluate(() => highlights.length);
    expect(strokeCount).toBe(1);
    const pointCount = await page.evaluate(() => highlights[0].points.length);
    expect(pointCount).toBeGreaterThanOrEqual(2);

    // The highlight tool stays active (unlike a line tool) so multiple
    // strokes can be drawn in a row without reselecting it each time.
    await expect(page.locator('.tool-btn[data-tool="highlight"]')).toHaveClass(/active/);
  });

  test('double-clicking a highlight stroke removes it', async ({ page }) => {
    await page.goto('/');
    await page.locator('.tool-btn[data-tool="highlight"]').click();
    await dragHighlightStroke(page, 10, 20, 30, 20);
    await expect.poll(() => page.evaluate(() => highlights.length)).toBe(1);

    // Deselect the tool so the dblclick hits the delete path, not another draw.
    await page.locator('.tool-btn[data-tool="highlight"]').click();
    const mid = await toClientPoint(page, 20, 20);
    await page.mouse.dblclick(mid.x, mid.y);

    await expect.poll(() => page.evaluate(() => highlights.length)).toBe(0);
  });

  test('a highlight persists through Add Frame duplication and is cleared by Apply Arrows', async ({ page }) => {
    await page.goto('/');
    await page.locator('.tool-btn[data-tool="highlight"]').click();
    await dragHighlightStroke(page, 10, 20, 30, 20);
    await page.locator('.tool-btn[data-tool="highlight"]').click(); // deselect

    await page.click('#addFrameBtn');
    await expect.poll(() => page.evaluate(() => highlights.length)).toBe(1);

    const advanced = await page.evaluate(() => {
      const frame = { tokens: [], lines: [], highlights };
      return advanceFrameByArrows(frame).highlights.length;
    });
    expect(advanced).toBe(0);
  });

  test('a highlight is saved and restored when the play is reloaded from the library', async ({ page }) => {
    await page.goto('/');
    await page.locator('.tool-btn[data-tool="highlight"]').click();
    await dragHighlightStroke(page, 10, 20, 30, 20);

    await page.fill('#playNameInput', 'Highlight Test');
    await page.click('#savePlayBtn');
    await page.reload();

    await page.click('#clearCourt');
    await expect.poll(() => page.evaluate(() => highlights.length)).toBe(0);

    await page.locator('.play-name', { hasText: 'Highlight Test' }).click();
    await expect.poll(() => page.evaluate(() => highlights.length)).toBe(1);
  });
});
