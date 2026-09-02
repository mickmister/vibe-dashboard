/**
 * Covers:
 * - vibe-kanban-vscode-web-2u2q — GCW-14A Docker Gas City E2E harness and CI plumbing
 * - test-plans/branches/8b79-vd-workflows/test-plan-16.md
 *
 * This first Docker E2E slice proves the workflow Docker harness can run with
 * pinned Gas City, Beads, and gc-session-vibe runtime tools installed. It does
 * not claim full Gas City orchestration yet: real sub-workspace lanes and the
 * deterministic Beads/GC interaction fixture layer are intentionally deferred.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test, type APIRequestContext, type TestInfo } from 'playwright/test';

const execFileAsync = promisify(execFile);
const sandboxUrl = process.env.VK_MOCKED_SANDBOX_URL ?? 'http://127.0.0.1:50005';
const expectedGasCityVersion = '1.4.1';
const expectedBeadsVersion = '1.2.2';

const productForbidden = /\b(?:gc|bd|git)\s+[\w:./=-]+|shell command|local path|\/Users\/|\/tmp\/|\/private\/var\/|stdout|stderr|provider diagnostics|queue[_ -]?item|webhook|trigger|delivery ID|execution process ID|raw XML|raw JSON|generated-packs|WorkflowStepState|runReady/i;

test.describe('GCW-14A Gas City Docker orchestration harness', () => {
  test('TEST_CASE_GCW14A_1A verifies pinned Gas City, Beads, and gc-session-vibe tools in Docker E2E runtime', async ({}, testInfo) => {
    const gasCity = await execAndAttach(testInfo, 'gc-version-json', 'gc', ['version', '--json']);
    const gasCityVersion = readJsonLine<{ version?: string }>(gasCity.stdout)?.version;
    expect(gasCityVersion).toBe(expectedGasCityVersion);

    const beads = await execAndAttach(testInfo, 'bd-version', 'bd', ['version']);
    expect(beads.stdout).toContain(expectedBeadsVersion);

    await execAndAttach(testInfo, 'beads-binary-available', 'bash', ['-lc', 'command -v beads >/dev/null']);

    const bridge = await execAndAttach(testInfo, 'gc-session-vibe-list-running', 'gc-session-vibe', ['list-running'], {
      env: { ...process.env, GC_EXEC_STATE_DIR: `/tmp/gcw14a-gc-session-vibe-${Date.now()}` },
    });
    expect(bridge.stderr).toBe('');

    const summary = {
      testCase: 'TEST_CASE_GCW14A_1A',
      gasCityVersion,
      beadsVersion: expectedBeadsVersion,
      bridgeAvailable: true,
      lanes: 'BLOCKED_NOT_IMPLEMENTED: real sub-workspace lane behavior is not part of GCW-14A.',
    };
    await testInfo.attach('gcw14a-runtime-summary.json', { body: JSON.stringify(summary, null, 2), contentType: 'application/json' });
  });

  test('TEST_CASE_GCW14A_1B exposes product-safe workflow surfaces without claiming lane readiness', async ({ page, request }, testInfo) => {
    await expectDashboardHealth(request);
    const workspace = await firstWorkspace(request);

    const homeResponse = await request.get(new URL(`/dashboard/api/workflows/home?workspaceId=${encodeURIComponent(workspace.id)}`, sandboxUrl).toString(), {
      headers: { Accept: 'application/json' },
    });
    expect(homeResponse.ok(), await homeResponse.text()).toBe(true);
    const homeBody = await homeResponse.json();
    await testInfo.attach('gcw14a-workflows-home.json', { body: JSON.stringify(homeBody, null, 2), contentType: 'application/json' });
    expect(JSON.stringify(homeBody)).not.toMatch(productForbidden);

    await page.goto(`/dashboard/workflows?workspaceId=${encodeURIComponent(workspace.id)}`);
    await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();
    const enginePanel = page.getByLabel('Workflow engine status');
    await expect(enginePanel).toBeVisible();
    await expect(enginePanel).toContainText(/Workflow engine|Production workflow recipes/);
    await expect(enginePanel).not.toContainText(productForbidden);
    await expect(enginePanel).not.toContainText(/lane ready|sub-workspace ready|worktree ready/i);

    const visibleText = await enginePanel.innerText();
    await testInfo.attach('gcw14a-engine-panel.txt', { body: visibleText, contentType: 'text/plain' });
  });

  test.fixme(
    'TEST_CASE_GC_FULL_E2E_1A full VD UI config/start through Gas City provider is deferred until GCW-14B+ fixture/launch wiring exists',
    async () => {},
  );

  test.fixme(
    'TEST_CASE_GC_FULL_E2E_1B VK routed first agent message is deferred until GC-backed launch is wired to gc-session-vibe',
    async () => {},
  );

  test.fixme(
    'TEST_CASE_GC_FULL_E2E_1C fabricated Beads interaction advancement is deferred until deterministic fixture APIs exist',
    async () => {},
  );

  test.fixme(
    'TEST_CASE_GC_FULL_E2E_2A lane/sub-workspace and abrupt-turn recovery cases are BLOCKED_NOT_IMPLEMENTED for this slice',
    async () => {},
  );
});

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
  if (!workspace?.id) throw new Error('No VK workspace available for Gas City workflow E2E harness smoke.');
  return workspace;
}

async function execAndAttach(
  testInfo: TestInfo,
  label: string,
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(command, args, {
      cwd: process.cwd(),
      env: options.env ?? process.env,
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    const stdout = String(result.stdout ?? '');
    const stderr = String(result.stderr ?? '');
    await testInfo.attach(`${label}-stdout.txt`, { body: stdout, contentType: 'text/plain' });
    await testInfo.attach(`${label}-stderr.txt`, { body: stderr, contentType: 'text/plain' });
    return { stdout, stderr };
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string; code?: number | string | null };
    await testInfo.attach(`${label}-stdout.txt`, { body: failure.stdout || '', contentType: 'text/plain' });
    await testInfo.attach(`${label}-stderr.txt`, { body: failure.stderr || '', contentType: 'text/plain' });
    throw new Error(`${label} failed${failure.code == null ? '' : ` with code ${failure.code}`}: ${failure.message}`);
  }
}

function readJsonLine<T>(stdout: string): T | null {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      // Keep scanning: CLIs may print non-JSON diagnostics before/after JSON.
    }
  }
  return null;
}
