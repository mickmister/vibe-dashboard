import type { WorkspaceWorkflowsHomeModel } from "./workflowsHomeApi";

export interface MetaWorkflowBeadSummary {
  beadId: string;
  title: string;
  status: string;
  workspaceId?: string | null;
  accessible: boolean;
  labels?: string[];
  url?: string | null;
}

export interface MetaWorkflowItemSummary {
  itemId: string;
  beadId: string;
  title: string;
  beadStatus: string;
  index: number;
  status: string;
  childRunId: string | null;
  noteRef: string | null;
  result: Record<string, unknown> | null;
  error: { code: string; message: string; path?: string } | null;
  startedAt: number | null;
  completedAt: number | null;
}

export interface MetaWorkflowRunModel {
  metaRunId: string;
  parentWorkspaceId: string;
  laneId: string | null;
  status: string;
  currentIndex: number;
  childWorkflowDesignId: string | null;
  childWorkflowDesignVersion: number | null;
  title: string;
  summary: string | null;
  currentItem: MetaWorkflowItemSummary | null;
  items: MetaWorkflowItemSummary[];
  progress: { total: number; completed: number; pending: number; running: number; blocked: number };
  nextAction: string;
  blockedReason: { code: string; message: string; path?: string } | null;
  createdAt: number;
  updatedAt: number;
}

export async function searchMetaWorkflowBeads(input: {
  workspaceId: string;
  query?: string;
  scope: "current_workspace" | "no_workspace" | "other_workspaces";
}): Promise<{ beads: MetaWorkflowBeadSummary[]; unavailableReason: string | null }> {
  const params = new URLSearchParams({ workspaceId: input.workspaceId, scope: input.scope });
  if (input.query?.trim()) params.set("q", input.query.trim());
  const response = await fetch(`/dashboard/api/workflows/meta-beads?${params.toString()}`, { headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({})) as { beads?: MetaWorkflowBeadSummary[]; unavailableReason?: string | null; message?: string; error?: string };
  if (response.ok) return { beads: payload.beads ?? [], unavailableReason: payload.unavailableReason ?? null };
  throw new Error(payload.message || payload.error || `Failed to search beads: ${response.status}`);
}

export async function fetchMetaWorkflowRuns(workspaceId: string): Promise<MetaWorkflowRunModel[]> {
  const params = new URLSearchParams({ workspaceId });
  const response = await fetch(`/dashboard/api/workflows/meta-runs?${params.toString()}`, { headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({})) as { metaRuns?: MetaWorkflowRunModel[]; message?: string; error?: string };
  if (response.ok) return payload.metaRuns ?? [];
  throw new Error(payload.message || payload.error || `Failed to load meta-workflows: ${response.status}`);
}

export async function createMetaWorkflowRun(input: {
  workspaceId: string;
  beadIds: string[];
  childWorkflow: { designId: string; version: number | null };
  roleBindings: Record<string, { mode: "create_or_reuse"; name: string }>;
}): Promise<{ metaRun: MetaWorkflowRunModel; home?: WorkspaceWorkflowsHomeModel }> {
  const response = await fetch("/dashboard/api/workflows/meta-runs", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as { metaRun?: MetaWorkflowRunModel; message?: string; error?: string; issues?: Array<{ message: string }> };
  if (response.ok && payload.metaRun) return { metaRun: payload.metaRun };
  const issueText = payload.issues?.map((issue) => issue.message).join(" ");
  throw new Error(issueText || payload.message || payload.error || `Failed to start meta-workflow: ${response.status}`);
}

export async function pauseMetaWorkflowRun(metaRunId: string): Promise<MetaWorkflowRunModel> {
  const response = await fetch(`/dashboard/api/workflows/meta-runs/${encodeURIComponent(metaRunId)}/pause`, { method: "POST", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({})) as { metaRun?: MetaWorkflowRunModel; message?: string; error?: string };
  if (response.ok && payload.metaRun) return payload.metaRun;
  throw new Error(payload.message || payload.error || `Failed to pause meta-workflow: ${response.status}`);
}

export async function resumeMetaWorkflowRun(metaRunId: string): Promise<MetaWorkflowRunModel> {
  const response = await fetch(`/dashboard/api/workflows/meta-runs/${encodeURIComponent(metaRunId)}/resume`, { method: "POST", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({})) as { metaRun?: MetaWorkflowRunModel; message?: string; error?: string };
  if (response.ok && payload.metaRun) return payload.metaRun;
  throw new Error(payload.message || payload.error || `Failed to resume meta-workflow: ${response.status}`);
}
