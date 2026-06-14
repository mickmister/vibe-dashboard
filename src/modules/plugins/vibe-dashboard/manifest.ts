export const PLUGIN_MANIFEST_SCHEMA_VERSION = 1 as const;

export type PluginKind = 'marketplace' | 'local' | 'first-party-service';
export type FilesystemAccess = 'read' | 'readWrite';
export type FilesystemScope = 'plugin-data' | 'workspace' | 'repo' | 'absolute';
export type NetworkMode = 'none' | 'egress' | 'ingress' | 'ingress-and-egress';
export type VkHttpApiCapability = 'none' | 'read' | 'write' | 'agentPrompt';
export type CodeServerCapability = 'none' | 'workspace' | 'admin';
export type HostDockerCapability = 'none' | 'microvm-dockerd' | 'host-socket';
export type ComponentRuntime = 'supervisor' | 'deno' | 'container';
export type VersionSourceKind = 'github-release-asset';

export interface PluginManifest {
  schemaVersion: typeof PLUGIN_MANIFEST_SCHEMA_VERSION;
  id: string;
  version: string;
  displayName: string;
  kind?: PluginKind;
  description?: string;
  compatibility?: {
    vibeDashboard?: string;
    pluginApi?: string;
  };
  components: PluginComponents;
  requestedCapabilities?: Partial<PluginCapabilityRequests>;
}

export interface PluginComponents {
  frontend?: PluginFrontendComponent;
  denoBridges?: DenoComponent[];
  denoBackends?: DenoComponent[];
  containers?: ContainerComponent[];
  services?: ServiceComponent[];
  mcp?: McpContribution[];
  storage?: StorageContribution[];
  secrets?: SecretContribution[];
  healthChecks?: HealthCheck[];
  lifecycle?: LifecycleContribution;
}

export interface PluginFrontendComponent {
  kind: 'iframe';
  entry: string;
  routes?: PluginRouteContribution[];
  craftSurfaces?: CraftSurfaceContribution[];
  allowSameOrigin?: boolean;
}

export interface PluginRouteContribution {
  id: string;
  title: string;
  path: string;
}

export interface CraftSurfaceContribution {
  id: string;
  title: string;
  route: string;
}

export interface DenoComponent {
  id: string;
  entry: string;
  methods?: string[];
  permissions?: DenoPermissions;
}

export interface DenoPermissions {
  read?: string[];
  write?: string[];
  net?: string[];
  env?: string[];
  run?: string[];
  imports?: string[];
}

export interface ContainerComponent {
  id: string;
  image: string;
  composeFile?: string;
  dockerd: 'microvm';
  services?: string[];
}

export interface ServiceComponent {
  id: string;
  runtime: ComponentRuntime;
  command: string;
  versionSource?: GithubReleaseAssetVersionSource;
}

export interface GithubReleaseAssetVersionSource {
  kind: VersionSourceKind;
  repository: string;
  tag: string;
  asset: string;
}

export interface McpContribution {
  id: string;
  serverName: string;
  transport: 'stdio' | 'http';
  command?: string;
  url?: string;
  tools?: string[];
}

export interface StorageContribution {
  id: string;
  scope: 'plugin-data' | 'workspace';
  path: string;
  access: FilesystemAccess;
}

export interface SecretContribution {
  id: string;
  provider: 'varlock';
  ref: string;
}

export interface HealthCheck {
  id: string;
  kind: 'asset-exists' | 'http' | 'command';
  target: string;
}

export interface LifecycleContribution {
  start?: string;
  stop?: string;
  restart?: string;
}

export interface FilesystemRequest {
  scope: FilesystemScope;
  path: string;
  access: FilesystemAccess;
}

export interface NetworkRequest {
  mode: NetworkMode;
  hosts?: string[];
  ports?: string[];
}

export interface HostShellRequest {
  commands: string[];
}

export interface PluginAccessRequest {
  pluginId: string;
  methods: string[];
}

export interface PluginCapabilityRequests {
  vkHttpApi: VkHttpApiCapability;
  hostShell: 'none' | HostShellRequest;
  codeServer: CodeServerCapability;
  hostDocker: HostDockerCapability;
  filesystem: FilesystemRequest[];
  network: NetworkRequest;
  env: string[];
  secrets: string[];
  plugins: PluginAccessRequest[];
}

