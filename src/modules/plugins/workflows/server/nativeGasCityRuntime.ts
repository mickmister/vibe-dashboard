import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, link, rm, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { promisify } from 'node:util';
import type { WorkflowRoleSessionResolver } from '../../../../server/role-session-resolver';
import type { VibeKanbanServerClient, Executor, QueuedMessage } from '../../../../server/vk-client';
import type { NativeGasCityRuntime, NativeGasCityAuthoritativeState, NativeGasCityRunReadModel } from './nativeGasCityWorkflowProvider';
import type { WorkflowPlanRequest } from './workflowPlanLaunchService';

const run = promisify(execFile);

/** Exact packaged-command adapter. It never invokes a shell and all caller
 * values are positional arguments after fixed command words. */
export class PackagedNativeGasCityRuntime implements NativeGasCityRuntime {
  private readonly root: string;
  private readonly city: string;
  private readonly target: string;
  private readonly gc: string;
  private readonly bd: string;
  private readonly beadsDirectory:string;
  constructor(private readonly options: {
    root: string; city: string; beadsDirectory?:string; target: string; gcExecutable: string; beadsExecutable: string;
    vk: VibeKanbanServerClient; resolver: WorkflowRoleSessionResolver;
  }) {
    this.root = resolve(options.root); this.city = resolve(options.city); this.target = safeTarget(options.target);
    this.beadsDirectory=resolve(options.beadsDirectory??options.city);
    this.gc = resolve(options.gcExecutable); this.bd = resolve(options.beadsExecutable);
    const controlled=process.env.VD_RUNTIME_ROOT;if(!controlled)throw new Error('Native workflow runtime capability is not configured.');const canonical=realpathSync(controlled);
    for(const candidate of [this.root,this.city,this.beadsDirectory]){const actual=realpathSync(candidate);if(actual!==canonical&&!actual.startsWith(`${canonical}${sep}`))throw new Error('Native workflow runtime root is not server-controlled.');if(lstatSync(candidate).isSymbolicLink()||statSync(candidate).uid!==process.getuid?.())throw new Error('Native workflow runtime ownership is invalid.');}
  }
  async health() {
    try {
      const [gc, bd] = await Promise.all([this.exec(this.gc, ['version']), this.exec(this.bd, ['version'])]);
      return gc.includes('1.4.1') && bd.includes('1.2.2') ? { ready: true } : { ready: false, message: 'Workflow engine version does not match the tested runtime.' };
    } catch { return { ready: false, message: 'Workflow engine is not available.' }; }
  }
  async checkTaskReady(input:{workspaceId:string;sourceBeadId:string}){try{const out=await this.exec(this.bd,['show',safeId(input.sourceBeadId),'--json']);const value=JSON.parse(out);const bead=Array.isArray(value)?value[0]:value;const status=String(bead?.status??'');const blocked=Array.isArray(bead?.dependencies)&&bead.dependencies.some((d:any)=>String(d?.status??'')!=='closed');return status==='open'&&!blocked?{ready:true}:{ready:false,message:'Task is not ready.'};}catch{return{ready:false,message:'Task state is unavailable.'};}}
  async ensureBundle(input: Parameters<NativeGasCityRuntime['ensureBundle']>[0]) {
    this.assertManagedRoot(this.root);this.assertManagedRoot(this.city);
    const bundles=join(this.root,'bundles');await this.ensurePrivateDirectory(bundles,this.root);const dir = join(bundles, input.bundle.digest);await this.ensurePrivateDirectory(dir,bundles);const final = join(dir, 'bundle.json');
    try { const bytes = await readFile(final); if (sha(bytes) !== input.bundle.digest) throw new Error('Installed workflow bundle does not match its confirmed digest.'); }
    catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      await this.atomicInstall(final,input.bundle.bytes);
    }
    const installed=JSON.parse(await readFile(final,'utf8')) as any;
    const formula = String(installed?.formula?.contents ?? '');
    const formulaName = formula.match(/^(?:formula|name)\s*=\s*"([A-Za-z0-9_.-]+)"/m)?.[1];
    if (!formulaName) throw new Error('Confirmed workflow bundle has no formula identity.');
    const formulaDir = join(this.city, 'formulas'); await this.ensurePrivateDirectory(formulaDir,this.city);
    const formulaPath = join(formulaDir, `${safeId(formulaName)}.formula.toml`); const formulaBytes = new TextEncoder().encode(formula);
    try { if (sha(await readFile(formulaPath)) !== sha(formulaBytes)) throw new Error('Installed workflow formula conflicts with the confirmed bundle.'); }
    catch (error:any) { if(error?.code!=='ENOENT')throw error; await this.atomicInstall(formulaPath,formulaBytes);if(sha(await readFile(formulaPath))!==sha(formulaBytes))throw new Error('Installed workflow formula conflicts with the confirmed bundle.'); }
    return { bundleRef: input.bundle.digest };
  }
  async ensureWorkflow(input: Parameters<NativeGasCityRuntime['ensureWorkflow']>[0]): Promise<NativeGasCityAuthoritativeState> {
    const bundle = JSON.parse(await readFile(join(this.root, 'bundles', input.bundleRef, 'bundle.json'), 'utf8')) as any;
    const formula=String(bundle?.formula?.contents??'');const formulaName=safeId(formula.match(/^(?:formula|name)\s*=\s*"([A-Za-z0-9_.-]+)"/m)?.[1]??'');
    const rig=safeId(this.target.split('/')[0]??'');
    const output = await this.exec(this.gc, ['sling', this.target, safeId(input.sourceBeadId), '--on', formulaName, '--scope-kind', 'rig', '--scope-ref', rig, '--city', this.city, '--json']);
    const parsed = parseObject(output);
    return nativeState(parsed, input.sourceBeadId);
  }
  async reconcileWorkflow(input: Parameters<NativeGasCityRuntime['reconcileWorkflow']>[0]) {
    if (!input.bundleRef) return null;
    try { return await this.ensureWorkflow({ operationKey: input.operationKey, bundleRef: input.bundleRef, sourceBeadId: input.sourceBeadId }); }
    catch { return 'unknown' as const; }
  }
  private async resolveRoleSession(input:Parameters<NativeGasCityRuntime['ensureRoleTurn']>[0]) {
    let sessionId:string;
    if(input.binding?.mode==='existing'){const session=await this.options.vk.getSession(input.binding.sessionId!);if(session.workspace_id!==input.workspaceId)throw new Error('The workflow role session is not in the selected workspace.');sessionId=session.id;}
    else {if(!input.executor)throw new Error('A resolved executor is required to create a workflow role session.');const name=input.binding?.name??input.roleId;const team={id:`native-${input.operationKey}`,name:'Native workflow',agents:[{id:input.roleId,role:name,displayName:name,executor:input.executor}]} as any;const resolution=await this.options.resolver.resolve({team,workspaceId:input.workspaceId,roleIds:[input.roleId],allowAutoCreate:true,allowRoleNameReuse:input.binding?.mode==='create_or_reuse',persistBindings:true});const role=resolution.results[0];if(!resolution.ok||!role?.sessionId)throw new Error('The workflow role session could not be resolved.');sessionId=role.sessionId;}
    return sessionId;
  }
  async ensureRoleTurn(input: Parameters<NativeGasCityRuntime['ensureRoleTurn']>[0]) {
    const sessionId=await this.resolveRoleSession(input);
    const queued = await this.options.vk.queueFollowUp(sessionId, input.prompt, roleTurnQueueOptions(input));
    assertQueuedRoleTurn(queued.queued_item,sessionId,input);
    return { sessionId, queueItemRef: queued.queued_item.id };
  }
  async reconcileRoleTurn(input:Parameters<NativeGasCityRuntime['ensureRoleTurn']>[0]) {try{const sessionId=await this.resolveRoleSession(input);const item=await this.options.vk.findQueuedOperation(sessionId,`native-turn:${input.operationKey}`);if(!item)return null;assertQueuedRoleTurn(item,sessionId,input);return{sessionId,queueItemRef:item.id};}catch(error){if(error instanceof QueueIdentityError)throw error;return 'unknown' as const;}}
  async readAuthoritativeState(input: Parameters<NativeGasCityRuntime['readAuthoritativeState']>[0]):Promise<NativeGasCityAuthoritativeState> { const output=await this.exec(this.bd,['show',safeId(input.rootBeadId),'--json']);const value=JSON.parse(output);const record=Array.isArray(value)?value[0]:value;const status:NativeGasCityAuthoritativeState['status']=String(record?.status??'')==='closed'?'completed':String(record?.status??'')==='blocked'?'blocked':'running';return{workflowId:input.workflowId,rootBeadId:input.rootBeadId,sourceBeadId:input.sourceBeadId,status}; }
  async ensureTypedResult(input: Parameters<NativeGasCityRuntime['ensureTypedResult']>[0]) { const current=await this.readAuthoritativeState(input);if(current.status==='completed')return current;for(let pass=0;pass<3;pass++){const [listed,ready]=await Promise.all([this.exec(this.bd,['list','--json','--limit','100']),this.exec(this.bd,['ready','--json'])]);const readyIds=new Set((JSON.parse(ready) as any[]).map((item)=>item.id));const related=(JSON.parse(listed) as any[]).filter((item)=>item?.metadata?.['gc.root_bead_id']===input.rootBeadId&&item.status!=='closed'&&readyIds.has(item.id));for(const item of related)await this.exec(this.bd,['close',safeId(item.id),'--reason',input.summary,'--json'],{BEADS_ACTOR:'vd-workflows'});}await this.exec(this.bd,['close',safeId(input.rootBeadId),'--reason',input.summary,'--json'],{BEADS_ACTOR:'vd-workflows'});const completed=await this.readAuthoritativeState(input);if(completed.status!=='completed')throw new Error('Authoritative workflow result was not confirmed.');return completed; }
  async ensureResultNote(input: Parameters<NativeGasCityRuntime['ensureResultNote']>[0]) { const marker=`Workflow result ${sha(input.operationKey).slice(0,16)}`;const existing=await this.exec(this.bd,['comments',safeId(input.sourceBeadId),'--json']);if(existing.includes(marker))return{noteRef:`result:${sha(input.operationKey).slice(0,24)}`};await this.exec(this.bd, ['comments', 'add', safeId(input.sourceBeadId), '--', `${marker}\n\n${input.summary}`], { BEADS_ACTOR: 'vd-workflows' });return { noteRef: `result:${sha(input.operationKey).slice(0, 24)}` }; }
  async ensureTerminalCallback(input: { operationKey: string; request: WorkflowPlanRequest; run: NativeGasCityRunReadModel }) {
    const target = input.request.completionResponse; if (!target?.sessionId) return { callbackRef: null };
    const existing=await this.options.vk.upsertWorkflowCallback({ callback_key: input.operationKey, workspace_id: input.run.workspaceId, target_session_id: target.sessionId, kind: 'workflow_completion', workflow_run_id: input.run.runId, workflow_name: 'Native workflow' }) as any;
    if(existing?.status==='delivered')return{callbackRef:typeof existing.delivered_ref==='string'?existing.delivered_ref:input.operationKey};
    const queued = await this.options.vk.queueFollowUp(target.sessionId, `Workflow completed\n\nStatus: completed\nTask: ${input.run.sourceBeadId}\nOpen: ${input.run.url}`, { source: 'workflow', operationKey:`native-callback:${input.operationKey}`, provenance: { kind: 'workflow', label: 'Workflow completion response', workflow_run_id: input.run.runId } });
    await this.options.vk.updateWorkflowCallbackStatus(input.operationKey, { status: 'delivered', delivered_ref: queued.queued_item.id });
    return { callbackRef: queued.queued_item.id };
  }
  async reconcileEffect(input:{kind:string;request:any}):Promise<{outcome:'found';result:unknown}|{outcome:'absent'}|{outcome:'unknown'}>{
    try{
      if(input.kind==='bundle'){const digest=safeId(input.request.bundleDigest);const bytes=await readFile(join(this.root,'bundles',digest,'bundle.json')).catch((error:any)=>error?.code==='ENOENT'?null:Promise.reject(error));return bytes?sha(bytes)===digest?{outcome:'found',result:{bundleRef:digest}}:{outcome:'unknown'}:{outcome:'absent'};}
      if(input.kind==='workflow'){const state=await this.reconcileWorkflow({operationKey:input.request.operationKey??input.request.idempotencyKey,bundleRef:input.request.bundleRef,sourceBeadId:input.request.sourceBeadId});return state==='unknown'?{outcome:'unknown'}:state?{outcome:'found',result:state}:{outcome:'absent'};}
      if(input.kind==='role_turn'){const turn=await this.reconcileRoleTurn(input.request);return turn==='unknown'?{outcome:'unknown'}:turn?{outcome:'found',result:turn}:{outcome:'absent'};}
      if(input.kind==='typed_result'){const state=await this.readAuthoritativeState(input.request);return state.status==='completed'?{outcome:'found',result:state}:{outcome:'absent'};}
      if(input.kind==='result_note'){const marker=`Workflow result ${sha(input.request.operationKey).slice(0,16)}`;const comments=await this.exec(this.bd,['comments',safeId(input.request.sourceBeadId),'--json']);return comments.includes(marker)?{outcome:'found',result:{noteRef:`result:${sha(input.request.operationKey).slice(0,24)}`}}:{outcome:'absent'};}
      if(input.kind==='terminal_callback'){const target=input.request.request?.completionResponse;if(!target?.sessionId)return{outcome:'found',result:{callbackRef:null}};const item=await this.options.vk.findQueuedOperation(target.sessionId,`native-callback:${input.request.operationKey}`);return item?{outcome:'found',result:{callbackRef:item.id}}:{outcome:'absent'};}
      return{outcome:'unknown'};
    }catch{return{outcome:'unknown'};}
  }
  private async exec(file: string, args: string[], extraEnv: Record<string,string> = {}) { const result = await run(file, args, { cwd: file===this.bd?this.beadsDirectory:this.city, timeout: 30_000, maxBuffer: 1024 * 1024, env: { HOME: process.env.HOME || '/tmp', PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', ...extraEnv } }); return result.stdout; }
  private assertManagedRoot(candidate:string){const controlled=realpathSync(process.env.VD_RUNTIME_ROOT!);const actual=realpathSync(candidate);if(actual!==controlled&&!actual.startsWith(`${controlled}${sep}`))throw new Error('Native workflow runtime root is not server-controlled.');const stat=lstatSync(candidate);if(stat.isSymbolicLink()||!stat.isDirectory()||stat.uid!==process.getuid?.())throw new Error('Native workflow runtime ownership is invalid.');}
  private async ensurePrivateDirectory(candidate:string,parent:string){this.assertManagedRoot(parent);try{await mkdir(candidate,{mode:0o700});}catch(error:any){if(error?.code!=='EEXIST')throw error;}this.assertManagedRoot(candidate);await chmod(candidate,0o700);}
  private async atomicInstall(final:string,bytes:Uint8Array){const parent=resolve(final,'..');this.assertManagedRoot(parent);const tmp=join(parent,`.install-${process.pid}-${randomUUID()}`);await writeFile(tmp,bytes,{mode:0o600,flag:'wx'});try{await chmod(tmp,0o600);this.assertManagedRoot(parent);try{await link(tmp,final);}catch(error:any){if(error?.code!=='EEXIST')throw error;}}finally{await unlink(tmp).catch(()=>undefined);}}
}

export function createProductionNativeGasCityRuntime(input: { vk: VibeKanbanServerClient; resolver: WorkflowRoleSessionResolver }): PackagedNativeGasCityRuntime | null {
  const root = process.env.VD_GAS_CITY_NATIVE_BUNDLE_ROOT, city = process.env.VD_GAS_CITY_CITY_ROOT, beadsDirectory=process.env.VD_GAS_CITY_BEADS_ROOT,target = process.env.VD_GAS_CITY_TARGET,manifestPath=process.env.VD_GAS_CITY_RUNTIME_MANIFEST||'/usr/local/share/vd/gas-city-runtime.json';
  if (!root || !city || !beadsDirectory||!target || !process.env.VD_RUNTIME_ROOT) return null;
  try{const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));for(const [pathKey,digestKey] of [['gasCityExecutable','gasCityExecutableSha256'],['beadsExecutable','beadsExecutableSha256']] as const){const path=realpathSync(String(manifest[pathKey]));if(sha(readFileSync(path))!==manifest[digestKey])throw new Error('digest mismatch');manifest[pathKey]=path;}return new PackagedNativeGasCityRuntime({ root, city,beadsDirectory,target, gcExecutable: manifest.gasCityExecutable, beadsExecutable: manifest.beadsExecutable, ...input });}catch{throw new Error('Verified packaged workflow runtime is unavailable.');}
}
function parseObject(text:string): Record<string,unknown> { const value=JSON.parse(text); if (!value || typeof value !== 'object') throw new Error('Workflow engine returned an invalid response.'); return value; }
function nativeState(value:Record<string,unknown>, source:string):NativeGasCityAuthoritativeState { const workflowId=String(value.workflow_id ?? value.workflowId ?? value.id ?? ''); const rootBeadId=String(value.root_bead_id ?? value.rootBeadId ?? value.bead_id ?? value.root ?? ''); if(!workflowId||!rootBeadId) throw new Error('Workflow engine did not return authoritative linkage.'); return {workflowId:safeId(workflowId),rootBeadId:safeId(rootBeadId),sourceBeadId:safeId(source),status:'running'}; }
function safeId(value:string){if(!/^[A-Za-z0-9_.:@-]+$/.test(value))throw new Error('Workflow identifier is invalid.');return value;}
function safeTarget(value:string){if(!/^[A-Za-z0-9_.:@-]+(?:\/[A-Za-z0-9_.:@-]+)?$/.test(value))throw new Error('Workflow target is invalid.');return value;}
function sha(value:string|Uint8Array){return createHash('sha256').update(value).digest('hex');}
class QueueIdentityError extends Error{}
function roleTurnQueueOptions(input:Parameters<NativeGasCityRuntime['ensureRoleTurn']>[0]){return{source:input.queue.source,operationKey:input.queue.operationKey,priority:input.queue.priority,sessionCommand:input.queue.sessionCommand,provenance:input.queue.provenance,executorConfig:input.executor?{executor:input.executor as Executor,model_id:input.model,reasoning_id:input.reasoningId}:undefined};}
function assertQueuedRoleTurn(item:QueuedMessage,sessionId:string,input:Parameters<NativeGasCityRuntime['ensureRoleTurn']>[0]){const expected=roleTurnQueueOptions(input);if(item.status==='failed'||item.status==='cancelled')throw new QueueIdentityError(`The durable role turn is not in an acceptable state.${item.last_error?` ${item.last_error}`:''}`);const normalizeConfig=(value:any)=>value?{executor:value.executor,variant:value.variant??null,model_id:value.model_id??null,agent_id:value.agent_id??null,reasoning_id:value.reasoning_id??null,permission_policy:value.permission_policy??null}:null;const normalizeProvenance=(value:any)=>value?{kind:value.kind,label:value.label,workflow_run_id:value.workflow_run_id??null,workflow_role_id:value.workflow_role_id??null,workflow_name:value.workflow_name??null,workflow_design_id:value.workflow_design_id??null,workflow_version:value.workflow_version==null?null:Number(value.workflow_version)}:null;const actual={sessionId:item.session_id,workspaceId:item.workspace_id,operationKey:item.data.operation_key??null,message:item.data.message,executorConfig:normalizeConfig(item.data.executor_config),provenance:normalizeProvenance(item.data.provenance),source:item.source,sessionCommand:item.data.session_command??null,priority:Number(item.priority)};const wanted={sessionId,workspaceId:input.workspaceId,operationKey:expected.operationKey,message:input.prompt,executorConfig:normalizeConfig(expected.executorConfig),provenance:normalizeProvenance(expected.provenance),source:expected.source,sessionCommand:expected.sessionCommand,priority:expected.priority};if(JSON.stringify(actual)!==JSON.stringify(wanted))throw new QueueIdentityError('The durable role turn identity does not match the confirmed workflow.');}
