import { readFile } from 'node:fs/promises';
import {
  applyAddInstancePlugin,
  createAddInstancePluginDryRunPlan,
} from './plugin-instance-config.ts';
import type { PluginServiceDefinition } from './plugin-service-orchestrator';

export async function runPluginInstanceConfigCli(argv: string[]): Promise<unknown> {
  const parsed = parseArgs(argv);
  const plugin = JSON.parse(await readFile(parsed.pluginPath, 'utf8')) as PluginServiceDefinition;

  if (parsed.command === 'dry-run-add') {
    return createAddInstancePluginDryRunPlan({ configRepoDir: parsed.configRepoDir, plugin });
  }

  if (!parsed.approved) throw new Error('apply-add requires --approved true after reviewing dry-run output');
  return applyAddInstancePlugin({
    configRepoDir: parsed.configRepoDir,
    plugin,
    push: parsed.push,
    commitMessage: parsed.commitMessage,
  });
}

interface ParsedArgs {
  command: 'dry-run-add' | 'apply-add';
  configRepoDir: string;
  pluginPath: string;
  approved: boolean;
  push: boolean;
  commitMessage?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0];
  if (command !== 'dry-run-add' && command !== 'apply-add') throw new Error('Expected dry-run-add or apply-add');
  const args = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith('--')) throw new Error(`Unexpected argument: ${arg ?? ''}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    args.set(arg.slice(2), value);
    index += 1;
  }

  return {
    command,
    configRepoDir: requiredArg(args, 'config-repo-dir'),
    pluginPath: requiredArg(args, 'plugin'),
    approved: args.get('approved') === 'true',
    push: args.get('push') === 'true',
    commitMessage: args.get('commit-message'),
  };
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
