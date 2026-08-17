import { describe, expect, it } from "vitest";
import {
  buildLiveWorkflowRoadmapModel,
  buildWorkflowRoadmapModel,
  emptyWorkflowRoadmapModel,
} from "./workflowRoadmapReadModel";

describe("workflowRoadmapReadModel", () => {
  it("TEST_CASE_CKOV_1A returns ordered milestones with expandable sub-bead hierarchy", () => {
    const roadmap = buildWorkflowRoadmapModel({ now: () => 1_700_000 });

    expect(roadmap).toMatchObject({
      spikeId: "vk/8b79-vd-workflows",
      title: "Workflow builder and automation spike",
      stale: false,
    });
    expect(roadmap.milestones.map((item) => item.milestone).slice(0, 5)).toEqual(
      ["M90", "M91", "M92", "M93", "M94"],
    );
    expect(roadmap.milestones.some((item) => item.children.length > 1)).toBe(
      true,
    );
    expect(roadmap.milestones.every((item) => item.children.length > 0)).toBe(
      true,
    );
    expect(roadmap.statusCounts.complete).toBeGreaterThan(10);
    expect(roadmap.statusCounts.in_progress).toBe(1);
    expect(roadmap.statusCounts.review).toBe(1);
    expect(roadmap.statusCounts.remaining).toBeGreaterThanOrEqual(2);
    expect(roadmap.nextAction).toBe(
      "Address review feedback or wait for approval.",
    );
  });

  it("TEST_CASE_CKOV_1B surfaces review, tester, blocked, and next-action states", () => {
    const roadmap = buildWorkflowRoadmapModel();

    expect(roadmap.milestones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          milestone: "SEBL",
          status: "review",
          reviewState: "review",
          nextAction: "Address review feedback or wait for approval.",
        }),
        expect.objectContaining({
          milestone: "CKOV",
          status: "in_progress",
          reviewState: "implementation",
          children: expect.arrayContaining([
            expect.objectContaining({ status: "remaining" }),
          ]),
        }),
      ]),
    );
  });

  it("TEST_CASE_CKOV_1C produces product-safe links and keeps raw identifiers secondary", () => {
    const roadmap = buildWorkflowRoadmapModel();
    const allLinks = roadmap.milestones.flatMap((item) => [
      ...item.links,
      ...item.children.flatMap((child) => child.links),
    ]);

    expect(allLinks.length).toBeGreaterThan(0);
    expect(allLinks.every((link) => link.href.startsWith("/beads/project?bead="))).toBe(
      true,
    );
    expect(JSON.stringify(roadmap)).not.toContain("bd ");
    expect(JSON.stringify(roadmap)).not.toContain("sqlite");
    expect(JSON.stringify(roadmap)).not.toContain("shell command");
  });

  it("TEST_CASE_M119B_1A/1C overlays live bead status and meta-run links product-safely", async () => {
    const roadmap = await buildLiveWorkflowRoadmapModel({
      now: () => 1_800_000,
      workspaceId: "workspace-a",
      provider: {
        providerId: "typed-bead-provider",
        label: "Live beads",
        description: "Typed bead store provider.",
        async readBeads(beadIds) {
          expect(beadIds).toContain("vibe-kanban-vscode-web-ckov");
          return {
            updatedAt: 1_799_999,
            beads: [
              {
                beadId: "vibe-kanban-vscode-web-ckov",
                title: "Live roadmap provider",
                status: "closed",
                summary: "Validated live provider status wins over static in-progress state.",
                workspaceId: "workspace-a",
                url: "/beads/project?bead=vibe-kanban-vscode-web-ckov",
              },
              {
                beadId: "vibe-kanban-vscode-web-sebl",
                status: "blocked",
                summary: "Live blocker should override static review state.",
                workspaceId: "workspace-a",
                url: "file:///Users/example/private",
              },
            ],
          };
        },
        async listMetaRuns() {
          return [
            {
              metaRunId: "meta-live",
              status: "running",
              updatedAt: 1_799_998,
              items: [{ beadId: "vibe-kanban-vscode-web-ckov", status: "running", childRunId: "child-live" }],
            },
          ];
        },
      },
    });

    expect(roadmap.source).toMatchObject({ providerId: "typed-bead-provider", freshness: "partial", updatedAt: 1_799_999, statusCountScope: "top_level_milestones" });
    expect(roadmap.statusCounts.complete).toBeGreaterThan(10);
    expect(roadmap.milestones).toEqual(expect.arrayContaining([
      expect.objectContaining({
        beadId: "vibe-kanban-vscode-web-ckov",
        title: "Live roadmap provider",
        status: "complete",
        reviewState: "passed",
        links: expect.arrayContaining([expect.objectContaining({ href: "/dashboard/workflows/meta-runs/meta-live", kind: "workflow_run" })]),
      }),
      expect.objectContaining({
        beadId: "vibe-kanban-vscode-web-sebl",
        status: "blocked",
        reviewState: "blocked",
        links: [],
      }),
    ]));
    const serialized = JSON.stringify(roadmap);
    expect(serialized).not.toContain("file://");
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("queue item");
  });

  it("TEST_CASE_M119B_1B/1D returns safe static fallback when live provider fails", async () => {
    const roadmap = await buildLiveWorkflowRoadmapModel({
      now: () => 2_000_000,
      provider: {
        providerId: "failing-provider",
        label: "Failing live beads",
        async readBeads() {
          throw new Error("bd show failed at /Users/example/private");
        },
      },
    });

    expect(roadmap).toMatchObject({
      stale: true,
      source: {
        providerId: "failing-provider",
        freshness: "error",
        warnings: ["workflow action"],
      },
      nextAction: "Live roadmap progress is temporarily unavailable. Refresh after the provider recovers.",
    });
    expect(roadmap.milestones.length).toBeGreaterThan(0);
    expect(JSON.stringify(roadmap)).not.toContain("bd show");
    expect(JSON.stringify(roadmap)).not.toContain("/Users/");
  });

  it("TEST_CASE_CKOV_1E returns a safe empty roadmap", () => {
    const roadmap = emptyWorkflowRoadmapModel(42);

    expect(roadmap).toMatchObject({
      spikeId: "",
      generatedAt: 42,
      nextAction: "Choose a workflow spike to view milestone progress.",
      milestones: [],
      statusCounts: {
        complete: 0,
        in_progress: 0,
        blocked: 0,
        review: 0,
        tester: 0,
        remaining: 0,
      },
    });
  });
});
