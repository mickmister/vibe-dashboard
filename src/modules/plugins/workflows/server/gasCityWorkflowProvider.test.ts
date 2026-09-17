import { describe, expect, it } from "vitest";
import {
  FakeGasCityWorkflowProvider,
  sanitizeGasCityProviderText,
  validateGasCityProviderLaunchRequest,
  type GasCityProviderWorkflowReadModel,
} from "./gasCityWorkflowProvider";

describe("GasCityWorkflowProvider contract GCW-3", () => {
  it("validates explicit single source-bead launch requests with VK workspace id context", async () => {
    const provider = new FakeGasCityWorkflowProvider({ now: () => 1_700 });
    const issues = await provider.validateLaunch({
      context: { workspaceId: "" },
      sourceBeadId: "",
      target: "",
      formula: "",
      idempotencyKey: "",
    });

    expect(issues.map((issue) => issue.path)).toEqual([
      "context.workspaceId",
      "sourceBeadId",
      "target",
      "formula",
      "idempotencyKey",
    ]);
    expect(JSON.stringify(issues)).not.toMatch(/vdWorkspaceId/);
  });

  it("rejects non-graph.v2 formulas before real gc sling wiring", async () => {
    const provider = new FakeGasCityWorkflowProvider({
      formulas: [{ formula: "legacy-formula", label: "Legacy formula", contract: "unknown" }],
    });

    await expect(provider.validateLaunch({
      context: { workspaceId: "workspace-a" },
      sourceBeadId: "bead-a",
      target: "worker",
      formula: "legacy-formula",
      idempotencyKey: "launch-1",
    })).resolves.toContainEqual(expect.objectContaining({
      code: "GAS_CITY_FORMULA_UNSUPPORTED",
      path: "formula",
    }));
  });

  it("launches through fake provider with opaque GC refs and rebuildable read model only", async () => {
    const provider = new FakeGasCityWorkflowProvider({ now: () => 42 });
    const launch = await provider.launchSourceWorkflow({
      context: { workspaceId: "vk-workspace-1", vkSessionId: "session-1", currentBeadIds: ["source-1"] },
      sourceBeadId: "source-1",
      target: "worker",
      formula: "dev-review-test",
      vars: { ui_work: "true" },
      nudge: true,
      idempotencyKey: "vk-workspace-1:source-1:dev-review-test",
    });

    expect(launch).toMatchObject({
      providerId: "gas_city",
      status: "accepted",
      workflowRef: {
        providerId: "gas_city",
        workspaceId: "vk-workspace-1",
        sourceBeadId: "source-1",
        target: "worker",
        formula: "dev-review-test",
      },
    });
    expect(launch.workflowRef.rootBeadId).toBe("gc-root-source-1");
    expect(launch.workflowRef.workflowId).toBe("gc-workflow-source-1");
    expect(provider.launches).toHaveLength(1);

    const read = await provider.getWorkflow(launch.workflowRef);
    expect(read).toMatchObject({
      providerId: "gas_city",
      status: "running",
      sourceBead: { id: "source-1", title: "source-1" },
      nextAction: "Gas City accepted the workflow launch.",
    });
    expect(read?.metadata).toEqual({ target: "worker", formula: "dev-review-test" });
  });

  it("returns already_running for duplicate fake launch without creating authoritative VD state", async () => {
    const provider = new FakeGasCityWorkflowProvider({ now: () => 42 });
    const request = {
      context: { workspaceId: "workspace-a" },
      sourceBeadId: "bead-a",
      target: "worker",
      formula: "dev-review-test",
      idempotencyKey: "same-key",
    };

    const first = await provider.launchSourceWorkflow(request);
    const second = await provider.launchSourceWorkflow(request);

    expect(first.status).toBe("accepted");
    expect(second.status).toBe("already_running");
    expect(second.workflowRef).toEqual(first.workflowRef);
    expect(provider.launches).toHaveLength(2);
  });

  it("scrubs provider supplied strings, warnings, metadata, and unsafe product links", async () => {
    const hostile: GasCityProviderWorkflowReadModel = {
      providerId: "gas_city",
      workflowRef: {
        providerId: "gas_city",
        workspaceId: "workspace-a",
        sourceBeadId: "bead-a",
        target: "worker",
        formula: "dev-review-test",
        rootBeadId: "root-a",
        workflowId: "workflow-a",
      },
      sourceBead: { id: "bead-a", title: "Run bd show /Users/me/secret with raw XML", status: "open" },
      status: "blocked",
      currentOwner: "webhook owner",
      currentStage: "gc sling worker bead-a --on formula",
      nextAction: "Inspect /tmp/private queue_item delivery ID provider diagnostics <xml/>",
      progress: { total: 1, completed: 0, running: 0, blocked: 1 },
      updatedAt: 10,
      productLinks: [{ label: "Open /private/var/secret", href: "file:///Users/me/secret", kind: "dashboard" }],
      warnings: ["git status showed HMAC trigger and raw JSON"],
      metadata: { command: "gc sling worker bead-a --on formula", ok: true },
    };
    const provider = new FakeGasCityWorkflowProvider({ workflows: [hostile] });
    const [read] = await provider.listWorkflows({ workspaceId: "workspace-a" });
    const rendered = JSON.stringify(read);

    expect(rendered).not.toMatch(/\/Users|\/tmp|\/private\/var|bd show|git status|gc sling|webhook|queue_item|delivery ID|provider diagnostics|raw XML|raw JSON|<xml/i);
    expect(read?.productLinks[0]?.href).toBe("#");
    expect(read?.warnings[0]).toContain("provider command");
  });

  it("exposes activity snapshots scoped to the existing VK workspace id", async () => {
    const provider = new FakeGasCityWorkflowProvider({ now: () => 123 });
    await provider.launchSourceWorkflow({
      context: { workspaceId: "workspace-a" },
      sourceBeadId: "bead-a",
      target: "worker",
      formula: "dev-review-test",
      idempotencyKey: "a",
    });
    await provider.launchSourceWorkflow({
      context: { workspaceId: "workspace-b" },
      sourceBeadId: "bead-b",
      target: "worker",
      formula: "dev-review-test",
      idempotencyKey: "b",
    });

    const activity = await provider.getActivity({ workspaceId: "workspace-a" });

    expect(activity).toMatchObject({ providerId: "gas_city", workspaceId: "workspace-a", generatedAt: 123 });
    expect(activity.workflows.map((workflow) => workflow.workflowRef.sourceBeadId)).toEqual(["bead-a"]);
  });
});

describe("sanitizeGasCityProviderText", () => {
  it("caps and replaces internal/debug terms for product-safe read models", () => {
    const sanitized = sanitizeGasCityProviderText("raw XML from /Users/me/x via webhook queue item and gc sling target bead");
    expect(sanitized).not.toMatch(/raw XML|\/Users|webhook|queue item|gc sling/i);
    expect(sanitized.length).toBeLessThanOrEqual(280);
  });
});

describe("validateGasCityProviderLaunchRequest", () => {
  it("uses product-safe unavailable errors", () => {
    const issues = validateGasCityProviderLaunchRequest({
      context: { workspaceId: "workspace-a" },
      sourceBeadId: "bead-a",
      target: "worker",
      formula: "dev-review-test",
      idempotencyKey: "launch-a",
    }, { available: false });
    expect(issues).toEqual([expect.objectContaining({ code: "GAS_CITY_PROVIDER_UNAVAILABLE" })]);
    expect(JSON.stringify(issues)).not.toMatch(/shell|bd |git |\/Users|webhook/i);
  });
});
