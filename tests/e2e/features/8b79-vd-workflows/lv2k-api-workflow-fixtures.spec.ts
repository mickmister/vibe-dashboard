/**
 * Covers:
 * - test-plans/branches/8b79-vd-workflows/test-plan-6.md
 * - TEST_CASE_LV2K_2A
 * - TEST_CASE_LV2K_2B
 * - TEST_CASE_LV2K_2F
 * - TEST_CASE_LV2K_2C
 * - TEST_CASE_LV2K_2D
 *
 * This spec intentionally uses only public VD HTTP APIs for workflow setup and
 * launch. It does not seed the DB and it does not call runtime.completeAgentTurn;
 * VK qa-mode produces the final XML message at the real queued-turn/message boundary.
 */
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type TestInfo,
} from "playwright/test";

const require = createRequire(import.meta.url);
const simpleWorkflowDefinition =
  require("../../fixtures/lv2k-simple-agent-decision.workflow.json") as any;
const drtWorkflowDefinition =
  require("../../fixtures/lv2k-dev-review-tester.workflow.json") as any;
const invalidXmlWorkflowDefinition =
  require("../../fixtures/lv2k-invalid-xml-blocked.workflow.json") as any;
const humanFormWorkflowDefinition =
  require("../../fixtures/lv2k-human-form.workflow.json") as any;
const workflowCallChildDefinition =
  require("../../fixtures/lv2k-workflow-call-child.workflow.json") as any;
const workflowCallParentDefinition =
  require("../../fixtures/lv2k-workflow-call-parent.workflow.json") as any;
const lv2kScriptedOutcomes =
  require("../../fixtures/qa-scripted-lv2k-workflows.json") as {
    outcomes: Array<{ prompt_contains?: string; final_message?: string }>;
  };
const fixtureMatrix =
  require("../../fixtures/lv2k-workflow-fixture-matrix.json") as {
    fixtures: unknown[];
  };

const sandboxUrl =
  process.env.VK_MOCKED_SANDBOX_URL ?? "http://127.0.0.1:50005";
const requiredScriptFile = "qa-scripted-lv2k-workflows.json";
const forbiddenPresentationTerms = [
  "<decision",
  "rawXml",
  "responseRef",
  "HMAC",
  "delivery id",
  "trigger id",
  "queue item id",
  "execution process id",
  "WorkflowStepState",
  "runReady",
];

type Workspace = { id: string; name?: string | null; branch?: string | null };
type Presentation = {
  workflowName: string;
  workflowId: string;
  status: string;
  originalTask: string | null;
  summary?: {
    statusLabel?: string | null;
    waitingReason?: string | null;
    nextAction?: string | null;
  } | null;
  outputs?: Array<{ kind: string; label: string; value: string }> | null;
  callTree?: Array<{
    turnId: string;
    label: string;
    status: string;
    childRunId: string;
    childUrl: string | null;
    waitingReason: string | null;
    outputRef: string | null;
  }> | null;
  provenance?: {
    workflowDesignId?: string | null;
    workflowVersion?: number | null;
  } | null;
  timeline: Array<{
    role: string;
    title: string;
    kind?: string;
    status: string;
    initialMessage: { text: string } | null;
    finalResponse: { text: string } | null;
    responseUnavailable?: string | null;
  }>;
};

type AttentionItem = {
  attentionItemId: string;
  instanceId: string;
  status: string;
  title: string;
  description: string | null;
  stateVisitId: string;
  formRef: string | null;
  formSchema: unknown;
  presentationUrl: string | null;
};

