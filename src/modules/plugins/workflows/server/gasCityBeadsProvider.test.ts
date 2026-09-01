import { describe, expect, it } from "vitest";
import { FakeGasCityWorkflowProvider } from "./gasCityWorkflowProvider";
import {
  FakeGasCityBeadsProvider,
  GasCityReadyBeadFanoutBeadsAdapter,
  sanitizeGasCityBeadDto,
  toReadyBeadFanoutBead,
  type GasCityBeadDto,
} from "./gasCityBeadsProvider";
import { GasCityReadyBeadFanoutPreviewProvider } from "./gasCityReadyBeadFanoutPreview";

function bead(overrides: Partial<GasCityBeadDto> & { id: string }): GasCityBeadDto {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    status: overrides.status ?? "open",
    readiness: overrides.readiness ?? "ready",
    workspaceId: overrides.workspaceId ?? "workspace-a",
    parentBeadId: overrides.parentBeadId ?? "parent-a",
    dependencyBeadIds: overrides.dependencyBeadIds ?? [],
    convoyIds: overrides.convoyIds ?? [],
    workflow: overrides.workflow ?? null,
    metadata: overrides.metadata,
    updatedAt: overrides.updatedAt ?? 123,
  };
}

function forbiddenText(): RegExp {
  return /bd show|gc sling|git status|\/Users|\/tmp|stdout|stderr|webhook|queue item|provider diagnostics|raw XML|raw JSON|<decision/i;
}

describe("GasCityBeadsProvider GCW-11", () => {
  it("exposes product-safe typed bead DTOs for status/readiness/workspace/dependencies/workflow metadata", () => {
    const safe = sanitizeGasCityBeadDto(bead({
      id: "bead one",
      title: "Fix thing with bd show /Users/me/secret and raw XML <decision/>",
      status: "open",
      readiness: "ready",
      workspaceId: "workspace a",
      dependencyBeadIds: ["dep one", "dep one", "dep/two"],
      convoyIds: ["convoy one"],
      workflow: {
        workflowId: "workflow one",
        rootBeadId: "root one",
        sourceBeadId: "bead one",
        formula: "gc sling bad",
        target: "worker target",
        status: "running",
      },
      metadata: { note: "provider diagnostics from /tmp/log with stdout", "bad key": "git status" },
    }));

    expect(safe).toMatchObject({
      id: "bead-one",
      title: expect.stringContaining("provider command"),
      workspaceId: "workspace-a",
      dependencyBeadIds: ["dep-one", "dep-two"],
      convoyIds: ["convoy-one"],
      workflow: {
        workflowId: "workflow-one",
        rootBeadId: "root-one",
        sourceBeadId: "bead-one",
        formula: "gc-sling-bad",
        target: "worker-target",
        status: "running",
      },
    });
    expect(JSON.stringify(safe)).not.toMatch(forbiddenText());
  });

  it("adapts typed Beads DTOs into ready fanout preview and preserves every explicit requested ID", async () => {
    const provider = new FakeGasCityBeadsProvider({
      beads: [
        bead({ id: "bead-b", title: "Second", workflow: { formula: "review-flow" } }),
        bead({ id: "bead-a", title: "First", workflow: { formula: "review-flow" } }),
        bead({ id: "not-ready", readiness: "not_ready", status: "blocked" }),
      ],
    });

    const preview = await new GasCityReadyBeadFanoutPreviewProvider({
      now: () => 999,
      gasCityProvider: new FakeGasCityWorkflowProvider({
        targets: [{ target: "worker", label: "Worker" }],
        formulas: [{ formula: "review-flow", label: "Review flow", contract: "graph.v2" }],
      }),
      beadProvider: new GasCityReadyBeadFanoutBeadsAdapter(provider),
    }).previewReadyBeadFanout({
      context: { workspaceId: "workspace-a" },
      target: "worker",
      source: { explicitBeadIds: ["bead-a", "bead-missing", "bead-b"] },
      limits: { maxActiveSourceWorkflows: 10 },
    });

    expect(preview.items.map((item) => [item.beadId, item.status, item.reasonCode])).toEqual([
      ["bead-a", "will_launch", undefined],
      ["bead-missing", "blocked", "bead_not_found"],
      ["bead-b", "will_launch", undefined],
    ]);
    expect(preview.counts).toMatchObject({ willLaunch: 2, blocked: 1 });
  });

  it("marks typed workflow linkage metadata as already running for fanout preview", () => {
    const fanoutBead = toReadyBeadFanoutBead(bead({
      id: "bead-a",
      workflow: {
        workflowId: "workflow-a",
        rootBeadId: "root-a",
        sourceBeadId: "bead-a",
        formula: "review-flow",
        target: "worker",
        status: "running",
      },
    }));

    expect(fanoutBead.metadata).toMatchObject({
      "gc.workflow_id": "workflow-a",
      workflow_id: "workflow-a",
      "gc.root_bead_id": "root-a",
      "gc.formula": "review-flow",
      "gc.target": "worker",
    });
  });

  it("provides explicit idempotent workflow linkage and result-note write contracts", async () => {
    const provider = new FakeGasCityBeadsProvider({ beads: [bead({ id: "bead-a" })] });
    const linkage = {
      workspaceId: "workspace-a",
      beadId: "bead-a",
      idempotencyKey: "linkage-key",
      workflow: { workflowId: "workflow-a", rootBeadId: "root-a", formula: "review-flow", target: "worker" },
    };

    await expect(provider.upsertWorkflowLinkage?.(linkage)).resolves.toMatchObject({ status: "created" });
    await expect(provider.upsertWorkflowLinkage?.(linkage)).resolves.toMatchObject({ status: "already_applied" });
    await expect(provider.upsertWorkflowLinkage?.({ ...linkage, workflow: { ...linkage.workflow, workflowId: "workflow-b" } })).resolves.toMatchObject({
      status: "conflict",
      message: "Workflow linkage key was already used for different work.",
    });

    const note = {
      workspaceId: "workspace-a",
      beadId: "bead-a",
      noteKey: "result-note",
      summary: "Done; see /Users/me/log and webhook provider diagnostics",
      idempotencyKey: "note-key",
    };
    await expect(provider.writeWorkflowResultNote?.(note)).resolves.toMatchObject({ status: "created" });
    await expect(provider.writeWorkflowResultNote?.(note)).resolves.toMatchObject({ status: "already_applied" });
    await expect(provider.writeWorkflowResultNote?.({ ...note, beadId: "missing" })).resolves.toMatchObject({ status: "conflict" });
  });

  it("returns product-safe unavailable mutations for missing beads", async () => {
    const provider = new FakeGasCityBeadsProvider({ beads: [] });
    await expect(provider.upsertWorkflowLinkage?.({
      workspaceId: "workspace-a",
      beadId: "missing",
      idempotencyKey: "linkage-key",
      workflow: { workflowId: "workflow-a", rootBeadId: "root-a", formula: "review-flow", target: "worker" },
    })).resolves.toMatchObject({ status: "unavailable", message: "Task bead is unavailable." });
  });
});
