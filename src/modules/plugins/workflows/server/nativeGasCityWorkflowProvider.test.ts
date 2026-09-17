import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { DB } from '../../../../store/kysely_types';
import { migration } from '../../../../store/db/migrations/20260915000000_native_gas_city_runs/migration';
import { migration as effectsMigration } from '../../../../store/db/migrations/20260915010000_native_gas_city_effects/migration';
import { migration as roleTurnMigration } from '../../../../store/db/migrations/20260915020000_native_role_turn_request/migration';
import { NativeGasCityWorkflowProvider, type NativeGasCityRuntime } from './nativeGasCityWorkflowProvider';

function bundle(): any { return { schemaVersion: 'vd.execution-bundle.v1', digest: 'b'.repeat(64), bytes: new TextEncoder().encode('{}'), document: { workflow:{definition:{schemaVersion:1,name:'Native',roles:{dev:{}},initialState:'work',states:{work:{owner:'dev',steps:[{id:'decide',type:'agent_turn',turnType:'decision',prompt:{template:'Decide'},response:{format:'xml',schema:{format:'xsd',source:'state_actions'},invalidXmlRetry:{maxAttempts:1,prompt:'engine_default_with_validation_errors',onExhausted:'blocked'},storeRawXml:true,rawXmlMaxChars:1000,storeParsedFields:true,unknownFields:'reject_unless_allowed_by_result_contract'}}],actions:{done:{targetState:'done',result:{fields:{summary:{type:'markdown'}},required:['summary'],unknownFields:'reject'}}}},done:{terminal:true}}}}, inputs:{scope:'focused'},roles: [{ roleId: 'dev',template:{id:'reviewer',version:2,content:'Template instructions.',contentHash:createHash('sha256').update('Template instructions.').digest('hex')}, promptAssets: [{id:'prompt',version:3,content:'Implement carefully.',contentHash:createHash('sha256').update('Implement carefully.').digest('hex')}], skillAssets: [{id:'skill',version:4,content:'Use the checklist.',contentHash:createHash('sha256').update('Use the checklist.').digest('hex')}], baseInstructions: 'Return the decision.', executor: 'CODEX', model: 'gpt-5.3-codex', reasoningId: 'high',preferenceSources:{executor:'role_default',model:'role_default',reasoningId:'role_default'} }], responseSchemas: [{ stateId: 'work', stepId: 'decide', xsd: '<xs:schema />' }], formula: { intendedGraph: [{ id: 'state-work', stateId: 'work' }] } }, verificationEvidence: {} }; }
const request:any={workspaceId:'ws-1',designId:'design-1',version:1,inputs:{},roleBindings:{dev:{mode:'create',name:'Dev'}},beadIds:['bead-1'],completionResponse:{sessionId:'caller-1',source:'vibe-agent-cli'}};
const plan:any={digest:'p'.repeat(64),tasks:[{id:'bead-1',title:'Task'}]};

