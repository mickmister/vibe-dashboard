export const PLUGIN_API_VERSION = '1.0.0' as const;
export const PLUGIN_MANIFEST_SCHEMA_VERSION = 1 as const;

export type PluginKind = 'marketplace' | 'local' | 'first-party-service';
export type TabPresetMode = 'immediate' | 'urlPrompt';
export type TabGroupFactoryLaunchMode = 'vk-workspace';
export type FilesystemAccess = 'read' | 'readWrite';
export type FilesystemScope = 'plugin-data' | 'workspace' | 'repo' | 'absolute';
export type NetworkMode = 'none' | 'egress' | 'ingress' | 'ingress-and-egress';
export type VkHttpApiCapability = 'none' | 'read' | 'write' | 'agentPrompt';
export type CodeServerCapability = 'none' | 'workspace' | 'admin';
export type HostDockerCapability = 'none' | 'microvm-dockerd' | 'host-socket';
export type ComponentRuntime = 'supervisor' | 'deno' | 'container';

export interface TabPresetContribution {
  key: string;
  title: string;
  description: string;
  mode: TabPresetMode;
  urlTemplate: string;
  defaultTitle?: string;
  order?: number;
}

export interface SpaceTypeContribution {
  key: string;
  icon: string;
}

export interface WorkspaceCompositionTabTemplate {
  key: string;
  title: string;
  titleTemplate?: string;
  urlTemplate: string;
}

export interface WorkspaceCompositionContribution {
  tabs: WorkspaceCompositionTabTemplate[];
  defaultPairTabKeys?: string[];
  primaryTabKey?: string;
}

export interface TabGroupFactoryContribution {
  key: string;
  title: string;
  description: string;
  launchMode: TabGroupFactoryLaunchMode;
  order?: number;
  workspaceComposition?: WorkspaceCompositionContribution;
}

export interface CraftSurfaceContribution {
  key: string;
  title: string;
  urlTemplate: string;
  defaultTitle?: string;
  order?: number;
}

export interface PluginInternalRouteContribution {
  key: string;
  title: string;
  path: string;
  urlTemplate: string;
  order?: number;
}

export interface PluginFrontendPolicy {
  allowSameOrigin?: boolean;
}

export interface PluginContributions {
  tabPresets?: TabPresetContribution[];
  spaceTypes?: SpaceTypeContribution[];
  tabGroupFactories?: TabGroupFactoryContribution[];
  craftSurfaces?: CraftSurfaceContribution[];
  internalRoutes?: PluginInternalRouteContribution[];
}

export interface PluginRegistryManifest {
  id: string;
  displayName: string;
  version: string;
  apiVersion: string;
  frontend?: PluginFrontendPolicy;
  contributions: PluginContributions;
}

export interface PluginFrontendComponent {
  kind: 'iframe';
  entry: string;
  routes?: Array<{ id: string; title: string; path: string }>;
  craftSurfaces?: Array<{ id: string; title: string; route: string }>;
  allowSameOrigin?: boolean;
}

export interface DenoComponent {
  id: string;
  entry: string;
  methods?: string[];
  permissions?: {
    read?: string[];
    write?: string[];
    net?: string[];
    env?: string[];
    run?: string[];
    imports?: string[];
  };
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
  versionSource?: {
    kind: 'github-release-asset';
    repository: string;
    tag: string;
    asset: string;
  };
}

export interface PluginPackageManifest {
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
  components: {
    frontend?: PluginFrontendComponent;
    denoBridges?: DenoComponent[];
    denoBackends?: DenoComponent[];
    containers?: ContainerComponent[];
    services?: ServiceComponent[];
    mcp?: Array<{ id: string; serverName: string; transport: 'stdio' | 'http'; command?: string; url?: string; tools?: string[] }>;
    storage?: Array<{ id: string; scope: 'plugin-data' | 'workspace'; path: string; access: FilesystemAccess }>;
    secrets?: Array<{ id: string; provider: 'varlock'; ref: string }>;
    healthChecks?: Array<{ id: string; kind: 'asset-exists' | 'http' | 'command'; target: string }>;
    lifecycle?: { start?: string; stop?: string; restart?: string };
  };
  requestedCapabilities?: Partial<PluginCapabilityRequests>;
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

export interface PluginCapabilityRequests {
  vkHttpApi: VkHttpApiCapability;
  hostShell: 'none' | { commands: string[] };
  codeServer: CodeServerCapability;
  hostDocker: HostDockerCapability;
  filesystem: FilesystemRequest[];
  network: NetworkRequest;
  env: string[];
  secrets: string[];
  plugins: Array<{ pluginId: string; methods: string[] }>;
}

export function createPluginRegistryManifest(
  manifest: Omit<PluginRegistryManifest, 'apiVersion'> & { apiVersion?: string },
): PluginRegistryManifest {
  return {
    ...manifest,
    apiVersion: manifest.apiVersion ?? PLUGIN_API_VERSION,
  };
}