test.describe("LV2K API-first workflow fixtures", () => {
  test.skip(
    !process.env.VK_QA_SCRIPTED_OUTCOME_FILE?.includes(requiredScriptFile),
    `LV2K API fixture tests require VK_QA_SCRIPTED_OUTCOME_FILE pointing at ${requiredScriptFile}.`,
  );

  test("TEST_CASE_LV2K_2A loads JSON workflow, launches it, and parses VK XML through HTTP read models", async ({
    request,
  }, testInfo) => {
    test.setTimeout(600_000);

    await expectDashboardHealth(request);
    await expectProvisionedWebhook(request);
    const workspace = await firstWorkspace(request);

    const unique = Date.now();
    const designId = `lv2k-simple-design-${unique}`;
    const draftId = `lv2k-simple-draft-${unique}`;
    const task = `LV2K API fixture task ${unique}`;
    const expectedXml = scriptedMessageFor("LV2K_STEP:simple_decide");

    const created = await request.post(url("/dashboard/api/workflow-designs"), {
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
    const createBody = await expectJsonOk(
      created,
      201,
      "create/publish LV2K workflow design",
    );
    expect(createBody).toMatchObject({
      design: { designId, latestPublishedVersion: 1 },
      draft: { draftId, designId },
      version: { designId, version: 1 },
      editor: { designId, validationStatus: "valid" },
    });

    const launched = await request.post(
      url("/dashboard/api/workflows/launch"),
      {
        data: {
          workspaceId: workspace.id,
          designId,
          version: 1,
          inputs: { featureRequest: task },
          additionalInstructions:
            "LV2K API-first E2E should complete from the scripted VK XML response.",
          roleBindings: {
            implementer: {
              mode: "create_or_reuse",
              name: `lv2k-implementer-${unique}`,
            },
          },
        },
      },
    );
    const launchBody = await expectJsonOk(
      launched,
      201,
      "launch LV2K workflow",
    );
    // The launch response is intentionally a product run summary, not a full
    // persisted run row. Verify workflow identity through the presentation
    // read model below, where workflow/provenance belongs.
    expect(launchBody.run).toMatchObject({
      runId: expect.stringContaining("workflow-run-"),
      workspaceId: workspace.id,
      status: expect.any(String),
      detailUrl: expect.stringContaining("/dashboard/workflows/"),
    });

    const presentation = await waitForPersistedPresentationCompleted(
      request,
      launchBody.run.runId,
    );
    const renderedPresentation = JSON.stringify(presentation);
    const queuedPromptMarkers = presentation.timeline
      .map((item) => item.initialMessage?.text ?? "")
      .filter((text) => text.includes("LV2K_STEP:simple_decide"));

    expect(presentation.workflowName).toBe("LV2K Simple Agent Decision");
    expect(presentation.workflowId).toBe(designId);
    expect(presentation.provenance).toMatchObject({
      workflowDesignId: designId,
      workflowVersion: 1,
    });
    expect(presentation.originalTask).toBe(task);
    expect(presentation.timeline.map((item) => item.role)).toContain(
      "Implementer",
    );
    expect(queuedPromptMarkers).toHaveLength(1);
    expect(renderedPresentation).toContain("Action: Done");
    expect(renderedPresentation).toContain(
      "Finished simple task through real VK qa-mode XML loopback.",
    );
    for (const forbidden of forbiddenPresentationTerms) {
      expect(renderedPresentation).not.toContain(forbidden);
    }

    await writeLv2kArtifact(testInfo, "lv2k-simple-api-artifacts", {
      testCaseId: "TEST_CASE_LV2K_2A",
      fixtureMatrix: fixtureMatrix.fixtures,
      workflowSetup: {
        route: "POST /dashboard/api/workflow-designs",
        designId,
        draftId,
        version: 1,
        usedDbSeeding: false,
        usedImportRoute: false,
      },
      launch: {
        route: "POST /dashboard/api/workflows/launch",
        runId: launchBody.run.runId,
        workspaceId: workspace.id,
      },
      vkQaMode: {
        scriptedOutcomeFile: process.env.VK_QA_SCRIPTED_OUTCOME_FILE,
        promptContains: "LV2K_STEP:simple_decide",
        scriptedXmlResponseBody: expectedXml,
        usedDirectRuntimeCompletion: false,
      },
      queuedPromptMarkers,
      presentation,
      forbiddenPresentationTerms,
    });
  });

  test("TEST_CASE_LV2K_2B loads inline-prompt DRT JSON and completes a Review loop through HTTP read models", async ({
    request,
  }, testInfo) => {
    test.setTimeout(600_000);

    await expectDashboardHealth(request);
    await expectProvisionedWebhook(request);
    const workspace = await firstWorkspace(request);

    const unique = Date.now();
    const designId = `lv2k-drt-design-${unique}`;
    const draftId = `lv2k-drt-draft-${unique}`;
    const task = `LV2K DRT API fixture task ${unique}`;

    const created = await request.post(url("/dashboard/api/workflow-designs"), {
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
    const createBody = await expectJsonOk(
      created,
      201,
      "create/publish LV2K DRT workflow design",
    );
    expect(createBody).toMatchObject({
      design: { designId, latestPublishedVersion: 1 },
      draft: { draftId, designId },
      version: { designId, version: 1 },
      editor: { designId, validationStatus: "valid" },
    });

    const launched = await request.post(
      url("/dashboard/api/workflows/launch"),
      {
        data: {
          workspaceId: workspace.id,
          designId,
          version: 1,
          inputs: { featureRequest: task },
          additionalInstructions:
            "LV2K DRT API-first E2E should complete from scripted VK XML responses.",
          roleBindings: {
            dev: { mode: "create_or_reuse", name: `lv2k-drt-dev-${unique}` },
            review: {
              mode: "create_or_reuse",
              name: `lv2k-drt-review-${unique}`,
            },
            tester: {
              mode: "create_or_reuse",
              name: `lv2k-drt-tester-${unique}`,
            },
          },
        },
      },
    );
    const launchBody = await expectJsonOk(
      launched,
      201,
      "launch LV2K DRT workflow",
    );
    expect(launchBody.run).toMatchObject({
      runId: expect.stringContaining("workflow-run-"),
      workspaceId: workspace.id,
      status: expect.any(String),
      detailUrl: expect.stringContaining("/dashboard/workflows/"),
    });

    const presentation = await waitForPersistedPresentationCompleted(
      request,
      launchBody.run.runId,
      "LV2K DRT workflow should complete from qa-mode VK XML messages",
    );
    const renderedPresentation = JSON.stringify(presentation);
    const markerCounts = countQueuedPromptMarkers(presentation, [
      "LV2K_STEP:drt_dev_implement",
      "LV2K_STEP:drt_dev_self_review",
      "LV2K_STEP:drt_review",
      "LV2K_STEP:drt_tester",
    ]);

    expect(presentation.workflowName).toBe("LV2K Dev / Review / Tester");
    expect(presentation.workflowId).toBe(designId);
    expect(presentation.provenance).toMatchObject({
      workflowDesignId: designId,
      workflowVersion: 1,
    });
    expect(presentation.originalTask).toBe(task);
    expect(presentation.timeline.map((item) => item.role)).toEqual(
      expect.arrayContaining(["Dev", "Review", "Tester"]),
    );
    expect(markerCounts).toEqual({
      "LV2K_STEP:drt_dev_implement": 2,
      "LV2K_STEP:drt_dev_self_review": 2,
      "LV2K_STEP:drt_review": 2,
      "LV2K_STEP:drt_tester": 1,
    });
    expect(renderedPresentation).toContain("Action: Request changes");
    expect(renderedPresentation).toContain(
      "Fix the LV2K review issue before testing.",
    );
    expect(renderedPresentation).toContain("Fixed the LV2K review issue.");
    expect(renderedPresentation).toContain(
      "Review approves the LV2K DRT changes after the loop.",
    );
    expect(renderedPresentation).toContain(
      "Tester approves the LV2K DRT workflow after the review loop.",
    );
    for (const forbidden of forbiddenPresentationTerms) {
      expect(renderedPresentation).not.toContain(forbidden);
    }

    await writeLv2kArtifact(testInfo, "lv2k-drt-api-artifacts", {
      testCaseId: "TEST_CASE_LV2K_2B",
      fixtureMatrix: fixtureMatrix.fixtures,
      workflowSetup: {
        route: "POST /dashboard/api/workflow-designs",
        designId,
        draftId,
        version: 1,
        usedDbSeeding: false,
        usedImportRoute: false,
      },
      launch: {
        route: "POST /dashboard/api/workflows/launch",
        runId: launchBody.run.runId,
        workspaceId: workspace.id,
      },
      vkQaMode: {
        scriptedOutcomeFile: process.env.VK_QA_SCRIPTED_OUTCOME_FILE,
        promptContains: [
          "LV2K_STEP:drt_dev_implement",
          "LV2K_STEP:drt_dev_self_review",
          "LV2K_STEP:drt_review",
          "LV2K_STEP:drt_tester",
        ],
        scriptedXmlResponseBodies: lv2kScriptedOutcomes.outcomes
          .filter((entry) => entry.final_message?.startsWith("<decision"))
          .map((entry) => entry.final_message),
        usedDirectRuntimeCompletion: false,
      },
      queuedPromptMarkers: markerCounts,
      presentation,
      forbiddenPresentationTerms,
    });
  });

  test("TEST_CASE_LV2K_2F retries invalid VK XML and surfaces blocked needs-attention presentation", async ({
    request,
  }, testInfo) => {
    test.setTimeout(600_000);

    await expectDashboardHealth(request);
    await expectProvisionedWebhook(request);
    const workspace = await firstWorkspace(request);

    const unique = Date.now();
    const designId = `lv2k-invalid-xml-design-${unique}`;
    const draftId = `lv2k-invalid-xml-draft-${unique}`;
    const task = `LV2K invalid XML API fixture task ${unique}`;

    const created = await request.post(url("/dashboard/api/workflow-designs"), {
      data: {
        workspaceId: workspace.id,
        designId,
        draftId,
        name: invalidXmlWorkflowDefinition.name,
        description: invalidXmlWorkflowDefinition.description,
        definition: invalidXmlWorkflowDefinition,
        publish: true,
      },
    });
    const createBody = await expectJsonOk(
      created,
      201,
      "create/publish LV2K invalid XML workflow design",
    );
    expect(createBody).toMatchObject({
      design: { designId, latestPublishedVersion: 1 },
      draft: { draftId, designId },
      version: { designId, version: 1 },
      editor: { designId, validationStatus: "valid" },
    });

    const launched = await request.post(
      url("/dashboard/api/workflows/launch"),
      {
        data: {
          workspaceId: workspace.id,
          designId,
          version: 1,
          inputs: { featureRequest: task },
          additionalInstructions:
            "LV2K invalid XML E2E should retry once and then need attention.",
          roleBindings: {
            reviewer: {
              mode: "create_or_reuse",
              name: `lv2k-invalid-reviewer-${unique}`,
            },
          },
        },
      },
    );
    const launchBody = await expectJsonOk(
      launched,
      201,
      "launch LV2K invalid XML workflow",
    );
    expect(launchBody.run).toMatchObject({
      runId: expect.stringContaining("workflow-run-"),
      workspaceId: workspace.id,
      status: expect.any(String),
      detailUrl: expect.stringContaining("/dashboard/workflows/"),
    });

    const presentation = await waitForPersistedPresentationStatus(
      request,
      launchBody.run.runId,
      "failed",
      "LV2K invalid XML workflow should surface blocked/needs-attention product state",
    );
    const renderedPresentation = JSON.stringify(presentation);
    const markerCounts = countQueuedPromptMarkers(presentation, [
      "LV2K_STEP:invalid_xml_decide",
    ]);

    expect(presentation.workflowName).toBe("LV2K Invalid XML Blocked");
    expect(presentation.workflowId).toBe(designId);
    expect(presentation.provenance).toMatchObject({
      workflowDesignId: designId,
      workflowVersion: 1,
    });
    expect(presentation.originalTask).toBe(task);
    expect(presentation.status).toBe("failed");
    expect(presentation.summary).toMatchObject({
      statusLabel: "Needs attention",
    });
    expect(presentation.summary?.waitingReason ?? "").toContain(
      "decision response failed validation after 1 retry attempts",
    );
    expect(presentation.summary?.nextAction ?? "").toContain(
      "Review the invalid response",
    );
    // Retry prompts intentionally render the original step prompt and append
    // validation guidance, so the stable LV2K marker appears once for the
    // initial turn and once for the retry turn.
    expect(markerCounts).toEqual({ "LV2K_STEP:invalid_xml_decide": 2 });
    expect(presentation.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "retry",
          title: "Decision retry requested",
          status: "Needs attention",
        }),
        expect.objectContaining({
          kind: "blocked",
          title: "Workflow needs attention",
          status: "Needs attention",
        }),
      ]),
    );
    expect(renderedPresentation).toContain("response must be XML");
    expect(renderedPresentation).toContain("Workflow needs attention");
    expect(renderedPresentation).toContain(
      "decision response failed validation after 1 retry attempts",
    );
    for (const forbidden of forbiddenPresentationTerms) {
      expect(renderedPresentation).not.toContain(forbidden);
    }

    await writeLv2kArtifact(testInfo, "lv2k-invalid-xml-api-artifacts", {
      testCaseId: "TEST_CASE_LV2K_2F",
      fixtureMatrix: fixtureMatrix.fixtures,
      workflowSetup: {
        route: "POST /dashboard/api/workflow-designs",
        designId,
        draftId,
        version: 1,
        usedDbSeeding: false,
        usedImportRoute: false,
      },
      launch: {
        route: "POST /dashboard/api/workflows/launch",
        runId: launchBody.run.runId,
        workspaceId: workspace.id,
      },
      vkQaMode: {
        scriptedOutcomeFile: process.env.VK_QA_SCRIPTED_OUTCOME_FILE,
        promptContains: "LV2K_STEP:invalid_xml_decide",
        firstInvalidMessage: scriptedMessageFor("LV2K_STEP:invalid_xml_decide"),
        exhaustedInvalidXml:
          '<decision action="unknown_action"><summary>This action should be rejected after retry.</summary></decision>',
        usedDirectRuntimeCompletion: false,
      },
      queuedPromptMarkers: markerCounts,
      presentation,
      forbiddenPresentationTerms,
      readModelFollowUp:
        presentation.status === "failed"
          ? "Presentation maps blocked runtime status to failed while summary/timeline expose Needs attention."
          : null,
    });
  });

  test("TEST_CASE_LV2K_2C creates human form attention, resumes via HTTP, and completes after VK XML", async ({
    request,
  }, testInfo) => {
    test.setTimeout(600_000);

    await expectDashboardHealth(request);
    await expectProvisionedWebhook(request);
    const workspace = await firstWorkspace(request);

    const unique = Date.now();
    const designId = `lv2k-human-form-design-${unique}`;
    const draftId = `lv2k-human-form-draft-${unique}`;
    const task = `LV2K human form API fixture task ${unique}`;

    const created = await request.post(url("/dashboard/api/workflow-designs"), {
      data: {
        workspaceId: workspace.id,
        designId,
        draftId,
        name: humanFormWorkflowDefinition.name,
        description: humanFormWorkflowDefinition.description,
        definition: humanFormWorkflowDefinition,
        publish: true,
      },
    });
    const createBody = await expectJsonOk(
      created,
      201,
      "create/publish LV2K human form workflow design",
    );
    expect(createBody).toMatchObject({
      design: { designId, latestPublishedVersion: 1 },
      draft: { draftId, designId },
      version: { designId, version: 1 },
      editor: { designId, validationStatus: "valid" },
    });

    const launched = await request.post(
      url("/dashboard/api/workflows/launch"),
      {
        data: {
          workspaceId: workspace.id,
          designId,
          version: 1,
          inputs: { featureRequest: task },
          additionalInstructions:
            "LV2K human form E2E should wait for human approval, resume, then complete from scripted VK XML.",
          roleBindings: {
            dev: { mode: "create_or_reuse", name: `lv2k-human-dev-${unique}` },
          },
        },
      },
    );
    const launchBody = await expectJsonOk(
      launched,
      201,
      "launch LV2K human form workflow",
    );
    expect(launchBody.run).toMatchObject({
      runId: expect.stringContaining("workflow-run-"),
      workspaceId: workspace.id,
      status: expect.any(String),
      detailUrl: expect.stringContaining("/dashboard/workflows/"),
    });

    const waitingPresentation = await waitForPersistedPresentationMatching(
      request,
      launchBody.run.runId,
      (presentation) =>
        presentation.timeline.some(
          (item) =>
            item.kind === "human_form" && item.status === "Waiting for you",
        ),
      "LV2K human form workflow should wait for a product attention item",
    );
    const waitingRendered = JSON.stringify(waitingPresentation);
    expect(waitingPresentation).toMatchObject({
      workflowName: "LV2K Human Form Resume",
      workflowId: designId,
      status: "running",
      originalTask: task,
    });
    expect(waitingPresentation.provenance).toMatchObject({
      workflowDesignId: designId,
      workflowVersion: 1,
    });
    expect(waitingPresentation.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "human_form",
          title: "Approve LV2K implementation plan",
          status: "Waiting for you",
          responseUnavailable: "Waiting for your answer.",
        }),
      ]),
    );
    for (const forbidden of forbiddenPresentationTerms) {
      expect(waitingRendered).not.toContain(forbidden);
    }

    const activeAttention = await waitForActiveAttention(
      request,
      launchBody.run.runId,
    );
    expect(activeAttention).toMatchObject({
      status: "active",
      title: "Approve LV2K implementation plan",
      description: "Review the LV2K plan before the Dev agent continues.",
      presentationUrl: `/dashboard/workflows/${launchBody.run.runId}`,
    });
    expect(activeAttention.formRef ?? "").toContain("beads-form://workflow/");
    expect(JSON.stringify(activeAttention.formSchema)).toContain("approved");
    expect(JSON.stringify(activeAttention.formSchema)).toContain("remarks");

    const homeWithAttention = await expectJsonOk(
      await request.get(
        url(
          `/dashboard/api/workflows/home?workspaceId=${encodeURIComponent(workspace.id)}`,
        ),
      ),
      200,
      "load workflows home with LV2K human attention",
    );
    expect(homeWithAttention.home.needsInput).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attentionItemId: activeAttention.attentionItemId,
          title: "Approve LV2K implementation plan",
          workflowName: "LV2K Human Form Resume",
        }),
      ]),
    );

    const completion = await request.post(
      url(
        `/dashboard/api/workflow-attention-items/${encodeURIComponent(activeAttention.attentionItemId)}/complete`,
      ),
      {
        data: {
          stateVisitId: activeAttention.stateVisitId,
          submission: { approved: true, remarks: "Ship it from LV2K." },
        },
      },
    );
    const completionBody = await expectJsonOk(
      completion,
      200,
      "complete LV2K human attention via HTTP",
    );
    expect(completionBody).toMatchObject({
      result: {
        applied: true,
        reason: "applied",
        attention: { status: "resolved" },
      },
    });

    const presentation = await waitForPersistedPresentationCompleted(
      request,
      launchBody.run.runId,
      "LV2K human form workflow should complete after HTTP form submission and VK XML decision",
    );
    const renderedPresentation = JSON.stringify(presentation);
    const markerCounts = countQueuedPromptMarkers(presentation, [
      "LV2K_STEP:human_after_approval",
    ]);

    expect(presentation.workflowName).toBe("LV2K Human Form Resume");
    expect(presentation.workflowId).toBe(designId);
    expect(presentation.provenance).toMatchObject({
      workflowDesignId: designId,
      workflowVersion: 1,
    });
    expect(presentation.originalTask).toBe(task);
    expect(markerCounts).toEqual({ "LV2K_STEP:human_after_approval": 1 });
    expect(presentation.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "human_form",
          title: "Approve LV2K implementation plan",
          status: "Answered",
          finalResponse: expect.objectContaining({
            text: expect.stringContaining("approved: true"),
          }),
        }),
        expect.objectContaining({
          kind: "agent_turn",
          role: "Dev",
          status: "Complete",
        }),
        expect.objectContaining({
          kind: "decision",
          title: "Decision: Done",
        }),
      ]),
    );
    expect(renderedPresentation).toContain("remarks: Ship it from LV2K.");
    expect(renderedPresentation).toContain(
      "Completed LV2K human form workflow after approval.",
    );
    for (const forbidden of forbiddenPresentationTerms) {
      expect(renderedPresentation).not.toContain(forbidden);
    }

    await writeLv2kArtifact(testInfo, "lv2k-human-form-api-artifacts", {
      testCaseId: "TEST_CASE_LV2K_2C",
      fixtureMatrix: fixtureMatrix.fixtures,
      workflowSetup: {
        route: "POST /dashboard/api/workflow-designs",
        designId,
        draftId,
        version: 1,
        usedDbSeeding: false,
        usedImportRoute: false,
      },
      launch: {
        route: "POST /dashboard/api/workflows/launch",
        runId: launchBody.run.runId,
        workspaceId: workspace.id,
      },
      humanAttention: {
        listRoute:
          "GET /dashboard/api/workflow-attention-items?status=active&instanceId=:runId",
        completeRoute:
          "POST /dashboard/api/workflow-attention-items/:attentionItemId/complete",
        attentionItemId: activeAttention.attentionItemId,
        formRef: activeAttention.formRef,
        submission: { approved: true, remarks: "Ship it from LV2K." },
      },
      vkQaMode: {
        scriptedOutcomeFile: process.env.VK_QA_SCRIPTED_OUTCOME_FILE,
        promptContains: "LV2K_STEP:human_after_approval",
        scriptedXmlResponseBody: scriptedMessageFor(
          "LV2K_STEP:human_after_approval",
        ),
        usedDirectRuntimeCompletion: false,
      },
      queuedPromptMarkers: markerCounts,
      waitingPresentation,
      completedPresentation: presentation,
      forbiddenPresentationTerms,
    });
  });

  test("TEST_CASE_LV2K_2D loads parent/child workflows and completes a blocking workflow_call through HTTP read models", async ({
    request,
  }, testInfo) => {
    test.setTimeout(600_000);

    await expectDashboardHealth(request);
    await expectProvisionedWebhook(request);
    const workspace = await firstWorkspace(request);

    const unique = Date.now();
    const childDesignId = `lv2k-workflow-call-child-design-${unique}`;
    const childDraftId = `lv2k-workflow-call-child-draft-${unique}`;
    const parentDesignId = `lv2k-workflow-call-parent-design-${unique}`;
    const parentDraftId = `lv2k-workflow-call-parent-draft-${unique}`;
    const task = `LV2K blocking workflow call API fixture task ${unique}`;
    const parentDefinition = workflowDefinitionWithChildDesignId(
      workflowCallParentDefinition,
      childDesignId,
    );

    const childCreated = await request.post(
      url("/dashboard/api/workflow-designs"),
      {
        data: {
          workspaceId: workspace.id,
          designId: childDesignId,
          draftId: childDraftId,
          name: workflowCallChildDefinition.name,
          description: workflowCallChildDefinition.description,
          definition: workflowCallChildDefinition,
          publish: true,
        },
      },
    );
    const childCreateBody = await expectJsonOk(
      childCreated,
      201,
      "create/publish LV2K child workflow design",
    );
    expect(childCreateBody).toMatchObject({
      design: { designId: childDesignId, latestPublishedVersion: 1 },
      draft: { draftId: childDraftId, designId: childDesignId },
      version: { designId: childDesignId, version: 1 },
      editor: { designId: childDesignId, validationStatus: "valid" },
    });

    const parentCreated = await request.post(
      url("/dashboard/api/workflow-designs"),
      {
        data: {
          workspaceId: workspace.id,
          designId: parentDesignId,
          draftId: parentDraftId,
          name: parentDefinition.name,
          description: parentDefinition.description,
          definition: parentDefinition,
          publish: true,
        },
      },
    );
    const parentCreateBody = await expectJsonOk(
      parentCreated,
      201,
      "create/publish LV2K parent workflow design",
    );
    expect(parentCreateBody).toMatchObject({
      design: { designId: parentDesignId, latestPublishedVersion: 1 },
      draft: { draftId: parentDraftId, designId: parentDesignId },
      version: { designId: parentDesignId, version: 1 },
      editor: { designId: parentDesignId, validationStatus: "valid" },
    });

    const launched = await request.post(
      url("/dashboard/api/workflows/launch"),
      {
        data: {
          workspaceId: workspace.id,
          designId: parentDesignId,
          version: 1,
          inputs: { featureRequest: task },
          additionalInstructions:
            "LV2K workflow-call E2E should launch a blocking child workflow, wait, then resume the parent.",
          roleBindings: {
            dev: {
              mode: "create_or_reuse",
              name: `lv2k-workflow-call-dev-${unique}`,
            },
          },
        },
      },
    );
    const launchBody = await expectJsonOk(
      launched,
      201,
      "launch LV2K parent workflow-call workflow",
    );
    expect(launchBody.run).toMatchObject({
      runId: expect.stringContaining("workflow-run-"),
      workspaceId: workspace.id,
      status: expect.any(String),
      detailUrl: expect.stringContaining("/dashboard/workflows/"),
    });

    const waitingParent = await waitForPersistedPresentationMatching(
      request,
      launchBody.run.runId,
      (presentation) =>
        (presentation.callTree ?? []).some(
          (item) =>
            item.status === "running" &&
            item.waitingReason ===
              "Parent is waiting for this child workflow to finish.",
        ),
      "LV2K parent workflow should expose waiting child workflow call",
    );
    const waitingCall = firstCallTreeItem(waitingParent);
    expect(waitingCall).toMatchObject({
      status: "running",
      childUrl: expect.stringContaining("/dashboard/workflows/"),
      waitingReason: "Parent is waiting for this child workflow to finish.",
    });
    expect(waitingCall.childRunId).toContain(launchBody.run.runId);
    expect(waitingParent.summary).toMatchObject({
      waitingReason: "Waiting for a child workflow to finish.",
      nextAction:
        "The parent workflow resumes when the child workflow completes.",
    });

    const childPresentation = await waitForPersistedPresentationCompleted(
      request,
      waitingCall.childRunId,
      "LV2K child workflow should complete through qa-mode VK XML",
    );
    expect(childPresentation).toMatchObject({
      workflowName: "LV2K Child Review Workflow",
      workflowId: childDesignId,
      status: "completed",
      originalTask: task,
    });
    expect(childPresentation.provenance).toMatchObject({
      workflowDesignId: childDesignId,
      workflowVersion: 1,
    });
    expect(JSON.stringify(childPresentation)).toContain(
      "Child workflow completed the LV2K blocking call review.",
    );

    const presentation = await waitForPersistedPresentationCompleted(
      request,
      launchBody.run.runId,
      "LV2K parent workflow should resume after expected child completion",
    );
    const renderedPresentation = JSON.stringify(presentation);
    const markerCounts = countQueuedPromptMarkers(presentation, [
      "LV2K_STEP:workflow_call_parent_after_child",
    ]);
    const childMarkerCounts = countQueuedPromptMarkers(childPresentation, [
      "LV2K_STEP:workflow_call_child",
    ]);

    expect(presentation.workflowName).toBe(
      "LV2K Parent Blocking Workflow Call",
    );
    expect(presentation.workflowId).toBe(parentDesignId);
    expect(presentation.provenance).toMatchObject({
      workflowDesignId: parentDesignId,
      workflowVersion: 1,
    });
    expect(presentation.originalTask).toBe(task);
    expect(markerCounts).toEqual({
      "LV2K_STEP:workflow_call_parent_after_child": 1,
    });
    expect(childMarkerCounts).toEqual({ "LV2K_STEP:workflow_call_child": 1 });
    expect(presentation.callTree).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          childRunId: waitingCall.childRunId,
          childUrl: `/dashboard/workflows/${waitingCall.childRunId}`,
          status: "completed",
          waitingReason: null,
          outputRef: expect.stringContaining(waitingCall.childRunId),
        }),
      ]),
    );
    expect(presentation.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "workflow_call",
          title: expect.stringContaining("Call"),
          status: "Complete",
          finalResponse: expect.objectContaining({
            text: expect.stringContaining("completed"),
          }),
        }),
        expect.objectContaining({
          kind: "agent_turn",
          role: "Dev",
          status: "Complete",
          initialMessage: expect.objectContaining({
            text: expect.stringContaining(
              "LV2K_STEP:workflow_call_parent_after_child",
            ),
          }),
        }),
        expect.objectContaining({
          kind: "decision",
          title: "Decision: Done",
        }),
      ]),
    );
    expect(presentation.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "workflow_call_output",
          label: expect.stringContaining("output"),
          value: expect.stringContaining(waitingCall.childRunId),
        }),
      ]),
    );
    expect(renderedPresentation).toContain(
      "Parent completed after expected child workflow call result.",
    );
    for (const forbidden of forbiddenPresentationTerms) {
      expect(renderedPresentation).not.toContain(forbidden);
      expect(JSON.stringify(childPresentation)).not.toContain(forbidden);
    }

    await writeLv2kArtifact(testInfo, "lv2k-workflow-call-api-artifacts", {
      testCaseId: "TEST_CASE_LV2K_2D",
      fixtureMatrix: fixtureMatrix.fixtures,
      workflowSetup: {
        route: "POST /dashboard/api/workflow-designs",
        childDesignId,
        childDraftId,
        parentDesignId,
        parentDraftId,
        version: 1,
        usedDbSeeding: false,
        usedImportRoute: false,
      },
      launch: {
        route: "POST /dashboard/api/workflows/launch",
        parentRunId: launchBody.run.runId,
        childRunId: waitingCall.childRunId,
        workspaceId: workspace.id,
      },
      vkQaMode: {
        scriptedOutcomeFile: process.env.VK_QA_SCRIPTED_OUTCOME_FILE,
        promptContains: [
          "LV2K_STEP:workflow_call_child",
          "LV2K_STEP:workflow_call_parent_after_child",
        ],
        scriptedXmlResponseBodies: [
          scriptedMessageFor("LV2K_STEP:workflow_call_child"),
          scriptedMessageFor("LV2K_STEP:workflow_call_parent_after_child"),
        ],
        usedDirectRuntimeCompletion: false,
      },
      queuedPromptMarkers: { parent: markerCounts, child: childMarkerCounts },
      waitingParentPresentation: waitingParent,
      childPresentation,
      completedParentPresentation: presentation,
      staleWrongChildCoverage:
        "HTTP API does not expose an observation injection route; mismatched childRunId stale/no-op is covered by workflow-core and persisted runtime M99 regressions while this fixture verifies the expected child path through real VD/VK HTTP boundaries.",
      forbiddenPresentationTerms,
    });
  });
});

