import { afterEach, describe, expect, it } from "vitest";
import { initVdDb, type VdDbHandle } from "../../../../server/database";
import { DbWorkflowPlanStore } from "./workflowPlanStore";

const request: any = { workspaceId: "ws-1", designId: "d-1", version: 1, inputs: {}, roleBindings: {}, beadIds: ["b-1"], completionResponse: null };
const plan: any = { schemaVersion: "vd.workflow-plan.v1", digest: "a".repeat(64), bundleDigest: "b".repeat(64), workspaceId: "ws-1", workflow: { designId: "d-1", version: 1, label: "Test" }, tasks: [], repositories: [], summary: "One task.", expiresAt: 2_000 };
const principal = { principalId: "user-1", workspaceId: "ws-1", callerSessionId: null };

describe("DbWorkflowPlanStore", () => {
  let handle: VdDbHandle;
  afterEach(async () => { if (handle) { await handle.db.destroy(); handle.sqlite.close(); } });

  it("binds issuance to principal, workspace, caller, request, and expiry", async () => {
    handle = await initVdDb({ path: ":memory:" }); let now = 1_000;
    const store = new DbWorkflowPlanStore({ getDb: async () => handle.db, now: () => now });
    await store.issue(principal, request, plan);
    await expect(store.requireIssued(principal, request, plan.digest)).resolves.toMatchObject({ status: "issued" });
    await expect(store.requireIssued({ ...principal, principalId: "user-2" }, request, plan.digest)).rejects.toThrow("not issued");
    await expect(store.requireIssued(principal, { ...request, inputs: { changed: true } }, plan.digest)).rejects.toThrow("does not match");
    const active = await store.requireIssued(principal, request, plan.digest);
    await store.revoke(active.planId, principal.principalId);
    await expect(store.requireIssued(principal, request, plan.digest)).rejects.toThrow("revoked");
    await store.issue(principal, request, { ...plan, digest: "c".repeat(64), expiresAt: 2_000 });
    now = 2_001;
    await expect(store.requireIssued(principal, request, "c".repeat(64))).rejects.toThrow("expired");
  });

  it("records one durable launch effect and rejects conflicting identities", async () => {
    handle = await initVdDb({ path: ":memory:" });
    const store = new DbWorkflowPlanStore({ getDb: async () => handle.db, now: () => 1_000, ownerId: "one" });
    await store.issue(principal, request, plan);
    const row = await store.requireIssued(principal, request, plan.digest);
    const claim = await store.claimLaunch(row.planId, "op-1", "request-1");
    expect(claim).toEqual({ state: "claimed", fence: 1 });
    await store.complete(row.planId, "op-1", 1, { runId: "run-1", status: "running", url: "/dashboard/workflows/run-1" });
    await expect(store.claimLaunch(row.planId, "op-1", "request-1")).resolves.toMatchObject({ state: "launched", result: { runId: "run-1" } });
    await expect(store.claimLaunch(row.planId, "op-1", "different")).rejects.toThrow("conflicts");
    expect(await handle.db.selectFrom("WorkflowPlanAuditEvent").selectAll().execute()).toHaveLength(2);
  });

  it("serializes concurrent instances and permits reconciliation after lease expiry", async () => {
    handle = await initVdDb({ path: ":memory:" }); let now = 1_000;
    const one = new DbWorkflowPlanStore({ getDb: async () => handle.db, now: () => now, ownerId: "one", leaseMs: 10 });
    const two = new DbWorkflowPlanStore({ getDb: async () => handle.db, now: () => now, ownerId: "two", leaseMs: 10 });
    await one.issue(principal, request, plan); const row = await one.requireIssued(principal, request, plan.digest);
    expect(await one.claimLaunch(row.planId, "op", "req")).toMatchObject({ state: "claimed" });
    expect(await two.claimLaunch(row.planId, "op", "req")).toEqual({ state: "pending" });
    now = 1_011;
    expect(await two.claimLaunch(row.planId, "op", "req")).toMatchObject({ state: "claimed", fence: 2 });
  });
});
