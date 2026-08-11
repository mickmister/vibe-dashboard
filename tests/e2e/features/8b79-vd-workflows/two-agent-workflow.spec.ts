/**
 * Covers:
 * - test-plans/branches/8b79-vd-workflows/test-plan-2.md
 * - TEST_CASE_M84_1A
 * - TEST_CASE_M87_1A
 */
import { expect, test, type APIRequestContext, type Page } from 'playwright/test';

const sandboxUrl = process.env.VK_MOCKED_SANDBOX_URL ?? 'http://127.0.0.1:50005';

type Workspace = { id: string; name?: string | null; branch?: string | null };
type Session = { id: string; workspace_id: string; name?: string | null; executor?: string };
type InstanceStatusResponse = {
  instance: { instanceId: string; status: string; currentStepId: string | null };
  steps: Array<{ stepKey: string; status: string; output: unknown }>;
  triggers: Array<{ stepKey: string | null; status: string; satisfiedByExecutionProcessId: string | null }>;
  output: unknown;
};

test.describe('Docker qa-mode durable workflow UI', () => {
  test('launches and completes a two-agent review workflow through webhook wakeups', async ({ page }) => {
    test.setTimeout(900_000);

    await expectDashboardHealth(page.request);
    const workspace = await firstWorkspace(page.request);
    const sessions = await sessionsForWorkspace(page.request, workspace.id);

    await page.goto('/dashboard/teams');
    await expect(page.getByRole('heading', { name: 'Durable workflow launch' })).toBeVisible();
    await expect(page.getByLabel('Workflow definition')).toContainText('Two agent review round');

    // Product-level validation should be actionable before any durable launch.
    await page.getByRole('button', { name: 'Launch durable workflow' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Workspace id is required.' })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Task is required.' })).toBeVisible();

    await page.getByLabel('Workspace').selectOption(workspace.id);
    await expect(page.getByText('Webhook wakeup status')).toBeVisible();
    await expect.poll(async () => {
      const state = await webhookProvisioning(page.request);
      return state?.status ?? 'missing';
    }, { timeout: 60_000, message: 'VD should self-provision VK terminal execution webhook' }).toBe('provisioned');

    const task = `Docker qa-mode workflow E2E proof ${Date.now()}`;
    await page.getByLabel('Task / prompt').fill(task);
    await page.getByLabel('Role/name for auto-create or reuse').nth(0).fill('workflow-source-e2e');
    await page.getByLabel('Role/name for auto-create or reuse').nth(1).fill('workflow-reviewer-e2e');
    if (sessions[0]) {
      await page.getByLabel('Optional overseer notification session').selectOption(sessions[0].id);
    }

    await page.getByRole('button', { name: 'Launch durable workflow' }).click();
    await expect(page.getByRole('heading', { name: 'Durable instance status' })).toBeVisible();
    await expect(page.getByText('wait_source').first()).toBeVisible({ timeout: 30_000 });

    const instanceId = await currentInstanceId(page);
    expect(instanceId).toMatch(/^workflow_instance_/);

    const completed = await waitForWorkflowCompleted(page.request, instanceId);
    expect(completed.steps.find((step) => step.stepKey === 'ask_source')?.status).toBe('completed');
    expect(completed.steps.find((step) => step.stepKey === 'wait_source')?.status).toBe('completed');
    expect(completed.steps.find((step) => step.stepKey === 'ask_review')?.status).toBe('completed');
    expect(completed.steps.find((step) => step.stepKey === 'wait_review')?.status).toBe('completed');
    expect(completed.steps.find((step) => step.stepKey === 'complete')?.status).toBe('completed');
    if (sessions[0]) {
      expect(completed.steps.find((step) => step.stepKey === 'notify_overseer')?.status).toBe('completed');
    }

    const terminalInboxEvents = await webhookInboxCount(page.request);
    expect(terminalInboxEvents).toBeGreaterThanOrEqual(2);

    const presentation = await fetchPresentation(page.request, instanceId);
    expect(presentation.workflowName).toBe('Two Agent Review Round');
    expect(presentation.originalTask).toBe(task);
    expect(presentation.timeline.map((item) => item.role)).toEqual(['Implementer', 'Reviewer']);

    await page.goto(`/dashboard/workflows/${encodeURIComponent(instanceId)}`);
    await expect(page.getByRole('heading', { name: 'Two Agent Review Round' })).toBeVisible();
    const originalTaskSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Original task' }) });
    await expect(originalTaskSection.getByText(task, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();
    await expect(page.getByText('Implementer').first()).toBeVisible();
    await expect(page.getByText('Reviewer').first()).toBeVisible();
    await expect(page.getByText('Initial message').first()).toBeVisible();
    await expect(page.getByText('Final response').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Implementer session' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Reviewer session' })).toBeVisible();
    const cleanPageText = await page.locator('body').innerText();
    for (const forbidden of ['HMAC', 'delivery id', 'trigger id', 'queue item id', 'execution process id', 'WorkflowStepState', 'runReady', 'raw JSON']) {
      expect(cleanPageText).not.toContain(forbidden);
    }

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Two Agent Review Round' })).toBeVisible();

    await page.goto('/dashboard/teams');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Durable instance status' })).toBeVisible();
    await expect(page.getByText(instanceId).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Final output refs')).toBeVisible();
    await expect(page.getByText('Open VK session').first()).toBeVisible();
    await expect.poll(async () => (await fetchInstanceStatus(page.request, instanceId)).instance.status, { timeout: 30_000 }).toBe('completed');
  });
});