function url(path: string) {
  return new URL(path, sandboxUrl).toString();
}

async function expectJsonOk(
  response: APIResponse,
  status: number,
  label: string,
) {
  const body = await response
    .json()
    .catch(async () => ({ raw: await response.text().catch(() => "") }));
  expect(response.status(), `${label}: ${JSON.stringify(body)}`).toBe(status);
  return body as any;
}

async function expectDashboardHealth(request: APIRequestContext) {
  await expect
    .poll(
      async () => {
        const response = await request.get(
          url("/dashboard/api/workflows/health"),
        );
        if (!response.ok()) return null;
        try {
          return (await response.json()) as { ok?: boolean };
        } catch {
          return null;
        }
      },
      {
        timeout: 120_000,
        message: "dashboard workflow health should return JSON",
      },
    )
    .toEqual({ ok: true });
}

async function firstWorkspace(request: APIRequestContext): Promise<Workspace> {
  let workspace: Workspace | null = null;
  await expect
    .poll(
      async () => {
        const response = await request.get(url("/vk-api/workspaces"));
        if (!response.ok()) return null;
        const body = (await response.json()) as { data?: Workspace[] };
        workspace = body.data?.[0] ?? null;
        return workspace?.id ?? null;
      },
      {
        timeout: 600_000,
        intervals: [1_000, 2_000, 5_000],
        message: "seeded VK workspace should become available",
      },
    )
    .not.toBeNull();
  if (!workspace)
    throw new Error("Expected seeded VK workspace in qa-mode sandbox");
  return workspace;
}

