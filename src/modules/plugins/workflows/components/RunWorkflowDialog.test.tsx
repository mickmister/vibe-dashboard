// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchWorkflowLaunchOptions: vi.fn(),
  planWorkspaceWorkflow: vi.fn(),
  launchPlannedWorkspaceWorkflow: vi.fn(),
}));

vi.mock("../client/workflowsHomeApi", async (original) => ({
  ...(await original<typeof import("../client/workflowsHomeApi")>()),
  ...api,
}));

vi.mock("../client/metaWorkflowApi", () => ({
  searchMetaWorkflowBeads: vi.fn(),
  fetchMetaWorkflowRuns: vi.fn(),
}));

import { WorkflowPlanReauthorizationRequiredError } from "../client/workflowsHomeApi";
import { RunWorkflowDialog } from "./WorkspaceWorkflowsPage";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RunWorkflowDialog authorization renewal", () => {
  it("renders the reissued plan and requires a second explicit confirmation", async () => {
    const workflow = {
      id: "workflow-a",
      title: "Review work",
      description: "",
      version: 1,
      status: "published",
      inputs: [],
      roles: [],
    } as any;
    api.fetchWorkflowLaunchOptions.mockResolvedValue({ workflow, sessions: [], executorOptions: [] });
    api.planWorkspaceWorkflow
      .mockResolvedValueOnce({ digest: "old-digest", summary: "Original plan" })
      .mockResolvedValueOnce({ digest: "new-digest", summary: "Reissued plan" });
    api.launchPlannedWorkspaceWorkflow
      .mockRejectedValueOnce(new WorkflowPlanReauthorizationRequiredError("A new plan is required."))
      .mockResolvedValueOnce({ result: { status: "launched", run: { instanceId: "run-a", status: "running" } } });

    render(<RunWorkflowDialog workspaceId="workspace-a" workflow={workflow} lanes={null} onClose={() => {}} onLaunched={() => {}} />);
    const action = await screen.findByRole("button", { name: "Review plan" });
    fireEvent.click(action);
    expect(await screen.findByText("Original plan")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and start" }));

    expect(await screen.findByText("Reissued plan")).toBeTruthy();
    expect(screen.queryByText("Original plan")).toBeNull();
    expect(screen.getByText(/Review the reissued plan and confirm it again/)).toBeTruthy();
    expect(api.launchPlannedWorkspaceWorkflow).toHaveBeenCalledTimes(1);
    expect(api.launchPlannedWorkspaceWorkflow).toHaveBeenLastCalledWith(expect.anything(), "old-digest");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.launchPlannedWorkspaceWorkflow).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Confirm and start" }));
    await waitFor(() => expect(api.launchPlannedWorkspaceWorkflow).toHaveBeenCalledTimes(2));
    expect(api.launchPlannedWorkspaceWorkflow).toHaveBeenLastCalledWith(expect.anything(), "new-digest");
    expect(api.planWorkspaceWorkflow).toHaveBeenCalledTimes(2);
  });
});
