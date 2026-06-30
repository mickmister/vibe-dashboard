export interface PluginFrontendAssetRoute {
  pluginId: string;
  version: string;
  assetPath: string;
}

export interface PluginInternalRoute {
  pluginId: string;
  routePath: string;
}

export interface PluginIframePolicy {
  sandbox: string;
  allow: string;
  /** Exact iframe origin policy marker; `null` means opaque origin. */
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

export function buildPluginInternalUrl(route: PluginInternalRoute): string {
  const routePath = normalizePluginInternalRoutePath(route.routePath);
  return `internal://plugins/${encodeURIComponent(route.pluginId)}${routePath}`;
}

export function parsePluginInternalUrl(url: string): PluginInternalRoute | null {
  if (!url.startsWith('internal://plugins/')) return null;
  const rest = url.slice('internal://plugins/'.length);
  const slashIndex = rest.indexOf('/');
  const encodedPluginId = slashIndex === -1 ? rest : rest.slice(0, slashIndex);
  if (!encodedPluginId) return null;

  let pluginId: string;
  try {
    pluginId = decodeURIComponent(encodedPluginId);
  } catch {
    return null;
  }

  const routePath = slashIndex === -1 ? '/' : `/${rest.slice(slashIndex + 1)}`;
  if (!isSafePluginInternalRoutePath(routePath)) return null;

  return { pluginId, routePath };
}

function normalizePluginInternalRoutePath(routePath: string): string {
  const normalized = routePath.startsWith('/') ? routePath : `/${routePath}`;
  if (!isSafePluginInternalRoutePath(normalized)) {
    throw new Error(`Unsafe plugin internal route path: ${routePath}`);
  }
  return normalized;
}

function isSafePluginInternalRoutePath(routePath: string): boolean {
  return (
    routePath.startsWith('/') &&
    !routePath.includes('\\') &&
    !routePath.split('/').some((part) => part === '..')
  );
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

export function getPluginIframePostMessageTargetOrigin(policy: PluginIframePolicy): string {
  return policy.targetOrigin === 'null' ? '*' : policy.targetOrigin;
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
