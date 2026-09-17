import type { Meta, StoryObj } from "@storybook/react-vite";
import React from "react";
import { WorkflowRoadmapView } from "../components/WorkflowRoadmapPage";
import {
  buildWorkflowRoadmapModel,
  emptyWorkflowRoadmapModel,
  type WorkflowRoadmapModel,
} from "../server/workflowRoadmapReadModel";
import { WorkflowStoryFrame } from "./WorkflowStoryFrame";

const meta: Meta<typeof WorkflowRoadmapView> = {
  title: "Workflows/Roadmap",
  component: WorkflowRoadmapView,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <WorkflowStoryFrame
        title="Workflow roadmap progress"
        description="Read-only milestone progress surface for workflow spike coordination."
      >
        <Story />
      </WorkflowStoryFrame>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const ActiveMixedRoadmap: Story = {
  args: {
    roadmap: buildWorkflowRoadmapModel({ now: () => 1_700_000 }),
    loading: false,
    error: null,
    onRefresh: () => undefined,
    embedded: true,
  },
};

export const LiveMixedProvider: Story = {
  args: {
    roadmap: liveMixedRoadmap(),
    loading: false,
    error: null,
    onRefresh: () => undefined,
    embedded: true,
  },
};

export const StaleLiveProvider: Story = {
  args: {
    roadmap: staleLiveRoadmap(),
    loading: false,
    error: null,
    onRefresh: () => undefined,
    embedded: true,
  },
};

export const ProviderUnavailableNoStaticFallback: Story = {
  args: {
    roadmap: providerUnavailableRoadmap(),
    loading: false,
    error: null,
    onRefresh: () => undefined,
    embedded: true,
  },
};


export const FilteredBlockedOnly: Story = {
  args: {
    roadmap: blockedTesterRoadmap(),
    loading: false,
    error: null,
    onRefresh: () => undefined,
    filters: { status: "blocked", showCompleted: false },
    filterHref: (next: Record<string, string | null>) => `?${new URLSearchParams(Object.entries(next).filter((entry): entry is [string, string] => entry[1] != null))}`,
    embedded: true,
  },
};

export const CompletedHiddenByDefault: Story = {
  args: {
    roadmap: completedRoadmap(),
    loading: false,
    error: null,
    onRefresh: () => undefined,
    filters: { status: "all", showCompleted: false },
    embedded: true,
  },
};

export const WorkspaceScopedQueueEnabled: Story = {
  args: {
    roadmap: liveMixedRoadmap(),
    loading: false,
    error: null,
    onRefresh: () => undefined,
    workspaceId: "workspace-storybook",
    queueHref: (beadIds: string[]) => `/dashboard/workflows/meta-runs?workspaceId=workspace-storybook&roadmapBeads=${beadIds.join(",")}`,
    embedded: true,
  },
};

export const EmptyRoadmap: Story = {
  args: {
    roadmap: emptyWorkflowRoadmapModel(1_700_000),
    loading: false,
    error: null,
    onRefresh: () => undefined,
    embedded: true,
  },
};

export const BlockedTesterFailure: Story = {
  args: {
    roadmap: blockedTesterRoadmap(),
    loading: false,
    error: null,
    onRefresh: () => undefined,
    embedded: true,
  },
};

export const CompletedSpike: Story = {
  args: {
    roadmap: completedRoadmap(),
    loading: false,
    error: null,
    onRefresh: () => undefined,
    embedded: true,
  },
};

export const DenseHierarchy: Story = {
  args: {
    roadmap: denseRoadmap(),
    loading: false,
    error: null,
    onRefresh: () => undefined,
    embedded: true,
  },
};

export const ProductError: Story = {
  args: {
    roadmap: null,
    loading: false,
    error: "Roadmap progress is temporarily unavailable.",
    onRefresh: () => undefined,
    embedded: true,
  },
};

function liveMixedRoadmap(): WorkflowRoadmapModel {
  const roadmap = buildWorkflowRoadmapModel({ now: () => 1_700_000 });
  roadmap.source = {
    label: "Live typed bead provider",
    description: "Read-only live bead and meta-run progress. No bead mutation or command execution.",
    providerId: "storybook-live-beads",
    freshness: "live",
    updatedAt: 1_699_990,
    statusCountScope: "top_level_milestones",
    warnings: [],
  };
  roadmap.stale = false;
  const ckov = roadmap.milestones.find((item) => item.milestone === "CKOV");
  if (ckov) {
    ckov.status = "complete";
    ckov.reviewState = "passed";
    ckov.summary = "Live bead status shows CKOV completed after review and tester pass.";
    ckov.nextAction = null;
    ckov.links.push({ label: "Child workflow completed", href: "/dashboard/workflows/child-storybook-live", kind: "workflow_run" });
  }
  const sebl = roadmap.milestones.find((item) => item.milestone === "SEBL");
  if (sebl) {
    sebl.status = "blocked";
    sebl.reviewState = "blocked";
    sebl.summary = "Live provider reports one blocker needing a focused fix.";
    sebl.nextAction = "Fix the live blocker and refresh provider status.";
  }
  roadmap.statusCounts = recount(roadmap);
  roadmap.nextAction = "Fix the live blocker and refresh provider status.";
  return roadmap;
}

function staleLiveRoadmap(): WorkflowRoadmapModel {
  const roadmap = liveMixedRoadmap();
  roadmap.stale = true;
  roadmap.source = {
    ...roadmap.source,
    freshness: "stale",
    updatedAt: 1_650_000,
    warnings: ["Live provider data is older than the freshness window; refresh before making coordination decisions."],
  };
  return roadmap;
}

function providerUnavailableRoadmap(): WorkflowRoadmapModel {
  const roadmap = emptyWorkflowRoadmapModel(1_700_000);
  roadmap.stale = true;
  roadmap.source = {
    label: "Live typed bead provider unavailable",
    description: "Product routes show an unavailable state instead of static/demo milestone fallback data.",
    providerId: "storybook-live-beads",
    freshness: "error",
    updatedAt: null,
    statusCountScope: "top_level_milestones",
    warnings: ["Provider timed out while reading bead status."],
  };
  roadmap.nextAction = "Live roadmap progress is temporarily unavailable. Refresh after the provider recovers.";
  return roadmap;
}

function blockedTesterRoadmap(): WorkflowRoadmapModel {
  const roadmap = buildWorkflowRoadmapModel({ now: () => 1_700_000 });
  const target = roadmap.milestones.find((item) => item.milestone === "CKOV");
  if (target) {
    target.status = "blocked";
    target.reviewState = "blocked";
    target.summary =
      "Tester found that milestone progress did not roll up from a child bead.";
    target.nextAction = "Fix the rollup and rerun tester validation.";
    target.children[0] = {
      ...target.children[0]!,
      status: "complete",
      nextAction: null,
    };
    target.children[1] = {
      ...target.children[1]!,
      status: "blocked",
      summary: "Storybook visual coverage missed the blocked tester state.",
      nextAction: "Add the missing story and send back to review.",
    };
  }
  roadmap.statusCounts = recount(roadmap);
  roadmap.nextAction = "Fix the rollup and rerun tester validation.";
  return roadmap;
}

function completedRoadmap(): WorkflowRoadmapModel {
  const roadmap = buildWorkflowRoadmapModel({ now: () => 1_700_000 });
  roadmap.milestones = roadmap.milestones.map((item) => ({
    ...item,
    status: "complete",
    reviewState: "passed",
    nextAction: null,
    children: item.children.map((child) => ({
      ...child,
      status: "complete",
      nextAction: null,
    })),
  }));
  roadmap.statusCounts = recount(roadmap);
  roadmap.nextAction = null;
  roadmap.description =
    "All workflow builder spike milestones have passed review and tester validation.";
  return roadmap;
}

function denseRoadmap(): WorkflowRoadmapModel {
  const roadmap = buildWorkflowRoadmapModel({ now: () => 1_700_000 });
  for (const item of roadmap.milestones.slice(0, 5)) {
    item.children = [
      ...item.children,
      {
        beadId: `${item.beadId}-review`,
        title: `${item.title} review follow-up`,
        status: "complete",
        summary: "Review feedback was addressed in a focused fix.",
        nextAction: null,
        links: [
          {
            label: "Open bead",
            href: `/dashboard/workflows/roadmap?storyBead=${encodeURIComponent(`${item.beadId}-review`)}`,
            kind: "bead",
          },
        ],
      },
      {
        beadId: `${item.beadId}-tester`,
        title: `${item.title} tester pass`,
        status: "complete",
        summary: "Independent tester artifacts were recorded.",
        nextAction: null,
        links: [
          {
            label: "Open bead",
            href: `/dashboard/workflows/roadmap?storyBead=${encodeURIComponent(`${item.beadId}-tester`)}`,
            kind: "bead",
          },
        ],
      },
    ];
  }
  roadmap.statusCounts = recount(roadmap);
  return roadmap;
}

function recount(roadmap: WorkflowRoadmapModel): WorkflowRoadmapModel["statusCounts"] {
  return roadmap.milestones.reduce(
    (counts, item) => {
      counts[item.status] += 1;
      return counts;
    },
    {
      complete: 0,
      in_progress: 0,
      blocked: 0,
      review: 0,
      tester: 0,
      remaining: 0,
    },
  );
}
