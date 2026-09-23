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

// Drags from the current position of a token to a court point, using
// whichever tool (if any) is currently active in the palette.
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

test.describe('Checkpoint 3 — draw movement lines', () => {
  test.use({ viewport: { width: 900, height: 1000 } });

  test('selecting a tool and dragging from a token to another token creates an attached line', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await spawnTokenAt(page, 'offense', 30, 20);

    await page.locator('.tool-btn[data-tool="cut"]').click();
    await expect(page.locator('.tool-btn[data-tool="cut"]')).toHaveClass(/active/);

    await dragFromTokenTo(page, 0, 30, 20); // drag onto the second token's position

    const line = await page.evaluate(() => lines[0]);
    expect(line.type).toBe('cut');
    expect(line.endTokenId).toBe(await page.evaluate(() => tokens[1].id));

    // Moving the origin token should move the line with it (endpoints are
    // resolved live from token positions, not baked in at creation time).
    // The tool auto-deselects after a successful draw, so this next drag
    // is already back in move mode.
    await expect(page.locator('.tool-btn[data-tool="cut"]')).not.toHaveClass(/active/);
    await dragFromTokenTo(page, 0, 15, 25);
    const originPos = await page.evaluate(() => ({ x: tokens[0].x, y: tokens[0].y }));
    expect(originPos.x).toBeCloseTo(15, 0);
    expect(originPos.y).toBeCloseTo(25, 0);
  });

  test('dragging to empty court space creates a line ending at that free point', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.locator('.tool-btn[data-tool="pass"]').click();

    await dragFromTokenTo(page, 0, 35, 15);

    const line = await page.evaluate(() => lines[0]);
    expect(line.type).toBe('pass');
    expect(line.endTokenId).toBeNull();
    expect(line.endPoint.x).toBeCloseTo(35, 0);
    expect(line.endPoint.y).toBeCloseTo(15, 0);
  });

  test('screen and dribble tools create lines of the matching type', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await spawnTokenAt(page, 'offense', 40, 10);

    await page.locator('.tool-btn[data-tool="screen"]').click();
    await dragFromTokenTo(page, 0, 40, 10);
    // Tool auto-deselects after a successful draw, so no toggle-off click
    // is needed before selecting the next tool.

    await page.locator('.tool-btn[data-tool="dribble"]').click();
    await dragFromTokenTo(page, 1, 20, 35);

    const types = await page.evaluate(() => lines.map(l => l.type));
    expect(types).toEqual(['screen', 'dribble']);
  });

  test('the tool auto-deselects after drawing a line, preventing an accidental second line', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await spawnTokenAt(page, 'offense', 30, 10);

    await page.locator('.tool-btn[data-tool="pass"]').click();
    await dragFromTokenTo(page, 0, 30, 10);
    await expect.poll(() => page.evaluate(() => lines.length)).toBe(1);
    await expect(page.locator('.tool-btn[data-tool="pass"]')).not.toHaveClass(/active/);

    // With no tool active, dragging the same token now just moves it
    // instead of drawing a second line.
    await dragFromTokenTo(page, 0, 20, 20);
    const lineCount = await page.evaluate(() => lines.length);
    const tokenPos = await page.evaluate(() => ({ x: tokens[0].x, y: tokens[0].y }));
    expect(lineCount).toBe(1);
    expect(tokenPos.x).toBeCloseTo(20, 0);
    expect(tokenPos.y).toBeCloseTo(20, 0);
  });

  test('clicking the active tool again returns to move mode', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);

    await page.locator('.tool-btn[data-tool="cut"]').click();
    await page.locator('.tool-btn[data-tool="cut"]').click();
    await expect(page.locator('.tool-btn[data-tool="cut"]')).not.toHaveClass(/active/);

    await dragFromTokenTo(page, 0, 25, 20);

    const lineCount = await page.evaluate(() => lines.length);
    const tokenPos = await page.evaluate(() => ({ x: tokens[0].x, y: tokens[0].y }));
    expect(lineCount).toBe(0);
    expect(tokenPos.x).toBeCloseTo(25, 0);
    expect(tokenPos.y).toBeCloseTo(20, 0);
  });

  test('double-clicking a line removes it', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.locator('.tool-btn[data-tool="cut"]').click();
    await dragFromTokenTo(page, 0, 35, 15);
    await expect.poll(() => page.evaluate(() => lines.length)).toBe(1);

    // Double-click the midpoint of the line (not on the token itself).
    const midFt = await page.evaluate(() => ({
      x: (tokens[0].x + lines[0].endPoint.x) / 2,
      y: (tokens[0].y + lines[0].endPoint.y) / 2,
    }));
    const midPoint = await toClientPoint(page, midFt.x, midFt.y);
    await page.mouse.dblclick(midPoint.x, midPoint.y);

    const lineCount = await page.evaluate(() => lines.length);
    expect(lineCount).toBe(0);
  });

  test('removing a token cascades to delete lines attached to it', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await spawnTokenAt(page, 'offense', 30, 10);
    await page.locator('.tool-btn[data-tool="cut"]').click();
    await dragFromTokenTo(page, 0, 30, 10);
    await expect.poll(() => page.evaluate(() => lines.length)).toBe(1);
    // Tool auto-deselects after the draw above, so we're already back in
    // move mode for the double-click below.

    const point = await page.evaluate(() => {
      const canvas = document.querySelector('#courtCanvas');
      return courtFeetToClientPoint(canvas, tokens[0].x, tokens[0].y);
    });
    await page.mouse.dblclick(point.x, point.y);

    const lineCount = await page.evaluate(() => lines.length);
    expect(lineCount).toBe(0);
  });

  test('dribble squiggle path always starts and ends exactly on its endpoints', async ({ page }) => {
    await page.goto('/');
    // Try lengths that are and aren't clean multiples of the wavelength, to
    // regression-test the taper that keeps the wavy path pinned to its
    // start/end points instead of drifting past them (and leaving the
    // arrowhead detached/misrotated at the tip).
    const results = await page.evaluate(() => {
      const start = { x: 5, y: 5 };
      return [7, 10, 13.5, 22].map(length => {
        const end = { x: start.x + length, y: start.y };
        const path = squigglePoints(start, end);
        return {
          length,
          first: path[0],
          last: path[path.length - 1],
        };
      });
    });

    results.forEach(({ first, last, length }) => {
      expect(first.x).toBeCloseTo(5, 6);
      expect(first.y).toBeCloseTo(5, 6);
      expect(last.x).toBeCloseTo(5 + length, 6);
      expect(last.y).toBeCloseTo(5, 6);
    });
  });
});
