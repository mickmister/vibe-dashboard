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
      activeTabGroupId: expect.any(String),
      activeItemTitle: expected.activeItemTitle,
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
      const state = await getKvState<{
        version: number;
        data?: Array<{
          id: string;
          activeVoyageEntryId: string;
          activeTabGroupId: string;
          voyageEntries: Array<{ id: string; tabGroupId: string; viewIds: string[] }>;
        }>;
      }>(request, SAVED_VOYAGES_STATE_KEY);
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
      };
    })
    .toEqual({
      activeVoyageEntryId: args.fallbackEntryId,
      activeTabGroupId: args.fallbackTabGroupId,
      voyageEntryIds: [args.fallbackEntryId],
      voyageTabGroupIds: [args.fallbackTabGroupId],
      closedEntryPresent: false,
      closedTabGroupPresent: false,
    });
}

async function openCraftFromVoyagePlusMenu(page: Page) {
  await page.getByLabel('Embark craft in voyage').first().click();
  await page
    .locator('div.fixed.z-\\[92\\] button')
    .filter({ hasText: 'Open Craft' })
    .click();
}

async function mockVkApi(page: Page, workspaceOrWorkspaces: MockWorkspace | MockWorkspace[]) {
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
  test('saves a named new voyage after opening an existing craft and keeps it after reload', async ({ page }) => {
    const runId = Date.now().toString(36);
    const voyageName = `E2E Voyage ${runId}`;
    const workspace = createMockWorkspace(runId);
    await mockVkApi(page, workspace);

    await page.goto('/');

    await page.getByLabel('Open voyage switcher').first().click();
    await expect(page.getByText('No saved voyages yet.')).toBeVisible();

    await page.getByRole('button', { name: 'New Voyage', exact: true }).last().click();
    await page.getByPlaceholder('Required voyage name').fill(voyageName);
    await page.getByRole('button', { name: 'Open Existing Craft' }).click();

    await expect(page.getByRole('heading', { name: 'Open VK Workspace' })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(workspace.name) }).click();

    await expect(page.getByLabel(`Open ${workspace.name} in Home`).first()).toBeVisible();
    await expect(page).toHaveURL(/voyage=e2e-voyage-/);

    await page.getByLabel('Open voyage switcher').first().click();
    await expect(page.getByRole('button', { name: voyageName }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.reload();
    await expect(page.getByLabel(`Open ${workspace.name} in Home`).first()).toBeVisible();

    await page.getByLabel('Open voyage switcher').first().click();
    await expect(page.getByRole('button', { name: voyageName }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Go Home' }).click();

    await expect(page.getByRole('heading', { name: 'All Voyages' })).toBeVisible();
    await expect(page.getByText(voyageName).first()).toBeVisible();

    await openCraftFromVoyagePlusMenu(page);
    await page.getByRole('button', { name: new RegExp(workspace.name) }).click();
    await expect(page.getByLabel(`Open ${workspace.name} in Home`).first()).toBeVisible();

    const taskVoyageName = `E2E Task Voyage ${runId}`;
    await page.getByLabel('Open voyage switcher').first().click();
    await page.getByRole('button', { name: 'New Voyage', exact: true }).last().click();
    await page.getByPlaceholder('Required voyage name').fill(taskVoyageName);
    await page.getByRole('button', { name: 'Create New Task' }).click();

    await expect(page.getByLabel('Open Create Workspace in Home').first()).toBeVisible();
    await expect(page).toHaveURL(/craft=create-workspace-/);
    await expect(page).toHaveURL(/views=create-workspace-/);

    await page.getByLabel('Open voyage switcher').first().click();
    await expect(page.getByRole('button', { name: taskVoyageName }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.reload();
    await expect(page.getByLabel('Open Create Workspace in Home').first()).toBeVisible();
    await expect(page).toHaveURL(/craft=create-workspace-/);
    await expect(page).toHaveURL(/views=create-workspace-/);
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

    await openCraftFromVoyagePlusMenu(page);

    await expect(page.getByRole('heading', { name: 'Open VK Workspace' })).toBeVisible();
    await page.getByPlaceholder('Search workspaces...').fill(workspaceToOpen.name);
    await page.getByRole('button', { name: new RegExp(workspaceToOpen.name) }).click();

    await expect(
      page.getByRole('button', { name: `Open ${initialCraftLabel} in Home` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Open ${existingCraftLabel} in Home` }),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`voyage=${voyageSlug}`));
    await waitForSavedVoyageWithCraft(page.request, voyageId, existingCraftLabel);

    await page.reload();

    await expect(
      page.getByRole('button', { name: `Open ${initialCraftLabel} in Home` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Open ${existingCraftLabel} in Home` }),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`voyage=${voyageSlug}`));
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
    });
    await waitForSavedVoyageCraftState(page.request, targetVoyageId, {
      entryLabels: [targetSeedCraftLabel],
      activeCraftLabel: targetSeedCraftLabel,
      activeItemTitle: 'Agent',
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
      .locator('div.fixed.z-\\[94\\] button')
      .filter({ hasText: targetVoyageName })
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
    });
    await waitForSavedVoyageCraftState(page.request, targetVoyageId, {
      entryLabels: [targetSeedCraftLabel, movedCraftLabel],
      activeCraftLabel: movedCraftLabel,
      activeItemTitle: 'Agent',
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
    await expect(page).toHaveURL(new RegExp(`voyage=${targetVoyageSlug}`));
    await expect(page).toHaveURL(new RegExp(`craft=${movedCraftParam}`));
    await expect(page).toHaveURL(new RegExp(`views=agent-${movedTabSuffix}`));

    await page.reload();

    await expect(
      page.getByRole('button', { name: `Open ${targetSeedCraftLabel} in Home` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Open ${movedCraftLabel} in Home` }),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`voyage=${targetVoyageSlug}`));
    await expect(page).toHaveURL(new RegExp(`craft=${movedCraftParam}`));
    await expect(page).toHaveURL(new RegExp(`views=agent-${movedTabSuffix}`));
    await waitForSavedVoyageCraftState(page.request, targetVoyageId, {
      entryLabels: [targetSeedCraftLabel, movedCraftLabel],
      activeCraftLabel: movedCraftLabel,
      activeItemTitle: 'Agent',
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
