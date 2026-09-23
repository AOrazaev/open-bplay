const { test, expect } = require('@playwright/test');

test.describe('Plays sidebar — collapse/expand and resize', () => {
  test.use({ viewport: { width: 900, height: 1000 } });

  test('the toggle button hides and re-shows the sidebar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#playsSidebar')).toBeVisible();
    await expect(page.locator('#playsSidebar')).not.toHaveClass(/collapsed/);

    await page.click('#sidebarToggle');
    await expect(page.locator('#playsSidebar')).toHaveClass(/collapsed/);
    // Collapsed means effectively invisible (zero width), not removed —
    // its content should still exist in the DOM, just not shown.
    await expect(page.locator('#playsTree')).toHaveCount(1);

    await page.click('#sidebarToggle');
    await expect(page.locator('#playsSidebar')).not.toHaveClass(/collapsed/);
  });

  test('collapsed state persists across a reload', async ({ page }) => {
    await page.goto('/');
    await page.click('#sidebarToggle');
    await expect(page.locator('#playsSidebar')).toHaveClass(/collapsed/);

    await page.reload();
    await expect(page.locator('#playsSidebar')).toHaveClass(/collapsed/);
  });

  test('dragging the resize handle changes the sidebar width, and it persists across a reload', async ({ page }) => {
    await page.goto('/');
    const initialWidth = await page.evaluate(() => document.querySelector('#playsSidebar').getBoundingClientRect().width);

    const handleBox = await page.locator('#sidebarResizeHandle').boundingBox();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 120, handleBox.y + handleBox.height / 2, { steps: 5 });
    await page.mouse.up();

    const resizedWidth = await page.evaluate(() => document.querySelector('#playsSidebar').getBoundingClientRect().width);
    expect(resizedWidth).toBeGreaterThan(initialWidth + 80);

    await page.reload();
    const widthAfterReload = await page.evaluate(() => document.querySelector('#playsSidebar').getBoundingClientRect().width);
    expect(Math.abs(widthAfterReload - resizedWidth)).toBeLessThan(2);
  });

  test('resizing is clamped to a minimum and maximum width', async ({ page }) => {
    await page.goto('/');
    const handleBox = await page.locator('#sidebarResizeHandle').boundingBox();

    // Drag far to the left, past any reasonable minimum.
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x - 2000, handleBox.y + handleBox.height / 2, { steps: 5 });
    await page.mouse.up();
    const minWidth = await page.evaluate(() => document.querySelector('#playsSidebar').getBoundingClientRect().width);
    expect(minWidth).toBeGreaterThanOrEqual(190);

    // Drag far to the right, past any reasonable maximum.
    const handleBox2 = await page.locator('#sidebarResizeHandle').boundingBox();
    await page.mouse.move(handleBox2.x + handleBox2.width / 2, handleBox2.y + handleBox2.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox2.x + 2000, handleBox2.y + handleBox2.height / 2, { steps: 5 });
    await page.mouse.up();
    const maxWidth = await page.evaluate(() => document.querySelector('#playsSidebar').getBoundingClientRect().width);
    expect(maxWidth).toBeLessThanOrEqual(490);
  });
});
