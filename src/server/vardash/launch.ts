import { randomUUID } from 'node:crypto';
import { spawn as nodeSpawn } from 'node:child_process';
import { resolveVardashRepoEnv } from './resolver';
import type { RepoEnvKeyMetadata, RepoProcessDefinitionMetadata, VardashStore, VardashValueKind } from './store';
import {
  buildVarlockRunCommand,
  generateVardashVarlockSchema,
  vardashKeyToVarlockSchemaKey,
  type VarlockRunCommand,
} from './varlock-spike';

export interface PrepareVardashRepoProcessLaunchInput {
  store: VardashStore;
  workspaceId: string;
  repoId: string;
  processDefinitionId?: string;
  processName?: string;
  baseEnv?: Record<string, string | undefined>;
  allowBaseEnvKeys?: readonly string[];
  useVarlock?: boolean;
  varlockSchemaPath?: string;
  varlockBin?: string;
}

export interface VardashLaunchReadinessInput {
  store: VardashStore;
  workspaceId: string;
  repoId: string;
  processDefinitionId?: string;
  processName?: string;
  useVarlock?: boolean;
}

export interface VardashLaunchReadinessProcess {
  id: string;
  repoId: string;
  name: string;
  source: RepoProcessDefinitionMetadata['source'];
  isDefault: boolean;
}

export interface VardashLaunchReadinessSelectedValue {
  key: string;
  kind: VardashValueKind;
  savedValueId: string | null;
  savedValueName: string | null;
}

export interface VardashLaunchReadiness {
  workspaceId: string;
  repoId: string;
  eligible: boolean;
  process: VardashLaunchReadinessProcess | null;
  missingRequired: Array<Pick<RepoEnvKeyMetadata, 'id' | 'key' | 'kind' | 'required' | 'description'>>;
  selectedValues: VardashLaunchReadinessSelectedValue[];
  varlock: {
    enabled: boolean;
    configured: boolean;
    available: boolean | null;
    reason?: string;
  };
  selectionSemantics: 'workspace-null-inherits-repo-default';
  normalAgentEnvIncludesVardashSecrets: false;
}

export type VardashLaunchRunStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';

export interface VardashLaunchProcessStatus {
  runId: string;
  workspaceId: string;
  repoId: string;
  process: VardashLaunchReadinessProcess;
  status: VardashLaunchRunStatus;
  startedAt: string | null;
  stoppedAt: string | null;
  exitCode: number | null;
  error?: string;
}

export interface VardashLaunchStarted {
  runId: string;
  status: Extract<VardashLaunchRunStatus, 'starting' | 'running'>;
}

export interface VardashLaunchStopResult {
  runId: string;
  status: Extract<VardashLaunchRunStatus, 'stopping' | 'stopped'>;
}

export interface VardashProcessSpawnOptions {
  cwd?: string;
  env: Record<string, string>;
  stdio: 'ignore';
}

export interface VardashChildProcess {
  kill(signal?: NodeJS.Signals): boolean;
  on(event: 'spawn', listener: () => void): this;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

export interface VardashProcessSpawner {
  spawn(command: string, args: string[], options: VardashProcessSpawnOptions): VardashChildProcess;
}

export interface VardashLaunchRunnerOptions {
  spawner?: VardashProcessSpawner;
  idGenerator?: () => string;
  now?: () => Date;
}

export interface VardashRepoProcessLaunchPlan {
  workspaceId: string;
  repoId: string;
  process: RepoProcessDefinitionMetadata;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string | null;
  missingRequired: string[];
  varlock?: {
    schemaPath: string;
    schema: string;
    command: VarlockRunCommand;
  };
}

export class VardashLaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VardashLaunchError';
  }
}

const DEFAULT_BASE_ENV_KEYS = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL'];

const NODE_VARDASH_PROCESS_SPAWNER: VardashProcessSpawner = {
  spawn(command, args, options) {
    return nodeSpawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.stdio,
    });
  },
};

