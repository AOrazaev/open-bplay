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

async function savePlay(page, name) {
  await page.fill('#playNameInput', name);
  await page.click('#savePlayBtn');
}

function playRow(page, name) {
  return page.locator('.plays-tree-row').filter({ has: page.locator(`.play-name:text-is("${name}")`) });
}

function makePlayPayload(name, parentId = null) {
  return {
    kind: 'open-bplay-play',
    version: 1,
    exportedAt: Date.now(),
    entries: [{
      id: 'imported-play-1',
      type: 'play',
      name,
      parentId,
      frames: [{ tokens: [{ id: 't1', type: 'offense', label: '1', x: 12, y: 22 }], lines: [], highlights: [] }],
      savedAt: Date.now(),
    }],
  };
}

async function importJsonFile(page, payload, filename = 'import.json') {
  await page.locator('#importPlaysInput').setInputFiles({
    name: filename,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload)),
  });
}

async function importCurrentPlayFile(page, payload, filename = 'import.json') {
  await page.locator('#importCurrentPlayInput').setInputFiles({
    name: filename,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload)),
  });
}

test.describe('Checkpoint 8 — export/import plays across devices', () => {
  test.use({ viewport: { width: 900, height: 1000 } });

  test('exporting a single play downloads a JSON file with the right kind/name', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await savePlay(page, 'My Play');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      playRow(page, 'My Play').locator('.export-btn').click(),
    ]);
    expect(download.suggestedFilename()).toBe('My-Play.play.json');
    const text = await (await download.createReadStream()).toArray().then(chunks => Buffer.concat(chunks).toString('utf-8'));
    const payload = JSON.parse(text);
    expect(payload.kind).toBe('open-bplay-play');
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0].name).toBe('My Play');
  });

  test('exporting the whole library downloads every folder/play', async ({ page }) => {
    await page.goto('/');
    await page.click('#newFolderBtn');
    await page.locator('.rename-input').fill('Sets');
    await page.locator('.rename-input').press('Enter');
    await savePlay(page, 'Play A');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#exportLibraryBtn'),
    ]);
    expect(download.suggestedFilename()).toMatch(/^open-bplay-library-.*\.json$/);
    const text = await (await download.createReadStream()).toArray().then(chunks => Buffer.concat(chunks).toString('utf-8'));
    const payload = JSON.parse(text);
    expect(payload.kind).toBe('open-bplay-library');
    const names = payload.entries.map(e => e.name).sort();
    expect(names).toEqual(['Play A', 'Sets']);
  });

  test('importing a single-play JSON file adds it under the currently selected folder', async ({ page }) => {
    await page.goto('/');
    await importJsonFile(page, makePlayPayload('Imported Play'));
    await expect(playRow(page, 'Imported Play')).toBeVisible();
    const tokenCount = await page.evaluate(() => {
      const entry = library.find(e => e.name === 'Imported Play');
      return entry.frames[0].tokens.length;
    });
    expect(tokenCount).toBe(1);
  });

  test('importing a play whose name already exists renames the incoming copy instead of overwriting', async ({ page }) => {
    await page.goto('/');
    await savePlay(page, 'Same Name');
    await importJsonFile(page, makePlayPayload('Same Name'));

    await expect(playRow(page, 'Same Name')).toBeVisible();
    await expect(playRow(page, 'Same Name (2)')).toBeVisible();
  });

  test('importing an invalid file shows an error and does not touch the library', async ({ page }) => {
    await page.goto('/');
    let dialogMessage = null;
    page.once('dialog', async (dialog) => {
      dialogMessage = dialog.message();
      await dialog.dismiss();
    });
    await importJsonFile(page, { not: 'a valid export' }, 'garbage.json');
    await expect.poll(() => dialogMessage).toContain("isn't a valid");
    const count = await page.evaluate(() => library.length);
    expect(count).toBe(0);
  });

  test('exporting the current (unsaved) canvas play downloads a JSON file using the play name field', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 15, 25);
    await page.fill('#playNameInput', 'Scratch Play');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#exportCurrentPlayBtn'),
    ]);
    expect(download.suggestedFilename()).toBe('Scratch-Play.play.json');
    const text = await (await download.createReadStream()).toArray().then(chunks => Buffer.concat(chunks).toString('utf-8'));
    const payload = JSON.parse(text);
    expect(payload.kind).toBe('open-bplay-play');
    expect(payload.entries[0].name).toBe('Scratch Play');
    expect(payload.entries[0].frames[0].tokens).toHaveLength(1);
    // Never saved, so it must not exist in the library.
    const libraryLength = await page.evaluate(() => library.length);
    expect(libraryLength).toBe(0);
  });

  test('exporting the current canvas with no name falls back to "Untitled Play"', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 15, 25);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#exportCurrentPlayBtn'),
    ]);
    expect(download.suggestedFilename()).toBe('Untitled-Play.play.json');
  });

  test('loading a play file onto the canvas replaces the court and fills the name field, without saving to the library', async ({ page }) => {
    await page.goto('/');
    await importCurrentPlayFile(page, makePlayPayload('Loaded Play'));

    await expect(page.locator('#playNameInput')).toHaveValue('Loaded Play');
    const state = await page.evaluate(() => ({
      libraryLength: library.length,
      tokenCount: tokens.length,
    }));
    expect(state.libraryLength).toBe(0);
    expect(state.tokenCount).toBe(1);
  });

  test('loading an invalid file onto the canvas shows an error and leaves the canvas untouched', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 15, 25);
    let dialogMessage = null;
    page.once('dialog', async (dialog) => {
      dialogMessage = dialog.message();
      await dialog.dismiss();
    });
    await importCurrentPlayFile(page, { not: 'a valid export' }, 'garbage.json');
    await expect.poll(() => dialogMessage).toContain("isn't a valid");
    const tokenCount = await page.evaluate(() => tokens.length);
    expect(tokenCount).toBe(1);
  });
});
