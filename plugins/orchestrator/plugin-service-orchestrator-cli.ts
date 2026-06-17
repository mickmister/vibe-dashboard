import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  applySupervisorConfigChanges,
  applyCaddyPluginConfigChange,
  assertPluginServiceCatalog,
  createPluginServiceDryRunPlan,
  discoverCachedArtifacts,
  materializePluginArtifacts,
  readExistingCaddyPluginConfig,
  readExistingSupervisorConfigs,
  type PluginServiceCatalog,
  type PluginServiceOrchestratorPaths,
} from './plugin-service-orchestrator.ts';

const execFileAsync = promisify(execFile);

export interface PluginServiceCliResult {
  mode: 'dry-run' | 'apply';
  catalogPath: string;
  catalogPaths: string[];
  optionalCatalogPaths: string[];
  paths: PluginServiceOrchestratorPaths;
  plan: ReturnType<typeof createPluginServiceDryRunPlan>;
  materialized?: Awaited<ReturnType<typeof materializePluginArtifacts>>;
  applied?: Awaited<ReturnType<typeof applySupervisorConfigChanges>>;
  caddyApplied?: Awaited<ReturnType<typeof applyCaddyPluginConfigChange>>;
}

interface ParsedArgs {
  mode: 'dry-run' | 'apply';
  catalogPaths: string[];
  optionalCatalogPaths: string[];
  paths: PluginServiceOrchestratorPaths;
  caddyConfigPath?: string;
}

export async function runPluginServiceOrchestratorCli(argv: string[]): Promise<PluginServiceCliResult> {
  const parsed = parseArgs(argv);
  const catalog = await readComposedCatalog(parsed.catalogPaths, parsed.optionalCatalogPaths);
  const [cachedArtifacts, existingSupervisorConfigs] = await Promise.all([
    // Artifact discovery hashes only existing cache files and is safe to run in parallel
    // with read-only config discovery.
    discoverCachedArtifacts({ catalog, paths: parsed.paths }),
    readExistingSupervisorConfigs(parsed.paths.supervisorConfigDir),
  ]);
  const existingCaddyPluginConfig = parsed.paths.caddyPluginConfigPath
    ? await readExistingCaddyPluginConfig(parsed.paths.caddyPluginConfigPath)
    : undefined;
  const plan = createPluginServiceDryRunPlan({
    catalog,
    paths: parsed.paths,
    cachedArtifacts,
    existingSupervisorConfigs,
    ...(existingCaddyPluginConfig !== undefined ? { existingCaddyPluginConfig } : {}),
  });

  if (parsed.mode === 'dry-run') {
    return {
      mode: parsed.mode,
      catalogPath: parsed.catalogPaths[0]!,
      catalogPaths: parsed.catalogPaths,
      optionalCatalogPaths: parsed.optionalCatalogPaths,
      paths: parsed.paths,
      plan,
    };
  }

  const materialized = process.env.VD_PLUGIN_ORCHESTRATOR_INSTALL_ARTIFACTS === 'true'
    ? await materializePluginArtifacts({
      catalog,
      paths: parsed.paths,
    })
    : undefined;
  const applied = await applySupervisorConfigChanges(plan.supervisorChanges);
  const caddyApplied = await applyCaddyPluginConfigChange(
    plan.caddyConfigChange,
    parsed.caddyConfigPath && parsed.paths.caddyPluginConfigPath
      ? {
        validateCandidate: createCaddyCandidateValidator({
          caddyConfigPath: parsed.caddyConfigPath,
          activePluginConfigPath: parsed.paths.caddyPluginConfigPath,
        }),
      }
      : undefined,
  );
  return {
    mode: parsed.mode,
    catalogPath: parsed.catalogPaths[0]!,
    catalogPaths: parsed.catalogPaths,
    optionalCatalogPaths: parsed.optionalCatalogPaths,
    paths: parsed.paths,
    plan,
    materialized,
    applied,
    caddyApplied,
  };
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = new Map<string, string[]>();
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
    args.set(key, [...(args.get(key) ?? []), value]);
    index += 1;
  }

  const catalogPaths = args.get('catalog') ?? [];
  return {
    mode,
    catalogPaths,
    optionalCatalogPaths: args.get('optional-catalog') ?? [],
    paths: {
      artifactCacheRoot: requiredArg(args, 'artifact-cache-root'),
      installRoot: requiredArg(args, 'install-root'),
      supervisorConfigDir: requiredArg(args, 'supervisor-config-dir'),
      caddyPluginConfigPath: args.get('caddy-plugin-config-path')?.at(-1),
    },
    caddyConfigPath: args.get('caddy-config-path')?.at(-1),
  };
}

function createCaddyCandidateValidator(input: {
  caddyConfigPath: string;
  activePluginConfigPath: string;
}): (candidate: { candidatePath: string }) => Promise<void> {
  return async ({ candidatePath }) => {
    const caddyConfig = await readFile(input.caddyConfigPath, 'utf8');
    if (!caddyConfig.includes(input.activePluginConfigPath)) {
      throw new Error(`Caddy config ${input.caddyConfigPath} does not import plugin config ${input.activePluginConfigPath}`);
    }

    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-caddy-candidate-'));
    const tempCaddyConfigPath = join(tempRoot, 'Caddyfile');
    try {
      await writeFile(tempCaddyConfigPath, caddyConfig.split(input.activePluginConfigPath).join(candidatePath));
      await execFileAsync('caddy', ['adapt', '--config', tempCaddyConfigPath, '--adapter', 'caddyfile']);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Caddy candidate validation failed: ${detail}`);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  };
}

async function readComposedCatalog(catalogPaths: string[], optionalCatalogPaths: string[]): Promise<PluginServiceCatalog> {
  if (catalogPaths.length === 0) throw new Error('Missing required --catalog');
  const catalogs: PluginServiceCatalog[] = [];
  for (const path of catalogPaths) {
    catalogs.push(assertPluginServiceCatalog(JSON.parse(await readFile(path, 'utf8'))));
  }
  for (const path of optionalCatalogPaths) {
    try {
      catalogs.push(assertPluginServiceCatalog(JSON.parse(await readFile(path, 'utf8'))));
    } catch (error) {
      if (!isNodeErrorWithCode(error, 'ENOENT')) throw error;
    }
  }
  return assertPluginServiceCatalog(composeCatalogs(catalogs));
}

function composeCatalogs(catalogs: PluginServiceCatalog[]): PluginServiceCatalog {
  const plugins = new Map<string, PluginServiceCatalog['plugins'][number]>();
  for (const catalog of catalogs) {
    for (const plugin of catalog.plugins ?? []) {
      plugins.set(plugin.id, plugin);
    }
  }
  return { plugins: [...plugins.values()] };
}

function requiredArg(args: Map<string, string[]>, key: string): string {
  const value = args.get(key)?.at(-1);
  if (!value) throw new Error(`Missing required --${key}`);
  return value;
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
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
