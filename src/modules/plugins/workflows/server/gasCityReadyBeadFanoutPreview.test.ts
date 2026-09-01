import { describe, expect, it } from "vitest";
import { FakeGasCityWorkflowProvider, type GasCityProviderWorkflowReadModel } from "./gasCityWorkflowProvider";
import {
  FakeReadyBeadFanoutBeadProvider,
  GasCityReadyBeadFanoutPreviewProvider,
  type ReadyBeadFanoutBead,
} from "./gasCityReadyBeadFanoutPreview";

function bead(overrides: Partial<ReadyBeadFanoutBead> & { id: string }): ReadyBeadFanoutBead {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    status: overrides.status ?? "open",
    workspaceId: overrides.workspaceId ?? "workspace-a",
    parentBeadId: overrides.parentBeadId ?? "parent-a",
    convoyIds: overrides.convoyIds ?? ["convoy-a"],
    metadata: overrides.metadata ?? {},
  };
}

function activeWorkflow(sourceBeadId: string): GasCityProviderWorkflowReadModel {
  return {
    providerId: "gas_city",
    workflowRef: {
      providerId: "gas_city",
      workspaceId: "workspace-a",
      sourceBeadId,
      target: "worker",
      formula: "review-flow",
      rootBeadId: `root-${sourceBeadId}`,
      workflowId: `workflow-${sourceBeadId}`,
    },
    sourceBead: { id: sourceBeadId, title: sourceBeadId, status: "open" },
    status: "running",
    productLinks: [],
    warnings: [],
  };
}

function provider(options: {
  beads?: ReadyBeadFanoutBead[];
  active?: string[];
  available?: boolean;
  formulas?: Array<{ formula: string; label: string; contract: "graph.v2" | "unknown" }>;
  convoyMembers?: Record<string, string[]>;
} = {}) {
  return new GasCityReadyBeadFanoutPreviewProvider({
    now: () => 123,
    gasCityProvider: new FakeGasCityWorkflowProvider({
      available: options.available ?? true,
      targets: [{ target: "worker", label: "Worker" }],
      formulas: options.formulas ?? [{ formula: "review-flow", label: "Review flow", contract: "graph.v2" }],
      workflows: (options.active ?? []).map(activeWorkflow),
    }),
    beadProvider: new FakeReadyBeadFanoutBeadProvider({ beads: options.beads ?? [], convoyMembers: options.convoyMembers }),
  });
}

