import { createHash, randomUUID } from 'node:crypto';
import type { Kysely, Selectable, Updateable } from 'kysely';
import type { DB, WorkflowNativeGasCityRun } from '../../../../store/kysely_types';
import type { CompiledGasCityExecutionBundle } from './gasCityExecutionBundleCompiler';
import type { WorkflowNativeLaunchProvider, WorkflowPlan, WorkflowPlanRequest } from './workflowPlanLaunchService';
import { normalizeWorkflowDefinitionV1 } from '@vibe-dashboard/workflow-core';
import { SimpleWorkflowXmlDecisionValidator } from './persistedWorkflowRuntime';

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
  checkTaskReady(input:{workspaceId:string;sourceBeadId:string}):Promise<{ready:boolean;message?:string}>;
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
  reconcileRoleTurn(input: Parameters<NativeGasCityRuntime['ensureRoleTurn']>[0]): Promise<{ sessionId: string; queueItemRef: string } | null | 'unknown'>;
  readAuthoritativeState(input: { operationKey: string; workflowId: string; rootBeadId: string; sourceBeadId: string }): Promise<NativeGasCityAuthoritativeState>;
  ensureTypedResult(input: { operationKey: string; workflowId: string; rootBeadId: string; sourceBeadId: string; action: string; summary: string }): Promise<NativeGasCityAuthoritativeState>;
  ensureResultNote(input: { operationKey: string; sourceBeadId: string; summary: string }): Promise<{ noteRef: string }>;
  ensureTerminalCallback(input: { operationKey: string; request: WorkflowPlanRequest; run: NativeGasCityRunReadModel }): Promise<{ callbackRef: string | null }>;
  reconcileEffect(input:{kind:string;request:any}):Promise<{outcome:'found';result:unknown}|{outcome:'absent'}|{outcome:'unknown'}>;
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
  private readonly ownerId = `native-provider-${randomUUID()}`;
  private readonly inFlight = new Map<string,{requestDigest:string;promise:Promise<unknown>}>();
  constructor(private readonly options: {
    getDb: () => Promise<Kysely<DB>> | Kysely<DB>;
    runtime: NativeGasCityRuntime;
    now?: () => number;
    effectLeaseMs?:number;
    effectHeartbeatMs?:number;
  }) {}

  async checkDynamic(plan: WorkflowPlan): Promise<{ ready: boolean; message?: string }> {
    if (plan.tasks.length !== 1) return { ready: false, message: 'Native workflow start currently supports one task.' };
    const health = await this.options.runtime.health();
    if(!health.ready)return {ready:false,message:safeText(health.message||'Workflow engine is not available.')};
    const task=await this.options.runtime.checkTaskReady({workspaceId:plan.workspaceId,sourceBeadId:plan.tasks[0]!.id});
    return task.ready?{ready:true}:{ready:false,message:safeText(task.message||'Task is not ready.')};
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
        const installed = await this.ensureEffect(row.runId,'bundle',{bundleDigest:input.bundle.digest},()=>this.options.runtime.ensureBundle({ operationKey: input.idempotencyKey, bundle: input.bundle }));
        row = await this.patch(row, { bundleRef: safeRef(installed.bundleRef) });
      }
      if (!row.workflowId) {
        const workflowRequest={operationKey:input.idempotencyKey,bundleRef:row.bundleRef!,sourceBeadId:row.sourceBeadId};
        const native = await this.ensureEffect(row.runId,'workflow',workflowRequest,()=>this.options.runtime.ensureWorkflow(workflowRequest));
        assertNativeIdentity(native, row.sourceBeadId);
        row = await this.patch(row, { workflowId: safeRef(native.workflowId), rootBeadId: safeRef(native.rootBeadId), status: 'ready' });
      }
      const role = firstRole(input.bundle);
      if (!row.queueItemRef) {
        row = await this.transition(row, 'turn_pending');
        const roleRequest=turnInput(input.idempotencyKey,input.request.workspaceId,input.request,role,buildPrompt(input.bundle,row.sourceBeadId));
        const turn = await this.ensureEffect(row.runId,'role_turn',roleRequest,()=>this.ensureTurn(input, role, row));
        row = await this.patch(row, { sessionId: safeRef(turn.sessionId), queueItemRef: safeRef(turn.queueItemRef), status: 'running' });
      }
      return launchResult(row, row.attempts > 1);
    } catch (error) {
      const message=error instanceof Error?error.message:String(error);
      if(!/already being reconciled|ownership changed/i.test(message))await this.block(row,safeText(message));
      throw new Error('Native workflow start could not be confirmed. No replacement work was started.');
    }
  }

  async reconcile(idempotencyKey: string) {
    const db = await this.db();
    let row = await db.selectFrom('WorkflowNativeGasCityRun').selectAll().where('operationKey', '=', idempotencyKey).executeTakeFirst();
    if (!row) return { outcome: 'not_found' as const };
    if (row.status === 'running' || row.status === 'completed') return { outcome: 'found' as const, run: launchResult(row, true) };
    const native = row.workflowId&&row.rootBeadId
      ? await this.options.runtime.readAuthoritativeState({operationKey:idempotencyKey,workflowId:row.workflowId,rootBeadId:row.rootBeadId,sourceBeadId:row.sourceBeadId})
      : await this.options.runtime.reconcileWorkflow({ operationKey: idempotencyKey, bundleRef: row.bundleRef, sourceBeadId: row.sourceBeadId });
    if (native === 'unknown') return { outcome: 'unknown' as const };
    if (!native) return row.status === 'preparing' ? { outcome: 'not_found' as const } : { outcome: 'unknown' as const };
    assertNativeIdentity(native, row.sourceBeadId);
    row = await this.patch(row, { workflowId: safeRef(native.workflowId), rootBeadId: safeRef(native.rootBeadId), status: native.status === 'completed' ? 'completed' : 'ready' });
    const request=JSON.parse(row.requestJson) as WorkflowPlanRequest;const role=firstRoleFromDefinition(row.definitionJson);
    const roleRequest=turnInput(idempotencyKey,row.workspaceId,request,role,buildPromptFromDefinition(row.definitionJson,row.sourceBeadId));
    let turn = row.queueItemRef ? { sessionId: row.sessionId!, queueItemRef: row.queueItemRef } : await this.options.runtime.reconcileRoleTurn(roleRequest);
    if (turn === 'unknown') return { outcome: 'unknown' as const };
    if (!turn) turn=await this.ensureEffect(row.runId,'role_turn',roleRequest,()=>this.options.runtime.ensureRoleTurn(roleRequest));
    if (turn) row = await this.patch(row, { sessionId: safeRef(turn.sessionId), queueItemRef: safeRef(turn.queueItemRef), status: 'running' });
    return row.status === 'running' || row.status === 'completed' ? { outcome: 'found' as const, run: launchResult(row, true) } : { outcome: 'unknown' as const };
  }

  /** Applies a VK final response exactly once. The runtime validator remains
   * authoritative; this boundary accepts only the bundle's generic decision XML. */
  async completeRoleTurn(input: { queueItemRef: string; responseRef: string; finalResponseText: string }): Promise<{ applied: boolean; run: NativeGasCityRunReadModel } | null> {
    const db = await this.db();
    let row = await db.selectFrom('WorkflowNativeGasCityRun').selectAll().where('queueItemRef', '=', input.queueItemRef).executeTakeFirst();
    if (!row) return null;
    const initialRow=row; let current:Selectable<WorkflowNativeGasCityRun>=row;
    if (current.resultRef) {current=await this.ensureCallback(current);return { applied: false, run: readModel(current) };}
    const result = validateDecision(input.finalResponseText,JSON.parse(row.definitionJson));
    const resultRequest={ operationKey: `${initialRow.operationKey}:typed-result`, workflowId: initialRow.workflowId!, rootBeadId: initialRow.rootBeadId!, sourceBeadId: initialRow.sourceBeadId, action: result.action, summary: result.summary,responseRef:input.responseRef};
    const authoritative = await this.ensureEffect(initialRow.runId,'typed_result',resultRequest,()=>this.options.runtime.ensureTypedResult(resultRequest));
    assertNativeIdentity(authoritative, initialRow.sourceBeadId);
    if (authoritative.status !== 'completed') {
      current = await this.patch(current, { status: 'blocked', summary: 'The workflow needs attention.' });
      return { applied: true, run: readModel(current) };
    }
    const noteRequest={ operationKey: `${current.operationKey}:result-note`, sourceBeadId: current.sourceBeadId, summary: result.summary };
    const note = await this.ensureEffect(current.runId,'result_note',noteRequest,()=>this.options.runtime.ensureResultNote(noteRequest));
    current = await this.patch(current, { resultRef: safeRef(input.responseRef), noteRef: safeRef(note.noteRef), summary: safeText(result.summary), status: 'completed' });
    current=await this.ensureCallback(current);
    return { applied: true, run: readModel(current) };
  }

  async getRun(runId: string, workspaceId?:string): Promise<NativeGasCityRunReadModel | null> {
    let query=(await this.db()).selectFrom('WorkflowNativeGasCityRun').selectAll().where('runId', '=', runId);if(workspaceId)query=query.where('workspaceId','=',workspaceId);
    const row = await query.executeTakeFirst();
    return row ? readModel(row) : null;
  }

  private async ensureTurn(input: Parameters<NativeGasCityWorkflowProvider['launch']>[0], role: ReturnType<typeof firstRole>, row: Selectable<WorkflowNativeGasCityRun>) {
    const roleTurnInput=turnInput(input.idempotencyKey,input.request.workspaceId,input.request,role,buildPrompt(input.bundle,row.sourceBeadId));
    const recovered = await this.options.runtime.reconcileRoleTurn(roleTurnInput);
    if (recovered === 'unknown') throw new Error('The earlier role turn outcome cannot be confirmed.');
    if (recovered) return recovered;
    return this.options.runtime.ensureRoleTurn(roleTurnInput);
  }
  private async ensureCallback(current:Selectable<WorkflowNativeGasCityRun>){if(current.callbackRef)return current;const callbackRequest={operationKey:`${current.operationKey}:terminal-callback`,request:JSON.parse(current.requestJson) as WorkflowPlanRequest,run:readModel(current)};const callback=await this.ensureEffect(current.runId,'terminal_callback',callbackRequest,()=>this.options.runtime.ensureTerminalCallback(callbackRequest));return this.patch(current,{callbackRef:callback.callbackRef?safeRef(callback.callbackRef):'none'});}

  private async reserve(input: Parameters<NativeGasCityWorkflowProvider['launch']>[0], requestDigest: string) {
    const db = await this.db(); const now = this.now(); const runId = `native_${input.idempotencyKey.slice(0, 24)}`;
    await db.insertInto('WorkflowNativeGasCityRun').values({ operationKey: input.idempotencyKey, runId, workspaceId: input.request.workspaceId, sourceBeadId: input.plan.tasks[0]!.id, requestDigest, bundleDigest: input.bundle.digest, requestJson: JSON.stringify(input.request), allowedActionsJson: JSON.stringify(bundleActions(input.bundle)),definitionJson:JSON.stringify((input.bundle.document as any).workflow.definition), status: 'preparing', bundleRef: null, workflowId: null, rootBeadId: null, sessionId: null, queueItemRef: null, resultRef: null, noteRef: null, callbackRef: null, summary: 'Preparing workflow.', attempts: 1, createdAt: now, updatedAt: now }).onConflict((oc) => oc.column('operationKey').doUpdateSet({ attempts: (eb) => eb('attempts', '+', 1), updatedAt: now })).execute();
    return db.selectFrom('WorkflowNativeGasCityRun').selectAll().where('operationKey', '=', input.idempotencyKey).executeTakeFirstOrThrow();
  }
  private transition(row: Selectable<WorkflowNativeGasCityRun>, status: NativeGasCityRunStatus) { return this.patch(row, { status }); }
  private async patch(row: Selectable<WorkflowNativeGasCityRun>, values: Updateable<WorkflowNativeGasCityRun>) { const db = await this.db(); await db.updateTable('WorkflowNativeGasCityRun').set({ ...values, updatedAt: this.now() }).where('operationKey', '=', row.operationKey).execute(); return db.selectFrom('WorkflowNativeGasCityRun').selectAll().where('operationKey', '=', row.operationKey).executeTakeFirstOrThrow(); }
  private block(row: Selectable<WorkflowNativeGasCityRun>, summary: string) { return this.patch(row, { status: 'blocked', summary }); }
  private ensureEffect<T>(runId:string,kind:string,request:unknown,perform:()=>Promise<T>):Promise<T>{const key=`${runId}:${kind}`,requestDigest=digest(request);const active=this.inFlight.get(key);if(active){if(active.requestDigest!==requestDigest)return Promise.reject(new Error('Native workflow effect identity conflict.'));return active.promise as Promise<T>;}const promise=this.ensureEffectInternal(runId,kind,request,perform).finally(()=>this.inFlight.delete(key));this.inFlight.set(key,{requestDigest,promise});return promise;}
  private async ensureEffectInternal<T>(runId:string,kind:string,request:unknown,perform:()=>Promise<T>):Promise<T>{
    const db=await this.db(),now=this.now(),requestDigest=digest(request),leaseMs=this.options.effectLeaseMs??60_000,expires=now+leaseMs;
    await db.insertInto('WorkflowNativeGasCityEffect').values({runId,kind,requestDigest,status:'pending',leaseOwner:this.ownerId,leaseExpiresAt:expires,fence:1,resultJson:null,lastError:null,createdAt:now,updatedAt:now}).onConflict((oc)=>oc.columns(['runId','kind']).doNothing()).execute();
    let row=await db.selectFrom('WorkflowNativeGasCityEffect').selectAll().where('runId','=',runId).where('kind','=',kind).executeTakeFirstOrThrow();
    if(row.requestDigest!==requestDigest)throw new Error('Native workflow effect identity conflict.');
    if(row.status==='completed'&&row.resultJson)return JSON.parse(row.resultJson) as T;
    if(row.leaseOwner!==this.ownerId){
      if((row.leaseExpiresAt??0)>now)throw new Error('Native workflow effect is already being reconciled.');
      const reconciliation=await this.options.runtime.reconcileEffect({kind,request});
      if(reconciliation.outcome==='unknown')throw new Error('Native workflow effect outcome cannot be confirmed.');
      if(reconciliation.outcome==='found'){
        const recovered=await db.updateTable('WorkflowNativeGasCityEffect').set({status:'completed',resultJson:JSON.stringify(reconciliation.result),leaseOwner:null,leaseExpiresAt:null,updatedAt:now}).where('runId','=',runId).where('kind','=',kind).where('status','=','pending').where('fence','=',row.fence).executeTakeFirst();
        if(Number(recovered.numUpdatedRows)!==1)throw new Error('Native workflow effect is already being reconciled.');
        return reconciliation.result as T;
      }
      const claimed=await db.updateTable('WorkflowNativeGasCityEffect').set({leaseOwner:this.ownerId,leaseExpiresAt:expires,fence:row.fence+1,updatedAt:now}).where('runId','=',runId).where('kind','=',kind).where('status','=','pending').where('fence','=',row.fence).where('leaseExpiresAt','<=',now).executeTakeFirst();
      if(Number(claimed.numUpdatedRows)!==1)throw new Error('Native workflow effect is already being reconciled.');
      row=await db.selectFrom('WorkflowNativeGasCityEffect').selectAll().where('runId','=',runId).where('kind','=',kind).executeTakeFirstOrThrow();
    }
    let lost=false;const heartbeat=setInterval(()=>{void this.db().then((heartbeatDb)=>heartbeatDb.updateTable('WorkflowNativeGasCityEffect').set({leaseExpiresAt:this.now()+leaseMs,updatedAt:this.now()}).where('runId','=',runId).where('kind','=',kind).where('status','=','pending').where('leaseOwner','=',this.ownerId).where('fence','=',row.fence).executeTakeFirst()).then((updated)=>{if(Number(updated.numUpdatedRows)!==1)lost=true;}).catch(()=>{lost=true;});},this.options.effectHeartbeatMs??15_000);heartbeat.unref?.();
    let result:T;try{result=await perform();}finally{clearInterval(heartbeat);}
    if(lost)throw new Error('Native workflow effect ownership changed before completion.');
    const completed=await db.updateTable('WorkflowNativeGasCityEffect').set({status:'completed',resultJson:JSON.stringify(result),leaseOwner:null,leaseExpiresAt:null,updatedAt:this.now()}).where('runId','=',runId).where('kind','=',kind).where('status','=','pending').where('leaseOwner','=',this.ownerId).where('fence','=',row.fence).executeTakeFirst();
    if(Number(completed.numUpdatedRows)!==1)throw new Error('Native workflow effect ownership changed before completion.');
    return result;
  }
  private db() { return Promise.resolve(this.options.getDb()); }
  private now() { return (this.options.now ?? Date.now)(); }
}

