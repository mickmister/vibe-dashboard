export type WorkflowRoadmapItemStatus =
  "complete" | "in_progress" | "blocked" | "review" | "tester" | "remaining";

export interface WorkflowRoadmapLink {
  label: string;
  href: string;
  kind: "bead" | "workflow_run" | "doc";
}

export interface WorkflowRoadmapSubBead {
  beadId: string;
  title: string;
  status: WorkflowRoadmapItemStatus;
  summary: string;
  nextAction: string | null;
  links: WorkflowRoadmapLink[];
}

export interface WorkflowRoadmapMilestone {
  beadId: string;
  milestone: string;
  title: string;
  status: WorkflowRoadmapItemStatus;
  priority: "P0" | "P1" | "P2" | "P3" | "P4";
  summary: string;
  reviewState:
    | "not_started"
    | "implementation"
    | "review"
    | "tester"
    | "passed"
    | "blocked";
  nextAction: string | null;
  dependencies: string[];
  links: WorkflowRoadmapLink[];
  children: WorkflowRoadmapSubBead[];
}

export interface WorkflowRoadmapModel {
  spikeId: string;
  title: string;
  description: string;
  generatedAt: number;
  statusCounts: Record<WorkflowRoadmapItemStatus, number>;
  nextAction: string | null;
  milestones: WorkflowRoadmapMilestone[];
  stale: boolean;
  source: {
    label: string;
    description: string;
    providerId?: string;
    freshness: "live" | "partial" | "stale" | "error" | "static";
    updatedAt: number | null;
    statusCountScope: "top_level_milestones";
    warnings: string[];
  };
}

export async function fetchWorkflowRoadmap(query?: URLSearchParams): Promise<WorkflowRoadmapModel> {
  const params = new URLSearchParams();
  const workspaceId = query?.get("workspaceId") || query?.get("workspace") || "";
  if (workspaceId) params.set("workspaceId", workspaceId);
  const url = params.toString() ? `/dashboard/api/workflows/roadmap?${params.toString()}` : "/dashboard/api/workflows/roadmap";
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    roadmap?: WorkflowRoadmapModel;
    error?: string;
    message?: string;
  };
  if (response.ok && payload.roadmap) return payload.roadmap;
  throw new Error(
    payload.message ||
      payload.error ||
      `Failed to load workflow roadmap: ${response.status}`,
  );
}
