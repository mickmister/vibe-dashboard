import { expect, test, type Page } from 'playwright/test';

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
  });
});
