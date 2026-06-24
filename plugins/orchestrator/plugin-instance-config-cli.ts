import { readFile } from 'node:fs/promises';
import {
  applyAddInstancePlugin,
  applySetInstancePluginEnabled,
  createAddInstancePluginDryRunPlan,
  createSetInstancePluginEnabledDryRunPlan,
} from './plugin-instance-config.ts';
import type { PluginServiceDefinition } from './plugin-service-orchestrator';

export async function runPluginInstanceConfigCli(argv: string[]): Promise<unknown> {
  const parsed = parseArgs(argv);

  if (parsed.command === 'dry-run-add') {
    const plugin = await readPluginDefinition(parsed.pluginPath);
    return createAddInstancePluginDryRunPlan({ configRepoDir: parsed.configRepoDir, plugin });
  }

  if (parsed.command === 'apply-add') {
    const plugin = await readPluginDefinition(parsed.pluginPath);
    if (!parsed.approved) throw new Error('apply-add requires --approved true after reviewing dry-run output');
    return applyAddInstancePlugin({
      configRepoDir: parsed.configRepoDir,
      plugin,
      push: parsed.push,
      commitMessage: parsed.commitMessage,
    });
  }

  if (parsed.command === 'dry-run-enable' || parsed.command === 'dry-run-disable') {
    return createSetInstancePluginEnabledDryRunPlan({
      configRepoDir: parsed.configRepoDir,
      pluginId: parsed.pluginId,
      enable: parsed.command === 'dry-run-enable',
    });
  }

  if (!isStateArgs(parsed)) throw new Error(`Unexpected plugin config command: ${parsed.command}`);
  const stateArgs = parsed;
  if (!stateArgs.approved) throw new Error(`${stateArgs.command} requires --approved true after reviewing dry-run output`);
  return applySetInstancePluginEnabled({
    configRepoDir: stateArgs.configRepoDir,
    pluginId: stateArgs.pluginId,
    enable: stateArgs.command === 'apply-enable',
    push: stateArgs.push,
    commitMessage: stateArgs.commitMessage,
  });
}

type ParsedArgs = {
  command: 'dry-run-add' | 'apply-add';
  configRepoDir: string;
  pluginPath: string;
  approved: boolean;
  push: boolean;
  commitMessage?: string;
} | {
  command: 'dry-run-enable' | 'apply-enable' | 'dry-run-disable' | 'apply-disable';
  configRepoDir: string;
  pluginId: string;
  approved: boolean;
  push: boolean;
  commitMessage?: string;
};

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0];
  if (!isCommand(command)) throw new Error('Expected dry-run-add, apply-add, dry-run-enable, apply-enable, dry-run-disable, or apply-disable');
  const args = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith('--')) throw new Error(`Unexpected argument: ${arg ?? ''}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    args.set(arg.slice(2), value);
    index += 1;
  }

  const commonArgs = {
    configRepoDir: requiredArg(args, 'config-repo-dir'),
    approved: args.get('approved') === 'true',
    push: args.get('push') === 'true',
    commitMessage: args.get('commit-message'),
  };
  if (command === 'dry-run-add' || command === 'apply-add') {
    return { command, ...commonArgs, pluginPath: requiredArg(args, 'plugin') };
  }
  return { command, ...commonArgs, pluginId: requiredArg(args, 'plugin-id') };
}

async function readPluginDefinition(pluginPath: string): Promise<PluginServiceDefinition> {
  return JSON.parse(await readFile(pluginPath, 'utf8')) as PluginServiceDefinition;
}

function isCommand(command: string | undefined): command is ParsedArgs['command'] {
  return command === 'dry-run-add'
    || command === 'apply-add'
    || command === 'dry-run-enable'
    || command === 'apply-enable'
    || command === 'dry-run-disable'
    || command === 'apply-disable';
}

function isStateArgs(parsed: ParsedArgs): parsed is Extract<ParsedArgs, { pluginId: string }> {
  return parsed.command === 'dry-run-enable'
    || parsed.command === 'apply-enable'
    || parsed.command === 'dry-run-disable'
    || parsed.command === 'apply-disable';
}

function requiredArg(args: Map<string, string>, key: string): string {
  const value = args.get(key);
  if (!value) throw new Error(`Missing required --${key}`);
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPluginInstanceConfigCli(process.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
