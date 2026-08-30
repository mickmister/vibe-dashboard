import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BdMetadataLiveSourceWorkflowReader,
  BdReadyBeadProvider,
  DirectoryReadyBeadSchedulerLock,
  GasCityConvoyMemberProvider,
  GasCityFormulaContractValidator,
  GasCityReadyBeadLauncher,
  createInMemoryReadyBeadLaunchLock,
  hasLiveGasCitySourceWorkflow,
  parseBdJsonArrayOutput,
  parseGasCityJsonObjectOutput,
  readyBeadLaunchLockKey,
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

  it("filters by real Gas City convoy membership, excludes terminal or already-launched beads, and uses per-bead formula override", async () => {
    const harness = createHarness({
      ready: [
        bead("feature-a", {
          metadata: { "vd.gas_city.formula": "feature-a-formula" },
        }),
        bead("feature-b"),
        bead("feature-c", { status: "closed" }),
        bead("feature-d", {
          metadata: { workflow_id: "workflow-feature-d" },
        }),
      ],
      convoyMemberBeadIds: ["feature-a", "feature-c", "feature-d"],
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

  it("uses the same workspace lock for workspace-wide and convoy-filtered runs", async () => {
    const lock = createInMemoryReadyBeadLaunchLock();
    const launches: string[] = [];
    const active = new Set<string>();
    const launcher = new GasCityReadyBeadLauncher({
      lock,
      async listReadyBeads() {
        return [bead("feature-a")];
      },
      async listConvoyMemberBeadIds() {
        return ["feature-a"];
      },
      async listLiveSourceWorkflowBeadIds() {
        return [...active];
      },
      async slingSourceWorkflow(input) {
        launches.push(input.beadId);
        active.add(input.beadId);
        return { stdout: `launched ${input.beadId}` };
      },
    });

    const [workspaceRun, convoyRun] = await Promise.all([
      launcher.launchReady({
        workspaceId: "workspace-1",
        target: "rig/dev",
        formula: "dev-review-test",
      }),
      launcher.launchReady({
        workspaceId: "workspace-1",
        convoyId: "convoy-1",
        target: "rig/dev",
        formula: "dev-review-test",
      }),
    ]);

    expect(readyBeadLaunchLockKey("workspace-1", "convoy-1")).toBe(
      readyBeadLaunchLockKey("workspace-1"),
    );
    expect(launches).toEqual(["feature-a"]);
    expect(workspaceRun.launched.length + convoyRun.launched.length).toBe(1);
  });

  it("validates each unique formula is graph.v2 before launch", async () => {
    const validateFormulaContract = vi.fn(async () => ({ contract: "graph.v2" }));
    const harness = createHarness({
      ready: [
        bead("feature-a", { metadata: { "vd.gas_city.formula": "dev-review-test" } }),
        bead("feature-b", { metadata: { "vd.gas_city.formula": "dev-review-test" } }),
      ],
      validateFormulaContract,
    });

    await harness.launcher.launchReady({
      workspaceId: "workspace-1",
      target: "rig/dev",
      maxActive: 4,
    });

    expect(validateFormulaContract).toHaveBeenCalledTimes(1);
    expect(validateFormulaContract).toHaveBeenCalledWith({
      formula: "dev-review-test",
      workspaceId: "workspace-1",
      workspacePath: undefined,
    });
  });

  it("fails closed when the selected formula is not graph.v2", async () => {
    const harness = createHarness({
      ready: [bead("feature-a")],
      validateFormulaContract: vi.fn(async () => ({ contract: "formula.v1" })),
    });

    const result = await harness.launcher.launchReady({
      workspaceId: "workspace-1",
      target: "rig/dev",
      formula: "legacy-formula",
    });

    expect(result.launched).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        bead: expect.objectContaining({ id: "feature-a" }),
        formula: "legacy-formula",
        message: expect.stringContaining("graph.v2"),
      }),
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
      new Error("gc sling: source bead feature-a already has live workflow(s): wf-1"),
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

  it("parses Gas City JSON object output even when stderr-style text appears before it", () => {
    expect(parseGasCityJsonObjectOutput('notice\n{"schema_version":"1","ok":true}')).toEqual({
      schema_version: "1",
      ok: true,
    });
  });

  it("normalizes bd JSON metadata and source-bead live workflow markers", () => {
    const ready = toReadyBead({
      id: "bead-a",
      title: "A",
      status: "open",
      labels: ["feature"],
      parent: "parent-a",
      metadata: { workflow_id: "workflow-a" },
    });

    expect(ready).toMatchObject<ReadyBead>({
      id: "bead-a",
      title: "A",
      status: "open",
      labels: ["feature"],
      parentId: "parent-a",
      convoyIds: [],
      metadata: { workflow_id: "workflow-a" },
    });
    expect(hasLiveGasCitySourceWorkflow(ready)).toBe(true);
  });

  it("does not treat workflow-bead root metadata as a source-bead live marker", () => {
    expect(
      hasLiveGasCitySourceWorkflow({
        metadata: { "gc.workflow_id": "wf-1", "gc.root_bead_id": "root-1" },
      }),
    ).toBe(false);
  });

  it("uses bd ready and bd metadata queries with workspace cwd seams", async () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const runBd = vi.fn(async (args: string[], cwd: string) => {
      calls.push({ args, cwd });
      if (args[0] === "ready") {
        return JSON.stringify([{ id: "ready-a", title: "Ready A" }]);
      }
      if (args.includes("workflow_id")) {
        return JSON.stringify([{ id: "active-source", title: "Active source", status: "open", metadata: { workflow_id: "workflow-root" } }]);
      }
      if (args.includes("gc.source_bead_id")) {
        return JSON.stringify([
          { id: "workflow-root", title: "Workflow Root", status: "open", metadata: { "gc.source_bead_id": "active-from-root" } },
          { id: "workflow-step", title: "Workflow Step", status: "open", metadata: { "gc.source_bead_id": "active-from-root" } },
          { id: "closed-workflow-root", title: "Closed Workflow", status: "closed", metadata: { "gc.source_bead_id": "closed-source" } },
        ]);
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
    expect(active.sort()).toEqual(["active-from-root", "active-source"]);
    expect(calls).toContainEqual({
      args: ["ready", "--json", "--limit", "0", "--parent", "parent-a"],
      cwd: "/workspace",
    });
    expect(calls).toContainEqual({
      args: ["list", "--json", "--all", "--has-metadata-key", "gc.source_bead_id", "--limit", "0"],
      cwd: "/workspace",
    });
  });

  it("reads convoy membership from released gc convoy status --json output", async () => {
    const runGc = vi.fn(async () =>
      JSON.stringify({
        schema_version: "1",
        convoy: { id: "convoy-1", title: "Convoy", status: "open" },
        children: [
          { id: "feature-a", title: "A", status: "open", type: "feature" },
          { id: "feature-b", title: "B", status: "closed", type: "task" },
        ],
      }),
    );

    await expect(
      new GasCityConvoyMemberProvider({ runGc }).listConvoyMemberBeadIds({
        cityPath: "/city",
        convoyId: "convoy-1",
      }),
    ).resolves.toEqual(["feature-a", "feature-b"]);
    expect(runGc).toHaveBeenCalledWith(["convoy", "status", "convoy-1", "--json"], "/city");
  });

  it("validates graph.v2 formulas from released gc formula show --json root metadata", async () => {
    const runGc = vi.fn(async () =>
      JSON.stringify({
        schema_version: "1",
        ok: true,
        name: "dev-review-test",
        steps: [
          { id: "root", is_root: true, metadata: { "gc.formula_contract": "graph.v2" } },
          { id: "dev", title: "Develop" },
        ],
      }),
    );

    await expect(
      new GasCityFormulaContractValidator({ runGc }).validateFormulaContract({
        cityPath: "/city",
        formula: "dev-review-test",
      }),
    ).resolves.toEqual({ contract: "graph.v2" });
    expect(runGc).toHaveBeenCalledWith(["formula", "show", "dev-review-test", "--json"], "/city");
  });

  it("removes stale directory locks before acquiring", async () => {
    const lockRoot = await mkdtemp(join(tmpdir(), "vd-gc-lock-test-"));
    try {
      const lock = new DirectoryReadyBeadSchedulerLock({
        io: await import("node:fs/promises").then((fs) => ({
          mkdir: (targetPath: string, options?: { recursive?: boolean }) => fs.mkdir(targetPath, options),
          rm: (targetPath: string) => fs.rm(targetPath, { recursive: true, force: true }),
          writeFile: (targetPath: string, contents: string) => fs.writeFile(targetPath, contents, "utf8"),
          readFile: (targetPath: string) => fs.readFile(targetPath, "utf8"),
          stat: (targetPath: string) => fs.stat(targetPath),
          join,
        })),
        lockRoot,
        staleMs: 100,
        now: () => Date.parse("2026-08-30T00:10:00.000Z"),
      });
      const lockDir = join(lockRoot, "stale-key");
      await import("node:fs/promises").then((fs) => fs.mkdir(lockDir, { recursive: true }));
      await writeFile(
        join(lockDir, "owner.json"),
        JSON.stringify({ key: "stale-key", acquiredAt: "2026-08-30T00:00:00.000Z" }),
      );

      await expect(lock.withLock("stale-key", async () => "ok")).resolves.toBe("ok");
    } finally {
      await rm(lockRoot, { recursive: true, force: true });
    }
  });
});

function createHarness(args: {
  ready: ReadyBead[];
  activeSourceBeadIds?: string[];
  convoyMemberBeadIds?: string[];
  validateFormulaContract?: GasCityReadyBeadLauncher["launchReady"] extends never
    ? never
    : (input: { formula: string; workspaceId: string; workspacePath?: string }) => Promise<{ contract: string | null }>;
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
    async listConvoyMemberBeadIds() {
      return args.convoyMemberBeadIds ?? [];
    },
    async listLiveSourceWorkflowBeadIds() {
      return args.activeSourceBeadIds ?? [];
    },
    validateFormulaContract: args.validateFormulaContract,
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