async function expectProvisionedWebhook(
  request: APIRequestContext,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await request.get(
          url("/dashboard/api/workflow-webhooks/provisioning"),
        );
        if (!response.ok()) return null;
        const body = (await response.json()) as {
          state?: { status?: string } | null;
        };
        return body.state?.status ?? null;
      },
      {
        timeout: 60_000,
        intervals: [1_000, 2_000, 5_000],
        message: "VD should self-provision VK terminal execution webhook",
      },
    )
    .toBe("provisioned");
}

async function waitForPersistedPresentationCompleted(
  request: APIRequestContext,
  runId: string,
  message = "LV2K simple workflow should complete from qa-mode VK XML message",
): Promise<Presentation> {
  return waitForPersistedPresentationStatus(
    request,
    runId,
    "completed",
    message,
  );
}

async function waitForPersistedPresentationStatus(
  request: APIRequestContext,
  runId: string,
  expectedStatus: string,
  message: string,
): Promise<Presentation> {
  let last: Presentation | null = null;
  await expect
    .poll(
      async () => {
        const response = await request.get(
          url(
            `/dashboard/api/workflow-instances/${encodeURIComponent(runId)}/presentation`,
          ),
        );
        if (!response.ok()) return null;
        const body = (await response.json()) as { presentation: Presentation };
        last = body.presentation;
        return last.status;
      },
      { timeout: 240_000, intervals: [1_000, 2_000, 5_000], message },
    )
    .toBe(expectedStatus);
  return last!;
}

