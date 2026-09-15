import { createHash, randomUUID } from 'node:crypto';
import type { Kysely, Selectable, Updateable } from 'kysely';
import type { DB, WorkflowNativeGasCityRun } from '../../../../store/kysely_types';
import type { CompiledGasCityExecutionBundle } from './gasCityExecutionBundleCompiler';
import type { WorkflowNativeLaunchProvider, WorkflowPlan, WorkflowPlanRequest } from './workflowPlanLaunchService';

export type NativeGasCityRunStatus = 'preparing' | 'materializing' | 'ready' | 'turn_pending' | 'running' | 'completed' | 'blocked';

export interface NativeGasCityAuthoritativeState {
  workflowId: string;
  rootBeadId: string;
  sourceBeadId: string;
  status: 'ready' | 'running' | 'completed' | 'blocked';
}

/**
 * All mutating methods are ensure/reconcile operations, not create commands.
 * Implementations must use operationKey as the authoritative external
 * idempotency identity and return the existing effect after a restart.
 */
export interface NativeGasCityRuntime {
  health(): Promise<{ ready: boolean; message?: string }>;
  ensureBundle(input: { operationKey: string; bundle: CompiledGasCityExecutionBundle }): Promise<{ bundleRef: string }>;
  ensureWorkflow(input: { operationKey: string; bundleRef: string; sourceBeadId: string }): Promise<NativeGasCityAuthoritativeState>;
  reconcileWorkflow(input: { operationKey: string; bundleRef: string | null; sourceBeadId: string }): Promise<NativeGasCityAuthoritativeState | null | 'unknown'>;
  ensureRoleTurn(input: {
    operationKey: string;
    workspaceId: string;
    roleId: string;
    prompt: string;
    executor: string | null;
    model: string | null;
    reasoningId: string | null;
    binding: WorkflowPlanRequest['roleBindings'][string] | undefined;
  }): Promise<{ sessionId: string; queueItemRef: string }>;
  reconcileRoleTurn(operationKey: string): Promise<{ sessionId: string; queueItemRef: string } | null | 'unknown'>;
  readAuthoritativeState(input: { operationKey: string; workflowId: string; rootBeadId: string; sourceBeadId: string }): Promise<NativeGasCityAuthoritativeState>;
  ensureTypedResult(input: { operationKey: string; workflowId: string; rootBeadId: string; sourceBeadId: string; action: string; summary: string }): Promise<NativeGasCityAuthoritativeState>;
  ensureResultNote(input: { operationKey: string; sourceBeadId: string; summary: string }): Promise<{ noteRef: string }>;
  ensureTerminalCallback(input: { operationKey: string; request: WorkflowPlanRequest; run: NativeGasCityRunReadModel }): Promise<{ callbackRef: string | null }>;
}

export interface NativeGasCityRunReadModel {
  runId: string;
  workspaceId: string;
  sourceBeadId: string;
  status: NativeGasCityRunStatus;
  summary: string;
  url: string;
  workflowId: string | null;
  rootBeadId: string | null;
  sessionId: string | null;
  updatedAt: number;
}

export class NativeGasCityWorkflowProvider implements WorkflowNativeLaunchProvider {
  constructor(private readonly options: {
    getDb: () => Promise<Kysely<DB>> | Kysely<DB>;
    runtime: NativeGasCityRuntime;
    now?: () => number;
  }) {}

  async checkDynamic(plan: WorkflowPlan): Promise<{ ready: boolean; message?: string }> {
    if (plan.tasks.length !== 1) return { ready: false, message: 'Native workflow start currently supports one task.' };
    const health = await this.options.runtime.health();
    return health.ready ? { ready: true } : { ready: false, message: safeText(health.message || 'Workflow engine is not available.') };
  }

