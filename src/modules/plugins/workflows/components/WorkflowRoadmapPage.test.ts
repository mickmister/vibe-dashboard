import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildLiveWorkflowRoadmapModel,
  buildWorkflowRoadmapModel,
  emptyWorkflowRoadmapModel,
} from "../server/workflowRoadmapReadModel";
import { WorkflowRoadmapView } from "./WorkflowRoadmapPage";

const forbiddenTerms = [
  "raw JSON",
  "raw XML",
  "queue item",
  "webhook",
  "runReady",
  "WorkflowStepState",
  "bd update",
  "bd show",
  "shell command",
];

describe("WorkflowRoadmapView", () => {
  it("TEST_CASE_CKOV_1A/1B renders the roadmap hierarchy and review/tester progress", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkflowRoadmapView, {
        roadmap: buildWorkflowRoadmapModel({ now: () => 1_700_000 }),
        loading: false,
        error: null,
        onRefresh: () => undefined,
      }),
    );

    expect(html).toContain('data-testid="standalone-dashboard-page"');
    expect(html).toContain("Workflow builder and automation spike");
    expect(html).toContain("Roadmap status summary");
    expect(html).toContain("Complete");
    expect(html).toContain("In progress");
    expect(html).toContain("Review");
    expect(html).toContain("Remaining");
    expect(html).toContain("Sub-beads");
    expect(html).toContain("Workflow design store and prompt/skill library");
    expect(html).toContain("Executor/model preferences per workflow role");
    expect(html).toContain("Review pending");
    expect(html).toContain("Workflow roadmap and multi-bead progress UI");
    expect(html).toContain("Implementation in progress");
    expect(html).not.toContain("Open bead");
    expect(html).not.toContain("/beads/project");
    expect(html).not.toContain("Start meta-workflow from roadmap");
    expect(html).not.toContain("/dashboard/workflows/meta-runs?source=roadmap");
    for (const term of forbiddenTerms) expect(html).not.toContain(term);
  });

  it("TEST_CASE_M119B_1B/1C renders live provider freshness, warnings, and safe run links", async () => {
    const roadmap = await buildLiveWorkflowRoadmapModel({
      now: () => 55,
      provider: {
        providerId: "component-live",
        label: "Component live beads",
        async readBeads() {
          return {
            partial: true,
            updatedAt: 54,
            warnings: ["Some bead details are temporarily unavailable.", "bd show leaked /Users/example/private webhook queue item"],
            beads: [{ beadId: "vibe-kanban-vscode-web-ckov", status: "closed", summary: "Live done.", url: "/beads/project?bead=vibe-kanban-vscode-web-ckov" }],
          };
        },
        async listMetaRuns() {
          return [{ metaRunId: "meta-component", status: "completed", items: [{ beadId: "vibe-kanban-vscode-web-ckov", status: "completed", childRunId: "child-component" }] }];
        },
      },
    });
    const html = renderToStaticMarkup(
      React.createElement(WorkflowRoadmapView, {
        roadmap,
        loading: false,
        error: null,
        onRefresh: () => undefined,
      }),
    );

    expect(html).toContain("Component live beads");
    expect(html).toContain("Partial live data");
    expect(html).toContain("component-live");
    expect(html).toContain("Top-level milestones");
    expect(html).toContain("Some bead details are temporarily unavailable.");
    expect(html).toContain("workflow action");
    expect(html).toContain('/dashboard/workflows/child-component');
    expect(html).not.toContain("bd show");
    expect(html).not.toContain("/Users/");
    expect(html).not.toContain("queue item");
    for (const term of forbiddenTerms) expect(html).not.toContain(term);
  });

  it("TEST_CASE_CKOV_1E renders empty, loading, and error states safely", () => {
    const emptyHtml = renderToStaticMarkup(
      React.createElement(WorkflowRoadmapView, {
        roadmap: emptyWorkflowRoadmapModel(42),
        loading: false,
        error: null,
        onRefresh: () => undefined,
      }),
    );
    expect(emptyHtml).toContain("No roadmap selected");
    expect(emptyHtml).toContain("Choose a workflow spike to view milestone progress.");

    const loadingHtml = renderToStaticMarkup(
      React.createElement(WorkflowRoadmapView, {
        roadmap: null,
        loading: true,
        error: null,
        onRefresh: () => undefined,
      }),
    );
    expect(loadingHtml).toContain("Loading workflow roadmap");

    const errorHtml = renderToStaticMarkup(
      React.createElement(WorkflowRoadmapView, {
        roadmap: null,
        loading: false,
        error: "Roadmap service unavailable.",
        onRefresh: () => undefined,
      }),
    );
    expect(errorHtml).toContain("Roadmap service unavailable.");
    for (const term of forbiddenTerms) expect(errorHtml).not.toContain(term);
  });
});