describe('native Gas City single-task provider', () => {
  let db:Kysely<DB>; let calls:{bundle:number;workflow:number;turn:number;note:number;callback:number}; let turnRequests:any[];let runtime:NativeGasCityRuntime; let provider:NativeGasCityWorkflowProvider;
  beforeEach(async()=>{ const sqlite=new Database(':memory:'); (sqlite as any).exec(`${migration}\n${effectsMigration}\n${roleTurnMigration}`); db=new Kysely<DB>({dialect:new SqliteDialect({database:sqlite})}); calls={bundle:0,workflow:0,turn:0,note:0,callback:0};turnRequests=[]; const effects=new Map<string,any>(); runtime={
    health:async()=>({ready:true}),
    checkTaskReady:async()=>({ready:true}),
    ensureBundle:async({operationKey,bundle})=>{calls.bundle++; const value={bundleRef:bundle.digest};effects.set(`${operationKey}:bundle`,value);return value;},
    ensureWorkflow:async({operationKey,sourceBeadId})=>{calls.workflow++;const value={workflowId:'wf-1',rootBeadId:'root-1',sourceBeadId,status:'running' as const};effects.set(`${operationKey}:workflow`,value);return value;},
    reconcileWorkflow:async({operationKey})=>effects.get(`${operationKey}:workflow`)??null,
    ensureRoleTurn:async(input)=>{turnRequests.push(structuredClone(input));calls.turn++;const value={sessionId:'session-dev',queueItemRef:`queue-${input.operationKey}`};effects.set(`${input.operationKey}:turn`,value);return value;},
    reconcileRoleTurn:async(input)=>effects.get(`${input.operationKey}:turn`)??null,
    readAuthoritativeState:async({sourceBeadId})=>({workflowId:'wf-1',rootBeadId:'root-1',sourceBeadId,status:'completed'}),
    ensureTypedResult:async({workflowId,rootBeadId,sourceBeadId})=>({workflowId,rootBeadId,sourceBeadId,status:'completed'}),
    ensureResultNote:async({operationKey})=>{if(!effects.has(operationKey)){calls.note++;effects.set(operationKey,{noteRef:'note-1'});}return effects.get(operationKey);},
    ensureTerminalCallback:async({operationKey})=>{if(!effects.has(operationKey)){calls.callback++;effects.set(operationKey,{callbackRef:'callback-1'});}return effects.get(operationKey);},
    reconcileEffect:async()=>({outcome:'absent'} as const),
  }; provider=new NativeGasCityWorkflowProvider({getDb:()=>db,runtime,now:()=>100}); });

  it('materializes once, routes the resolved turn, records one note and callback, and replays safely',async()=>{
    const first=await provider.launch({request,plan,bundle:bundle(),idempotencyKey:'operation-1'});
    const replay=await provider.launch({request,plan,bundle:bundle(),idempotencyKey:'operation-1'});
    expect(first).toMatchObject({status:'running'});expect(replay.reused).toBe(true);
    expect(calls).toMatchObject({bundle:1,workflow:1,turn:1});
    const completed=await provider.completeRoleTurn({queueItemRef:'queue-operation-1',responseRef:'response-1',finalResponseText:'<decision action="done"><summary>Task completed safely.</summary></decision>'});
    const duplicate=await provider.completeRoleTurn({queueItemRef:'queue-operation-1',responseRef:'response-1',finalResponseText:'<decision action="done"><summary>Task completed safely.</summary></decision>'});
    expect(completed!.run).toMatchObject({status:'completed',summary:'Task completed safely.'}); expect(duplicate!.applied).toBe(false);
    expect(calls.note).toBe(1);expect(calls.callback).toBe(1);
  });

  it('reconciles a restart after the external graph effect and does not create replacement work',async()=>{
    await provider.launch({request,plan,bundle:bundle(),idempotencyKey:'operation-restart'});
    const restarted=new NativeGasCityWorkflowProvider({getDb:()=>db,runtime,now:()=>200});
    await expect(restarted.reconcile('operation-restart')).resolves.toMatchObject({outcome:'found'});
    expect(calls.workflow).toBe(1);expect(calls.turn).toBe(1);
  });

  it('persists the complete canonical role turn before effects and reuses it after mutable inputs change',async()=>{
    const original=bundle();let observedBeforeBundle=false;runtime.ensureBundle=async({bundle:compiled})=>{const row=await db.selectFrom('WorkflowNativeGasCityRun').selectAll().where('operationKey','=','immutable-turn').executeTakeFirstOrThrow();expect(row.roleTurnRequestDigest).toMatch(/^[a-f0-9]{64}$/);expect(row.roleTurnRequestJson).toContain('Implement carefully.');observedBeforeBundle=true;return{bundleRef:compiled.digest};};
    await provider.launch({request:{...request,inputs:{scope:'focused'}},plan,bundle:original,idempotencyKey:'immutable-turn'});expect(observedBeforeBundle).toBe(true);const persisted=await db.selectFrom('WorkflowNativeGasCityRun').selectAll().where('operationKey','=','immutable-turn').executeTakeFirstOrThrow();const parsed=JSON.parse(persisted.roleTurnRequestJson!);expect(parsed).toMatchObject({schemaVersion:'vd.native-role-turn.v1',operationKey:'immutable-turn',workspaceId:'ws-1',roleId:'dev',executor:'CODEX',model:'gpt-5.3-codex',reasoningId:'high',preferenceSources:{executor:'role_default'},binding:{mode:'create',name:'Dev'},queue:{operationKey:'native-turn:immutable-turn',source:'workflow',priority:60,sessionCommand:null}});expect(parsed.promptComposition).toMatchObject({roleTemplate:{content:'Template instructions.'},promptAssets:[{content:'Implement carefully.'}],skillAssets:[{content:'Use the checklist.'}],generatedXsd:'<xs:schema />',taskContext:{tasks:[{id:'bead-1',title:'Task'}],inputs:{scope:'focused'}}});expect(parsed.prompt).toContain('Template instructions.');expect(parsed.prompt).toContain('bead-1: Task');expect(parsed.prompt).toContain('<xs:schema />');
    original.document.roles[0].promptAssets[0].content='MUTATED';original.document.roles[0].model='other';await db.updateTable('WorkflowNativeGasCityRun').set({sessionId:null,queueItemRef:null,status:'ready'}).where('operationKey','=','immutable-turn').execute();const restarted=new NativeGasCityWorkflowProvider({getDb:()=>db,runtime,now:()=>200});await restarted.reconcile('immutable-turn');expect(turnRequests.at(-1)).toEqual(parsed);expect(turnRequests.at(-1).prompt).not.toContain('MUTATED');
  });

  it('recovers a crash before enqueue from the byte-identical persisted role request',async()=>{
    const originalEnsure=runtime.ensureRoleTurn;runtime.ensureRoleTurn=async()=>{throw new Error('crash before enqueue');};
    const interrupted=new NativeGasCityWorkflowProvider({getDb:()=>db,runtime,now:()=>100,effectLeaseMs:10});
    await expect(interrupted.launch({request,plan,bundle:bundle(),idempotencyKey:'before-enqueue'})).rejects.toThrow('could not be confirmed');
    const stored=await db.selectFrom('WorkflowNativeGasCityRun').selectAll().where('operationKey','=','before-enqueue').executeTakeFirstOrThrow();expect(stored.queueItemRef).toBeNull();const canonical=stored.roleTurnRequestJson;
    runtime.ensureRoleTurn=originalEnsure;const restarted=new NativeGasCityWorkflowProvider({getDb:()=>db,runtime,now:()=>1000,effectLeaseMs:10});
    await expect(restarted.reconcile('before-enqueue')).resolves.toMatchObject({outcome:'found',run:{status:'running'}});
    expect(turnRequests).toHaveLength(1);expect(JSON.stringify(turnRequests[0])).toBe(canonical);expect(calls.turn).toBe(1);
  });

  it('fails closed for corrupted, incompatible, and legacy role-turn records',async()=>{
    await provider.launch({request,plan,bundle:bundle(),idempotencyKey:'corrupt-turn'});await db.updateTable('WorkflowNativeGasCityRun').set({sessionId:null,queueItemRef:null,status:'ready',roleTurnRequestJson:'{}'}).where('operationKey','=','corrupt-turn').execute();await expect(new NativeGasCityWorkflowProvider({getDb:()=>db,runtime}).reconcile('corrupt-turn')).rejects.toThrow('corrupted');
    await db.updateTable('WorkflowNativeGasCityRun').set({roleTurnRequestJson:null,roleTurnRequestDigest:null,roleTurnSchemaVersion:null,status:'ready'}).where('operationKey','=','corrupt-turn').execute();await expect(new NativeGasCityWorkflowProvider({getDb:()=>db,runtime}).reconcile('corrupt-turn')).rejects.toThrow('predates');
  });

  it('selects the exact compiler schema and binds the authored decision prompt',async()=>{
    const first=bundle();await provider.launch({request,plan,bundle:first,idempotencyKey:'step-prompt-a'});const a=await db.selectFrom('WorkflowNativeGasCityRun').selectAll().where('operationKey','=','step-prompt-a').executeTakeFirstOrThrow();const parsed=JSON.parse(a.roleTurnRequestJson!);expect(parsed.promptComposition.decision).toEqual({stateId:'work',stepId:'decide',authoredPrompt:'Decide'});expect(parsed.prompt).toContain('\n\nDecide\n\n');
    const changed=bundle();changed.document.workflow.definition.states.work.steps[0].prompt.template='Decide with the changed authored instruction';await provider.launch({request,plan,bundle:changed,idempotencyKey:'step-prompt-b'});const b=await db.selectFrom('WorkflowNativeGasCityRun').selectAll().where('operationKey','=','step-prompt-b').executeTakeFirstOrThrow();expect(b.roleTurnRequestDigest).not.toBe(a.roleTurnRequestDigest);expect(b.roleTurnRequestJson).toContain('changed authored instruction');
    await expect(provider.launch({request,plan,bundle:changed,idempotencyKey:'step-prompt-a'})).rejects.toThrow('different resolved role turn');
    const duplicate=bundle();duplicate.document.responseSchemas.push({...duplicate.document.responseSchemas[0]});await expect(provider.launch({request,plan,bundle:duplicate,idempotencyKey:'duplicate-schema'})).rejects.toThrow('duplicated');
    const wrong=bundle();wrong.document.responseSchemas[0].stepId='other';await expect(provider.launch({request,plan,bundle:wrong,idempotencyKey:'wrong-schema'})).rejects.toThrow('missing or mismatched');
  });

  it('strictly rejects unknown and malformed nested snapshots on running and completed replay',async()=>{
    const rewrite=async(operationKey:string,mutate:(value:any)=>void,status:'running'|'completed')=>{const row=await db.selectFrom('WorkflowNativeGasCityRun').selectAll().where('operationKey','=',operationKey).executeTakeFirstOrThrow();const value=JSON.parse(row.roleTurnRequestJson!);mutate(value);const json=JSON.stringify(value);await db.updateTable('WorkflowNativeGasCityRun').set({status,roleTurnRequestJson:json,roleTurnRequestDigest:createHash('sha256').update(json).digest('hex')}).where('operationKey','=',operationKey).execute();};
    await provider.launch({request,plan,bundle:bundle(),idempotencyKey:'strict-running'});await rewrite('strict-running',(value)=>{value.promptComposition.promptAssets[0].unknown='no';},'running');await expect(provider.launch({request,plan,bundle:bundle(),idempotencyKey:'strict-running'})).rejects.toThrow('incompatible');
    await provider.launch({request,plan,bundle:bundle(),idempotencyKey:'strict-completed'});await rewrite('strict-completed',(value)=>{value.preferenceSources.model='invented';},'completed');await expect(provider.launch({request,plan,bundle:bundle(),idempotencyKey:'strict-completed'})).rejects.toThrow('incompatible');
    await provider.launch({request,plan,bundle:bundle(),idempotencyKey:'strict-binding'});await rewrite('strict-binding',(value)=>{value.binding.extra=true;},'running');await expect(provider.reconcile('strict-binding')).rejects.toThrow('incompatible');
    const malformed:Array<[string,(value:any)=>void]>=[
      ['unknown-root',(value)=>{value.unknown=true;}],
      ['template-version',(value)=>{value.promptComposition.roleTemplate.version=0;}],
      ['asset-hash',(value)=>{value.promptComposition.skillAssets[0].contentHash='bad';}],
      ['decision',(value)=>{value.promptComposition.decision.stepId='';}],
      ['context',(value)=>{value.promptComposition.taskContext.tasks[0].extra=true;}],
      ['executor',(value)=>{value.executor=null;value.model='unexpected';}],
      ['queue',(value)=>{value.queue.extra=true;}],
      ['provenance',(value)=>{value.queue.provenance.workflow_role_id='other';}],
    ];
    for(const [suffix,mutate] of malformed){const operationKey=`strict-${suffix}`;await provider.launch({request,plan,bundle:bundle(),idempotencyKey:operationKey});await rewrite(operationKey,mutate,'running');await expect(provider.reconcile(operationKey)).rejects.toThrow('incompatible');}
  });

  it('recovers an enqueue whose response was lost and distinguishes a never-enqueued turn',async()=>{
    await provider.launch({request,plan,bundle:bundle(),idempotencyKey:'lost-enqueue'});
    await db.updateTable('WorkflowNativeGasCityRun').set({sessionId:null,queueItemRef:null,status:'ready'}).where('operationKey','=','lost-enqueue').execute();
    const restarted=new NativeGasCityWorkflowProvider({getDb:()=>db,runtime,now:()=>200});
    await expect(restarted.reconcile('lost-enqueue')).resolves.toMatchObject({outcome:'found'});
    expect(calls.turn).toBe(1);

    // The initial launch above began from an authoritative absent lookup and
    // therefore enqueued exactly once; restart found that same durable item.
    expect(calls.turn).toBe(1);

    const prior=await db.selectFrom('WorkflowNativeGasCityRun').select(['roleTurnSchemaVersion','roleTurnRequestJson']).where('operationKey','=','lost-enqueue').executeTakeFirstOrThrow();const roleTurn=JSON.parse(prior.roleTurnRequestJson!);roleTurn.operationKey='never-enqueued';roleTurn.queue.operationKey='native-turn:never-enqueued';roleTurn.queue.provenance.workflow_run_id='never-enqueued';const roleTurnRequestJson=JSON.stringify(roleTurn);const stored={roleTurnSchemaVersion:prior.roleTurnSchemaVersion,roleTurnRequestJson,roleTurnRequestDigest:createHash('sha256').update(roleTurnRequestJson).digest('hex')};
    await db.insertInto('WorkflowNativeGasCityRun').values({operationKey:'never-enqueued',runId:'native_never',workspaceId:'ws-1',sourceBeadId:'bead-1',requestDigest:'request',bundleDigest:bundle().digest,requestJson:JSON.stringify(request),allowedActionsJson:'["done"]',definitionJson:JSON.stringify(bundle().document.workflow.definition),...stored,status:'ready',bundleRef:bundle().digest,workflowId:'wf-1',rootBeadId:'root-1',sessionId:null,queueItemRef:null,resultRef:null,noteRef:null,callbackRef:null,summary:'Ready.',attempts:1,createdAt:1,updatedAt:1}).execute();
    await expect(restarted.reconcile('never-enqueued')).resolves.toMatchObject({outcome:'found'});
    expect(calls.turn).toBe(2);
  });

  it('resumes only the terminal callback after a crash following durable result persistence',async()=>{
    await provider.launch({request,plan,bundle:bundle(),idempotencyKey:'callback-crash'});
    await db.updateTable('WorkflowNativeGasCityRun').set({resultRef:'response-1',noteRef:'note-1',status:'completed',callbackRef:null}).where('operationKey','=','callback-crash').execute();
    const replay=await provider.completeRoleTurn({queueItemRef:'queue-callback-crash',responseRef:'response-1',finalResponseText:'<decision action="done"><summary>Task completed safely.</summary></decision>'});
    expect(replay).toMatchObject({applied:false,run:{status:'completed'}});expect(calls.note).toBe(0);expect(calls.callback).toBe(1);
    await provider.completeRoleTurn({queueItemRef:'queue-callback-crash',responseRef:'response-1',finalResponseText:'<decision action="done"><summary>Task completed safely.</summary></decision>'});
    expect(calls.callback).toBe(1);
  });

  it('blocks unsupported topology, conflicting replay, invalid XML, and scrubs hostile errors',async()=>{
    const bad=bundle();bad.document.formula.intendedGraph.push({id:'two'});
    await expect(provider.launch({request,plan,bundle:bad,idempotencyKey:'bad'})).rejects.toThrow('one role turn');
    await provider.launch({request,plan,bundle:bundle(),idempotencyKey:'same'});
    await expect(provider.launch({request:{...request,inputs:{changed:true}},plan,bundle:bundle(),idempotencyKey:'same'})).rejects.toThrow('different confirmed plan');
    await expect(provider.completeRoleTurn({queueItemRef:'queue-same',responseRef:'r',finalResponseText:'not xml'})).rejects.toThrow('decision contract');
    await expect(provider.completeRoleTurn({queueItemRef:'queue-same',responseRef:'r',finalResponseText:'<decision action="done"><summary>a</summary><summary>b</summary></decision>'})).rejects.toThrow('duplicate');
    await expect(provider.completeRoleTurn({queueItemRef:'queue-same',responseRef:'r',finalResponseText:'<decision action="done"><summary>a</summary><extra>x</extra></decision>'})).rejects.toThrow('compiled decision contract');
    runtime.health=vi.fn(async()=>({ready:false,message:'provider diagnostics /tmp/secret stdout webhook'}));
    expect(await provider.checkDynamic(plan)).toEqual({ready:false,message:expect.not.stringMatching(/provider diagnostics|\/tmp|stdout|webhook/i)});
  });

  it('relies on operation-keyed runtime ensures under concurrent replay',async()=>{
    let workflowPromise:Promise<any>|null=null; runtime.ensureWorkflow=({sourceBeadId})=>workflowPromise??=(async()=>{calls.workflow++;await new Promise(r=>setTimeout(r,10));return{workflowId:'wf-1',rootBeadId:'root-1',sourceBeadId,status:'running' as const};})();
    await Promise.all([provider.launch({request,plan,bundle:bundle(),idempotencyKey:'race'}),provider.launch({request,plan,bundle:bundle(),idempotencyKey:'race'})]);
    expect(calls.workflow).toBe(1);
  });

  it('fences concurrent providers sharing the durable registry',async()=>{
    let release!:()=>void;const gate=new Promise<void>((resolve)=>{release=resolve;});
    runtime.ensureBundle=async({bundle})=>{calls.bundle++;await gate;return{bundleRef:bundle.digest};};
    const other=new NativeGasCityWorkflowProvider({getDb:()=>db,runtime,now:()=>100});
    const first=provider.launch({request,plan,bundle:bundle(),idempotencyKey:'cross-instance'});
    await new Promise((resolve)=>setTimeout(resolve,5));
    const second=other.launch({request,plan,bundle:bundle(),idempotencyKey:'cross-instance'});
    await expect(second).rejects.toThrow('could not be confirmed');release();await expect(first).resolves.toMatchObject({status:'running'});
    expect(calls.bundle).toBe(1);
  });

  it('heartbeats a slow external effect past its lease and prevents takeover',async()=>{
    runtime.ensureBundle=async({bundle})=>{calls.bundle++;await new Promise((resolve)=>setTimeout(resolve,140));return{bundleRef:bundle.digest};};
    const clock=()=>Date.now();provider=new NativeGasCityWorkflowProvider({getDb:()=>db,runtime,now:clock,effectLeaseMs:60,effectHeartbeatMs:15});
    const other=new NativeGasCityWorkflowProvider({getDb:()=>db,runtime,now:clock,effectLeaseMs:60,effectHeartbeatMs:15});
    const first=provider.launch({request,plan,bundle:bundle(),idempotencyKey:'slow-effect'});await new Promise((resolve)=>setTimeout(resolve,90));
    await expect(other.launch({request,plan,bundle:bundle(),idempotencyKey:'slow-effect'})).rejects.toThrow('could not be confirmed');
    await expect(first).resolves.toMatchObject({status:'running'});expect(calls.bundle).toBe(1);
  });
});
