import { expect, test, type Page } from 'playwright/test';

type Observation = { closed: boolean; phase: string; mode: string; ratio: number; pinned: boolean; transientMutations: number; transientMaximized: boolean; groups: number; active?: string; durableSnapshotUnchanged: boolean; durableMutations: number; forbidden: Record<string, number>; payloads: number; iframeConnected: boolean; iframeWindowStable: boolean; selectedWindowStable: boolean; focusRestored: boolean; focusAfterAttachments: boolean; durableMaximized: boolean; hostEvents: string[]; disposedPayloads: number; budgetCount: number; budgetLimit: number; budgetRegistrations: number; budgetEvictions: string[] };
const invoke = (page: Page, method: string, ...args: unknown[]) => page.evaluate(({ method, args }) => (window.splitContract[method] as (...values: unknown[]) => unknown)(...args), { method, args });
const observe = (page: Page) => invoke(page, 'observe') as Promise<Observation>;
const expectIsolated = async (page: Page) => { const state = await observe(page); expect(state.durableSnapshotUnchanged).toBe(true); expect(state.durableMutations).toBe(0); expect(state.forbidden).toEqual({ coordinator: 0, serializer: 0, fromJSON: 0, repository: 0, revision: 0, history: 0, autosave: 0 }); };
const open = async (page: Page, query = '') => { await page.goto(`/spikes/dockview-contract/split-view.html${query}`); await expect(page.locator('#ready')).toHaveText('ready'); await expect.poll(() => invoke(page, 'frameState')).toEqual(expect.objectContaining({ ready: true })); };

test('TEST_CASE_M1_5C leases two retained runtimes, resizes/maximizes, and returns exact hosts', async ({ page }) => {
  await open(page); const agentBefore = await invoke(page, 'frameState') as { bootId: string }; const codeBefore = await invoke(page, 'selectedFrameState') as { bootId: string };
  await invoke(page, 'enter'); let state = await observe(page); expect(state).toMatchObject({ phase: 'active', mode: 'wide', groups: 2, pinned: true, payloads: 3, iframeWindowStable: true, selectedWindowStable: true, focusAfterAttachments: true, budgetCount: 2, budgetLimit: 2 }); expect(state.hostEvents.indexOf('focus:split')).toBeGreaterThan(state.hostEvents.indexOf('attach:transient:code@1')); await expectIsolated(page);
  const before = await invoke(page, 'bounds') as { left: DOMRect; right: DOMRect }; await page.mouse.move(before.left.right, before.left.top + 100); await page.mouse.down(); await page.mouse.move(before.left.right + 90, before.left.top + 100, { steps: 6 }); await page.mouse.up(); const after = await invoke(page, 'bounds') as { left: DOMRect; right: DOMRect }; expect(after.left.width).toBeGreaterThan(before.left.width + 50); expect(after.right.width).toBeGreaterThanOrEqual(240); await expectIsolated(page);
  const resizedRatio = after.left.width / (after.left.width + after.right.width);
  await invoke(page, 'narrow'); expect(await observe(page)).toMatchObject({ mode: 'narrow', groups: 1, active: 'left' }); await expectIsolated(page); await invoke(page, 'wide'); let wideBounds = await invoke(page, 'bounds') as { left: DOMRect; right: DOMRect }; expect(wideBounds.left.width / (wideBounds.left.width + wideBounds.right.width)).toBeCloseTo(resizedRatio, 1);
  for (const side of ['left', 'right']) { await invoke(page, 'maximize', side); expect(await observe(page)).toMatchObject({ transientMaximized: true }); await expectIsolated(page); await invoke(page, 'restore'); }
  await invoke(page, 'maximize', 'left'); await invoke(page, 'narrow'); expect(await observe(page)).toMatchObject({ mode: 'narrow', groups: 1, active: 'left', transientMaximized: false }); await invoke(page, 'wide'); await invoke(page, 'maximize', 'right'); await page.locator('#back').click(); await expect.poll(() => observe(page)).toMatchObject({ phase: 'inactive', pinned: false, focusRestored: true, iframeWindowStable: true, selectedWindowStable: true }); state = await observe(page); expect(state.hostEvents).toEqual(expect.arrayContaining(['return:durable:code@4', 'return:durable:agent@1'])); expect((await invoke(page, 'frameState') as { bootId: string }).bootId).toBe(agentBefore.bootId); expect((await invoke(page, 'selectedFrameState') as { bootId: string }).bootId).toBe(codeBefore.bootId); await expectIsolated(page);
  await invoke(page, 'enter'); wideBounds = await invoke(page, 'bounds') as { left: DOMRect; right: DOMRect }; expect(wideBounds.left.width / (wideBounds.left.width + wideBounds.right.width)).toBeCloseTo(0.5, 1); await page.reload(); await expect(page.locator('#ready')).toHaveText('ready'); await expect.poll(() => observe(page)).toMatchObject({ phase: 'active', mode: 'wide' }); wideBounds = await invoke(page, 'bounds') as { left: DOMRect; right: DOMRect }; expect(wideBounds.left.width / (wideBounds.left.width + wideBounds.right.width)).toBeCloseTo(0.5, 1); await expectIsolated(page);
});