  async launch(input: { request: WorkflowPlanRequest; plan: WorkflowPlan; bundle: CompiledGasCityExecutionBundle; idempotencyKey: string }) {
    validateSingleTask(input);
    const requestDigest = digest({ request: input.request, plan: input.plan.digest, bundle: input.bundle.digest });
    let row = await this.reserve(input, requestDigest);
    if (row.requestDigest !== requestDigest || row.bundleDigest !== input.bundle.digest) throw new Error('This start identity belongs to a different confirmed plan.');
    if (row.status === 'completed' || row.status === 'running') return launchResult(row, true);

    try {
      if (!row.bundleRef) {
        row = await this.transition(row, 'materializing');
        const installed = await this.options.runtime.ensureBundle({ operationKey: input.idempotencyKey, bundle: input.bundle });
        row = await this.patch(row, { bundleRef: safeRef(installed.bundleRef) });
      }
      if (!row.workflowId) {
        const native = await this.options.runtime.ensureWorkflow({ operationKey: input.idempotencyKey, bundleRef: row.bundleRef!, sourceBeadId: row.sourceBeadId });
        assertNativeIdentity(native, row.sourceBeadId);
        row = await this.patch(row, { workflowId: safeRef(native.workflowId), rootBeadId: safeRef(native.rootBeadId), status: 'ready' });
      }
      const role = firstRole(input.bundle);
      if (!row.queueItemRef) {
        row = await this.transition(row, 'turn_pending');
        const turn = await this.ensureTurn(input, role, row);
        row = await this.patch(row, { sessionId: safeRef(turn.sessionId), queueItemRef: safeRef(turn.queueItemRef), status: 'running' });
      }
      return launchResult(row, row.attempts > 1);
    } catch (error) {
      await this.block(row, safeText(error instanceof Error ? error.message : String(error)));
      throw new Error('Native workflow start could not be confirmed. No replacement work was started.');
    }
  }

  async reconcile(idempotencyKey: string) {
    const db = await this.db();
    let row = await db.selectFrom('WorkflowNativeGasCityRun').selectAll().where('operationKey', '=', idempotencyKey).executeTakeFirst();
    if (!row) return { outcome: 'not_found' as const };
    if (row.status === 'running' || row.status === 'completed') return { outcome: 'found' as const, run: launchResult(row, true) };
    const native = await this.options.runtime.reconcileWorkflow({ operationKey: idempotencyKey, bundleRef: row.bundleRef, sourceBeadId: row.sourceBeadId });
    if (native === 'unknown') return { outcome: 'unknown' as const };
    if (!native) return row.status === 'preparing' ? { outcome: 'not_found' as const } : { outcome: 'unknown' as const };
    assertNativeIdentity(native, row.sourceBeadId);
    row = await this.patch(row, { workflowId: safeRef(native.workflowId), rootBeadId: safeRef(native.rootBeadId), status: native.status === 'completed' ? 'completed' : 'ready' });
    const turn = row.queueItemRef ? { sessionId: row.sessionId!, queueItemRef: row.queueItemRef } : await this.options.runtime.reconcileRoleTurn(idempotencyKey);
    if (turn === 'unknown') return { outcome: 'unknown' as const };
    if (turn) row = await this.patch(row, { sessionId: safeRef(turn.sessionId), queueItemRef: safeRef(turn.queueItemRef), status: 'running' });
    return row.status === 'running' || row.status === 'completed' ? { outcome: 'found' as const, run: launchResult(row, true) } : { outcome: 'unknown' as const };
  }

  /** Applies a VK final response exactly once. The runtime validator remains
   * authoritative; this boundary accepts only the bundle's generic decision XML. */
  async completeRoleTurn(input: { queueItemRef: string; responseRef: string; finalResponseText: string }): Promise<{ applied: boolean; run: NativeGasCityRunReadModel } | null> {
    const db = await this.db();
    let row = await db.selectFrom('WorkflowNativeGasCityRun').selectAll().where('queueItemRef', '=', input.queueItemRef).executeTakeFirst();
    if (!row) return null;
    if (row.resultRef) return { applied: false, run: readModel(row) };
    const result = parseDecision(input.finalResponseText, JSON.parse(row.allowedActionsJson) as string[]);
    const authoritative = await this.options.runtime.ensureTypedResult({ operationKey: `${row.operationKey}:typed-result`, workflowId: row.workflowId!, rootBeadId: row.rootBeadId!, sourceBeadId: row.sourceBeadId, action: result.action, summary: result.summary });
    assertNativeIdentity(authoritative, row.sourceBeadId);
    if (authoritative.status !== 'completed') {
      row = await this.patch(row, { status: 'blocked', summary: 'The workflow needs attention.' });
      return { applied: true, run: readModel(row) };
    }
    const note = await this.options.runtime.ensureResultNote({ operationKey: `${row.operationKey}:result-note`, sourceBeadId: row.sourceBeadId, summary: result.summary });
    row = await this.patch(row, { resultRef: safeRef(input.responseRef), noteRef: safeRef(note.noteRef), summary: safeText(result.summary), status: 'completed' });
    if (!row.callbackRef) {
      const callback = await this.options.runtime.ensureTerminalCallback({ operationKey: `${row.operationKey}:terminal-callback`, request: JSON.parse(row.requestJson) as WorkflowPlanRequest, run: readModel(row) });
      row = await this.patch(row, { callbackRef: callback.callbackRef ? safeRef(callback.callbackRef) : 'none' });
    }
    return { applied: true, run: readModel(row) };
  }

