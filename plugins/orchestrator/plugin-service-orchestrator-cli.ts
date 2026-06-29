import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  type PluginServiceDefinition,
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

export interface PluginReleaseRefreshCliResult {
  mode: 'refresh-github-release';
  pluginId: string;
  tag: string;
  files: PluginReleaseRefreshFileResult[];
}

export interface PluginReleaseRefreshFileResult {
  path: string;
  kind: 'catalog' | 'plugin';
  pluginId: string;
  previousVersion: string;
  version: string;
  installerKind: 'github-release-asset';
  variants: Array<{
    platform: string;
    asset: string;
    sha256: string;
    url: string;
  }>;
}

type ParsedArgs = RuntimeParsedArgs | RefreshReleaseParsedArgs;

interface RuntimeParsedArgs {
  mode: 'dry-run' | 'apply';
  catalogPaths: string[];
  optionalCatalogPaths: string[];
  paths: PluginServiceOrchestratorPaths;
  caddyConfigPath?: string;
}

interface RefreshReleaseParsedArgs {
  mode: 'refresh-github-release';
  pluginId: string;
  tag: string;
  catalogPaths: string[];
  pluginPaths: string[];
}

export function runPluginServiceOrchestratorCli(argv: readonly ['refresh-github-release', ...string[]]): Promise<PluginReleaseRefreshCliResult>;
export function runPluginServiceOrchestratorCli(argv: readonly [('dry-run' | 'apply'), ...string[]]): Promise<PluginServiceCliResult>;
export function runPluginServiceOrchestratorCli(argv: readonly string[]): Promise<PluginServiceCliResult>;
export async function runPluginServiceOrchestratorCli(argv: readonly string[]): Promise<PluginServiceCliResult | PluginReleaseRefreshCliResult> {
  const parsed = parseArgs(argv);
  if (parsed.mode === 'refresh-github-release') {
    return refreshGithubReleasePlugin(parsed);
  }

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

function parseArgs(argv: readonly string[]): ParsedArgs {
  if (argv[0] === 'refresh-github-release') return parseRefreshReleaseArgs(argv.slice(1));

  const args = new Map<string, string[]>();
  let mode: RuntimeParsedArgs['mode'] = 'dry-run';

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
      pluginBinDir: args.get('plugin-bin-dir')?.at(-1),
      toolchainRoot: args.get('toolchain-root')?.at(-1),
    },
    caddyConfigPath: args.get('caddy-config-path')?.at(-1),
  };
}

function parseRefreshReleaseArgs(argv: readonly string[]): RefreshReleaseParsedArgs {
  const args = parseRepeatedFlagArgs(argv);
  const catalogPaths = args.get('catalog') ?? [];
  const pluginPaths = args.get('plugin') ?? [];
  if (catalogPaths.length + pluginPaths.length === 0) {
    throw new Error('refresh-github-release requires at least one --catalog or --plugin file');
  }
  return {
    mode: 'refresh-github-release',
    pluginId: requiredArg(args, 'plugin-id'),
    tag: requiredArg(args, 'tag'),
    catalogPaths,
    pluginPaths,
  };
}

function parseRepeatedFlagArgs(argv: readonly string[]): Map<string, string[]> {
  const args = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith('--')) throw new Error(`Unexpected argument: ${arg ?? ''}`);
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    args.set(key, [...(args.get(key) ?? []), value]);
    index += 1;
  }
  return args;
}

async function refreshGithubReleasePlugin(input: RefreshReleaseParsedArgs): Promise<PluginReleaseRefreshCliResult> {
  const files: PluginReleaseRefreshFileResult[] = [];
  for (const path of input.catalogPaths) {
    files.push(await refreshGithubReleasePluginFile({ ...input, path, kind: 'catalog' }));
  }
  for (const path of input.pluginPaths) {
    files.push(await refreshGithubReleasePluginFile({ ...input, path, kind: 'plugin' }));
  }
  return {
    mode: input.mode,
    pluginId: input.pluginId,
    tag: input.tag,
    files,
  };
}

async function refreshGithubReleasePluginFile(input: RefreshReleaseParsedArgs & {
  path: string;
  kind: 'catalog' | 'plugin';
}): Promise<PluginReleaseRefreshFileResult> {
  const json = JSON.parse(await readFile(input.path, 'utf8'));
  const plugin = findRefreshTargetPlugin(json, input);
  const previousVersion = plugin.version;
  const installer = plugin.installers.find((candidate) => candidate.kind === 'github-release-asset');
  if (!installer || installer.kind !== 'github-release-asset') {
    throw new Error(`Plugin ${input.pluginId} in ${input.path} does not have a github-release-asset installer`);
  }

  const variants: PluginReleaseRefreshFileResult['variants'] = [];
  plugin.version = input.tag;
  installer.tag = input.tag;
  for (const [platform, variant] of Object.entries(installer.variants)) {
    const url = githubReleaseDownloadUrl(installer.repository, input.tag, variant.asset);
    const bytes = await fetchReleaseAssetBytes(url);
    const sha256 = await sha256Hex(bytes);
    variant.sha256 = sha256;
    variants.push({ platform, asset: variant.asset, sha256, url });
  }

  await writeFile(input.path, `${JSON.stringify(json, null, 2)}\n`);
  return {
    path: input.path,
    kind: input.kind,
    pluginId: plugin.id,
    previousVersion,
    version: plugin.version,
    installerKind: installer.kind,
    variants,
  };
}

function findRefreshTargetPlugin(json: unknown, input: { path: string; kind: 'catalog' | 'plugin'; pluginId: string }): PluginServiceDefinition {
  if (input.kind === 'catalog') {
    const catalog = assertPluginServiceCatalog(json);
    const plugin = catalog.plugins.find((candidate) => candidate.id === input.pluginId);
    if (!plugin) throw new Error(`Plugin ${input.pluginId} not found in catalog ${input.path}`);
    return plugin;
  }

  const plugin = json as PluginServiceDefinition;
  if (plugin.id !== input.pluginId) {
    throw new Error(`Plugin file ${input.path} contains ${plugin.id}, expected ${input.pluginId}`);
  }
  assertPluginServiceCatalog({ plugins: [plugin] });
  return plugin;
}

function githubReleaseDownloadUrl(repository: string, tag: string, asset: string): string {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`;
}

async function fetchReleaseAssetBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
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

export function composeCatalogs(catalogs: PluginServiceCatalog[]): PluginServiceCatalog {
  const plugins = new Map<string, PluginServiceCatalog['plugins'][number]>();
  const pluginStates: NonNullable<PluginServiceCatalog['pluginStates']> = {};
  for (const catalog of catalogs) {
    for (const plugin of catalog.plugins ?? []) {
      plugins.set(plugin.id, plugin);
    }
    for (const [pluginId, pluginState] of Object.entries(catalog.pluginStates ?? {})) {
      pluginStates[pluginId] = { ...pluginState };
    }
  }
  const composed: PluginServiceCatalog = { plugins: [...plugins.values()] };
  if (Object.keys(pluginStates).length > 0) composed.pluginStates = pluginStates;
  return composed;
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
