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

const CURRENT_SPIKE_MILESTONES: WorkflowRoadmapMilestone[] = [
  milestone(
    "M90",
    "vibe-kanban-vscode-web-ehl",
    "Workflow design store and prompt/skill library",
    "complete",
    "Published design versions, mutable drafts, and prompt/skill assets are in place.",
    "passed",
    ["vibe-kanban-vscode-web-ehl"],
  ),
  milestone(
    "M91",
    "vibe-kanban-vscode-web-yha",
    "Workflow extension registry foundation",
    "complete",
    "Typed step/artifact provider registry was added for first-party workflow extensions.",
    "passed",
    ["vibe-kanban-vscode-web-yha"],
  ),
  milestone(
    "M92",
    "vibe-kanban-vscode-web-bif",
    "Generic persisted workflow runtime",
    "complete",
    "DB-backed workflow definitions run through the generic persisted runtime with retries, loops, and history.",
    "passed",
    ["vibe-kanban-vscode-web-bif"],
  ),
  milestone(
    "M93",
    "vibe-kanban-vscode-web-j68",
    "Workspace Workflows tab shell",
    "complete",
    "Workspace-scoped Workflows home shows workflows, runs, attention, and batches without debug transport terms.",
    "passed",
    ["vibe-kanban-vscode-web-j68"],
  ),
  milestone(
    "M94",
    "vibe-kanban-vscode-web-94n",
    "Workflow launch flow",
    "complete",
    "Run modal supports required inputs, additional instructions, and role/session binding.",
    "passed",
    ["vibe-kanban-vscode-web-94n"],
  ),
  milestone(
    "M95",
    "vibe-kanban-vscode-web-n9g",
    "Human form workflow step",
    "complete",
    "Beads-form human attention/resume path is owned by workflow runtime and covered by durability fixes.",
    "passed",
    ["vibe-kanban-vscode-web-n9g"],
  ),
  milestone(
    "M96",
    "vibe-kanban-vscode-web-2io",
    "React Flow graph editor foundation",
    "complete",
    "Workflow states and action transitions are editable through the graph editor foundation.",
    "passed",
    ["vibe-kanban-vscode-web-2io", "vibe-kanban-vscode-web-5fx9"],
  ),
  milestone(
    "M97",
    "vibe-kanban-vscode-web-cn2",
    "Dev / Review / Tester and form templates",
    "complete",
    "DRT and create-form-from-agent templates are available, duplicatable, editable, runnable, and tested through fixture E2E follow-ups.",
    "passed",
    [
      "vibe-kanban-vscode-web-cn2",
      "vibe-kanban-vscode-web-0gk",
      "vibe-kanban-vscode-web-lv2k",
    ],
  ),
  milestone(
    "M98",
    "vibe-kanban-vscode-web-dhv",
    "Blocking workflow-to-workflow calls",
    "complete",
    "Blocking child workflow calls persist parent/child refs and resume parent runs safely.",
    "passed",
    ["vibe-kanban-vscode-web-dhv"],
  ),
  milestone(
    "M99",
    "vibe-kanban-vscode-web-zji",
    "Batch queue and capacity",
    "complete",
    "Batch enqueueing, capacity limits, pending status, and item-level errors are visible and tested.",
    "passed",
    ["vibe-kanban-vscode-web-zji"],
  ),
  milestone(
    "M100",
    "vibe-kanban-vscode-web-lnac",
    "Storybook workflow visualization",
    "complete",
    "Storybook fixtures and visual QA walkthroughs cover workflow graph, home, and run presentation states.",
    "passed",
    [
      "vibe-kanban-vscode-web-lnac",
      "vibe-kanban-vscode-web-411l",
      "vibe-kanban-vscode-web-k76t",
    ],
  ),
  milestone(
    "M101",
    "vibe-kanban-vscode-web-4o0u",
    "Workflow UX completeness audit",
    "complete",
    "Centralized workflow UX plan and follow-up test plan were documented for post-M111 workflow surfaces.",
    "passed",
    ["vibe-kanban-vscode-web-4o0u"],
  ),
  milestone(
    "M102",
    "vibe-kanban-vscode-web-fo78",
    "Centralized workflow page shell",
    "complete",
    "Workflows tab renders the product dashboard shell while direct routes remain supported deep links.",
    "passed",
    ["vibe-kanban-vscode-web-fo78"],
  ),
  milestone(
    "M103",
    "vibe-kanban-vscode-web-w6qf",
    "Safe command-step design",
    "complete",
    "Command-step provider safety requirements and future TDD acceptance were documented only.",
    "passed",
    ["vibe-kanban-vscode-web-w6qf"],
  ),
  milestone(
    "M104",
    "vibe-kanban-vscode-web-cfss",
    "Sub-workspace lane design",
    "complete",
    "Lane lifecycle, isolation, capacity, dirty worktree, merge-back, and cleanup policies were planned.",
    "passed",
    ["vibe-kanban-vscode-web-cfss"],
  ),
  milestone(
    "M105",
    "vibe-kanban-vscode-web-tqhk",
    "Sub-workspace lane foundation",
    "complete",
    "Lane persistence, binding, write leases, stale recovery, and overview read models passed review/tester.",
    "passed",
    ["vibe-kanban-vscode-web-tqhk"],
  ),
  milestone(
    "SEBL",
    "vibe-kanban-vscode-web-sebl",
    "Executor/model preferences per workflow role",
    "review",
    "Role-level VK executor/model preference support is implemented and under focused review fixes.",
    "review",
    ["vibe-kanban-vscode-web-sebl"],
  ),
  {
    ...milestone(
      "CKOV",
      "vibe-kanban-vscode-web-ckov",
      "Workflow roadmap and multi-bead progress UI",
      "in_progress",
      "This slice adds the read-only roadmap/progress surface for the current workflow spike.",
      "implementation",
      ["vibe-kanban-vscode-web-ckov"],
    ),
    children: [
      child(
        "vibe-kanban-vscode-web-ckov-readmodel",
        "Typed roadmap read model",
        "in_progress",
        "Expose product-shaped milestone hierarchy, status counts, sub-beads, links, and next action.",
        "Finish CKOV implementation and send to review.",
      ),
      child(
        "vibe-kanban-vscode-web-ckov-stories",
        "Roadmap Storybook states",
        "remaining",
        "Add empty, mixed, blocked, completed, and dense roadmap stories.",
        "Capture review feedback after first implementation.",
      ),
    ],
  },
  milestone(
    "M117",
    "vibe-kanban-vscode-web-vhx5",
    "Safe workflow command-step provider",
    "remaining",
    "Future implementation of the designed command-step provider after safety review.",
    "not_started",
    ["vibe-kanban-vscode-web-vhx5"],
  ),
  milestone(
    "M118",
    "vibe-kanban-vscode-web-z1on",
    "Bead-driven meta-workflow pause/resume prototype",
    "remaining",
    "Future prototype for bead-driven sequential workflow execution using lane and roadmap foundations.",
    "not_started",
    ["vibe-kanban-vscode-web-z1on", "vibe-kanban-vscode-web-qwzp"],
  ),
];

