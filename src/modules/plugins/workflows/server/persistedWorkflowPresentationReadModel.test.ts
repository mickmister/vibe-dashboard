import { describe, expect, it } from "vitest";
import {
  normalizeWorkflowDefinitionV1,
  type WorkflowRuntimeSnapshot,
} from "@vibe-dashboard/workflow-core";
import { initVdDb } from "../../../../server/database";
import { DbWorkflowDesignStore } from "./workflowDesignStore";
import { buildPersistedWorkflowPresentationModel } from "./persistedWorkflowPresentationReadModel";

const decisionResponse = {
  format: "xml" as const,
  schema: { format: "xsd" as const, source: "state_actions" as const },
  invalidXmlRetry: {
    maxAttempts: 1,
    prompt: "engine_default_with_validation_errors" as const,
    onExhausted: "blocked" as const,
  },
  storeRawXml: true,
  storeParsedFields: true,
  unknownFields: "reject_unless_allowed_by_result_contract" as const,
};

describe("buildPersistedWorkflowPresentationModel", () => {
  it("TEST_CASE_M105_1A-F tells the workflow run story without default debug transport terms", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    try {
      const designStore = new DbWorkflowDesignStore({
        db: handle.db,
        now: () => 10,
      });
      await designStore.createDesign({
        designId: "design.story",
        draftId: "draft.story",
        name: "Dev Review Tester",
        definition: definition(),
      });
      await designStore.publishDraft("draft.story");
      await designStore.createRunSnapshot({
        runSnapshotId: "snapshot.story",
        designId: "design.story",
        version: 1,
        workspaceId: "workspace-a",
        runInput: { featureRequest: "Build run story", workflowContext: { beadIds: ["vibe-kanban-vscode-web-erf2"], beads: [{ beadId: "vibe-kanban-vscode-web-erf2", title: "Clean run story page" }] } },
        roleBindings: {},
      });
      const model = normalizeWorkflowDefinitionV1(definition(), {
        workflowId: "design.story@1",
      });
      const snapshot: WorkflowRuntimeSnapshot = {
        instanceId: "run.story",
        workflowId: "design.story@1",
        status: "blocked",
        currentState: "review",
        currentStepIndex: 0,
        visitId: "visit-review",
        inputs: {
          featureRequest: "Build run story",
          workflowContext: {
            beadIds: ["vibe-kanban-vscode-web-erf2"],
            beads: [
              {
                beadId: "vibe-kanban-vscode-web-erf2",
                title: "Clean run story page",
              },
            ],
          },
        },
        waitingFor: {
          kind: "agent_turn",
          state: "review",
          stepId: "review_code",
          turnId: "turn-review-2",
        },
        latestTransition: {
          visitId: "visit-dev-loop",
          fromState: "review",
          toState: "dev",
          action: "changes_requested",
          responseRef: "response-review-1",
          parsed: { remarks: "Needs tests" },
        },
        blockedReason: {
          code: "WORKFLOW_DECISION_RETRY_EXHAUSTED",
          path: "states.review",
          message: "Review response stayed invalid after retry with raw XML, trigger delivery ID, execution process ID, provider diagnostics, response-dev-1, artifactRef, /tmp/secret.",
        },
        history: [
          {
            kind: "workflow_started",
            at: 1,
            state: "dev",
            visitId: "visit-dev",
          },
          {
            kind: "agent_turn_planned",
            at: 2,
            state: "dev",
            stepId: "implement",
            turnId: "turn-dev-1",
          },
          {
            kind: "agent_turn_completed",
            at: 3,
            state: "dev",
            stepId: "implement",
            turnId: "turn-dev-1",
            responseRef: "response-dev-1",
          },
          {
            kind: "state_transitioned",
            at: 4,
            transition: {
              visitId: "visit-dev",
              fromState: "dev",
              toState: "review",
              action: "ready_for_review",
              responseRef: "response-dev-1",
              rawXml: '<decision action="ready_for_review" />',
            },
            nextVisitId: "visit-review",
          },
          {
            kind: "agent_turn_planned",
            at: 5,
            state: "review",
            stepId: "review_code",
            turnId: "turn-review-1",
          },
          {
            kind: "agent_turn_completed",
            at: 6,
            state: "review",
            stepId: "review_code",
            turnId: "turn-review-1",
            responseRef: "response-review-1",
          },
          {
            kind: "state_transitioned",
            at: 7,
            transition: {
              visitId: "visit-review",
              fromState: "review",
              toState: "dev",
              action: "changes_requested",
              responseRef: "response-review-1",
              parsed: { remarks: "Needs tests" },
            },
            nextVisitId: "visit-dev-loop",
          },
          {
            kind: "human_form_planned",
            at: 8,
            state: "dev",
            stepId: "acceptance_form",
            turnId: "turn-form",
            title: "Answer acceptance questions",
          },
          {
            kind: "human_form_completed",
            at: 9,
            state: "dev",
            stepId: "acceptance_form",
            turnId: "turn-form",
            responseRef: "form-response",
            submission: { approved: true, notes: "Used bd show and shell output from /tmp/form" },
          },
          {
            kind: "workflow_call_planned",
            at: 10,
            state: "dev",
            stepId: "call_child",
            turnId: "turn-call",
            childRunId: "run.child",
            childDesignId: "design.child",
            childVersion: 1,
          },
          {
            kind: "workflow_call_completed",
            at: 11,
            state: "dev",
            stepId: "call_child",
            turnId: "turn-call",
            childRunId: "run.child",
            childStatus: "completed",
            responseRef: "run.child",
            outputRef: "recorded",
            statusSummary: "completed",
          },
          {
            kind: "decision_validation_failed",
            at: 12,
            state: "review",
            stepId: "review_code",
            turnId: "turn-review-2",
            responseRef: "bad-response",
            retryAttempt: 1,
            errors: [
              {
                code: "WORKFLOW_DECISION_VALIDATION_FAILED",
                path: "$",
                message: "raw XML response must include an action; see /Users/me/project and queue item id",
              },
            ],
          },
          {
            kind: "workflow_blocked",
            at: 13,
            reason: {
              code: "WORKFLOW_DECISION_RETRY_EXHAUSTED",
              path: "states.review",
              message: "Review response stayed invalid after retry with webhook queue-item HMAC raw JSON WorkflowStepState runReady /private/var/db responseRef.",
            },
          },
        ],
        createdAt: 1,
        updatedAt: 13,
      };
      await handle.db
        .insertInto("WorkflowPersistedRun")
        .values({
          runId: "run.story",
          runSnapshotId: "snapshot.story",
          designId: "design.story",
          designVersion: 1,
          workspaceId: "workspace-a",
          status: "blocked",
          coreModelJson: JSON.stringify(model),
          coreSnapshotJson: JSON.stringify(snapshot),
          roleBindingsJson: "{}",
          pendingEffectJson: null,
          queuedTurnsJson: JSON.stringify({
            "turn-dev-1": { role: "dev", sessionId: "session-dev" },
            "turn-review-1": { role: "review", sessionId: "session-review" },
            "turn-review-2": { role: "review", sessionId: "session-review" },
          }),
          eventsJson: JSON.stringify([
            {
              kind: "agent_turn_queued",
              at: 2,
              data: {
                turnId: "turn-dev-1",
                promptPreview: "Implement the feature\n\nExpected XML Schema (XSD):\n<xs:schema xmlns:xs=\"http://www.w3.org/2001/XMLSchema\"><xs:element name=\"decision\" /></xs:schema>\nraw XML webhook queue_item /tmp/secret",
              },
            },
            {
              kind: "form_artifact_created",
              at: 14,
              data: { artifactRef: "beads-form://artifact-1" },
            },
          ]),
          errorJson: null,
          createdAt: 1,
          updatedAt: 13,
        })
        .execute();

      const presentation = await buildPersistedWorkflowPresentationModel({
        db: handle.db,
        runId: "run.story",
      });

      expect(presentation).toMatchObject({
        workflowName: "Dev Review Tester",
        status: "failed",
        provenance: {
          label: "Dev Review Tester workflow v1",
          workflowName: "Dev Review Tester",
          workflowDesignId: "design.story",
          workflowVersion: 1,
        },
        summary: expect.objectContaining({
          currentOwner: "Review",
          currentState: "Review",
          currentStep: "Review Code",
          waitingReason: expect.stringContaining("Review response stayed invalid after retry"),
        }),
        callTree: [
          expect.objectContaining({
            childRunId: "run.child",
            childUrl: "/dashboard/workflows/run.child",
            outputRef: "recorded",
          }),
        ],
        beadContext: [
          expect.objectContaining({
            beadId: "vibe-kanban-vscode-web-erf2",
            title: "Clean run story page",
          }),
        ],
        outputs: expect.arrayContaining([
          expect.objectContaining({ kind: "form_artifact" }),
          expect.objectContaining({ kind: "workflow_call_output" }),
          expect.objectContaining({ kind: "error" }),
        ]),
      });
      expect(presentation?.timeline).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "agent_turn",
            role: "Dev",
            status: "Complete",
          }),
          expect.objectContaining({
            kind: "decision",
            title: "Review requested changes; Dev will revise",
          }),
          expect.objectContaining({ kind: "human_form", status: "Answered" }),
          expect.objectContaining({
            kind: "workflow_call",
            status: "Complete",
          }),
          expect.objectContaining({
            kind: "retry",
            title: "Decision retry requested",
          }),
          expect.objectContaining({
            kind: "blocked",
            title: "Workflow needs attention",
          }),
        ]),
      );
      const rendered = JSON.stringify(presentation);
      expect(rendered).toContain("Action: Ready for review");
      expect(rendered).toContain("Dev self-reviewed");
      expect(rendered).toContain("Review requested changes; Dev will revise");
      expect(rendered).toContain("Clean run story page");
      expect(rendered).toContain("Structured response contract included in the agent prompt.");
      expect(rendered).toContain("Remarks: Needs tests");
      for (const term of [
        "<xs:schema",
        "raw XML",
        "raw JSON",
        "queue item",
        "queue_item",
        "queue-item",
        "webhook",
        "trigger",
        "delivery ID",
        "execution process ID",
        "provider diagnostics",
        "WorkflowStepState",
        "runReady",
        "/Users/",
        "/tmp/",
        "/private/var/",
        "response-dev",
        "responseRef",
        "artifactRef",
        "workflow-run://",
        "beads-form://",
        "bd show",
        "shell output",
      ]) {
        expect(rendered).not.toContain(term);
      }
    } finally {
      await handle.db.destroy();
      handle.sqlite.close();
    }
  });

  it("TEST_CASE_M111_1F shows waiting-on-CI and final CI result without webhook wording", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    try {
      const designStore = new DbWorkflowDesignStore({
        db: handle.db,
        now: () => 10,
      });
      await designStore.createDesign({
        designId: "design.ci",
        draftId: "draft.ci",
        name: "CI workflow",
        definition: definition(),
      });
      await designStore.publishDraft("draft.ci");
      await designStore.createRunSnapshot({
        runSnapshotId: "snapshot.ci",
        designId: "design.ci",
        version: 1,
        workspaceId: "workspace-a",
        runInput: { featureRequest: "Wait for CI" },
        roleBindings: {},
      });
      const model = normalizeWorkflowDefinitionV1(definition(), {
        workflowId: "design.ci@1",
      });
      const snapshot: WorkflowRuntimeSnapshot = {
        instanceId: "run.ci",
        workflowId: "design.ci@1",
        status: "running",
        currentState: "dev",
        currentStepIndex: 0,
        visitId: "visit-ci",
        inputs: { featureRequest: "Wait for CI" },
        waitingFor: {
          kind: "github_ci",
          state: "dev",
          stepId: "implement",
          turnId: "ci-turn",
          action: "ready_for_review",
          targetState: "review",
          ciRunId: "123",
          repo: "acme/repo",
          sha: "abc123",
        },
        latestTransition: {
          visitId: "visit-ci",
          fromState: "dev",
          toState: "review",
          action: "ready_for_review",
          responseRef: "response-dev",
          parsed: { summary: "Pushed code", ciRunId: "123" },
        },
        history: [
          { kind: "workflow_started", at: 1, state: "dev", visitId: "visit-ci" },
          { kind: "agent_turn_planned", at: 2, state: "dev", stepId: "implement", turnId: "turn-dev" },
          { kind: "agent_turn_completed", at: 3, state: "dev", stepId: "implement", turnId: "turn-dev", responseRef: "response-dev" },
          { kind: "github_ci_wait_planned", at: 4, state: "dev", stepId: "implement", turnId: "ci-turn", action: "ready_for_review", targetState: "review", ciRunId: "123", repo: "acme/repo", sha: "abc123" },
        ],
        createdAt: 1,
        updatedAt: 4,
      };
      await handle.db.insertInto("WorkflowPersistedRun").values({
        runId: "run.ci",
        runSnapshotId: "snapshot.ci",
        designId: "design.ci",
        designVersion: 1,
        workspaceId: "workspace-a",
        status: "running",
        coreModelJson: JSON.stringify(model),
        coreSnapshotJson: JSON.stringify(snapshot),
        roleBindingsJson: "{}",
        pendingEffectJson: null,
        queuedTurnsJson: "{}",
        eventsJson: JSON.stringify([{ kind: "github_ci_watch_poll_error", at: 5, data: { turnId: "ci-turn", error: { message: "GitHub API rate limited via webhook trigger delivery ID /tmp/ci", retryAfterMs: 30000 } } }]),
        errorJson: null,
        createdAt: 1,
        updatedAt: 5,
      }).execute();
      const presentation = await buildPersistedWorkflowPresentationModel({ db: handle.db, runId: "run.ci" });
      expect(presentation?.summary?.waitingReason).toBe("Waiting for GitHub CI to finish.");
      expect(presentation?.timeline).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "github_ci",
          title: "Waiting for GitHub CI",
          status: "Waiting",
          responseUnavailable: expect.stringContaining("GitHub API rate limited"),
        }),
      ]));
      const rendered = JSON.stringify(presentation);
      expect(rendered).toContain("GitHub CI");
      expect(rendered).not.toContain("webhook");
      expect(rendered).not.toContain("trigger");
      expect(rendered).not.toContain("delivery ID");
      expect(rendered).not.toContain("/tmp/");
      expect(rendered).not.toContain("rawXml");

      const completedSnapshot: WorkflowRuntimeSnapshot = {
        ...snapshot,
        status: "completed",
        waitingFor: undefined,
        currentState: "done",
        history: [
          ...snapshot.history,
          {
            kind: "github_ci_wait_completed",
            at: 6,
            state: "dev",
            stepId: "implement",
            turnId: "ci-turn",
            action: "ready_for_review",
            targetState: "review",
            responseRef: "response-ci",
            status: "success",
            statusSummary:
              "Passed with raw JSON provider diagnostics and execution process ID.",
            detailsUrl: "file:///tmp/ci-details",
          },
        ],
        updatedAt: 6,
      };
      await handle.db
        .updateTable("WorkflowPersistedRun")
        .set({
          status: "completed",
          coreSnapshotJson: JSON.stringify(completedSnapshot),
          updatedAt: 6,
        })
        .where("runId", "=", "run.ci")
        .execute();
      const completedPresentation = await buildPersistedWorkflowPresentationModel({ db: handle.db, runId: "run.ci" });
      const completedRendered = JSON.stringify(completedPresentation);
      expect(completedRendered).toContain("GitHub CI finished");
      expect(completedRendered).toContain("Passed with response details provider status");
      expect(completedRendered).not.toContain("raw JSON");
      expect(completedRendered).not.toContain("provider diagnostics");
      expect(completedRendered).not.toContain("execution process ID");
      expect(completedRendered).not.toContain("/tmp/");
    } finally {
      await handle.db.destroy();
      handle.sqlite.close();
    }
  });


  it("TEST_CASE_M117_1C renders command results as product-readable timeline/output", async () => {
    const handle = await initVdDb({ path: ":memory:" });
    try {
      const designStore = new DbWorkflowDesignStore({ db: handle.db, now: () => 10 });
      await designStore.createDesign({
        designId: "design.command",
        draftId: "draft.command",
        name: "Command Workflow",
        definition: definition(),
      });
      await designStore.publishDraft("draft.command");
      await designStore.createRunSnapshot({
        runSnapshotId: "snapshot.command.presentation",
        designId: "design.command",
        version: 1,
        workspaceId: "workspace-a",
        runInput: {},
        roleBindings: {},
      });
      const model = normalizeWorkflowDefinitionV1(definition(), { workflowId: "design.command@1" });
      const snapshot: WorkflowRuntimeSnapshot = {
        instanceId: "run.command.presentation",
        workflowId: "design.command@1",
        status: "completed",
        currentState: "done",
        currentStepIndex: 0,
        visitId: "visit-command",
        inputs: {},
        history: [
          { kind: "workflow_started", at: 1, state: "dev", visitId: "visit-command" },
          { kind: "command_step_planned", at: 2, state: "dev", stepId: "collect_status", turnId: "turn-command", provider: "first_party.command", command: "workspace_status", access: "read" },
          { kind: "command_step_completed", at: 3, state: "dev", stepId: "collect_status", turnId: "turn-command", responseRef: "command:turn-command", provider: "first_party.command", command: "workspace_status", result: { summary: "Workspace clean", clean: true, changedFiles: 0 }, summary: "Workspace clean" },
        ],
        createdAt: 1,
        updatedAt: 3,
      };
      await handle.db.insertInto("WorkflowPersistedRun").values({
        runId: "run.command.presentation",
        runSnapshotId: "snapshot.command.presentation",
        designId: "design.command",
        designVersion: 1,
        workspaceId: "workspace-a",
        status: "completed",
        coreModelJson: JSON.stringify(model),
        coreSnapshotJson: JSON.stringify(snapshot),
        roleBindingsJson: "{}",
        pendingEffectJson: null,
        queuedTurnsJson: "{}",
        eventsJson: JSON.stringify([{ kind: "command_step_completed", at: 3, data: { turnId: "turn-command", summary: "Workspace clean", stdoutPreview: "clean" } }]),
        errorJson: null,
        createdAt: 1,
        updatedAt: 3,
      }).execute();

      const presentation = await buildPersistedWorkflowPresentationModel({ db: handle.db, runId: "run.command.presentation" });
      expect(presentation?.timeline).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "command", title: "Workspace Status", status: "Complete", finalResponse: expect.objectContaining({ text: expect.stringContaining("Workspace clean") }) }),
      ]));
      expect(presentation?.outputs).toEqual(expect.arrayContaining([
        expect.objectContaining({ label: "Workspace Status result", value: expect.stringContaining("Clean: true") }),
      ]));
      const rendered = JSON.stringify(presentation);
      expect(rendered).not.toContain("raw XML");
      expect(rendered).not.toContain("/Users/");
      expect(rendered).not.toContain("bd ");
    } finally {
      await handle.db.destroy();
      handle.sqlite.close();
    }
  });
});

function definition() {
  return {
    schemaVersion: 1,
    name: "Dev Review Tester",
    inputs: { featureRequest: { type: "markdown", required: true } },
    roles: { dev: { label: "Dev" }, review: { label: "Review" } },
    initialState: "dev",
    states: {
      dev: {
        owner: "dev",
        steps: [
          {
            id: "implement",
            type: "agent_turn",
            turnType: "decision",
            prompt: { template: "Implement" },
            response: decisionResponse,
          },
        ],
        actions: {
          ready_for_review: {
            label: "Ready for review",
            targetState: "review",
          },
        },
      },
      review: {
        owner: "review",
        steps: [
          {
            id: "review_code",
            type: "agent_turn",
            turnType: "decision",
            prompt: { template: "Review" },
            response: decisionResponse,
          },
        ],
        actions: {
          approved: { label: "Approved", targetState: "done" },
          changes_requested: { label: "Changes requested", targetState: "dev" },
        },
      },
      done: { terminal: true },
    },
  };
}
