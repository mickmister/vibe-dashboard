import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PINNED_GAS_CITY_VERSION,
  GasCityCliWorkflowProvider,
  buildGasCityFormulaShowCommand,
  buildGasCitySlingCommand,
  type GasCityCommandRunner,
} from "./gasCityCliWorkflowProvider";
import type { GasCityProviderLaunchRequest } from "./gasCityWorkflowProvider";

function launchRequest(overrides: Partial<GasCityProviderLaunchRequest> = {}): GasCityProviderLaunchRequest {
  return {
    context: { workspaceId: "vk-workspace-1" },
    sourceBeadId: "bead-123",
    target: "reviewer",
    formula: "vd-review-v1",
    vars: { request: "Review the change", priority: "P1" },
    nudge: true,
    idempotencyKey: "launch-key-1",
    ...overrides,
  };
}

function runnerReturning(stdoutByCommand: (file: string, args: readonly string[]) => string): GasCityCommandRunner {
  return {
    execFile: vi.fn(async (file, args) => ({ stdout: stdoutByCommand(file, args), stderr: "" })),
  };
}

describe("GasCityCliWorkflowProvider GCW-5", () => {
  it("builds typed allowlisted execFile argv for graph.v2 validation and single source-bead sling", () => {
    expect(buildGasCityFormulaShowCommand({ gcPath: "/opt/gc", formula: "vd-review-v1" })).toEqual({
      file: "/opt/gc",
      args: ["formula", "show", "vd-review-v1", "--json"],
    });
    expect(buildGasCitySlingCommand({ gcPath: "/opt/gc", launch: launchRequest() })).toEqual({
      file: "/opt/gc",
      args: [
        "sling",
        "reviewer",
        "bead-123",
        "--on",
        "vd-review-v1",
        "--json",
        "--var",
        "priority=P1",
        "--var",
        "request=Review the change",
        "--nudge",
      ],
    });
  });

  it("requires the pinned released gc version for health", async () => {
    const healthy = new GasCityCliWorkflowProvider({
      gcPath: "gc-test",
      requiredVersion: DEFAULT_PINNED_GAS_CITY_VERSION,
      runner: runnerReturning(() => JSON.stringify({ schema_version: "1", version: DEFAULT_PINNED_GAS_CITY_VERSION })),
    });
    await expect(healthy.getHealth({ workspaceId: "workspace-a" })).resolves.toMatchObject({ available: true, status: "healthy" });

    const wrong = new GasCityCliWorkflowProvider({
      gcPath: "gc-test",
      requiredVersion: DEFAULT_PINNED_GAS_CITY_VERSION,
      runner: runnerReturning(() => JSON.stringify({ schema_version: "1", version: "dev" })),
    });
    await expect(wrong.getHealth({ workspaceId: "workspace-a" })).resolves.toMatchObject({ available: false, status: "unavailable" });
  });

  it("validates graph.v2 formula choices after pinned release check without formula-show fallback", async () => {
    const runner = runnerReturning((_file, args) => {
      if (args[0] === "version") return JSON.stringify({ schema_version: "1", version: DEFAULT_PINNED_GAS_CITY_VERSION });
      throw new Error("should not execute formula show");
    });
    const provider = new GasCityCliWorkflowProvider({
      runner,
      targets: [{ target: "reviewer", label: "Reviewer" }],
      formulas: [{ formula: "vd-review-v1", label: "Review", contract: "graph.v2" }],
    });

    await expect(provider.validateLaunch(launchRequest())).resolves.toEqual([]);
    expect(runner.execFile).toHaveBeenCalledOnce();
    expect(runner.execFile).toHaveBeenCalledWith("gc", ["version", "--json"], expect.any(Object));
  });

  it("validates formula through released gc when the formula was not predeclared", async () => {
    const runner = runnerReturning((_file, args) => {
      if (args[0] === "version") return JSON.stringify({ schema_version: "1", version: DEFAULT_PINNED_GAS_CITY_VERSION });
      return args[0] === "formula" ? JSON.stringify({ schema_version: "1", ok: true, name: "vd-review-v1", contract: "graph.v2" }) : "{}";
    });
    const provider = new GasCityCliWorkflowProvider({ runner, targets: [{ target: "reviewer", label: "Reviewer" }] });

    await expect(provider.validateLaunch(launchRequest())).resolves.toEqual([]);
    expect(runner.execFile).toHaveBeenCalledWith("gc", ["version", "--json"], expect.objectContaining({ timeout: 30_000 }));
    expect(runner.execFile).toHaveBeenCalledWith("gc", ["formula", "show", "vd-review-v1", "--json"], expect.objectContaining({ timeout: 30_000 }));
  });

  it.each([
    ["missing contract", { schema_version: "1", ok: true, name: "vd-review-v1" }],
    ["unknown contract", { schema_version: "1", ok: true, name: "vd-review-v1", contract: "unknown" }],
    ["wrong contract", { schema_version: "1", ok: true, name: "vd-review-v1", contract: "orders.v1" }],
  ])("blocks formula show success with %s because graph.v2 evidence is required", async (_name, payload) => {
    const runner = runnerReturning((_file, args) => {
      if (args[0] === "version") return JSON.stringify({ schema_version: "1", version: DEFAULT_PINNED_GAS_CITY_VERSION });
      return args[0] === "formula" ? JSON.stringify(payload) : "not used";
    });
    const provider = new GasCityCliWorkflowProvider({ runner });

    const issues = await provider.validateLaunch(launchRequest());
    const launch = await provider.launchSourceWorkflow(launchRequest());

    expect(issues).toEqual([expect.objectContaining({ code: "GAS_CITY_FORMULA_UNSUPPORTED", path: "formula" })]);
    expect(launch.status).toBe("blocked");
    expect(JSON.stringify({ issues, launch })).not.toMatch(/orders.v1|stdout|stderr|provider diagnostics|gc formula|gc sling|\/Users|raw XML/i);
  });

  it("accepts graph.v2 evidence from generated formula metadata", async () => {
    const runner = runnerReturning((_file, args) => {
      if (args[0] === "version") return JSON.stringify({ schema_version: "1", version: DEFAULT_PINNED_GAS_CITY_VERSION });
      return args[0] === "formula"
        ? JSON.stringify({ schema_version: "1", ok: true, name: "vd-review-v1", metadata: { gc: { formula_contract: "graph.v2" } } })
        : "{}";
    });
    const provider = new GasCityCliWorkflowProvider({ runner });

    await expect(provider.validateLaunch(launchRequest())).resolves.toEqual([]);
  });

  it("launches a single explicit source bead through gc sling and returns product-safe refs", async () => {
    const runner = runnerReturning((_file, args) => {
      if (args[0] === "version") return JSON.stringify({ schema_version: "1", version: DEFAULT_PINNED_GAS_CITY_VERSION });
      if (args[0] === "sling") {
        return JSON.stringify({
          schema_version: "1",
          success: true,
          target: "reviewer",
          bead_id: "bead-123",
          formula: "vd-review-v1",
          molecule_id: "root-456",
          workflow_id: "workflow-789",
          convoy_id: "convoy-111",
          routed: true,
          queued: true,
          dashboard_url: "/dashboard/gas-city/workflows/workflow-789",
          warnings: ["raw XML from /tmp/private via webhook queue item"],
        });
      }
      return JSON.stringify({ ok: true });
    });
    const provider = new GasCityCliWorkflowProvider({
      runner,
      now: () => 100,
      targets: [{ target: "reviewer", label: "Reviewer" }],
      formulas: [{ formula: "vd-review-v1", label: "Review", contract: "graph.v2" }],
    });

    const result = await provider.launchSourceWorkflow(launchRequest());

    expect(result).toMatchObject({
      providerId: "gas_city",
      status: "accepted",
      workflowRef: {
        workspaceId: "vk-workspace-1",
        sourceBeadId: "bead-123",
        target: "reviewer",
        formula: "vd-review-v1",
        rootBeadId: "root-456",
        workflowId: "workflow-789",
      },
      summary: "Gas City accepted the workflow launch.",
    });
    expect(result.diagnosticsRef).toMatch(/^gas-city-launch:/);
    expect(result.productLinks.map((link) => link.href)).toContain("/dashboard/gas-city/workflows/workflow-789");
    expect(runner.execFile).toHaveBeenCalledWith("gc", expect.arrayContaining(["sling", "reviewer", "bead-123", "--on", "vd-review-v1", "--json"]), expect.any(Object));

    const read = await provider.getWorkflow(result.workflowRef);
    expect(read).toMatchObject({ status: "running", sourceBead: { id: "bead-123" }, currentOwner: "reviewer" });
    expect(JSON.stringify(read)).not.toMatch(/raw XML|\/tmp|webhook|queue item|stdout|stderr|provider diagnostics|gc sling|bd show|git status/i);
  });

  it("returns already_running for idempotent duplicate launch and blocks mismatched replay", async () => {
    const runner = runnerReturning((_file, args) => {
      if (args[0] === "version") return JSON.stringify({ schema_version: "1", version: DEFAULT_PINNED_GAS_CITY_VERSION });
      return args[0] === "sling" ? JSON.stringify({ schema_version: "1", success: true, target: "reviewer", bead_id: "bead-123", formula: "vd-review-v1", molecule_id: "root-456", workflow_id: "workflow-789", routed: true }) : JSON.stringify({ ok: true });
    });
    const provider = new GasCityCliWorkflowProvider({
      runner,
      targets: [{ target: "reviewer", label: "Reviewer" }],
      formulas: [{ formula: "vd-review-v1", label: "Review", contract: "graph.v2" }],
    });

    const first = await provider.launchSourceWorkflow(launchRequest());
    const replay = await provider.launchSourceWorkflow(launchRequest());
    const conflict = await provider.launchSourceWorkflow(launchRequest({ target: "tester" }));

    expect(first.status).toBe("accepted");
    expect(replay.status).toBe("already_running");
    expect(conflict).toMatchObject({ status: "blocked" });
    expect(conflict.summary).toMatch(/launch key already belongs/i);
    expect(runner.execFile).toHaveBeenCalledTimes(2);
  });

  it("blocks unsupported formulas and failed launch without leaking raw diagnostics", async () => {
    const runner = runnerReturning((_file, args) => {
      if (args[0] === "version") return JSON.stringify({ schema_version: "1", version: DEFAULT_PINNED_GAS_CITY_VERSION });
      return args[0] === "formula" ? JSON.stringify({ ok: false, error: "raw XML /Users/me/path" }) : "not used";
    });
    const provider = new GasCityCliWorkflowProvider({ runner });

    const result = await provider.launchSourceWorkflow(launchRequest());

    expect(result.status).toBe("blocked");
    expect(JSON.stringify(result)).not.toMatch(/raw XML|\/Users|stderr|stdout|provider diagnostics|gc formula|gc sling|bd show|git status/i);
  });
});
