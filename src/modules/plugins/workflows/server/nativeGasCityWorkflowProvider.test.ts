import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DB } from '../../../../store/kysely_types';
import { migration } from '../../../../store/db/migrations/20260915000000_native_gas_city_runs/migration';
import { migration as effectsMigration } from '../../../../store/db/migrations/20260915010000_native_gas_city_effects/migration';
import { NativeGasCityWorkflowProvider, type NativeGasCityRuntime } from './nativeGasCityWorkflowProvider';

function bundle(): any { return { schemaVersion: 'vd.execution-bundle.v1', digest: 'b'.repeat(64), bytes: new TextEncoder().encode('{}'), document: { workflow:{definition:{schemaVersion:1,name:'Native',roles:{dev:{}},initialState:'work',states:{work:{owner:'dev',steps:[{id:'decide',type:'agent_turn',turnType:'decision',prompt:{template:'Decide'},response:{format:'xml',schema:{format:'xsd',source:'state_actions'},invalidXmlRetry:{maxAttempts:1,prompt:'engine_default_with_validation_errors',onExhausted:'blocked'},storeRawXml:true,rawXmlMaxChars:1000,storeParsedFields:true,unknownFields:'reject_unless_allowed_by_result_contract'}}],actions:{done:{targetState:'done',result:{fields:{summary:{type:'markdown'}},required:['summary'],unknownFields:'reject'}}}},done:{terminal:true}}}}, roles: [{ roleId: 'dev', promptAssets: [{ content: 'Implement carefully.' }], skillAssets: [], baseInstructions: 'Return the decision.', executor: 'CODEX', model: 'gpt-5.3-codex', reasoningId: 'high' }], responseSchemas: { decision: '<xs:schema />' }, formula: { intendedGraph: { nodes: [{ id: 'work' }] } } }, verificationEvidence: {} }; }
const request:any={workspaceId:'ws-1',designId:'design-1',version:1,inputs:{},roleBindings:{dev:{mode:'create',name:'Dev'}},beadIds:['bead-1'],completionResponse:{sessionId:'caller-1',source:'vibe-agent-cli'}};
const plan:any={digest:'p'.repeat(64),tasks:[{id:'bead-1',title:'Task'}]};

describe('native Gas City single-task provider', () => {
  let db:Kysely<DB>; let calls:{bundle:number;workflow:number;turn:number;note:number;callback:number}; let runtime:NativeGasCityRuntime; let provider:NativeGasCityWorkflowProvider;
  beforeEach(async()=>{ const sqlite=new Database(':memory:'); (sqlite as any).exec(`${migration}\n${effectsMigration}`); db=new Kysely<DB>({dialect:new SqliteDialect({database:sqlite})}); calls={bundle:0,workflow:0,turn:0,note:0,callback:0}; const effects=new Map<string,any>(); runtime={
    health:async()=>({ready:true}),
    checkTaskReady:async()=>({ready:true}),
    ensureBundle:async({operationKey,bundle})=>{calls.bundle++; const value={bundleRef:bundle.digest};effects.set(`${operationKey}:bundle`,value);return value;},
    ensureWorkflow:async({operationKey,sourceBeadId})=>{calls.workflow++;const value={workflowId:'wf-1',rootBeadId:'root-1',sourceBeadId,status:'running' as const};effects.set(`${operationKey}:workflow`,value);return value;},
    reconcileWorkflow:async({operationKey})=>effects.get(`${operationKey}:workflow`)??null,
    ensureRoleTurn:async({operationKey})=>{calls.turn++;const value={sessionId:'session-dev',queueItemRef:'queue-native-1'};effects.set(`${operationKey}:turn`,value);return value;},
    reconcileRoleTurn:async(key)=>effects.get(`${key}:turn`)??null,
    readAuthoritativeState:async({sourceBeadId})=>({workflowId:'wf-1',rootBeadId:'root-1',sourceBeadId,status:'completed'}),
    ensureTypedResult:async({workflowId,rootBeadId,sourceBeadId})=>({workflowId,rootBeadId,sourceBeadId,status:'completed'}),
    ensureResultNote:async({operationKey})=>{if(!effects.has(operationKey)){calls.note++;effects.set(operationKey,{noteRef:'note-1'});}return effects.get(operationKey);},
    ensureTerminalCallback:async({operationKey})=>{if(!effects.has(operationKey)){calls.callback++;effects.set(operationKey,{callbackRef:'callback-1'});}return effects.get(operationKey);},
  }; provider=new NativeGasCityWorkflowProvider({getDb:()=>db,runtime,now:()=>100}); });

  it('materializes once, routes the resolved turn, records one note and callback, and replays safely',async()=>{
    const first=await provider.launch({request,plan,bundle:bundle(),idempotencyKey:'operation-1'});
    const replay=await provider.launch({request,plan,bundle:bundle(),idempotencyKey:'operation-1'});
    expect(first).toMatchObject({status:'running'});expect(replay.reused).toBe(true);
    expect(calls).toMatchObject({bundle:1,workflow:1,turn:1});
    const completed=await provider.completeRoleTurn({queueItemRef:'queue-native-1',responseRef:'response-1',finalResponseText:'<decision action="done"><summary>Task completed safely.</summary></decision>'});
    const duplicate=await provider.completeRoleTurn({queueItemRef:'queue-native-1',responseRef:'response-1',finalResponseText:'<decision action="done"><summary>Task completed safely.</summary></decision>'});
    expect(completed!.run).toMatchObject({status:'completed',summary:'Task completed safely.'}); expect(duplicate!.applied).toBe(false);
    expect(calls.note).toBe(1);expect(calls.callback).toBe(1);
  });

  it('reconciles a restart after the external graph effect and does not create replacement work',async()=>{
    await provider.launch({request,plan,bundle:bundle(),idempotencyKey:'operation-restart'});
    const restarted=new NativeGasCityWorkflowProvider({getDb:()=>db,runtime,now:()=>200});
    await expect(restarted.reconcile('operation-restart')).resolves.toMatchObject({outcome:'found'});
    expect(calls.workflow).toBe(1);expect(calls.turn).toBe(1);
  });

  it('blocks unsupported topology, conflicting replay, invalid XML, and scrubs hostile errors',async()=>{
    const bad=bundle();bad.document.formula.intendedGraph.nodes.push({id:'two'});
    await expect(provider.launch({request,plan,bundle:bad,idempotencyKey:'bad'})).rejects.toThrow('one role turn');
    await provider.launch({request,plan,bundle:bundle(),idempotencyKey:'same'});
    await expect(provider.launch({request:{...request,inputs:{changed:true}},plan,bundle:bundle(),idempotencyKey:'same'})).rejects.toThrow('different confirmed plan');
    await expect(provider.completeRoleTurn({queueItemRef:'queue-native-1',responseRef:'r',finalResponseText:'not xml'})).rejects.toThrow('decision contract');
    await expect(provider.completeRoleTurn({queueItemRef:'queue-native-1',responseRef:'r',finalResponseText:'<decision action="done"><summary>a</summary><summary>b</summary></decision>'})).rejects.toThrow('duplicate');
    await expect(provider.completeRoleTurn({queueItemRef:'queue-native-1',responseRef:'r',finalResponseText:'<decision action="done"><summary>a</summary><extra>x</extra></decision>'})).rejects.toThrow('compiled decision contract');
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
});
