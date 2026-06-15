import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type { Hono } from 'hono';
import { parsePluginFrontendAssetRoute } from '../modules/plugins/vibe-dashboard/runtime';
import {
  discoverInstalledPlugins,
  type DiscoveredInstalledPlugin,
} from '../modules/plugins/vibe-dashboard/installer';

export interface RegisterPluginAssetRoutesOptions {
  installRoot: string;
  frameAncestors?: string[];
}

export interface ResolvedPluginFrontendAssetRequest {
  plugin: DiscoveredInstalledPlugin;
  filePath: string;
  contentType: string;
}

export function registerPluginAssetRoutes(
  hono: Hono,
  options: RegisterPluginAssetRoutesOptions,
): void {
  hono.get('/dashboard/plugins/:pluginId/:version/frontend_assets/*', async (c) => {
    const resolved = await resolvePluginFrontendAssetRequest({
      pathname: new URL(c.req.url).pathname,
      installRoot: options.installRoot,
    });

    if (!resolved) return c.text('Plugin frontend asset not found', 404);

    try {
      const bytes = await readFile(resolved.filePath);
      return new Response(bytes, {
        headers: createPluginAssetResponseHeaders(resolved, options),
      });
    } catch (error) {
      console.warn('Failed to read plugin frontend asset', {
        filePath: resolved.filePath,
        error,
      });
      return c.text('Plugin frontend asset not found', 404);
    }
  });
}

export function createPluginAssetResponseHeaders(
  resolved: Pick<ResolvedPluginFrontendAssetRequest, 'contentType'>,
  options: Pick<RegisterPluginAssetRoutesOptions, 'frameAncestors'> = {},
): Record<string, string> {
  return {
    'content-type': resolved.contentType,
    'cache-control': 'no-store',
    'content-security-policy': createPluginAssetContentSecurityPolicy(options.frameAncestors ?? ["'self'"]),
    'x-content-type-options': 'nosniff',
  };
}

function createPluginAssetContentSecurityPolicy(frameAncestors: string[]): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${frameAncestors.join(' ')}`,
  ].join('; ');
}

export async function resolvePluginFrontendAssetRequest(input: {
  pathname: string;
  installRoot: string;
}): Promise<ResolvedPluginFrontendAssetRequest | null> {
  const route = parsePluginFrontendAssetRoute(input.pathname);
  if (!route) return null;

  const discovery = await discoverInstalledPlugins({ installRoot: input.installRoot });
  for (const error of discovery.errors) {
    console.warn('Plugin discovery error while resolving frontend asset', error);
  }

  const plugin = discovery.plugins.find(
    (candidate) => candidate.id === route.pluginId && candidate.version === route.version,
  );
  if (!plugin?.frontendAssetRoot) return null;

  const filePath = join(plugin.frontendAssetRoot, route.assetPath);
  if (!isPathInsideRoot(plugin.frontendAssetRoot, filePath)) return null;

  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) return null;

  return {
    plugin,
    filePath,
    contentType: getContentType(route.assetPath),
  };
}

function isPathInsideRoot(root: string, filePath: string): boolean {
  const relativePath = relative(root, filePath);
  return Boolean(relativePath) && !relativePath.startsWith('..') && !isAbsolute(relativePath);
}

function getContentType(assetPath: string): string {
  if (assetPath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (assetPath.endsWith('.js') || assetPath.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (assetPath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (assetPath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (assetPath.endsWith('.svg')) return 'image/svg+xml';
  if (assetPath.endsWith('.png')) return 'image/png';
  if (assetPath.endsWith('.jpg') || assetPath.endsWith('.jpeg')) return 'image/jpeg';
  if (assetPath.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}
