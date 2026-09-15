import { expect, test } from 'playwright/test';

type Observation = { closed: boolean; phase: string; mode: string; ratio: number; pinned: boolean; transientMutations: number; transientMaximized: boolean; groups: number; active?: string; durableSnapshotUnchanged: boolean; durableMutations: number; forbidden: Record<string, number>; toJSONCalls: number; fromJSONCalls: number; revisions: number; writes: number; history: number; payloads: number; iframeConnected: boolean; iframeWindowStable: boolean; focusRestored: boolean; durableMaximized: boolean; attachedHost: string; hostEvents: string[]; disposedPayloads: number; budgetEvictions: string[] };
const invoke = (page: import('playwright/test').Page, method: string, ...args: unknown[]) => page.evaluate(({ method, args }) => (window.splitContract[method] as (...values: unknown[]) => unknown)(...args), { method, args });
const observe = (page: import('playwright/test').Page) => invoke(page, 'observe') as Promise<Observation>;
const expectIsolated = async (page: import('playwright/test').Page) => { const state = await observe(page); expect(state.durableSnapshotUnchanged).toBe(true); expect(state.durableMutations).toBe(0); expect(state.forbidden).toEqual({ coordinator: 0, toJSON: 0, fromJSON: 0, repositoryWrite: 0, revision: 0, history: 0, autosave: 0 }); };

test('TEST_CASE_M1_5C supplies transient native resize/maximize without Voyage mutation', async ({ page }) => {
  await page.goto('/spikes/dockview-contract/split-view.html'); await expect(page.locator('#ready')).toHaveText('ready');
  await expect.poll(() => invoke(page, 'frameState')).toEqual(expect.objectContaining({ ready: true }));
  const initialFrame = await invoke(page, 'frameState') as { bootId: string; heartbeats: number; listenerEvents: number };
  const bootBefore = initialFrame.bootId;
  await invoke(page, 'enter');
  let state = await observe(page);
  expect(state).toMatchObject({ closed: false, mode: 'wide', groups: 2, pinned: true, durableSnapshotUnchanged: true, durableMutations: 0, toJSONCalls: 0, fromJSONCalls: 0, revisions: 0, writes: 0, history: 0, payloads: 2, iframeConnected: true, iframeWindowStable: true });
  expect(state.attachedHost).toMatch(/^transient:left@/); expect(state.hostEvents.slice(0, 4)).toEqual(['attach:durable:agent@1', 'pin:1', 'detach:durable:agent@1', 'attach:transient:left@1']); await expectIsolated(page);
  await expect(page.getByRole('button', { name: /Close (Invoking|Selected)/ })).toHaveCount(0);
  const before = await invoke(page, 'bounds') as { left: DOMRect; right: DOMRect };
  expect(before.left.width).toBeGreaterThanOrEqual(240); expect(before.right.width).toBeGreaterThanOrEqual(240);
  await page.mouse.move((before.left.right + before.right.left) / 2, before.left.top + 100); await page.mouse.down(); await page.mouse.move(before.left.right + 100, before.left.top + 100, { steps: 8 }); await page.mouse.up();
  const resized = await invoke(page, 'bounds') as { left: DOMRect; right: DOMRect };
  expect(resized.left.width).toBeGreaterThan(before.left.width + 50); expect(resized.right.width).toBeGreaterThanOrEqual(240);
  await expectIsolated(page); await invoke(page, 'maximize', 'left'); expect(await observe(page)).toMatchObject({ transientMaximized: true }); await expectIsolated(page); await invoke(page, 'restore');
  await invoke(page, 'maximize', 'right'); expect(await observe(page)).toMatchObject({ transientMaximized: true }); await expectIsolated(page); await invoke(page, 'restore'); await invoke(page, 'relayoutDurable'); await expectIsolated(page);
  const finalFrame = await invoke(page, 'frameState') as { bootId: string; heartbeats: number; listenerEvents: number };
  expect(finalFrame).toMatchObject({ bootId: bootBefore }); expect(finalFrame.heartbeats).toBeGreaterThan(initialFrame.heartbeats); expect(finalFrame.listenerEvents).toBe(finalFrame.heartbeats);
  state = await observe(page); expect(state.transientMutations).toBeGreaterThan(0); expect(state).toMatchObject({ durableSnapshotUnchanged: true, durableMutations: 0 });
});