export interface EffectivePluginGrants {
  pluginId: string;
  pluginVersion: string;
  requested: PluginCapabilityRequests;
  approved: PluginCapabilityRequests;
  approval: {
    state: 'unapproved' | 'approved';
    approvalId?: string;
    approvedBy?: string;
  };
}

export interface PluginManifestValidationResult {
  success: boolean;
  errors: string[];
  manifest?: PluginManifest;
}

export const DEFAULT_PLUGIN_CAPABILITY_REQUESTS: PluginCapabilityRequests = Object.freeze({
  vkHttpApi: 'none',
  hostShell: 'none',
  codeServer: 'none',
  hostDocker: 'none',
  filesystem: [],
  network: Object.freeze({ mode: 'none' }),
  env: [],
  secrets: [],
  plugins: [],
});

const manifestFields = new Set([
  'schemaVersion',
  'id',
  'version',
  'displayName',
  'kind',
  'description',
  'compatibility',
  'components',
  'requestedCapabilities',
]);

const componentFields = new Set([
  'frontend',
  'denoBridges',
  'denoBackends',
  'containers',
  'services',
  'mcp',
  'storage',
  'secrets',
  'healthChecks',
  'lifecycle',
]);

const requestedCapabilityFields = new Set([
  'vkHttpApi',
  'hostShell',
  'codeServer',
  'hostDocker',
  'filesystem',
  'network',
  'env',
  'secrets',
  'plugins',
]);

const frontendFields = new Set(['kind', 'entry', 'routes', 'craftSurfaces', 'allowSameOrigin']);
const denoFields = new Set(['id', 'entry', 'methods', 'permissions']);
const denoPermissionFields = new Set(['read', 'write', 'net', 'env', 'run', 'imports']);
const containerFields = new Set(['id', 'image', 'composeFile', 'dockerd', 'services']);
const serviceFields = new Set(['id', 'runtime', 'command', 'versionSource']);
const versionSourceFields = new Set(['kind', 'repository', 'tag', 'asset']);
const mcpFields = new Set(['id', 'serverName', 'transport', 'command', 'url', 'tools']);
const storageFields = new Set(['id', 'scope', 'path', 'access']);
const secretFields = new Set(['id', 'provider', 'ref']);
const healthFields = new Set(['id', 'kind', 'target']);

export function validatePluginManifest(input: unknown): PluginManifestValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { success: false, errors: ['Manifest must be an object'] };
  }

  rejectUnknownFields(input, manifestFields, errors, 'manifest');

  if (input.schemaVersion !== PLUGIN_MANIFEST_SCHEMA_VERSION) {
    errors.push(`Unsupported plugin manifest schema version ${String(input.schemaVersion)}`);
  }
  if (!isSafeIdentifier(input.id)) errors.push('Plugin id must be a reverse-DNS safe identifier');
  if (!isNonEmptyString(input.version)) errors.push('Plugin version is required');
  if (!isNonEmptyString(input.displayName)) errors.push('Plugin displayName is required');
  if (input.kind !== undefined && !isPluginKind(input.kind)) {
    errors.push(`Unsupported plugin kind: ${String(input.kind)}`);
  }

  if (!isRecord(input.components)) {
    errors.push('Plugin must declare components');
  } else {
    validateComponents(input.components, errors);
  }

  if (input.requestedCapabilities !== undefined) {
    if (!isRecord(input.requestedCapabilities)) {
      errors.push('requestedCapabilities must be an object');
    } else {
      rejectUnknownFields(
        input.requestedCapabilities,
        requestedCapabilityFields,
        errors,
        'requestedCapabilities',
      );
      validateRequestedCapabilityShapes(input.requestedCapabilities, errors);
    }
  }

  const manifest = input as unknown as PluginManifest;
  if (isRecord(input.components)) {
    validateCapabilityPolicy(manifest, errors);
  }

  return {
    success: errors.length === 0,
    errors,
    manifest: errors.length === 0 ? manifest : undefined,
  };
}

