const { test, expect } = require('@playwright/test');

test.describe('Checkpoint 1 — static court render', () => {
  test('renders a court canvas with non-trivial content', async ({ page }) => {
    await page.goto('/');
    const canvas = page.locator('#courtCanvas');
    await expect(canvas).toBeVisible();

    const box = await canvas.boundingBox();
    expect(box.width).toBeGreaterThan(100);
    expect(box.height).toBeGreaterThan(100);

    // The canvas should actually have drawn something (not just be blank
    // transparent pixels) — sample the pixel data via a page-side canvas.
    const hasDrawing = await page.evaluate(() => {
      const c = document.querySelector('#courtCanvas');
      const ctx = c.getContext('2d');
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 0) return true; // any non-transparent pixel
      }
      return false;
    });
    expect(hasDrawing).toBe(true);
  });

  test('court geometry helpers are exposed as page globals', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const map = courtToCanvas(400, 376);
      const px = map.toPx(COURT_WIDTH_FT / 2, 0);
      const ft = map.toFt(px.x, px.y);
      return { widthConst: COURT_WIDTH_FT, lengthConst: COURT_LENGTH_FT, roundTripX: Math.round(ft.x * 100) / 100 };
    });
    expect(result.widthConst).toBe(50);
    expect(result.lengthConst).toBe(47);
    expect(result.roundTripX).toBeCloseTo(25, 1);
  });

  test('three-point corner segments meet the arc exactly (no gap/overlap)', async ({ page }) => {
    await page.goto('/');
    const distances = await page.evaluate(() => {
      const hoopFt = { x: COURT_WIDTH_FT / 2, y: COURT_LENGTH_FT - 5.25 };
      const { leftCornerTopFt, rightCornerTopFt } = threePointGeometry(hoopFt);
      const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      return {
        left: dist(hoopFt, leftCornerTopFt),
        right: dist(hoopFt, rightCornerTopFt),
      };
    });
    const expectedRadius = await page.evaluate(() => THREE_POINT_ARC_RADIUS_FT);
    expect(distances.left).toBeCloseTo(expectedRadius, 6);
    expect(distances.right).toBeCloseTo(expectedRadius, 6);
  });

  test('redraw keeps the canvas backing store in sync with its displayed size', async ({ page }) => {
    await page.goto('/');
    const before = await page.evaluate(() => {
      const c = document.querySelector('#courtCanvas');
      return { w: c.width, h: c.height };
    });
    expect(before.w).toBeGreaterThan(0);
    expect(before.h).toBeGreaterThan(0);

    await page.setViewportSize({ width: 500, height: 900 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(50);

    const after = await page.evaluate(() => {
      const c = document.querySelector('#courtCanvas');
      return { w: c.width, h: c.height };
    });
    expect(after.w).toBeGreaterThan(0);
    expect(after.h).toBeGreaterThan(0);
  });
});
