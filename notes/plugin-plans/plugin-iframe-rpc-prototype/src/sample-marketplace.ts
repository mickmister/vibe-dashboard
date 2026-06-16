export interface PluginCatalog {
  schemaVersion: 1;
  plugins: PluginCatalogEntry[];
}

export interface PluginCatalogEntry {
  id: string;
  displayName: string;
  description: string;
  versions: PluginCatalogVersion[];
}

export interface PluginCatalogVersion {
  version: string;
  asset: PluginReleaseAsset;
  frontend?: FrontendPluginPart;
  backend?: BackendPluginPart;
  capabilities: PluginCapabilities;
}

export interface PluginReleaseAsset {
  url: string;
  sha256: string;
  signature: string;
}

export interface FrontendPluginPart {
  entry: string;
  sandbox: {
    allowScripts: boolean;
    allowSameOrigin: boolean;
    rpcGrants: string[];
  };
}

export interface BackendPluginPart {
  units: BackendPluginUnit[];
}

export type BackendPluginUnit = DenoBackendPluginUnit | ContainerBackendPluginUnit;

export interface DenoBackendPluginUnit {
  id: string;
  kind: 'deno';
  entry: string;
  permissions: DenoPermissionGrant;
}

export interface DenoPermissionGrant {
  allowRead?: string[];
  allowWrite?: string[];
  allowNet?: string[];
  allowEnv?: string[];
}

export interface ContainerBackendPluginUnit {
  id: string;
  kind: 'container';
  image: string;
  compose: string;
  network: 'none' | 'egress';
  ports: string[];
  volumes: string[];
  environment: string[];
}

export interface PluginCapabilities {
  frontend?: {
    sandbox: string[];
    rpcGrants: string[];
  };
  backend?: {
    deno?: string[];
    containers?: string[];
  };
}

export type ArtifactDownloader = (url: string) => Promise<Uint8Array>;

export type SignatureVerifier = (input: {
  pluginId: string;
  version: string;
  asset: PluginReleaseAsset;
  bytes: Uint8Array;
}) => Promise<boolean>;

export interface InstalledPluginArtifact {
  pluginId: string;
  version: string;
  enabled: false;
  assetUrl: string;
  sha256: string;
  signature: string;
  frontendAssetRoute?: string;
  backendUnits: BackendPluginUnit[];
  bytes: Uint8Array;
}

export function createSampleCatalog(): PluginCatalog {
  const frontend = {
    entry: 'frontend/index.html',
    sandbox: {
      allowScripts: true,
      allowSameOrigin: false,
      rpcGrants: ['contribution.register'],
    },
  } satisfies FrontendPluginPart;

  const backend = {
    units: [createSampleDenoUnit()],
  } satisfies BackendPluginPart;

  const mixedBackend = {
    units: [
      createSampleDenoUnit(),
      {
        id: 'worker',
        kind: 'container',
        image: 'ghcr.io/vibe-kanban/plugin-worker@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        compose: 'backend/worker.compose.yaml',
        network: 'none',
        ports: [],
        volumes: ['$PLUGIN_DATA_DIR:/data:rw'],
        environment: ['PLUGIN_DATA_DIR'],
      },
    ],
  } satisfies BackendPluginPart;

  return {
    schemaVersion: 1,
    plugins: [
      createEntry('dev.vibe-kanban.sample-frontend', 'Sample Frontend Plugin', { frontend }),
      createEntry('dev.vibe-kanban.sample-backend', 'Sample Backend Plugin', { backend }),
      createEntry('dev.vibe-kanban.fixture-plugin', 'Sample Mixed Plugin', { frontend, backend: mixedBackend }),
    ],
  };
}

function createSampleDenoUnit(): DenoBackendPluginUnit {
  return {
    id: 'indexer',
    kind: 'deno',
    entry: 'backend/indexer.ts',
    permissions: {
      allowRead: ['$PLUGIN_DATA_DIR'],
      allowWrite: ['$PLUGIN_DATA_DIR'],
      allowNet: ['api.github.com'],
    },
  };
}

function createEntry(
  id: string,
  displayName: string,
  parts: { frontend?: FrontendPluginPart; backend?: BackendPluginPart },
): PluginCatalogEntry {
  return {
    id,
    displayName,
    description: `${displayName} fixture entry`,
    versions: [
      {
        version: '1.0.0',
        asset: {
          url: `https://github.test/vibe-kanban/plugins/releases/download/${id}-1.0.0/${id}.tar.gz`,
          sha256: 'sample-sha256-fixture',
          signature: 'fake-signature',
        },
        ...parts,
        capabilities: capabilitiesFor(parts),
      },
    ],
  };
}

