import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { WorkflowPlanLaunchService, type WorkflowPlanRequest } from "./workflowPlanLaunchService";

const request = (): WorkflowPlanRequest => ({ workspaceId: "workspace-1", designId: "workflow-1", version: 2, inputs: { task: "Ship" }, roleBindings: { dev: { mode: "create", name: "Dev", model: "m" } }, beadIds: ["bead-1", "bead-2"] });
const compileInput = (): any => ({ workflow: { version: 2 }, inputs: { task: "Ship" } });

function setup(now = 1_000) {
  let revision = "tasks-r1";
  let ready = true;
  const effects = { workflows: 0, beads: 0, sessions: 0, messages: 0, worktrees: 0, capacity: 0, callbacks: 0, notifications: 0 };
  const source = { resolve: vi.fn(async (value: WorkflowPlanRequest) => ({ compileInput: { ...compileInput(), inputs: value.inputs }, workflowLabel: "Review work", tasks: value.beadIds.map((id) => ({ id, title: `Task ${id}`, structuralRevision: revision })), repositories: [{ id: "repo-a", accessRevision: "access-1", mode: "write" as const }], securityPolicyRevision: "policy-1" })) };
  const compiler = { compile: vi.fn(async (input: any) => { const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex"); return { schemaVersion: "vd.execution-bundle.v1" as const, digest, bytes: new Uint8Array(), document: {}, verificationEvidence: {} as any }; }) };
  const launcher = { checkDynamic: vi.fn(async () => ({ ready, message: ready ? undefined : "Capacity is currently full." })), reconcile: vi.fn(async () => ({ outcome: "not_found" as const })), launch: vi.fn(async ({ idempotencyKey }: any) => ({ runId: `run-${idempotencyKey.slice(0, 8)}`, status: "running", url: "/dashboard/workflows/run-1" })) };
  const issued = new Map<string, any>(); const effectsByKey = new Map<string, any>();
  const store = { issue: vi.fn(async (principal: any, req: any, plan: any) => { issued.set(plan.digest, { planId: plan.digest, planJson: JSON.stringify(plan), principal, req }); }), requireIssued: vi.fn(async (principal: any, req: any, digest: string) => { const row = issued.get(digest); if (!row || JSON.stringify(row.principal) !== JSON.stringify(principal) || JSON.stringify(row.req) !== JSON.stringify(req)) throw new Error("not issued"); return row; }), claimLaunch: vi.fn(async (_planId: string, key: string) => effectsByKey.has(key) ? { state: "launched", result: effectsByKey.get(key) } : { state: "claimed", fence: 1 }), complete: vi.fn(async (_planId: string, key: string, _fence: number, result: any) => { effectsByKey.set(key, result); }), fail: vi.fn() };
  const service = new WorkflowPlanLaunchService({ source, compiler, launcher, store: store as any, now: () => now, ttlMs: 100 });
  return { service, source, compiler, launcher, store, effects, setRevision: (v: string) => { revision = v; }, setReady: (v: boolean) => { ready = v; } };
}
const principal = (workspaceId = "workspace-1") => ({ principalId: "user-1", workspaceId, callerSessionId: null });

describe("digest-bound workflow planning", () => {
  it("plans without any launch or product side effect", async () => {
    const h = setup(); const plan = await h.service.plan(request(), principal());
    expect(plan).toMatchObject({ schemaVersion: "vd.workflow-plan.v1", workspaceId: "workspace-1", tasks: [{ id: "bead-1" }, { id: "bead-2" }] });
    expect(plan.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(h.launcher.checkDynamic).not.toHaveBeenCalled(); expect(h.launcher.launch).not.toHaveBeenCalled();
    expect(Object.values(h.effects)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it.each([
    ["workspace", (r: WorkflowPlanRequest) => { r.workspaceId = "workspace-2"; }],
    ["input", (r: WorkflowPlanRequest) => { r.inputs.task = "Changed"; }],
    ["order", (r: WorkflowPlanRequest) => { r.beadIds.reverse(); }],
  ])("rejects changed %s request against an issued plan", async (_name, mutate) => {
    const h = setup(); const planned = await h.service.plan(request(), principal()); const changed = request(); mutate(changed);
    await expect(h.service.launch(changed, planned.digest, principal(changed.workspaceId))).rejects.toThrow("not issued");
    expect(h.launcher.launch).not.toHaveBeenCalled();
  });

  it("rejects changed authoritative task revisions and expired plans", async () => {
    const h = setup(); const plan = await h.service.plan(request(), principal()); h.setRevision("tasks-r2");
    expect((await h.service.launch(request(), plan.digest, principal())).status).toBe("stale");
  });

  it("checks dynamic capacity after digest validation and reuses provider idempotency", async () => {
    const h = setup(); const plan = await h.service.plan(request(), principal()); h.setReady(false);
    expect((await h.service.launch(request(), plan.digest, principal())).status).toBe("waiting"); expect(h.launcher.launch).not.toHaveBeenCalled();
    h.setReady(true); const first = await h.service.launch(request(), plan.digest, principal()); const second = await h.service.launch(request(), plan.digest, principal());
    expect(first.status).toBe("launched"); expect(second.status).toBe("reused");
    expect(h.launcher.launch).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed requests and unsafe output", async () => {
    const h = setup(); await expect(h.service.plan({ ...request(), workspaceId: "" }, principal(""))).rejects.toThrow("Workspace");
    await expect(h.service.plan({ ...request(), beadIds: ["same", "same"] }, principal())).rejects.toThrow("duplicates");
    await expect(h.service.plan({ ...request(), additionalInstructions: "ignored" } as any, principal())).rejects.toThrow("unsupported");
    await expect(h.service.plan({ ...request(), roleBindings: { missing: { debug: "x" } as any } }, principal())).rejects.toThrow("not supported");
    await expect(h.service.plan({ ...request(), roleBindings: { dev: { mode: "existing", sessionId: "s", name: "forbidden" } } }, principal())).rejects.toThrow("only a session id");
    await expect(h.service.plan({ ...request(), roleBindings: { dev: { mode: "create", name: "Dev", sessionId: "forbidden" } } }, principal())).rejects.toThrow("only a session name");
  });

  it("blocks stale takeover when the durable provider outcome is unknown", async () => {
    const h = setup(); const plan = await h.service.plan(request(), principal());
    h.store.claimLaunch.mockResolvedValueOnce({ state: "reconcile_required" } as any);
    h.launcher.reconcile.mockResolvedValueOnce({ outcome: "unknown" } as any);
    const result = await h.service.launch(request(), plan.digest, principal());
    expect(result).toMatchObject({ status: "waiting", message: expect.stringContaining("cannot be confirmed") });
    expect(h.launcher.launch).not.toHaveBeenCalled();
  });

  it("reconciles a crash after provider effect without invoking the provider twice", async () => {
    const h = setup(); const plan = await h.service.plan(request(), principal());
    h.store.complete.mockRejectedValueOnce(new Error("database interrupted"));
    await expect(h.service.launch(request(), plan.digest, principal())).rejects.toThrow("interrupted");
    h.store.claimLaunch.mockResolvedValueOnce({ state: "reconcile_required" } as any).mockResolvedValueOnce({ state: "claimed", fence: 2 } as any);
    h.launcher.reconcile.mockResolvedValueOnce({ outcome: "found", run: { runId: "run-recovered", status: "running", url: "/dashboard/workflows/run-recovered" } } as any);
    await expect(h.service.launch(request(), plan.digest, principal())).resolves.toMatchObject({ status: "reused", run: { runId: "run-recovered" } });
    expect(h.launcher.launch).toHaveBeenCalledTimes(1);
  });
});
