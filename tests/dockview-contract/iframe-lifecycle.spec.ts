import { expect, test, type Page } from 'playwright/test';

async function iframeState(page: Page, panelId = 'iframe-primary') {
  return page.evaluate((id) => window.iframeContract.state(id), panelId);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/spikes/dockview-contract/');
  await expect(page.getByTestId('ready')).toHaveText('ready');
  await page.evaluate(() => window.iframeContract.addPrimary());
  await expect.poll(() => iframeState(page)).toMatchObject({ ready: true });
});

test('renderer always preserves iframe identity and state through layout lifecycle', async ({ page }) => {
  await page.evaluate(() => window.iframeContract.setState('iframe-primary', {
    input: 'draft survives',
    editor: 'editor-like state',
    scrollTop: 240,
  }));
  const before = await iframeState(page);

  await page.evaluate(() => window.iframeContract.splitPrimary());
  await page.evaluate(() => window.iframeContract.movePrimary());
  await page.evaluate(() => window.iframeContract.addCoverTab());
  await expect.poll(() => iframeState(page)).toMatchObject({ visible: false });
  const hiddenStart = await iframeState(page);
  await page.waitForTimeout(180);
  const hiddenEnd = await iframeState(page);
  expect(hiddenEnd.heartbeats).toBeGreaterThan(hiddenStart.heartbeats);
  expect(hiddenEnd.listenerEvents).toBeGreaterThan(hiddenStart.listenerEvents);
  expect(hiddenEnd.listenerEvents).toBe(hiddenEnd.heartbeats);
  await page.evaluate(() => window.iframeContract.showPrimary());
  await page.evaluate(() => window.iframeContract.maximizePrimary());
  await page.evaluate(() => window.iframeContract.restoreMaximized());

  const after = await iframeState(page);
  expect(after).toMatchObject({
    bootId: before.bootId,
    bootCount: 1,
    input: 'draft survives',
    editor: 'editor-like state',
    scrollTop: 240,
    ready: true,
    visible: true,
  });
});

test('warm controller switching preserves identity while background activity continues', async ({ page }) => {
  const before = await iframeState(page);
  await page.evaluate(() => window.iframeContract.switchToSecondary());
  await expect.poll(() => iframeState(page)).toMatchObject({ voyageVisible: false });
  const hidden = await iframeState(page);
  await page.waitForTimeout(180);
  const activeInBackground = await iframeState(page);
  expect(activeInBackground.bootId).toBe(before.bootId);
  expect(activeInBackground.heartbeats).toBeGreaterThan(hidden.heartbeats);
  await page.evaluate(() => window.iframeContract.switchToPrimary());
  await expect.poll(() => iframeState(page)).toMatchObject({
    bootId: before.bootId,
    voyageVisible: true,
  });
});

test('reuseExistingPanels restoration preserves iframe; disposal and page reload do not', async ({ page }) => {
  await page.evaluate(() => window.iframeContract.setState('iframe-primary', {
    input: 'restorable draft',
    editor: 'restorable editor',
    scrollTop: 180,
  }));
  const initial = await iframeState(page);

  const restore = await page.evaluate(() => window.iframeContract.restoreSnapshotInPlace());
  expect(restore.mutations).toEqual([
    { phase: 'will', kind: 'load', origin: 'api' },
    { phase: 'did', kind: 'load', origin: 'api' },
  ]);
  await expect.poll(() => iframeState(page)).toMatchObject({
    bootId: initial.bootId,
    input: 'restorable draft',
    editor: 'restorable editor',
    scrollTop: 180,
  });

  await page.evaluate(() => window.iframeContract.disposeAndRecreatePrimary());
  await expect.poll(() => iframeState(page)).toMatchObject({ ready: true });
  const recreated = await iframeState(page);
  expect(recreated.bootId).not.toBe(initial.bootId);
  expect(recreated).toMatchObject({ input: '', editor: '', bootCount: 1 });

  await page.reload();
  await expect(page.getByTestId('ready')).toHaveText('ready');
  await page.evaluate(() => window.iframeContract.addPrimary());
  await expect.poll(() => iframeState(page)).toMatchObject({ ready: true });
  const reloaded = await iframeState(page);
  expect(reloaded.bootId).not.toBe(recreated.bootId);
  expect(reloaded).toMatchObject({ input: '', editor: '', scrollTop: 0, bootCount: 1 });
});
