import { expect, test } from 'playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/spikes/dockview-contract/surface-opening.html'); await expect(page.locator('#surface-status')).toHaveAttribute('data-ready', 'true'); });

test('TEST_CASE_M1_5A opens generic targets, truly coalesces pending calls, and maximizes narrow fallback', async ({ page }) => {
  await page.getByRole('button', { name: 'Open Forms beside' }).click();
  expect(await page.evaluate(() => window.surfaceOpeningContract.observations().lastCommitError)).toBe('');
  await expect.poll(() => page.evaluate(() => window.surfaceOpeningContract.observations())).toMatchObject({ revision: 1, history: 1, atomicCommits: 1, projectionAgrees: true, groups: 2 });
  const rects = await page.evaluate(() => window.surfaceOpeningContract.observations().panelRects) as Record<string, { width: number }>;
  expect(Math.abs(rects.agent!.width - rects['forms-workspace-1-1']!.width)).toBeLessThanOrEqual(2);

  await page.evaluate(() => window.surfaceOpeningContract.initialize());
  const results = await page.evaluate(() => Promise.all(Array.from({ length: 5 }, () => window.surfaceOpeningContract.open('code', 'beside')))) as Array<{ panelId: string }>;
  expect(new Set(results.map(({ panelId }) => panelId)).size).toBe(1);
  expect(await page.evaluate(() => window.surfaceOpeningContract.observations())).toMatchObject({ revision: 1, activationSequence: 2, history: 1, atomicCommits: 1, coordinatorCommands: 1, projectionAgrees: true });

  await page.evaluate(() => window.surfaceOpeningContract.initialize(500));
  await page.getByRole('button', { name: 'Open Code beside' }).click();
  await expect(page.getByRole('button', { name: 'Restore layout' })).toBeEnabled();
  expect(await page.evaluate(() => window.surfaceOpeningContract.observations())).toMatchObject({ maximized: true, groups: 1, atomicCommits: 1, browserFullscreen: false, projectionAgrees: true });
  await page.getByRole('button', { name: 'Restore layout' }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Restore layout' })).toBeDisabled();
  expect(await page.evaluate(() => window.surfaceOpeningContract.observations())).toMatchObject({ maximized: false, atomicCommits: 2, history: 2, projectionAgrees: true });
  await page.evaluate(() => window.surfaceOpeningContract.initialize());
  await page.evaluate(() => window.surfaceOpeningContract.rejectNext());
  await expect(page.evaluate(() => window.surfaceOpeningContract.open('code', 'beside'))).rejects.toThrow('revision-conflict');
  expect(await page.evaluate(() => window.surfaceOpeningContract.observations())).toMatchObject({ revision: 0, history: 0, atomicCommits: 0, groups: 1, projectionAgrees: true });
});

test('TEST_CASE_M1_5A uses real geometric adjacency before durable MRU', async ({ page }) => {
  await page.evaluate(() => window.surfaceOpeningContract.seedSelectionScenario());
  expect(await page.evaluate(() => window.surfaceOpeningContract.open('code', 'beside'))).toMatchObject({ panelId: 'code-adjacent', focusedOnly: true });
  expect(await page.evaluate(() => window.surfaceOpeningContract.observations())).toMatchObject({ history: 0, active: 'code-adjacent', projectionAgrees: true });
  await page.evaluate(() => window.surfaceOpeningContract.removeAdjacent());
  expect(await page.evaluate(() => window.surfaceOpeningContract.open('code', 'beside'))).toMatchObject({ panelId: 'code-newer', moved: true });
  expect(await page.evaluate(() => window.surfaceOpeningContract.observations())).toMatchObject({ history: 1, active: 'code-newer', projectionAgrees: true });
});

test('TEST_CASE_M1_5B routes restore, undo, and redo atomically without phantom candidates', async ({ page }) => {
  await page.getByRole('button', { name: 'Open Code maximized' }).click();
  const opened = await page.evaluate(() => window.surfaceOpeningContract.observations()); const boot = (opened.runtimeBoots as Record<string, string>)['code-workspace-1-1'];
  expect(opened).toMatchObject({ active: 'code-workspace-1-1', maximized: true, history: 1, cursor: 1, atomicCommits: 1, browserFullscreen: false, projectionAgrees: true });
  await page.getByRole('button', { name: 'Restore layout' }).click();
  expect(await page.evaluate(() => window.surfaceOpeningContract.observations())).toMatchObject({ maximized: false, history: 2, cursor: 2, projectionAgrees: true });
  await page.getByRole('button', { name: 'Undo layout' }).click();
  await expect.poll(() => page.evaluate(() => window.surfaceOpeningContract.observations().maximized)).toBe(true);
  expect((await page.evaluate(() => window.surfaceOpeningContract.open('code', 'maximized')) as { panelId: string }).panelId).toBe('code-workspace-1-1');
  await page.getByRole('button', { name: 'Undo layout' }).click(); await page.getByRole('button', { name: 'Redo layout' }).click();
  expect((await page.evaluate(() => window.surfaceOpeningContract.open('code', 'maximized')) as { panelId: string }).panelId).toBe('code-workspace-1-1');
  expect(((await page.evaluate(() => window.surfaceOpeningContract.observations().runtimeBoots)) as Record<string, string>)['code-workspace-1-1']).toBe(boot);
  expect(await page.evaluate(() => window.surfaceOpeningContract.observations())).toMatchObject({ projectionAgrees: true });
});

test('TEST_CASE_M1_5B durable MRU survives controller eviction and reload while existing target stays in place', async ({ page }) => {
  await page.evaluate(() => window.surfaceOpeningContract.seedSelectionScenario());
  const before = await page.evaluate(() => window.surfaceOpeningContract.observations().groupPanels);
  expect(await page.evaluate(() => window.surfaceOpeningContract.open('code', 'maximized'))).toMatchObject({ panelId: 'code-newer', moved: false, created: false });
  expect(await page.evaluate(() => window.surfaceOpeningContract.observations().groupPanels)).toEqual(before);
  await page.evaluate(() => window.surfaceOpeningContract.evictAndRestore());
  expect(await page.evaluate(() => window.surfaceOpeningContract.open('code', 'maximized'))).toMatchObject({ panelId: 'code-newer', created: false });
  await page.evaluate(() => window.surfaceOpeningContract.persistForReload()); await page.reload(); await expect(page.locator('#surface-status')).toHaveAttribute('data-ready', 'true');
  expect(await page.evaluate(() => window.surfaceOpeningContract.open('code', 'maximized'))).toMatchObject({ panelId: 'code-newer', created: false });
  expect(await page.evaluate(() => window.surfaceOpeningContract.observations())).toMatchObject({ maximized: true, projectionAgrees: true });
});