test('TEST_CASE_M1_5C uses responsive topology, invocation-only geometry, and exact teardown', async ({ page }) => {
  await page.goto('/spikes/dockview-contract/split-view.html'); await expect(page.locator('#ready')).toHaveText('ready'); await invoke(page, 'enter');
  const before = await invoke(page, 'bounds') as { left: DOMRect; right: DOMRect };
  await page.mouse.move(before.left.right, before.left.top + 100); await page.mouse.down(); await page.mouse.move(before.left.right + 80, before.left.top + 100); await page.mouse.up();
  await invoke(page, 'narrow'); const narrow = await observe(page); expect(narrow).toMatchObject({ mode: 'narrow', groups: 1, active: 'left' }); expect(narrow.ratio).toBeGreaterThan(0.5);
  await invoke(page, 'maximize', 'right'); await invoke(page, 'wide'); const wide = await observe(page); expect(wide).toMatchObject({ mode: 'wide', groups: 2 }); expect(wide.ratio).toBe(narrow.ratio);
  const restoredBounds = await invoke(page, 'bounds') as { left: DOMRect; right: DOMRect };
  expect(restoredBounds.left.width / (restoredBounds.left.width + restoredBounds.right.width)).toBeCloseTo(narrow.ratio, 1);
  await invoke(page, 'maximize', 'left'); await page.locator('#back').click(); await expect.poll(() => observe(page)).toMatchObject({ closed: true, pinned: false, transientMaximized: false, durableSnapshotUnchanged: true, focusRestored: true });
  let returned = await observe(page); expect(returned.attachedHost).toBe('durable:agent@1'); expect(returned.hostEvents).toContain('return:durable:agent@1'); expect(returned.iframeWindowStable).toBe(true); await expectIsolated(page);
  await invoke(page, 'exit'); await invoke(page, 'enter'); expect(await observe(page)).toMatchObject({ ratio: 0.5, groups: 2, payloads: 2 });
  await page.goBack(); await expect.poll(() => observe(page)).toMatchObject({ closed: true, pinned: false });
});

test('TEST_CASE_M1_5C reconstructs trusted production route and keeps durable maximize separate', async ({ page }) => {
  await page.goto('/voyages/voyage-a/split/deleted?withCraft=craft-a&withSurface=code&url=https://evil.test'); await expect(page.locator('#ready')).toHaveText('ready'); expect(await observe(page)).toMatchObject({ closed: true, groups: 0 });
  await page.goto('/voyages/voyage-a/split/panel-token?withCraft=craft-a&withSurface=code'); await expect(page.locator('#ready')).toHaveText('ready');
  expect(await observe(page)).toMatchObject({ closed: false, groups: 2, durableSnapshotUnchanged: true });
  await page.reload(); await expect(page.locator('#ready')).toHaveText('ready'); expect(await observe(page)).toMatchObject({ closed: false, ratio: 0.5, durableSnapshotUnchanged: true });
  await invoke(page, 'exit'); await invoke(page, 'maximizeDurable'); expect(await observe(page)).toMatchObject({ closed: true, durableMaximized: true }); await invoke(page, 'restoreDurable');
  expect(await observe(page)).toMatchObject({ closed: true, durableMaximized: false, payloads: 2 });
});

test('TEST_CASE_M1_5C pins against eviction and invalidation cleans before unpin exactly once', async ({ page }) => {
  for (const invalidation of ['replace', 'delete']) {
    await page.goto('/spikes/dockview-contract/split-view.html'); await expect(page.locator('#ready')).toHaveText('ready'); await expect.poll(() => invoke(page, 'frameState')).toEqual(expect.objectContaining({ ready: true }));
    await invoke(page, 'enter'); expect(await invoke(page, 'attemptEviction')).toBe(false); await invoke(page, 'invalidateHost', invalidation);
    const state = await observe(page); expect(state).toMatchObject({ phase: 'inactive', pinned: false, iframeConnected: false, disposedPayloads: 1 }); expect(state.hostEvents.slice(-3)).toEqual(['detach:transient:left@1', 'dispose:agent-runtime', 'unpin']); expect(await invoke(page, 'attemptEviction')).toBe(true); expect((await observe(page)).budgetEvictions).toEqual(['durable-voyage']); await invoke(page, 'exit'); expect((await observe(page)).disposedPayloads).toBe(1); await expectIsolated(page);
  }
});
