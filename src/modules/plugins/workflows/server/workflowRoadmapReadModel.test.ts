import { describe, expect, it } from "vitest";
import {
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
