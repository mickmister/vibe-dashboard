import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { PackagedNativeGasCityRuntime } from './nativeGasCityRuntime';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec=promisify(execFile);

describe('packaged native Gas City runtime', () => {
  it.skipIf(process.env.VD_NATIVE_GAS_CITY_E2E !== '1')('requires exact pinned runtime and installs confirmed bytes durably', async () => {
    const base=await mkdtemp(join(tmpdir(),'vd-native-gc-'));const root=join(base,'runtime');const city=join(base,'city');await mkdir(root,{mode:0o700});await mkdir(city,{mode:0o700});
    const previous=process.env.VD_RUNTIME_ROOT;process.env.VD_RUNTIME_ROOT=base;
    try {
      const runtime=new PackagedNativeGasCityRuntime({root,city,target:'test-target',gcExecutable:'/usr/local/bin/gc',beadsExecutable:'/usr/local/bin/bd',vk:{} as any,resolver:{} as any});
      await expect(runtime.health()).resolves.toEqual({ready:true});
      const bytes=new TextEncoder().encode('{"formula":{"contents":"name = \\"native-proof\\"\\n"}}\n');const digest=createHash('sha256').update(bytes).digest('hex');
      await expect(runtime.ensureBundle({operationKey:'docker-proof',bundle:{schemaVersion:'vd.execution-bundle.v1',digest,bytes,document:{},verificationEvidence:{} as any}})).resolves.toEqual({bundleRef:digest});
      expect(await readFile(join(root,'bundles',digest,'bundle.json'),'utf8')).toContain('native-proof');
      const otherBytes=new TextEncoder().encode('{"formula":{"contents":"name = \\"native-proof\\"\\ndescription = \\"different\\"\\n"}}\n');const otherDigest=createHash('sha256').update(otherBytes).digest('hex');
      const results=await Promise.allSettled([runtime.ensureBundle({operationKey:'collision-a',bundle:{schemaVersion:'vd.execution-bundle.v1',digest,bytes,document:{},verificationEvidence:{} as any}}),runtime.ensureBundle({operationKey:'collision-b',bundle:{schemaVersion:'vd.execution-bundle.v1',digest:otherDigest,bytes:otherBytes,document:{},verificationEvidence:{} as any}})]);
      expect(results.filter((entry)=>entry.status==='rejected')).toHaveLength(1);
      await rm(join(root,'bundles'),{recursive:true,force:true});await symlink('/tmp',join(root,'bundles'));
      await expect(runtime.ensureBundle({operationKey:'swap',bundle:{schemaVersion:'vd.execution-bundle.v1',digest,bytes,document:{},verificationEvidence:{} as any}})).rejects.toThrow(/server-controlled|ownership/i);
    } finally { if(previous===undefined)delete process.env.VD_RUNTIME_ROOT;else process.env.VD_RUNTIME_ROOT=previous;await rm(base,{recursive:true,force:true}); }
  });

  it.skipIf(process.env.VD_NATIVE_GAS_CITY_E2E !== '1')('runs pinned sling and authoritative Beads progression exactly once across restart',async()=>{
    const base=await mkdtemp(join(tmpdir(),'vd-native-progress-'));const home=join(base,'home'),runDir=join(base,'run'),city=join(base,'city'),rig=join(base,'rig'),runtimeRoot=join(base,'runtime');
    await Promise.all([mkdir(home,{mode:0o700}),mkdir(runDir,{mode:0o700}),mkdir(rig,{mode:0o700}),mkdir(runtimeRoot,{mode:0o700})]);const env={...process.env,HOME:home,GC_HOME:join(home,'.gc'),XDG_RUNTIME_DIR:runDir};const call=(file:string,args:string[],cwd=base)=>exec(file,args,{cwd,env,timeout:30_000,maxBuffer:2_000_000});
    const oldHome=process.env.HOME,oldRoot=process.env.VD_RUNTIME_ROOT;process.env.HOME=home;process.env.VD_RUNTIME_ROOT=base;
    try{
      await call('/usr/bin/git',['config','--global','user.email','native@example.test']);await call('/usr/bin/git',['config','--global','user.name','Native Test']);await call('/usr/local/bin/dolt',['config','--global','--add','user.email','native@example.test']);await call('/usr/local/bin/dolt',['config','--global','--add','user.name','Native Test']);
      await call('/usr/bin/git',['init'],rig);await call('/usr/bin/git',['config','user.email','native@example.test'],rig);await call('/usr/bin/git',['config','user.name','Native Test'],rig);await writeFile(join(rig,'README'),'native\n');await call('/usr/bin/git',['add','.'],rig);await call('/usr/bin/git',['commit','-m','init'],rig);
      await call('/usr/local/bin/gc',['init',city,'--template','empty','--no-start']);await call('/usr/local/bin/gc',['rig','add',rig,'--city',city,'--name','app','--prefix','app','--start-suspended','--json']);
      const created=JSON.parse((await call('/usr/local/bin/bd',['create','--title','Native source','--type','task','--json'],rig)).stdout);const sourceBeadId=created.id;
      const formula='formula = "native-proof"\ndescription = "Native proof"\n[requires]\nformula_compiler = ">=2.0.0"\n[catalog]\nname = "Native proof"\ndescription = "Native proof"\n[[steps]]\nid = "work"\ntitle = "Work"\ndescription = "Complete task"\n[steps.metadata]\n"gc.run_target" = "app/core.control-dispatcher"\n';
      const bytes=new TextEncoder().encode(JSON.stringify({formula:{contents:formula}}));const bundleDigest=createHash('sha256').update(bytes).digest('hex');const queued=new Map<string,any>();let queueCalls=0,noteBefore=0,callbackCalls=0,callbackDelivered=false;const vk:any={getSession:async()=>({id:'session-dev',workspace_id:'workspace-1'}),queueFollowUp:async(sessionId:string,message:string,options:any)=>{const existing=queued.get(options.operationKey);if(existing)return{queued_item:existing};queueCalls++;const item={id:`queue-${queueCalls}`,session_id:sessionId,data:{message,operation_key:options.operationKey}};queued.set(options.operationKey,item);return{queued_item:item};},findQueuedOperation:async(_session:string,key:string)=>queued.get(key)??null,upsertWorkflowCallback:async()=>callbackDelivered?{status:'delivered',delivered_ref:'queue-2'}:{status:'pending'},updateWorkflowCallbackStatus:async()=>{callbackCalls++;callbackDelivered=true;}};const resolver:any={resolve:async()=>({ok:true,results:[{sessionId:'session-dev'}]})};
      const runtime=new PackagedNativeGasCityRuntime({root:runtimeRoot,city,beadsDirectory:rig,target:'app/core.control-dispatcher',gcExecutable:'/usr/local/bin/gc',beadsExecutable:'/usr/local/bin/bd',vk,resolver});const bundle:any={schemaVersion:'vd.execution-bundle.v1',digest:bundleDigest,bytes,document:{},verificationEvidence:{}};
      const installed=await runtime.ensureBundle({operationKey:'native-proof',bundle});const native=await runtime.ensureWorkflow({operationKey:'native-proof',bundleRef:installed.bundleRef,sourceBeadId});expect(native.status).toBe('running');expect(await runtime.checkTaskReady({workspaceId:'workspace-1',sourceBeadId})).toEqual({ready:true});
      const turnInput:any={operationKey:'native-proof',workspaceId:'workspace-1',roleId:'dev',prompt:'Do the task.',executor:'CODEX',model:null,reasoningId:null,binding:{mode:'existing',sessionId:'session-dev'}};const turn=await runtime.ensureRoleTurn(turnInput);expect(await runtime.reconcileRoleTurn(turnInput)).toEqual(turn);expect(queueCalls).toBe(1);
      const completed=await runtime.ensureTypedResult({operationKey:'native-proof:result',...native,action:'done',summary:'Completed safely.'});expect(completed.status).toBe('completed');const note=await runtime.ensureResultNote({operationKey:'native-proof:note',sourceBeadId,summary:'Completed safely.'});await runtime.ensureResultNote({operationKey:'native-proof:note',sourceBeadId,summary:'Completed safely.'});expect(note.noteRef).toMatch(/^result:/);
      const comments=JSON.parse((await call('/usr/local/bin/bd',['comments',sourceBeadId,'--json'],rig)).stdout);noteBefore=comments.length;expect(noteBefore).toBe(1);const callbackInput:any={operationKey:'native-proof:callback',request:{completionResponse:{sessionId:'caller'}},run:{runId:'run',workspaceId:'workspace-1',sourceBeadId,status:'completed',summary:'Done',url:'/run',workflowId:native.workflowId,rootBeadId:native.rootBeadId,sessionId:'session-dev',updatedAt:1}};await runtime.ensureTerminalCallback(callbackInput);await runtime.ensureTerminalCallback(callbackInput);expect(callbackCalls).toBe(1);expect(queueCalls).toBe(2);
      const restarted=new PackagedNativeGasCityRuntime({root:runtimeRoot,city,beadsDirectory:rig,target:'app/core.control-dispatcher',gcExecutable:'/usr/local/bin/gc',beadsExecutable:'/usr/local/bin/bd',vk,resolver});expect(await restarted.reconcileWorkflow({operationKey:'native-proof',bundleRef:installed.bundleRef,sourceBeadId})).not.toBe('unknown');expect(await restarted.reconcileRoleTurn(turnInput)).toEqual(turn);expect(queueCalls).toBe(2);
    }finally{await call('/usr/local/bin/bd',['dolt','stop'],rig).catch(()=>undefined);await call('/usr/local/bin/bd',['dolt','stop'],city).catch(()=>undefined);if(oldHome===undefined)delete process.env.HOME;else process.env.HOME=oldHome;if(oldRoot===undefined)delete process.env.VD_RUNTIME_ROOT;else process.env.VD_RUNTIME_ROOT=oldRoot;for(let attempt=0;attempt<5;attempt++){try{await rm(base,{recursive:true,force:true,maxRetries:3,retryDelay:100});break;}catch(error){if(attempt===4)throw error;await new Promise((resolve)=>setTimeout(resolve,200));}}}
  },60_000);
});
