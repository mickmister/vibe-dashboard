import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  assertPluginServiceCatalog,
  type PluginServiceCatalog,
  type PluginServiceDefinition,
} from './plugin-service-orchestrator.ts';

const execFile = promisify(execFileCallback);
const CONFIG_FILE_NAME = 'plugins.json';

export interface AddInstancePluginDryRunPlan {
  configPath: string;
  action: 'create-config' | 'add-plugin' | 'update-plugin' | 'unchanged';
  pluginId: string;
  beforePluginCount: number;
  afterPluginCount: number;
  gitActions: string[];
}

export interface ApplyInstancePluginResult extends AddInstancePluginDryRunPlan {
  committed: boolean;
  pushed: boolean;
  commitMessage?: string;
}

export interface SetInstancePluginEnabledDryRunPlan {
  configPath: string;
  action: 'create-config' | 'set-plugin-state' | 'unchanged';
  pluginId: string;
  beforeEnable: boolean;
  afterEnable: boolean;
  gitActions: string[];
}

export interface ApplyInstancePluginEnabledResult extends SetInstancePluginEnabledDryRunPlan {
  committed: boolean;
  pushed: boolean;
  commitMessage?: string;
}

export interface CommandRunner {
  (command: string, args: string[], options: { cwd: string }): Promise<void>;
}

export async function createAddInstancePluginDryRunPlan(input: {
  configRepoDir: string;
  plugin: PluginServiceDefinition;
}): Promise<AddInstancePluginDryRunPlan> {
  assertPluginServiceCatalog({ plugins: [input.plugin] });
  const configPath = join(input.configRepoDir, CONFIG_FILE_NAME);
  const existing = await readInstancePluginCatalog(configPath);
  const next = upsertPlugin(existing.catalog, input.plugin);

  return {
    configPath,
    action: existing.exists || next.action === 'unchanged' ? next.action : 'create-config',
    pluginId: input.plugin.id,
    beforePluginCount: existing.catalog.plugins.length,
    afterPluginCount: next.catalog.plugins.length,
    gitActions: ['git init', 'git config local author defaults', `git add ${CONFIG_FILE_NAME}`, 'git commit', 'git push when requested'],
  };
}

export async function applyAddInstancePlugin(input: {
  configRepoDir: string;
  plugin: PluginServiceDefinition;
  commitMessage?: string;
  push?: boolean;
  runCommand?: CommandRunner;
}): Promise<ApplyInstancePluginResult> {
  const configPath = join(input.configRepoDir, CONFIG_FILE_NAME);
  const existing = await readInstancePluginCatalog(configPath);
  const next = upsertPlugin(existing.catalog, input.plugin);
  const dryRun = await createAddInstancePluginDryRunPlan({ configRepoDir: input.configRepoDir, plugin: input.plugin });

  if (next.action === 'unchanged') {
    return { ...dryRun, committed: false, pushed: false };
  }

  await mkdir(input.configRepoDir, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(next.catalog, null, 2)}\n`);

  const runCommand = input.runCommand ?? defaultCommandRunner;
  const commitMessage = input.commitMessage ?? `Update VD plugin config for ${input.plugin.id}`;
  await commitConfigChange({
    configRepoDir: input.configRepoDir,
    commitMessage,
    runCommand,
  });

  let pushed = false;
  if (input.push) {
    await runCommand('git', ['push'], { cwd: input.configRepoDir });
    pushed = true;
  }

  return {
    ...dryRun,
    committed: true,
    pushed,
    commitMessage,
  };
}

export async function createSetInstancePluginEnabledDryRunPlan(input: {
  configRepoDir: string;
  pluginId: string;
  enable: boolean;
}): Promise<SetInstancePluginEnabledDryRunPlan> {
  const configPath = join(input.configRepoDir, CONFIG_FILE_NAME);
  const existing = await readInstancePluginCatalog(configPath);
  const next = setPluginEnabled(existing.catalog, input.pluginId, input.enable);

  return {
    configPath,
    action: existing.exists || next.action === 'unchanged' ? next.action : 'create-config',
    pluginId: input.pluginId,
    beforeEnable: next.beforeEnable,
    afterEnable: input.enable,
    gitActions: ['git init', 'git config local author defaults', `git add ${CONFIG_FILE_NAME}`, 'git commit', 'git push when requested'],
  };
}

export async function applySetInstancePluginEnabled(input: {
  configRepoDir: string;
  pluginId: string;
  enable: boolean;
  commitMessage?: string;
  push?: boolean;
  runCommand?: CommandRunner;
}): Promise<ApplyInstancePluginEnabledResult> {
  const configPath = join(input.configRepoDir, CONFIG_FILE_NAME);
  const existing = await readInstancePluginCatalog(configPath);
  const next = setPluginEnabled(existing.catalog, input.pluginId, input.enable);
  const dryRun = await createSetInstancePluginEnabledDryRunPlan({
    configRepoDir: input.configRepoDir,
    pluginId: input.pluginId,
    enable: input.enable,
  });

  if (next.action === 'unchanged') {
    return { ...dryRun, committed: false, pushed: false };
  }

  await mkdir(input.configRepoDir, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(next.catalog, null, 2)}\n`);

  const runCommand = input.runCommand ?? defaultCommandRunner;
  const commitMessage = input.commitMessage ?? `Set VD plugin ${input.pluginId} ${input.enable ? 'enabled' : 'disabled'}`;
  await commitConfigChange({
    configRepoDir: input.configRepoDir,
    commitMessage,
    runCommand,
  });

  let pushed = false;
  if (input.push) {
    await runCommand('git', ['push'], { cwd: input.configRepoDir });
    pushed = true;
  }

  return {
    ...dryRun,
    committed: true,
    pushed,
    commitMessage,
  };
}