export function buildWorkflowRoadmapModel(
  options: { now?: () => number } = {},
): WorkflowRoadmapModel {
  const milestones = deepClone(CURRENT_SPIKE_MILESTONES);
  return {
    spikeId: "vk/8b79-vd-workflows",
    title: "Workflow builder and automation spike",
    description:
      "Read-only progress view for workflow creation, running, monitoring, executor settings, and follow-up automation foundations.",
    generatedAt: options.now?.() ?? Date.now(),
    statusCounts: countStatuses(milestones),
    nextAction: nextAction(milestones),
    milestones,
    stale: false,
    source: {
      label: "Checked-in workflow roadmap",
      description:
        "Typed milestone data curated from test-plan-10 and review/tester-approved bead history. No command execution or bead mutations are used.",
    },
  };
}

export function emptyWorkflowRoadmapModel(
  now = Date.now(),
): WorkflowRoadmapModel {
  return {
    spikeId: "",
    title: "Workflow roadmap",
    description: "No workflow spike is selected.",
    generatedAt: now,
    statusCounts: emptyCounts(),
    nextAction: "Choose a workflow spike to view milestone progress.",
    milestones: [],
    stale: false,
    source: {
      label: "No roadmap selected",
      description: "There is no roadmap data to show yet.",
    },
  };
}

function milestone(
  milestoneId: string,
  beadId: string,
  title: string,
  status: WorkflowRoadmapItemStatus,
  summary: string,
  reviewState: WorkflowRoadmapMilestone["reviewState"],
  childBeadIds: string[],
): WorkflowRoadmapMilestone {
  return {
    beadId,
    milestone: milestoneId,
    title,
    status,
    priority: "P2",
    summary,
    reviewState,
    nextAction: status === "complete" ? null : defaultNextAction(status),
    dependencies: [],
    links: [{ label: "Open bead", href: beadUrl(beadId), kind: "bead" }],
    children: childBeadIds.map((childBeadId) =>
      child(
        childBeadId,
        title,
        status,
        summary,
        status === "complete" ? null : defaultNextAction(status),
      ),
    ),
  };
}

function child(
  beadId: string,
  title: string,
  status: WorkflowRoadmapItemStatus,
  summary: string,
  nextAction: string | null,
): WorkflowRoadmapSubBead {
  return {
    beadId,
    title,
    status,
    summary,
    nextAction,
    links: [{ label: "Open bead", href: beadUrl(beadId), kind: "bead" }],
  };
}

function beadUrl(beadId: string): string {
  return `/beads/project?bead=${encodeURIComponent(beadId)}`;
}

function countStatuses(
  milestones: WorkflowRoadmapMilestone[],
): WorkflowRoadmapModel["statusCounts"] {
  const counts = emptyCounts();
  for (const item of milestones) counts[item.status] += 1;
  return counts;
}

function emptyCounts(): WorkflowRoadmapModel["statusCounts"] {
  return {
    complete: 0,
    in_progress: 0,
    blocked: 0,
    review: 0,
    tester: 0,
    remaining: 0,
  };
}

function nextAction(milestones: WorkflowRoadmapMilestone[]): string | null {
  return milestones.find((item) => item.nextAction)?.nextAction ?? null;
}

function defaultNextAction(status: WorkflowRoadmapItemStatus): string {
  if (status === "blocked")
    return "Resolve the blocking issue before continuing.";
  if (status === "review")
    return "Address review feedback or wait for approval.";
  if (status === "tester") return "Wait for tester validation artifacts.";
  if (status === "in_progress")
    return "Finish implementation and send to review.";
  return "Pick up this milestone when its dependencies are ready.";
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