async function expectDashboardHealth(request: APIRequestContext) {
  await expect.poll(async () => {
    const response = await request.get(new URL('/dashboard/api/workflows/health', sandboxUrl).toString());
    if (!response.ok()) return null;
    try {
      return await response.json() as { ok?: boolean };
    } catch {
      // Caddy/Vite can briefly serve the dashboard HTML before Springboard's
      // node middleware is ready. Keep polling until the API route returns JSON.
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

async function sessionsForWorkspace(request: APIRequestContext, workspaceId: string): Promise<Session[]> {
  let sessions: Session[] = [];
  await expect.poll(async () => {
    const response = await request.get(new URL(`/vk-api/sessions?workspace_id=${encodeURIComponent(workspaceId)}`, sandboxUrl).toString());
    if (!response.ok()) return false;
    const body = await response.json() as { data?: Session[] };
    sessions = body.data ?? [];
    return true;
  }, { timeout: 120_000, intervals: [1_000, 2_000, 5_000], message: 'seeded VK sessions should become available' }).toBe(true);
  return sessions;
}

async function webhookProvisioning(request: APIRequestContext): Promise<{ status?: string } | null> {
  const response = await request.get(new URL('/dashboard/api/workflow-webhooks/provisioning', sandboxUrl).toString());
  if (!response.ok()) return null;
  const body = await response.json() as { state?: { status?: string } | null };
  return body.state ?? null;
}

async function webhookInboxCount(request: APIRequestContext): Promise<number> {
  const response = await request.get(new URL('/dashboard/api/workflow-webhooks/inbox?limit=20', sandboxUrl).toString());
  expect(response.ok()).toBeTruthy();
  const body = await response.json() as { events?: unknown[] };
  return body.events?.length ?? 0;
}

async function currentInstanceId(page: Page): Promise<string> {
  return page.evaluate(() => window.localStorage.getItem('vd.lastWorkflowInstanceId')).then((value) => {
    if (!value) throw new Error('Expected launched workflow instance id in localStorage');
    return value;
  });
}

async function fetchInstanceStatus(request: APIRequestContext, instanceId: string): Promise<InstanceStatusResponse> {
  const response = await request.get(new URL(`/dashboard/api/workflow-instances/${encodeURIComponent(instanceId)}/status`, sandboxUrl).toString());
  expect(response.ok()).toBeTruthy();
  return await response.json() as InstanceStatusResponse;
}

async function waitForWorkflowCompleted(request: APIRequestContext, instanceId: string): Promise<InstanceStatusResponse> {
  let last: InstanceStatusResponse | null = null;
  await expect.poll(async () => {
    last = await fetchInstanceStatus(request, instanceId);
    return last.instance.status;
  }, { timeout: 180_000, intervals: [1_000, 2_000, 5_000] }).toBe('completed');
  return last!;
}

type PresentationResponse = {
  presentation: {
    workflowName: string;
    originalTask: string | null;
    timeline: Array<{ role: string }>;
  };
};

async function fetchPresentation(request: APIRequestContext, instanceId: string): Promise<PresentationResponse['presentation']> {
  const response = await request.get(new URL(`/dashboard/api/workflow-instances/${encodeURIComponent(instanceId)}/presentation`, sandboxUrl).toString());
  expect(response.ok()).toBeTruthy();
  const body = await response.json() as PresentationResponse;
  return body.presentation;
}