export async function readInstancePluginCatalog(configPath: string): Promise<{ exists: boolean; catalog: PluginServiceCatalog }> {
  try {
    const raw = await readFile(configPath, 'utf8');
    const catalog = assertPluginServiceCatalog(JSON.parse(raw));
    return {
      exists: true,
      catalog: {
        plugins: [...catalog.plugins],
        ...(catalog.pluginStates !== undefined ? { pluginStates: clonePluginStates(catalog.pluginStates) } : {}),
      },
    };
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return { exists: false, catalog: { plugins: [] } };
    throw error;
  }
}

function upsertPlugin(catalog: PluginServiceCatalog, plugin: PluginServiceDefinition): {
  action: AddInstancePluginDryRunPlan['action'];
  catalog: PluginServiceCatalog;
} {
  const index = catalog.plugins.findIndex((candidate) => candidate.id === plugin.id);
  const pluginStates = catalog.pluginStates !== undefined ? { pluginStates: clonePluginStates(catalog.pluginStates) } : {};
  if (index === -1) return { action: 'add-plugin', catalog: { plugins: [...catalog.plugins, plugin], ...pluginStates } };

  const existing = catalog.plugins[index]!;
  if (JSON.stringify(existing) === JSON.stringify(plugin)) return { action: 'unchanged', catalog };

  const plugins = [...catalog.plugins];
  plugins[index] = plugin;
  return { action: 'update-plugin', catalog: { plugins, ...pluginStates } };
}

function setPluginEnabled(catalog: PluginServiceCatalog, pluginId: string, enable: boolean): {
  action: SetInstancePluginEnabledDryRunPlan['action'];
  beforeEnable: boolean;
  catalog: PluginServiceCatalog;
} {
  const beforeEnable = catalog.pluginStates?.[pluginId]?.enable ?? true;
  if (beforeEnable === enable) {
    return { action: 'unchanged', beforeEnable, catalog };
  }

  const catalogWithState: PluginServiceCatalog = {
    plugins: [...catalog.plugins],
    pluginStates: {
      ...(catalog.pluginStates !== undefined ? clonePluginStates(catalog.pluginStates) : {}),
      [pluginId]: { enable },
    },
  };
  assertPluginServiceCatalog(catalogWithState);
  return { action: 'set-plugin-state', beforeEnable, catalog: catalogWithState };
}

function clonePluginStates(pluginStates: NonNullable<PluginServiceCatalog['pluginStates']>): NonNullable<PluginServiceCatalog['pluginStates']> {
  return Object.fromEntries(Object.entries(pluginStates).map(([pluginId, pluginState]) => [pluginId, { ...pluginState }]));
}

async function defaultCommandRunner(command: string, args: string[], options: { cwd: string }): Promise<void> {
  await execFile(command, args, { cwd: options.cwd });
}

async function commitConfigChange(input: {
  configRepoDir: string;
  commitMessage: string;
  runCommand: CommandRunner;
}): Promise<void> {
  await input.runCommand('git', ['init'], { cwd: input.configRepoDir });
  await input.runCommand('git', ['config', 'user.email', 'vd-instance@localhost'], { cwd: input.configRepoDir });
  await input.runCommand('git', ['config', 'user.name', 'Vibe Dashboard'], { cwd: input.configRepoDir });
  await input.runCommand('git', ['add', CONFIG_FILE_NAME], { cwd: input.configRepoDir });
  await input.runCommand('git', ['commit', '-m', input.commitMessage], { cwd: input.configRepoDir });
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}
