import { createHash } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, readdir, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gunzipSync, inflateRawSync } from 'node:zlib';

const execFileAsync = promisify(execFile);
const MAX_ARCHIVE_TREE_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;
const MAX_ARCHIVE_TREE_ENTRIES = 10_000;

export interface PluginServiceCatalog {
  plugins: PluginServiceDefinition[];
}

export type PlatformKey = 'linux-amd64' | 'linux-arm64';

export interface PluginArtifactVariantDefinition {
  asset: string;
  sha256: string;
  /** First-party service artifacts are sha256-pinned on this branch. Marketplace signatures are deferred. */
  signature?: string;
}

export type PluginMaterializerDefinition =
  | {
    kind: 'file';
    installAs: string;
    mode?: string;
    outputs: PluginMaterializedOutputDefinition[];
  }
  | {
    kind: 'zip-entry';
    entry: string;
    installAs: string;
    mode?: string;
    outputs: PluginMaterializedOutputDefinition[];
  }
  | {
    kind: 'archive-tree';
    format: 'zip' | 'tar.gz';
    stripComponents?: number;
    outputs: PluginMaterializedOutputDefinition[];
  };

export interface PluginMaterializedOutputDefinition {
  kind: 'file' | 'directory';
  path: string;
  mode?: string;
}

export interface PluginPostExtractScriptDefinition {
  kind: 'admin-script';
  command: string;
  timeoutSeconds?: number;
}

export type PluginInstallerDefinition =
  | { kind: 'bundled-current-repo' }
  | {
    kind: 'github-release-asset';
    repository: string;
    tag: string;
    variants: Partial<Record<PlatformKey, PluginArtifactVariantDefinition>>;
    materialize: PluginMaterializerDefinition;
    postExtract?: PluginPostExtractScriptDefinition;
    bin?: Record<string, string>;
  }
  | {
    kind: 'uv-tool';
    package: string;
    version: string;
    bins?: string[];
  }
  | {
    kind: 'npm-global';
    package: string;
    version: string;
    bins?: string[];
  }
  | {
    kind: 'cargo-crate';
    crate: string;
    version: string;
    bins?: string[];
  }
  | {
    kind: 'go-install';
    module: string;
    version: string;
    bins?: string[];
  };

export interface PluginServiceDefinition {
  id: string;
  name: string;
  version: string;
  installers: PluginInstallerDefinition[];
  services: SupervisorServiceDefinition[];
}

export interface SupervisorServiceDefinition {
  id: string;
  command: string;
  args?: string[];
  directory: string;
  user: string;
  autostart: boolean;
  autorestart: boolean;
  singleton?: boolean;
  preStart?: string[];
  ports?: ServicePortDefinition[];
  env?: Record<string, string>;
  httpExposure?: CaddyHttpExposureDefinition;
}

export interface ServicePortDefinition {
  name: string;
  env: string;
  default: number;
  bind: string;
}

export interface CaddyHttpExposureDefinition {
  kind: 'caddy-subdomain';
  subdomain: string;
  port: string;
}

export interface PluginServiceOrchestratorPaths {
  artifactCacheRoot: string;
  installRoot: string;
  supervisorConfigDir: string;
  caddyPluginConfigPath?: string;
  pluginBinDir?: string;
  toolchainRoot?: string;
}

export interface CachedPluginArtifact {
  pluginId: string;
  version: string;
  sha256: string;
  path: string;
}

export type PluginArtifactDryRunPlan =
  | {
    action: 'bundled-current-repo';
    pluginId: string;
    version: string;
    installPath: string;
  }
  | {
    action: 'cached' | 'download' | 'install';
    pluginId: string;
    version: string;
    url: string;
    cachePath: string;
    installPath: string;
    sha256?: string;
    variant?: PlatformKey;
    signature?: string;
  };

export type SupervisorConfigChange =
  | {
    action: 'create' | 'update' | 'unchanged';
    pluginId: string;
    serviceId: string;
    program: string;
    path: string;
    content: string;
  }
  | {
    action: 'delete';
    path: string;
    previousContent: string;
  };

export interface PluginServiceDryRunPlan {
  artifacts: PluginArtifactDryRunPlan[];
  supervisorChanges: SupervisorConfigChange[];
  caddyConfigChange?: CaddyPluginConfigChange;
}

export interface CaddyPluginConfigChange {
  action: 'create' | 'update' | 'unchanged';
  path: string;
  content: string;
}

export interface CaddyPluginConfigValidationInput {
  candidatePath: string;
  content: string;
}

export interface CaddyPluginConfigApplyOptions {
  validateCandidate?: (input: CaddyPluginConfigValidationInput) => Promise<void> | void;
}

export interface PluginArtifactMaterialization {
  action: 'bundled-current-repo' | 'cached' | 'downloaded' | 'installed';
  pluginId: string;
  version: string;
  cachePath?: string;
  installPath: string;
  installerKind?: PluginInstallerDefinition['kind'];
}

export interface AppliedSupervisorConfigChange {
  action: Exclude<SupervisorConfigChange['action'], 'unchanged'> | 'unchanged';
  path: string;
}

export function createPluginServiceDryRunPlan(input: {
  catalog: PluginServiceCatalog;
  paths: PluginServiceOrchestratorPaths;
  cachedArtifacts: CachedPluginArtifact[];
  existingSupervisorConfigs: Record<string, string>;
  existingCaddyPluginConfig?: string;
}): PluginServiceDryRunPlan {
  validateCatalog(input.catalog);

  const artifacts = input.catalog.plugins.flatMap((plugin) => createArtifactPlans(plugin, input.paths, input.cachedArtifacts));
  const desiredSupervisorConfigs = new Map<string, SupervisorConfigChange>();

  for (const plugin of input.catalog.plugins) {
    for (const service of plugin.services) {
      const path = supervisorConfigPath(input.paths, plugin, service);
      const content = renderSupervisorProgramConfig({ plugin, service, paths: input.paths });
      const existing = input.existingSupervisorConfigs[path];
      desiredSupervisorConfigs.set(path, {
        action: existing === undefined ? 'create' : normalizeConfig(existing) === normalizeConfig(content) ? 'unchanged' : 'update',
        pluginId: plugin.id,
        serviceId: service.id,
        program: supervisorProgramName(plugin, service),
        path,
        content,
      });
    }
  }

  const supervisorChanges = [...desiredSupervisorConfigs.values()];
  for (const [path, previousContent] of Object.entries(input.existingSupervisorConfigs)) {
    if (isGeneratedSupervisorConfigPath(input.paths, path) && !desiredSupervisorConfigs.has(path)) {
      supervisorChanges.push({ action: 'delete', path, previousContent });
    }
  }

  const caddyConfigChange = input.paths.caddyPluginConfigPath
    ? createCaddyPluginConfigChange({
      catalog: input.catalog,
      path: input.paths.caddyPluginConfigPath,
      existingContent: input.existingCaddyPluginConfig,
    })
    : undefined;

  return { artifacts, supervisorChanges, ...(caddyConfigChange ? { caddyConfigChange } : {}) };
}

export function assertPluginServiceCatalog(input: unknown): PluginServiceCatalog {
  validateCatalog(input as PluginServiceCatalog);
  return input as PluginServiceCatalog;
}

export async function readExistingCaddyPluginConfig(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return undefined;
    throw error;
  }
}

