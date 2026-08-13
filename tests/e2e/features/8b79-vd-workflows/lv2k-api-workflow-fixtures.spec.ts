/**
 * Covers:
 * - test-plans/branches/8b79-vd-workflows/test-plan-6.md
 * - TEST_CASE_LV2K_2A
 *
 * This spec intentionally uses only public VD HTTP APIs for workflow setup and
 * launch. It does not seed the DB and it does not call runtime.completeAgentTurn;
 * VK qa-mode produces the final message at the real queued-turn/message boundary.
 */
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type APIRequestContext, type APIResponse, type TestInfo } from 'playwright/test';

const require = createRequire(import.meta.url);
const simpleWorkflowDefinition = require('../../fixtures/lv2k-simple-agent-decision.workflow.json') as any;
const simpleScriptedOutcome = require('../../fixtures/qa-scripted-lv2k-simple-workflow.json') as { outcomes: Array<{ final_message?: string }> };
const fixtureMatrix = require('../../fixtures/lv2k-workflow-fixture-matrix.json') as { fixtures: unknown[] };

const sandboxUrl = process.env.VK_MOCKED_SANDBOX_URL ?? 'http://127.0.0.1:50005';
const requiredScriptFile = 'qa-scripted-lv2k-simple-workflow.json';
const forbiddenPresentationTerms = [
  '<decision',
  'rawXml',
  'responseRef',
  'HMAC',
  'delivery id',
  'trigger id',
  'queue item id',
  'execution process id',
  'WorkflowStepState',
  'runReady',
];

type Workspace = { id: string; name?: string | null; branch?: string | null };
type Presentation = {
  workflowName: string;
  workflowId: string;
  status: string;
  originalTask: string | null;
  provenance?: { workflowDesignId?: string | null; workflowVersion?: number | null } | null;
  timeline: Array<{
    role: string;
    title: string;
    status: string;
    initialMessage: { text: string } | null;
    finalResponse: { text: string } | null;
  }>;
};

