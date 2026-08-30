import { describe, expect, it, vi } from "vitest";
import {
  BdMetadataLiveSourceWorkflowReader,
  BdReadyBeadProvider,
  GasCityReadyBeadLauncher,
  createInMemoryReadyBeadLaunchLock,
  hasLiveGasCitySourceWorkflow,
  parseBdJsonArrayOutput,
  toReadyBead,
  type ReadyBead,
} from "./ready-bead-launcher";
import { buildGasCitySlingSourceWorkflowCommand } from "./sling-command";

describe("GasCityReadyBeadLauncher", () => {
  it("launches multiple ready workspace beads through official gc sling --on commands", async () => {
    const harness = createHarness({
      ready: [bead("feature-a"), bead("feature-b")],
    });

    const result = await harness.launcher.launchReady({
      workspaceId: "workspace-1",
      target: "rig/dev",
      formula: "dev-review-test",
      maxActive: 4,
    });

    expect(result.launched.map((entry) => entry.bead.id)).toEqual([
      "feature-a",
      "feature-b",
    ]);
    expect(harness.slingSourceWorkflow).toHaveBeenCalledTimes(2);
    expect(harness.slingSourceWorkflow).toHaveBeenNthCalledWith(1, {
      beadId: "feature-a",
      formula: "dev-review-test",
      nudge: false,
      target: "rig/dev",
      vars: {},
    });
  });

  it("filters by convoy, excludes terminal or already-launched beads, and uses per-bead formula override", async () => {
    const harness = createHarness({
      ready: [
        bead("feature-a", {
          convoyIds: ["convoy-1"],
          metadata: { "vd.gas_city.formula": "feature-a-formula" },
        }),
        bead("feature-b", { convoyIds: ["convoy-2"] }),
        bead("feature-c", { status: "closed", convoyIds: ["convoy-1"] }),
        bead("feature-d", {
          convoyIds: ["convoy-1"],
          metadata: { "gc.workflow_id": "workflow-feature-d" },
        }),
      ],
      activeSourceBeadIds: ["feature-e"],
    });

    const result = await harness.launcher.launchReady({
      workspaceId: "workspace-1",
      convoyId: "convoy-1",
      target: "rig/dev",
      formula: "fallback-formula",
      maxActive: 4,
    });

    expect(result.launched.map((entry) => entry.bead.id)).toEqual(["feature-a"]);
    expect(harness.slingSourceWorkflow).toHaveBeenCalledWith({
      beadId: "feature-a",
      formula: "feature-a-formula",
      nudge: false,
      target: "rig/dev",
      vars: {},
    });
    expect(result.skipped.map((entry) => [entry.bead.id, entry.reason])).toEqual([
      ["feature-b", "convoy_mismatch"],
      ["feature-c", "terminal_status"],
      ["feature-d", "already_launched"],
    ]);
  });

  it("lets CLI/prompt-provided per-bead formula choices override bead metadata", async () => {
    const harness = createHarness({
      ready: [
        bead("feature-a", {
          metadata: { "vd.gas_city.formula": "metadata-formula" },
        }),
      ],
    });

    const result = await harness.launcher.launchReady({
      workspaceId: "workspace-1",
      target: "rig/dev",
      formula: "fallback-formula",
      formulaByBeadId: { "feature-a": "prompt-selected-formula" },
    });

    expect(result.launched[0]?.formula).toBe("prompt-selected-formula");
    expect(harness.slingSourceWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ formula: "prompt-selected-formula" }),
    );
  });

  it("respects active capacity and per-run limit", async () => {
    const harness = createHarness({
      ready: [bead("feature-a"), bead("feature-b"), bead("feature-c")],
      activeSourceBeadIds: ["active-existing"],
    });

    const result = await harness.launcher.launchReady({
      workspaceId: "workspace-1",
      target: "rig/dev",
      formula: "dev-review-test",
      maxActive: 3,
      limit: 1,
    });

    expect(result.activeBefore).toBe(1);
    expect(result.capacity).toBe(2);
    expect(result.launched.map((entry) => entry.bead.id)).toEqual(["feature-a"]);
    expect(result.skipped.map((entry) => [entry.bead.id, entry.reason])).toEqual([
      ["feature-b", "limit_reached"],
      ["feature-c", "limit_reached"],
    ]);
  });

  it("treats maxActive=0 as unlimited while still honoring limit", async () => {
    const harness = createHarness({
      ready: [bead("feature-a"), bead("feature-b")],
      activeSourceBeadIds: ["active-existing"],
    });

    const result = await harness.launcher.launchReady({
      workspaceId: "workspace-1",
      target: "rig/dev",
      formula: "dev-review-test",
      maxActive: 0,
      limit: 0,
    });

    expect(result.capacity).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.launched.map((entry) => entry.bead.id)).toEqual([
      "feature-a",
      "feature-b",
    ]);
  });

  it("serializes overlapping invocations with a workspace/convoy lock", async () => {
    const lock = createInMemoryReadyBeadLaunchLock();
    const launches: string[] = [];
    const active = new Set<string>();
    const launcher = new GasCityReadyBeadLauncher({
      lock,
      async listReadyBeads() {
        return [bead("feature-a"), bead("feature-b")];
      },
      async listLiveSourceWorkflowBeadIds() {
        return [...active];
      },
      async slingSourceWorkflow(input) {
        launches.push(input.beadId);
        active.add(input.beadId);
        await Promise.resolve();
        return { stdout: `launched ${input.beadId}` };
      },
    });

    const [first, second] = await Promise.all([
      launcher.launchReady({
        workspaceId: "workspace-1",
        target: "rig/dev",
        formula: "dev-review-test",
        maxActive: 1,
      }),
      launcher.launchReady({
        workspaceId: "workspace-1",
        target: "rig/dev",
        formula: "dev-review-test",
        maxActive: 1,
      }),
    ]);

    expect(launches).toEqual(["feature-a"]);
    expect(first.launched).toHaveLength(1);
    expect(second.launched).toHaveLength(0);
    expect(second.skipped.map((entry) => [entry.bead.id, entry.reason])).toContainEqual([
      "feature-a",
      "already_launched",
    ]);
  });

  it("treats source-workflow singleton conflicts as duplicate-safe no-ops", async () => {
    const harness = createHarness({ ready: [bead("feature-a")] });
    vi.mocked(harness.slingSourceWorkflow).mockRejectedValueOnce(
      new Error("source bead feature-a already has a live source workflow"),
    );

    const result = await harness.launcher.launchReady({
      workspaceId: "workspace-1",
      target: "rig/dev",
      formula: "dev-review-test",
    });

    expect(result.launched).toEqual([]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ bead: expect.objectContaining({ id: "feature-a" }), reason: "already_launched" }),
    ]);
    expect(result.errors).toEqual([]);
  });
});

