import type { Meta, StoryObj } from "@storybook/react-vite";
import React from "react";
import { WorkflowMetaRunsView } from "../components/WorkflowMetaRunsPage";
import type { WorkspaceWorkflowSummary } from "../client/workflowsHomeApi";
import type { MetaWorkflowBeadSummary, MetaWorkflowRunModel } from "../client/metaWorkflowApi";
import { WorkflowStoryFrame } from "./WorkflowStoryFrame";

const meta: Meta<typeof WorkflowMetaRunsView> = {
  title: "Workflows/Meta Workflows",
  component: WorkflowMetaRunsView,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <WorkflowStoryFrame title="Meta-workflow browser UX" description="Sequential bead selection and monitoring states."><Story /></WorkflowStoryFrame>],
};
export default meta;
type Story = StoryObj<typeof meta>;

const workflow: WorkspaceWorkflowSummary = { id: "design-child", title: "Dev / Review child", description: "Runs one bead", source: "published_design", status: "ready", version: 4, unavailableReason: null, canRun: true, inputs: [], roles: [{ id: "dev", label: "Dev", description: null }] };
const beads: MetaWorkflowBeadSummary[] = [
  { beadId: "vibe-kanban-vscode-web-qwzp", title: "M119A meta-run API", status: "closed", workspaceId: "workspace-a", accessible: true, labels: ["workflow"] },
  { beadId: "vibe-kanban-vscode-web-vfjz", title: "M119B live roadmap", status: "review", workspaceId: "workspace-a", accessible: true, labels: ["workflow"] },
  { beadId: "external-bead", title: "Other workspace candidate", status: "open", workspaceId: "workspace-b", accessible: true, labels: [] },
];
const runningRun: MetaWorkflowRunModel = { metaRunId: "meta-story", parentWorkspaceId: "workspace-a", laneId: null, status: "running", currentIndex: 1, childWorkflowDesignId: "design-child", childWorkflowDesignVersion: 4, title: "M119 follow-ups", summary: null, currentItem: null, progress: { total: 3, completed: 1, running: 1, pending: 1, blocked: 0 }, nextAction: "Waiting for M119B to complete before starting the next bead.", blockedReason: null, createdAt: 1, updatedAt: 2, items: [
  { itemId: "i1", beadId: "vibe-kanban-vscode-web-qwzp", title: "M119A meta-run API", beadStatus: "closed", index: 0, status: "completed", childRunId: "child-qwzp", noteRef: "note-qwzp", result: { summary: "API integration passed review." }, error: null, startedAt: 1, completedAt: 2 },
  { itemId: "i2", beadId: "vibe-kanban-vscode-web-vfjz", title: "M119B live roadmap", beadStatus: "review", index: 1, status: "running", childRunId: "child-vfjz", noteRef: null, result: null, error: null, startedAt: 3, completedAt: null },
  { itemId: "i3", beadId: "vibe-kanban-vscode-web-bz38", title: "M119C browser UX", beadStatus: "open", index: 2, status: "pending", childRunId: null, noteRef: null, result: null, error: null, startedAt: null, completedAt: null },
] };
const baseArgs = { workspaceId: "workspace-a", workflows: [workflow], beads, query: "", childWorkflowId: "design-child", unavailableReason: null, status: null, error: null, loading: false, duplicateIds: [], canStart: true, setQuery: () => undefined, setScope: () => undefined, setChildWorkflowId: () => undefined, addBead: () => undefined, removeBead: () => undefined, moveBead: () => undefined, onSearch: () => undefined, onStart: () => undefined, onRefresh: () => undefined, onPause: () => undefined, onResume: () => undefined, embedded: true };

export const CreateWithCurrentWorkspaceBeads: Story = { args: { ...baseArgs, selected: beads.slice(0, 2), runs: [], scope: "current_workspace" } };
export const IncludeOtherWorkspaceWarning: Story = { args: { ...baseArgs, selected: [beads[2]!], runs: [], scope: "other_workspaces" } };
export const ActiveRun: Story = { args: { ...baseArgs, selected: [], runs: [runningRun], scope: "current_workspace" } };
export const PausedRun: Story = { args: { ...baseArgs, selected: [], scope: "current_workspace", runs: [{ ...runningRun, status: "paused", nextAction: "Resume when ready to start the next bead.", progress: { total: 3, completed: 1, running: 0, pending: 2, blocked: 0 }, items: runningRun.items.map((item, index) => index === 1 ? { ...item, status: "pending", childRunId: null } : item) }] } };
export const BlockedRun: Story = { args: { ...baseArgs, selected: [], scope: "current_workspace", runs: [{ ...runningRun, status: "blocked", blockedReason: { code: "child_workflow_blocked", message: "Reviewer requested a safer test path." }, nextAction: "Reviewer requested a safer test path.", progress: { total: 3, completed: 1, running: 0, pending: 1, blocked: 1 }, items: runningRun.items.map((item, index) => index === 1 ? { ...item, status: "blocked", error: { code: "child_workflow_blocked", message: "Reviewer requested a safer test path." } } : item) }] } };
export const CompletedRun: Story = { args: { ...baseArgs, selected: [], scope: "current_workspace", runs: [{ ...runningRun, status: "completed", nextAction: "All selected beads completed.", progress: { total: 3, completed: 3, running: 0, pending: 0, blocked: 0 }, items: runningRun.items.map((item) => ({ ...item, status: "completed", result: item.result ?? { summary: `${item.title} complete.` } })) }] } };
export const ProviderUnavailable: Story = { args: { ...baseArgs, selected: [], scope: "current_workspace", runs: [], beads: [], unavailableReason: "Bead search provider is not configured." } };

export const ConfirmationBeforeStart: Story = { args: { ...baseArgs, selected: beads.slice(0, 2), runs: [], scope: "current_workspace", confirming: true } };
export const DuplicateAndUnsupportedSelection: Story = { args: { ...baseArgs, selected: [beads[0]!, beads[0]!, { beadId: "archived-bead", title: "Archived bead", status: "archived", workspaceId: "workspace-a", accessible: true, labels: [] }], runs: [], scope: "current_workspace", duplicateIds: [beads[0]!.beadId], invalidSelected: [{ beadId: "archived-bead", title: "Archived bead", status: "archived", workspaceId: "workspace-a", accessible: true, labels: [] }], canStart: false } };
export const LoadingMetaWorkflows: Story = { args: { ...baseArgs, selected: [], runs: [], beads: [], scope: "current_workspace", loading: true } };
export const ProductError: Story = { args: { ...baseArgs, selected: [], runs: [], beads: [], scope: "current_workspace", error: "Meta-workflow progress is temporarily unavailable." } };
