/**
 * Covers:
 * - test-plans/branches/8b79-vd-workflows/test-plan-3.md
 * - TEST_CASE_M94_1A
 * - TEST_CASE_M94_1B
 * - TEST_CASE_M95_1A
 * - TEST_CASE_M95_1B
 */
import { expect, test } from 'playwright/test';

const forbiddenTerms = ['webhook', 'HMAC', 'queue item', 'trigger', 'delivery ID', 'execution process ID', 'runReady', 'raw JSON', 'raw XML', 'WorkflowStepState'];
const workflow = { id: 'design-dev-review-tester', title: 'Dev Review Tester', description: 'Feature work loop', source: 'published_design', status: 'ready', version: 1, unavailableReason: null, canRun: true, inputs: [{ id: 'featureRequest', type: 'markdown', required: true, description: null }], roles: [{ id: 'dev', label: 'Dev', description: null }, { id: 'review', label: 'Review', description: null }] };

test.describe('Workspace Workflows tab shell', () => {
  test('shows workspace-scoped workflows home without debug terms', async ({ page }) => {
    await page.route('**/dashboard/api/workflows/home?**', async (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get('workspaceId')).toBe('workspace-e2e');
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ home: homeFixture(false) }),
      });
    });

    await page.goto('/dashboard/workflows?workspaceId=workspace-e2e');

    await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Available workflows' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent runs' })).toBeVisible();
    await expect(page.getByText('Dev Review Tester')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run' })).toBeVisible();
    await expect(page.locator('a[href="/dashboard/workflows/legacy-clean"]')).toBeVisible();
    await expect(page.getByText('Answer planning questions')).toBeVisible();
    await expect(page.locator('a[href="/dashboard/workflows/run-clean"]')).toHaveCount(0);
    for (const term of forbiddenTerms) {
      await expect(page.getByText(term, { exact: false })).toHaveCount(0);
    }
  });

  test('launches a workflow with required input validation and runtime session binding', async ({ page }) => {
    let launched = false;
    await page.route('**/dashboard/api/workflows/home?**', async (route) => {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ home: homeFixture(launched) }) });
    });
    await page.route('**/dashboard/api/workflows/launch-options?**', async (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get('workspaceId')).toBe('workspace-e2e');
      expect(url.searchParams.get('designId')).toBe('design-dev-review-tester');
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ options: { workspaceId: 'workspace-e2e', workflow, sessions: [{ sessionId: 'session-dev', name: 'Dev session', executor: 'CODEX', workspaceId: 'workspace-e2e' }, { sessionId: 'session-review', name: 'Review session', executor: 'CODEX', workspaceId: 'workspace-e2e' }] } }),
      });
    });
    await page.route('**/dashboard/api/workflows/launch', async (route) => {
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({ workspaceId: 'workspace-e2e', designId: 'design-dev-review-tester', inputs: { featureRequest: 'Build a clean launch flow' }, additionalInstructions: 'Keep this run small.', roleBindings: { dev: { mode: 'existing', sessionId: 'session-dev' }, review: { mode: 'create_or_reuse', name: 'Review agent' } } });
      launched = true;
      await route.fulfill({ contentType: 'application/json', status: 201, body: JSON.stringify({ run: { runId: 'run-launched', workspaceId: 'workspace-e2e', status: 'running', detailUrl: null }, home: homeFixture(true) }) });
    });

    await page.goto('/dashboard/workflows?workspaceId=workspace-e2e');
    await page.getByRole('button', { name: 'Run' }).click();
    await page.getByRole('button', { name: 'Launch workflow' }).click();
    await expect(page.getByText('This field is required.')).toBeVisible();
    await page.getByLabel('featureRequest *').fill('Build a clean launch flow');
    await page.getByLabel('Additional instructions for this run').fill('Keep this run small.');
    await page.getByLabel('Dev session').selectOption('session-dev');
    await page.getByText('Create or reuse by name').nth(1).click();
    await page.getByLabel('Review session name').fill('Review agent');
    await page.getByRole('button', { name: 'Launch workflow' }).click();

    await expect(page.getByText('Launched workflow run')).toBeVisible();
    await expect(page.locator('a[href="/dashboard/workflows/run-launched"]')).toHaveCount(0);
    for (const term of forbiddenTerms) {
      await expect(page.getByText(term, { exact: false })).toHaveCount(0);
    }
  });
});

function homeFixture(launched: boolean) {
  return {
    workspaceId: 'workspace-e2e',
    availableWorkflows: [workflow],
    recentRuns: launched
      ? [{ runId: 'run-launched', workflowName: 'Launched workflow run', status: 'running', startedAt: 4, updatedAt: 5, detailUrl: null }]
      : [{ runId: 'run-clean', workflowName: 'Feature workflow run', status: 'running', startedAt: 1, updatedAt: 2, detailUrl: null }],
    needsInput: [
      { attentionItemId: 'attention-clean', title: 'Answer planning questions', description: 'Please fill out the form.', workflowName: 'Feature workflow run', createdAt: 3, detailUrl: '/dashboard/workflows/legacy-clean' },
    ],
  };
}
