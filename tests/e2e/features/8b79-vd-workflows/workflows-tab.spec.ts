/**
 * Covers:
 * - test-plans/branches/8b79-vd-workflows/test-plan-3.md
 * - TEST_CASE_M94_1A
 * - TEST_CASE_M94_1B
 */
import { expect, test } from 'playwright/test';

const forbiddenTerms = ['webhook', 'HMAC', 'queue item', 'trigger', 'delivery ID', 'execution process ID', 'runReady', 'raw JSON', 'raw XML', 'WorkflowStepState'];

test.describe('Workspace Workflows tab shell', () => {
  test('shows workspace-scoped workflows home without debug terms', async ({ page }) => {
    await page.route('**/dashboard/api/workflows/home?**', async (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get('workspaceId')).toBe('workspace-e2e');
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          home: {
            workspaceId: 'workspace-e2e',
            availableWorkflows: [
              { id: 'design-dev-review-tester', title: 'Dev Review Tester', description: 'Feature work loop', source: 'published_design', status: 'ready', version: 1, unavailableReason: null },
            ],
            recentRuns: [
              { runId: 'run-clean', workflowName: 'Feature workflow run', status: 'running', startedAt: 1, updatedAt: 2, detailUrl: null },
            ],
            needsInput: [
              { attentionItemId: 'attention-clean', title: 'Answer planning questions', description: 'Please fill out the form.', workflowName: 'Feature workflow run', createdAt: 3, detailUrl: '/dashboard/workflows/legacy-clean' },
            ],
          },
        }),
      });
    });

    await page.goto('/dashboard/workflows?workspaceId=workspace-e2e');

    await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Available workflows' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent runs' })).toBeVisible();
    await expect(page.getByText('Dev Review Tester')).toBeVisible();
    await expect(page.locator('a[href="/dashboard/workflows/legacy-clean"]')).toBeVisible();
    await expect(page.getByText('Answer planning questions')).toBeVisible();
    await expect(page.locator('a[href="/dashboard/workflows/run-clean"]')).toHaveCount(0);
    for (const term of forbiddenTerms) {
      await expect(page.getByText(term, { exact: false })).toHaveCount(0);
    }
  });
});