export async function readExistingSupervisorConfigs(configDir: string): Promise<Record<string, string>> {
  const configs: Record<string, string> = {};
  let entries: string[];
  try {
    entries = await readdir(configDir);
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return {};
    throw error;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.conf')) continue;
    const path = join(configDir, entry);
    configs[path] = await readFile(path, 'utf8');
  }
  return configs;
}

export async function discoverCachedArtifacts(input: {
  catalog: PluginServiceCatalog;
  paths: PluginServiceOrchestratorPaths;
  platformKey?: PlatformKey;
}): Promise<CachedPluginArtifact[]> {
  const cachedArtifacts: CachedPluginArtifact[] = [];
  validateCatalog(input.catalog);
  const platformKey = input.platformKey ?? currentPlatformKey();

  for (const plugin of input.catalog.plugins) {
    for (const installer of plugin.installers) {
      if (installer.kind !== 'github-release-asset') continue;
      const variant = selectInstallerVariant(installer, platformKey);
      const path = artifactCachePath(input.paths, installer, variant);
      let bytes: Buffer;
      try {
        bytes = await readFile(path);
      } catch (error) {
        if (isNodeErrorWithCode(error, 'ENOENT')) continue;
        throw error;
      }

      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (sha256 === variant.sha256) {
        cachedArtifacts.push({ pluginId: plugin.id, version: plugin.version, sha256, path });
      }
    }
  }

  return cachedArtifacts;
}

export async function applySupervisorConfigChanges(changes: SupervisorConfigChange[]): Promise<AppliedSupervisorConfigChange[]> {
  const applied: AppliedSupervisorConfigChange[] = [];
  for (const change of changes) {
    if (change.action === 'unchanged') {
      applied.push({ action: 'unchanged', path: change.path });
      continue;
    }
    if (change.action === 'delete') {
      await rm(change.path, { force: true });
      applied.push({ action: 'delete', path: change.path });
      continue;
    }

    const temporaryPath = `${change.path}.tmp-${process.pid}-${Date.now()}`;
    await mkdir(dirname(change.path), { recursive: true });
    await writeFile(temporaryPath, normalizeConfig(change.content), { mode: 0o644 });
    await rename(temporaryPath, change.path);
    applied.push({ action: change.action, path: change.path });
  }
  return applied;
}

