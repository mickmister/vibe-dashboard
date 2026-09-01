import { describe, expect, it } from "vitest";
import { FakeGasCityWorkflowProvider, type GasCityProviderLaunchRequest, type GasCityProviderLaunchResult } from "./gasCityWorkflowProvider";
import { FakeGasCityBeadsProvider, GasCityReadyBeadFanoutBeadsAdapter, type GasCityBeadDto } from "./gasCityBeadsProvider";
import { GasCityReadyBeadFanoutPreviewProvider } from "./gasCityReadyBeadFanoutPreview";
import { GasCityReadyBeadFanoutLauncher } from "./gasCityReadyBeadFanoutLaunch";

function bead(overrides: Partial<GasCityBeadDto> & { id: string }): GasCityBeadDto {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    status: overrides.status ?? "open",
    readiness: overrides.readiness ?? "ready",
    workspaceId: overrides.workspaceId ?? "workspace-a",
    parentBeadId: overrides.parentBeadId ?? null,
    dependencyBeadIds: overrides.dependencyBeadIds ?? [],
    convoyIds: overrides.convoyIds ?? [],
    workflow: overrides.workflow ?? null,
    metadata: overrides.metadata,
    updatedAt: overrides.updatedAt ?? 123,
  };
}

function launcher(options: { beads: GasCityBeadDto[]; gasCityProvider?: FakeGasCityWorkflowProvider } ) {
  const gasCityProvider = options.gasCityProvider ?? new FakeGasCityWorkflowProvider({
    targets: [{ target: "worker", label: "Worker" }],
    formulas: [{ formula: "review-flow", label: "Review flow", contract: "graph.v2" }],
  });
  const previewProvider = new GasCityReadyBeadFanoutPreviewProvider({
    now: () => 100,
    gasCityProvider,
    beadProvider: new GasCityReadyBeadFanoutBeadsAdapter(new FakeGasCityBeadsProvider({ beads: options.beads })),
  });
  return { gasCityProvider, launcher: new GasCityReadyBeadFanoutLauncher({ previewProvider, gasCityProvider, now: () => 200 }) };
}

function request(idempotencyKey = "fanout-key") {
  return {
    idempotencyKey,
    preview: {
      context: { workspaceId: "workspace-a" },
      target: "worker",
      formula: "review-flow",
      source: { explicitBeadIds: ["bead-a", "bead-b"] },
      limits: { maxActiveSourceWorkflows: 10 },
    },
    laneByBeadId: {
      "bead-a": { laneId: "lane-a", label: "Lane A", status: "ready" as const },
      "bead-b": { laneId: "lane-b", label: "Lane B", status: "clean" as const },
    },
  };
}

class SlowGasCityProvider extends FakeGasCityWorkflowProvider {
  readonly release: () => void;
  private readonly gate: Promise<void>;

  constructor() {
    let release!: () => void;
    super({ targets: [{ target: "worker", label: "Worker" }], formulas: [{ formula: "review-flow", label: "Review flow", contract: "graph.v2" }] });
    this.gate = new Promise<void>((resolve) => { release = resolve; });
    this.release = release;
  }

  override async launchSourceWorkflow(input: GasCityProviderLaunchRequest): Promise<GasCityProviderLaunchResult> {
    await this.gate;
    return super.launchSourceWorkflow(input);
  }
}

