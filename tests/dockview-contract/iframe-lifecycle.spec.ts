import { expect, test, type Page } from 'playwright/test';

async function iframeState(page: Page, panelId = 'iframe-primary') {
  return page.evaluate((id) => window.iframeContract.state(id), panelId);
}

async function expectHeartbeatAdvance(page: Page, baseline: number) {
  await expect.poll(async () => (await iframeState(page)).heartbeats).toBeGreaterThan(baseline);
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
  const split = await page.evaluate(() => window.iframeContract.topology());
  expect(split.groups).toHaveLength(2);
  expect(split.groups.map((group) => group.views).sort()).toEqual([
    ['iframe-primary'],
    ['iframe-split'],
  ]);
  const splitPrimaryGroup = split.primaryGroupId;

  await page.evaluate(() => window.iframeContract.movePrimary());
  const moved = await page.evaluate(() => window.iframeContract.topology());
  expect(moved.primaryGroupId).not.toBe(splitPrimaryGroup);
  expect(moved.groups.find((group) => group.id === moved.primaryGroupId)?.views).toEqual([
    'iframe-split',
    'iframe-primary',
  ]);

  await page.evaluate(() => window.iframeContract.addCoverTab());
  await expect.poll(() => iframeState(page)).toMatchObject({ visible: false });
  const hiddenStart = await iframeState(page);
  await expectHeartbeatAdvance(page, hiddenStart.heartbeats);
  const hiddenEnd = await iframeState(page);
  expect(hiddenEnd.listenerEvents).toBeGreaterThan(hiddenStart.listenerEvents);
  expect(hiddenEnd.listenerEvents).toBe(hiddenEnd.heartbeats);
  await page.evaluate(() => window.iframeContract.showPrimary());
  const beforeMaximize = await page.evaluate(() => window.iframeContract.topology());
  await page.evaluate(() => window.iframeContract.maximizePrimary());
  await expect.poll(() => page.evaluate(() => window.iframeContract.topology())).toMatchObject({
    maximized: true,
  });
  expect(await iframeState(page)).toMatchObject({
    bootId: before.bootId,
    input: 'draft survives',
    editor: 'editor-like state',
    scrollTop: 240,
  });
  await page.evaluate(() => window.iframeContract.restoreMaximized());
  await expect.poll(() => page.evaluate(() => window.iframeContract.topology())).toMatchObject({
    maximized: false,
  });
  expect((await page.evaluate(() => window.iframeContract.topology())).groups).toEqual(
    beforeMaximize.groups,
  );

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
  await expectHeartbeatAdvance(page, hidden.heartbeats);
  const activeInBackground = await iframeState(page);
  expect(activeInBackground.bootId).toBe(before.bootId);
  expect(activeInBackground.heartbeats).toBeGreaterThan(hidden.heartbeats);
  await page.evaluate(() => window.iframeContract.switchToPrimary());
  await expect.poll(() => iframeState(page)).toMatchObject({
    bootId: before.bootId,
    voyageVisible: true,
  });
});

test('structural restoration preserves iframe; disposal and page reload do not', async ({ page }) => {
  await page.evaluate(() => window.iframeContract.setState('iframe-primary', {
    input: 'restorable draft',
    editor: 'restorable editor',
    scrollTop: 180,
  }));
  const initial = await iframeState(page);
  const topologyA = await page.evaluate(() => window.iframeContract.captureTopologyA());

  await page.evaluate(() => window.iframeContract.splitPrimary());
  const topologyB = await page.evaluate(() => window.iframeContract.topology());
  expect(topologyB.groups).toHaveLength(2);
  expect(topologyB).not.toEqual(topologyA);

  const restore = await page.evaluate(() => window.iframeContract.restoreTopologyA());
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
  expect(await page.evaluate(() => window.iframeContract.topology())).toEqual(topologyA);
  const afterRestore = await iframeState(page);
  expect(afterRestore.heartbeats).toBeGreaterThanOrEqual(initial.heartbeats);
  expect(afterRestore.listenerEvents).toBe(afterRestore.heartbeats);

  await page.evaluate(() => window.iframeContract.disposeAndRecreatePrimary());
  await expect.poll(() => iframeState(page)).toMatchObject({ ready: true });
  const recreated = await iframeState(page);
  expect(recreated.bootId).not.toBe(initial.bootId);
  expect(recreated).toMatchObject({ input: '', editor: '', scrollTop: 0, bootCount: 1 });
  await expect.poll(() => page.evaluate((bootId) => window.iframeContract.teardown(bootId), initial.bootId))
    .toMatchObject({ signaled: true, stopped: true });
  const teardown = await page.evaluate(
    (bootId) => window.iframeContract.teardown(bootId),
    initial.bootId,
  );
  expect(teardown.events.some((event) => event === 'pagehide' || event === 'unload')).toBe(true);
  const disposedHeartbeat = await page.evaluate(
    (bootId) => window.iframeContract.teardown(bootId).heartbeats,
    initial.bootId,
  );
  await expect.poll(() => page.evaluate(
    (bootId) => window.iframeContract.teardown(bootId).heartbeats,
    initial.bootId,
  )).toBe(disposedHeartbeat);

  await page.reload();
  await expect(page.getByTestId('ready')).toHaveText('ready');
  await page.evaluate(() => window.iframeContract.addPrimary());
  await expect.poll(() => iframeState(page)).toMatchObject({ ready: true });
  const reloaded = await iframeState(page);
  expect(reloaded.bootId).not.toBe(recreated.bootId);
  expect(reloaded).toMatchObject({ input: '', editor: '', scrollTop: 0, bootCount: 1 });
});
