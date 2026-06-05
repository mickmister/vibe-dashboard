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
});
