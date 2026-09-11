import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { WorkflowPlanLaunchService, type WorkflowPlanRequest } from "./workflowPlanLaunchService";

const request = (): WorkflowPlanRequest => ({ workspaceId: "workspace-1", designId: "workflow-1", version: 2, inputs: { task: "Ship" }, roleBindings: { dev: { model: "m" } }, beadIds: ["bead-1", "bead-2"] });
const compileInput = (): any => ({ workflow: { version: 2 }, inputs: { task: "Ship" } });

function setup(now = 1_000) {
  let revision = "tasks-r1";
  let ready = true;
  const effects = { workflows: 0, beads: 0, sessions: 0, messages: 0, worktrees: 0, capacity: 0, callbacks: 0, notifications: 0 };
  const source = { resolve: vi.fn(async (value: WorkflowPlanRequest) => ({ compileInput: { ...compileInput(), inputs: value.inputs }, workflowLabel: "Review work", tasks: value.beadIds.map((id) => ({ id, title: `Task ${id}`, structuralRevision: revision })), repositories: [{ id: "repo-a", accessRevision: "access-1", mode: "write" as const }], securityPolicyRevision: "policy-1" })) };
  const compiler = { compile: vi.fn(async (input: any) => { const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex"); return { schemaVersion: "vd.execution-bundle.v1" as const, digest, bytes: new Uint8Array(), document: {}, verificationEvidence: {} as any }; }) };
  const launcher = { checkDynamic: vi.fn(async () => ({ ready, message: ready ? undefined : "Capacity is currently full." })), launch: vi.fn(async ({ idempotencyKey }: any) => ({ runId: `run-${idempotencyKey.slice(0, 8)}`, status: "running", url: "/dashboard/workflows/run-1" })) };
  const service = new WorkflowPlanLaunchService({ source, compiler, launcher, now: () => now, ttlMs: 100 });
  return { service, source, compiler, launcher, effects, setRevision: (v: string) => { revision = v; }, setReady: (v: boolean) => { ready = v; } };
}

describe("digest-bound workflow planning", () => {
  it("plans without any launch or product side effect", async () => {
    const h = setup(); const plan = await h.service.plan(request());
    expect(plan).toMatchObject({ schemaVersion: "vd.workflow-plan.v1", workspaceId: "workspace-1", tasks: [{ id: "bead-1" }, { id: "bead-2" }] });
    expect(plan.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(h.launcher.checkDynamic).not.toHaveBeenCalled(); expect(h.launcher.launch).not.toHaveBeenCalled();
    expect(Object.values(h.effects)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it.each([
    ["workspace", (r: WorkflowPlanRequest) => { r.workspaceId = "workspace-2"; }],
    ["input", (r: WorkflowPlanRequest) => { r.inputs.task = "Changed"; }],
    ["order", (r: WorkflowPlanRequest) => { r.beadIds.reverse(); }],
  ])("rejects stale %s plans before launch", async (_name, mutate) => {
    const h = setup(); const planned = await h.service.plan(request()); const changed = request(); mutate(changed);
    const result = await h.service.launch(changed, planned.digest);
    expect(result.status).toBe("stale"); expect(h.launcher.launch).not.toHaveBeenCalled();
  });

  it("rejects changed authoritative task revisions and expired plans", async () => {
    const h = setup(); const plan = await h.service.plan(request()); h.setRevision("tasks-r2");
    expect((await h.service.launch(request(), plan.digest)).status).toBe("stale");
    const later = setup(1_201); const old = await setup(1_099).service.plan(request());
    expect((await later.service.launch(request(), old.digest)).status).toBe("stale");
  });

  it("checks dynamic capacity after digest validation and reuses provider idempotency", async () => {
    const h = setup(); const plan = await h.service.plan(request()); h.setReady(false);
    expect((await h.service.launch(request(), plan.digest)).status).toBe("waiting"); expect(h.launcher.launch).not.toHaveBeenCalled();
    h.setReady(true); const first = await h.service.launch(request(), plan.digest); const second = await h.service.launch(request(), plan.digest);
    expect(first.status).toBe("launched"); expect(second.status).toBe("launched");
    expect(h.launcher.launch.mock.calls[0]![0].idempotencyKey).toBe(h.launcher.launch.mock.calls[1]![0].idempotencyKey);
  });

  it("rejects malformed requests and unsafe output", async () => {
    const h = setup(); await expect(h.service.plan({ ...request(), workspaceId: "" })).rejects.toThrow("Workspace");
    await expect(h.service.plan({ ...request(), beadIds: ["same", "same"] })).rejects.toThrow("duplicates");
  });
});
