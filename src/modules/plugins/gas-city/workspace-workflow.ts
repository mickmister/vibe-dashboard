export type GasCityWorkspaceWorkflowMode = "plain_vk" | "gc_worker" | "gc_worker_review";

export interface BuildGasCityWorkspaceWorkflowPlanArgs {
  workflowMode: GasCityWorkspaceWorkflowMode;
  workspaceName: string;
  taskPrompt: string;
  workerTemplate: string;
  workerAlias?: string;
  reviewerTemplate?: string;
  reviewerAlias?: string;
  workflowPreset?: string;
}

export interface GasCityWorkspaceWorkflowSessionPlan {
  template: string;
  alias?: string;
  title: string;
}

export interface GasCityWorkspaceWorkflowPlan {
  worker: GasCityWorkspaceWorkflowSessionPlan;
  reviewer?: Omit<GasCityWorkspaceWorkflowSessionPlan, "alias"> & {
    alias: string;
    kickoffPrompt: string;
    vkSessionName: string;
  };
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function createGasCitySessionAlias(prefix: string, seed: string): string {
  const slug = seed
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "")
    .replace(/-{2,}/g, "-") || "workspace";
  const normalizedPrefix = prefix
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "") || "session";
  return `${normalizedPrefix}-${slug}`.slice(0, 64).replace(/[^a-z0-9]+$/, "") || normalizedPrefix;
}

export function buildGasCityWorkspaceWorkflowPlan(
  args: BuildGasCityWorkspaceWorkflowPlanArgs,
): GasCityWorkspaceWorkflowPlan {
  const workspaceName = args.workspaceName.trim() || "Workspace";
  const workerTemplate = args.workerTemplate.trim();
  if (!workerTemplate) {
    throw new Error("Choose a worker role before starting a GC workflow.");
  }

  const workflowPreset = args.workflowPreset?.trim() || "worker-review";
  const workerTitle = `${
    args.workflowMode === "gc_worker_review" ? "Worker + review" : "Worker"
  } • ${workspaceName}${
    args.workflowMode === "gc_worker_review" ? ` • ${workflowPreset}` : ""
  }`;

  const plan: GasCityWorkspaceWorkflowPlan = {
    worker: {
      template: workerTemplate,
      alias: optionalTrimmed(args.workerAlias),
      title: workerTitle,
    },
  };

  if (args.workflowMode === "gc_worker_review") {
    const reviewerTemplate = args.reviewerTemplate?.trim() || "reviewer";
    const reviewerAlias =
      optionalTrimmed(args.reviewerAlias) ??
      createGasCitySessionAlias("review", workspaceName);
    const reviewerTitle = `Reviewer • ${workspaceName} • ${workflowPreset}`;
    plan.reviewer = {
      template: reviewerTemplate,
      alias: reviewerAlias,
      title: reviewerTitle,
      vkSessionName: reviewerTitle,
      kickoffPrompt: [
        "Review the worker lane for this VK workspace.",
        `Workflow preset: ${workflowPreset}`,
        plan.worker.alias ? `Worker GC alias: ${plan.worker.alias}` : `Worker role: ${workerTemplate}`,
        "",
        "Original task prompt:",
        args.taskPrompt.trim(),
      ].join("\n"),
    };
  }

  return plan;
}