async function waitForPersistedPresentationMatching(
  request: APIRequestContext,
  runId: string,
  predicate: (presentation: Presentation) => boolean,
  message: string,
): Promise<Presentation> {
  let last: Presentation | null = null;
  await expect
    .poll(
      async () => {
        const response = await request.get(
          url(
            `/dashboard/api/workflow-instances/${encodeURIComponent(runId)}/presentation`,
          ),
        );
        if (!response.ok()) return false;
        const body = (await response.json()) as { presentation: Presentation };
        last = body.presentation;
        return predicate(last);
      },
      { timeout: 240_000, intervals: [1_000, 2_000, 5_000], message },
    )
    .toBe(true);
  return last!;
}

async function waitForActiveAttention(
  request: APIRequestContext,
  runId: string,
): Promise<AttentionItem> {
  let item: AttentionItem | null = null;
  await expect
    .poll(
      async () => {
        const response = await request.get(
          url(
            `/dashboard/api/workflow-attention-items?status=active&instanceId=${encodeURIComponent(runId)}&limit=5`,
          ),
        );
        if (!response.ok()) return null;
        const body = (await response.json()) as { items?: AttentionItem[] };
        item = body.items?.[0] ?? null;
        return item?.attentionItemId ?? null;
      },
      {
        timeout: 120_000,
        intervals: [1_000, 2_000, 5_000],
        message: "LV2K human form active attention item should be available",
      },
    )
    .not.toBeNull();
  return item!;
}