function capabilitiesFor(parts: { frontend?: FrontendPluginPart; backend?: BackendPluginPart }): PluginCapabilities {
  return {
    ...(parts.frontend
      ? {
          frontend: {
            sandbox: parts.frontend.sandbox.allowSameOrigin ? ['allow-scripts', 'allow-same-origin'] : ['allow-scripts'],
            rpcGrants: parts.frontend.sandbox.rpcGrants,
          },
        }
      : {}),
    ...(parts.backend
      ? {
          backend: {
            deno: parts.backend.units
              .filter((unit): unit is DenoBackendPluginUnit => unit.kind === 'deno')
              .flatMap((unit) => denoPermissionFlags(unit.permissions)),
            containers: parts.backend.units
              .filter((unit): unit is ContainerBackendPluginUnit => unit.kind === 'container')
              .map((unit) => unit.image),
          },
        }
      : {}),
  };
}

export function validatePluginCatalog(catalog: PluginCatalog): string[] {
  const errors: string[] = [];
  if (catalog.schemaVersion !== 1) errors.push('catalog schemaVersion must be 1');

  for (const plugin of catalog.plugins) {
    if (!plugin.id) errors.push('plugin id is required');
    for (const version of plugin.versions) {
      const label = `${plugin.id}@${version.version}`;
      if (!version.frontend && !version.backend) errors.push(`${label} must declare frontend, backend, or both`);
      if (version.frontend && !version.capabilities.frontend) errors.push(`${label} frontend capabilities are required`);
      if (version.backend && !version.capabilities.backend) errors.push(`${label} backend capabilities are required`);
      for (const unit of version.backend?.units ?? []) {
        if (unit.kind === 'container') {
          if (!isGhcrDigestPinnedImage(unit.image)) errors.push(`${label} container ${unit.id} image must be a ghcr.io digest-pinned reference`);
          if (!unit.compose.endsWith('.yaml') && !unit.compose.endsWith('.yml')) errors.push(`${label} container ${unit.id} compose metadata must be yaml`);
          if (unit.ports.length > 0 && unit.network === 'none') errors.push(`${label} container ${unit.id} cannot expose ports with network none`);
        }
      }
    }
  }

  return errors;
}

export class PluginMarketplaceInstaller {
  private readonly installed = new Map<string, InstalledPluginArtifact>();

  constructor(
    private readonly options: {
      catalog: PluginCatalog;
      downloader: ArtifactDownloader;
      verifier: SignatureVerifier;
    },
  ) {}

  async install(input: { pluginId: string; version?: string }): Promise<InstalledPluginArtifact> {
    const plugin = this.options.catalog.plugins.find((entry) => entry.id === input.pluginId);
    if (!plugin) throw new Error(`Unknown plugin: ${input.pluginId}`);

    const version = input.version
      ? plugin.versions.find((candidate) => candidate.version === input.version)
      : plugin.versions[0];
    if (!version) throw new Error(`Unknown version for ${input.pluginId}: ${input.version}`);

    const bytes = await this.options.downloader(version.asset.url);
    const verified = await this.options.verifier({ pluginId: plugin.id, version: version.version, asset: version.asset, bytes });
    if (!verified) throw new Error(`Signature verification failed for ${plugin.id}@${version.version}`);

    const artifact: InstalledPluginArtifact = {
      pluginId: plugin.id,
      version: version.version,
      enabled: false,
      assetUrl: version.asset.url,
      sha256: version.asset.sha256,
      signature: version.asset.signature,
      frontendAssetRoute: version.frontend
        ? `/dashboard/plugins/${plugin.id}/${version.version}/frontend_assets/${version.frontend.entry.replace(/^frontend\//, '')}`
        : undefined,
      backendUnits: version.backend?.units ?? [],
      bytes,
    };

    this.installed.set(plugin.id, artifact);
    return artifact;
  }

  getInstalled(pluginId: string): InstalledPluginArtifact | undefined {
    return this.installed.get(pluginId);
  }
}

export function denoPermissionFlags(permissions: DenoPermissionGrant): string[] {
  return [
    ...flagList('--allow-read', permissions.allowRead),
    ...flagList('--allow-write', permissions.allowWrite),
    ...flagList('--allow-net', permissions.allowNet),
    ...flagList('--allow-env', permissions.allowEnv),
  ];
}

function flagList(flag: string, values: string[] | undefined): string[] {
  if (!values || values.length === 0) return [];
  return [`${flag}=${values.join(',')}`];
}

export function isGhcrDigestPinnedImage(image: string): boolean {
  return /^ghcr\.io\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/i.test(image);
}

export function containerCapabilitySummary(unit: ContainerBackendPluginUnit) {
  return {
    image: unit.image,
    compose: unit.compose,
    network: unit.network,
    ports: unit.ports,
    volumes: unit.volumes,
    environment: unit.environment,
    requiresAdminApproval: true,
  };
}