describe("GasCityReadyBeadFanoutLauncher GCW-7B", () => {
  it("launches each selected ready bead once with deterministic per-bead idempotency keys", async () => {
    const { launcher: fanout, gasCityProvider } = launcher({ beads: [bead({ id: "bead-a" }), bead({ id: "bead-b" })] });

    const result = await fanout.launchReadyBeads(request());

    expect(result.status).toBe("completed");
    expect(result.counts).toMatchObject({ launched: 2, blocked: 0, failed: 0 });
    expect(result.items.map((item) => [item.beadId, item.status, item.lane?.laneId])).toEqual([
      ["bead-a", "launched", "lane-a"],
      ["bead-b", "launched", "lane-b"],
    ]);
    expect(gasCityProvider.launches.map((launch) => [launch.sourceBeadId, launch.idempotencyKey, launch.vars?.laneId])).toEqual([
      ["bead-a", "fanout-key:bead-a", "lane-a"],
      ["bead-b", "fanout-key:bead-b", "lane-b"],
    ]);
  });

  it("replays duplicate fanout request without relaunching and blocks mismatched replay", async () => {
    const { launcher: fanout, gasCityProvider } = launcher({ beads: [bead({ id: "bead-a" }), bead({ id: "bead-b" })] });

    const first = await fanout.launchReadyBeads(request("same-key"));
    const replay = await fanout.launchReadyBeads(request("same-key"));
    const conflict = await fanout.launchReadyBeads({ ...request("same-key"), laneByBeadId: { "bead-a": { laneId: "other-lane", status: "ready" } } });

    expect(first.counts.launched).toBe(2);
    expect(replay).toEqual(first);
    expect(gasCityProvider.launches).toHaveLength(2);
    expect(conflict).toMatchObject({ status: "blocked", nextAction: "Resolve blocked tasks before launching." });
    expect(conflict.preview.nextAction).toBe("This fanout launch key already belongs to different work.");
  });

  it("blocks missing, dirty, held, or unknown lane selections without launching those items", async () => {
    const { launcher: fanout, gasCityProvider } = launcher({ beads: [bead({ id: "bead-a" }), bead({ id: "bead-b" })] });

    const result = await fanout.launchReadyBeads({
      ...request("lane-key"),
      laneByBeadId: {
        "bead-a": { laneId: "lane-a", status: "dirty" },
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.items.map((item) => [item.beadId, item.status, item.reasonCode, item.message])).toEqual([
      ["bead-a", "blocked", "lane_dirty", "Resolve lane changes before launching this task bead."],
      ["bead-b", "blocked", "lane_missing", "Choose a clean lane before launching this task bead."],
    ]);
    expect(gasCityProvider.launches).toHaveLength(0);
  });

  it("returns partial product-safe result table for skipped, already-running, and provider-failed items", async () => {
    class FailingProvider extends FakeGasCityWorkflowProvider {
      override async launchSourceWorkflow(input: GasCityProviderLaunchRequest): Promise<GasCityProviderLaunchResult> {
        if (input.sourceBeadId === "bead-a") return super.launchSourceWorkflow(input);
        return { providerId: "gas_city", status: "blocked", workflowRef: { providerId: "gas_city", workspaceId: input.context.workspaceId, sourceBeadId: input.sourceBeadId, target: input.target, formula: input.formula }, summary: "gc sling failed at /Users/me with stdout provider diagnostics", productLinks: [], diagnosticsRef: "/tmp/raw.log" };
      }
    }
    const gasCityProvider = new FailingProvider({
      targets: [{ target: "worker", label: "Worker" }],
      formulas: [{ formula: "review-flow", label: "Review flow", contract: "graph.v2" }],
    });
    const { launcher: fanout } = launcher({
      gasCityProvider,
      beads: [
        bead({ id: "bead-a" }),
        bead({ id: "bead-b" }),
        bead({ id: "closed-bead", status: "closed", readiness: "terminal" }),
      ],
    });

    const result = await fanout.launchReadyBeads({
      ...request("partial-key"),
      preview: { ...request("partial-key").preview, source: { explicitBeadIds: ["bead-a", "bead-b", "closed-bead"] } },
      laneByBeadId: {
        "bead-a": { laneId: "lane-a", status: "ready" },
        "bead-b": { laneId: "lane-b", status: "ready" },
        "closed-bead": { laneId: "lane-c", status: "ready" },
      },
    });

    expect(result.status).toBe("partial");
    expect(result.items.map((item) => [item.beadId, item.status, item.reasonCode])).toEqual([
      ["bead-a", "launched", undefined],
      ["bead-b", "failed", "launch_failed"],
      ["closed-bead", "skipped", "terminal_status"],
    ]);
    expect(JSON.stringify(result)).not.toMatch(/gc sling|bd show|git status|\/Users|\/tmp|stdout|stderr|provider diagnostics|raw XML|raw JSON/i);
  });

  it("uses a short workspace lock to suppress concurrent launch preparation", async () => {
    const gasCityProvider = new SlowGasCityProvider();
    const { launcher: fanout } = launcher({ gasCityProvider, beads: [bead({ id: "bead-a" }), bead({ id: "bead-b" })] });

    const first = fanout.launchReadyBeads(request("lock-a"));
    const second = await fanout.launchReadyBeads(request("lock-b"));
    gasCityProvider.release();
    const firstResult = await first;

    expect(second.items).toHaveLength(2);
    expect(second.items.every((item) => item.status === "blocked" && item.reasonCode === "workspace_lock_conflict")).toBe(true);
    expect(firstResult.counts.launched).toBe(2);
  });
});