export class VardashLaunchRunner {
  private readonly spawner: VardashProcessSpawner;
  private readonly idGenerator: () => string;
  private readonly now: () => Date;
  private readonly runs = new Map<string, { status: VardashLaunchProcessStatus; child: VardashChildProcess }>();

  constructor(options: VardashLaunchRunnerOptions = {}) {
    this.spawner = options.spawner ?? NODE_VARDASH_PROCESS_SPAWNER;
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  launch(plan: VardashRepoProcessLaunchPlan): VardashLaunchStarted {
    const runId = this.idGenerator();
    const startedAt = this.now().toISOString();
    const child = this.spawner.spawn(plan.command, plan.args, {
      cwd: plan.cwd ?? undefined,
      env: plan.env,
      stdio: 'ignore',
    });
    const status: VardashLaunchProcessStatus = {
      runId,
      workspaceId: plan.workspaceId,
      repoId: plan.repoId,
      process: readinessProcess(plan.process),
      status: 'running',
      startedAt,
      stoppedAt: null,
      exitCode: null,
    };
    this.runs.set(runId, { status, child });
    child.on('exit', (code) => {
      const current = this.runs.get(runId);
      if (!current) return;
      current.status.status = current.status.status === 'stopping' || code === 0 ? 'stopped' : 'failed';
      current.status.exitCode = code;
      current.status.stoppedAt = this.now().toISOString();
    });
    child.on('error', () => {
      const current = this.runs.get(runId);
      if (!current) return;
      current.status.status = 'failed';
      current.status.error = 'process_error';
      current.status.stoppedAt = this.now().toISOString();
    });
    return { runId, status: 'running' };
  }

  getStatus(runId: string): VardashLaunchProcessStatus {
    const run = this.runs.get(runId);
    if (!run) throw new VardashLaunchError('Vardash launch run not found');
    return { ...run.status, process: { ...run.status.process } };
  }

  stop(runId: string): VardashLaunchStopResult {
    const run = this.runs.get(runId);
    if (!run) throw new VardashLaunchError('Vardash launch run not found');
    if (run.status.status === 'stopped' || run.status.status === 'failed') {
      return { runId, status: 'stopped' };
    }
    run.status.status = 'stopping';
    run.child.kill('SIGTERM');
    return { runId, status: 'stopping' };
  }
}


export async function getVardashLaunchReadiness(
  input: VardashLaunchReadinessInput,
): Promise<VardashLaunchReadiness> {
  const process = await selectRepoProcessDefinition(input).catch((error) => {
    if (
      !input.processDefinitionId
      && !input.processName
      && error instanceof VardashLaunchError
      && error.message.startsWith('No vardash process definition')
    ) {
      return null;
    }
    throw error;
  });
  const resolved = await resolveVardashRepoEnv({
    store: input.store,
    workspaceId: input.workspaceId,
    repoId: input.repoId,
  });

  return {
    workspaceId: input.workspaceId,
    repoId: input.repoId,
    eligible: process != null && resolved.canLaunch,
    process: process ? readinessProcess(process) : null,
    missingRequired: resolved.missingRequired.map((key) => ({
      id: key.id,
      key: key.key,
      kind: key.kind,
      required: key.required,
      description: key.description,
    })),
    selectedValues: resolved.metadata.map((entry) => ({
      key: entry.key,
      kind: entry.kind,
      savedValueId: entry.savedValueId,
      savedValueName: entry.savedValueName,
    })),
    varlock: {
      enabled: input.useVarlock === true,
      configured: input.useVarlock === true,
      available: null,
    },
    selectionSemantics: resolved.selectionSemantics,
    normalAgentEnvIncludesVardashSecrets: false,
  };
}

export async function prepareVardashRepoProcessLaunch(
  input: PrepareVardashRepoProcessLaunchInput,
): Promise<VardashRepoProcessLaunchPlan> {
  const process = await selectRepoProcessDefinition(input);
  const resolved = await resolveVardashRepoEnv({
    store: input.store,
    workspaceId: input.workspaceId,
    repoId: input.repoId,
  });
  const missingRequired = resolved.missingRequired.map((key) => key.key);
  if (missingRequired.length > 0) {
    throw new VardashLaunchError(`Missing required vardash env values: ${missingRequired.join(', ')}`);
  }

  const childCommand: [string, ...string[]] = ['sh', '-lc', process.command];
  const env = buildIsolatedVardashLaunchEnv({
    baseEnv: input.baseEnv,
    repoEnv: resolved.env,
    allowBaseEnvKeys: input.allowBaseEnvKeys,
  });

  if (input.useVarlock === true) {
    if (!input.varlockSchemaPath) throw new VardashLaunchError('Varlock schema path is required when Varlock is enabled');
    const keys = await input.store.listRepoEnvKeys(input.repoId);
    const schema = generateVardashVarlockSchema(keys.map(vardashKeyToVarlockSchemaKey));
    const varlock = buildVarlockRunCommand({
      schemaPath: input.varlockSchemaPath,
      command: childCommand,
      varlockBin: input.varlockBin,
    });
    return {
      workspaceId: input.workspaceId,
      repoId: input.repoId,
      process,
      command: varlock.command,
      args: varlock.args,
      env,
      cwd: process.cwd,
      missingRequired,
      varlock: { schemaPath: input.varlockSchemaPath, schema, command: varlock },
    };
  }

  return {
    workspaceId: input.workspaceId,
    repoId: input.repoId,
    process,
    command: childCommand[0],
    args: childCommand.slice(1),
    env,
    cwd: process.cwd,
    missingRequired,
  };
}

export function buildIsolatedVardashLaunchEnv(input: {
  baseEnv?: Record<string, string | undefined>;
  repoEnv: Record<string, string>;
  allowBaseEnvKeys?: readonly string[];
}): Record<string, string> {
  return {
    ...pickAllowedBaseEnv(input.baseEnv ?? process.env, input.allowBaseEnvKeys),
    ...input.repoEnv,
  };
}

export function buildNormalAgentExecutionEnv(input: {
  baseEnv?: Record<string, string | undefined>;
  allowBaseEnvKeys?: readonly string[];
} = {}): Record<string, string> {
  return pickAllowedBaseEnv(input.baseEnv ?? process.env, input.allowBaseEnvKeys);
}

async function selectRepoProcessDefinition(input: PrepareVardashRepoProcessLaunchInput): Promise<RepoProcessDefinitionMetadata> {
  const processes = await input.store.listRepoProcessDefinitions(input.repoId);
  if (input.processDefinitionId) {
    const selectedById = processes.find((process) => process.id === input.processDefinitionId);
    if (!selectedById) throw new VardashLaunchError(`No vardash process definition found for repo ${input.repoId}`);
    return selectedById;
  }
  if (input.processName) {
    const selectedByName = processes.find((process) => process.name === input.processName);
    if (!selectedByName) throw new VardashLaunchError(`No vardash process definition found for repo ${input.repoId}`);
    return selectedByName;
  }
  const selected = processes.find((process) => process.isDefault) ?? processes[0];
  if (!selected) throw new VardashLaunchError(`No vardash process definition found for repo ${input.repoId}`);
  return selected;
}

function readinessProcess(process: RepoProcessDefinitionMetadata): VardashLaunchReadinessProcess {
  return {
    id: process.id,
    repoId: process.repoId,
    name: process.name,
    source: process.source,
    isDefault: process.isDefault,
  };
}

function pickAllowedBaseEnv(
  baseEnv: Record<string, string | undefined>,
  allowBaseEnvKeys: readonly string[] = DEFAULT_BASE_ENV_KEYS,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of allowBaseEnvKeys) {
    const value = baseEnv[key];
    if (typeof value === 'string') env[key] = value;
  }
  return env;
}