  async getRun(runId: string): Promise<NativeGasCityRunReadModel | null> {
    const row = await (await this.db()).selectFrom('WorkflowNativeGasCityRun').selectAll().where('runId', '=', runId).executeTakeFirst();
    return row ? readModel(row) : null;
  }

  private async ensureTurn(input: Parameters<NativeGasCityWorkflowProvider['launch']>[0], role: ReturnType<typeof firstRole>, row: Selectable<WorkflowNativeGasCityRun>) {
    const recovered = await this.options.runtime.reconcileRoleTurn(input.idempotencyKey);
    if (recovered === 'unknown') throw new Error('The earlier role turn outcome cannot be confirmed.');
    if (recovered) return recovered;
    return this.options.runtime.ensureRoleTurn({
      operationKey: input.idempotencyKey,
      workspaceId: input.request.workspaceId,
      roleId: role.roleId,
      prompt: buildPrompt(input.bundle, row.sourceBeadId),
      executor: role.executor,
      model: role.model,
      reasoningId: role.reasoningId,
      binding: input.request.roleBindings?.[role.roleId],
    });
  }

  private async reserve(input: Parameters<NativeGasCityWorkflowProvider['launch']>[0], requestDigest: string) {
    const db = await this.db(); const now = this.now(); const runId = `native_${input.idempotencyKey.slice(0, 24)}`;
    await db.insertInto('WorkflowNativeGasCityRun').values({ operationKey: input.idempotencyKey, runId, workspaceId: input.request.workspaceId, sourceBeadId: input.plan.tasks[0]!.id, requestDigest, bundleDigest: input.bundle.digest, requestJson: JSON.stringify(input.request), allowedActionsJson: JSON.stringify(bundleActions(input.bundle)), status: 'preparing', bundleRef: null, workflowId: null, rootBeadId: null, sessionId: null, queueItemRef: null, resultRef: null, noteRef: null, callbackRef: null, summary: 'Preparing workflow.', attempts: 1, createdAt: now, updatedAt: now }).onConflict((oc) => oc.column('operationKey').doUpdateSet({ attempts: (eb) => eb('attempts', '+', 1), updatedAt: now })).execute();
    return db.selectFrom('WorkflowNativeGasCityRun').selectAll().where('operationKey', '=', input.idempotencyKey).executeTakeFirstOrThrow();
  }
  private transition(row: Selectable<WorkflowNativeGasCityRun>, status: NativeGasCityRunStatus) { return this.patch(row, { status }); }
  private async patch(row: Selectable<WorkflowNativeGasCityRun>, values: Updateable<WorkflowNativeGasCityRun>) { const db = await this.db(); await db.updateTable('WorkflowNativeGasCityRun').set({ ...values, updatedAt: this.now() }).where('operationKey', '=', row.operationKey).execute(); return db.selectFrom('WorkflowNativeGasCityRun').selectAll().where('operationKey', '=', row.operationKey).executeTakeFirstOrThrow(); }
  private block(row: Selectable<WorkflowNativeGasCityRun>, summary: string) { return this.patch(row, { status: 'blocked', summary }); }
  private db() { return Promise.resolve(this.options.getDb()); }
  private now() { return (this.options.now ?? Date.now)(); }
}

