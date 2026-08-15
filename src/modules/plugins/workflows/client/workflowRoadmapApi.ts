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
  };
}

export async function fetchWorkflowRoadmap(): Promise<WorkflowRoadmapModel> {
  const response = await fetch("/dashboard/api/workflows/roadmap", {
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
