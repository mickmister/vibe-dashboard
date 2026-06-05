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

type RpcResponse<T> = {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { message?: string; code?: number; data?: unknown };
};

const SAVED_VOYAGES_STATE_KEY =
  'engine|module|workspace|state.persistent|workspace-sessions';

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

async function mockVkApi(page: Page, workspace: MockWorkspace) {
  await page.route('**/vk-api/workspaces', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [workspace] }),
    });
  });

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

    await page.getByLabel('Embark craft in voyage').first().click();
    await page.getByRole('button', { name: 'Open Craft' }).last().click();
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
});
