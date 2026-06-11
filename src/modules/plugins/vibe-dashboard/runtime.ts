export const EXTERNAL_PLUGIN_RUNTIME_SCHEMA_VERSION = 1;

export type PluginRpcGrant = 'contribution.register' | 'fetch.serverSlice';
export type PluginBackendRuntimeKind = 'deno' | 'container';

export interface ExternalPluginFrontendRuntime {
  entry: string;
  sandbox: {
    allowScripts: true;
    allowSameOrigin: boolean;
    rpcGrants: PluginRpcGrant[];
  };
  /**
   * Explicitly unsupported for marketplace V1. Keeping the field in the type
   * makes host-code execution requests visible and rejectable during manifest
   * validation instead of being silently ignored.
   */
  hostScript?: {
    entry: string;
  };
}

export interface ExternalPluginDenoBackendUnit {
  id: string;
  kind: 'deno';
  entry: string;
  permissions: {
    allowRead?: string[];
    allowWrite?: string[];
    allowNet?: string[];
    allowEnv?: string[];
  };
}

export interface ExternalPluginContainerBackendUnit {
  id: string;
  kind: 'container';
  image: string;
  compose: string;
  network: 'none' | 'egress';
  ports: string[];
  volumes: string[];
  environment: string[];
}

export type ExternalPluginBackendUnit =
  | ExternalPluginDenoBackendUnit
  | ExternalPluginContainerBackendUnit;

export interface ExternalPluginRuntimeManifest {
  schemaVersion: typeof EXTERNAL_PLUGIN_RUNTIME_SCHEMA_VERSION;
  id: string;
  version: string;
  displayName: string;
  frontend?: ExternalPluginFrontendRuntime;
  backend?: {
    units: ExternalPluginBackendUnit[];
  };
}

export interface PluginFrontendAssetRoute {
  pluginId: string;
  version: string;
  assetPath: string;
}

export interface PluginIframePolicy {
  sandbox: string;
  allow: string;
  /** Exact targetOrigin for postMessage when known; `null` means opaque origin. */
  targetOrigin: string;
  isPluginFrontendAsset: boolean;
  requiresSeparateOriginForSameOriginStorage: boolean;
}

const pluginAssetRoutePattern =
  /^\/dashboard\/plugins\/([^/]+)\/([^/]+)\/frontend_assets\/(.+)$/;

export function buildPluginFrontendAssetRoute(route: PluginFrontendAssetRoute): string {
  assertSafeAssetPath(route.assetPath);
  return `/dashboard/plugins/${encodeURIComponent(route.pluginId)}/${encodeURIComponent(
    route.version,
  )}/frontend_assets/${route.assetPath}`;
}

export function parsePluginFrontendAssetRoute(pathname: string): PluginFrontendAssetRoute | null {
  const match = pathname.match(pluginAssetRoutePattern);
  if (!match) return null;

  const [, pluginId, version, assetPath] = match;
  if (!pluginId || !version || !assetPath) return null;

  try {
    assertSafeAssetPath(assetPath);
    return {
      pluginId: decodeURIComponent(pluginId),
      version: decodeURIComponent(version),
      assetPath,
    };
  } catch {
    return null;
  }
}

export function isPluginFrontendAssetUrl(iframeSrc: string, hostOrigin: string): boolean {
  const parsed = parseUrl(iframeSrc, hostOrigin);
  return Boolean(parsed && parsePluginFrontendAssetRoute(parsed.pathname));
}

export function getPluginIframePolicy(input: {
  iframeSrc: string;
  hostOrigin: string;
  allowSameOrigin?: boolean;
}): PluginIframePolicy {
  const parsed = parseUrl(input.iframeSrc, input.hostOrigin);
  const isPluginFrontendAsset = Boolean(parsed && parsePluginFrontendAssetRoute(parsed.pathname));
  if (!parsed || !isPluginFrontendAsset) {
    return {
      sandbox: 'allow-scripts allow-forms allow-popups allow-modals',
      allow: 'fullscreen',
      targetOrigin: '*',
      isPluginFrontendAsset: false,
      requiresSeparateOriginForSameOriginStorage: false,
    };
  }

  const sameOriginAsHost = parsed.origin === input.hostOrigin;
  const canGrantSameOrigin = Boolean(input.allowSameOrigin && !sameOriginAsHost);

  return {
    sandbox: canGrantSameOrigin ? 'allow-scripts allow-same-origin' : 'allow-scripts',
    allow: 'fullscreen',
    targetOrigin: canGrantSameOrigin ? parsed.origin : 'null',
    isPluginFrontendAsset: true,
    requiresSeparateOriginForSameOriginStorage: Boolean(input.allowSameOrigin && sameOriginAsHost),
  };
}

export function validateExternalPluginRuntimeManifest(
  manifest: ExternalPluginRuntimeManifest,
): string[] {
  const errors: string[] = [];
  if (manifest.schemaVersion !== EXTERNAL_PLUGIN_RUNTIME_SCHEMA_VERSION) {
    errors.push(`Unsupported plugin runtime schema version ${manifest.schemaVersion}`);
  }
  if (!manifest.id) errors.push('Plugin id is required');
  if (!manifest.version) errors.push('Plugin version is required');
  if (!manifest.frontend && !manifest.backend) {
    errors.push('Plugin must declare frontend, backend, or both');
  }
  if (manifest.frontend?.hostScript) {
    errors.push('Trusted host-script frontend plugins are not supported in V1');
  }
  if (manifest.frontend && !manifest.frontend.sandbox.allowScripts) {
    errors.push('Frontend plugins must run with allow-scripts sandbox capability');
  }
  for (const grant of manifest.frontend?.sandbox.rpcGrants ?? []) {
    if (!isKnownRpcGrant(grant)) errors.push(`Unknown frontend RPC grant: ${grant}`);
  }
  for (const unit of manifest.backend?.units ?? []) {
    if (!unit.id) errors.push('Backend unit id is required');
    if (unit.kind === 'container' && !isGhcrDigestPinnedImage(unit.image)) {
      errors.push(`Backend container ${unit.id} image must be a ghcr.io digest-pinned reference`);
    }
  }
  return errors;
}

export function isGhcrDigestPinnedImage(image: string): boolean {
  return /^ghcr\.io\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/i.test(image);
}

function assertSafeAssetPath(assetPath: string): void {
  if (
    assetPath.length === 0 ||
    assetPath.startsWith('/') ||
    assetPath.split('/').some((part) => part === '..' || part === '')
  ) {
    throw new Error(`Unsafe plugin frontend asset path: ${assetPath}`);
  }
}

function parseUrl(input: string, hostOrigin: string): URL | null {
  try {
    return new URL(input, hostOrigin);
  } catch {
    return null;
  }
}

function isKnownRpcGrant(grant: string): grant is PluginRpcGrant {
  return grant === 'contribution.register' || grant === 'fetch.serverSlice';
}