export async function applyCaddyPluginConfigChange(
  change: CaddyPluginConfigChange | undefined,
  options: CaddyPluginConfigApplyOptions = {},
): Promise<{ action: CaddyPluginConfigChange['action']; path: string } | undefined> {
  if (!change) return undefined;
  if (change.action === 'unchanged') return { action: 'unchanged', path: change.path };

  const temporaryPath = `${change.path}.tmp-${process.pid}-${Date.now()}`;
  const content = normalizeConfig(change.content);
  await mkdir(dirname(change.path), { recursive: true });
  await writeFile(temporaryPath, content, { mode: 0o644 });
  try {
    await options.validateCandidate?.({ candidatePath: temporaryPath, content });
    await rename(temporaryPath, change.path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return { action: change.action, path: change.path };
}

export interface PluginInstallCommandOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeout?: number;
}

export async function materializePluginArtifacts(input: {
  catalog: PluginServiceCatalog;
  paths: PluginServiceOrchestratorPaths;
  allowHashMismatch?: boolean;
  fetchBytes?: (url: string) => Promise<Uint8Array>;
  executeCommand?: (command: string, args: string[], options: PluginInstallCommandOptions) => Promise<void>;
  platformKey?: PlatformKey;
}): Promise<PluginArtifactMaterialization[]> {
  validateCatalog(input.catalog);
  const materialized: PluginArtifactMaterialization[] = [];
  const platformKey = input.platformKey ?? currentPlatformKey();
  const executeCommand = input.executeCommand ?? defaultExecuteCommand;

  for (const plugin of input.catalog.plugins) {
    const installPath = pluginInstallPath(input.paths, plugin);
    for (const installer of plugin.installers) {
      if (installer.kind === 'bundled-current-repo') {
        materialized.push({ action: 'bundled-current-repo', pluginId: plugin.id, version: plugin.version, installPath, installerKind: installer.kind });
        continue;
      }

      if (installer.kind === 'github-release-asset') {
        const variant = selectInstallerVariant(installer, platformKey);
        const cachePath = artifactCachePath(input.paths, installer, variant);
        let cacheHit = true;
        let bytes = await readFile(cachePath).catch(async (error: unknown) => {
          if (!isNodeErrorWithCode(error, 'ENOENT')) throw error;
          cacheHit = false;
          return downloadVerifiedArtifact({ plugin, installer, variant, cachePath, allowHashMismatch: input.allowHashMismatch, fetchBytes: input.fetchBytes });
        });

        let sha256 = createHash('sha256').update(bytes).digest('hex');
        if (sha256 !== variant.sha256 && !input.allowHashMismatch) {
          await quarantineBadCacheFile(cachePath);
          cacheHit = false;
          bytes = await downloadVerifiedArtifact({ plugin, installer, variant, cachePath, allowHashMismatch: input.allowHashMismatch, fetchBytes: input.fetchBytes });
          sha256 = createHash('sha256').update(bytes).digest('hex');
        }

        await materializeDownloadedArtifact({ bytes, cachePath, plugin, installer, paths: input.paths, platformKey, executeCommand });
        materialized.push({
          action: cacheHit ? 'cached' : 'downloaded',
          pluginId: plugin.id,
          version: plugin.version,
          cachePath,
          installPath,
          installerKind: installer.kind,
        });
        continue;
      }

      await installPackageManagerTool({ plugin, installer, paths: input.paths, executeCommand });
      materialized.push({ action: 'installed', pluginId: plugin.id, version: plugin.version, installPath, installerKind: installer.kind });
    }
  }

  await reconcilePluginBins(input.catalog, input.paths);
  return materialized;
}

export function renderSupervisorProgramConfig(input: {
  plugin: PluginServiceDefinition;
  service: SupervisorServiceDefinition;
  paths: PluginServiceOrchestratorPaths;
}): string {
  const program = supervisorProgramName(input.plugin, input.service);
  const pluginDir = pluginExtractedPath(input.paths, input.plugin);
  const command = renderCommand(input.plugin, input.service, input.paths);
  const directory = expandTemplate(input.service.directory, input.plugin, input.service, input.paths);
  const environment = renderSupervisorEnvironment(input.plugin, input.service, input.paths);

  return [
    `; generated by VD plugin service orchestrator for ${input.plugin.id}@${input.plugin.version} service ${input.service.id}`,
    `[program:${program}]`,
    `command=${command}`,
    `directory=${directory}`,
    `autostart=${input.service.autostart ? 'true' : 'false'}`,
    `autorestart=${input.service.autorestart ? 'true' : 'false'}`,
    'stopasgroup=true',
    'killasgroup=true',
    'stdout_logfile=/dev/fd/1',
    'stdout_logfile_maxbytes=0',
    'stderr_logfile=/dev/fd/2',
    'stderr_logfile_maxbytes=0',
    `environment=${environment}`,
    `user=${input.service.user}`,
    '',
  ].join('\n');
}

export function renderCaddyPluginExposureConfig(input: {
  catalog: PluginServiceCatalog;
}): string {
  validateCatalog(input.catalog);

  const snippets: string[] = [];
  for (const plugin of input.catalog.plugins) {
    for (const service of plugin.services) {
      if (!service.httpExposure) continue;
      const port = getServicePortByName(plugin, service, service.httpExposure.port);
      const matcherName = caddyMatcherName(plugin, service);
      snippets.push([
        `# ${plugin.id}@${plugin.version} service ${service.id}`,
        `@${matcherName} host ${service.httpExposure.subdomain}.{$PROXY_DOMAIN}`,
        `handle @${matcherName} {`,
        `\treverse_proxy ${caddyUpstreamHost(port.bind)}:${port.default} {`,
        '\t\theader_up Host {upstream_hostport}',
        '\t\theader_up Upgrade {http.request.header.Upgrade}',
        '\t\theader_up Connection {http.request.header.Connection}',
        '\t}',
        '}',
      ].join('\n'));
    }
  }

  return [
    '# generated by VD plugin service orchestrator',
    '# This file is imported from /etc/caddy/Caddyfile inside the main server block.',
    '# Plugins declare structured httpExposure entries; raw Caddyfile is never accepted from plugin manifests.',
    '',
    ...snippets,
    '',
  ].join('\n');
}

async function downloadVerifiedArtifact(input: {
  plugin: PluginServiceDefinition;
  installer: Extract<PluginInstallerDefinition, { kind: 'github-release-asset' }>;
  variant: PluginArtifactVariantDefinition;
  cachePath: string;
  allowHashMismatch?: boolean;
  fetchBytes?: (url: string) => Promise<Uint8Array>;
}): Promise<Buffer> {
  const downloaded = await (input.fetchBytes ?? fetchBytes)(githubReleaseAssetUrl(input.installer, input.variant));
  const downloadedSha256 = createHash('sha256').update(downloaded).digest('hex');
  if (downloadedSha256 !== input.variant.sha256 && !input.allowHashMismatch) {
    throw new Error(`Artifact sha256 mismatch for ${input.plugin.id}@${input.plugin.version}: expected ${input.variant.sha256}, got ${downloadedSha256}`);
  }
  await mkdir(dirname(input.cachePath), { recursive: true });
  const temporaryPath = `${input.cachePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, downloaded, { mode: 0o644 });
  await rename(temporaryPath, input.cachePath);
  return Buffer.from(downloaded);
}

async function materializeDownloadedArtifact(input: {
  bytes: Buffer;
  cachePath: string;
  plugin: PluginServiceDefinition;
  installer: Extract<PluginInstallerDefinition, { kind: 'github-release-asset' }>;
  paths: PluginServiceOrchestratorPaths;
  platformKey: PlatformKey;
  executeCommand: (command: string, args: string[], options: PluginInstallCommandOptions) => Promise<void>;
}): Promise<void> {
  const pluginDir = pluginExtractedPath(input.paths, input.plugin);
  const materializer = input.installer.materialize;
  await mkdir(pluginDir, { recursive: true });

  if (materializer.kind === 'file') {
    const installTarget = join(pluginDir, materializer.installAs);
    await mkdir(dirname(installTarget), { recursive: true });
    await copyFileIfChanged(input.cachePath, input.bytes, installTarget);
    await chmod(installTarget, parseMode(materializer.mode ?? '0755'));
  } else if (materializer.kind === 'zip-entry') {
    const installTarget = join(pluginDir, materializer.installAs);
    await mkdir(dirname(installTarget), { recursive: true });
    await writeFileIfChanged(installTarget, extractZipEntry(input.bytes, materializer.entry));
    await chmod(installTarget, parseMode(materializer.mode ?? '0755'));
  } else if (materializer.kind === 'archive-tree') {
    await extractArchiveTree(input.bytes, materializer, pluginDir);
  } else {
    throw new Error(`Unsupported materializer kind: ${(materializer as { kind?: string }).kind ?? ''}`);
  }

  if (input.installer.postExtract) {
    await runPostExtractScript({ plugin: input.plugin, script: input.installer.postExtract, paths: input.paths, platformKey: input.platformKey, artifactPath: input.cachePath, executeCommand: input.executeCommand });
  }
  await validateMaterializedOutputs(pluginDir, materializer.outputs);
}

async function installPackageManagerTool(input: {
  plugin: PluginServiceDefinition;
  installer: Exclude<PluginInstallerDefinition, { kind: 'github-release-asset' } | { kind: 'bundled-current-repo' }>;
  paths: PluginServiceOrchestratorPaths;
  executeCommand: (command: string, args: string[], options: PluginInstallCommandOptions) => Promise<void>;
}): Promise<void> {
  const toolchain = toolchainPaths(input.paths);
  await mkdir(toolchain.binDir, { recursive: true });
  const env = toolchainEnv(input.paths);
  const cwd = pluginExtractedPath(input.paths, input.plugin);
  await mkdir(cwd, { recursive: true });

  if (input.installer.kind === 'uv-tool') {
    await input.executeCommand('uv', ['tool', 'install', `${input.installer.package}==${input.installer.version}`], { cwd, env });
    return;
  }
  if (input.installer.kind === 'npm-global') {
    await input.executeCommand('npm', ['install', '--global', `${input.installer.package}@${input.installer.version}`], { cwd, env });
    return;
  }
  if (input.installer.kind === 'cargo-crate') {
    await input.executeCommand('cargo', ['install', input.installer.crate, '--version', input.installer.version, '--root', toolchain.root], { cwd, env });
    return;
  }
  if (input.installer.kind === 'go-install') {
    await input.executeCommand('go', ['install', `${input.installer.module}@${input.installer.version}`], { cwd, env });
    return;
  }
  throw new Error(`Unsupported package manager installer: ${(input.installer as { kind?: string }).kind ?? ''}`);
}

async function runPostExtractScript(input: {
  plugin: PluginServiceDefinition;
  script: PluginPostExtractScriptDefinition;
  paths: PluginServiceOrchestratorPaths;
  platformKey: PlatformKey;
  artifactPath: string;
  executeCommand: (command: string, args: string[], options: PluginInstallCommandOptions) => Promise<void>;
}): Promise<void> {
  const stagingDir = join(pluginInstallPath(input.paths, input.plugin), `.post-extract-${process.pid}-${Date.now()}`);
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  try {
    await input.executeCommand('sh', ['-c', input.script.command], {
      cwd: stagingDir,
      env: {
        ...toolchainEnv(input.paths),
        ARTIFACT_PATH: input.artifactPath,
        PLUGIN_DIR: pluginExtractedPath(input.paths, input.plugin),
        PLUGIN_DATA_DIR: pluginDataPath(input.paths, input.plugin),
        STAGING_DIR: stagingDir,
        PLUGIN_ID: input.plugin.id,
        PLUGIN_VERSION: input.plugin.version,
        VD_PLATFORM: input.platformKey,
      },
      timeout: (input.script.timeoutSeconds ?? 60) * 1000,
    });
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

async function copyFileIfChanged(cachePath: string, bytes: Buffer, installTarget: string): Promise<void> {
  const installedBytes = await readFile(installTarget).catch((error: unknown) => {
    if (isNodeErrorWithCode(error, 'ENOENT')) return undefined;
    throw error;
  });
  if (installedBytes && createHash('sha256').update(installedBytes).digest('hex') === createHash('sha256').update(bytes).digest('hex')) return;
  await copyFile(cachePath, installTarget);
}

async function writeFileIfChanged(path: string, bytes: Buffer): Promise<void> {
  const installedBytes = await readFile(path).catch((error: unknown) => {
    if (isNodeErrorWithCode(error, 'ENOENT')) return undefined;
    throw error;
  });
  if (installedBytes && createHash('sha256').update(installedBytes).digest('hex') === createHash('sha256').update(bytes).digest('hex')) return;
  await writeFile(path, bytes, { mode: 0o755 });
}

async function quarantineBadCacheFile(cachePath: string): Promise<void> {
  const quarantinePath = `${cachePath}.bad-${process.pid}-${Date.now()}`;
  try {
    await rename(cachePath, quarantinePath);
  } catch (error) {
    if (!isNodeErrorWithCode(error, 'ENOENT')) throw error;
  }
}

function extractZipEntry(zipBytes: Buffer, entryName: string): Buffer {
  const centralDirectory = findZipCentralDirectory(zipBytes);
  let offset = centralDirectory.offset;
  const end = centralDirectory.offset + centralDirectory.size;

  while (offset < end) {
    if (offset + 46 > zipBytes.length) {
      throw new Error('Invalid zip artifact: malformed central directory');
    }
    if (zipBytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('Invalid zip artifact: malformed central directory');
    }

    const compressionMethod = zipBytes.readUInt16LE(offset + 10);
    const compressedSize = zipBytes.readUInt32LE(offset + 20);
    const uncompressedSize = zipBytes.readUInt32LE(offset + 24);
    const fileNameLength = zipBytes.readUInt16LE(offset + 28);
    const extraLength = zipBytes.readUInt16LE(offset + 30);
    const commentLength = zipBytes.readUInt16LE(offset + 32);
    const localHeaderOffset = zipBytes.readUInt32LE(offset + 42);
    if (offset + 46 + fileNameLength + extraLength + commentLength > end) {
      throw new Error('Invalid zip artifact: central directory entry is out of bounds');
    }
    const fileName = zipBytes.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8');

    if (fileName === entryName) {
      return readZipEntryData(zipBytes, {
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        entryName,
      });
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  throw new Error(`Zip artifact does not contain expected entry ${entryName}`);
}

function findZipCentralDirectory(zipBytes: Buffer): { offset: number; size: number } {
  const minimumEndOfCentralDirectorySize = 22;
  const maximumCommentLength = 0xffff;
  if (zipBytes.length < minimumEndOfCentralDirectorySize) {
    throw new Error('Invalid zip artifact: missing end of central directory');
  }
  const searchStart = Math.max(0, zipBytes.length - minimumEndOfCentralDirectorySize - maximumCommentLength);
  for (let offset = zipBytes.length - minimumEndOfCentralDirectorySize; offset >= searchStart; offset -= 1) {
    if (zipBytes.readUInt32LE(offset) !== 0x06054b50) continue;
    const size = zipBytes.readUInt32LE(offset + 12);
    const centralDirectoryOffset = zipBytes.readUInt32LE(offset + 16);
    if (centralDirectoryOffset + size > offset) {
      throw new Error('Invalid zip artifact: central directory is out of bounds');
    }
    return { offset: centralDirectoryOffset, size };
  }
  throw new Error('Invalid zip artifact: missing end of central directory');
}

function readZipEntryData(
  zipBytes: Buffer,
  input: {
    compressionMethod: number;
    compressedSize: number;
    uncompressedSize: number;
    localHeaderOffset: number;
    entryName: string;
  },
): Buffer {
  if (input.localHeaderOffset + 30 > zipBytes.length || zipBytes.readUInt32LE(input.localHeaderOffset) !== 0x04034b50) {
    throw new Error(`Invalid zip artifact: malformed local header for ${input.entryName}`);
  }

  const fileNameLength = zipBytes.readUInt16LE(input.localHeaderOffset + 26);
  const extraLength = zipBytes.readUInt16LE(input.localHeaderOffset + 28);
  const dataOffset = input.localHeaderOffset + 30 + fileNameLength + extraLength;
  const dataEnd = dataOffset + input.compressedSize;
  if (dataEnd > zipBytes.length) {
    throw new Error(`Invalid zip artifact: entry ${input.entryName} is out of bounds`);
  }

  const compressedData = zipBytes.subarray(dataOffset, dataEnd);
  const data = input.compressionMethod === 0
    ? Buffer.from(compressedData)
    : input.compressionMethod === 8
      ? inflateRawSync(compressedData, { maxOutputLength: input.uncompressedSize })
      : undefined;
  if (!data) {
    throw new Error(`Unsupported zip compression method ${input.compressionMethod} for ${input.entryName}`);
  }
  if (data.length !== input.uncompressedSize) {
    throw new Error(`Invalid zip artifact: entry ${input.entryName} size mismatch`);
  }
  return data;
}

async function extractArchiveTree(bytes: Buffer, materializer: Extract<PluginMaterializerDefinition, { kind: 'archive-tree' }>, targetDir: string): Promise<void> {
  const archiveBytes = materializer.format === 'tar.gz'
    ? gunzipSync(bytes, { maxOutputLength: MAX_ARCHIVE_TREE_UNCOMPRESSED_BYTES + 1 })
    : bytes;
  if (materializer.format === 'zip') {
    await extractZipTree(archiveBytes, targetDir, materializer.stripComponents ?? 0);
    return;
  }
  await extractTarTree(archiveBytes, targetDir, materializer.stripComponents ?? 0);
}

async function extractZipTree(zipBytes: Buffer, targetDir: string, stripComponents: number): Promise<void> {
  const centralDirectory = findZipCentralDirectory(zipBytes);
  let offset = centralDirectory.offset;
  const end = centralDirectory.offset + centralDirectory.size;
  let entryCount = 0;
  let totalUncompressedBytes = 0;
  while (offset < end) {
    if (offset + 46 > zipBytes.length || zipBytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid zip artifact: malformed central directory');
    const compressionMethod = zipBytes.readUInt16LE(offset + 10);
    const compressedSize = zipBytes.readUInt32LE(offset + 20);
    const uncompressedSize = zipBytes.readUInt32LE(offset + 24);
    const fileNameLength = zipBytes.readUInt16LE(offset + 28);
    const extraLength = zipBytes.readUInt16LE(offset + 30);
    const commentLength = zipBytes.readUInt16LE(offset + 32);
    const localHeaderOffset = zipBytes.readUInt32LE(offset + 42);
    const name = zipBytes.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8');
    entryCount += 1;
    if (entryCount > MAX_ARCHIVE_TREE_ENTRIES) throw new Error(`Archive tree exceeds maximum entry count of ${MAX_ARCHIVE_TREE_ENTRIES}`);
    const relativePath = stripArchivePath(name, stripComponents);
    if (relativePath && !name.endsWith('/')) {
      totalUncompressedBytes += uncompressedSize;
      if (totalUncompressedBytes > MAX_ARCHIVE_TREE_UNCOMPRESSED_BYTES) throw new Error(`Archive tree exceeds maximum uncompressed size of ${MAX_ARCHIVE_TREE_UNCOMPRESSED_BYTES} bytes`);
      const data = readZipEntryData(zipBytes, { compressionMethod, compressedSize, uncompressedSize, localHeaderOffset, entryName: name });
      const target = join(targetDir, relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFileIfChanged(target, data);
    } else if (relativePath) {
      await mkdir(join(targetDir, relativePath), { recursive: true });
    }
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
}

async function extractTarTree(tarBytes: Buffer, targetDir: string, stripComponents: number): Promise<void> {
  let offset = 0;
  let entryCount = 0;
  let totalUncompressedBytes = 0;
  while (offset + 512 <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    entryCount += 1;
    if (entryCount > MAX_ARCHIVE_TREE_ENTRIES) throw new Error(`Archive tree exceeds maximum entry count of ${MAX_ARCHIVE_TREE_ENTRIES}`);
    const rawName = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const name = prefix ? `${prefix}/${rawName}` : rawName;
    const sizeText = readTarString(header, 124, 12).trim();
    const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
    const typeflag = header.subarray(156, 157).toString('utf8') || '0';
    const dataOffset = offset + 512;
    const nextOffset = dataOffset + Math.ceil(size / 512) * 512;
    if (nextOffset > tarBytes.length) throw new Error(`Invalid tar artifact: entry ${name} is out of bounds`);
    const relativePath = stripArchivePath(name, stripComponents);
    if (relativePath) {
      const target = join(targetDir, relativePath);
      if (typeflag === '5') {
        await mkdir(target, { recursive: true });
      } else if (typeflag === '0' || typeflag === '\0' || typeflag === '') {
        totalUncompressedBytes += size;
        if (totalUncompressedBytes > MAX_ARCHIVE_TREE_UNCOMPRESSED_BYTES) throw new Error(`Archive tree exceeds maximum uncompressed size of ${MAX_ARCHIVE_TREE_UNCOMPRESSED_BYTES} bytes`);
        await mkdir(dirname(target), { recursive: true });
        await writeFileIfChanged(target, tarBytes.subarray(dataOffset, dataOffset + size));
      }
    }
    offset = nextOffset;
  }
}

function readTarString(header: Buffer, offset: number, length: number): string {
  const raw = header.subarray(offset, offset + length);
  const nul = raw.indexOf(0);
  return raw.subarray(0, nul === -1 ? raw.length : nul).toString('utf8');
}

function stripArchivePath(path: string, stripComponents: number): string | null {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter((part) => part.length > 0);
  const stripped = parts.slice(stripComponents).join('/');
  if (!stripped) return null;
  validateRelativePath(stripped, 'Invalid archive entry path');
  return stripped;
}

async function validateMaterializedOutputs(pluginDir: string, outputs: PluginMaterializedOutputDefinition[]): Promise<void> {
  for (const output of outputs) {
    const path = join(pluginDir, output.path);
    const stat = await lstat(path).catch((error: unknown) => {
      if (isNodeErrorWithCode(error, 'ENOENT')) throw new Error(`Missing materialized output ${output.path}`);
      throw error;
    });
    if (output.kind === 'file' && !stat.isFile()) throw new Error(`Materialized output is not a file: ${output.path}`);
    if (output.kind === 'directory' && !stat.isDirectory()) throw new Error(`Materialized output is not a directory: ${output.path}`);
    if (output.mode !== undefined && output.kind === 'file') await chmod(path, parseMode(output.mode));
  }
}

async function reconcilePluginBins(catalog: PluginServiceCatalog, paths: PluginServiceOrchestratorPaths): Promise<void> {
  const binDir = pluginBinDir(paths);
  await mkdir(binDir, { recursive: true });
  const desired = new Map<string, string>();
  for (const plugin of catalog.plugins) {
    for (const installer of plugin.installers) {
      if (installer.kind !== 'github-release-asset' || !installer.bin) continue;
      for (const [binName, target] of Object.entries(installer.bin)) {
        if (desired.has(binName)) throw new Error(`Duplicate plugin bin exposure ${binName}`);
        desired.set(binName, join(pluginExtractedPath(paths, plugin), target));
      }
    }
  }
  for (const [binName, target] of desired) {
    const link = join(binDir, binName);
    await unlink(link).catch((error: unknown) => {
      if (!isNodeErrorWithCode(error, 'ENOENT')) throw error;
    });
    await symlink(target, link);
  }
}

function selectInstallerVariant(installer: Extract<PluginInstallerDefinition, { kind: 'github-release-asset' }>, platformKey: PlatformKey): PluginArtifactVariantDefinition {
  const variant = installer.variants[platformKey];
  if (!variant) throw new Error(`No artifact variant for ${platformKey}; available variants: ${Object.keys(installer.variants).join(', ')}`);
  return variant;
}

function currentPlatformKey(): PlatformKey {
  if (process.platform !== 'linux') throw new Error(`Unsupported plugin platform: ${process.platform}-${process.arch}`);
  if (process.arch === 'x64') return 'linux-amd64';
  if (process.arch === 'arm64') return 'linux-arm64';
  throw new Error(`Unsupported plugin platform: linux-${process.arch}`);
}

function isPlatformKey(value: string): value is PlatformKey {
  return value === 'linux-amd64' || value === 'linux-arm64';
}

function parseMode(mode: string): number {
  if (!/^[0-7]{3,4}$/.test(mode)) throw new Error(`Invalid file mode: ${mode}`);
  return Number.parseInt(mode, 8);
}

function toolchainPaths(paths: PluginServiceOrchestratorPaths): { root: string; binDir: string; npmPrefix: string } {
  const root = paths.toolchainRoot ?? join(dirname(paths.installRoot), 'toolchains');
  return { root, binDir: join(root, 'bin'), npmPrefix: join(root, 'npm') };
}

function toolchainEnv(paths: PluginServiceOrchestratorPaths): NodeJS.ProcessEnv {
  const toolchain = toolchainPaths(paths);
  return {
    ...process.env,
    PATH: `${toolchain.binDir}:${join(toolchain.npmPrefix, 'bin')}:${process.env.PATH ?? ''}`,
    UV_TOOL_DIR: join(toolchain.root, 'uv', 'tools'),
    UV_TOOL_BIN_DIR: toolchain.binDir,
    NPM_CONFIG_PREFIX: toolchain.npmPrefix,
    CARGO_HOME: join(toolchain.root, 'cargo'),
    GOBIN: toolchain.binDir,
    GOPATH: join(toolchain.root, 'go'),
  };
}

function pluginBinDir(paths: PluginServiceOrchestratorPaths): string {
  return paths.pluginBinDir ?? join(dirname(paths.installRoot), 'plugin-bin');
}

function pluginDataPath(paths: PluginServiceOrchestratorPaths, plugin: PluginServiceDefinition): string {
  return join(dirname(paths.installRoot), 'plugin-data', plugin.id);
}

async function defaultExecuteCommand(command: string, args: string[], options: PluginInstallCommandOptions): Promise<void> {
  await execFileAsync(command, args, { cwd: options.cwd, env: options.env, timeout: options.timeout });
}

function isSafePackageName(value: string): boolean {
  return /^(@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/.test(value);
}

function isSafeGoModule(value: string): boolean {
  return /^[a-zA-Z0-9._~:/-]+$/.test(value) && value.includes('/');
}

function createArtifactPlans(
  plugin: PluginServiceDefinition,
  paths: PluginServiceOrchestratorPaths,
  cachedArtifacts: CachedPluginArtifact[],
): PluginArtifactDryRunPlan[] {
  const installPath = pluginInstallPath(paths, plugin);
  return plugin.installers.map((installer) => {
    if (installer.kind === 'bundled-current-repo') {
      return { action: 'bundled-current-repo', pluginId: plugin.id, version: plugin.version, installPath };
    }
    if (installer.kind !== 'github-release-asset') {
      return { action: 'install', pluginId: plugin.id, version: plugin.version, url: `${installer.kind}:${packageInstallerName(installer)}`, cachePath: toolchainPaths(paths).root, installPath };
    }

    const platformKey = currentPlatformKey();
    const variant = selectInstallerVariant(installer, platformKey);
    const cachePath = artifactCachePath(paths, installer, variant);
    const cached = cachedArtifacts.some((cachedArtifact) => {
      return cachedArtifact.pluginId === plugin.id
        && cachedArtifact.version === plugin.version
        && cachedArtifact.sha256 === variant.sha256
        && cachedArtifact.path === cachePath;
    });

    return {
      action: cached ? 'cached' : 'download',
      pluginId: plugin.id,
      version: plugin.version,
      url: githubReleaseAssetUrl(installer, variant),
      cachePath,
      installPath,
      sha256: variant.sha256,
      variant: platformKey,
      signature: variant.signature,
    };
  });
}

function packageInstallerName(installer: Exclude<PluginInstallerDefinition, { kind: 'github-release-asset' } | { kind: 'bundled-current-repo' }>): string {
  if (installer.kind === 'uv-tool' || installer.kind === 'npm-global') return `${installer.package}@${installer.version}`;
  if (installer.kind === 'cargo-crate') return `${installer.crate}@${installer.version}`;
  return `${installer.module}@${installer.version}`;
}

function renderCommand(
  plugin: PluginServiceDefinition,
  service: SupervisorServiceDefinition,
  paths: PluginServiceOrchestratorPaths,
): string {
  const expandedCommand = expandTemplate(service.command, plugin, service, paths);
  const expandedArgs = (service.args ?? []).map((arg) => expandTemplate(arg, plugin, service, paths));
  const fullCommand = [expandedCommand, ...expandedArgs].join(' ');
  if (!service.preStart?.length) return fullCommand;

  const preStart = service.preStart.map((command) => expandTemplate(command, plugin, service, paths)).join(' && ');
  return `sh -c '${escapeSingleQuotedShell(`${preStart} && exec ${fullCommand}`)}'`;
}

function renderSupervisorEnvironment(
  plugin: PluginServiceDefinition,
  service: SupervisorServiceDefinition,
  paths: PluginServiceOrchestratorPaths,
): string {
  const env: Record<string, string> = {};
  for (const port of service.ports ?? []) {
    env[port.env] = String(port.default);
    env[`${port.env}_BIND`] = port.bind;
  }
  for (const [key, value] of Object.entries(service.env ?? {})) {
    env[key] = expandTemplate(value, plugin, service, paths);
  }
  env.VD_PLUGIN_ID = plugin.id;
  env.VD_PLUGIN_VERSION = plugin.version;
  env.VD_SERVICE_ID = service.id;

  return Object.entries(env)
    .map(([key, value]) => `${key}="${escapeSupervisorEnvironmentValue(value)}"`)
    .join(',');
}

function createCaddyPluginConfigChange(input: {
  catalog: PluginServiceCatalog;
  path: string;
  existingContent?: string;
}): CaddyPluginConfigChange {
  const content = renderCaddyPluginExposureConfig({ catalog: input.catalog });
  return {
    action: input.existingContent === undefined
      ? 'create'
      : normalizeConfig(input.existingContent) === normalizeConfig(content)
        ? 'unchanged'
        : 'update',
    path: input.path,
    content,
  };
}

function expandTemplate(
  value: string,
  plugin: PluginServiceDefinition,
  service: SupervisorServiceDefinition,
  paths: PluginServiceOrchestratorPaths,
): string {
  const portValues = new Map<string, string>();
  for (const port of service.ports ?? []) {
    portValues.set(port.env, String(port.default));
    portValues.set(`${port.env}_BIND`, port.bind);
  }
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name: string) => {
    if (name === 'PLUGIN_DIR') return pluginExtractedPath(paths, plugin);
    const portValue = portValues.get(name);
    if (portValue !== undefined) return portValue;
    return `%(ENV_${name})s`;
  });
}

function validateCatalog(catalog: PluginServiceCatalog): void {
  if (!isRecord(catalog)) throw new Error('Invalid plugin catalog: expected object');
  if (!Array.isArray(catalog.plugins)) throw new Error('Invalid plugin catalog: plugins must be an array');
  const pluginIds = new Set<string>();
  for (const plugin of catalog.plugins as unknown[]) {
    if (!isRecord(plugin)) throw new Error('Invalid plugin definition: expected object');
    const typedPlugin = plugin as unknown as PluginServiceDefinition;
    validatePluginDefinition(typedPlugin);
    if (pluginIds.has(typedPlugin.id)) throw new Error(`Duplicate plugin id ${typedPlugin.id}`);
    pluginIds.add(typedPlugin.id);
    const serviceIds = new Set<string>();
    for (const service of typedPlugin.services as unknown[]) {
      if (!isRecord(service)) throw new Error(`Invalid service definition for ${typedPlugin.id}: expected object`);
      const typedService = service as unknown as SupervisorServiceDefinition;
      validateServiceDefinition(typedPlugin, typedService);
      if (serviceIds.has(typedService.id)) throw new Error(`Duplicate service id ${typedPlugin.id}/${typedService.id}`);
      serviceIds.add(typedService.id);
      if (typedService.httpExposure) validateCaddyHttpExposure(typedPlugin, typedService);
    }
  }
}

function validatePluginDefinition(plugin: PluginServiceDefinition): void {
  if (typeof plugin.id !== 'string') throw new Error('Invalid plugin id');
  if (!isSafeIdentifier(plugin.id)) throw new Error(`Invalid plugin id ${plugin.id}`);
  if (typeof plugin.name !== 'string') throw new Error(`Invalid plugin name for ${plugin.id}`);
  if (!isSafeHumanText(plugin.name)) throw new Error(`Invalid plugin name for ${plugin.id}`);
  if (typeof plugin.version !== 'string') throw new Error(`Invalid plugin version for ${plugin.id}`);
  if (!isSafePathSegment(plugin.version)) throw new Error(`Invalid plugin version for ${plugin.id}: ${plugin.version}`);
  if (!Array.isArray(plugin.installers)) throw new Error(`Invalid installers for plugin ${plugin.id}`);
  if (!Array.isArray(plugin.services)) throw new Error(`Invalid services for plugin ${plugin.id}`);
  for (const installer of plugin.installers) {
    if (!isRecord(installer)) throw new Error(`Invalid installer for plugin ${plugin.id}: expected object`);
    validateInstallerDefinition(plugin.id, installer as PluginInstallerDefinition);
  }
}

function validateInstallerDefinition(pluginId: string, installer: PluginInstallerDefinition): void {
  if (installer.kind === 'bundled-current-repo') return;
  if (installer.kind === 'github-release-asset') {
    if (typeof installer.repository !== 'string') throw new Error(`Invalid GitHub repository for ${pluginId}`);
    if (!isSafeGithubRepository(installer.repository)) throw new Error(`Invalid GitHub repository for ${pluginId}: ${installer.repository}`);
    if (typeof installer.tag !== 'string') throw new Error(`Invalid artifact tag for ${pluginId}`);
    if (!isSafePathSegment(installer.tag)) throw new Error(`Invalid artifact tag for ${pluginId}: ${installer.tag}`);
    if (!isRecord(installer.variants)) throw new Error(`Invalid artifact variants for ${pluginId}: expected object`);
    const variantKeys = Object.keys(installer.variants);
    if (variantKeys.length === 0) throw new Error(`Invalid artifact variants for ${pluginId}: expected at least one variant`);
    for (const key of variantKeys) {
      if (!isPlatformKey(key)) throw new Error(`Invalid artifact variant for ${pluginId}: ${key}`);
      const variant = installer.variants[key];
      if (!isRecord(variant)) throw new Error(`Invalid artifact variant for ${pluginId}/${key}: expected object`);
      if (typeof variant.asset !== 'string') throw new Error(`Invalid artifact asset for ${pluginId}/${key}`);
      if (!isSafePathSegment(variant.asset)) throw new Error(`Invalid artifact asset for ${pluginId}/${key}: ${variant.asset}`);
      if (typeof variant.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(variant.sha256)) {
        throw new Error(`Invalid artifact sha256 for ${pluginId}/${key}: ${variant.sha256}`);
      }
      if (variant.signature !== undefined) throw new Error(`Unsupported artifact signature for ${pluginId}: service catalog artifacts are sha256-pinned on this branch`);
    }
    validateMaterializer(pluginId, installer.materialize);
    if (installer.postExtract !== undefined) validatePostExtract(pluginId, installer.postExtract);
    if (installer.bin !== undefined) validateBinMap(pluginId, installer.bin);
    return;
  }

  if (installer.kind === 'uv-tool' || installer.kind === 'npm-global') {
    if (typeof installer.package !== 'string' || !isSafePackageName(installer.package)) throw new Error(`Invalid ${installer.kind} package for ${pluginId}`);
    validatePackageVersion(pluginId, installer.version);
    validateBins(pluginId, installer.bins);
    return;
  }
  if (installer.kind === 'cargo-crate') {
    if (typeof installer.crate !== 'string' || !isSafePackageName(installer.crate)) throw new Error(`Invalid cargo crate for ${pluginId}`);
    validatePackageVersion(pluginId, installer.version);
    validateBins(pluginId, installer.bins);
    return;
  }
  if (installer.kind === 'go-install') {
    if (typeof installer.module !== 'string' || !isSafeGoModule(installer.module)) throw new Error(`Invalid go module for ${pluginId}`);
    validatePackageVersion(pluginId, installer.version);
    validateBins(pluginId, installer.bins);
    return;
  }
  throw new Error(`Unsupported installer kind for ${pluginId}: ${(installer as { kind?: string }).kind ?? ''}`);
}

function validateMaterializer(pluginId: string, materializer: PluginMaterializerDefinition): void {
  if (!isRecord(materializer)) throw new Error(`Invalid materializer for ${pluginId}: expected object`);
  if (materializer.kind === 'file') {
    validateRelativePath(materializer.installAs, `Invalid materializer installAs for ${pluginId}`);
  } else if (materializer.kind === 'zip-entry') {
    validateRelativePath(materializer.entry, `Invalid materializer zip entry for ${pluginId}`);
    validateRelativePath(materializer.installAs, `Invalid materializer installAs for ${pluginId}`);
  } else if (materializer.kind === 'archive-tree') {
    if (!['zip', 'tar.gz'].includes(materializer.format)) throw new Error(`Invalid archive format for ${pluginId}: ${materializer.format}`);
    if (materializer.stripComponents !== undefined && (!Number.isInteger(materializer.stripComponents) || materializer.stripComponents < 0 || materializer.stripComponents > 10)) {
      throw new Error(`Invalid archive stripComponents for ${pluginId}: ${materializer.stripComponents}`);
    }
  } else {
    throw new Error(`Unsupported materializer kind for ${pluginId}: ${(materializer as { kind?: string }).kind ?? ''}`);
  }
  if (!Array.isArray(materializer.outputs) || materializer.outputs.length === 0) throw new Error(`Invalid materializer outputs for ${pluginId}`);
  for (const output of materializer.outputs) validateOutput(pluginId, output);
  if ('mode' in materializer && materializer.mode !== undefined) parseMode(materializer.mode);
}

function validateOutput(pluginId: string, output: PluginMaterializedOutputDefinition): void {
  if (!isRecord(output)) throw new Error(`Invalid materializer output for ${pluginId}: expected object`);
  if (output.kind !== 'file' && output.kind !== 'directory') throw new Error(`Invalid materializer output kind for ${pluginId}: ${(output as { kind?: string }).kind ?? ''}`);
  validateRelativePath(output.path, `Invalid materializer output path for ${pluginId}`);
  if (output.mode !== undefined) parseMode(output.mode);
}

function validatePostExtract(pluginId: string, script: PluginPostExtractScriptDefinition): void {
  if (!isRecord(script)) throw new Error(`Invalid postExtract for ${pluginId}: expected object`);
  if (script.kind !== 'admin-script') throw new Error(`Invalid postExtract kind for ${pluginId}: ${(script as { kind?: string }).kind ?? ''}`);
  if (typeof script.command !== 'string' || !isSafeHumanText(script.command)) throw new Error(`Invalid postExtract command for ${pluginId}`);
  if (script.timeoutSeconds !== undefined && (!Number.isInteger(script.timeoutSeconds) || script.timeoutSeconds < 1 || script.timeoutSeconds > 3600)) {
    throw new Error(`Invalid postExtract timeoutSeconds for ${pluginId}: ${script.timeoutSeconds}`);
  }
}

function validateBinMap(pluginId: string, bin: Record<string, string>): void {
  if (!isPlainStringRecord(bin)) throw new Error(`Invalid bin map for ${pluginId}`);
  for (const [name, target] of Object.entries(bin)) {
    if (!isSafePathSegment(name)) throw new Error(`Invalid bin name for ${pluginId}: ${name}`);
    validateRelativePath(target, `Invalid bin target for ${pluginId}`);
  }
}

function validateBins(pluginId: string, bins: string[] | undefined): void {
  if (bins === undefined) return;
  if (!isStringArray(bins)) throw new Error(`Invalid package manager bins for ${pluginId}`);
  for (const bin of bins) if (!isSafePathSegment(bin)) throw new Error(`Invalid package manager bin for ${pluginId}: ${bin}`);
}

function validatePackageVersion(pluginId: string, version: string): void {
  if (typeof version !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._+:-]{0,127}$/.test(version)) throw new Error(`Invalid package version for ${pluginId}: ${version}`);
}

function validateServiceDefinition(plugin: PluginServiceDefinition, service: SupervisorServiceDefinition): void {
  if (typeof service.id !== 'string') throw new Error(`Invalid service id ${plugin.id}`);
  if (!isSafeIdentifier(service.id)) throw new Error(`Invalid service id ${plugin.id}/${service.id}`);
  if (typeof service.command !== 'string') throw new Error(`Invalid service command for ${plugin.id}/${service.id}`);
  validateSupervisorRenderedValue(service.command, `Invalid service command for ${plugin.id}/${service.id}`);
  if (typeof service.directory !== 'string') throw new Error(`Invalid service directory for ${plugin.id}/${service.id}`);
  validateSupervisorRenderedValue(service.directory, `Invalid service directory for ${plugin.id}/${service.id}`);
  if (typeof service.user !== 'string') throw new Error(`Invalid service user for ${plugin.id}/${service.id}`);
  if (service.user !== 'vkuser') throw new Error(`Invalid service user for ${plugin.id}/${service.id}: ${service.user}`);
  if (typeof service.autostart !== 'boolean') throw new Error(`Invalid service autostart for ${plugin.id}/${service.id}`);
  if (typeof service.autorestart !== 'boolean') throw new Error(`Invalid service autorestart for ${plugin.id}/${service.id}`);
  if (service.singleton !== undefined && typeof service.singleton !== 'boolean') {
    throw new Error(`Invalid service singleton for ${plugin.id}/${service.id}`);
  }
  if (service.args !== undefined && !isStringArray(service.args)) throw new Error(`Invalid service args for ${plugin.id}/${service.id}`);
  for (const arg of service.args ?? []) validateSupervisorRenderedValue(arg, `Invalid service arg for ${plugin.id}/${service.id}`);
  if (service.preStart !== undefined && !isStringArray(service.preStart)) throw new Error(`Invalid service preStart for ${plugin.id}/${service.id}`);
  for (const command of service.preStart ?? []) validateSupervisorRenderedValue(command, `Invalid preStart command for ${plugin.id}/${service.id}`);
  if (service.env !== undefined && !isPlainStringRecord(service.env)) throw new Error(`Invalid service env for ${plugin.id}/${service.id}`);
  for (const [key, value] of Object.entries(service.env ?? {})) {
    if (!isSafeEnvKey(key)) throw new Error(`Invalid env key for ${plugin.id}/${service.id}: ${key}`);
    validateSupervisorRenderedValue(value, `Invalid env value for ${plugin.id}/${service.id}/${key}`);
  }
  if (service.ports !== undefined && !Array.isArray(service.ports)) throw new Error(`Invalid service ports for ${plugin.id}/${service.id}`);
  for (const port of service.ports ?? []) {
    if (!isRecord(port)) throw new Error(`Invalid port definition for ${plugin.id}/${service.id}: expected object`);
    validatePortDefinition(plugin, service, port);
  }
}

function validatePortDefinition(
  plugin: PluginServiceDefinition,
  service: SupervisorServiceDefinition,
  port: ServicePortDefinition,
): void {
  if (typeof port.name !== 'string') throw new Error(`Invalid port name for ${plugin.id}/${service.id}`);
  if (!isSafeIdentifier(port.name)) throw new Error(`Invalid port name for ${plugin.id}/${service.id}: ${port.name}`);
  if (typeof port.env !== 'string') throw new Error(`Invalid port env for ${plugin.id}/${service.id}/${port.name}`);
  if (!isSafeEnvKey(port.env)) throw new Error(`Invalid port env for ${plugin.id}/${service.id}/${port.name}: ${port.env}`);
  if (!Number.isInteger(port.default) || port.default < 1 || port.default > 65535) {
    throw new Error(`Invalid port default for ${plugin.id}/${service.id}/${port.name}: ${port.default}`);
  }
  if (typeof port.bind !== 'string') throw new Error(`Invalid port bind for ${plugin.id}/${service.id}/${port.name}`);
  if (!['127.0.0.1', '0.0.0.0', 'localhost'].includes(port.bind)) {
    throw new Error(`Invalid port bind for ${plugin.id}/${service.id}/${port.name}: ${port.bind}`);
  }
}

function validateCaddyHttpExposure(plugin: PluginServiceDefinition, service: SupervisorServiceDefinition): void {
  const exposure = service.httpExposure;
  if (!exposure) return;
  if (!isRecord(exposure)) throw new Error(`Invalid Caddy exposure for ${plugin.id}/${service.id}: expected object`);
  if (exposure.kind !== 'caddy-subdomain') {
    throw new Error(`Unsupported Caddy exposure kind for ${plugin.id}/${service.id}: ${(exposure as { kind?: string }).kind ?? ''}`);
  }
  if (!isSafeSubdomainLabel(exposure.subdomain)) {
    throw new Error(`Invalid Caddy subdomain for ${plugin.id}/${service.id}: ${exposure.subdomain}`);
  }
  getServicePortByName(plugin, service, exposure.port);
}

function getServicePortByName(
  plugin: PluginServiceDefinition,
  service: SupervisorServiceDefinition,
  portName: string,
): ServicePortDefinition {
  const port = service.ports?.find((candidate) => candidate.name === portName);
  if (!port) throw new Error(`Caddy exposure for ${plugin.id}/${service.id} references unknown port ${portName}`);
  return port;
}

function githubReleaseAssetUrl(
  installer: Extract<PluginInstallerDefinition, { kind: 'github-release-asset' }>,
  variant: PluginArtifactVariantDefinition,
): string {
  return `https://github.com/${installer.repository}/releases/download/${installer.tag}/${variant.asset}`;
}

function artifactCachePath(
  paths: PluginServiceOrchestratorPaths,
  installer: Extract<PluginInstallerDefinition, { kind: 'github-release-asset' }>,
  variant: PluginArtifactVariantDefinition,
): string {
  return join(paths.artifactCacheRoot, 'github', installer.repository, installer.tag, variant.asset);
}

function supervisorConfigPath(
  paths: PluginServiceOrchestratorPaths,
  plugin: PluginServiceDefinition,
  service: SupervisorServiceDefinition,
): string {
  return join(paths.supervisorConfigDir, `${supervisorProgramName(plugin, service)}.conf`);
}

function supervisorProgramName(plugin: PluginServiceDefinition, service: SupervisorServiceDefinition): string {
  return `vd-plugin--${sanitizeIdentifier(plugin.id)}--${sanitizeIdentifier(service.id)}`;
}

function pluginInstallPath(paths: PluginServiceOrchestratorPaths, plugin: PluginServiceDefinition): string {
  return join(paths.installRoot, plugin.id, plugin.version);
}

function pluginExtractedPath(paths: PluginServiceOrchestratorPaths, plugin: PluginServiceDefinition): string {
  return join(pluginInstallPath(paths, plugin), 'extracted');
}

function isGeneratedSupervisorConfigPath(paths: PluginServiceOrchestratorPaths, path: string): boolean {
  return dirname(path) === paths.supervisorConfigDir && path.endsWith('.conf');
}

function normalizeConfig(config: string): string {
  return config.replace(/\r\n/g, '\n').trimEnd() + '\n';
}

function sanitizeIdentifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '_');
}

