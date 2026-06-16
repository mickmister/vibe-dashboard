import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface PluginServiceCatalog {
  plugins: PluginServiceDefinition[];
}

export type PluginArtifactDefinition =
  | { kind: 'bundled-current-repo' }
  | {
    kind: 'github-release-asset';
    repository: string;
    tag: string;
    asset: string;
    sha256: string;
    /** First-party service artifacts are sha256-pinned on this branch. Marketplace signatures are deferred. */
    signature?: string;
    installAs?: string;
  };

export interface PluginServiceDefinition {
  id: string;
  name: string;
  version: string;
  artifact: PluginArtifactDefinition;
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
    action: 'cached' | 'download';
    pluginId: string;
    version: string;
    url: string;
    cachePath: string;
    installPath: string;
    sha256: string;
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
  action: 'bundled-current-repo' | 'cached' | 'downloaded';
  pluginId: string;
  version: string;
  cachePath?: string;
  installPath: string;
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

  const artifacts = input.catalog.plugins.map((plugin) => createArtifactPlan(plugin, input.paths, input.cachedArtifacts));
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
}): Promise<CachedPluginArtifact[]> {
  const cachedArtifacts: CachedPluginArtifact[] = [];
  validateCatalog(input.catalog);

  for (const plugin of input.catalog.plugins) {
    if (plugin.artifact.kind !== 'github-release-asset') continue;
    const path = artifactCachePath(input.paths, plugin.artifact);
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (error) {
      if (isNodeErrorWithCode(error, 'ENOENT')) continue;
      throw error;
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 === plugin.artifact.sha256) {
      cachedArtifacts.push({ pluginId: plugin.id, version: plugin.version, sha256, path });
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

export async function materializePluginArtifacts(input: {
  catalog: PluginServiceCatalog;
  paths: PluginServiceOrchestratorPaths;
  allowHashMismatch?: boolean;
  fetchBytes?: (url: string) => Promise<Uint8Array>;
}): Promise<PluginArtifactMaterialization[]> {
  validateCatalog(input.catalog);
  const materialized: PluginArtifactMaterialization[] = [];

  for (const plugin of input.catalog.plugins) {
    const installPath = pluginInstallPath(input.paths, plugin);
    if (plugin.artifact.kind === 'bundled-current-repo') {
      materialized.push({ action: 'bundled-current-repo', pluginId: plugin.id, version: plugin.version, installPath });
      continue;
    }

    const artifact = plugin.artifact;
    const cachePath = artifactCachePath(input.paths, artifact);
    let cacheHit = true;
    let bytes = await readFile(cachePath).catch(async (error: unknown) => {
      if (!isNodeErrorWithCode(error, 'ENOENT')) throw error;
      cacheHit = false;
      return downloadVerifiedArtifact({ plugin, artifact, cachePath, allowHashMismatch: input.allowHashMismatch, fetchBytes: input.fetchBytes });
    });

    let sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== artifact.sha256 && !input.allowHashMismatch) {
      await quarantineBadCacheFile(cachePath);
      cacheHit = false;
      bytes = await downloadVerifiedArtifact({ plugin, artifact, cachePath, allowHashMismatch: input.allowHashMismatch, fetchBytes: input.fetchBytes });
      sha256 = createHash('sha256').update(bytes).digest('hex');
    }

    const installAs = artifact.installAs ?? artifact.asset;
    const installTarget = join(pluginExtractedPath(input.paths, plugin), installAs);
    await mkdir(dirname(installTarget), { recursive: true });
    const installedBytes = await readFile(installTarget).catch((error: unknown) => {
      if (isNodeErrorWithCode(error, 'ENOENT')) return undefined;
      throw error;
    });
    const installedSha256 = installedBytes
      ? createHash('sha256').update(installedBytes).digest('hex')
      : undefined;
    if (installedSha256 !== sha256) {
      await copyFile(cachePath, installTarget);
    }
    await chmod(installTarget, 0o755);

    materialized.push({
      action: cacheHit ? 'cached' : 'downloaded',
      pluginId: plugin.id,
      version: plugin.version,
      cachePath,
      installPath,
    });
  }

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
        `\treverse_proxy localhost:${port.default} {`,
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
  artifact: Extract<PluginArtifactDefinition, { kind: 'github-release-asset' }>;
  cachePath: string;
  allowHashMismatch?: boolean;
  fetchBytes?: (url: string) => Promise<Uint8Array>;
}): Promise<Buffer> {
  const downloaded = await (input.fetchBytes ?? fetchBytes)(githubReleaseAssetUrl(input.artifact));
  const downloadedSha256 = createHash('sha256').update(downloaded).digest('hex');
  if (downloadedSha256 !== input.artifact.sha256 && !input.allowHashMismatch) {
    throw new Error(`Artifact sha256 mismatch for ${input.plugin.id}@${input.plugin.version}: expected ${input.artifact.sha256}, got ${downloadedSha256}`);
  }
  await mkdir(dirname(input.cachePath), { recursive: true });
  const temporaryPath = `${input.cachePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, downloaded, { mode: 0o644 });
  await rename(temporaryPath, input.cachePath);
  return Buffer.from(downloaded);
}

async function quarantineBadCacheFile(cachePath: string): Promise<void> {
  const quarantinePath = `${cachePath}.bad-${process.pid}-${Date.now()}`;
  try {
    await rename(cachePath, quarantinePath);
  } catch (error) {
    if (!isNodeErrorWithCode(error, 'ENOENT')) throw error;
  }
}

function createArtifactPlan(
  plugin: PluginServiceDefinition,
  paths: PluginServiceOrchestratorPaths,
  cachedArtifacts: CachedPluginArtifact[],
): PluginArtifactDryRunPlan {
  const installPath = pluginInstallPath(paths, plugin);
  if (plugin.artifact.kind === 'bundled-current-repo') {
    return { action: 'bundled-current-repo', pluginId: plugin.id, version: plugin.version, installPath };
  }

  const artifact = plugin.artifact;
  const cachePath = artifactCachePath(paths, artifact);
  const cached = cachedArtifacts.some((cachedArtifact) => {
    return cachedArtifact.pluginId === plugin.id
      && cachedArtifact.version === plugin.version
      && cachedArtifact.sha256 === artifact.sha256
      && cachedArtifact.path === cachePath;
  });

  return {
    action: cached ? 'cached' : 'download',
    pluginId: plugin.id,
    version: plugin.version,
    url: githubReleaseAssetUrl(artifact),
    cachePath,
    installPath,
    sha256: artifact.sha256,
    signature: artifact.signature,
  };
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
  for (const port of service.ports ?? []) env[port.env] = String(port.default);
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
  const portValues = new Map((service.ports ?? []).map((port) => [port.env, String(port.default)]));
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name: string) => {
    if (name === 'PLUGIN_DIR') return pluginExtractedPath(paths, plugin);
    const portValue = portValues.get(name);
    if (portValue !== undefined) return portValue;
    return `%(ENV_${name})s`;
  });
}

function validateCatalog(catalog: PluginServiceCatalog): void {
  if (!Array.isArray(catalog.plugins)) throw new Error('Invalid plugin catalog: plugins must be an array');
  const pluginIds = new Set<string>();
  for (const plugin of catalog.plugins) {
    validatePluginDefinition(plugin);
    if (pluginIds.has(plugin.id)) throw new Error(`Duplicate plugin id ${plugin.id}`);
    pluginIds.add(plugin.id);
    const serviceIds = new Set<string>();
    for (const service of plugin.services) {
      validateServiceDefinition(plugin, service);
      if (serviceIds.has(service.id)) throw new Error(`Duplicate service id ${plugin.id}/${service.id}`);
      serviceIds.add(service.id);
      if (service.httpExposure) validateCaddyHttpExposure(plugin, service);
    }
  }
}

function validatePluginDefinition(plugin: PluginServiceDefinition): void {
  if (!isSafeIdentifier(plugin.id)) throw new Error(`Invalid plugin id ${plugin.id}`);
  if (!isSafeHumanText(plugin.name)) throw new Error(`Invalid plugin name for ${plugin.id}`);
  if (!isSafePathSegment(plugin.version)) throw new Error(`Invalid plugin version for ${plugin.id}: ${plugin.version}`);
  if (!Array.isArray(plugin.services)) throw new Error(`Invalid services for plugin ${plugin.id}`);

  if (plugin.artifact.kind === 'github-release-asset') {
    if (!isSafeGithubRepository(plugin.artifact.repository)) {
      throw new Error(`Invalid GitHub repository for ${plugin.id}: ${plugin.artifact.repository}`);
    }
    if (!isSafePathSegment(plugin.artifact.tag)) {
      throw new Error(`Invalid artifact tag for ${plugin.id}: ${plugin.artifact.tag}`);
    }
    if (!isSafePathSegment(plugin.artifact.asset)) {
      throw new Error(`Invalid artifact asset for ${plugin.id}: ${plugin.artifact.asset}`);
    }
    if (!/^[a-fA-F0-9]{64}$/.test(plugin.artifact.sha256)) {
      throw new Error(`Invalid artifact sha256 for ${plugin.id}: ${plugin.artifact.sha256}`);
    }
    if (plugin.artifact.signature !== undefined) {
      throw new Error(`Unsupported artifact signature for ${plugin.id}: service catalog artifacts are sha256-pinned on this branch`);
    }
    if (plugin.artifact.installAs !== undefined) {
      validateRelativePath(plugin.artifact.installAs, `Invalid artifact installAs for ${plugin.id}`);
    }
    return;
  }

  if (plugin.artifact.kind !== 'bundled-current-repo') {
    throw new Error(`Unsupported artifact kind for ${plugin.id}: ${(plugin.artifact as { kind?: string }).kind ?? ''}`);
  }
}

function validateServiceDefinition(plugin: PluginServiceDefinition, service: SupervisorServiceDefinition): void {
  if (!isSafeIdentifier(service.id)) throw new Error(`Invalid service id ${plugin.id}/${service.id}`);
  validateSupervisorRenderedValue(service.command, `Invalid service command for ${plugin.id}/${service.id}`);
  validateSupervisorRenderedValue(service.directory, `Invalid service directory for ${plugin.id}/${service.id}`);
  if (service.user !== 'vkuser') throw new Error(`Invalid service user for ${plugin.id}/${service.id}: ${service.user}`);
  for (const arg of service.args ?? []) validateSupervisorRenderedValue(arg, `Invalid service arg for ${plugin.id}/${service.id}`);
  for (const command of service.preStart ?? []) validateSupervisorRenderedValue(command, `Invalid preStart command for ${plugin.id}/${service.id}`);
  for (const [key, value] of Object.entries(service.env ?? {})) {
    if (!isSafeEnvKey(key)) throw new Error(`Invalid env key for ${plugin.id}/${service.id}: ${key}`);
    validateSupervisorRenderedValue(value, `Invalid env value for ${plugin.id}/${service.id}/${key}`);
  }
  for (const port of service.ports ?? []) validatePortDefinition(plugin, service, port);
}

function validatePortDefinition(
  plugin: PluginServiceDefinition,
  service: SupervisorServiceDefinition,
  port: ServicePortDefinition,
): void {
  if (!isSafeIdentifier(port.name)) throw new Error(`Invalid port name for ${plugin.id}/${service.id}: ${port.name}`);
  if (!isSafeEnvKey(port.env)) throw new Error(`Invalid port env for ${plugin.id}/${service.id}/${port.name}: ${port.env}`);
  if (!Number.isInteger(port.default) || port.default < 1 || port.default > 65535) {
    throw new Error(`Invalid port default for ${plugin.id}/${service.id}/${port.name}: ${port.default}`);
  }
  if (!['127.0.0.1', '0.0.0.0', 'localhost'].includes(port.bind)) {
    throw new Error(`Invalid port bind for ${plugin.id}/${service.id}/${port.name}: ${port.bind}`);
  }
}

function validateCaddyHttpExposure(plugin: PluginServiceDefinition, service: SupervisorServiceDefinition): void {
  const exposure = service.httpExposure;
  if (!exposure) return;
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

function githubReleaseAssetUrl(artifact: Extract<PluginArtifactDefinition, { kind: 'github-release-asset' }>): string {
  return `https://github.com/${artifact.repository}/releases/download/${artifact.tag}/${artifact.asset}`;
}

function artifactCachePath(
  paths: PluginServiceOrchestratorPaths,
  artifact: Extract<PluginArtifactDefinition, { kind: 'github-release-asset' }>,
): string {
  return join(paths.artifactCacheRoot, 'github', artifact.repository, artifact.tag, artifact.asset);
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