test.describe('LV2K API-first workflow fixtures', () => {
  test.skip(
    !process.env.VK_QA_SCRIPTED_OUTCOME_FILE?.includes(requiredScriptFile),
    `TEST_CASE_LV2K_2A requires VK_QA_SCRIPTED_OUTCOME_FILE pointing at ${requiredScriptFile}.`,
  );

  test('TEST_CASE_LV2K_2A loads JSON workflow, launches it, and parses VK XML through HTTP read models', async ({ request }, testInfo) => {
    test.setTimeout(600_000);

    await expectDashboardHealth(request);
    await expectProvisionedWebhook(request);
    const workspace = await firstWorkspace(request);

    const unique = Date.now();
    const designId = `lv2k-simple-design-${unique}`;
    const draftId = `lv2k-simple-draft-${unique}`;
    const task = `LV2K API fixture task ${unique}`;
    const expectedXml = simpleScriptedOutcome.outcomes[0]?.final_message ?? '';

    const created = await request.post(url('/dashboard/api/workflow-designs'), {
      data: {
        workspaceId: workspace.id,
        designId,
        draftId,
        name: simpleWorkflowDefinition.name,
        description: simpleWorkflowDefinition.description,
        definition: simpleWorkflowDefinition,
        publish: true,
      },
    });
    const createBody = await expectJsonOk(created, 201, 'create/publish LV2K workflow design');
    expect(createBody).toMatchObject({
      design: { designId, latestPublishedVersion: 1 },
      draft: { draftId, designId },
      version: { designId, version: 1 },
      editor: { designId, validationStatus: 'valid' },
    });

    const launched = await request.post(url('/dashboard/api/workflows/launch'), {
      data: {
        workspaceId: workspace.id,
        designId,
        version: 1,
        inputs: { featureRequest: task },
        additionalInstructions: 'LV2K API-first E2E should complete from the scripted VK XML response.',
        roleBindings: {
          implementer: { mode: 'create_or_reuse', name: `lv2k-implementer-${unique}` },
        },
      },
    });
    const launchBody = await expectJsonOk(launched, 201, 'launch LV2K workflow');
    // The launch response is intentionally a product run summary, not a full
    // persisted run row. Verify workflow identity through the presentation
    // read model below, where workflow/provenance belongs.
    expect(launchBody.run).toMatchObject({
      runId: expect.stringContaining('workflow-run-'),
      workspaceId: workspace.id,
      status: expect.any(String),
      detailUrl: expect.stringContaining('/dashboard/workflows/'),
    });

    const presentation = await waitForPersistedPresentationCompleted(request, launchBody.run.runId);
    const renderedPresentation = JSON.stringify(presentation);
    const queuedPromptMarkers = presentation.timeline
      .map((item) => item.initialMessage?.text ?? '')
      .filter((text) => text.includes('LV2K_STEP:simple_decide'));

    expect(presentation.workflowName).toBe('LV2K Simple Agent Decision');
    expect(presentation.workflowId).toBe(designId);
    expect(presentation.provenance).toMatchObject({ workflowDesignId: designId, workflowVersion: 1 });
    expect(presentation.originalTask).toBe(task);
    expect(presentation.timeline.map((item) => item.role)).toContain('Implementer');
    expect(queuedPromptMarkers).toHaveLength(1);
    expect(renderedPresentation).toContain('Action: Done');
    expect(renderedPresentation).toContain('Finished simple task through real VK qa-mode XML loopback.');
    for (const forbidden of forbiddenPresentationTerms) {
      expect(renderedPresentation).not.toContain(forbidden);
    }

    await writeLv2kArtifact(testInfo, {
      testCaseId: 'TEST_CASE_LV2K_2A',
      fixtureMatrix: fixtureMatrix.fixtures,
      workflowSetup: {
        route: 'POST /dashboard/api/workflow-designs',
        designId,
        draftId,
        version: 1,
        usedDbSeeding: false,
        usedImportRoute: false,
      },
      launch: {
        route: 'POST /dashboard/api/workflows/launch',
        runId: launchBody.run.runId,
        workspaceId: workspace.id,
      },
      vkQaMode: {
        scriptedOutcomeFile: process.env.VK_QA_SCRIPTED_OUTCOME_FILE,
        promptContains: 'LV2K_STEP:simple_decide',
        scriptedXmlResponseBody: expectedXml,
        usedDirectRuntimeCompletion: false,
      },
      queuedPromptMarkers,
      presentation,
      forbiddenPresentationTerms,
    });
  });
});

function url(path: string) {
  return new URL(path, sandboxUrl).toString();
}

async function expectJsonOk(response: APIResponse, status: number, label: string) {
  const body = await response.json().catch(async () => ({ raw: await response.text().catch(() => '') }));
  expect(response.status(), `${label}: ${JSON.stringify(body)}`).toBe(status);
  return body as any;
}

async function expectDashboardHealth(request: APIRequestContext) {
  await expect.poll(async () => {
    const response = await request.get(url('/dashboard/api/workflows/health'));
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
    const response = await request.get(url('/vk-api/workspaces'));
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
    const response = await request.get(url('/dashboard/api/workflow-webhooks/provisioning'));
    if (!response.ok()) return null;
    const body = await response.json() as { state?: { status?: string } | null };
    return body.state?.status ?? null;
  }, { timeout: 60_000, intervals: [1_000, 2_000, 5_000], message: 'VD should self-provision VK terminal execution webhook' }).toBe('provisioned');
}

async function waitForPersistedPresentationCompleted(request: APIRequestContext, runId: string): Promise<Presentation> {
  let last: Presentation | null = null;
  await expect.poll(async () => {
    const response = await request.get(url(`/dashboard/api/workflow-instances/${encodeURIComponent(runId)}/presentation`));
    if (!response.ok()) return null;
    const body = await response.json() as { presentation: Presentation };
    last = body.presentation;
    return last.status;
  }, { timeout: 240_000, intervals: [1_000, 2_000, 5_000], message: 'LV2K simple workflow should complete from qa-mode VK XML message' }).toBe('completed');
  return last!;
}

async function writeLv2kArtifact(testInfo: TestInfo, artifact: unknown) {
  const artifactPath = testInfo.outputPath('lv2k-simple-api-artifacts.json');
  await fs.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  await testInfo.attach('lv2k-simple-api-artifacts', {
    path: artifactPath,
    contentType: 'application/json',
  });
}