export function getRequestedCapabilities(manifest: PluginManifest): PluginCapabilityRequests {
  const requested = isRecord(manifest.requestedCapabilities) ? manifest.requestedCapabilities : {};
  const filesystem = Array.isArray(requested.filesystem)
    ? (requested.filesystem as FilesystemRequest[])
    : DEFAULT_PLUGIN_CAPABILITY_REQUESTS.filesystem;
  const env = Array.isArray(requested.env) ? (requested.env as string[]) : DEFAULT_PLUGIN_CAPABILITY_REQUESTS.env;
  const secrets = Array.isArray(requested.secrets)
    ? (requested.secrets as string[])
    : DEFAULT_PLUGIN_CAPABILITY_REQUESTS.secrets;
  const plugins = Array.isArray(requested.plugins)
    ? (requested.plugins as PluginAccessRequest[])
    : DEFAULT_PLUGIN_CAPABILITY_REQUESTS.plugins;

  return {
    vkHttpApi: isVkHttpApiCapability(requested.vkHttpApi)
      ? requested.vkHttpApi
      : DEFAULT_PLUGIN_CAPABILITY_REQUESTS.vkHttpApi,
    hostShell: requested.hostShell === 'none' || isHostShellRequest(requested.hostShell)
      ? requested.hostShell
      : DEFAULT_PLUGIN_CAPABILITY_REQUESTS.hostShell,
    codeServer: isCodeServerCapability(requested.codeServer)
      ? requested.codeServer
      : DEFAULT_PLUGIN_CAPABILITY_REQUESTS.codeServer,
    hostDocker: isHostDockerCapability(requested.hostDocker)
      ? requested.hostDocker
      : DEFAULT_PLUGIN_CAPABILITY_REQUESTS.hostDocker,
    filesystem: cloneArray(filesystem),
    network: isNetworkRequest(requested.network)
      ? { ...requested.network }
      : { ...DEFAULT_PLUGIN_CAPABILITY_REQUESTS.network },
    env: cloneArray(env),
    secrets: cloneArray(secrets),
    plugins: cloneArray(plugins),
  };
}

export function createDeniedEffectivePluginGrants(manifest: PluginManifest): EffectivePluginGrants {
  return {
    pluginId: manifest.id,
    pluginVersion: manifest.version,
    requested: getRequestedCapabilities(manifest),
    approved: {
      ...DEFAULT_PLUGIN_CAPABILITY_REQUESTS,
      filesystem: [],
      env: [],
      secrets: [],
      plugins: [],
    },
    approval: {
      state: 'unapproved',
    },
  };
}


function validateRequestedCapabilityShapes(value: Record<string, unknown>, errors: string[]): void {
  if (value.vkHttpApi !== undefined && !isVkHttpApiCapability(value.vkHttpApi)) {
    errors.push('requestedCapabilities.vkHttpApi is unsupported');
  }
  if (value.hostShell !== undefined && value.hostShell !== 'none' && !isHostShellRequest(value.hostShell)) {
    errors.push('requestedCapabilities.hostShell must be none or a command request');
  }
  if (value.codeServer !== undefined && !isCodeServerCapability(value.codeServer)) {
    errors.push('requestedCapabilities.codeServer is unsupported');
  }
  if (value.hostDocker !== undefined && !isHostDockerCapability(value.hostDocker)) {
    errors.push('requestedCapabilities.hostDocker is unsupported');
  }
  if (value.filesystem !== undefined && !Array.isArray(value.filesystem)) {
    errors.push('requestedCapabilities.filesystem must be an array');
  }
  if (value.network !== undefined && !isNetworkRequest(value.network)) {
    errors.push('requestedCapabilities.network is unsupported');
  }
  for (const field of ['env', 'secrets'] as const) {
    if (value[field] !== undefined && !isStringArray(value[field])) {
      errors.push(`requestedCapabilities.${field} must be a string array`);
    }
  }
  if (value.plugins !== undefined && !Array.isArray(value.plugins)) {
    errors.push('requestedCapabilities.plugins must be an array');
  }
}

function validateComponents(components: Record<string, unknown>, errors: string[]): void {
  rejectUnknownFields(components, componentFields, errors, 'components');
  if (!componentFieldsArray.some((field) => components[field] !== undefined)) {
    errors.push('Plugin must declare at least one component');
  }

  if (components.frontend !== undefined) validateFrontend(components.frontend, errors);
  validateDenoArray(components.denoBridges, errors, 'components.denoBridges');
  validateDenoArray(components.denoBackends, errors, 'components.denoBackends');
  validateContainerArray(components.containers, errors);
  validateServiceArray(components.services, errors);
  validateMcpArray(components.mcp, errors);
  validateStorageArray(components.storage, errors);
  validateSecretArray(components.secrets, errors);
  validateHealthArray(components.healthChecks, errors);
}

const componentFieldsArray = Array.from(componentFields);

