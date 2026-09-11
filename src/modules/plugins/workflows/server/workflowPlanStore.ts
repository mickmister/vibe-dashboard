import { createHash, randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { DB } from "../../../../store/kysely_types";
import type { WorkflowPlan, WorkflowPlanPrincipal, WorkflowPlanRequest } from "./workflowPlanLaunchService";

export class WorkflowPlanConflictError extends Error {}
export class WorkflowPlanAuthorizationError extends Error {}

export class DbWorkflowPlanStore {
  constructor(private readonly options: { getDb: () => Promise<Kysely<DB>>; now?: () => number; leaseMs?: number; ownerId?: string }) {}

  async issue(principal: WorkflowPlanPrincipal, request: WorkflowPlanRequest, plan: WorkflowPlan): Promise<void> {
    const db = await this.options.getDb();
    const now = this.now();
    const requestJson = stableJson(request);
    const requestDigest = sha(requestJson);
    const planId = sha(`${principal.principalId}\0${principal.workspaceId}\0${plan.digest}`);
    const existing = await db.selectFrom("WorkflowIssuedPlan").selectAll().where("planId", "=", planId).executeTakeFirst();
    if (existing) {
      if (existing.requestDigest !== requestDigest || existing.callerSessionId !== (principal.callerSessionId ?? null)) throw new WorkflowPlanConflictError("The issued plan does not match this request.");
      return;
    }
    await db.transaction().execute(async (trx) => {
      const inserted = await trx.insertInto("WorkflowIssuedPlan").values({ planId, digest: plan.digest, principalId: principal.principalId, workspaceId: principal.workspaceId, callerSessionId: principal.callerSessionId ?? null, requestDigest, requestJson, planJson: stableJson(plan), status: "issued", expiresAt: plan.expiresAt, createdAt: now, updatedAt: now }).onConflict((conflict) => conflict.column("planId").doNothing()).executeTakeFirst();
      const row = await trx.selectFrom("WorkflowIssuedPlan").selectAll().where("planId", "=", planId).executeTakeFirstOrThrow();
      if (row.requestDigest !== requestDigest || row.callerSessionId !== (principal.callerSessionId ?? null)) throw new WorkflowPlanConflictError("The issued plan does not match this request.");
      if (Number(inserted.numInsertedOrUpdatedRows ?? 0) === 1) await trx.insertInto("WorkflowPlanAuditEvent").values({ auditId: randomUUID(), planId, principalId: principal.principalId, action: "issued", summary: "Plan issued.", createdAt: now }).execute();
    });
  }

  async requireIssued(principal: WorkflowPlanPrincipal, request: WorkflowPlanRequest, digest: string) {
    const db = await this.options.getDb();
    const row = await db.selectFrom("WorkflowIssuedPlan").selectAll().where("digest", "=", digest).where("principalId", "=", principal.principalId).where("workspaceId", "=", principal.workspaceId).executeTakeFirst();
    if (!row || row.callerSessionId !== (principal.callerSessionId ?? null)) throw new WorkflowPlanAuthorizationError("This plan was not issued for the current user and workspace.");
    if (row.requestDigest !== sha(stableJson(request))) throw new WorkflowPlanConflictError("The issued plan does not match this request.");
    if (row.status === "revoked") throw new WorkflowPlanConflictError("This plan was revoked.");
    if (row.status === "expired") throw new WorkflowPlanConflictError("This plan expired. Create a new plan.");
    if (row.status === "launched") return row;
    if (row.expiresAt <= this.now()) {
      const now = this.now();
      await db.transaction().execute(async (trx) => {
        const updated = await trx.updateTable("WorkflowIssuedPlan").set({ status: "expired", updatedAt: now }).where("planId", "=", row.planId).where("status", "=", "issued").executeTakeFirst();
        if (Number(updated.numUpdatedRows) === 1) await trx.insertInto("WorkflowPlanAuditEvent").values({ auditId: randomUUID(), planId: row.planId, principalId: principal.principalId, action: "expired", summary: "Plan expired.", createdAt: now }).execute();
      });
      throw new WorkflowPlanConflictError("This plan expired. Create a new plan.");
    }
    return row;
  }

  async revoke(planId: string, principalId: string): Promise<void> {
    const db = await this.options.getDb(); const now = this.now();
    const updated = await db.updateTable("WorkflowIssuedPlan").set({ status: "revoked", updatedAt: now }).where("planId", "=", planId).where("principalId", "=", principalId).where("status", "=", "issued").executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 1) await db.insertInto("WorkflowPlanAuditEvent").values({ auditId: randomUUID(), planId, principalId, action: "revoked", summary: "Plan revoked.", createdAt: now }).execute();
  }

  async claimLaunch(planId: string, operationKey: string, requestDigest: string): Promise<{ state: "claimed"; fence: number } | { state: "launched"; result: any } | { state: "pending" }> {
    const db = await this.options.getDb(); const now = this.now(); const owner = this.options.ownerId ?? "workflow-plan-service"; const until = now + (this.options.leaseMs ?? 30_000);
    return db.transaction().execute(async (trx) => {
      const inserted = await trx.insertInto("WorkflowPlanLaunchEffect").values({ operationKey, planId, requestDigest, status: "pending", leaseOwner: owner, leaseExpiresAt: until, fence: 1, resultJson: null, createdAt: now, updatedAt: now }).onConflict((conflict) => conflict.column("operationKey").doNothing()).executeTakeFirst();
      if (Number(inserted.numInsertedOrUpdatedRows ?? 0) === 1) {
        return { state: "claimed", fence: 1 } as const;
      }
      const existing = await trx.selectFrom("WorkflowPlanLaunchEffect").selectAll().where("operationKey", "=", operationKey).executeTakeFirstOrThrow();
      if (existing.planId !== planId || existing.requestDigest !== requestDigest) throw new WorkflowPlanConflictError("The start request conflicts with an earlier request.");
      if (existing.status === "launched" && existing.resultJson) return { state: "launched", result: JSON.parse(existing.resultJson) } as const;
      if ((existing.leaseExpiresAt ?? 0) > now) return { state: "pending" } as const;
      const fence = existing.fence + 1;
      await trx.updateTable("WorkflowPlanLaunchEffect").set({ leaseOwner: owner, leaseExpiresAt: until, fence, updatedAt: now }).where("operationKey", "=", operationKey).where("fence", "=", existing.fence).executeTakeFirstOrThrow();
      return { state: "claimed", fence } as const;
    });
  }

  async complete(planId: string, operationKey: string, fence: number, result: unknown): Promise<void> {
    const db = await this.options.getDb(); const now = this.now();
    await db.transaction().execute(async (trx) => {
      const updated = await trx.updateTable("WorkflowPlanLaunchEffect").set({ status: "launched", resultJson: stableJson(result), leaseOwner: null, leaseExpiresAt: null, updatedAt: now }).where("operationKey", "=", operationKey).where("fence", "=", fence).where("status", "=", "pending").executeTakeFirst();
      if (Number(updated.numUpdatedRows) !== 1) throw new WorkflowPlanConflictError("The start claim changed before completion.");
      await trx.updateTable("WorkflowIssuedPlan").set({ status: "launched", updatedAt: now }).where("planId", "=", planId).execute();
      const plan = await trx.selectFrom("WorkflowIssuedPlan").select(["principalId"]).where("planId", "=", planId).executeTakeFirstOrThrow();
      await trx.insertInto("WorkflowPlanAuditEvent").values({ auditId: randomUUID(), planId, principalId: plan.principalId, action: "launched", summary: "Plan started.", createdAt: now }).execute();
    });
  }

  async fail(operationKey: string, fence: number): Promise<void> {
    const db = await this.options.getDb(); await db.updateTable("WorkflowPlanLaunchEffect").set({ status: "failed", leaseOwner: null, leaseExpiresAt: null, updatedAt: this.now() }).where("operationKey", "=", operationKey).where("fence", "=", fence).execute();
  }
  private now() { return (this.options.now ?? Date.now)(); }
}

function stableJson(value: unknown): string { return JSON.stringify(canonical(value)); }
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])); return value; }
function sha(value: string): string { return createHash("sha256").update(value).digest("hex"); }
