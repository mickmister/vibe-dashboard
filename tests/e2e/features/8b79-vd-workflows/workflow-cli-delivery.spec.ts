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
import { expect, test, type APIRequestContext } from 'playwright/test';

const execFileAsync = promisify(execFile);
const sandboxUrl = process.env.VK_MOCKED_SANDBOX_URL ?? 'http://127.0.0.1:50005';
const requiredScriptFile = 'qa-scripted-nkyc-cli-workflow.json';
const forbidden = /raw XML|raw JSON|prompt:|skill:|contentHash|webhook|queue item|trigger|delivery|HMAC|\/Users\/|bd show|shell|git |runReady|WorkflowStepState/i;

test.describe('NKYC workflow CLI delivery proof', () => {
  test.skip(
    !process.env.VK_QA_SCRIPTED_OUTCOME_FILE?.includes(requiredScriptFile),
    `NKYC CLI fixture requires VK_QA_SCRIPTED_OUTCOME_FILE pointing at ${requiredScriptFile}.`,
  );

  test('TEST_CASE_NKYC_1A launches Ask teammate through CLI and delivers completion back to caller session', async ({ request }, testInfo) => {
    test.setTimeout(600_000);
    await expectDashboardHealth(request);
    const workspace = await firstWorkspace(request);
    const callerSessionId = await firstSessionIdForWorkspace(request, workspace.id);
    const unique = Date.now();

    await execFileAsync('npm', ['run', 'build:vibe-agent-cli'], { cwd: process.cwd(), timeout: 120_000 });
    const run = await execFileAsync('node', [
      'bin/vibe-agent',
      'workflow',
      'run',
      'ask-teammate',
      '--workspace', workspace.id,
      '--input', 'role=reviewer',
      '--input', `request=NKYC_STEP:ask_teammate Please answer delivery proof ${unique}`,
      '--input', 'successCriteria=Return the deterministic response.',
      '--caller-session', callerSessionId,
      '--json',
    ], {
      cwd: process.cwd(),
      env: { ...process.env, VIBE_API_URL: sandboxUrl, VK_WORKSPACE_ID: workspace.id, VK_SESSION_ID: callerSessionId },
      timeout: 120_000,
    });
    await testInfo.attach('nkyc-cli-run-stdout.json', { body: run.stdout, contentType: 'application/json' });
    await testInfo.attach('nkyc-cli-run-stderr.txt', { body: run.stderr || '', contentType: 'text/plain' });
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

    const result = await execFileAsync('node', ['bin/vibe-agent', 'workflow', 'result', launched.runId, '--json'], {
      cwd: process.cwd(),
      env: { ...process.env, VIBE_API_URL: sandboxUrl, VK_WORKSPACE_ID: workspace.id, VK_SESSION_ID: callerSessionId },
      timeout: 60_000,
    });
    await testInfo.attach('nkyc-cli-result-stdout.json', { body: result.stdout, contentType: 'application/json' });
    const resultJson = JSON.parse(result.stdout) as { status: string; finalResult: unknown[] };
    expect(resultJson.status).toBe('completed');
    expect(JSON.stringify(resultJson)).not.toMatch(forbidden);

    await expect.poll(async () => {
      const activity = await request.get(new URL('/vk-api/activity', sandboxUrl).toString());
      if (!activity.ok()) return '';
      return JSON.stringify(await activity.json());
    }, { timeout: 120_000, intervals: [1_000, 2_000, 5_000] }).toContain(callerSessionId);
  });
});

async function expectDashboardHealth(request: APIRequestContext) {
  const response = await request.get(new URL('/dashboard/api/workflows/health', sandboxUrl).toString());
  expect(response.ok(), await response.text()).toBe(true);
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

async function pollPresentation(request: APIRequestContext, runId: string, status: string): Promise<unknown> {
  let last: unknown = null;
  await expect.poll(async () => {
    const response = await request.get(new URL(`/dashboard/api/workflow-instances/${encodeURIComponent(runId)}/presentation`, sandboxUrl).toString());
    if (!response.ok()) return `http-${response.status()}`;
    const body = await response.json() as { presentation?: { status?: string } };
    last = body.presentation ?? null;
    return body.presentation?.status ?? 'missing';
  }, { timeout: 240_000, intervals: [1_000, 2_000, 5_000] }).toBe(status);
  return last;
}
