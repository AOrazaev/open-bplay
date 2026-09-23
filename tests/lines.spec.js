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

  test('a curved dribble squiggle still starts and ends exactly on its endpoints', async ({ page }) => {
    await page.goto('/');
    const results = await page.evaluate(() => {
      const start = { x: 5, y: 5 };
      const end = { x: 25, y: 5 };
      return [
        { alongFt: 0, perpFt: 0 },
        { alongFt: 0, perpFt: 4 },
        { alongFt: 5, perpFt: -6 },
      ].map(curveHandle => {
        const handleFt = resolveHandlePointFt(start, end, curveHandle);
        const baseFt = catmullRomSamplePoints(start, handleFt, end, 40);
        const path = squiggleAlongBase(baseFt);
        return { curveHandle, first: path[0], last: path[path.length - 1] };
      });
    });

    results.forEach(({ first, last }) => {
      expect(first.x).toBeCloseTo(5, 6);
      expect(first.y).toBeCloseTo(5, 6);
      expect(last.x).toBeCloseTo(25, 6);
      expect(last.y).toBeCloseTo(5, 6);
    });
  });
});

test.describe('Checkpoint 3.1 — select, curve, and move drawn lines', () => {
  test.use({ viewport: { width: 900, height: 1000 } });

  test('clicking a line selects it, and clicking empty space deselects it', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.locator('.tool-btn[data-tool="pass"]').click();
    await dragFromTokenTo(page, 0, 35, 15);
    await expect.poll(() => page.evaluate(() => lines.length)).toBe(1);

    const midFt = { x: (10 + 35) / 2, y: (30 + 15) / 2 };
    const midPoint = await toClientPoint(page, midFt.x, midFt.y);
    await page.mouse.click(midPoint.x, midPoint.y);
    const lineId = await page.evaluate(() => lines[0].id);
    await expect.poll(() => page.evaluate(() => selectedLineId)).toBe(lineId);

    const emptyPoint = await toClientPoint(page, 2, 2);
    await page.mouse.click(emptyPoint.x, emptyPoint.y);
    await expect.poll(() => page.evaluate(() => selectedLineId)).toBeNull();
  });

  test('dragging a selected line\'s curve handle perpendicular bends it into a symmetric arch', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.locator('.tool-btn[data-tool="cut"]').click();
    await dragFromTokenTo(page, 0, 30, 30); // horizontal line, straight along x
    await expect.poll(() => page.evaluate(() => lines.length)).toBe(1);

    // Select the line by clicking its (currently straight) midpoint.
    const midPoint = await toClientPoint(page, 20, 30);
    await page.mouse.click(midPoint.x, midPoint.y);
    const lineId = await page.evaluate(() => lines[0].id);
    await expect.poll(() => page.evaluate(() => selectedLineId)).toBe(lineId);

    // Drag the curve handle (initially at the midpoint) 8ft further along
    // the court's y-axis — perpendicular to this horizontal line.
    const targetPoint = await toClientPoint(page, 20, 38);
    await page.mouse.move(midPoint.x, midPoint.y);
    await page.mouse.down();
    await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 5 });
    await page.mouse.up();

    const curveHandle = await page.evaluate(() => lines[0].curveHandle);
    expect(curveHandle.alongFt).toBeCloseTo(0, 0);
    expect(curveHandle.perpFt).toBeCloseTo(8, 0);

    // The visible curve must pass exactly through the dragged-to point,
    // since a Catmull-Rom spline interpolates its handle point exactly
    // (no "raw control point vs. on-curve point" translation needed).
    const handlePoint = await page.evaluate(() => {
      const line = lines[0];
      const pts = resolveLineEndpoints(line, tokens);
      return resolveHandlePointFt(pts.start, pts.end, line.curveHandle);
    });
    expect(handlePoint.x).toBeCloseTo(20, 5);
    expect(handlePoint.y).toBeCloseTo(38, 5);
  });

  test('dragging a selected line\'s curve handle along its axis bends it mostly near one end', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.locator('.tool-btn[data-tool="cut"]').click();
    await dragFromTokenTo(page, 0, 30, 30); // horizontal line, chord from x=10 to x=30
    await expect.poll(() => page.evaluate(() => lines.length)).toBe(1);

    const midPoint = await toClientPoint(page, 20, 30);
    await page.mouse.click(midPoint.x, midPoint.y);
    await expect.poll(() => page.evaluate(() => selectedLineId)).not.toBeNull();

    // Drag the handle to a point close to the start (x=12) and slightly
    // off-axis (y=32) — this should bend the curve mostly near the start,
    // leaving the rest close to straight, instead of a symmetric arch.
    const targetPoint = await toClientPoint(page, 12, 32);
    await page.mouse.move(midPoint.x, midPoint.y);
    await page.mouse.down();
    await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 5 });
    await page.mouse.up();

    const curveHandle = await page.evaluate(() => lines[0].curveHandle);
    // Handle moved ~8ft toward the start (chord midpoint is x=20, target
    // x=12) along the chord, confirming the along-axis freedom works.
    expect(curveHandle.alongFt).toBeLessThan(-5);

    const handlePoint = await page.evaluate(() => {
      const line = lines[0];
      const pts = resolveLineEndpoints(line, tokens);
      return resolveHandlePointFt(pts.start, pts.end, line.curveHandle);
    });
    expect(handlePoint.x).toBeCloseTo(12, 5);
    expect(handlePoint.y).toBeCloseTo(32, 5);
  });

  test('dragging a selected line\'s free-endpoint handle moves its endpoint', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.locator('.tool-btn[data-tool="pass"]').click();
    await dragFromTokenTo(page, 0, 30, 15);
    await expect.poll(() => page.evaluate(() => lines.length)).toBe(1);

    const midPoint = await toClientPoint(page, 20, 22.5);
    await page.mouse.click(midPoint.x, midPoint.y);
    const lineId = await page.evaluate(() => lines[0].id);
    await expect.poll(() => page.evaluate(() => selectedLineId)).toBe(lineId);

    const endpointStart = await toClientPoint(page, 30, 15);
    const endpointTarget = await toClientPoint(page, 25, 10);
    await page.mouse.move(endpointStart.x, endpointStart.y);
    await page.mouse.down();
    await page.mouse.move(endpointTarget.x, endpointTarget.y, { steps: 5 });
    await page.mouse.up();

    const endPoint = await page.evaluate(() => lines[0].endPoint);
    expect(endPoint.x).toBeCloseTo(25, 0);
    expect(endPoint.y).toBeCloseTo(10, 0);
  });

  test('dragging an attached line\'s endpoint away detaches it from its token', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await spawnTokenAt(page, 'offense', 30, 30);
    await page.locator('.tool-btn[data-tool="cut"]').click();
    await dragFromTokenTo(page, 0, 30, 30);
    await expect.poll(() => page.evaluate(() => lines.length)).toBe(1);
    expect(await page.evaluate(() => lines[0].endTokenId)).not.toBeNull();

    const midPoint = await toClientPoint(page, 20, 30);
    await page.mouse.click(midPoint.x, midPoint.y);
    await expect.poll(() => page.evaluate(() => selectedLineId)).not.toBeNull();

    // Drag from the attached end's handle (at the second token's position)
    // out to empty court space — this should detach the line from that
    // token and leave it as a free point there.
    const endToken = await toClientPoint(page, 30, 30);
    const target = await toClientPoint(page, 20, 15);
    await page.mouse.move(endToken.x, endToken.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 5 });
    await page.mouse.up();

    const line = await page.evaluate(() => ({ endTokenId: lines[0].endTokenId, endPoint: lines[0].endPoint }));
    expect(line.endTokenId).toBeNull();
    expect(line.endPoint.x).toBeCloseTo(20, 0);
    expect(line.endPoint.y).toBeCloseTo(15, 0);

    // The second token itself must not have moved — only the line's end
    // detached from it.
    const secondTokenPos = await page.evaluate(() => ({ x: tokens[1].x, y: tokens[1].y }));
    expect(secondTokenPos.x).toBeCloseTo(30, 0);
    expect(secondTokenPos.y).toBeCloseTo(30, 0);
  });

  test('dragging a free endpoint onto another token attaches it', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await spawnTokenAt(page, 'offense', 30, 15);
    await page.locator('.tool-btn[data-tool="pass"]').click();
    await dragFromTokenTo(page, 0, 30, 20); // free-point end, not on the second token
    await expect.poll(() => page.evaluate(() => lines.length)).toBe(1);
    expect(await page.evaluate(() => lines[0].endTokenId)).toBeNull();

    const midPoint = await toClientPoint(page, 20, 25);
    await page.mouse.click(midPoint.x, midPoint.y);
    await expect.poll(() => page.evaluate(() => selectedLineId)).not.toBeNull();

    const endpointStart = await toClientPoint(page, 30, 20);
    const secondTokenPoint = await toClientPoint(page, 30, 15);
    await page.mouse.move(endpointStart.x, endpointStart.y);
    await page.mouse.down();
    await page.mouse.move(secondTokenPoint.x, secondTokenPoint.y, { steps: 5 });
    await page.mouse.up();

    const line = await page.evaluate(() => ({ endTokenId: lines[0].endTokenId, endPoint: lines[0].endPoint }));
    const secondTokenId = await page.evaluate(() => tokens[1].id);
    expect(line.endTokenId).toBe(secondTokenId);
    expect(line.endPoint).toBeNull();
  });

  test('a dribble line can be selected and curved just like other line types', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.locator('.tool-btn[data-tool="dribble"]').click();
    await dragFromTokenTo(page, 0, 30, 30); // horizontal dribble line
    await expect.poll(() => page.evaluate(() => lines.length)).toBe(1);
    expect(await page.evaluate(() => lines[0].type)).toBe('dribble');

    const midPoint = await toClientPoint(page, 20, 30);
    await page.mouse.click(midPoint.x, midPoint.y);
    const lineId = await page.evaluate(() => lines[0].id);
    await expect.poll(() => page.evaluate(() => selectedLineId)).toBe(lineId);

    const targetPoint = await toClientPoint(page, 20, 38);
    await page.mouse.move(midPoint.x, midPoint.y);
    await page.mouse.down();
    await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 5 });
    await page.mouse.up();

    const curveHandle = await page.evaluate(() => lines[0].curveHandle);
    expect(curveHandle.perpFt).toBeCloseTo(8, 0);

    // The squiggle should still start/end exactly on the tokens despite
    // now riding along a bent baseline.
    const path = await page.evaluate(() => {
      const line = lines[0];
      const pts = resolveLineEndpoints(line, tokens);
      return linePathPoints(line, pts);
    });
    expect(path[0].x).toBeCloseTo(10, 5);
    expect(path[0].y).toBeCloseTo(30, 5);
    expect(path[path.length - 1].x).toBeCloseTo(30, 5);
    expect(path[path.length - 1].y).toBeCloseTo(30, 5);
  });
});
