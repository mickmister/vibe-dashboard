import { expect, test, type APIRequestContext, type Page } from 'playwright/test';

type MockWorkspace = {
  id: string;
  task_id: string;
  container_ref: string;
  branch: string;
  agent_working_dir: string;
  created_at: string;
  updated_at: string;
  archived: boolean;
  pinned: boolean;
  name: string;
};

function createMockWorkspace(runId: string): MockWorkspace {
  return {
    id: `e2e-workspace-${runId}`,
    task_id: `e2e-task-${runId}`,
    container_ref: `/tmp/e2e-workspace-${runId}`,
    branch: 'main',
    agent_working_dir: `/repos/e2e-existing-craft-${runId}`,
    created_at: '2026-06-04T00:00:00.000Z',
    updated_at: '2026-06-04T00:00:00.000Z',
    archived: false,
    pinned: false,
    name: `E2E Existing Craft ${runId}`,
  };
}

function createNamedMockWorkspace(
  runId: string,
  suffix: string,
  name: string,
): MockWorkspace {
  return {
    ...createMockWorkspace(`${runId}-${suffix}`),
    id: `e2e-workspace-${runId}-${suffix}`,
    task_id: `e2e-task-${runId}-${suffix}`,
    container_ref: `/tmp/e2e-workspace-${runId}-${suffix}`,
    agent_working_dir: `/repos/e2e-${suffix}-craft-${runId}`,
    name,
  };
}

type RpcResponse<T> = {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { message?: string; code?: number; data?: unknown };
};

const SAVED_VOYAGES_STATE_KEY =
  'engine|module|workspace|state.persistent|workspace-sessions';
const WORKSPACE_STATE_KEY = 'engine|module|workspace|state.persistent|workspace';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getShortIdToken(id: string, peerIds: string[] = [id]): string {
  const parts = id.split(/[_-]/).filter(Boolean);
  if (!parts.length) return id;

  for (let partCount = 1; partCount <= parts.length; partCount += 1) {
    const candidate = parts.slice(parts.length - partCount).join('_');
    const collision = peerIds.some((peerId) => {
      if (peerId === id) return false;
      const peerParts = peerId.split(/[_-]/).filter(Boolean);
      return peerParts.slice(peerParts.length - partCount).join('_') === candidate;
    });
    if (!collision) return candidate;
  }

  return id;
}

async function expectUrlVoyageToken(
  page: Page,
  voyageId: string,
  peerIds: string[] = [voyageId],
) {
  await expect(page).toHaveURL(
    new RegExp(`voyage=[^&#]*${escapeRegex(getShortIdToken(voyageId, peerIds))}`),
  );
}

async function callWorkspaceAction<T>(
  request: APIRequestContext,
  actionName: string,
  params: object,
): Promise<T> {
  const method = `engine|module|workspace|action|${actionName}`;
  const response = await request.post(`/rpc/${actionName}`, {
    data: {
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    },
  });
  expect(response.ok()).toBeTruthy();

  const body = (await response.json()) as RpcResponse<T>;
  expect(body.error, JSON.stringify(body.error)).toBeUndefined();
  return body.result as T;
}

