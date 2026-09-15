import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {PackagedNativeGasCityRuntime} from './nativeGasCityRuntime';

const roots:string[]=[];
afterEach(async()=>{delete process.env.VD_RUNTIME_ROOT;await Promise.all(roots.splice(0).map((root)=>rm(root,{recursive:true,force:true})));});
async function runtimeWith(item:any){const root=await mkdtemp(join(tmpdir(),'native-runtime-'));roots.push(root);const city=join(root,'city'),rig=join(root,'rig'),bundles=join(root,'runtime');await Promise.all([mkdir(city),mkdir(rig),mkdir(bundles)]);process.env.VD_RUNTIME_ROOT=root;const vk:any={getSession:async()=>({id:'session-dev',workspace_id:'workspace-1'}),findQueuedOperation:async()=>item};return new PackagedNativeGasCityRuntime({root:bundles,city,beadsDirectory:rig,target:'app/worker',gcExecutable:'/bin/false',beadsExecutable:'/bin/false',vk,resolver:{} as any});}
const input:any={operationKey:'operation-1',workspaceId:'workspace-1',roleId:'dev',prompt:'Do the task.',executor:'CODEX',model:'gpt-5.3-codex',reasoningId:'high',binding:{mode:'existing',sessionId:'session-dev'}};
function queued(overrides:any={}){return{id:'queue-1',session_id:'session-dev',workspace_id:'workspace-1',status:'queued',source:'workflow',priority:60,data:{message:'Do the task.',operation_key:'native-turn:operation-1',executor_config:{executor:'CODEX',model_id:'gpt-5.3-codex',reasoning_id:'high'},provenance:{kind:'workflow',label:'Native workflow role turn',workflow_run_id:'operation-1',workflow_name:null,workflow_design_id:null,workflow_version:null},session_command:null},...overrides};}
describe('native role-turn reconciliation identity',()=>{
  it('accepts the complete matching durable queue identity',async()=>{expect(await (await runtimeWith(queued())).reconcileRoleTurn(input)).toEqual({sessionId:'session-dev',queueItemRef:'queue-1'});});
  const mismatches={session:{session_id:'other'},workspace:{workspace_id:'other'},status:{status:'failed'},prompt:{data:{...queued().data,message:'other'}},executor:{data:{...queued().data,executor_config:{executor:'CODEX',model_id:'other',reasoning_id:'high'}}},provenance:{data:{...queued().data,provenance:{...queued().data.provenance,label:'other'}}},source:{source:'system'},command:{data:{...queued().data,session_command:{type:'clear'}}},priority:{priority:59}};
  for(const [name,change] of Object.entries(mismatches))it(`rejects mismatched ${name}`,async()=>{await expect((await runtimeWith(queued(change))).reconcileRoleTurn(input)).rejects.toThrow(/identity|acceptable state/);});
  it('distinguishes authoritative absence from transport uncertainty',async()=>{expect(await (await runtimeWith(null)).reconcileRoleTurn(input)).toBeNull();const runtime=await runtimeWith(null);(runtime as any).options.vk.findQueuedOperation=async()=>{throw new Error('offline');};expect(await runtime.reconcileRoleTurn(input)).toBe('unknown');});
});