test('TEST_CASE_M1_5C reconstructs trusted query and recreates/disposes absent Forms', async ({ page }) => {
  await open(page, '?voyage=voyage-a&split=panel-agent&withSurface=forms'); expect(await observe(page)).toMatchObject({ phase: 'active', payloads: 4, budgetCount: 2, budgetLimit: 2, focusAfterAttachments: true }); await expectIsolated(page); await invoke(page, 'exit'); expect(await observe(page)).toMatchObject({ phase: 'inactive', payloads: 3, disposedPayloads: 1, budgetCount: 0 }); await invoke(page, 'exit'); expect((await observe(page)).disposedPayloads).toBe(1);
  for (const bad of ['?voyage=voyage-a&split=deleted&withSurface=code', '?voyage=voyage-a&split=panel-agent&split=duplicate&withSurface=code', '?voyage=voyage-a&split=panel-agent&withCraft=missing&withSurface=code']) { await open(page, bad); expect(await observe(page)).toMatchObject({ phase: 'inactive', groups: 0 }); await expectIsolated(page); }
});

test('TEST_CASE_M1_5C handles retained-host and authority invalidation before unpin', async ({ page }) => {
  for (const [invalidation, query, disposeEvent] of [['selected-replace', '', 'dispose:code'], ['selected-delete', '', 'dispose:code'], ['voyage', '', 'dispose:code'], ['plugin', '?voyage=voyage-a&split=panel-agent&withSurface=review', 'dispose:plugin-review']] as const) { await open(page, query); if (!query) await invoke(page, 'enter'); expect(await invoke(page, 'attemptEviction')).toBe(false); await invoke(page, 'invalidate', invalidation); const state = await observe(page); expect(state).toMatchObject({ phase: 'inactive', pinned: false }); expect(state.hostEvents.at(-1)).toBe('unpin'); expect(state.hostEvents.indexOf(disposeEvent)).toBeLessThan(state.hostEvents.indexOf('unpin')); expect(await invoke(page, 'attemptEviction')).toBe(true); expect((await observe(page)).budgetEvictions).toEqual(['competing-controller']); const count = state.disposedPayloads; await invoke(page, 'exit'); expect((await observe(page)).disposedPayloads).toBe(count); await expectIsolated(page); }
});

test('TEST_CASE_M1_5C cancels deferred browser acquisition before publish', async ({ page }) => {
  for (const [query, invalidation] of [['?voyage=voyage-a&split=panel-agent&withSurface=review', 'plugin'], ['?voyage=voyage-a&split=panel-agent&withSurface=code', 'voyage']] as const) {
    await open(page);
    expect(await invoke(page, 'beginDeferred', query)).toBe(true);
    expect(await observe(page)).toMatchObject({ phase: 'entering', pinned: true, groups: 0, budgetCount: 0, budgetRegistrations: 4 });
    expect(await invoke(page, 'attemptEviction')).toBe(false);
    await invoke(page, 'invalidate', invalidation);
    let state = await observe(page);
    expect(state).toMatchObject({ phase: 'inactive', pinned: false, groups: 0, focusAfterAttachments: false, budgetCount: 0 });
    expect(await invoke(page, 'completeDeferred')).toBe(false);
    state = await observe(page);
    expect(state).toMatchObject({ phase: 'inactive', pinned: false, groups: 0, budgetCount: 0 });
    expect(await invoke(page, 'attemptEviction')).toBe(true);
    await expectIsolated(page);
  }
  await open(page);
  expect(await invoke(page, 'beginDeferred', '?voyage=voyage-a&split=panel-agent&withSurface=forms')).toBe(true);
  await page.locator('#back').click();
  await expect.poll(() => observe(page)).toMatchObject({ phase: 'inactive', pinned: false, payloads: 3, budgetCount: 0 });
  expect(await invoke(page, 'completeDeferred')).toBe(false);
  await expectIsolated(page);
});

test('TEST_CASE_M1_5C covers generic pair intents, races, geometry reset, and durable maximize', async ({ page }) => {
  for (const query of ['?voyage=voyage-a&split=panel-agent&withSurface=forms', '?voyage=voyage-a&split=panel-forms&withSurface=code', '?voyage=voyage-a&split=panel-agent&withCraft=craft-b&withSurface=forms', '?voyage=voyage-a&split=panel-agent&withCraft=craft-b&withSurface=code']) { await open(page, query); expect(await observe(page)).toMatchObject({ phase: 'active', groups: 2, budgetCount: 2 }); await invoke(page, 'enter'); expect(await observe(page)).toMatchObject({ phase: 'active' }); await invoke(page, 'exit'); expect(await observe(page)).toMatchObject({ phase: 'inactive', pinned: false }); await expectIsolated(page); }
  await open(page); await invoke(page, 'enter'); await invoke(page, 'enter'); await page.goBack(); await expect.poll(() => observe(page)).toMatchObject({ phase: 'inactive', pinned: false }); await expectIsolated(page);
  await open(page); await invoke(page, 'maximizeDurable'); expect(await observe(page)).toMatchObject({ phase: 'inactive', durableMaximized: true }); await invoke(page, 'restoreDurable'); expect((await observe(page)).forbidden).toEqual({ coordinator: 0, serializer: 0, fromJSON: 0, repository: 0, revision: 0, history: 0, autosave: 0 });
});
