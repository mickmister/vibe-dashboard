/**
 * Covers:
 * - vibe-kanban-vscode-web-2u2q — GCW-14A Docker Gas City E2E harness and CI plumbing
 * - vibe-kanban-vscode-web-31jo — GCW-14B Deterministic Beads/Gas City E2E fixture layer
 * - test-plans/branches/8b79-vd-workflows/test-plan-16.md
 *
 * This first Docker E2E slice proves the workflow Docker harness can run with
 * pinned Gas City, Beads, and gc-session-vibe runtime tools installed, then
 * proves an explicit test-only fixture layer can drive deterministic product
 * events. It does not claim real sub-workspace lane readiness.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test, type APIRequestContext, type TestInfo } from 'playwright/test';

const execFileAsync = promisify(execFile);
const sandboxUrl = process.env.VK_MOCKED_SANDBOX_URL ?? 'http://127.0.0.1:50005';
const expectedGasCityVersion = '1.4.1';
const expectedBeadsVersion = '1.2.2';

const productForbidden = /\b(?:gc|bd|git)\s+[\w:./=-]+|shell command|local path|\/Users\/|\/tmp\/|\/private\/var\/|stdout|stderr|provider diagnostics|queue[_ -]?item|webhook|trigger|delivery ID|execution process ID|raw XML|raw JSON|generated-packs|WorkflowStepState|runReady/i;

test.describe('GCW-14A/14B Gas City Docker orchestration harness and fixture layer', () => {
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

  test('TEST_CASE_GCW14B_1A applies deterministic fixture events idempotently through the test-only API', async ({ request }, testInfo) => {
    await expectDashboardHealth(request);
    const workspace = await firstWorkspace(request);
    const fixtureBase = new URL('/dashboard/api/workflows/gas-city-e2e-fixture', sandboxUrl).toString();
    const beadId = 'gcw14b-bead-a';

    const resetResponse = await request.post(`${fixtureBase}/reset`, {
      data: {
        workspaceId: workspace.id,
        providerAvailable: true,
        beads: [{
          id: beadId,
          title: 'GCW-14B deterministic fixture task',
          status: 'open',
          readiness: 'not_ready',
          workspaceId: workspace.id,
          dependencyBeadIds: [],
          convoyIds: [],
          workflow: null,
          metadata: { formula: 'dev-review-test' },
        }],
      },
    });
    expect(resetResponse.ok(), await resetResponse.text()).toBe(true);

    const readyEvent = {
      eventId: 'gcw14b-ready-1',
      type: 'mark_bead_ready',
      workspaceId: workspace.id,
      beadId,
      title: 'GCW-14B deterministic fixture task',
      summary: 'Task is ready for workflow work.',
    };
    const ready = await postFixtureEvent(request, readyEvent);
    expect(ready.status()).toBe(200);
    const readyBody = await ready.json() as FixtureEventResponse;
    expect(readyBody).toMatchObject({ ok: true, result: { status: 'applied' } });
    expect(readyBody.result.state.beads).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: beadId, status: 'ready', readiness: 'ready' }),
    ]));

    const replay = await postFixtureEvent(request, readyEvent);
    expect(replay.status()).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ ok: true, result: { status: 'already_applied' } });

    const reviewApproved = await postFixtureEvent(request, {
      eventId: 'gcw14b-review-approved-1',
      type: 'mark_review_approved',
      workspaceId: workspace.id,
      beadId,
      summary: 'Review approved.',
    });
    expect(reviewApproved.status()).toBe(200);

    const resultNote = await postFixtureEvent(request, {
      eventId: 'gcw14b-result-note-1',
      type: 'record_agent_result_note',
      workspaceId: workspace.id,
      beadId,
      summary: 'Agent result note recorded for the deterministic fixture.',
    });
    expect(resultNote.status()).toBe(200);

    const testerApproved = await postFixtureEvent(request, {
      eventId: 'gcw14b-tester-approved-1',
      type: 'mark_tester_approved',
      workspaceId: workspace.id,
      beadId,
      summary: 'Tester approved.',
    });
    expect(testerApproved.status()).toBe(200);

    const conflict = await postFixtureEvent(request, { ...readyEvent, type: 'mark_tester_found_bug' });
    expect(conflict.status()).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ ok: false, result: { status: 'conflict' } });

    const snapshotResponse = await request.get(fixtureBase, { headers: { Accept: 'application/json' } });
    expect(snapshotResponse.ok(), await snapshotResponse.text()).toBe(true);
    const snapshot = await snapshotResponse.json() as FixtureSnapshotResponse;
    await testInfo.attach('gcw14b-fixture-snapshot.json', { body: JSON.stringify(snapshot, null, 2), contentType: 'application/json' });
    expect(snapshot.state.fixture).toMatchObject({ schemaVersion: 'gas-city-e2e-fixture.v1', providerId: 'gas_city_e2e_fixture', providerAvailable: true });
    expect(snapshot.state.events.map((event) => event.eventId)).toEqual([
      'gcw14b-ready-1',
      'gcw14b-review-approved-1',
      'gcw14b-result-note-1',
      'gcw14b-tester-approved-1',
    ]);
    expect(snapshot.state.beads).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: beadId, status: 'closed', readiness: 'terminal' }),
    ]));
    expect(JSON.stringify(snapshot)).not.toMatch(productForbidden);
    expect(JSON.stringify(snapshot)).not.toMatch(/lane ready|sub-workspace ready|worktree ready/i);
  });


  test('TEST_CASE_GC_FULL_E2E_1A configures and starts a Gas City-backed workflow from the VD UI', async ({ page, request }, testInfo) => {
    await expectDashboardHealth(request);
    const workspace = await firstWorkspace(request);
    const beadId = 'gcw14c-ui-start-bead';
    const fixtureBase = new URL('/dashboard/api/workflows/gas-city-e2e-fixture', sandboxUrl).toString();

    const resetResponse = await request.post(`${fixtureBase}/reset`, {
      data: {
        workspaceId: workspace.id,
        providerAvailable: true,
        beads: [{
          id: beadId,
          title: 'GCW-14C UI start task',
          status: 'ready',
          readiness: 'ready',
          workspaceId: workspace.id,
          dependencyBeadIds: [],
          convoyIds: [],
          workflow: null,
          metadata: { formula: 'dev-review-test' },
        }],
      },
    });
    expect(resetResponse.ok(), await resetResponse.text()).toBe(true);

    await page.goto(`/dashboard/workflows?workspaceId=${encodeURIComponent(workspace.id)}`);
    await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();
    const enginePanel = page.getByLabel('Workflow engine status');
    await expect(enginePanel).toBeVisible();
    await expect(enginePanel).toContainText('Workflow orchestration is available for task-backed work.');
    await expect(enginePanel).toContainText('Dev Review Test recipe');
    await expect(enginePanel).toContainText('Ready to start task-backed workflow work for GCW-14C UI start task.');
    await expect(enginePanel.getByRole('button', { name: 'Start task-backed workflow' })).toBeEnabled();

    await enginePanel.getByRole('button', { name: 'Start task-backed workflow' }).click();
    const progress = page.getByLabel('Task-backed workflow progress');
    await expect(progress).toBeVisible();
    await expect(progress).toContainText('Task-backed workflow is running');
    await expect(progress).toContainText(/accepted|already running/i);
    await expect(progress).not.toContainText(productForbidden);

    const snapshotResponse = await request.get(fixtureBase, { headers: { Accept: 'application/json' } });
    expect(snapshotResponse.ok(), await snapshotResponse.text()).toBe(true);
    const snapshot = await snapshotResponse.json() as FixtureSnapshotResponse;
    await testInfo.attach('gcw14c-ui-start-fixture-snapshot.json', { body: JSON.stringify(snapshot, null, 2), contentType: 'application/json' });
    const sourceBead = snapshot.state.beads.find((bead) => bead.id === beadId) as { workflow?: { status?: string; workflowId?: string; rootBeadId?: string; formula?: string; target?: string } } | undefined;
    expect(sourceBead?.workflow).toMatchObject({ status: 'running', formula: 'dev-review-test', target: 'worker' });
    expect(sourceBead?.workflow?.workflowId).toBeTruthy();
    expect(JSON.stringify(snapshot)).not.toMatch(productForbidden);
    expect(JSON.stringify(snapshot)).not.toMatch(/lane ready|sub-workspace ready|worktree ready/i);

    const visibleText = await enginePanel.innerText();
    await testInfo.attach('gcw14c-engine-panel-after-launch.txt', { body: visibleText, contentType: 'text/plain' });
    expect(visibleText).not.toMatch(productForbidden);
    expect(visibleText).not.toMatch(/lane ready|sub-workspace ready|worktree ready/i);
  });

  test('TEST_CASE_GC_FULL_E2E_1B UI launch routes the first workflow turn to a VK session', async ({ page, request }, testInfo) => {
    await expectDashboardHealth(request);
    const workspace = await firstWorkspace(request);
    const beadId = 'gcw14d-vk-routed-bead';
    const beadTitle = 'GCW-14D VK routed task';
    const fixtureBase = new URL('/dashboard/api/workflows/gas-city-e2e-fixture', sandboxUrl).toString();

    const resetResponse = await request.post(`${fixtureBase}/reset`, {
      data: {
        workspaceId: workspace.id,
        providerAvailable: true,
        beads: [{
          id: beadId,
          title: beadTitle,
          status: 'ready',
          readiness: 'ready',
          workspaceId: workspace.id,
          dependencyBeadIds: [],
          convoyIds: [],
          workflow: null,
          metadata: { formula: 'dev-review-test' },
        }],
      },
    });
    expect(resetResponse.ok(), await resetResponse.text()).toBe(true);

    await page.goto(`/dashboard/workflows?workspaceId=${encodeURIComponent(workspace.id)}`);
    await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();
    const enginePanel = page.getByLabel('Workflow engine status');
    await expect(enginePanel).toContainText(`Ready to start task-backed workflow work for ${beadTitle}.`);
    await enginePanel.getByRole('button', { name: 'Start task-backed workflow' }).click();
    await expect(page.getByLabel('Task-backed workflow progress')).toContainText('Task-backed workflow is running');

    const routed = await waitForRoutedAgentPrompt(request, workspace.id, `Task workflow ${beadId}`, 'GCW14D_STEP:first_agent_message');
    await testInfo.attach('gcw14d-routed-first-agent-message.json', { body: JSON.stringify(routed, null, 2), contentType: 'application/json' });

    expect(routed.session.name).toBe(`Task workflow ${beadId}`);
    expect(routed.prompt).toContain('GCW14D_STEP:first_agent_message');
    expect(routed.prompt).toContain(beadId);
    expect(routed.prompt).toContain(beadTitle);
    expect(routed.prompt).toContain('Workflow recipe: Dev Review Test');
    expect(routed.prompt).toContain('Assigned role: worker');
    expect(routed.prompt).not.toMatch(productForbidden);
    expect(routed.prompt).not.toMatch(/prompt:|skill:|@version|Built-in|contentHash|generated pack/i);

    const snapshotResponse = await request.get(fixtureBase, { headers: { Accept: 'application/json' } });
    expect(snapshotResponse.ok(), await snapshotResponse.text()).toBe(true);
    const snapshot = await snapshotResponse.json() as FixtureSnapshotResponse;
    await testInfo.attach('gcw14d-fixture-snapshot.json', { body: JSON.stringify(snapshot, null, 2), contentType: 'application/json' });
    const sourceBead = snapshot.state.beads.find((bead) => bead.id === beadId) as { workflow?: { status?: string } } | undefined;
    expect(sourceBead?.workflow).toMatchObject({ status: 'running' });
    expect(JSON.stringify(snapshot)).not.toMatch(productForbidden);
  });

  test('TEST_CASE_GC_FULL_E2E_1C typed fixture interaction advances to the next VK agent message', async ({ page, request }, testInfo) => {
    await expectDashboardHealth(request);
    const workspace = await firstWorkspace(request);
    const beadId = 'gcw14e-advance-bead';
    const beadTitle = 'GCW-14E advancement task';
    const fixtureBase = new URL('/dashboard/api/workflows/gas-city-e2e-fixture', sandboxUrl).toString();

    const resetResponse = await request.post(`${fixtureBase}/reset`, {
      data: {
        workspaceId: workspace.id,
        providerAvailable: true,
        beads: [{
          id: beadId,
          title: beadTitle,
          status: 'ready',
          readiness: 'ready',
          workspaceId: workspace.id,
          dependencyBeadIds: [],
          convoyIds: [],
          workflow: null,
          metadata: { formula: 'dev-review-test' },
        }],
      },
    });
    expect(resetResponse.ok(), await resetResponse.text()).toBe(true);

    await page.goto(`/dashboard/workflows?workspaceId=${encodeURIComponent(workspace.id)}`);
    const enginePanel = page.getByLabel('Workflow engine status');
    await expect(enginePanel).toContainText(`Ready to start task-backed workflow work for ${beadTitle}.`);
    await enginePanel.getByRole('button', { name: 'Start task-backed workflow' }).click();
    await expect(page.getByLabel('Task-backed workflow progress')).toContainText('Task-backed workflow is running');

    const first = await waitForRoutedAgentPrompt(request, workspace.id, `Task workflow ${beadId}`, 'GCW14D_STEP:first_agent_message');
    await testInfo.attach('gcw14e-first-agent-message.json', { body: JSON.stringify(first, null, 2), contentType: 'application/json' });

    const advancementEvent = {
      eventId: 'gcw14e-agent-result-1',
      type: 'record_agent_result_note',
      workspaceId: workspace.id,
      beadId,
      title: beadTitle,
      summary: 'First agent completed the deterministic fixture step.',
    };
    const advanced = await postFixtureEvent(request, advancementEvent);
    expect(advanced.status()).toBe(200);
    const advancedBody = await advanced.json() as FixtureEventResponse & { advancement?: { status?: string; sessionId?: string | null } | null };
    await testInfo.attach('gcw14e-advancement-event.json', { body: JSON.stringify(advancedBody, null, 2), contentType: 'application/json' });
    expect(advancedBody).toMatchObject({ ok: true, result: { status: 'applied' }, advancement: { status: 'sent' } });
    expect(JSON.stringify(advancedBody)).not.toMatch(productForbidden);

    const review = await waitForRoutedAgentPrompt(request, workspace.id, `Task workflow review ${beadId}`, 'GCW14E_STEP:review_agent_message');
    await testInfo.attach('gcw14e-review-agent-message.json', { body: JSON.stringify(review, null, 2), contentType: 'application/json' });
    expect(review.prompt).toContain(beadId);
    expect(review.prompt).toContain(beadTitle);
    expect(review.prompt).toContain('Task-backed workflow advanced to review.');
    expect(review.prompt).toContain('Assigned role: reviewer');
    expect(review.prompt).not.toMatch(productForbidden);
    expect(review.prompt).not.toMatch(/prompt:|skill:|@version|Built-in|contentHash|generated pack/i);

    const replay = await postFixtureEvent(request, advancementEvent);
    expect(replay.status()).toBe(200);
    const replayBody = await replay.json() as FixtureEventResponse & { advancement?: { status?: string; sessionId?: string | null } | null };
    await testInfo.attach('gcw14e-advancement-replay.json', { body: JSON.stringify(replayBody, null, 2), contentType: 'application/json' });
    expect(replayBody).toMatchObject({ ok: true, result: { status: 'already_applied' }, advancement: { status: 'sent', sessionId: review.session.id } });
    expect(JSON.stringify(replayBody)).not.toMatch(productForbidden);

    const reviewSessions = await sessionsNamed(request, workspace.id, `Task workflow review ${beadId}`);
    expect(reviewSessions).toHaveLength(1);

    const snapshotResponse = await request.get(fixtureBase, { headers: { Accept: 'application/json' } });
    expect(snapshotResponse.ok(), await snapshotResponse.text()).toBe(true);
    const snapshot = await snapshotResponse.json() as FixtureSnapshotResponse;
    await testInfo.attach('gcw14e-fixture-snapshot.json', { body: JSON.stringify(snapshot, null, 2), contentType: 'application/json' });
    expect(snapshot.state.events.map((event) => event.eventId)).toContain('gcw14e-agent-result-1');
    expect(JSON.stringify(snapshot)).not.toMatch(productForbidden);
    expect(JSON.stringify(snapshot)).not.toMatch(/lane ready|sub-workspace ready|worktree ready/i);
  });

  test('TEST_CASE_GC_FULL_E2E_1D generic CLI starts an equivalent task-backed workflow and returns detached', async ({ request }, testInfo) => {
    await expectDashboardHealth(request);
    const workspace = await firstWorkspace(request);
    const beadId = 'gcw14f-cli-launch-bead';
    const beadTitle = 'GCW-14F CLI launch task';
    const fixtureBase = new URL('/dashboard/api/workflows/gas-city-e2e-fixture', sandboxUrl).toString();

    const resetResponse = await request.post(`${fixtureBase}/reset`, {
      data: {
        workspaceId: workspace.id,
        providerAvailable: true,
        beads: [{
          id: beadId,
          title: beadTitle,
          status: 'ready',
          readiness: 'ready',
          workspaceId: workspace.id,
          dependencyBeadIds: [],
          convoyIds: [],
          workflow: null,
          metadata: { formula: 'dev-review-test' },
        }],
      },
    });
    expect(resetResponse.ok(), await resetResponse.text()).toBe(true);

    await execAndAttach(testInfo, 'gcw14f-build-vibe-agent-cli', 'npm', ['run', 'build:vibe-agent-cli']);

    const cli = await execAndAttach(
      testInfo,
      'gcw14f-vibe-agent-workflow-run',
      'node',
      [
        'bin/vibe-agent',
        'workflow',
        'run',
        'dev-review-test',
        '--workspace',
        workspace.id,
        '--bead',
        beadId,
        '--caller-session',
        'gcw14f-caller-session',
        '--json',
      ],
      { env: { ...process.env, VIBE_API_URL: sandboxUrl, VK_WORKSPACE_ID: workspace.id } },
    );
    const output = readJsonDocument<{
      ok?: boolean;
      runId?: string;
      status?: string;
      workspaceId?: string;
      workflow?: { id?: string; alias?: string; kind?: string };
      beadIds?: string[];
      runUrl?: string;
      completionResponse?: { expected?: boolean; reason?: string; sessionId?: string };
      nextAction?: string;
    }>(cli.stdout);
    expect(output).toMatchObject({
      ok: true,
      status: 'running',
      workspaceId: workspace.id,
      workflow: { id: 'gas-city/dev-review-test', alias: 'dev-review-test', kind: 'task_backed_recipe' },
      beadIds: [beadId],
      completionResponse: { expected: false },
    });
    expect(output?.completionResponse?.reason).toContain('not supported');
    expect(output?.completionResponse).not.toHaveProperty('sessionId');
    expect(output?.runId).toMatch(/^gc-workflow-/);
    expect(output?.runUrl).toContain('/dashboard/workflows?workspaceId=');
    expect(output?.nextAction).toMatch(/End this turn/i);
    expect(`${cli.stdout}\n${cli.stderr}`).not.toMatch(productForbidden);
    expect(`${cli.stdout}\n${cli.stderr}`).not.toMatch(/<xs:schema|prompt:|skill:|@version|Built-in|contentHash|generated pack/i);

    const routed = await waitForRoutedAgentPrompt(request, workspace.id, `Task workflow ${beadId}`, 'GCW14D_STEP:first_agent_message');
    await testInfo.attach('gcw14f-cli-routed-first-agent-message.json', { body: JSON.stringify(routed, null, 2), contentType: 'application/json' });
    expect(routed.prompt).toContain(beadId);
    expect(routed.prompt).toContain(beadTitle);
    expect(routed.prompt).not.toMatch(productForbidden);

    const snapshotResponse = await request.get(fixtureBase, { headers: { Accept: 'application/json' } });
    expect(snapshotResponse.ok(), await snapshotResponse.text()).toBe(true);
    const snapshot = await snapshotResponse.json() as FixtureSnapshotResponse;
    await testInfo.attach('gcw14f-fixture-snapshot.json', { body: JSON.stringify(snapshot, null, 2), contentType: 'application/json' });
    const sourceBead = snapshot.state.beads.find((bead) => bead.id === beadId) as { workflow?: { status?: string; workflowId?: string; formula?: string; target?: string } } | undefined;
    expect(sourceBead?.workflow).toMatchObject({ status: 'running', workflowId: output?.runId, formula: 'dev-review-test', target: 'worker' });
    expect(JSON.stringify(snapshot)).not.toMatch(productForbidden);
    expect(JSON.stringify(snapshot)).not.toMatch(/lane ready|sub-workspace ready|worktree ready/i);
  });

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


async function waitForRoutedAgentPrompt(
  request: APIRequestContext,
  workspaceId: string,
  expectedSessionName: string,
  marker: string,
): Promise<{ session: { id: string; name: string | null }; prompt: string; source: string }> {
  const deadline = Date.now() + 120_000;
  let lastSeen = 'not-started';
  while (Date.now() < deadline) {
    const sessionsResponse = await request.get(new URL(`/vk-api/sessions?workspace_id=${encodeURIComponent(workspaceId)}`, sandboxUrl).toString(), { headers: { Accept: 'application/json' } });
    if (sessionsResponse.ok()) {
      const sessionsBody = await sessionsResponse.json() as { data?: Array<{ id: string; name?: string | null }> };
      const session = sessionsBody.data?.find((candidate) => candidate.name === expectedSessionName);
      if (session?.id) {
        const queued = await latestQueuedPrompt(request, session.id);
        if (queued?.includes(marker)) {
          return { session: { id: session.id, name: session.name ?? null }, prompt: queued, source: 'queue-status' };
        }
        const latest = await latestResponsePrompt(request, session.id);
        if (latest?.includes(marker)) {
          return { session: { id: session.id, name: session.name ?? null }, prompt: latest, source: 'latest-response' };
        }
        lastSeen = `session ${session.id} exists without expected prompt yet`;
      } else {
        lastSeen = `session ${expectedSessionName} not found`;
      }
    } else {
      lastSeen = `sessions http ${sessionsResponse.status()}`;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for routed first agent prompt: ${lastSeen}`);
}

async function sessionsNamed(
  request: APIRequestContext,
  workspaceId: string,
  expectedSessionName: string,
): Promise<Array<{ id: string; name?: string | null }>> {
  const response = await request.get(new URL(`/vk-api/sessions?workspace_id=${encodeURIComponent(workspaceId)}`, sandboxUrl).toString(), { headers: { Accept: 'application/json' } });
  expect(response.ok(), await response.text()).toBe(true);
  const body = await response.json() as { data?: Array<{ id: string; name?: string | null }> };
  return (body.data ?? []).filter((candidate) => candidate.name === expectedSessionName);
}

async function latestQueuedPrompt(request: APIRequestContext, sessionId: string): Promise<string | null> {
  const response = await request.get(new URL(`/vk-api/sessions/${encodeURIComponent(sessionId)}/queue`, sandboxUrl).toString(), { headers: { Accept: 'application/json' } });
  if (!response.ok()) return null;
  const body = await response.json() as { data?: { message?: { data?: { message?: string } } | null; messages?: Array<{ data?: { message?: string } }> } };
  return body.data?.message?.data?.message
    ?? body.data?.messages?.map((message) => message.data?.message).find((message): message is string => typeof message === 'string')
    ?? null;
}

async function latestResponsePrompt(request: APIRequestContext, sessionId: string): Promise<string | null> {
  const response = await request.get(new URL(`/vk-api/sessions/${encodeURIComponent(sessionId)}/latest-response`, sandboxUrl).toString(), { headers: { Accept: 'application/json' } });
  if (!response.ok()) return null;
  const body = await response.json() as { data?: { prompt_preview?: string | null; content?: string | null } | null };
  return body.data?.prompt_preview ?? body.data?.content ?? null;
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

function readJsonDocument<T>(stdout: string): T | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return readJsonLine<T>(stdout);
  }
}


interface FixtureEventResponse {
  ok: boolean;
  result: {
    status: string;
    state: {
      beads: Array<Record<string, unknown>>;
    };
  };
}

interface FixtureSnapshotResponse {
  ok: boolean;
  state: {
    fixture: { schemaVersion: string; providerId: string; providerAvailable: boolean };
    beads: Array<Record<string, unknown>>;
    events: Array<{ eventId: string }>;
  };
}

function postFixtureEvent(request: APIRequestContext, event: Record<string, unknown>) {
  return request.post(new URL('/dashboard/api/workflows/gas-city-e2e-fixture/events', sandboxUrl).toString(), { data: event });
}
