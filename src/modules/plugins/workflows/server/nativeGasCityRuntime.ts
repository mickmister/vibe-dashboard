import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { WorkflowRoleSessionResolver } from '../../../../server/role-session-resolver';
import type { VibeKanbanServerClient, Executor } from '../../../../server/vk-client';
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
  constructor(private readonly options: {
    root: string; city: string; target: string; gcExecutable: string; beadsExecutable: string;
    vk: VibeKanbanServerClient; resolver: WorkflowRoleSessionResolver;
  }) {
    this.root = resolve(options.root); this.city = resolve(options.city); this.target = safeId(options.target);
    this.gc = resolve(options.gcExecutable); this.bd = resolve(options.beadsExecutable);
    if (!this.root.startsWith(`${resolve(process.env.VD_RUNTIME_ROOT || dirname(this.root))}${sep}`) && this.root !== resolve(process.env.VD_RUNTIME_ROOT || dirname(this.root))) throw new Error('Native workflow runtime root is not server-controlled.');
  }
  async health() {
    try {
      const [gc, bd] = await Promise.all([this.exec(this.gc, ['version']), this.exec(this.bd, ['version'])]);
      return gc.includes('1.4.1') && bd.includes('1.2.2') ? { ready: true } : { ready: false, message: 'Workflow engine version does not match the tested runtime.' };
    } catch { return { ready: false, message: 'Workflow engine is not available.' }; }
  }
  async ensureBundle(input: Parameters<NativeGasCityRuntime['ensureBundle']>[0]) {
    const dir = join(this.root, 'bundles', input.bundle.digest); const final = join(dir, 'bundle.json');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try { const bytes = await readFile(final); if (sha(bytes) !== input.bundle.digest) throw new Error('Installed workflow bundle does not match its confirmed digest.'); }
    catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      const tmp = `${final}.${process.pid}.tmp`; await writeFile(tmp, input.bundle.bytes, { mode: 0o600, flag: 'wx' }); await chmod(tmp, 0o600); await rename(tmp, final);
    }
    const installed=JSON.parse(await readFile(final,'utf8')) as any;
    const formula = String(installed?.formula?.contents ?? '');
    const formulaName = formula.match(/^name\s*=\s*"([A-Za-z0-9_.-]+)"/m)?.[1];
    if (!formulaName) throw new Error('Confirmed workflow bundle has no formula identity.');
    const formulaDir = join(this.city, 'formulas'); await mkdir(formulaDir, { recursive: true, mode: 0o700 });
    const formulaPath = join(formulaDir, `${safeId(formulaName)}.formula.toml`); const formulaBytes = new TextEncoder().encode(formula);
    try { if (sha(await readFile(formulaPath)) !== sha(formulaBytes)) throw new Error('Installed workflow formula conflicts with the confirmed bundle.'); }
    catch (error:any) { if(error?.code!=='ENOENT')throw error; const tmp=`${formulaPath}.${process.pid}.tmp`;await writeFile(tmp,formulaBytes,{mode:0o600,flag:'wx'});await rename(tmp,formulaPath); }
    return { bundleRef: input.bundle.digest };
  }
  async ensureWorkflow(input: Parameters<NativeGasCityRuntime['ensureWorkflow']>[0]): Promise<NativeGasCityAuthoritativeState> {
    const bundle = JSON.parse(await readFile(join(this.root, 'bundles', input.bundleRef, 'bundle.json'), 'utf8')) as any;
    const formula=String(bundle?.formula?.contents??'');const formulaName=safeId(formula.match(/^name\s*=\s*"([A-Za-z0-9_.-]+)"/m)?.[1]??'');
    const output = await this.exec(this.gc, ['sling', this.target, safeId(input.sourceBeadId), '--on', formulaName, '--scope-kind', 'vd-workflow', '--scope-ref', safeId(input.operationKey), '--city', this.city, '--json']);
    const parsed = parseObject(output);
    return nativeState(parsed, input.sourceBeadId);
  }
  async reconcileWorkflow(input: Parameters<NativeGasCityRuntime['reconcileWorkflow']>[0]) {
    if (!input.bundleRef) return null;
    try { return await this.ensureWorkflow({ operationKey: input.operationKey, bundleRef: input.bundleRef, sourceBeadId: input.sourceBeadId }); }
    catch { return 'unknown' as const; }
  }
  async ensureRoleTurn(input: Parameters<NativeGasCityRuntime['ensureRoleTurn']>[0]) {
    const team = { id: `native-${input.operationKey}`, name: 'Native workflow', agents: [{ id: input.roleId, role: input.roleId, displayName: input.roleId, executor: input.executor || 'CODEX' }] } as any;
    const overrides = input.binding?.mode === 'existing' ? { [input.roleId]: { sessionId: input.binding.sessionId! } } : undefined;
    const resolution = await this.options.resolver.resolve({ team, workspaceId: input.workspaceId, roleIds: [input.roleId], overrides, allowAutoCreate: true, persistBindings: true });
    const role = resolution.results[0]; if (!resolution.ok || !role?.sessionId) throw new Error('The workflow role session could not be resolved.');
    const queued = await this.options.vk.queueFollowUp(role.sessionId, input.prompt, { source: 'workflow', provenance: { kind: 'workflow', label: 'Native workflow role turn', workflow_run_id: input.operationKey, workflow_role_id: input.roleId }, executorConfig: input.executor ? { executor: input.executor as Executor, model_id: input.model, reasoning_id: input.reasoningId } : undefined });
    return { sessionId: role.sessionId, queueItemRef: queued.queued_item.id };
  }
  async reconcileRoleTurn() { return 'unknown' as const; }
  async readAuthoritativeState(input: Parameters<NativeGasCityRuntime['readAuthoritativeState']>[0]):Promise<NativeGasCityAuthoritativeState> { const output=await this.exec(this.bd,['show',safeId(input.rootBeadId),'--json']);const value=JSON.parse(output);const record=Array.isArray(value)?value[0]:value;const status:NativeGasCityAuthoritativeState['status']=String(record?.status??'')==='closed'?'completed':String(record?.status??'')==='blocked'?'blocked':'running';return{workflowId:input.workflowId,rootBeadId:input.rootBeadId,sourceBeadId:input.sourceBeadId,status}; }
  async ensureTypedResult(input: Parameters<NativeGasCityRuntime['ensureTypedResult']>[0]) { const current=await this.readAuthoritativeState(input);if(current.status==='completed')return current;await this.exec(this.bd,['close',safeId(input.rootBeadId),'--reason',input.summary,'--json'],{BEADS_ACTOR:'vd-workflows'});const completed=await this.readAuthoritativeState(input);if(completed.status!=='completed')throw new Error('Authoritative workflow result was not confirmed.');return completed; }
  async ensureResultNote(input: Parameters<NativeGasCityRuntime['ensureResultNote']>[0]) { const marker=`Workflow result ${sha(input.operationKey).slice(0,16)}`;const existing=await this.exec(this.bd,['comments',safeId(input.sourceBeadId),'--json']);if(existing.includes(marker))return{noteRef:`result:${sha(input.operationKey).slice(0,24)}`};await this.exec(this.bd, ['comments', 'add', safeId(input.sourceBeadId), '--', `${marker}\n\n${input.summary}`], { BEADS_ACTOR: 'vd-workflows' });return { noteRef: `result:${sha(input.operationKey).slice(0, 24)}` }; }
  async ensureTerminalCallback(input: { operationKey: string; request: WorkflowPlanRequest; run: NativeGasCityRunReadModel }) {
    const target = input.request.completionResponse; if (!target?.sessionId) return { callbackRef: null };
    const existing=await this.options.vk.upsertWorkflowCallback({ callback_key: input.operationKey, workspace_id: input.run.workspaceId, target_session_id: target.sessionId, kind: 'workflow_completion', workflow_run_id: input.run.runId, workflow_name: 'Native workflow' }) as any;
    if(existing?.status==='delivered')return{callbackRef:typeof existing.delivered_ref==='string'?existing.delivered_ref:input.operationKey};
    const queued = await this.options.vk.queueFollowUp(target.sessionId, `Workflow completed\n\nStatus: completed\nTask: ${input.run.sourceBeadId}\nOpen: ${input.run.url}`, { source: 'workflow', provenance: { kind: 'workflow', label: 'Workflow completion response', workflow_run_id: input.run.runId } });
    await this.options.vk.updateWorkflowCallbackStatus(input.operationKey, { status: 'delivered', delivered_ref: queued.queued_item.id });
    return { callbackRef: queued.queued_item.id };
  }
  private async exec(file: string, args: string[], extraEnv: Record<string,string> = {}) { const result = await run(file, args, { cwd: this.city, timeout: 30_000, maxBuffer: 1024 * 1024, env: { HOME: process.env.HOME || '/tmp', PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', ...extraEnv } }); return result.stdout; }
}

export function createProductionNativeGasCityRuntime(input: { vk: VibeKanbanServerClient; resolver: WorkflowRoleSessionResolver }): PackagedNativeGasCityRuntime | null {
  const root = process.env.VD_GAS_CITY_NATIVE_BUNDLE_ROOT, city = process.env.VD_GAS_CITY_CITY_ROOT, target = process.env.VD_GAS_CITY_TARGET;
  if (!root || !city || !target) return null;
  return new PackagedNativeGasCityRuntime({ root, city, target, gcExecutable: process.env.VD_GAS_CITY_EXECUTABLE || '/usr/local/bin/gc', beadsExecutable: process.env.VD_BEADS_EXECUTABLE || '/usr/local/bin/bd', ...input });
}
function parseObject(text:string): Record<string,unknown> { const value=JSON.parse(text); if (!value || typeof value !== 'object') throw new Error('Workflow engine returned an invalid response.'); return value; }
function nativeState(value:Record<string,unknown>, source:string):NativeGasCityAuthoritativeState { const workflowId=String(value.workflow_id ?? value.workflowId ?? value.id ?? ''); const rootBeadId=String(value.root_bead_id ?? value.rootBeadId ?? value.root ?? ''); if(!workflowId||!rootBeadId) throw new Error('Workflow engine did not return authoritative linkage.'); return {workflowId:safeId(workflowId),rootBeadId:safeId(rootBeadId),sourceBeadId:safeId(source),status:'running'}; }
function safeId(value:string){if(!/^[A-Za-z0-9_.:@-]+$/.test(value))throw new Error('Workflow identifier is invalid.');return value;}
function sha(value:string|Uint8Array){return createHash('sha256').update(value).digest('hex');}