async function getKvState<T>(
  request: APIRequestContext,
  key: string,
): Promise<T | null> {
  const response = await request.get(`/kv/get?key=${encodeURIComponent(key)}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as T | null;
}

async function waitForKvApi(request: APIRequestContext) {
  await expect
    .poll(async () => {
      const response = await request.get(
        `/kv/get?key=${encodeURIComponent(WORKSPACE_STATE_KEY)}`,
      );
      if (!response.ok()) return false;
      try {
        JSON.parse(await response.text());
        return true;
      } catch {
        return false;
      }
    })
    .toBe(true);
}

async function waitForSavedVoyageEntry(
  request: APIRequestContext,
  sessionId: string,
  expectedEntryId: string,
) {
  await expect
    .poll(async () => {
      const state = await getKvState<{
        version: number;
        data?: Array<{ id: string; activeVoyageEntryId: string }>;
      }>(request, SAVED_VOYAGES_STATE_KEY);
      return state?.data?.find((session) => session.id === sessionId)
        ?.activeVoyageEntryId;
    })
    .toBe(expectedEntryId);
}

async function waitForSavedVoyageWithCraft(
  request: APIRequestContext,
  sessionId: string,
  craftLabel: string,
) {
  await expect
    .poll(async () => {
      const [savedState, workspaceState] = await Promise.all([
        getKvState<{
          version: number;
          data?: Array<{
            id: string;
            activeVoyageEntryId: string;
            activeTabGroupId: string;
            voyageEntries: Array<{ id: string; tabGroupId: string; viewIds: string[] }>;
            activeItemsByVoyageEntryId?: Record<string, string>;
          }>;
        }>(request, SAVED_VOYAGES_STATE_KEY),
        getKvState<{
          tabGroups?: Array<{
            id: string;
            label: string;
            tabs: Array<{ id: string; title: string }>;
          }>;
        }>(request, WORKSPACE_STATE_KEY),
      ]);

      const session = savedState?.data?.find((entry) => entry.id === sessionId);
      const activeEntry = session?.voyageEntries.find(
        (entry) => entry.id === session.activeVoyageEntryId,
      );
      const activeCraft = workspaceState?.tabGroups?.find(
        (tabGroup) => tabGroup.id === activeEntry?.tabGroupId,
      );
      const activeAgentTab = activeCraft?.tabs.find((tab) => tab.title === 'Agent');
      const activeItemId =
        activeEntry && session?.activeItemsByVoyageEntryId?.[activeEntry.id];

      return {
        entryCount: session?.voyageEntries.length ?? 0,
        activeTabGroupId: session?.activeTabGroupId,
        activeCraftLabel: activeCraft?.label,
        activeEntryHasAgentView: Boolean(
          activeAgentTab &&
            activeEntry?.viewIds.includes(activeAgentTab.id) &&
            activeItemId === activeAgentTab.id,
        ),
      };
    })
    .toEqual({
      entryCount: 2,
      activeTabGroupId: expect.any(String),
      activeCraftLabel: craftLabel,
      activeEntryHasAgentView: true,
    });
}

async function waitForSavedVoyageCraftState(
  request: APIRequestContext,
  sessionId: string,
  expected: {
    entryLabels: string[];
    activeCraftLabel: string;
    activeItemTitle: string;
    activeTabGroupId?: string;
  },
) {
  await expect
    .poll(async () => {
      const [savedState, workspaceState] = await Promise.all([
        getKvState<{
          version: number;
          data?: Array<{
            id: string;
            activeVoyageEntryId: string;
            activeTabGroupId: string;
            voyageEntries: Array<{ id: string; tabGroupId: string; viewIds: string[] }>;
            activeItemsByVoyageEntryId?: Record<string, string>;
          }>;
        }>(request, SAVED_VOYAGES_STATE_KEY),
        getKvState<{
          tabGroups?: Array<{
            id: string;
            label: string;
            tabs: Array<{ id: string; title: string }>;
          }>;
        }>(request, WORKSPACE_STATE_KEY),
      ]);

      const session = savedState?.data?.find((entry) => entry.id === sessionId);
      const entryLabels =
        session?.voyageEntries.map((entry) => {
          const craft = workspaceState?.tabGroups?.find(
            (tabGroup) => tabGroup.id === entry.tabGroupId,
          );
          return craft?.label;
        }) ?? [];
      const activeEntry = session?.voyageEntries.find(
        (entry) => entry.id === session.activeVoyageEntryId,
      );
      const activeCraft = workspaceState?.tabGroups?.find(
        (tabGroup) => tabGroup.id === activeEntry?.tabGroupId,
      );
      const activeItemId =
        activeEntry && session?.activeItemsByVoyageEntryId?.[activeEntry.id];
      const activeItem = activeCraft?.tabs.find((tab) => tab.id === activeItemId);

      return {
        entryLabels,
        activeCraftLabel: activeCraft?.label,
        activeTabGroupId: session?.activeTabGroupId,
        activeItemTitle: activeItem?.title,
      };
    })
    .toEqual({
      entryLabels: expected.entryLabels,
      activeCraftLabel: expected.activeCraftLabel,
      activeTabGroupId: expected.activeTabGroupId || expect.any(String),
      activeItemTitle: expected.activeItemTitle,
    });
}

async function waitForSavedVoyageIdByName(
  request: APIRequestContext,
  voyageName: string,
): Promise<string> {
  let foundId = '';
  await expect
    .poll(async () => {
      const state = await getKvState<{
        version: number;
        data?: Array<{ id: string; name: string }>;
      }>(request, SAVED_VOYAGES_STATE_KEY);
      foundId = state?.data?.find((session) => session.name === voyageName)?.id || '';
      return foundId;
    })
    .not.toBe('');
  return foundId;
}

async function clearSavedVoyages(request: APIRequestContext) {
  await waitForKvApi(request);
  const state = await getKvState<{
    version: number;
    data?: Array<{ id: string }>;
  }>(request, SAVED_VOYAGES_STATE_KEY);

  for (const session of state?.data || []) {
    await callWorkspaceAction(request, 'deleteSavedSession', { id: session.id });
  }
}


async function getOverviewCraftSelection(request: APIRequestContext): Promise<{
  spaceId: string;
  tabGroupId: string;
  tabId: string;
}> {
  const workspace = await getKvState<{
    spaces?: Array<{ id: string; isSystem?: boolean; tabGroupIds: string[] }>;
    tabGroups?: Array<{ id: string; tabs: Array<{ id: string; title: string }> }>;
  }>(request, WORKSPACE_STATE_KEY);
  const homeSpace = workspace?.spaces?.find((space) => space.id === 'space_home') ||
    workspace?.spaces?.find((space) => space.isSystem) ||
    workspace?.spaces?.[0];
  expect(homeSpace).toBeTruthy();
  const tabGroup = workspace?.tabGroups?.find(
    (candidate) => candidate.id === homeSpace!.tabGroupIds[0],
  );
  expect(tabGroup).toBeTruthy();
  const tab = tabGroup!.tabs[0];
  expect(tab).toBeTruthy();
  return { spaceId: homeSpace!.id, tabGroupId: tabGroup!.id, tabId: tab!.id };
}

async function upsertSingleCraftVoyage(
  request: APIRequestContext,
  args: { id: string; slug: string; name: string },
) {
  const selection = await getOverviewCraftSelection(request);
  const entryId = `ve_${args.id}`;
  const now = '2026-06-10T00:00:00.000Z';
  await callWorkspaceAction(request, 'upsertSavedSession', {
    id: args.id,
    slug: args.slug,
    name: args.name,
    createdAt: now,
    updatedAt: now,
    activeVoyageEntryId: entryId,
    voyageEntries: [
      { id: entryId, tabGroupId: selection.tabGroupId, viewIds: [selection.tabId] },
    ],
    activeSpaceId: selection.spaceId,
    activeTabGroupId: selection.tabGroupId,
    activeItemsByVoyageEntryId: {
      [entryId]: selection.tabId,
    },
    visitedTabGroupIds: [selection.tabGroupId],
  });
}


async function waitForSavedVoyageFallbackAfterClose(
  request: APIRequestContext,
  args: {
    sessionId: string;
    fallbackEntryId: string;
    fallbackTabGroupId: string;
    closedEntryId: string;
    closedTabGroupId: string;
  },
) {
  await expect
    .poll(async () => {
      const [state, workspaceState] = await Promise.all([
        getKvState<{
          version: number;
          data?: Array<{
            id: string;
            activeVoyageEntryId: string;
            activeTabGroupId: string;
            voyageEntries: Array<{ id: string; tabGroupId: string; viewIds: string[] }>;
          }>;
        }>(request, SAVED_VOYAGES_STATE_KEY),
        getKvState<{
          tabGroups?: Array<{ id: string }>;
        }>(request, WORKSPACE_STATE_KEY),
      ]);
      const session = state?.data?.find((entry) => entry.id === args.sessionId);

      return {
        activeVoyageEntryId: session?.activeVoyageEntryId,
        activeTabGroupId: session?.activeTabGroupId,
        voyageEntryIds: session?.voyageEntries.map((entry) => entry.id) ?? [],
        voyageTabGroupIds: session?.voyageEntries.map((entry) => entry.tabGroupId) ?? [],
        closedEntryPresent: Boolean(
          session?.voyageEntries.some((entry) => entry.id === args.closedEntryId),
        ),
        closedTabGroupPresent: Boolean(
          session?.voyageEntries.some(
            (entry) => entry.tabGroupId === args.closedTabGroupId,
          ),
        ),
        closedWorkspaceTabGroupPresent: Boolean(
          workspaceState?.tabGroups?.some(
            (tabGroup) => tabGroup.id === args.closedTabGroupId,
          ),
        ),
      };
    })
    .toEqual({
      activeVoyageEntryId: args.fallbackEntryId,
      activeTabGroupId: args.fallbackTabGroupId,
      voyageEntryIds: [args.fallbackEntryId],
      voyageTabGroupIds: [args.fallbackTabGroupId],
      closedEntryPresent: false,
      closedTabGroupPresent: false,
      closedWorkspaceTabGroupPresent: false,
    });
}

function getVisibleVoyageActionsTrigger(page: Page) {
  return page
    .getByRole('button', { name: 'Voyage actions' })
    .filter({ visible: true });
}

async function openVoyageActionsMenu(page: Page) {
  await getVisibleVoyageActionsTrigger(page).click();
  return page.getByRole('menu', { name: 'Voyage actions' });
}

async function openVoyageSwitcher(page: Page) {
  const voyageActionsMenu = await openVoyageActionsMenu(page);
  await voyageActionsMenu
    .getByRole('menuitem', { name: 'Switch Voyage' })
    .click();
}

function getVoyageSwitcher(page: Page) {
  return page.getByRole('dialog', { name: 'Switch Voyage' });
}

function getVoyageSwitcherVoyageButton(page: Page, voyageName: string) {
  return getVoyageSwitcher(page)
    .getByRole('button')
    .filter({ hasText: voyageName })
    .first();
}

async function openCraftFromVoyageActionsMenu(page: Page) {
  const voyageActionsMenu = await openVoyageActionsMenu(page);
  await voyageActionsMenu
    .getByRole('menuitem', { name: 'Open Craft' })
    .click();
}

async function expectCurrentVoyage(page: Page, voyageName: string) {
  const voyageRow = getVoyageSwitcherVoyageButton(page, voyageName).locator(
    '..',
  );
  await expect(voyageRow.getByText('Current', { exact: true })).toBeVisible();
}

async function expectNotCurrentVoyage(page: Page, voyageName: string) {
  const voyageRow = getVoyageSwitcherVoyageButton(page, voyageName).locator(
    '..',
  );
  await expect(voyageRow.getByText('Current', { exact: true })).toHaveCount(0);
}

async function mockVkApi(
  page: Page,
  workspaceOrWorkspaces: MockWorkspace | MockWorkspace[],
  options: { workspaceDetailDelayMs?: number } = {},
) {
  const workspaces = Array.isArray(workspaceOrWorkspaces)
    ? workspaceOrWorkspaces
    : [workspaceOrWorkspaces];

  await page.route('**/vk-api/workspaces', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: workspaces }),
    });
  });

  for (const workspace of workspaces) {
    await page.route(`**/vk-api/workspaces/${workspace.id}`, async (route) => {
      if (options.workspaceDetailDelayMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, options.workspaceDetailDelayMs),
        );
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: workspace }),
      });
    });

    await page.route(`**/vk-api/workspaces/${workspace.id}/repos`, async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: `repo-${workspace.id}`,
              name: 'e2e-existing-craft',
              display_name: 'e2e-existing-craft',
              target_branch: 'main',
            },
          ],
        }),
      });
    });

    await page.route(`**/vk-api/workspaces/${workspace.id}/git/status`, async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: {} }),
      });
    });
  }
}

test.describe('voyage persistence', () => {
  test('creates the first Voyage from recovery UI and resumes cached root URL without sessionStorage', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    await clearSavedVoyages(page.request);
    await page.evaluate(() => {
      sessionStorage.clear();
      localStorage.removeItem('workspace-last-dashboard-url');
    });

    const runId = Date.now().toString(36);
    const voyageName = `E2E First Voyage ${runId}`;

    await page.goto('/');
    await expect(page.getByText('Create your first Voyage')).toBeVisible();
    await expect(page.getByText('A Voyage is the named set of craft and views')).toBeVisible();
    await page.getByPlaceholder('e.g. Client launch, Bug triage, Morning build').fill(voyageName);
    await page.getByRole('button', { name: 'Create Voyage' }).click();

    const sessionId = await waitForSavedVoyageIdByName(page.request, voyageName);
    await expect(page.getByRole('button', { name: 'Open Overview in Home' })).toBeVisible();
    await expectUrlVoyageToken(page, sessionId);
    await expect
      .poll(async () =>
        page.evaluate(() => localStorage.getItem('workspace-last-dashboard-url')),
      )
      .toContain('/?voyage=');

    await page.evaluate(() => sessionStorage.clear());
    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Open Overview in Home' })).toBeVisible();
    await expectUrlVoyageToken(page, sessionId);

    await callWorkspaceAction(page.request, 'deleteSavedSession', { id: sessionId });
  });

  test('uses cached root URL only when voyage is missing and strips transient params', async ({ page }) => {
    await page.goto('/');
    await clearSavedVoyages(page.request);

    const runId = Date.now().toString(36);
    const voyageAId = `session_cache_a_${runId}`;
    const voyageBId = `session_cache_b_${runId}`;
    const voyageASlug = `e2e-cache-a-${runId}-${voyageAId}`;
    const voyageBSlug = `e2e-cache-b-${runId}-${voyageBId}`;
    await upsertSingleCraftVoyage(page.request, {
      id: voyageAId,
      slug: voyageASlug,
      name: `E2E Cache Voyage A ${runId}`,
    });
    await upsertSingleCraftVoyage(page.request, {
      id: voyageBId,
      slug: voyageBSlug,
      name: `E2E Cache Voyage B ${runId}`,
    });

    await page.evaluate(
      (cachedUrl) => localStorage.setItem('workspace-last-dashboard-url', cachedUrl),
      `/dashboard?from_gh_url=https%3A%2F%2Fexample.invalid&voyage=${voyageASlug}`,
    );
    await page.goto('/');
    await expectUrlVoyageToken(page, voyageAId, [voyageAId, voyageBId]);
    await expect(page).not.toHaveURL(/from_gh_url/);
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem('workspace-last-dashboard-url')))
      .toMatch(/^\/\?voyage=/);

    await page.evaluate(
      (cachedUrl) => localStorage.setItem('workspace-last-dashboard-url', cachedUrl),
      `/?voyage=${voyageAId}`,
    );
    await page.goto(`/?voyage=${voyageBSlug}`);
    await expectUrlVoyageToken(page, voyageBId, [voyageAId, voyageBId]);

    await page.evaluate(
      (cachedUrl) => localStorage.setItem('workspace-last-dashboard-url', cachedUrl),
      '/?voyage=missing-voyage',
    );
    await callWorkspaceAction(page.request, 'deleteSavedSession', { id: voyageAId });
    await page.goto('/');
    await expectUrlVoyageToken(page, voyageBId);

    await callWorkspaceAction(page.request, 'deleteSavedSession', { id: voyageBId });
  });

  test('saves a named new voyage after opening an existing craft and keeps it after reload', async ({ page }) => {
    await clearSavedVoyages(page.request);
    await page.goto('/');
    await page.evaluate(() => sessionStorage.clear());

    const runId = Date.now().toString(36);
    await upsertSingleCraftVoyage(page.request, {
      id: `session_seed_${runId}`,
      slug: `e2e-seed-voyage-${runId}-session_seed_${runId}`,
      name: `E2E Seed Voyage ${runId}`,
    });
    const voyageName = `E2E Voyage ${runId}`;
    const workspace = createMockWorkspace(runId);
    await mockVkApi(page, workspace, { workspaceDetailDelayMs: 500 });

    await page.goto('/');

    await openVoyageSwitcher(page);

    await page.getByRole('button', { name: 'New Voyage', exact: true }).last().click();
    await page.getByPlaceholder('Required voyage name').fill(voyageName);
    await page.getByRole('button', { name: 'Open Existing Craft' }).click();

    await expect(page.getByRole('heading', { name: 'Open VK Workspace' })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(workspace.name) }).click();
    await expect(page.getByLabel(`Opening ${workspace.name}`).first()).toBeVisible();

    await expect(page.getByLabel(`Open ${workspace.name} in Home`).first()).toBeVisible();
    await expect(page).toHaveURL(/voyage=e2e-voyage-/);

    await openVoyageSwitcher(page);
    await expect(page.getByRole('button', { name: voyageName }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.reload();
    await expect(page.getByLabel(`Open ${workspace.name} in Home`).first()).toBeVisible();

    await openVoyageSwitcher(page);
    await expect(page.getByRole('button', { name: voyageName }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Go Home' }).click();

    await expect(page.getByRole('heading', { name: 'All Voyages' })).toBeVisible();
    await expect(page.getByText(voyageName).first()).toBeVisible();

    await openCraftFromVoyageActionsMenu(page);
    await page.getByRole('button', { name: new RegExp(workspace.name) }).click();
    await expect(page.getByLabel(`Open ${workspace.name} in Home`).first()).toBeVisible();

    const taskVoyageName = `E2E Task Voyage ${runId}`;
    await openVoyageSwitcher(page);
    await page.getByRole('button', { name: 'New Voyage', exact: true }).last().click();
    await page.getByPlaceholder('Required voyage name').fill(taskVoyageName);
    await page.getByRole('button', { name: 'Create New Craft' }).click();

    await expect(page.getByLabel('Open Create Workspace in Home').first()).toBeVisible();
    await expect(page).toHaveURL(/craft=create-workspace-/);
    await expect(page).toHaveURL(/views=create-workspace-/);

    await openVoyageSwitcher(page);
    await expect(page.getByRole('button', { name: taskVoyageName }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.reload();
    await expect(page.getByLabel('Open Create Workspace in Home').first()).toBeVisible();
    await expect(page).toHaveURL(/craft=create-workspace-/);
    await expect(page).toHaveURL(/views=create-workspace-/);
  });

  test('marks the URL-selected voyage current after switching and reopening the switcher', async ({ page }) => {
    await clearSavedVoyages(page.request);

    const runId = Date.now().toString(36);
    const voyageAId = `session_current_a_${runId}`;
    const voyageBId = `session_current_b_${runId}`;
    const voyageAName = `E2E Current Voyage A ${runId}`;
    const voyageBName = `E2E Current Voyage B ${runId}`;
    const craftALabel = `E2E Current Craft A ${runId}`;
    const craftBLabel = `E2E Current Craft B ${runId}`;
    const now = '2026-06-10T00:00:00.000Z';

    const craftA = await callWorkspaceAction<{
      spaceId: string;
      tabGroupId?: string;
    }>(page.request, 'addTabGroup', {
      spaceId: 'space_home',
      label: craftALabel,
    });
    const craftB = await callWorkspaceAction<{
      spaceId: string;
      tabGroupId?: string;
    }>(page.request, 'addTabGroup', {
      spaceId: 'space_home',
      label: craftBLabel,
    });
    expect(craftA.tabGroupId).toBeTruthy();
    expect(craftB.tabGroupId).toBeTruthy();

    const tabA = await callWorkspaceAction<{
      tabGroupId: string;
      tabId: string;
    }>(page.request, 'addTab', {
      tabGroupId: craftA.tabGroupId!,
      title: 'Agent',
      url: `https://example.invalid/${runId}/current-a`,
    });
    const tabB = await callWorkspaceAction<{
      tabGroupId: string;
      tabId: string;
    }>(page.request, 'addTab', {
      tabGroupId: craftB.tabGroupId!,
      title: 'Agent',
      url: `https://example.invalid/${runId}/current-b`,
    });

    await callWorkspaceAction(page.request, 'upsertSavedSession', {
      id: voyageAId,
      slug: `e2e-current-voyage-a-${runId}-${voyageAId}`,
      name: voyageAName,
      createdAt: now,
      updatedAt: now,
      activeVoyageEntryId: `ve_current_a_${runId}`,
      voyageEntries: [
        { id: `ve_current_a_${runId}`, tabGroupId: craftA.tabGroupId!, viewIds: [tabA.tabId] },
      ],
      activeSpaceId: 'space_home',
      activeTabGroupId: craftA.tabGroupId!,
      activeItemsByVoyageEntryId: {
        [`ve_current_a_${runId}`]: tabA.tabId,
      },
      visitedTabGroupIds: [craftA.tabGroupId!],
    });
    await callWorkspaceAction(page.request, 'upsertSavedSession', {
      id: voyageBId,
      slug: `e2e-current-voyage-b-${runId}-${voyageBId}`,
      name: voyageBName,
      createdAt: now,
      updatedAt: now,
      activeVoyageEntryId: `ve_current_b_${runId}`,
      voyageEntries: [
        { id: `ve_current_b_${runId}`, tabGroupId: craftB.tabGroupId!, viewIds: [tabB.tabId] },
      ],
      activeSpaceId: 'space_home',
      activeTabGroupId: craftB.tabGroupId!,
      activeItemsByVoyageEntryId: {
        [`ve_current_b_${runId}`]: tabB.tabId,
      },
      visitedTabGroupIds: [craftB.tabGroupId!],
    });

    await page.goto(`/dashboard?voyage=${voyageAId}`);
    await expect(
      page.getByRole('button', { name: `Open ${craftALabel} in Home` }),
    ).toBeVisible();

    await openVoyageSwitcher(page);
    await expectCurrentVoyage(page, voyageAName);
    await expectNotCurrentVoyage(page, voyageBName);

    await getVoyageSwitcherVoyageButton(page, voyageBName).click();
    await expectUrlVoyageToken(page, voyageBId, [voyageAId, voyageBId]);
    await expect(
      page.getByRole('button', { name: `Open ${craftBLabel} in Home` }),
    ).toBeVisible();

    await openVoyageSwitcher(page);
    await expectCurrentVoyage(page, voyageBName);
    await expectNotCurrentVoyage(page, voyageAName);
  });

  test('restores the selected duplicate craft entry by voyageEntryId after reload', async ({ page }) => {
    const runId = Date.now().toString(36);
    const craftLabel = `Duplicate Craft ${runId}`;
    const voyageId = `session_duplicate_${runId}`;
    const voyageName = `E2E Duplicate Voyage ${runId}`;
    const firstEntryId = `ve_${runId}_first`;
    const secondEntryId = `ve_${runId}_second`;
    const now = '2026-06-05T00:00:00.000Z';

    const addCraftResult = await callWorkspaceAction<{
      spaceId: string;
      tabGroupId?: string;
    }>(page.request, 'addTabGroup', {
      spaceId: 'space_home',
      label: craftLabel,
    });
    expect(addCraftResult.tabGroupId).toBeTruthy();
    const tabGroupId = addCraftResult.tabGroupId!;

    const agentTab = await callWorkspaceAction<{
      tabGroupId: string;
      tabId: string;
    }>(
      page.request,
      'addTab',
      {
        tabGroupId,
        title: 'Agent',
        url: `https://example.invalid/${runId}/agent`,
      },
    );
    const codeTab = await callWorkspaceAction<{
      tabGroupId: string;
      tabId: string;
    }>(
      page.request,
      'addTab',
      {
        tabGroupId,
        title: 'Code',
        url: `https://example.invalid/${runId}/code`,
      },
    );

    await callWorkspaceAction(page.request, 'upsertSavedSession', {
      id: voyageId,
      slug: `e2e-duplicate-voyage-${runId}-${voyageId}`,
      name: voyageName,
      createdAt: now,
      updatedAt: now,
      activeVoyageEntryId: firstEntryId,
      voyageEntries: [
        { id: firstEntryId, tabGroupId, viewIds: [agentTab.tabId] },
        { id: secondEntryId, tabGroupId, viewIds: [codeTab.tabId] },
      ],
      activeSpaceId: 'space_home',
      activeTabGroupId: tabGroupId,
      activeItemsByVoyageEntryId: {
        [firstEntryId]: agentTab.tabId,
        [secondEntryId]: codeTab.tabId,
      },
      visitedTabGroupIds: [tabGroupId],
    });
    await waitForSavedVoyageEntry(page.request, voyageId, firstEntryId);

    const tabGroupSuffix = tabGroupId.split('_').at(-1)!;
    const agentTabSuffix = agentTab.tabId.split('_').at(-1)!;
    const codeTabSuffix = codeTab.tabId.split('_').at(-1)!;
    const firstCraftParam = `duplicate-craft-${runId}-${tabGroupSuffix}-first`;
    const secondCraftParam = `duplicate-craft-${runId}-${tabGroupSuffix}-second`;

    await page.goto(`/dashboard?voyage=${voyageId}`);

    await expect(
      page.getByRole('button', { name: `Open ${craftLabel} in Home` }),
    ).toHaveCount(2);
    await expect(page).toHaveURL(new RegExp(`craft=${firstCraftParam}`));
    await expect(page).toHaveURL(new RegExp(`views=agent-${agentTabSuffix}`));

    await page
      .getByRole('button', { name: `Open ${craftLabel} in Home` })
      .nth(1)
      .click();
    await expect(page).toHaveURL(new RegExp(`craft=${secondCraftParam}`));
    await expect(page).toHaveURL(new RegExp(`views=code-${codeTabSuffix}`));
    await waitForSavedVoyageEntry(page.request, voyageId, secondEntryId);

    await page.evaluate(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete('craft');
      url.searchParams.delete('views');
      window.history.replaceState(null, '', url.toString());
    });
    await page.reload();

    await expect(
      page.getByRole('button', { name: `Open ${craftLabel} in Home` }),
    ).toHaveCount(2);
    await expect(page).toHaveURL(new RegExp(`craft=${secondCraftParam}`));
    await expect(page).toHaveURL(new RegExp(`views=code-${codeTabSuffix}`));
    await expect(page).not.toHaveURL(new RegExp(`craft=${firstCraftParam}`));
  });

  test('adds and persists a selected craft from the voyage plus Open Craft flow', async ({ page }) => {
    const runId = Date.now().toString(36);
    const initialCraftLabel = `Seed Craft ${runId}`;
    const existingCraftLabel = `E2E Opened Craft ${runId}`;
    const voyageId = `session_open_craft_${runId}`;
    const voyageSlug = `e2e-open-craft-voyage-${runId}-${voyageId}`;
    const voyageName = `E2E Open Craft Voyage ${runId}`;
    const initialEntryId = `ve_${runId}_seed`;
    const now = '2026-06-05T00:00:00.000Z';
    const workspaceToOpen = createNamedMockWorkspace(
      runId,
      'opened',
      existingCraftLabel,
    );
    await mockVkApi(page, workspaceToOpen);

    const addCraftResult = await callWorkspaceAction<{
      spaceId: string;
      tabGroupId?: string;
    }>(page.request, 'addTabGroup', {
      spaceId: 'space_home',
      label: initialCraftLabel,
    });
    expect(addCraftResult.tabGroupId).toBeTruthy();
    const initialTabGroupId = addCraftResult.tabGroupId!;

    const initialAgentTab = await callWorkspaceAction<{
      tabGroupId: string;
      tabId: string;
    }>(page.request, 'addTab', {
      tabGroupId: initialTabGroupId,
      title: 'Agent',
      url: `https://example.invalid/${runId}/seed-agent`,
    });

    const existingCraftResult = await callWorkspaceAction<{
      spaceId: string;
      tabGroupId?: string;
    }>(page.request, 'addTabGroup', {
      spaceId: 'space_home',
      label: existingCraftLabel,
    });
    expect(existingCraftResult.tabGroupId).toBeTruthy();
    const existingTabGroupId = existingCraftResult.tabGroupId!;

    await callWorkspaceAction(page.request, 'addTab', {
      tabGroupId: existingTabGroupId,
      title: 'Agent',
      url: `https://example.invalid/workspaces/${workspaceToOpen.id}`,
    });

    await callWorkspaceAction(page.request, 'upsertSavedSession', {
      id: voyageId,
      slug: voyageSlug,
      name: voyageName,
      createdAt: now,
      updatedAt: now,
      activeVoyageEntryId: initialEntryId,
      voyageEntries: [
        {
          id: initialEntryId,
          tabGroupId: initialTabGroupId,
          viewIds: [initialAgentTab.tabId],
        },
      ],
      activeSpaceId: 'space_home',
      activeTabGroupId: initialTabGroupId,
      activeItemsByVoyageEntryId: {
        [initialEntryId]: initialAgentTab.tabId,
      },
      visitedTabGroupIds: [initialTabGroupId],
    });
    await waitForSavedVoyageEntry(page.request, voyageId, initialEntryId);

    await page.goto(`/dashboard?voyage=${voyageId}`);

    await expect(
      page.getByRole('button', { name: `Open ${initialCraftLabel} in Home` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Open ${existingCraftLabel} in Home` }),
    ).toHaveCount(0);

    await openCraftFromVoyageActionsMenu(page);

    await expect(page.getByRole('heading', { name: 'Open VK Workspace' })).toBeVisible();
    await page.getByPlaceholder('Search workspaces...').fill(workspaceToOpen.name);
    await page.getByRole('button', { name: new RegExp(workspaceToOpen.name) }).click();

    await expect(
      page.getByRole('button', { name: `Open ${initialCraftLabel} in Home` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Open ${existingCraftLabel} in Home` }),
    ).toBeVisible();
    await expectUrlVoyageToken(page, voyageId);
    await waitForSavedVoyageWithCraft(page.request, voyageId, existingCraftLabel);

    await page
      .getByRole('button', { name: `Open ${initialCraftLabel} in Home` })
      .click();
    await expect(page).toHaveURL(new RegExp(`craft=seed-craft-${runId}`));

    await openCraftFromVoyageActionsMenu(page);
    await page.getByPlaceholder('Search workspaces...').fill(workspaceToOpen.name);
    await page.getByRole('button', { name: new RegExp(workspaceToOpen.name) }).click();
    await expect(page).toHaveURL(
      new RegExp(`craft=e2e-opened-craft-${runId}`),
    );
    await waitForSavedVoyageWithCraft(page.request, voyageId, existingCraftLabel);

    await page.reload();

    await expect(
      page.getByRole('button', { name: `Open ${initialCraftLabel} in Home` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Open ${existingCraftLabel} in Home` }),
    ).toBeVisible();
    await expectUrlVoyageToken(page, voyageId);
    await expect(page).toHaveURL(
      new RegExp(`craft=e2e-opened-craft-${runId}`),
    );
    await waitForSavedVoyageWithCraft(page.request, voyageId, existingCraftLabel);
  });

  test('moves a craft entry from one saved voyage to another and persists both voyages', async ({ page }) => {
    const runId = Date.now().toString(36);
    const sourceVoyageId = `session_move_source_${runId}`;
    const targetVoyageId = `session_move_target_${runId}`;
    const sourceVoyageSlug = `e2e-move-source-voyage-${runId}-${sourceVoyageId}`;
    const targetVoyageSlug = `e2e-move-target-voyage-${runId}-${targetVoyageId}`;
    const sourceVoyageName = `E2E Move Source Voyage ${runId}`;
    const targetVoyageName = `E2E Move Target Voyage ${runId}`;
    const movedCraftLabel = `Move Me Craft ${runId}`;
    const remainingCraftLabel = `Stay Put Craft ${runId}`;
    const targetSeedCraftLabel = `Target Seed Craft ${runId}`;
    const movedEntryId = `ve_${runId}_moved`;
    const remainingEntryId = `ve_${runId}_remaining`;
    const targetSeedEntryId = `ve_${runId}_target_seed`;
    const now = '2026-06-05T00:00:00.000Z';

    const movedCraftResult = await callWorkspaceAction<{
      spaceId: string;
      tabGroupId?: string;
    }>(page.request, 'addTabGroup', {
      spaceId: 'space_home',
      label: movedCraftLabel,
    });
    expect(movedCraftResult.tabGroupId).toBeTruthy();
    const movedTabGroupId = movedCraftResult.tabGroupId!;
    const movedAgentTab = await callWorkspaceAction<{
      tabGroupId: string;
      tabId: string;
    }>(page.request, 'addTab', {
      tabGroupId: movedTabGroupId,
      title: 'Agent',
      url: `https://example.invalid/${runId}/moved-agent`,
    });

    const remainingCraftResult = await callWorkspaceAction<{
      spaceId: string;
      tabGroupId?: string;
    }>(page.request, 'addTabGroup', {
      spaceId: 'space_home',
      label: remainingCraftLabel,
    });
    expect(remainingCraftResult.tabGroupId).toBeTruthy();
    const remainingTabGroupId = remainingCraftResult.tabGroupId!;
    const remainingAgentTab = await callWorkspaceAction<{
      tabGroupId: string;
      tabId: string;
    }>(page.request, 'addTab', {
      tabGroupId: remainingTabGroupId,
      title: 'Agent',
      url: `https://example.invalid/${runId}/remaining-agent`,
    });

    const targetSeedCraftResult = await callWorkspaceAction<{
      spaceId: string;
      tabGroupId?: string;
    }>(page.request, 'addTabGroup', {
      spaceId: 'space_home',
      label: targetSeedCraftLabel,
    });
    expect(targetSeedCraftResult.tabGroupId).toBeTruthy();
    const targetSeedTabGroupId = targetSeedCraftResult.tabGroupId!;
    const targetSeedAgentTab = await callWorkspaceAction<{
      tabGroupId: string;
      tabId: string;
    }>(page.request, 'addTab', {
      tabGroupId: targetSeedTabGroupId,
      title: 'Agent',
      url: `https://example.invalid/${runId}/target-seed-agent`,
    });

    await callWorkspaceAction(page.request, 'upsertSavedSession', {
      id: sourceVoyageId,
      slug: sourceVoyageSlug,
      name: sourceVoyageName,
      createdAt: now,
      updatedAt: now,
      activeVoyageEntryId: movedEntryId,
      voyageEntries: [
        {
          id: movedEntryId,
          tabGroupId: movedTabGroupId,
          viewIds: [movedAgentTab.tabId],
        },
        {
          id: remainingEntryId,
          tabGroupId: remainingTabGroupId,
          viewIds: [remainingAgentTab.tabId],
        },
      ],
      activeSpaceId: 'space_home',
      activeTabGroupId: movedTabGroupId,
      activeItemsByVoyageEntryId: {
        [movedEntryId]: movedAgentTab.tabId,
        [remainingEntryId]: remainingAgentTab.tabId,
      },
      visitedTabGroupIds: [movedTabGroupId, remainingTabGroupId],
    });
    await callWorkspaceAction(page.request, 'upsertSavedSession', {
      id: targetVoyageId,
      slug: targetVoyageSlug,
      name: targetVoyageName,
      createdAt: now,
      updatedAt: now,
      activeVoyageEntryId: targetSeedEntryId,
      voyageEntries: [
        {
          id: targetSeedEntryId,
          tabGroupId: targetSeedTabGroupId,
          viewIds: [targetSeedAgentTab.tabId],
        },
      ],
      activeSpaceId: 'space_home',
      activeTabGroupId: targetSeedTabGroupId,
      activeItemsByVoyageEntryId: {
        [targetSeedEntryId]: targetSeedAgentTab.tabId,
      },
      visitedTabGroupIds: [targetSeedTabGroupId],
    });
    await waitForSavedVoyageCraftState(page.request, sourceVoyageId, {
      entryLabels: [movedCraftLabel, remainingCraftLabel],
      activeCraftLabel: movedCraftLabel,
      activeItemTitle: 'Agent',
      activeTabGroupId: movedTabGroupId,
    });
    await waitForSavedVoyageCraftState(page.request, targetVoyageId, {
      entryLabels: [targetSeedCraftLabel],
      activeCraftLabel: targetSeedCraftLabel,
      activeItemTitle: 'Agent',
      activeTabGroupId: targetSeedTabGroupId,
    });

    await page.goto(`/dashboard?voyage=${sourceVoyageId}`);

    const movedCraftButton = page.getByRole('button', {
      name: `Open ${movedCraftLabel} in Home`,
    });
    await expect(movedCraftButton).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Open ${remainingCraftLabel} in Home` }),
    ).toBeVisible();

    await movedCraftButton.click({ button: 'right' });
    await page.getByRole('button', { name: 'Move to Voyage' }).click();
    await expect(
      page.getByText('Choose the voyage that should receive this craft.'),
    ).toBeVisible();
    await page
      .getByRole('dialog', { name: 'Move to Voyage' })
      .getByRole('button', { name: new RegExp(targetVoyageName) })
      .click();

    await expect(
      page.getByRole('button', { name: `Open ${remainingCraftLabel} in Home` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Open ${movedCraftLabel} in Home` }),
    ).toHaveCount(0);
    await waitForSavedVoyageCraftState(page.request, sourceVoyageId, {
      entryLabels: [remainingCraftLabel],
      activeCraftLabel: remainingCraftLabel,
      activeItemTitle: 'Agent',
      activeTabGroupId: remainingTabGroupId,
    });
    await waitForSavedVoyageCraftState(page.request, targetVoyageId, {
      entryLabels: [targetSeedCraftLabel, movedCraftLabel],
      activeCraftLabel: movedCraftLabel,
      activeItemTitle: 'Agent',
      activeTabGroupId: movedTabGroupId,
    });

    const movedTabGroupSuffix = movedTabGroupId.split('_').at(-1)!;
    const movedEntrySuffix = movedEntryId.split('_').at(-1)!;
    const movedTabSuffix = movedAgentTab.tabId.split('_').at(-1)!;
    const movedCraftParam = `move-me-craft-${runId}-${movedTabGroupSuffix}-${movedEntrySuffix}`;

    await page.goto(`/dashboard?voyage=${targetVoyageId}`);

    await expect(
      page.getByRole('button', { name: `Open ${targetSeedCraftLabel} in Home` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Open ${movedCraftLabel} in Home` }),
    ).toBeVisible();
    await expectUrlVoyageToken(page, targetVoyageId, [sourceVoyageId, targetVoyageId]);
    await expect(page).toHaveURL(new RegExp(`craft=${movedCraftParam}`));
    await expect(page).toHaveURL(new RegExp(`views=agent-${movedTabSuffix}`));

    await page.reload();

    await expect(
      page.getByRole('button', { name: `Open ${targetSeedCraftLabel} in Home` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Open ${movedCraftLabel} in Home` }),
    ).toBeVisible();
    await expectUrlVoyageToken(page, targetVoyageId, [sourceVoyageId, targetVoyageId]);
    await expect(page).toHaveURL(new RegExp(`craft=${movedCraftParam}`));
    await expect(page).toHaveURL(new RegExp(`views=agent-${movedTabSuffix}`));
    await waitForSavedVoyageCraftState(page.request, targetVoyageId, {
      entryLabels: [targetSeedCraftLabel, movedCraftLabel],
      activeCraftLabel: movedCraftLabel,
      activeItemTitle: 'Agent',
      activeTabGroupId: movedTabGroupId,
    });

    await page.goto(`/dashboard?voyage=${sourceVoyageId}`);
    await page.reload();

    await expect(
      page.getByRole('button', { name: `Open ${remainingCraftLabel} in Home` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Open ${movedCraftLabel} in Home` }),
    ).toHaveCount(0);
    await waitForSavedVoyageCraftState(page.request, sourceVoyageId, {
      entryLabels: [remainingCraftLabel],
      activeCraftLabel: remainingCraftLabel,
      activeItemTitle: 'Agent',
      activeTabGroupId: remainingTabGroupId,
    });
  });

  test('creates a target voyage when moving a craft and no other saved voyage exists', async ({ page }) => {
    await clearSavedVoyages(page.request);

    const runId = Date.now().toString(36);
    const sourceVoyageId = `session_move_new_target_source_${runId}`;
    const sourceVoyageName = `E2E Move New Target Source ${runId}`;
    const targetVoyageName = `E2E Created Move Target ${runId}`;
    const movedCraftLabel = `Move New Target Craft ${runId}`;
    const remainingCraftLabel = `Move New Target Remaining ${runId}`;
    const movedEntryId = `ve_${runId}_new_target_moved`;
    const remainingEntryId = `ve_${runId}_new_target_remaining`;
    const now = '2026-06-05T00:00:00.000Z';

    const movedCraftResult = await callWorkspaceAction<{
      spaceId: string;
      tabGroupId?: string;
    }>(page.request, 'addTabGroup', {
      spaceId: 'space_home',
      label: movedCraftLabel,
    });
    expect(movedCraftResult.tabGroupId).toBeTruthy();
    const movedTabGroupId = movedCraftResult.tabGroupId!;
    const movedAgentTab = await callWorkspaceAction<{
      tabGroupId: string;
      tabId: string;
    }>(page.request, 'addTab', {
      tabGroupId: movedTabGroupId,
      title: 'Agent',
      url: `https://example.invalid/${runId}/new-target-moved-agent`,
    });

    const remainingCraftResult = await callWorkspaceAction<{
      spaceId: string;
      tabGroupId?: string;
    }>(page.request, 'addTabGroup', {
      spaceId: 'space_home',
      label: remainingCraftLabel,
    });
    expect(remainingCraftResult.tabGroupId).toBeTruthy();
    const remainingTabGroupId = remainingCraftResult.tabGroupId!;
    const remainingAgentTab = await callWorkspaceAction<{
      tabGroupId: string;
      tabId: string;
    }>(page.request, 'addTab', {
      tabGroupId: remainingTabGroupId,
      title: 'Agent',
      url: `https://example.invalid/${runId}/new-target-remaining-agent`,
    });

    await callWorkspaceAction(page.request, 'upsertSavedSession', {
      id: sourceVoyageId,
      slug: `e2e-move-new-target-source-${runId}-${sourceVoyageId}`,
      name: sourceVoyageName,
      createdAt: now,
      updatedAt: now,
      activeVoyageEntryId: movedEntryId,
      voyageEntries: [
        {
          id: movedEntryId,
          tabGroupId: movedTabGroupId,
          viewIds: [movedAgentTab.tabId],
        },
        {
          id: remainingEntryId,
          tabGroupId: remainingTabGroupId,
          viewIds: [remainingAgentTab.tabId],
        },
      ],
      activeSpaceId: 'space_home',
      activeTabGroupId: movedTabGroupId,
      activeItemsByVoyageEntryId: {
        [movedEntryId]: movedAgentTab.tabId,
        [remainingEntryId]: remainingAgentTab.tabId,
      },
      visitedTabGroupIds: [movedTabGroupId, remainingTabGroupId],
    });

    await page.goto(`/dashboard?voyage=${sourceVoyageId}`);

    const movedCraftButton = page.getByRole('button', {
      name: `Open ${movedCraftLabel} in Home`,
    });
    await expect(movedCraftButton).toBeVisible();
    await movedCraftButton.click({ button: 'right' });
    await page.getByRole('button', { name: 'Move to Voyage' }).click();
    await expect(page.getByText('No other saved voyages yet.')).toBeVisible();

    page.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('prompt');
      await dialog.accept(targetVoyageName);
    });
    await page
      .getByRole('dialog', { name: 'Move to Voyage' })
      .getByRole('button', { name: 'Create New Voyage' })
      .click();

    await expect(
      page.getByRole('button', { name: `Open ${remainingCraftLabel} in Home` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Open ${movedCraftLabel} in Home` }),
    ).toHaveCount(0);

    const targetVoyageId = await waitForSavedVoyageIdByName(
      page.request,
      targetVoyageName,
    );
    await waitForSavedVoyageCraftState(page.request, sourceVoyageId, {
      entryLabels: [remainingCraftLabel],
      activeCraftLabel: remainingCraftLabel,
      activeItemTitle: 'Agent',
      activeTabGroupId: remainingTabGroupId,
    });
    await waitForSavedVoyageCraftState(page.request, targetVoyageId, {
      entryLabels: [movedCraftLabel],
      activeCraftLabel: movedCraftLabel,
      activeItemTitle: 'Agent',
      activeTabGroupId: movedTabGroupId,
    });
  });

  test('moves a craft entry from the URL-selected voyage into an existing saved voyage', async ({ page }) => {
    await clearSavedVoyages(page.request);

    const runId = Date.now().toString(36);
    const sourceVoyageId = `session_url_move_source_${runId}`;
    const sourceVoyageName = `E2E URL Move Source ${runId}`;
    const targetVoyageId = `session_unsaved_move_target_${runId}`;
    const targetVoyageName = `E2E Unsaved Move Target ${runId}`;
    const movedCraftLabel = `Unsaved Move Craft ${runId}`;
    const remainingCraftLabel = `Unsaved Remaining Craft ${runId}`;
    const targetSeedCraftLabel = `Unsaved Target Seed ${runId}`;
    const movedEntryId = `ve_${runId}_unsaved_moved`;
    const remainingEntryId = `ve_${runId}_unsaved_remaining`;
    const targetSeedEntryId = `ve_${runId}_unsaved_target_seed`;
    const now = '2026-06-05T00:00:00.000Z';

    const movedCraftResult = await callWorkspaceAction<{
      spaceId: string;
      tabGroupId?: string;
    }>(page.request, 'addTabGroup', {
      spaceId: 'space_home',
      label: movedCraftLabel,
    });
    expect(movedCraftResult.tabGroupId).toBeTruthy();
    const movedTabGroupId = movedCraftResult.tabGroupId!;
    const movedAgentTab = await callWorkspaceAction<{
      tabGroupId: string;
      tabId: string;
    }>(page.request, 'addTab', {
      tabGroupId: movedTabGroupId,
      title: 'Agent',
      url: `https://example.invalid/${runId}/unsaved-moved-agent`,
    });

    const remainingCraftResult = await callWorkspaceAction<{
      spaceId: string;
      tabGroupId?: string;
    }>(page.request, 'addTabGroup', {
      spaceId: 'space_home',
      label: remainingCraftLabel,
    });
    expect(remainingCraftResult.tabGroupId).toBeTruthy();
    const remainingTabGroupId = remainingCraftResult.tabGroupId!;
    const remainingAgentTab = await callWorkspaceAction<{
      tabGroupId: string;
      tabId: string;
    }>(page.request, 'addTab', {
      tabGroupId: remainingTabGroupId,
      title: 'Agent',
      url: `https://example.invalid/${runId}/unsaved-remaining-agent`,
    });

    const targetSeedCraftResult = await callWorkspaceAction<{
      spaceId: string;
      tabGroupId?: string;
    }>(page.request, 'addTabGroup', {
      spaceId: 'space_home',
      label: targetSeedCraftLabel,
    });
    expect(targetSeedCraftResult.tabGroupId).toBeTruthy();
    const targetSeedTabGroupId = targetSeedCraftResult.tabGroupId!;
    const targetSeedAgentTab = await callWorkspaceAction<{
      tabGroupId: string;
      tabId: string;
    }>(page.request, 'addTab', {
      tabGroupId: targetSeedTabGroupId,
      title: 'Agent',
      url: `https://example.invalid/${runId}/unsaved-target-seed-agent`,
    });

    await callWorkspaceAction(page.request, 'upsertSavedSession', {
      id: sourceVoyageId,
      slug: `e2e-url-move-source-${runId}-${sourceVoyageId}`,
      name: sourceVoyageName,
      createdAt: now,
      updatedAt: now,
      activeVoyageEntryId: movedEntryId,
      voyageEntries: [
        {
          id: movedEntryId,
          tabGroupId: movedTabGroupId,
          viewIds: [movedAgentTab.tabId],
        },
        {
          id: remainingEntryId,
          tabGroupId: remainingTabGroupId,
          viewIds: [remainingAgentTab.tabId],
        },
      ],
      activeSpaceId: 'space_home',
      activeTabGroupId: movedTabGroupId,
      activeItemsByVoyageEntryId: {
        [movedEntryId]: movedAgentTab.tabId,
        [remainingEntryId]: remainingAgentTab.tabId,
      },
      visitedTabGroupIds: [movedTabGroupId, remainingTabGroupId],
    });

    await callWorkspaceAction(page.request, 'upsertSavedSession', {
      id: targetVoyageId,
      slug: `e2e-unsaved-move-target-${runId}-${targetVoyageId}`,
      name: targetVoyageName,
      createdAt: now,
      updatedAt: now,
      activeVoyageEntryId: targetSeedEntryId,
      voyageEntries: [
        {
          id: targetSeedEntryId,
          tabGroupId: targetSeedTabGroupId,
          viewIds: [targetSeedAgentTab.tabId],
        },
      ],
      activeSpaceId: 'space_home',
      activeTabGroupId: targetSeedTabGroupId,
      activeItemsByVoyageEntryId: {
        [targetSeedEntryId]: targetSeedAgentTab.tabId,
      },
      visitedTabGroupIds: [targetSeedTabGroupId],
    });

    await page.goto(`/dashboard?voyage=${sourceVoyageId}`);

    const movedCraftButton = page.getByRole('button', {
      name: `Open ${movedCraftLabel} in Home`,
    });
    await expect(movedCraftButton).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Open ${remainingCraftLabel} in Home` }),
    ).toBeVisible();

    await movedCraftButton.click({ button: 'right' });
    await page.getByRole('button', { name: 'Move to Voyage' }).click();
    await page
      .getByRole('dialog', { name: 'Move to Voyage' })
      .getByRole('button', { name: new RegExp(targetVoyageName) })
      .click();

    await expect(
      page.getByRole('button', { name: `Open ${remainingCraftLabel} in Home` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Open ${movedCraftLabel} in Home` }),
    ).toHaveCount(0);
    await waitForSavedVoyageCraftState(page.request, sourceVoyageId, {
      entryLabels: [remainingCraftLabel],
      activeCraftLabel: remainingCraftLabel,
      activeItemTitle: 'Agent',
      activeTabGroupId: remainingTabGroupId,
    });
    await waitForSavedVoyageCraftState(page.request, targetVoyageId, {
      entryLabels: [targetSeedCraftLabel, movedCraftLabel],
      activeCraftLabel: movedCraftLabel,
      activeItemTitle: 'Agent',
      activeTabGroupId: movedTabGroupId,
    });
  });

  test('falls back within the current saved voyage after closing the active craft everywhere', async ({ page }) => {
    const runId = Date.now().toString(36);
    const fallbackCraftLabel = `Fallback Craft ${runId}`;
    const activeCraftLabel = `Active Craft ${runId}`;
    const voyageId = `session_close_active_${runId}`;
    const voyageName = `E2E Close Active Voyage ${runId}`;
    const fallbackEntryId = `ve_${runId}_fallback`;
    const activeEntryId = `ve_${runId}_active`;
    const now = '2026-06-05T00:00:00.000Z';

    const fallbackCraftResult = await callWorkspaceAction<{
      spaceId: string;
      tabGroupId?: string;
    }>(page.request, 'addTabGroup', {
      spaceId: 'space_home',
      label: fallbackCraftLabel,
    });
    expect(fallbackCraftResult.tabGroupId).toBeTruthy();
    const fallbackTabGroupId = fallbackCraftResult.tabGroupId!;

    const fallbackAgentTab = await callWorkspaceAction<{
      tabGroupId: string;
      tabId: string;
    }>(page.request, 'addTab', {
      tabGroupId: fallbackTabGroupId,
      title: 'Agent',
      url: `https://example.invalid/${runId}/fallback-agent`,
    });

    const activeCraftResult = await callWorkspaceAction<{
      spaceId: string;
      tabGroupId?: string;
    }>(page.request, 'addTabGroup', {
      spaceId: 'space_home',
      label: activeCraftLabel,
    });
    expect(activeCraftResult.tabGroupId).toBeTruthy();
    const activeTabGroupId = activeCraftResult.tabGroupId!;

    const activeAgentTab = await callWorkspaceAction<{
      tabGroupId: string;
      tabId: string;
    }>(page.request, 'addTab', {
      tabGroupId: activeTabGroupId,
      title: 'Agent',
      url: `https://example.invalid/${runId}/active-agent`,
    });

    await callWorkspaceAction(page.request, 'upsertSavedSession', {
      id: voyageId,
      slug: `e2e-close-active-voyage-${runId}-${voyageId}`,
      name: voyageName,
      createdAt: now,
      updatedAt: now,
      activeVoyageEntryId: activeEntryId,
      voyageEntries: [
        {
          id: fallbackEntryId,
          tabGroupId: fallbackTabGroupId,
          viewIds: [fallbackAgentTab.tabId],
        },
        {
          id: activeEntryId,
          tabGroupId: activeTabGroupId,
          viewIds: [activeAgentTab.tabId],
        },
      ],
      activeSpaceId: 'space_home',
      activeTabGroupId,
      activeItemsByVoyageEntryId: {
        [fallbackEntryId]: fallbackAgentTab.tabId,
        [activeEntryId]: activeAgentTab.tabId,
      },
      visitedTabGroupIds: [fallbackTabGroupId, activeTabGroupId],
    });
    await waitForSavedVoyageEntry(page.request, voyageId, activeEntryId);

    const fallbackTabGroupSuffix = fallbackTabGroupId.split('_').at(-1)!;
    const activeTabGroupSuffix = activeTabGroupId.split('_').at(-1)!;
    const fallbackTabSuffix = fallbackAgentTab.tabId.split('_').at(-1)!;
    const activeTabSuffix = activeAgentTab.tabId.split('_').at(-1)!;
    const fallbackCraftParam = `fallback-craft-${runId}-${fallbackTabGroupSuffix}`;
    const activeCraftParam = `active-craft-${runId}-${activeTabGroupSuffix}`;

    await page.goto(`/dashboard?voyage=${voyageId}`);

    await expect(
      page.getByRole('button', { name: `Open ${fallbackCraftLabel} in Home` }),
    ).toBeVisible();
    const activeCraftButton = page.getByRole('button', {
      name: `Open ${activeCraftLabel} in Home`,
    });
    await expect(activeCraftButton).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`craft=${activeCraftParam}`));
    await expect(page).toHaveURL(new RegExp(`views=agent-${activeTabSuffix}`));

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain(`Close "${activeCraftLabel}" everywhere?`);
      expect(dialog.message()).toContain(
        'This deletes the craft, not just from the current voyage.',
      );
      await dialog.accept();
    });
    await activeCraftButton.click({ button: 'right' });
    await page.getByRole('button', { name: 'Close Craft Everywhere' }).click();

    await expect(
      page.getByRole('button', { name: `Open ${fallbackCraftLabel} in Home` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Open ${activeCraftLabel} in Home` }),
    ).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`craft=${fallbackCraftParam}`));
    await expect(page).toHaveURL(new RegExp(`views=agent-${fallbackTabSuffix}`));
    await expect(page).not.toHaveURL(new RegExp(`craft=${activeCraftParam}`));
    await waitForSavedVoyageFallbackAfterClose(page.request, {
      sessionId: voyageId,
      fallbackEntryId,
      fallbackTabGroupId,
      closedEntryId: activeEntryId,
      closedTabGroupId: activeTabGroupId,
    });

    await page.reload();

    await waitForSavedVoyageFallbackAfterClose(page.request, {
      sessionId: voyageId,
      fallbackEntryId,
      fallbackTabGroupId,
      closedEntryId: activeEntryId,
      closedTabGroupId: activeTabGroupId,
    });
    await expect(
      page.getByRole('button', { name: `Open ${fallbackCraftLabel} in Home` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Open ${activeCraftLabel} in Home` }),
    ).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`craft=${fallbackCraftParam}`));
    await expect(page).toHaveURL(new RegExp(`views=agent-${fallbackTabSuffix}`));
  });

});