function validateFrontend(frontend: unknown, errors: string[]): void {
  if (!isRecord(frontend)) {
    errors.push('components.frontend must be an object');
    return;
  }
  rejectUnknownFields(frontend, frontendFields, errors, 'components.frontend');
  if (frontend.kind !== 'iframe') errors.push('Frontend component kind must be iframe');
  if (!isSafeRelativePath(frontend.entry)) errors.push('Frontend entry must be a safe relative path');
}

function validateDenoArray(value: unknown, errors: string[], path: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      errors.push(`${path}[${index}] must be an object`);
      continue;
    }
    rejectUnknownFields(item, denoFields, errors, `${path}[${index}]`);
    if (!isSafeIdentifier(item.id)) errors.push(`${path}[${index}].id must be a safe identifier`);
    if (!isSafeRelativePath(item.entry)) errors.push(`${path}[${index}].entry must be a safe relative path`);
    if (item.permissions !== undefined) {
      if (!isRecord(item.permissions)) {
        errors.push(`${path}[${index}].permissions must be an object`);
      } else {
        rejectUnknownFields(item.permissions, denoPermissionFields, errors, `${path}[${index}].permissions`);
      }
    }
  }
}

function validateContainerArray(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push('components.containers must be an array');
    return;
  }
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      errors.push(`components.containers[${index}] must be an object`);
      continue;
    }
    rejectUnknownFields(item, containerFields, errors, `components.containers[${index}]`);
    if (!isSafeIdentifier(item.id)) errors.push(`components.containers[${index}].id must be a safe identifier`);
    if (!isGhcrDigestPinnedImage(item.image)) {
      errors.push(`components.containers[${index}].image must be a ghcr.io digest-pinned reference`);
    }
    if (item.dockerd !== 'microvm') errors.push(`components.containers[${index}].dockerd must be microvm`);
  }
}

function validateServiceArray(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push('components.services must be an array');
    return;
  }
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      errors.push(`components.services[${index}] must be an object`);
      continue;
    }
    rejectUnknownFields(item, serviceFields, errors, `components.services[${index}]`);
    if (!isSafeIdentifier(item.id)) errors.push(`components.services[${index}].id must be a safe identifier`);
    if (!isNonEmptyString(item.command)) errors.push(`components.services[${index}].command is required`);
    if (!isComponentRuntime(item.runtime)) errors.push(`components.services[${index}].runtime is unsupported`);
    if (item.versionSource !== undefined) {
      if (!isRecord(item.versionSource)) {
        errors.push(`components.services[${index}].versionSource must be an object`);
      } else {
        rejectUnknownFields(
          item.versionSource,
          versionSourceFields,
          errors,
          `components.services[${index}].versionSource`,
        );
        if (item.versionSource.kind !== 'github-release-asset') {
          errors.push(`components.services[${index}].versionSource.kind must be github-release-asset`);
        }
      }
    }
  }
}

function validateMcpArray(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push('components.mcp must be an array');
    return;
  }
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      errors.push(`components.mcp[${index}] must be an object`);
      continue;
    }
    rejectUnknownFields(item, mcpFields, errors, `components.mcp[${index}]`);
    if (!isSafeIdentifier(item.id)) errors.push(`components.mcp[${index}].id must be a safe identifier`);
    if (!isNonEmptyString(item.serverName)) errors.push(`components.mcp[${index}].serverName is required`);
    if (item.transport !== 'stdio' && item.transport !== 'http') {
      errors.push(`components.mcp[${index}].transport must be stdio or http`);
    }
  }
}

function validateStorageArray(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push('components.storage must be an array');
    return;
  }
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      errors.push(`components.storage[${index}] must be an object`);
      continue;
    }
    rejectUnknownFields(item, storageFields, errors, `components.storage[${index}]`);
    if (!isSafeIdentifier(item.id)) errors.push(`components.storage[${index}].id must be a safe identifier`);
    if (item.scope !== 'plugin-data' && item.scope !== 'workspace') {
      errors.push(`components.storage[${index}].scope must be plugin-data or workspace`);
    }
    if (!isSafeRelativePath(item.path)) errors.push(`components.storage[${index}].path must be safe relative path`);
    if (item.access !== 'read' && item.access !== 'readWrite') {
      errors.push(`components.storage[${index}].access must be read or readWrite`);
    }
  }
}