describe("ready bead shell helpers", () => {
  it("builds the released Gas City source-workflow sling command shape", () => {
    expect(
      buildGasCitySlingSourceWorkflowCommand({
        target: "42a2-vd-gas-city-plug/dev",
        beadId: "vkvw-abcd",
        formula: "dev-review-test",
        vars: { tester_target: "rig/tester", dev_target: "rig/dev" },
        nudge: true,
      }),
    ).toEqual([
      "sling",
      "42a2-vd-gas-city-plug/dev",
      "vkvw-abcd",
      "--on",
      "dev-review-test",
      "--nudge",
      "--var",
      "dev_target=rig/dev",
      "--var",
      "tester_target=rig/tester",
    ]);
  });

  it("parses bd output even when bd prints a human summary before JSON", () => {
    expect(parseBdJsonArrayOutput('Showing 1 of 1 ready issues.\n[{"id":"bead-a","title":"A"}]')).toEqual([
      { id: "bead-a", title: "A" },
    ]);
  });

  it("normalizes bd JSON metadata and live source-workflow markers", () => {
    const ready = toReadyBead({
      id: "bead-a",
      title: "A",
      status: "open",
      labels: ["feature"],
      parent: "parent-a",
      metadata: { "gc.workflow_id": "workflow-a" },
    });

    expect(ready).toMatchObject<ReadyBead>({
      id: "bead-a",
      title: "A",
      status: "open",
      labels: ["feature"],
      parentId: "parent-a",
      convoyIds: [],
      metadata: { "gc.workflow_id": "workflow-a" },
    });
    expect(hasLiveGasCitySourceWorkflow(ready)).toBe(true);
  });

  it("uses bd ready and bd metadata queries with workspace cwd seams", async () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const runBd = vi.fn(async (args: string[], cwd: string) => {
      calls.push({ args, cwd });
      if (args[0] === "ready") {
        return JSON.stringify([{ id: "ready-a", title: "Ready A" }]);
      }
      if (args.includes("gc.workflow_id")) {
        return JSON.stringify([{ id: "active-a", title: "Active A", status: "open" }]);
      }
      return "[]";
    });

    const ready = await new BdReadyBeadProvider({ runBd }).listReadyBeads({
      workspacePath: "/workspace",
      parentBeadId: "parent-a",
    });
    const active =
      await new BdMetadataLiveSourceWorkflowReader({ runBd }).listLiveSourceWorkflowBeadIds({
        workspacePath: "/workspace",
      });

    expect(ready.map((bead) => bead.id)).toEqual(["ready-a"]);
    expect(active).toEqual(["active-a"]);
    expect(calls).toContainEqual({
      args: ["ready", "--json", "--limit", "0", "--parent", "parent-a"],
      cwd: "/workspace",
    });
    expect(calls).toContainEqual({
      args: ["list", "--json", "--all", "--has-metadata-key", "gc.workflow_id", "--limit", "0"],
      cwd: "/workspace",
    });
  });
});

function createHarness(args: {
  ready: ReadyBead[];
  activeSourceBeadIds?: string[];
}) {
  const slingSourceWorkflow = vi.fn(async (input: {
    beadId: string;
    target: string;
    formula: string;
    vars: Record<string, string>;
    nudge: boolean;
  }) => ({ stdout: `launched ${input.beadId}` }));
  const launcher = new GasCityReadyBeadLauncher({
    lock: createInMemoryReadyBeadLaunchLock(),
    async listReadyBeads() {
      return args.ready;
    },
    async listLiveSourceWorkflowBeadIds() {
      return args.activeSourceBeadIds ?? [];
    },
    slingSourceWorkflow,
  });
  return { launcher, slingSourceWorkflow };
}

function bead(
  id: string,
  overrides: Partial<ReadyBead> = {},
): ReadyBead {
  return {
    id,
    title: id,
    status: "open",
    labels: [],
    metadata: {},
    convoyIds: [],
    ...overrides,
  };
}