describe("GasCityReadyBeadFanoutPreviewProvider GCW-7A", () => {
  it("TEST_CASE_GCW7A_1A previews explicit beads in deterministic explicit order without side effects", async () => {
    const preview = await provider({
      beads: [bead({ id: "bead-c" }), bead({ id: "bead-a" }), bead({ id: "bead-b" })],
    }).previewReadyBeadFanout({
      context: { workspaceId: "workspace-a" },
      target: "worker",
      formula: "review-flow",
      source: { explicitBeadIds: ["bead-b", "bead-a", "bead-b", "bead-missing"] },
      limits: { maxActiveSourceWorkflows: 10, maxLaunches: 10 },
    });

    expect(preview).toMatchObject({
      workspaceId: "workspace-a",
      authoritativeSource: "gas_city_beads",
      advisory: true,
      generatedAt: 123,
      counts: { willLaunch: 2, blocked: 1, skipped: 0, activeBefore: 0, capacity: 10 },
    });
    expect(preview.items.map((item) => [item.beadId, item.status, item.reasonCode])).toEqual([
      ["bead-b", "will_launch", undefined],
      ["bead-a", "will_launch", undefined],
      ["bead-missing", "blocked", "bead_not_found"],
    ]);
    expect(preview.nextAction).toBe("Review 2 ready tasks before launching.");
  });

  it("TEST_CASE_GCW7A_1B previews parent/convoy filtered ready beads and skip mismatches", async () => {
    const preview = await provider({
      beads: [
        bead({ id: "bead-a", parentBeadId: "parent-a", convoyIds: ["convoy-a"] }),
        bead({ id: "bead-b", parentBeadId: "parent-a", convoyIds: ["convoy-b"] }),
        bead({ id: "bead-c", parentBeadId: "parent-b", convoyIds: ["convoy-a"] }),
      ],
      convoyMembers: { "convoy-a": ["bead-a"] },
    }).previewReadyBeadFanout({
      context: { workspaceId: "workspace-a" },
      target: "worker",
      formula: "review-flow",
      source: { explicitBeadIds: ["bead-a", "bead-b", "bead-c"], parentBeadId: "parent-a", convoyId: "convoy-a" },
      limits: { maxActiveSourceWorkflows: 10 },
    });

    expect(preview.items.map((item) => [item.beadId, item.status, item.reasonCode])).toEqual([
      ["bead-a", "will_launch", undefined],
      ["bead-b", "skipped", "convoy_mismatch"],
      ["bead-c", "skipped", "parent_mismatch"],
    ]);
  });

  it("TEST_CASE_GCW7A_1C applies active workflow capacity, per-run limits, and already-running skips", async () => {
    const preview = await provider({
      beads: [
        bead({ id: "bead-a" }),
        bead({ id: "bead-b" }),
        bead({ id: "bead-c", metadata: { workflow_id: "workflow-c" } }),
        bead({ id: "bead-d", status: "closed" }),
        bead({ id: "bead-e", status: "blocked" }),
      ],
      active: ["bead-b"],
    }).previewReadyBeadFanout({
      context: { workspaceId: "workspace-a" },
      target: "worker",
      formula: "review-flow",
      source: { explicitBeadIds: ["bead-a", "bead-b", "bead-c", "bead-d", "bead-e"] },
      limits: { maxActiveSourceWorkflows: 2, maxLaunches: 1 },
    });

    expect(preview.counts).toMatchObject({ activeBefore: 1, capacity: 1, willLaunch: 1, alreadyRunning: 2, skipped: 2 });
    expect(preview.items.map((item) => [item.beadId, item.status, item.reasonCode])).toEqual([
      ["bead-a", "will_launch", undefined],
      ["bead-b", "already_running", "already_running"],
      ["bead-c", "already_running", "already_running"],
      ["bead-d", "skipped", "terminal_status"],
      ["bead-e", "skipped", "bead_not_ready"],
    ]);
  });

  it("TEST_CASE_GCW7A_1D scrubs raw command/path/output/provider terms from preview output", async () => {
    const preview = await provider({
      beads: [bead({ id: "bead-a", title: "Run gc sling and bd show /Users/me/secret with raw XML stdout", metadata: { "gc.formula": "review-flow" } })],
    }).previewReadyBeadFanout({
      context: { workspaceId: "workspace-a" },
      target: "worker",
      source: { explicitBeadIds: ["bead-a"] },
      limits: { maxActiveSourceWorkflows: 10 },
    });

    const rendered = JSON.stringify(preview);
    expect(rendered).not.toMatch(/gc sling|bd show|git status|\/Users|\/tmp|stdout|stderr|provider diagnostics|webhook|queue item|raw XML|raw JSON/i);
    expect(preview.items[0]?.title).toContain("provider command");
  });

  it("TEST_CASE_GCW7A_1E blocks provider unavailable, missing formula, and unsupported formula product-safely", async () => {
    const unavailable = await provider({ available: false, beads: [bead({ id: "bead-a" })] }).previewReadyBeadFanout({
      context: { workspaceId: "workspace-a" },
      target: "worker",
      formula: "review-flow",
      source: { explicitBeadIds: ["bead-a"] },
    });
    expect(unavailable.items[0]).toMatchObject({ status: "blocked", reasonCode: "provider_unavailable" });
    expect(unavailable.nextAction).toBe("Configure the workflow engine before launching ready tasks.");

    const missingFormula = await provider({ beads: [bead({ id: "bead-a" })] }).previewReadyBeadFanout({
      context: { workspaceId: "workspace-a" },
      target: "worker",
      source: { explicitBeadIds: ["bead-a"] },
    });
    expect(missingFormula.items[0]).toMatchObject({ status: "blocked", reasonCode: "formula_missing" });

    const wrongFormula = await provider({
      beads: [bead({ id: "bead-a" })],
      formulas: [{ formula: "orders-flow", label: "Orders flow", contract: "unknown" }],
    }).previewReadyBeadFanout({
      context: { workspaceId: "workspace-a" },
      target: "worker",
      formula: "orders-flow",
      source: { explicitBeadIds: ["bead-a"] },
    });
    expect(wrongFormula.items[0]).toMatchObject({ status: "blocked", reasonCode: "formula_unsupported" });
    expect(JSON.stringify(wrongFormula)).not.toMatch(/orders\.v1|gc formula|stdout|stderr|\/Users|provider diagnostics/i);
  });
});
