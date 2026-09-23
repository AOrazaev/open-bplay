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

// Saves the current court under `name` via the sidebar's Save button.
async function savePlay(page, name) {
  await page.fill('#playNameInput', name);
  await page.click('#savePlayBtn');
}

// Clicks "+ Folder", types `name` into the inline rename input that
// appears, commits it with Enter, then clicks the new folder's name to
// select it as the current save location (creating a folder does not
// auto-select it — that's a separate, explicit action).
async function createFolder(page, name) {
  await page.click('#newFolderBtn');
  const input = page.locator('.rename-input');
  await input.fill(name);
  await input.press('Enter');
  await page.locator('.folder-name', { hasText: name }).click();
}

function folderRow(page, name) {
  return page.locator('.plays-tree-row').filter({ has: page.locator('.folder-name', { hasText: name }) });
}

function playRow(page, name) {
  return page.locator('.plays-tree-row').filter({ has: page.locator('.play-name', { hasText: name }) });
}

test.describe('Checkpoint 4 — save/load plays in a nested folder hierarchy', () => {
  test.use({ viewport: { width: 900, height: 1000 } });

  test('saving a play with no folder selected adds it at the root of the tree', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await savePlay(page, 'Horns Set');

    await expect(playRow(page, 'Horns Set')).toBeVisible();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('play-drawing-saved-plays-v1')));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ type: 'play', name: 'Horns Set', parentId: null });
  });

  test('creating a folder adds it to the tree and selects it as the save location', async ({ page }) => {
    await page.goto('/');
    await createFolder(page, 'Sets');

    await expect(folderRow(page, 'Sets')).toBeVisible();
    await expect(folderRow(page, 'Sets')).toHaveClass(/current/);
    await expect(page.locator('#playsLocation')).toHaveText('Saving to: Root / Sets');
  });

  test('saving a play while a folder is selected nests it under that folder', async ({ page }) => {
    await page.goto('/');
    await createFolder(page, 'Sets');
    await spawnTokenAt(page, 'offense', 10, 30);
    await savePlay(page, 'Horns');

    // The play should render nested inside the folder's own child list,
    // not at the tree root.
    const nestedPlay = page.locator('.plays-tree-children .play-name', { hasText: 'Horns' });
    await expect(nestedPlay).toBeVisible();

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('play-drawing-saved-plays-v1')));
    const folder = saved.find(e => e.type === 'folder' && e.name === 'Sets');
    const play = saved.find(e => e.type === 'play' && e.name === 'Horns');
    expect(play.parentId).toBe(folder.id);
  });

  test('folders can be nested inside other folders', async ({ page }) => {
    await page.goto('/');
    await createFolder(page, 'Sets');
    // The "+" button on the "Sets" folder row creates a subfolder inside
    // it (and selects "Sets" itself as the destination, since that's the
    // folder the new subfolder is being created in).
    await folderRow(page, 'Sets').locator('.add-subfolder-btn').click();
    const input = page.locator('.rename-input');
    await input.fill('Horns Variants');
    await input.press('Enter');
    await expect(page.locator('#playsLocation')).toHaveText('Saving to: Root / Sets');

    // Selecting the new subfolder by name moves the save location into it.
    await page.locator('.folder-name', { hasText: 'Horns Variants' }).click();
    await expect(page.locator('#playsLocation')).toHaveText('Saving to: Root / Sets / Horns Variants');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('play-drawing-saved-plays-v1')));
    const parent = saved.find(e => e.name === 'Sets');
    const child = saved.find(e => e.name === 'Horns Variants');
    expect(child.parentId).toBe(parent.id);
  });

  test('loading a play nested in a folder restores its tokens and re-selects that folder', async ({ page }) => {
    await page.goto('/');
    await createFolder(page, 'Sets');
    await spawnTokenAt(page, 'offense', 10, 30);
    await spawnTokenAt(page, 'offense', 30, 20);
    await savePlay(page, 'Horns');

    await page.click('#clearCourt');
    await expect.poll(() => page.evaluate(() => tokens.length)).toBe(0);

    await playRow(page, 'Horns').locator('.play-name').click();

    const tokenCount = await page.evaluate(() => tokens.length);
    expect(tokenCount).toBe(2);
    await expect(page.locator('#playNameInput')).toHaveValue('Horns');
    // Loading a play re-selects its parent folder as the save location,
    // so re-saving (e.g. after a tweak) lands back in the same folder.
    await expect(page.locator('#playsLocation')).toHaveText('Saving to: Root / Sets');
  });

  test('deleting a folder cascades to everything nested inside it', async ({ page }) => {
    await page.goto('/');
    await createFolder(page, 'Sets');
    await spawnTokenAt(page, 'offense', 10, 30);
    await savePlay(page, 'Horns');

    await folderRow(page, 'Sets').locator('.delete-btn').click();

    await expect(folderRow(page, 'Sets')).toHaveCount(0);
    await expect(playRow(page, 'Horns')).toHaveCount(0);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('play-drawing-saved-plays-v1')));
    expect(saved).toEqual([]);
    // The save location should have stepped back up to the root, since
    // the folder it pointed at no longer exists.
    await expect(page.locator('#playsLocation')).toHaveText('Saving to: Root');
  });

  test('double-clicking a name renames it in place', async ({ page }) => {
    await page.goto('/');
    await createFolder(page, 'Sets');
    // A real two-click gesture: the click handler detects the second
    // click via `event.detail` before the first click's re-render can
    // detach the node a naive `dblclick` listener would have raced with.
    await folderRow(page, 'Sets').locator('.folder-name').dblclick();
    const input = page.locator('.rename-input');
    await input.fill('Play Sets');
    await input.press('Enter');

    await expect(folderRow(page, 'Play Sets')).toBeVisible();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('play-drawing-saved-plays-v1')));
    expect(saved[0].name).toBe('Play Sets');
  });

  test('double-clicking a play name (not just a folder) also renames it in place', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await savePlay(page, 'Iso');

    await playRow(page, 'Iso').locator('.play-name').dblclick();
    const input = page.locator('.rename-input');
    await input.fill('Iso Left');
    await input.press('Enter');

    await expect(playRow(page, 'Iso Left')).toBeVisible();
    // Double-clicking to rename must not also trigger the single-click
    // "load this play" action and clobber the court.
    const tokenCount = await page.evaluate(() => tokens.length);
    expect(tokenCount).toBe(1);
  });

  test('saving again under the same name in the same folder overwrites instead of duplicating', async ({ page }) => {
    await page.goto('/');
    await spawnTokenAt(page, 'offense', 10, 30);
    await savePlay(page, 'Iso');

    await spawnTokenAt(page, 'offense', 20, 20);
    await savePlay(page, 'Iso');

    await expect(page.locator('.play-name', { hasText: 'Iso' })).toHaveCount(1);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('play-drawing-saved-plays-v1')));
    expect(saved).toHaveLength(1);
    expect(saved[0].frames[0].tokens).toHaveLength(2);
  });

  test('the same play name is allowed in two different folders', async ({ page }) => {
    await page.goto('/');
    await createFolder(page, 'Sets');
    await spawnTokenAt(page, 'offense', 10, 30);
    await savePlay(page, 'Iso');

    // Creating a second folder also selects it as the current save
    // location, so saving the same name there lands in a different
    // folder than the first "Iso".
    await createFolder(page, 'Other Sets');
    await spawnTokenAt(page, 'offense', 20, 20);
    await savePlay(page, 'Iso');

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('play-drawing-saved-plays-v1')));
    const isoPlays = saved.filter(e => e.type === 'play' && e.name === 'Iso');
    expect(isoPlays).toHaveLength(2);
    expect(new Set(isoPlays.map(p => p.parentId)).size).toBe(2);
  });

  test('the library, including folder structure, persists across a page reload', async ({ page }) => {
    await page.goto('/');
    await createFolder(page, 'Sets');
    await spawnTokenAt(page, 'offense', 10, 30);
    await savePlay(page, 'Horns');

    await page.reload();
    // Selecting "Sets" via createFolder() also expanded it, and that
    // expanded/current view state is now persisted too, so the nested
    // play should still be visible right after reload with no extra click.
    await expect(folderRow(page, 'Sets')).toBeVisible();
    await expect(folderRow(page, 'Sets')).toHaveClass(/current/);
    await expect(playRow(page, 'Horns')).toBeVisible();
    await expect(page.locator('#playsLocation')).toHaveText('Saving to: Root / Sets');
  });

  test('collapsing a folder and reloading keeps it collapsed', async ({ page }) => {
    await page.goto('/');
    await createFolder(page, 'Sets');
    await spawnTokenAt(page, 'offense', 10, 30);
    await savePlay(page, 'Horns');

    await folderRow(page, 'Sets').locator('.toggle-btn').click();
    await expect(playRow(page, 'Horns')).toHaveCount(0);

    await page.reload();
    await expect(folderRow(page, 'Sets')).toBeVisible();
    await expect(playRow(page, 'Horns')).toHaveCount(0);
  });
});
