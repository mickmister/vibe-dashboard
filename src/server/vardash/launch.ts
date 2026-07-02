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
