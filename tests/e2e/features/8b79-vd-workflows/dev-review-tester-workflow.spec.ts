/**
 * Covers:
 * - test-plans/branches/8b79-vd-workflows/test-plan-3.md
 * - TEST_CASE_M98_1B
 * - M98E2 literal Docker qa-mode Dev / Review / Tester acceptance
 */
import { expect, test, type APIRequestContext, type Page } from 'playwright/test';

const sandboxUrl = process.env.VK_MOCKED_SANDBOX_URL ?? 'http://127.0.0.1:50005';

type Workspace = { id: string; name?: string | null; branch?: string | null };
type Presentation = {
  workflowName: string;
  status: string;
  originalTask: string | null;
  timeline: Array<{
    role: string;
    title: string;
    initialMessage: { text: string } | null;
    finalResponse: { text: string } | null;
  }>;
};

test.describe('Docker qa-mode Dev / Review / Tester persisted workflow', () => {
  test.skip(!process.env.VK_QA_SCRIPTED_OUTCOME_FILE, 'DRT Docker acceptance requires sequential qa-mode scripted responses.');

  test('runs happy path with Review→Dev and Tester→Dev loops through generic persisted runtime', async ({ page }) => {
    test.setTimeout(900_000);

    await expectDashboardHealth(page.request);
    const workspace = await firstWorkspace(page.request);
    await expectProvisionedWebhook(page.request);

    const unique = Date.now();
    const designId = `design-drt-docker-${unique}`;
    const draftId = `draft-drt-docker-${unique}`;
    const task = `Docker qa-mode generic DRT workflow ${unique}`;

    const used = await page.request.post(new URL('/dashboard/api/workflow-templates/built-in%2Fdev-review-tester/use', sandboxUrl).toString(), {
      data: { workspaceId: workspace.id, designId, draftId, publish: true },
    });
    expect(used.status()).toBe(201);

    const launched = await page.request.post(new URL('/dashboard/api/workflows/launch', sandboxUrl).toString(), {
      data: {
        workspaceId: workspace.id,
        designId,
        inputs: { featureRequest: task },
        additionalInstructions: 'Run the Docker qa-mode DRT acceptance script.',
        roleBindings: {
          dev: { mode: 'create_or_reuse', name: `drt-dev-${unique}` },
          review: { mode: 'create_or_reuse', name: `drt-review-${unique}` },
          tester: { mode: 'create_or_reuse', name: `drt-tester-${unique}` },
        },
      },
    });
    expect(launched.status()).toBe(201);
    const launchBody = await launched.json() as { run: { runId: string; detailUrl: string | null } };
    expect(launchBody.run.detailUrl).toBe(`/dashboard/workflows/${launchBody.run.runId}`);

    const presentation = await waitForPersistedPresentationCompleted(page.request, launchBody.run.runId);
    expect(presentation.workflowName).toBe('Dev / Review / Tester');
    expect(presentation.originalTask).toBe(task);
    const renderedPresentation = JSON.stringify(presentation);
    expect(renderedPresentation).toContain('Review requested changes; Dev will revise');
    expect(renderedPresentation).toContain('Requested changes form: Structured form recorded.');
    expect(renderedPresentation).toContain('Tester found a bug; Dev will revise');
    expect(renderedPresentation).toContain('Acceptance passed in Docker qa-mode after loops.');
    expect(renderedPresentation).not.toContain('<beadsForm');

    await page.goto(`/dashboard/workflows/${encodeURIComponent(launchBody.run.runId)}`);
    await expect(page.getByRole('heading', { name: 'Dev / Review / Tester' })).toBeVisible();
    const originalTaskSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Original task' }) });
    await expect(originalTaskSection.getByText(task, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Run story' })).toBeVisible();
    await expect(page.getByText('Dev').first()).toBeVisible();
    await expect(page.getByText('Review').first()).toBeVisible();
    await expect(page.getByText('Tester').first()).toBeVisible();
    await expect(page.getByText('Structured form recorded.').first()).toBeVisible();
    await expect(page.getByText('Tester found a representative qa-mode bug.').first()).toBeVisible();
    await expect(page.getByText('Acceptance passed in Docker qa-mode after loops.').first()).toBeVisible();

    await page.goto(`/dashboard/workflows?workspaceId=${encodeURIComponent(workspace.id)}`);
    await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();
    await expect(page.locator(`a[href="/dashboard/workflows/${launchBody.run.runId}"]`).first()).toBeVisible();

    const cleanPageText = await page.locator('body').innerText();
    for (const forbidden of ['HMAC', 'delivery id', 'trigger id', 'queue item id', 'execution process id', 'WorkflowStepState', 'runReady', 'raw JSON']) {
      expect(cleanPageText).not.toContain(forbidden);
    }
  });
});

async function expectDashboardHealth(request: APIRequestContext) {
  await expect.poll(async () => {
    const response = await request.get(new URL('/dashboard/api/workflows/health', sandboxUrl).toString());
    if (!response.ok()) return null;
    try {
      return await response.json() as { ok?: boolean };
    } catch {
      return null;
    }
  }, { timeout: 120_000, message: 'dashboard workflow health should return JSON' }).toEqual({ ok: true });
}

async function firstWorkspace(request: APIRequestContext): Promise<Workspace> {
  let workspace: Workspace | null = null;
  await expect.poll(async () => {
    const response = await request.get(new URL('/vk-api/workspaces', sandboxUrl).toString());
    if (!response.ok()) return null;
    const body = await response.json() as { data?: Workspace[] };
    workspace = body.data?.[0] ?? null;
    return workspace?.id ?? null;
  }, { timeout: 600_000, intervals: [1_000, 2_000, 5_000], message: 'seeded VK workspace should become available' }).not.toBeNull();
  if (!workspace) throw new Error('Expected seeded VK workspace in qa-mode sandbox');
  return workspace;
}

async function expectProvisionedWebhook(request: APIRequestContext): Promise<void> {
  await expect.poll(async () => {
    const response = await request.get(new URL('/dashboard/api/workflow-webhooks/provisioning', sandboxUrl).toString());
    if (!response.ok()) return null;
    const body = await response.json() as { state?: { status?: string } | null };
    return body.state?.status ?? null;
  }, { timeout: 60_000, intervals: [1_000, 2_000, 5_000], message: 'VD should self-provision VK terminal execution webhook' }).toBe('provisioned');
}

async function waitForPersistedPresentationCompleted(request: APIRequestContext, runId: string): Promise<Presentation> {
  let last: Presentation | null = null;
  await expect.poll(async () => {
    const response = await request.get(new URL(`/dashboard/api/workflow-instances/${encodeURIComponent(runId)}/presentation`, sandboxUrl).toString());
    if (!response.ok()) return null;
    const body = await response.json() as { presentation: Presentation };
    last = body.presentation;
    return last.status;
  }, { timeout: 240_000, intervals: [1_000, 2_000, 5_000], message: 'persisted DRT workflow should complete from qa-mode webhook refs' }).toBe('completed');
  return last!;
}
