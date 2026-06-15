import { readFile } from 'node:fs/promises';
import {
  applySupervisorConfigChanges,
  createPluginServiceDryRunPlan,
  discoverCachedArtifacts,
  readExistingSupervisorConfigs,
  type PluginServiceCatalog,
  type PluginServiceOrchestratorPaths,
} from './plugin-service-orchestrator.ts';

export interface PluginServiceCliResult {
  mode: 'dry-run' | 'apply';
  catalogPath: string;
  paths: PluginServiceOrchestratorPaths;
  plan: ReturnType<typeof createPluginServiceDryRunPlan>;
  applied?: Awaited<ReturnType<typeof applySupervisorConfigChanges>>;
}

interface ParsedArgs {
  mode: 'dry-run' | 'apply';
  catalogPath: string;
  paths: PluginServiceOrchestratorPaths;
}

export async function runPluginServiceOrchestratorCli(argv: string[]): Promise<PluginServiceCliResult> {
  const parsed = parseArgs(argv);
  const catalog = JSON.parse(await readFile(parsed.catalogPath, 'utf8')) as PluginServiceCatalog;
  const [cachedArtifacts, existingSupervisorConfigs] = await Promise.all([
    discoverCachedArtifacts({ catalog, paths: parsed.paths }),
    readExistingSupervisorConfigs(parsed.paths.supervisorConfigDir),
  ]);
  const plan = createPluginServiceDryRunPlan({
    catalog,
    paths: parsed.paths,
    cachedArtifacts,
    existingSupervisorConfigs,
  });

  if (parsed.mode === 'dry-run') {
    return { mode: parsed.mode, catalogPath: parsed.catalogPath, paths: parsed.paths, plan };
  }

  const applied = await applySupervisorConfigChanges(plan.supervisorChanges);
  return { mode: parsed.mode, catalogPath: parsed.catalogPath, paths: parsed.paths, plan, applied };
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = new Map<string, string>();
  let mode: ParsedArgs['mode'] = 'dry-run';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === 'dry-run' || arg === 'apply') {
      mode = arg;
      continue;
    }
    if (!arg?.startsWith('--')) throw new Error(`Unexpected argument: ${arg ?? ''}`);
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    args.set(key, value);
    index += 1;
  }

  const catalogPath = requiredArg(args, 'catalog');
  return {
    mode,
    catalogPath,
    paths: {
      artifactCacheRoot: requiredArg(args, 'artifact-cache-root'),
      installRoot: requiredArg(args, 'install-root'),
      supervisorConfigDir: requiredArg(args, 'supervisor-config-dir'),
    },
  };
}

function requiredArg(args: Map<string, string>, key: string): string {
  const value = args.get(key);
  if (!value) throw new Error(`Missing required --${key}`);
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPluginServiceOrchestratorCli(process.argv.slice(2))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
