import { describe, expect, it } from "vitest";
import {
  buildGasCityWorkspaceWorkflowPlan,
  createGasCitySessionAlias,
} from "./workspace-workflow";

describe("Gas City workspace workflow planning", () => {
  it("builds a worker-only adoption plan", () => {
    expect(
      buildGasCityWorkspaceWorkflowPlan({
        workflowMode: "gc_worker",
        workspaceName: "Auth Refactor",
        taskPrompt: "Fix login",
        workerTemplate: "worker",
        workerAlias: "auth-worker",
      }),
    ).toEqual({
      worker: {
        template: "worker",
        alias: "auth-worker",
        title: "Worker • Auth Refactor",
      },
    });
  });

  it("builds a reviewer kickoff plan with a safe default alias", () => {
    const plan = buildGasCityWorkspaceWorkflowPlan({
      workflowMode: "gc_worker_review",
      workspaceName: "Auth Refactor!",
      taskPrompt: "Fix login",
      workerTemplate: "worker",
      workflowPreset: "worker-review",
    });

    expect(plan.reviewer).toMatchObject({
      template: "reviewer",
      alias: "review-auth-refactor",
      title: "Reviewer • Auth Refactor! • worker-review",
      vkSessionName: "Reviewer • Auth Refactor! • worker-review",
    });
    expect(plan.reviewer?.kickoffPrompt).toContain("Original task prompt:\nFix login");
  });

  it("keeps generated aliases within the Gas City alias limit", () => {
    expect(createGasCitySessionAlias("review", "A".repeat(100))).toHaveLength(64);
  });
});