function validateSingleTask(input: { request: WorkflowPlanRequest; plan: WorkflowPlan; bundle: CompiledGasCityExecutionBundle }) { if (input.plan.tasks.length !== 1 || input.request.beadIds.length !== 1) throw new Error('Native workflow start currently supports one task.'); const doc = input.bundle.document as any; if (!Array.isArray(doc?.formula?.intendedGraph?.nodes) || doc.formula.intendedGraph.nodes.length !== 1) throw new Error('Native workflow start currently supports one role turn.'); }
function firstRole(bundle: CompiledGasCityExecutionBundle): { roleId: string; executor: string | null; model: string | null; reasoningId: string | null; promptAssets?: Array<{content:string}>; skillAssets?: Array<{content:string}>; baseInstructions?: string } { const roles = (bundle.document as any).roles; if (!Array.isArray(roles) || roles.length !== 1) throw new Error('Native workflow start currently supports one resolved role.'); return roles[0]; }
function buildPrompt(bundle: CompiledGasCityExecutionBundle, beadId: string): string { const doc = bundle.document as any; const role = firstRole(bundle); const parts = [...(role.promptAssets ?? []).map((a: any) => a.content), ...(role.skillAssets ?? []).map((a: any) => a.content), role.baseInstructions].filter(Boolean); const schema = Object.values(doc.responseSchemas ?? {})[0]; return [...parts, `Task: ${safeRef(beadId)}`, typeof schema === 'string' ? schema : ''].filter(Boolean).join('\n\n'); }
function parseDecision(text: string, allowedActions: string[]): { action:string; summary: string } { if (!/^\s*<decision\b[\s\S]*<summary>[\s\S]*<\/summary>[\s\S]*<\/decision>\s*$/i.test(text)) throw new Error('The workflow response did not match the required decision contract.'); const action=text.match(/<decision\s+[^>]*action=["']([^"']+)["']/i)?.[1]??''; if(!allowedActions.includes(action)) throw new Error('The workflow response selected an unsupported decision.'); const match = text.match(/<summary>([\s\S]*?)<\/summary>/i); const summary = safeText((match?.[1] ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').trim()); if (!summary) throw new Error('The workflow response summary is required.'); return { action, summary }; }
function bundleActions(bundle:CompiledGasCityExecutionBundle):string[]{const definition=(bundle.document as any)?.workflow?.definition;const actions=Object.values(definition?.states??{}).flatMap((state:any)=>Array.isArray(state?.actions)?state.actions.map((a:any)=>a.name??a.id):[]).filter((v):v is string=>typeof v==='string');return [...new Set(actions)].sort();}
function assertNativeIdentity(state: NativeGasCityAuthoritativeState, sourceBeadId: string) { if (state.sourceBeadId !== sourceBeadId || !state.workflowId || !state.rootBeadId) throw new Error('Authoritative workflow identity did not match the confirmed task.'); }
function launchResult(row: Selectable<WorkflowNativeGasCityRun>, reused: boolean) { return { runId: row.runId, status: row.status, url: `/dashboard/workflows/${encodeURIComponent(row.runId)}?workspaceId=${encodeURIComponent(row.workspaceId)}`, reused }; }
function readModel(row: Selectable<WorkflowNativeGasCityRun>): NativeGasCityRunReadModel { return { runId: row.runId, workspaceId: safeRef(row.workspaceId), sourceBeadId: safeRef(row.sourceBeadId), status: row.status, summary: safeText(row.summary), url: launchResult(row, true).url, workflowId: row.workflowId ? safeRef(row.workflowId) : null, rootBeadId: row.rootBeadId ? safeRef(row.rootBeadId) : null, sessionId: row.sessionId ? safeRef(row.sessionId) : null, updatedAt: row.updatedAt }; }
function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function safeRef(value: string) { return value.trim().replace(/[^A-Za-z0-9_.:@-]/g, '-').slice(0, 180); }
function safeText(value: string) { return value.replace(/(?:\/Users|\/tmp|\/private\/var)\/\S+|\b(?:queue[_ -]?item|webhook|provider diagnostics|raw XML|raw JSON|stdout|stderr)\b/gi, 'details unavailable').slice(0, 500); }