function validateSecretArray(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push('components.secrets must be an array');
    return;
  }
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      errors.push(`components.secrets[${index}] must be an object`);
      continue;
    }
    rejectUnknownFields(item, secretFields, errors, `components.secrets[${index}]`);
    if (!isSafeIdentifier(item.id)) errors.push(`components.secrets[${index}].id must be a safe identifier`);
    if (item.provider !== 'varlock') errors.push(`components.secrets[${index}].provider must be varlock`);
    if (!isNonEmptyString(item.ref)) errors.push(`components.secrets[${index}].ref is required`);
  }
}

function validateHealthArray(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push('components.healthChecks must be an array');
    return;
  }
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      errors.push(`components.healthChecks[${index}] must be an object`);
      continue;
    }
    rejectUnknownFields(item, healthFields, errors, `components.healthChecks[${index}]`);
    if (!isSafeIdentifier(item.id)) errors.push(`components.healthChecks[${index}].id must be a safe identifier`);
    if (item.kind !== 'asset-exists' && item.kind !== 'http' && item.kind !== 'command') {
      errors.push(`components.healthChecks[${index}].kind is unsupported`);
    }
    if (!isNonEmptyString(item.target)) errors.push(`components.healthChecks[${index}].target is required`);
  }
}

function validateCapabilityPolicy(manifest: PluginManifest, errors: string[]): void {
  const kind = manifest.kind ?? 'marketplace';
  const requested = getRequestedCapabilities(manifest);

  if (requested.hostDocker === 'host-socket') {
    errors.push('Host Docker socket access is never a plugin capability; use microvm-dockerd containers');
  }

  const declaredSecrets = new Set(manifest.components.secrets?.map((secret) => secret.id) ?? []);
  for (const secret of requested.secrets) {
    if (!declaredSecrets.has(secret)) {
      errors.push(`Requested secret is not declared in components.secrets: ${secret}`);
    }
  }

  if (kind !== 'first-party-service') {
    if (requested.vkHttpApi !== 'none') {
      errors.push('Marketplace plugins cannot request VK HTTP API access in V1');
    }
    if (requested.hostShell !== 'none') {
      errors.push('Marketplace plugins cannot request host shell access');
    }
    if (requested.codeServer !== 'none') {
      errors.push('Marketplace plugins cannot request code-server access');
    }
    if (requested.env.length > 0) {
      errors.push('Marketplace plugins cannot request direct environment variable access; request named secrets instead');
    }
    if (requested.plugins.length > 0) {
      errors.push('Marketplace plugins cannot request direct access to other plugins in V1');
    }
    if (requested.filesystem.some((entry) => entry.scope === 'repo' || entry.scope === 'absolute')) {
      errors.push('Marketplace plugins cannot request repo-wide filesystem access');
    }
  }
}

export function isGhcrDigestPinnedImage(image: unknown): image is string {
  return typeof image === 'string' && /^ghcr\.io\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/i.test(image);
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: Set<string>,
  errors: string[],
  label: string,
): void {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      errors.push(label === 'manifest' ? `Unknown manifest field: ${field}` : `Unknown ${label} field: ${field}`);
    }
  }
}

function cloneArray<T>(value: readonly T[]): T[] {
  return [...value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/i.test(value);
}

function isSafeRelativePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.startsWith('/') &&
    !value.split('/').some((part) => part === '..' || part === '')
  );
}

function isPluginKind(value: unknown): value is PluginKind {
  return value === 'marketplace' || value === 'local' || value === 'first-party-service';
}

function isComponentRuntime(value: unknown): value is ComponentRuntime {
  return value === 'supervisor' || value === 'deno' || value === 'container';
}


function isVkHttpApiCapability(value: unknown): value is VkHttpApiCapability {
  return value === 'none' || value === 'read' || value === 'write' || value === 'agentPrompt';
}

function isCodeServerCapability(value: unknown): value is CodeServerCapability {
  return value === 'none' || value === 'workspace' || value === 'admin';
}

function isHostDockerCapability(value: unknown): value is HostDockerCapability {
  return value === 'none' || value === 'microvm-dockerd' || value === 'host-socket';
}

function isHostShellRequest(value: unknown): value is HostShellRequest {
  return isRecord(value) && isStringArray(value.commands);
}

function isNetworkRequest(value: unknown): value is NetworkRequest {
  return (
    isRecord(value) &&
    (value.mode === 'none' ||
      value.mode === 'egress' ||
      value.mode === 'ingress' ||
      value.mode === 'ingress-and-egress')
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
