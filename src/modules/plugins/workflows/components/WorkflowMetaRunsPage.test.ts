import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkflowMetaRunsView } from "./WorkflowMetaRunsPage";
import type { WorkspaceWorkflowSummary } from "../client/workflowsHomeApi";
import type { MetaWorkflowBeadSummary, MetaWorkflowRunModel } from "../client/metaWorkflowApi";

const workflow: WorkspaceWorkflowSummary = {
  id: "design-child",
  title: "Child workflow",
  description: "Runs a bead",
  source: "published_design",
  status: "ready",
  version: 2,
  unavailableReason: null,
  canRun: true,
  inputs: [],
  roles: [{ id: "dev", label: "Dev", description: null }],
};
const beadA: MetaWorkflowBeadSummary = { beadId: "A", title: "A title", status: "open", workspaceId: "workspace-a", accessible: true };
const beadB: MetaWorkflowBeadSummary = { beadId: "B", title: "B title", status: "open", workspaceId: null, accessible: true };
const run: MetaWorkflowRunModel = {
  metaRunId: "meta-1",
  parentWorkspaceId: "workspace-a",
  laneId: null,
  status: "running",
  currentIndex: 1,
  childWorkflowDesignId: "design-child",
  childWorkflowDesignVersion: 2,
  title: "Meta run",
  summary: null,
  currentItem: null,
  progress: { total: 2, completed: 1, pending: 0, running: 1, blocked: 0 },
  nextAction: "Waiting for B to complete before starting the next bead.",
  blockedReason: null,
  createdAt: 1,
  updatedAt: 2,
  items: [
    { itemId: "i-1", beadId: "A", title: "A title", beadStatus: "open", index: 0, status: "completed", childRunId: "child-a", noteRef: "note-a", result: { summary: "A completed" }, error: null, startedAt: 1, completedAt: 2 },
    { itemId: "i-2", beadId: "B", title: "B title", beadStatus: "open", index: 1, status: "running", childRunId: "child-b", noteRef: null, result: null, error: null, startedAt: 3, completedAt: null },
  ],
};

describe("WorkflowMetaRunsView", () => {
  it("TEST_CASE_M119C_1A/1B renders create, filters, ordering, workflow picker, and monitor states", () => {
    const props = {
      workspaceId: "workspace-a",
      workflows: [workflow],
      runs: [run],
      beads: [beadA, beadB],
      selected: [beadA, beadA],
      query: "",
      scope: "other_workspaces" as const,
      childWorkflowId: "design-child",
      unavailableReason: null,
      status: null,
      error: null,
      loading: false,
      duplicateIds: ["A"],
      canStart: false,
      setQuery: vi.fn(),
      setScope: vi.fn(),
      setChildWorkflowId: vi.fn(),
      addBead: vi.fn(),
      removeBead: vi.fn(),
      moveBead: vi.fn(),
      onSearch: vi.fn(),
      onStart: vi.fn(),
      onRefresh: vi.fn(),
      onPause: vi.fn(),
      onResume: vi.fn(),
    };
    const html = renderToStaticMarkup(React.createElement(WorkflowMetaRunsView, props));

    expect(html).toContain("Meta-workflows");
    expect(html).toContain("Current workspace parent beads");
    expect(html).toContain("Other workspaces");
    expect(html).toContain("This filter can include beads outside the default workspace scope");
    expect(html).toContain("Duplicate bead selected");
    expect(html).toContain("Child workflow");
    expect(html).toContain("Start sequential meta-workflow");
    expect(html).toContain("Monitor meta-workflows");
    expect(html).toContain("A completed");
    expect(html).toContain('/dashboard/workflows/child-b');
    expect(html).toContain("Pause");
    expect(html).toContain("Resume");
    expect(JSON.stringify(html)).not.toContain("bd ");
    expect(JSON.stringify(html)).not.toContain("webhook");
    expect(JSON.stringify(html)).not.toContain("/Users/");
  });
});
