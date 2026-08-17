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
const beadA: MetaWorkflowBeadSummary = { beadId: "A", title: "A title bd show /Users/example/private webhook queue item", status: "open", workspaceId: "workspace-a", accessible: true };
const beadB: MetaWorkflowBeadSummary = { beadId: "B", title: "B title shell git status /Users/example/private", status: "open", workspaceId: null, accessible: true };
const hostileBead: MetaWorkflowBeadSummary = {
  beadId: "bd show hidden",
  title: "shell should not leak /Users/example/private webhook queue item",
  status: "git status secret",
  workspaceId: "workspace-a",
  accessible: true,
};
const run: MetaWorkflowRunModel = {
  metaRunId: "meta-1",
  parentWorkspaceId: "workspace-a",
  laneId: null,
  status: "running",
  currentIndex: 1,
  childWorkflowDesignId: "design-child",
  childWorkflowDesignVersion: 2,
  title: "Meta run bd show /Users/example/private",
  summary: null,
  currentItem: null,
  progress: { total: 2, completed: 1, pending: 0, running: 1, blocked: 0 },
  nextAction: "Waiting for B to complete; bd show /Users/example/private webhook queue item WorkflowStepState runReady",
  blockedReason: null,
  createdAt: 1,
  updatedAt: 2,
  items: [
    { itemId: "i-1", beadId: "A", title: "A title", beadStatus: "open", index: 0, status: "completed", childRunId: "child-a", noteRef: "note-a", result: { summary: "A completed via bd show /Users/example/private webhook queue item shell git status WorkflowStepState runReady" }, error: null, startedAt: 1, completedAt: 2 },
    { itemId: "i-2", beadId: "B", title: "B title", beadStatus: "open", index: 1, status: "running", childRunId: "child-b", noteRef: null, result: null, error: { code: "child_failed", message: "Blocked by bd show /Users/example/private webhook queue item shell git status WorkflowStepState runReady" }, startedAt: 3, completedAt: null },
  ],
};

const hostileRun: MetaWorkflowRunModel = {
  ...run,
  metaRunId: "meta-hostile",
  status: "blocked",
  title: "bd show meta /Users/example/private",
  nextAction: "shell command waiting on webhook queue item",
  blockedReason: { code: "blocked", message: "git status leaked WorkflowStepState runReady /Users/example/private" },
  items: [
    {
      itemId: "i-hostile",
      beadId: "bd show child",
      title: "shell title /Users/example/private",
      beadStatus: "git status secret",
      index: 0,
      status: "blocked",
      childRunId: "child-hostile",
      noteRef: null,
      result: { summary: "bd show result webhook queue item /Users/example/private" },
      error: { code: "err", message: "shell error git status WorkflowStepState runReady" },
      startedAt: 1,
      completedAt: null,
    },
  ],
};

describe("WorkflowMetaRunsView", () => {
  it("TEST_CASE_M119C_1A/1B renders create, filters, ordering, workflow picker, and monitor states", () => {
    const props = {
      workspaceId: "workspace-a",
      workflows: [workflow],
      runs: [run, hostileRun],
      beads: [beadA, beadB, hostileBead],
      selected: [beadA, beadA, hostileBead],
      query: "",
      scope: "other_workspaces" as const,
      childWorkflowId: "design-child",
      unavailableReason: "bd show unavailable /Users/example/private webhook queue item",
      status: "shell status git push /Users/example/private",
      error: "WorkflowStepState runReady bd show error",
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
    expect(html).toContain("A completed via workflow action");
    expect(html).toContain("[redacted-home]");
    expect(html).toContain("workflow update");
    expect(html).toContain("workflow item");
    expect(html).toContain("workflow step");
    expect(html).toContain("workflow wakeup");
    expect(html).toContain('/dashboard/workflows/child-b');
    expect(html).toContain("Pause");
    expect(html).toContain("Resume");
    expect(html).toContain("workflow action");
    expect(html).toContain("version control action");
    expect(html).toContain("[redacted-home]");
    const rendered = JSON.stringify(html);
    expect(rendered).not.toContain("bd show");
    expect(rendered).not.toContain("shell");
    expect(rendered).not.toContain("git status");
    expect(rendered).not.toContain("webhook");
    expect(rendered).not.toContain("queue item");
    expect(rendered).not.toContain("/Users/");
    expect(rendered).not.toContain("WorkflowStepState");
    expect(rendered).not.toContain("runReady");
  });
});
