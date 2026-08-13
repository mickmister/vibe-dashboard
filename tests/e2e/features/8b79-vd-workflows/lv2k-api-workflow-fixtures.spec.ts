/**
 * Covers:
 * - test-plans/branches/8b79-vd-workflows/test-plan-6.md
 * - TEST_CASE_LV2K_2A
 * - TEST_CASE_LV2K_2B
 *
 * This spec intentionally uses only public VD HTTP APIs for workflow setup and
 * launch. It does not seed the DB and it does not call runtime.completeAgentTurn;
 * VK qa-mode produces the final XML message at the real queued-turn/message boundary.
 */
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type APIRequestContext, type APIResponse, type TestInfo } from 'playwright/test';

const require = createRequire(import.meta.url);
const simpleWorkflowDefinition = require('../../fixtures/lv2k-simple-agent-decision.workflow.json') as any;
const drtWorkflowDefinition = require('../../fixtures/lv2k-dev-review-tester.workflow.json') as any;
const lv2kScriptedOutcomes = require('../../fixtures/qa-scripted-lv2k-workflows.json') as { outcomes: Array<{ prompt_contains?: string; final_message?: string }> };
const fixtureMatrix = require('../../fixtures/lv2k-workflow-fixture-matrix.json') as { fixtures: unknown[] };

const sandboxUrl = process.env.VK_MOCKED_SANDBOX_URL ?? 'http://127.0.0.1:50005';
const requiredScriptFile = 'qa-scripted-lv2k-workflows.json';
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
    `LV2K API fixture tests require VK_QA_SCRIPTED_OUTCOME_FILE pointing at ${requiredScriptFile}.`,
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
    const expectedXml = scriptedMessageFor('LV2K_STEP:simple_decide');

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

    await writeLv2kArtifact(testInfo, 'lv2k-simple-api-artifacts', {
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

  test('TEST_CASE_LV2K_2B loads inline-prompt DRT JSON and completes a Review loop through HTTP read models', async ({ request }, testInfo) => {
    test.setTimeout(600_000);

    await expectDashboardHealth(request);
    await expectProvisionedWebhook(request);
    const workspace = await firstWorkspace(request);

    const unique = Date.now();
    const designId = `lv2k-drt-design-${unique}`;
    const draftId = `lv2k-drt-draft-${unique}`;
    const task = `LV2K DRT API fixture task ${unique}`;

    const created = await request.post(url('/dashboard/api/workflow-designs'), {
      data: {
        workspaceId: workspace.id,
        designId,
        draftId,
        name: drtWorkflowDefinition.name,
        description: drtWorkflowDefinition.description,
        definition: drtWorkflowDefinition,
        publish: true,
      },
    });
    const createBody = await expectJsonOk(created, 201, 'create/publish LV2K DRT workflow design');
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
        additionalInstructions: 'LV2K DRT API-first E2E should complete from scripted VK XML responses.',
        roleBindings: {
          dev: { mode: 'create_or_reuse', name: `lv2k-drt-dev-${unique}` },
          review: { mode: 'create_or_reuse', name: `lv2k-drt-review-${unique}` },
          tester: { mode: 'create_or_reuse', name: `lv2k-drt-tester-${unique}` },
        },
      },
    });
    const launchBody = await expectJsonOk(launched, 201, 'launch LV2K DRT workflow');
    expect(launchBody.run).toMatchObject({
      runId: expect.stringContaining('workflow-run-'),
      workspaceId: workspace.id,
      status: expect.any(String),
      detailUrl: expect.stringContaining('/dashboard/workflows/'),
    });

    const presentation = await waitForPersistedPresentationCompleted(request, launchBody.run.runId, 'LV2K DRT workflow should complete from qa-mode VK XML messages');
    const renderedPresentation = JSON.stringify(presentation);
    const markerCounts = countQueuedPromptMarkers(presentation, [
      'LV2K_STEP:drt_dev_implement',
      'LV2K_STEP:drt_dev_self_review',
      'LV2K_STEP:drt_review',
      'LV2K_STEP:drt_tester',
    ]);

    expect(presentation.workflowName).toBe('LV2K Dev / Review / Tester');
    expect(presentation.workflowId).toBe(designId);
    expect(presentation.provenance).toMatchObject({ workflowDesignId: designId, workflowVersion: 1 });
    expect(presentation.originalTask).toBe(task);
    expect(presentation.timeline.map((item) => item.role)).toEqual(expect.arrayContaining(['Dev', 'Review', 'Tester']));
    expect(markerCounts).toEqual({
      'LV2K_STEP:drt_dev_implement': 2,
      'LV2K_STEP:drt_dev_self_review': 2,
      'LV2K_STEP:drt_review': 2,
      'LV2K_STEP:drt_tester': 1,
    });
    expect(renderedPresentation).toContain('Action: Request changes');
    expect(renderedPresentation).toContain('Fix the LV2K review issue before testing.');
    expect(renderedPresentation).toContain('Fixed the LV2K review issue.');
    expect(renderedPresentation).toContain('Review approves the LV2K DRT changes after the loop.');
    expect(renderedPresentation).toContain('Tester approves the LV2K DRT workflow after the review loop.');
    for (const forbidden of forbiddenPresentationTerms) {
      expect(renderedPresentation).not.toContain(forbidden);
    }

    await writeLv2kArtifact(testInfo, 'lv2k-drt-api-artifacts', {
      testCaseId: 'TEST_CASE_LV2K_2B',
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
        promptContains: [
          'LV2K_STEP:drt_dev_implement',
          'LV2K_STEP:drt_dev_self_review',
          'LV2K_STEP:drt_review',
          'LV2K_STEP:drt_tester',
        ],
        scriptedXmlResponseBodies: lv2kScriptedOutcomes.outcomes
          .filter((entry) => entry.final_message?.startsWith('<decision'))
          .map((entry) => entry.final_message),
        usedDirectRuntimeCompletion: false,
      },
      queuedPromptMarkers: markerCounts,
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

async function waitForPersistedPresentationCompleted(request: APIRequestContext, runId: string, message = 'LV2K simple workflow should complete from qa-mode VK XML message'): Promise<Presentation> {
  let last: Presentation | null = null;
  await expect.poll(async () => {
    const response = await request.get(url(`/dashboard/api/workflow-instances/${encodeURIComponent(runId)}/presentation`));
    if (!response.ok()) return null;
    const body = await response.json() as { presentation: Presentation };
    last = body.presentation;
    return last.status;
  }, { timeout: 240_000, intervals: [1_000, 2_000, 5_000], message }).toBe('completed');
  return last!;
}

function scriptedMessageFor(promptContains: string): string {
  return lv2kScriptedOutcomes.outcomes.find((entry) => entry.prompt_contains === promptContains)?.final_message ?? '';
}

function countQueuedPromptMarkers(presentation: Presentation, markers: string[]): Record<string, number> {
  const counts = Object.fromEntries(markers.map((marker) => [marker, 0])) as Record<string, number>;
  for (const item of presentation.timeline) {
    const text = item.initialMessage?.text ?? '';
    for (const marker of markers) {
      if (text.includes(marker)) counts[marker] = (counts[marker] ?? 0) + 1;
    }
  }
  return counts;
}

async function writeLv2kArtifact(testInfo: TestInfo, name: string, artifact: unknown) {
  const artifactPath = testInfo.outputPath(`${name}.json`);
  await fs.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  await testInfo.attach(name, {
    path: artifactPath,
    contentType: 'application/json',
  });
}
