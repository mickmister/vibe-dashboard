import { expect, test } from 'playwright/test';

type Mutation = { phase: 'will' | 'did'; kind: string; origin: string };

test.beforeEach(async ({ page }) => {
  await page.goto('/spikes/dockview-contract/');
  await expect(page.getByTestId('ready')).toHaveText('ready');
});

test('add, split, move, maximize, and restore are paired mutations', async ({ page }) => {
  await page.getByRole('button', { name: 'Add first panel' }).click();
  await page.getByRole('button', { name: 'Add beside' }).click();
  await page.getByRole('button', { name: 'Move first right' }).click();
  await page.getByRole('button', { name: 'Maximize first panel' }).click();
  await expect(page.getByRole('button', { name: 'Restore layout' })).toBeEnabled();
  await page.getByRole('button', { name: 'Restore layout' }).click();

  const mutations = await page.evaluate(() => window.contract.mutations());
  expect(mutations).toHaveLength(10);
  for (let index = 0; index < mutations.length; index += 2) {
    expect(mutations[index]).toMatchObject({ phase: 'will' });
    expect(mutations[index + 1]).toEqual({
      ...mutations[index],
      phase: 'did',
    });
  }
  expect(mutations.map((event: Mutation) => event.kind)).toEqual(
    expect.arrayContaining(['add', 'move', 'maximize']),
  );
  expect(mutations.filter(({ phase }) => phase === 'will').map(({ origin }) => origin)).toEqual([
    'api',
    'api',
    'api',
    'user',
    'api',
  ]);
});

test('current-version JSON round-trips and preserves maximize state', async ({ page }) => {
  await page.getByRole('button', { name: 'Add first panel' }).click();
  await page.getByRole('button', { name: 'Add beside' }).click();
  await page.getByRole('button', { name: 'Maximize first panel' }).click();

  const result = await page.evaluate(() => window.contract.roundTrip());
  expect(result.panelIds).toEqual(['first', 'second']);
  expect(result.maximizedBefore).toBe(true);
  expect(result.maximizedAfter).toBe(true);
  expect(result.snapshot).toEqual(result.restoredSnapshot);
});

test('untrusted snapshots are rejected before fromJSON touches the live layout', async ({ page }) => {
  expect(await page.evaluate(() => window.contract.nativeMalformedFailure())).toContain(
    'root must be of type branch',
  );
  await page.getByRole('button', { name: 'Add first panel' }).click();
  const result = await page.evaluate(() => window.contract.invalidRestoreCases());

  expect(result.rejections).toEqual({
    floating: 'floating-groups-disabled',
    floatingWrongType: 'floating-groups-disabled',
    edge: 'edge-groups-disabled',
    future: 'unsupported-layout-version',
    malformed: 'invalid-dockview-snapshot',
    pinned: 'pinned-tabs-disabled',
    popout: 'popout-groups-disabled',
    unknown: 'unknown-panel-component',
    unknownField: 'unknown-field',
    dangling: 'invalid-panel-reference',
    rootLeaf: 'invalid-dockview-snapshot',
  });
  expect(result.unchanged).toBe(true);
  expect(await page.evaluate(() => window.contract.disabledFeatureAttempts())).toEqual({
    floating: 'floating-groups-disabled',
    pinned: 'pinned-tabs-disabled',
    popout: 'popout-groups-disabled',
  });
  expect(await page.evaluate(() => window.contract.restoreCallCount())).toBe(0);
  expect(await page.evaluate(() => window.contract.quarantineCount())).toBe(11);
  await expect(page.getByRole('tab', { name: 'First' })).toBeVisible();
});

test('pinned Dockview and the parser both accept an empty nested branch', async ({ page }) => {
  expect(await page.evaluate(() => window.contract.nativeNestedEmptyBranchResult())).toEqual({
    native: 'accepted',
    parsed: 'accepted',
  });
});

async function shiftDragTab(page: import('playwright/test').Page, name: string) {
  const tab = page.getByRole('tab', { name });
  const box = await tab.boundingBox();
  expect(box).not.toBeNull();
  await page.keyboard.down('Shift');
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 180, box!.y + 160, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

test('the same Shift-drag floats in the control and is blocked when disabled', async ({ page }) => {
  await page.evaluate(() => window.contract.enableFloatingControl());
  await shiftDragTab(page, 'Floating control panel');
  await expect
    .poll(() => page.evaluate(() => window.contract.floatingControlSnapshot().floatingGroups?.length))
    .toBe(1);

  await page.reload();
  await expect(page.getByTestId('ready')).toHaveText('ready');
  await page.getByRole('button', { name: 'Add first panel' }).click();
  await shiftDragTab(page, 'First');

  expect(await page.evaluate(() => window.contract.snapshot().floatingGroups ?? [])).toEqual([]);
});

test('layout operations expose keyboard controls and Dockview tab semantics', async ({ page }) => {
  await page.getByRole('button', { name: 'Add first panel' }).click();
  await page.getByRole('button', { name: 'Add tab' }).click();

  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(2);
  await tabs.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(1)).toBeFocused();

  await page.getByRole('button', { name: 'Maximize first panel' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Restore layout' })).toBeEnabled();
  await page.getByRole('button', { name: 'Restore layout' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Restore layout' })).toBeDisabled();
});