function validateSingleTask(input: { request: WorkflowPlanRequest; plan: WorkflowPlan; bundle: CompiledGasCityExecutionBundle }) { if (input.plan.tasks.length !== 1 || input.request.beadIds.length !== 1) throw new Error('Native workflow start currently supports one task.'); const doc = input.bundle.document as any; if (!Array.isArray(doc?.formula?.intendedGraph?.nodes) || doc.formula.intendedGraph.nodes.length !== 1) throw new Error('Native workflow start currently supports one role turn.'); }
function firstRole(bundle: CompiledGasCityExecutionBundle): { roleId: string; executor: string | null; model: string | null; reasoningId: string | null; promptAssets?: Array<{content:string}>; skillAssets?: Array<{content:string}>; baseInstructions?: string } { const roles = (bundle.document as any).roles; if (!Array.isArray(roles) || roles.length !== 1) throw new Error('Native workflow start currently supports one resolved role.'); return roles[0]; }
function buildPrompt(bundle: CompiledGasCityExecutionBundle, beadId: string): string { const doc = bundle.document as any; const role = firstRole(bundle); const parts = [...(role.promptAssets ?? []).map((a: any) => a.content), ...(role.skillAssets ?? []).map((a: any) => a.content), role.baseInstructions].filter(Boolean); const schema = Object.values(doc.responseSchemas ?? {})[0]; return [...parts, `Task: ${safeRef(beadId)}`, typeof schema === 'string' ? schema : ''].filter(Boolean).join('\n\n'); }
function firstRoleFromDefinition(definitionJson:string):ReturnType<typeof firstRole>{const definition=JSON.parse(definitionJson);const entry=Object.entries((definition as any).roles??{})[0] as [string,any]|undefined;if(!entry)throw new Error('The workflow role could not be restored.');const [key,role]=entry;return{roleId:role.id??role.roleId??key,executor:role.executor??null,model:role.model??null,reasoningId:role.reasoningId??null,baseInstructions:role.prompt??''};}
function buildPromptFromDefinition(definitionJson:string,beadId:string){const role=firstRoleFromDefinition(definitionJson);return[role.baseInstructions,`Task: ${safeRef(beadId)}`].filter(Boolean).join('\n\n');}
function turnInput(operationKey:string,workspaceId:string,request:WorkflowPlanRequest,role:ReturnType<typeof firstRole>,prompt:string){return{operationKey,workspaceId,roleId:role.roleId,prompt,executor:role.executor,model:role.model,reasoningId:role.reasoningId,binding:request.roleBindings?.[role.roleId]};}
function validateDecision(text:string,definition:unknown):{action:string;summary:string}{
  strictXmlShape(text);const model=normalizeWorkflowDefinitionV1(definition,{workflowId:'native'});const state=Object.values(model.states).find((s)=>!s.terminal&&s.steps.some((step:any)=>step.type==='agent_turn'&&step.turnType==='decision'));if(!state||state.terminal)throw new Error('The compiled workflow has no decision contract.');const validation=new SimpleWorkflowXmlDecisionValidator().validate({actions:state.actions,responseText:text,rawXmlMaxChars:1_000_000});if(!validation.valid||!validation.action||!validation.parsed||(validation.unknownFields?.length??0)>0)throw new Error('The workflow response did not match the compiled decision contract.');const selectedAction=validation.action as string;const action=state.actions[selectedAction];if(!action)throw new Error('The workflow response selected an unsupported decision.');const target=model.states[action.targetState];if(!target||!target.terminal)throw new Error('The native workflow decision must be terminal.');const summary=validation.parsed.summary;if(typeof summary!=='string'||!summary.trim())throw new Error('The workflow response summary is required.');return{action:selectedAction,summary:safeText(summary.trim())};
}
function strictXmlShape(text:string){const trimmed=text.trim();if(/<!DOCTYPE|<\?|<!--/i.test(trimmed))throw new Error('The workflow response contains unsupported XML.');const root=trimmed.match(/^<decision\s+action=(['"])([A-Za-z_][A-Za-z0-9_.-]*)\1>([\s\S]*)<\/decision>$/);if(!root)throw new Error('The workflow response did not match the required decision contract.');const body=root[3]??'';const tags=[...body.matchAll(/<([A-Za-z_][A-Za-z0-9_.-]*)>([\s\S]*?)<\/\1>/g)];if(tags.map(m=>m[0]).join('')!==body.replace(/\s+/g,'')&&tags.map(m=>m[0].replace(/\s+/g,'')).join('')!==body.replace(/\s+/g,''))throw new Error('The workflow response contains malformed or nested content.');const names=tags.map(m=>m[1]);if(new Set(names).size!==names.length)throw new Error('The workflow response contains duplicate fields.');}
function bundleActions(bundle:CompiledGasCityExecutionBundle):string[]{const definition=(bundle.document as any)?.workflow?.definition;const actions=Object.values(definition?.states??{}).flatMap((state:any)=>Array.isArray(state?.actions)?state.actions.map((a:any)=>a.name??a.id):[]).filter((v):v is string=>typeof v==='string');return [...new Set(actions)].sort();}
function assertNativeIdentity(state: NativeGasCityAuthoritativeState, sourceBeadId: string) { if (state.sourceBeadId !== sourceBeadId || !state.workflowId || !state.rootBeadId) throw new Error('Authoritative workflow identity did not match the confirmed task.'); }
function launchResult(row: Selectable<WorkflowNativeGasCityRun>, reused: boolean) { return { runId: row.runId, status: row.status, url: `/dashboard/workflows/${encodeURIComponent(row.runId)}?workspaceId=${encodeURIComponent(row.workspaceId)}`, reused }; }
function readModel(row: Selectable<WorkflowNativeGasCityRun>): NativeGasCityRunReadModel { return { runId: row.runId, workspaceId: safeRef(row.workspaceId), sourceBeadId: safeRef(row.sourceBeadId), status: row.status, summary: safeText(row.summary), url: launchResult(row, true).url, workflowId: row.workflowId ? safeRef(row.workflowId) : null, rootBeadId: row.rootBeadId ? safeRef(row.rootBeadId) : null, sessionId: row.sessionId ? safeRef(row.sessionId) : null, updatedAt: row.updatedAt }; }
function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function safeRef(value:string){const trimmed=value.trim();if(!/^[A-Za-z0-9_.:@-]{1,180}$/.test(trimmed))throw new Error('Workflow identity is invalid.');return trimmed;}
function safeText(value: string) { return value.replace(/(?:\/Users|\/home|\/workspace|\/tmp|\/private\/var)\/\S+|\b(?:queue[_ -]?item|webhook|provider diagnostics|raw XML|raw JSON|stdout|stderr|gc|bd|git|shell)\b/gi, 'details unavailable').slice(0, 500); }
