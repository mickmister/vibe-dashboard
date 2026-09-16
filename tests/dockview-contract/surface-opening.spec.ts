import { expect, test } from 'playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/spikes/dockview-contract/surface-opening.html');
  await expect(page.locator('#surface-status')).toHaveAttribute('data-ready', 'true');
});

test('TEST_CASE_M1_5A opens generic trusted surfaces beside with dedupe and narrow fallback', async ({ page }) => {
  await page.getByRole('button', { name: 'Open Forms beside' }).click();
  await expect.poll(() => page.evaluate(() => window.surfaceOpeningContract.observations())).toMatchObject({
    revision: 1, history: 1, checkpoints: 1, casWrites: 1, coordinatorCommands: 1, groups: 2,
  });
  expect(await page.evaluate(() => window.surfaceOpeningContract.observations().groupPanels)).toEqual([['agent'], ['forms-workspace-1-1']]);
  const rects = await page.evaluate(() => window.surfaceOpeningContract.observations().panelRects) as Record<string, { width: number }>;
  expect(Math.abs(rects.agent!.width - rects['forms-workspace-1-1']!.width)).toBeLessThanOrEqual(2);

  await page.evaluate(() => window.surfaceOpeningContract.initialize());
  await Promise.all(Array.from({ length: 5 }, () => page.evaluate(() => window.surfaceOpeningContract.open('code', 'beside'))));
  expect(await page.evaluate(() => window.surfaceOpeningContract.observations())).toMatchObject({ history: 1, checkpoints: 1, groups: 2, casWrites: 5, coordinatorCommands: 5 });
  expect(await page.evaluate(() => window.surfaceOpeningContract.observations().groupPanels)).toEqual([['agent'], ['code-workspace-1-1']]);

  await page.evaluate(() => window.surfaceOpeningContract.initialize(500));
  await page.getByRole('button', { name: 'Open Code beside' }).click();
  await expect.poll(() => page.evaluate(() => window.surfaceOpeningContract.observations().groups)).toBe(1);
  expect(await page.evaluate(() => window.surfaceOpeningContract.observations().groupPanels)).toEqual([['agent', 'code-workspace-1-1']]);
});

test('TEST_CASE_M1_5A uses adjacent-first then same-Voyage durable MRU without duplication', async ({ page }) => {
  await page.evaluate(() => window.surfaceOpeningContract.seedSelectionScenario());
  const adjacent = await page.evaluate(() => window.surfaceOpeningContract.open('code', 'beside')) as { panelId: string; focusedOnly: boolean };
  expect(adjacent).toMatchObject({ panelId: 'code-adjacent', focusedOnly: true });
  expect(await page.evaluate(() => window.surfaceOpeningContract.observations())).toMatchObject({ history: 0, checkpoints: 0, active: 'code-adjacent' });

  await page.evaluate(() => window.surfaceOpeningContract.removeAdjacent());
  const mru = await page.evaluate(() => window.surfaceOpeningContract.open('code', 'beside')) as { panelId: string; moved: boolean };
  expect(mru).toMatchObject({ panelId: 'code-newer', moved: true });
  const observation = await page.evaluate(() => window.surfaceOpeningContract.observations());
  const rects = observation.panelRects as Record<string, { left: number; right: number; groupId: string }>;
  expect(rects['code-newer']!.groupId).not.toBe(rects['code-adjacent']!.groupId);
  expect(rects['code-newer']!.left).toBeGreaterThanOrEqual(rects.agent!.right - 1);
  expect(rects['code-newer']!.left).toBeLessThan(rects.spacer!.left);
});

test('TEST_CASE_M1_5B activates then maximizes, visibly restores, and retains runtime through history and eviction', async ({ page }) => {
  await page.getByRole('button', { name: 'Open Code maximized' }).click();
  await expect(page.getByRole('button', { name: 'Restore layout' })).toBeEnabled();
  const opened = await page.evaluate(() => window.surfaceOpeningContract.observations());
  expect(opened).toMatchObject({ active: 'code-workspace-1-1', maximized: true, history: 1, checkpoints: 1, casWrites: 1, browserFullscreen: false });
  const boot = (opened.runtimeBoots as Record<string, string>)['code-workspace-1-1'];

  await page.getByRole('button', { name: 'Restore layout' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Restore layout' })).toBeDisabled();
  await page.getByRole('button', { name: 'Undo layout' }).click();
  await expect.poll(() => page.evaluate(() => window.surfaceOpeningContract.observations().groups)).toBe(1);
  await page.getByRole('button', { name: 'Redo layout' }).click();
  await expect.poll(() => page.evaluate(() => window.surfaceOpeningContract.observations().maximized)).toBe(true);
  expect(((await page.evaluate(() => window.surfaceOpeningContract.observations().runtimeBoots)) as Record<string, string>)['code-workspace-1-1']).toBe(boot);

  await page.evaluate(() => window.surfaceOpeningContract.evictAndRestore());
  expect(((await page.evaluate(() => window.surfaceOpeningContract.observations().runtimeBoots)) as Record<string, string>)['code-workspace-1-1']).toBe(boot);
  expect(await page.evaluate(() => window.surfaceOpeningContract.observations())).toMatchObject({ active: 'code-workspace-1-1', maximized: true });

  await page.evaluate(() => window.surfaceOpeningContract.persistForReload());
  await page.reload();
  await expect(page.locator('#surface-status')).toHaveAttribute('data-ready', 'true');
  const reloaded = await page.evaluate(() => window.surfaceOpeningContract.observations());
  expect(reloaded).toMatchObject({ active: 'code-workspace-1-1', maximized: true, history: 1 });
  expect((reloaded.runtimeBoots as Record<string, string>)['code-workspace-1-1']).not.toBe(boot);
});

test('TEST_CASE_M1_5B maximizes an existing nonadjacent surface without relocating it', async ({ page }) => {
  await page.evaluate(() => window.surfaceOpeningContract.seedSelectionScenario());
  const before = await page.evaluate(() => window.surfaceOpeningContract.observations().groupPanels);
  const result = await page.evaluate(() => window.surfaceOpeningContract.open('code', 'maximized')) as { panelId: string; moved: boolean; created: boolean };
  expect(result).toMatchObject({ panelId: 'code-newer', moved: false, created: false });
  expect(await page.evaluate(() => window.surfaceOpeningContract.observations().groupPanels)).toEqual(before);
  expect(await page.evaluate(() => window.surfaceOpeningContract.observations())).toMatchObject({ active: 'code-newer', maximized: true, history: 1, checkpoints: 1 });
});
