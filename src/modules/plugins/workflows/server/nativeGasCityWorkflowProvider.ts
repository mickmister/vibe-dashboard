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

export const NATIVE_ROLE_TURN_SCHEMA = 'vd.native-role-turn.v1' as const;
export interface NativeRoleTurnRequestV1 {
  schemaVersion: typeof NATIVE_ROLE_TURN_SCHEMA;
  operationKey: string;
  workspaceId: string;
  roleId: string;
  prompt: string;
  promptComposition: {
    roleTemplate: null | { id: string; version: number; content: string; contentHash: string };
    promptAssets: Array<{ id: string; version: number; content: string; contentHash: string }>;
    skillAssets: Array<{ id: string; version: number; content: string; contentHash: string }>;
    baseInstructions: string;
    decision: { stateId: string; stepId: string; authoredPrompt: string };
    generatedXsd: string;
    taskContext: { tasks: Array<{ id: string; title: string }>; inputs: Record<string, unknown> };
  };
  executor: string | null;
  model: string | null;
  reasoningId: string | null;
  preferenceSources: { executor: string; model: string; reasoningId: string };
  binding: WorkflowPlanRequest['roleBindings'][string];
  queue: {
    operationKey: string;
    source: 'workflow';
    priority: 60;
    sessionCommand: null;
    provenance: { kind: 'workflow'; label: string; workflow_run_id: string; workflow_role_id: string };
  };
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
  ensureRoleTurn(input: NativeRoleTurnRequestV1): Promise<{ sessionId: string; queueItemRef: string }>;
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
    const roleTurn = buildRoleTurnRequest(input);
    let row = await this.reserve(input, requestDigest, roleTurn);
    if (row.requestDigest !== requestDigest || row.bundleDigest !== input.bundle.digest) throw new Error('This start identity belongs to a different confirmed plan.');
    const persistedRoleTurn = readStoredRoleTurn(row);
    if (canonicalJson(persistedRoleTurn) !== canonicalJson(roleTurn)) throw new Error('This start identity belongs to a different resolved role turn.');
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
      if (!row.queueItemRef) {
        row = await this.transition(row, 'turn_pending');
        const turn = await this.ensureEffect(row.runId,'role_turn',persistedRoleTurn,()=>this.ensureTurn(persistedRoleTurn));
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
    // Validate the immutable role-turn envelope on every recovery read, even
    // when the run already looks terminal. A status flag must never let a
    // corrupted or incompatible request become trusted recovery input.
    const roleRequest = readStoredRoleTurn(row);
    if (row.status === 'running' || row.status === 'completed') return { outcome: 'found' as const, run: launchResult(row, true) };
    const native = row.workflowId&&row.rootBeadId
      ? await this.options.runtime.readAuthoritativeState({operationKey:idempotencyKey,workflowId:row.workflowId,rootBeadId:row.rootBeadId,sourceBeadId:row.sourceBeadId})
      : await this.options.runtime.reconcileWorkflow({ operationKey: idempotencyKey, bundleRef: row.bundleRef, sourceBeadId: row.sourceBeadId });
    if (native === 'unknown') return { outcome: 'unknown' as const };
    if (!native) return row.status === 'preparing' ? { outcome: 'not_found' as const } : { outcome: 'unknown' as const };
    assertNativeIdentity(native, row.sourceBeadId);
    row = await this.patch(row, { workflowId: safeRef(native.workflowId), rootBeadId: safeRef(native.rootBeadId), status: native.status === 'completed' ? 'completed' : 'ready' });
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

  private async ensureTurn(roleTurnInput: NativeRoleTurnRequestV1) {
    const recovered = await this.options.runtime.reconcileRoleTurn(roleTurnInput);
    if (recovered === 'unknown') throw new Error('The earlier role turn outcome cannot be confirmed.');
    if (recovered) return recovered;
    return this.options.runtime.ensureRoleTurn(roleTurnInput);
  }
  private async ensureCallback(current:Selectable<WorkflowNativeGasCityRun>){if(current.callbackRef)return current;const callbackRequest={operationKey:`${current.operationKey}:terminal-callback`,request:JSON.parse(current.requestJson) as WorkflowPlanRequest,run:readModel(current)};const callback=await this.ensureEffect(current.runId,'terminal_callback',callbackRequest,()=>this.options.runtime.ensureTerminalCallback(callbackRequest));return this.patch(current,{callbackRef:callback.callbackRef?safeRef(callback.callbackRef):'none'});}

  private async reserve(input: Parameters<NativeGasCityWorkflowProvider['launch']>[0], requestDigest: string, roleTurn: NativeRoleTurnRequestV1) {
    const db = await this.db(); const now = this.now(); const runId = `native_${input.idempotencyKey.slice(0, 24)}`;
    const roleTurnRequestJson=canonicalJson(roleTurn),roleTurnRequestDigest=sha256(roleTurnRequestJson);
    await db.insertInto('WorkflowNativeGasCityRun').values({ operationKey: input.idempotencyKey, runId, workspaceId: input.request.workspaceId, sourceBeadId: input.plan.tasks[0]!.id, requestDigest, bundleDigest: input.bundle.digest, requestJson: JSON.stringify(input.request), allowedActionsJson: JSON.stringify(bundleActions(input.bundle)),definitionJson:JSON.stringify((input.bundle.document as any).workflow.definition),roleTurnSchemaVersion:NATIVE_ROLE_TURN_SCHEMA,roleTurnRequestJson,roleTurnRequestDigest, status: 'preparing', bundleRef: null, workflowId: null, rootBeadId: null, sessionId: null, queueItemRef: null, resultRef: null, noteRef: null, callbackRef: null, summary: 'Preparing workflow.', attempts: 1, createdAt: now, updatedAt: now }).onConflict((oc) => oc.column('operationKey').doUpdateSet({ attempts: (eb) => eb('attempts', '+', 1), updatedAt: now })).execute();
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

function validateSingleTask(input: { request: WorkflowPlanRequest; plan: WorkflowPlan; bundle: CompiledGasCityExecutionBundle }) { if (input.plan.tasks.length !== 1 || input.request.beadIds.length !== 1) throw new Error('Native workflow start currently supports one task.'); const doc = input.bundle.document as any; if (!Array.isArray(doc?.formula?.intendedGraph) || doc.formula.intendedGraph.length !== 1) throw new Error('Native workflow start currently supports one role turn.'); }
function firstRole(bundle: CompiledGasCityExecutionBundle): { roleId: string; executor: string | null; model: string | null; reasoningId: string | null; promptAssets?: Array<{content:string}>; skillAssets?: Array<{content:string}>; baseInstructions?: string } { const roles = (bundle.document as any).roles; if (!Array.isArray(roles) || roles.length !== 1) throw new Error('Native workflow start currently supports one resolved role.'); return roles[0]; }
function buildRoleTurnRequest(input:{request:WorkflowPlanRequest;plan:WorkflowPlan;bundle:CompiledGasCityExecutionBundle;idempotencyKey:string}):NativeRoleTurnRequestV1{
  const doc=input.bundle.document as any,role=firstRole(input.bundle) as any,binding=input.request.roleBindings?.[role.roleId];if(!binding)throw new Error('The confirmed role session setting is missing.');
  const graphNodes=doc?.formula?.intendedGraph;if(!Array.isArray(graphNodes)||graphNodes.length!==1)throw new Error('The compiled workflow decision selection is invalid.');const stateId=graphNodes[0]?.stateId;if(typeof stateId!=='string')throw new Error('The compiled workflow state selection is missing.');
  const state=doc?.workflow?.definition?.states?.[stateId],decisionSteps=Array.isArray(state?.steps)?state.steps.filter((step:any)=>step?.type==='agent_turn'&&step?.turnType==='decision'):[];if(decisionSteps.length!==1)throw new Error('The selected workflow state must contain exactly one decision step.');const step=decisionSteps[0],stepId=step?.id,authoredPrompt=step?.prompt?.template;if(typeof stepId!=='string'||typeof authoredPrompt!=='string'||!authoredPrompt.trim())throw new Error('The selected workflow decision prompt is missing.');if(state?.owner!==role.roleId)throw new Error('The selected workflow decision role does not match the resolved role.');
  const schemas=doc.responseSchemas;if(!Array.isArray(schemas))throw new Error('The compiled response schemas are invalid.');const matching=schemas.filter((entry:any)=>entry?.stateId===stateId&&entry?.stepId===stepId);if(schemas.length!==1||matching.length!==1||typeof matching[0]?.xsd!=='string'||!matching[0].xsd.trim())throw new Error(matching.length>1?'The compiled response schema is duplicated.':'The compiled response schema is missing or mismatched.');if(schemas.some((entry:any)=>!entry||typeof entry!=='object'||Object.keys(entry).sort().join('|')!=='stateId|stepId|xsd'||typeof entry.stateId!=='string'||typeof entry.stepId!=='string'||typeof entry.xsd!=='string'))throw new Error('The compiled response schemas are invalid.');const generatedXsd=matching[0].xsd;
  const promptAssets=structuredClone(role.promptAssets??[]),skillAssets=structuredClone(role.skillAssets??[]),roleTemplate=role.template?structuredClone(role.template):null,baseInstructions=String(role.baseInstructions??'');
  const taskContext={tasks:input.plan.tasks.map((task)=>({id:task.id,title:task.title})),inputs:structuredClone((doc.inputs??input.request.inputs) as Record<string,unknown>)};
  const promptComposition={roleTemplate,promptAssets,skillAssets,baseInstructions,decision:{stateId,stepId,authoredPrompt},generatedXsd,taskContext};const prompt=renderCanonicalRolePrompt(promptComposition);
  return{schemaVersion:NATIVE_ROLE_TURN_SCHEMA,operationKey:input.idempotencyKey,workspaceId:input.request.workspaceId,roleId:role.roleId,prompt,promptComposition,executor:role.executor??null,model:role.model??null,reasoningId:role.reasoningId??null,preferenceSources:structuredClone(role.preferenceSources??{executor:'unset',model:'unset',reasoningId:'unset'}),binding:canonicalBinding(binding),queue:{operationKey:`native-turn:${input.idempotencyKey}`,source:'workflow',priority:60,sessionCommand:null,provenance:{kind:'workflow',label:'Native workflow role turn',workflow_run_id:input.idempotencyKey,workflow_role_id:role.roleId}}};
}
function canonicalBinding(binding:WorkflowPlanRequest['roleBindings'][string]){if(binding.mode==='existing')return{mode:'existing' as const,sessionId:String(binding.sessionId)};return{mode:binding.mode,name:String(binding.name),...(binding.executorType?{executorType:binding.executorType}:{}),...(binding.model?{model:binding.model}:{}),...(binding.reasoningId?{reasoningId:binding.reasoningId}:{})};}
function readStoredRoleTurn(row:Selectable<WorkflowNativeGasCityRun>):NativeRoleTurnRequestV1{if(row.roleTurnSchemaVersion!==NATIVE_ROLE_TURN_SCHEMA||!row.roleTurnRequestJson||!row.roleTurnRequestDigest)throw new Error('This native run predates the supported durable role-turn contract.');if(sha256(row.roleTurnRequestJson)!==row.roleTurnRequestDigest)throw new Error('The durable role-turn request is corrupted.');let value:unknown;try{value=JSON.parse(row.roleTurnRequestJson);}catch{throw new Error('The durable role-turn request is corrupted.');}validateStoredRoleTurn(value);if(canonicalJson(value)!==row.roleTurnRequestJson)throw new Error('The durable role-turn request is not canonical.');const request=value as NativeRoleTurnRequestV1;if(request.operationKey!==row.operationKey||request.workspaceId!==row.workspaceId||request.promptComposition.taskContext.tasks.length!==1||request.promptComposition.taskContext.tasks[0]?.id!==row.sourceBeadId)throw new Error('The durable role-turn request identity conflicts with the native run.');return request;}
function validateStoredRoleTurn(value:unknown):void{
  try{
    exact(value,['schemaVersion','operationKey','workspaceId','roleId','prompt','promptComposition','executor','model','reasoningId','preferenceSources','binding','queue']);const v=value as any;
    if(v.schemaVersion!==NATIVE_ROLE_TURN_SCHEMA)throw 0;for(const key of ['operationKey','workspaceId','roleId','prompt'] as const)nonempty(v[key]);nullableString(v.executor);nullableString(v.model);nullableString(v.reasoningId);if(v.executor===null&&(v.model!==null||v.reasoningId!==null))throw 0;
    exact(v.promptComposition,['roleTemplate','promptAssets','skillAssets','baseInstructions','decision','generatedXsd','taskContext']);nullableAsset(v.promptComposition.roleTemplate);assetArray(v.promptComposition.promptAssets);assetArray(v.promptComposition.skillAssets);nonempty(v.promptComposition.baseInstructions,true);nonempty(v.promptComposition.generatedXsd);exact(v.promptComposition.decision,['stateId','stepId','authoredPrompt']);nonempty(v.promptComposition.decision.stateId);nonempty(v.promptComposition.decision.stepId);nonempty(v.promptComposition.decision.authoredPrompt);exact(v.promptComposition.taskContext,['tasks','inputs']);if(!Array.isArray(v.promptComposition.taskContext.tasks)||v.promptComposition.taskContext.tasks.length!==1)throw 0;for(const task of v.promptComposition.taskContext.tasks){exact(task,['id','title']);nonempty(task.id);nonempty(task.title);}if(!plain(v.promptComposition.taskContext.inputs))throw 0;
    exact(v.preferenceSources,['executor','model','reasoningId']);const sources=new Set(['launch_override','team_role','role_default','workspace_default','system_default','unset']);for(const key of ['executor','model','reasoningId']){if(!sources.has(v.preferenceSources[key]))throw 0;if(v[key]===null&&v.preferenceSources[key]!=='unset')throw 0;if(v[key]!==null&&v.preferenceSources[key]==='unset')throw 0;}
    validateBinding(v.binding);exact(v.queue,['operationKey','source','priority','sessionCommand','provenance']);if(v.queue.operationKey!==`native-turn:${v.operationKey}`||v.queue.source!=='workflow'||v.queue.priority!==60||v.queue.sessionCommand!==null)throw 0;exact(v.queue.provenance,['kind','label','workflow_run_id','workflow_role_id']);if(v.queue.provenance.kind!=='workflow'||v.queue.provenance.label!=='Native workflow role turn'||v.queue.provenance.workflow_run_id!==v.operationKey||v.queue.provenance.workflow_role_id!==v.roleId)throw 0;
    if(v.prompt!==renderCanonicalRolePrompt(v.promptComposition))throw 0;
  }catch{throw new Error('The durable role-turn request is incompatible.');}
}
function validateBinding(value:any){if(!plain(value)||!['existing','create','create_or_reuse'].includes(value.mode))throw 0;if(value.mode==='existing'){exact(value,['mode','sessionId']);nonempty(value.sessionId);return;}exact(value,['mode','name','executorType','model','reasoningId'],true);nonempty(value.name);for(const key of ['executorType','model','reasoningId'])if(value[key]!==undefined)nonempty(value[key]);}
function assetArray(value:any){if(!Array.isArray(value))throw 0;for(const item of value)asset(item);}
function nullableAsset(value:any){if(value!==null)asset(value);}
function asset(value:any){exact(value,['id','version','content','contentHash']);nonempty(value.id);if(!Number.isInteger(value.version)||value.version<1)throw 0;nonempty(value.content,true);if(typeof value.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(value.contentHash)||sha256(value.content)!==value.contentHash)throw 0;}
function exact(value:any,keys:string[],optional=false){if(!plain(value))throw 0;const allowed=new Set(keys);if(Object.keys(value).some((key)=>!allowed.has(key)))throw 0;if(!optional&&keys.some((key)=>!(key in value)))throw 0;}
function plain(value:any){return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;}
function nonempty(value:any,allowEmpty=false){if(typeof value!=='string'||(!allowEmpty&&!value.trim()))throw 0;}
function nullableString(value:any){if(value!==null)nonempty(value);}
function renderCanonicalRolePrompt(composition:NativeRoleTurnRequestV1['promptComposition']){return[...composition.promptAssets.map((asset)=>asset.content),...composition.skillAssets.map((asset)=>asset.content),composition.roleTemplate?.content,composition.decision.authoredPrompt,composition.baseInstructions,`Task context\n${composition.taskContext.tasks.map((task)=>`${task.id}: ${task.title}`).join('\n')}`,`Inputs\n${canonicalJson(composition.taskContext.inputs)}`,composition.generatedXsd].filter((value):value is string=>typeof value==='string'&&value.length>0).join('\n\n');}
function canonicalJson(value:unknown){return JSON.stringify(canonicalize(value));}
function canonicalize(value:unknown):unknown{if(Array.isArray(value))return value.map(canonicalize);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonicalize(item)]));return value;}
function sha256(value:string){return createHash('sha256').update(value).digest('hex');}
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