function caddyMatcherName(plugin: PluginServiceDefinition, service: SupervisorServiceDefinition): string {
  return sanitizeIdentifier(`vd_plugin_${plugin.id}_${service.id}`);
}

function caddyUpstreamHost(bind: string): string {
  return bind === '127.0.0.1' || bind === 'localhost' ? bind : '127.0.0.1';
}

function isSafeSubdomainLabel(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value);
}

function isSafeIdentifier(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
}

function isSafeEnvKey(value: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/.test(value);
}

function isSafeGithubRepository(value: string): boolean {
  const parts = value.split('/');
  return parts.length === 2 && parts.every(isSafePathSegment);
}

function isSafePathSegment(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)
    && value !== '.'
    && value !== '..';
}

function validateRelativePath(value: string, message: string): void {
  if (value.startsWith('/') || value.includes('\\')) throw new Error(`${message}: ${value}`);
  const segments = value.split('/');
  if (segments.some((segment) => !isSafePathSegment(segment))) throw new Error(`${message}: ${value}`);
}

function validateSupervisorRenderedValue(value: string, message: string): void {
  if (!isSafeHumanText(value)) throw new Error(`${message}: ${value}`);
}

function isSafeHumanText(value: string): boolean {
  return typeof value === 'string' && !/[\u0000-\u001f\u007f]/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isPlainStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function escapeSupervisorEnvironmentValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeSingleQuotedShell(value: string): string {
  return value.replace(/'/g, `'"'"'`);
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  return new Uint8Array(await response.arrayBuffer());
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}
