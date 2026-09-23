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

test.describe('Checkpoint 5 — export the court as an image', () => {
  test.use({ viewport: { width: 900, height: 1000 } });

  test('exporting copies a PNG of the court to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);

    await page.click('#exportImageBtn');
    await expect(page.locator('#exportImageBtn')).toHaveText('✅ Copied!');

    const clipboardInfo = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      const item = items[0];
      const type = item.types.find(t => t === 'image/png');
      const blob = type ? await item.getType(type) : null;
      return { type, size: blob ? blob.size : 0 };
    });
    expect(clipboardInfo.type).toBe('image/png');
    // A blank/near-blank image would be tiny; a real court render is not.
    expect(clipboardInfo.size).toBeGreaterThan(1000);

    // The button label reverts after the brief confirmation.
    await expect(page.locator('#exportImageBtn')).toHaveText('Export Image', { timeout: 3000 });
  });

  test('falls back to downloading a PNG when the Clipboard API is unavailable', async ({ page }) => {
    // Simulate a browser/context without Clipboard API support, forcing
    // the download fallback path.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'ClipboardItem', { value: undefined, configurable: true });
    });
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await page.fill('#playNameInput', 'Horns Set');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#exportImageBtn'),
    ]);

    expect(download.suggestedFilename()).toBe('Horns_Set.png');
    await expect(page.locator('#exportImageBtn')).toHaveText('✅ Downloaded');
  });

  test('the exported filename falls back to a generic name when no play name is set', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'ClipboardItem', { value: undefined, configurable: true });
    });
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#exportImageBtn'),
    ]);

    expect(download.suggestedFilename()).toBe('play.png');
  });
});