function firstCallTreeItem(presentation: Presentation) {
  const item = presentation.callTree?.[0];
  if (!item) throw new Error("Expected workflow presentation callTree item");
  return item;
}

function workflowDefinitionWithChildDesignId(
  definition: any,
  childDesignId: string,
) {
  const cloned = JSON.parse(JSON.stringify(definition));
  cloned.states.parent.steps[0].workflow.designId = childDesignId;
  return cloned;
}

function scriptedMessageFor(promptContains: string): string {
  return (
    lv2kScriptedOutcomes.outcomes.find(
      (entry) => entry.prompt_contains === promptContains,
    )?.final_message ?? ""
  );
}

function countQueuedPromptMarkers(
  presentation: Presentation,
  markers: string[],
): Record<string, number> {
  const counts = Object.fromEntries(
    markers.map((marker) => [marker, 0]),
  ) as Record<string, number>;
  for (const item of presentation.timeline) {
    const text = item.initialMessage?.text ?? "";
    for (const marker of markers) {
      if (text.includes(marker)) counts[marker] = (counts[marker] ?? 0) + 1;
    }
  }
  return counts;
}

async function writeLv2kArtifact(
  testInfo: TestInfo,
  name: string,
  artifact: unknown,
) {
  const artifactPath = testInfo.outputPath(`${name}.json`);
  await fs.writeFile(
    artifactPath,
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8",
  );
  await testInfo.attach(name, {
    path: artifactPath,
    contentType: "application/json",
  });
}
