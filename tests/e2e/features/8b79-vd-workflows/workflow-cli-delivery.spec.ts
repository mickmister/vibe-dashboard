/**
 * Covers:
 * - vibe-kanban-vscode-web-nkyc — Workflow CLI delivery proof v2 with webhook response
 *
 * This spec uses the public vibe-agent workflow CLI against the real VD/VK
 * qa-mode sandbox. It does not seed workflow definitions or complete runtime
 * turns directly.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test, type APIRequestContext, type TestInfo } from 'playwright/test';

const execFileAsync = promisify(execFile);
const sandboxUrl = process.env.VK_MOCKED_SANDBOX_URL ?? 'http://127.0.0.1:50005';
const requiredScriptFile = 'qa-scripted-nkyc-cli-workflow.json';
const forbidden = /raw XML|raw JSON|prompt:|skill:|contentHash|webhook|queue item|trigger|delivery|HMAC|\/Users\/|bd show|shell|git |runReady|WorkflowStepState/i;

test.describe('NKYC workflow CLI delivery proof', () => {
  test.skip(
    !process.env.VK_QA_SCRIPTED_OUTCOME_FILE?.includes(requiredScriptFile),
    `NKYC CLI fixture requires VK_QA_SCRIPTED_OUTCOME_FILE pointing at ${requiredScriptFile}.`,
  );

  test('TEST_CASE_NKYC_1A launches Ask teammate through CLI and delivers completion back to caller session with activity smoke', async ({ request, page }, testInfo) => {
    test.setTimeout(600_000);
    await expectDashboardHealth(request);
    const workspace = await firstWorkspace(request);
    const callerSessionId = await firstSessionIdForWorkspace(request, workspace.id);
    const unique = Date.now();
    const activityWs = await startActivityWebSocketCapture(page, workspace.id, callerSessionId);
    await testInfo.attach('uiid-activity-ws-initial.json', { body: JSON.stringify(await activityWs.events(), null, 2), contentType: 'application/json' });

    await execWorkflowCli(testInfo, 'build-vibe-agent-cli', 'npm', ['run', 'build:vibe-agent-cli'], { cwd: process.cwd(), timeout: 120_000 });
    const run = await execWorkflowCli(testInfo, 'nkyc-cli-run', 'node', [
      'bin/vibe-agent',
      'workflow',
      'run',
      'ask-teammate',
      '--workspace', workspace.id,
      '--input', 'role=reviewer',
      '--input', `request=NKYC_STEP:ask_teammate Please answer workflow proof ${unique}`,
      '--input', 'successCriteria=Return the deterministic response.',
      '--caller-session', callerSessionId,
      '--json',
    ], {
      cwd: process.cwd(),
      env: { ...process.env, VIBE_API_URL: sandboxUrl, VK_WORKSPACE_ID: workspace.id, VK_SESSION_ID: callerSessionId },
      timeout: 120_000,
    });
    expect(run.stderr).toBe('');
    const launched = JSON.parse(run.stdout) as { runId: string; runUrl: string; nextAction: string; completionResponse?: { expected?: boolean } };
    expect(launched.runId).toContain('workflow-run-');
    expect(launched.nextAction).toContain('End this turn');
    expect(launched.completionResponse).toMatchObject({ expected: true });
    expect(JSON.stringify(launched)).not.toMatch(forbidden);

    const presentation = await pollPresentation(request, launched.runId, 'completed');
    await testInfo.attach('nkyc-final-presentation.json', { body: JSON.stringify(presentation, null, 2), contentType: 'application/json' });
    expect(JSON.stringify(presentation)).toContain('CLI teammate response completed');
    expect(JSON.stringify(presentation)).not.toMatch(forbidden);

    const result = await execWorkflowCli(testInfo, 'nkyc-cli-result', 'node', ['bin/vibe-agent', 'workflow', 'result', launched.runId, '--json'], {
      cwd: process.cwd(),
      env: { ...process.env, VIBE_API_URL: sandboxUrl, VK_WORKSPACE_ID: workspace.id, VK_SESSION_ID: callerSessionId },
      timeout: 60_000,
    });
    const resultJson = JSON.parse(result.stdout) as { status: string; finalResult: unknown[] };
    expect(resultJson.status).toBe('completed');
    expect(JSON.stringify(resultJson)).not.toMatch(forbidden);

    const callerResponse = await pollCallerLatestResponse(request, callerSessionId);
    await testInfo.attach('nkyc-caller-latest-response.json', { body: JSON.stringify(callerResponse, null, 2), contentType: 'application/json' });
    expect(JSON.stringify(callerResponse)).toContain('Workflow completion response received by caller session.');
    expect(JSON.stringify(callerResponse)).not.toMatch(forbidden);

    const activitySnapshot = await pollActivityCallback(request, workspace.id, callerSessionId, launched.runId, 'delivered');
    await testInfo.attach('uiid-activity-v1-snapshot.json', { body: JSON.stringify(activitySnapshot, null, 2), contentType: 'application/json' });
    expect(JSON.stringify(activitySnapshot)).not.toMatch(forbidden);

    const wsEvents = await activityWs.waitForCallback(launched.runId, 'delivered');
    await testInfo.attach('uiid-activity-ws-events.json', { body: JSON.stringify(wsEvents, null, 2), contentType: 'application/json' });
    expect(JSON.stringify(wsEvents)).not.toMatch(forbidden);
    expect(countActivityCallbacks(wsEvents, launched.runId)).toBe(1);

    const legacyWsEvents = await captureLegacyActivityWs(page);
    await testInfo.attach('uiid-legacy-activity-ws-events.json', { body: JSON.stringify(legacyWsEvents, null, 2), contentType: 'application/json' });
    expect(legacyWsEvents.length).toBeGreaterThan(0);
  });
});

type ActivityCapture = {
  events: () => Promise<unknown[]>;
  waitForCallback: (runId: string, status: string) => Promise<unknown[]>;
};

async function startActivityWebSocketCapture(page: import('playwright/test').Page, workspaceId: string, sessionId: string): Promise<ActivityCapture> {
  if (page.url() === 'about:blank') {
    await page.goto(sandboxUrl, { waitUntil: 'domcontentloaded' });
  }
  const wsUrl = new URL(`/vk-api/activity/v1/ws?workspace_id=${encodeURIComponent(workspaceId)}&session_id=${encodeURIComponent(sessionId)}`, sandboxUrl);
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  await page.evaluate((url) => {
    const target = window as typeof window & { __workflowActivityEvents?: unknown[]; __workflowActivitySocket?: WebSocket };
    target.__workflowActivityEvents = [];
    target.__workflowActivitySocket?.close();
    const socket = new WebSocket(url);
    target.__workflowActivitySocket = socket;
    socket.addEventListener('message', (event) => {
      try {
        target.__workflowActivityEvents?.push(JSON.parse(String(event.data)));
      } catch {
        target.__workflowActivityEvents?.push({ raw: String(event.data) });
      }
    });
  }, wsUrl.toString());

  await expect.poll(async () => {
    const events = await page.evaluate(() => (window as typeof window & { __workflowActivityEvents?: unknown[] }).__workflowActivityEvents ?? []);
    return events.some((event) => JSON.stringify(event).includes('"event_type":"snapshot"')) ? 'snapshot' : 'waiting';
  }, { timeout: 30_000, intervals: [250, 500, 1_000] }).toBe('snapshot');

  return {
    events: () => page.evaluate(() => (window as typeof window & { __workflowActivityEvents?: unknown[] }).__workflowActivityEvents ?? []),
    waitForCallback: async (runId: string, status: string) => {
      await expect.poll(async () => {
        const events = await page.evaluate(() => (window as typeof window & { __workflowActivityEvents?: unknown[] }).__workflowActivityEvents ?? []);
        return activityEventsHaveCallback(events, runId, status) ? status : 'waiting';
      }, { timeout: 60_000, intervals: [500, 1_000, 2_000] }).toBe(status);
      return page.evaluate(() => (window as typeof window & { __workflowActivityEvents?: unknown[] }).__workflowActivityEvents ?? []);
    },
  };
}

async function captureLegacyActivityWs(page: import('playwright/test').Page): Promise<unknown[]> {
  const wsUrl = new URL('/vk-api/activity/ws', sandboxUrl);
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  await page.evaluate((url) => {
    const target = window as typeof window & { __legacyActivityEvents?: unknown[]; __legacyActivitySocket?: WebSocket };
    target.__legacyActivityEvents = [];
    target.__legacyActivitySocket?.close();
    const socket = new WebSocket(url);
    target.__legacyActivitySocket = socket;
    socket.addEventListener('message', (event) => {
      target.__legacyActivityEvents?.push(String(event.data));
    });
  }, wsUrl.toString());
  await expect.poll(async () => {
    const events = await page.evaluate(() => (window as typeof window & { __legacyActivityEvents?: unknown[] }).__legacyActivityEvents ?? []);
    return events.length;
  }, { timeout: 30_000, intervals: [250, 500, 1_000] }).toBeGreaterThan(0);
  return page.evaluate(() => (window as typeof window & { __legacyActivityEvents?: unknown[] }).__legacyActivityEvents ?? []);
}

async function execWorkflowCli(
  testInfo: TestInfo,
  label: string,
  command: string,
  args: string[],
  options: Parameters<typeof execFile>[2],
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(command, args, options);
    const stdout = String(result.stdout ?? '');
    const stderr = String(result.stderr ?? '');
    await testInfo.attach(`${label}-stdout.txt`, { body: stdout, contentType: 'text/plain' });
    await testInfo.attach(`${label}-stderr.txt`, { body: stderr, contentType: 'text/plain' });
    return { stdout, stderr };
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string; code?: number | string | null };
    await testInfo.attach(`${label}-stdout.txt`, { body: failure.stdout || '', contentType: 'text/plain' });
    await testInfo.attach(`${label}-stderr.txt`, { body: failure.stderr || '', contentType: 'text/plain' });
    throw new Error([
      `${label} failed${failure.code === undefined || failure.code === null ? '' : ` with code ${failure.code}`}.`,
      `Command: ${command} ${args.join(' ')}`,
      'stdout:',
      failure.stdout || '(empty)',
      'stderr:',
      failure.stderr || '(empty)',
    ].join('\n'));
  }
}

async function expectDashboardHealth(request: APIRequestContext) {
  await expect.poll(async () => {
    const response = await request.get(new URL('/dashboard/api/workflows/health', sandboxUrl).toString(), { headers: { Accept: 'application/json' } });
    if (!response.ok()) return `http-${response.status()}`;
    const contentType = response.headers()['content-type'] ?? '';
    if (!contentType.includes('application/json')) return 'non-json';
    const body = await response.json() as { ok?: boolean };
    return body.ok === true ? 'ready' : 'not-ready';
  }, { timeout: 120_000, intervals: [500, 1_000, 2_000] }).toBe('ready');
}

async function firstWorkspace(request: APIRequestContext): Promise<{ id: string }> {
  const response = await request.get(new URL('/vk-api/workspaces', sandboxUrl).toString());
  expect(response.ok(), await response.text()).toBe(true);
  const body = await response.json() as { data?: Array<{ id: string }> };
  const workspace = body.data?.[0];
  if (!workspace?.id) throw new Error('No VK workspace available for CLI workflow E2E.');
  return workspace;
}

async function firstSessionIdForWorkspace(request: APIRequestContext, workspaceId: string): Promise<string> {
  const response = await request.get(new URL(`/vk-api/sessions?workspace_id=${encodeURIComponent(workspaceId)}`, sandboxUrl).toString());
  expect(response.ok(), await response.text()).toBe(true);
  const body = await response.json() as { data?: Array<{ id: string }> };
  const sessionId = body.data?.[0]?.id;
  if (!sessionId) throw new Error('No VK caller session available for CLI workflow E2E.');
  return sessionId;
}

async function pollCallerLatestResponse(request: APIRequestContext, sessionId: string): Promise<unknown> {
  let last: unknown = null;
  await expect.poll(async () => {
    const response = await request.get(new URL(`/vk-api/sessions/${encodeURIComponent(sessionId)}/latest-response`, sandboxUrl).toString(), { headers: { Accept: 'application/json' } });
    if (!response.ok()) return `http-${response.status()}`;
    const body = await response.json() as { data?: { content?: string | null } | null };
    last = body.data ?? null;
    return body.data?.content ?? 'pending';
  }, { timeout: 120_000, intervals: [1_000, 2_000, 5_000] }).toContain('Workflow completion response received by caller session.');
  return last;
}

async function pollPresentation(request: APIRequestContext, runId: string, status: string): Promise<unknown> {
  let last: unknown = null;
  await expect.poll(async () => {
    const response = await request.get(new URL(`/dashboard/api/workflow-instances/${encodeURIComponent(runId)}/presentation`, sandboxUrl).toString(), { headers: { Accept: 'application/json' } });
    if (!response.ok()) return `http-${response.status()}`;
    const body = await response.json() as { presentation?: { status?: string } };
    last = body.presentation ?? null;
    return body.presentation?.status ?? 'missing';
  }, { timeout: 240_000, intervals: [1_000, 2_000, 5_000] }).toBe(status);
  return last;
}


async function pollActivityCallback(request: APIRequestContext, workspaceId: string, sessionId: string, runId: string, status: string): Promise<unknown> {
  let last: unknown = null;
  await expect.poll(async () => {
    const response = await request.get(new URL(`/vk-api/activity/v1?workspace_id=${encodeURIComponent(workspaceId)}&session_id=${encodeURIComponent(sessionId)}`, sandboxUrl).toString(), { headers: { Accept: 'application/json' } });
    if (!response.ok()) return `http-${response.status()}`;
    const body = await response.json() as { data?: unknown };
    last = body.data ?? null;
    return activityEventsHaveCallback([body.data], runId, status) ? status : 'waiting';
  }, { timeout: 120_000, intervals: [1_000, 2_000, 5_000] }).toBe(status);
  return last;
}

function activityEventsHaveCallback(events: unknown[], runId: string, status: string): boolean {
  return extractActivityCallbacks(events, runId).some((callback) => callback.status === status);
}

function countActivityCallbacks(events: unknown[], runId: string): number {
  const ids = new Set(extractActivityCallbacks(events, runId).map((callback) => callback.callback_id));
  return ids.size;
}

function extractActivityCallbacks(events: unknown[], runId: string): Array<{ callback_id: string; status: string }> {
  const callbacks: Array<{ callback_id: string; status: string }> = [];
  for (const event of events) {
    collectCallbacks(event, runId, callbacks);
  }
  return callbacks;
}

function collectCallbacks(value: unknown, runId: string, callbacks: Array<{ callback_id: string; status: string }>) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectCallbacks(item, runId, callbacks);
    return;
  }
  const record = value as Record<string, unknown>;
  const workflow = record.workflow as Record<string, unknown> | undefined;
  if (typeof record.callback_id === 'string' && typeof record.status === 'string' && workflow?.run_id === runId) {
    callbacks.push({ callback_id: record.callback_id, status: record.status });
  }
  for (const child of Object.values(record)) collectCallbacks(child, runId, callbacks);
}
