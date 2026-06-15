import { useSyncExternalStore } from 'react';
import {
  PLUGIN_API_VERSION,
  createEmptyPluginRegistryState,
  getNamespacedContributionKey,
  type PluginManifest,
  type PluginRegistryState,
  type RegisteredCraftSurfaceContribution,
  type RegisteredPluginInternalRouteContribution,
  type RegisteredPluginManifest,
  type RegisteredSpaceTypeContribution,
  type RegisteredTabGroupFactoryContribution,
  type RegisteredTabPresetContribution,
} from './types';
import { parsePluginFrontendAssetRoute, parsePluginInternalUrl } from './runtime';

let registryState = createEmptyPluginRegistryState();
const listeners = new Set<() => void>();

export function createPluginManifest(
  manifest: Omit<PluginManifest, 'apiVersion'> & { apiVersion?: string },
): PluginManifest {
  return {
    ...manifest,
    apiVersion: manifest.apiVersion ?? PLUGIN_API_VERSION,
  };
}

export function getPluginRegistrySnapshot(): PluginRegistryState {
  return registryState;
}

export function subscribeToPluginRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePluginRegistry(): PluginRegistryState {
  return useSyncExternalStore(
    subscribeToPluginRegistry,
    getPluginRegistrySnapshot,
    getPluginRegistrySnapshot,
  );
}

export function getRegisteredPluginIframePolicy(input: {
  iframeSrc: string;
  origin: string;
}): { allowSameOrigin: boolean } | null {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input.iframeSrc, input.origin);
  } catch {
    return null;
  }

  const route = parsePluginFrontendAssetRoute(parsedUrl.pathname);
  if (!route) return null;

  const plugin = registryState.plugins[route.pluginId];
  if (!plugin || plugin.version !== route.version) return null;
  return { allowSameOrigin: Boolean(plugin.frontend?.allowSameOrigin) };
}

export function resolvePluginInternalRouteIframeSrc(input: {
  internalUrl: string;
  origin: string;
}): string | null {
  const parsed = parsePluginInternalUrl(input.internalUrl);
  if (!parsed) return null;

  const route = Object.values(registryState.internalRoutes).find(
    (candidate) => candidate.pluginId === parsed.pluginId && candidate.path === parsed.routePath,
  );
  if (!route) return null;

  return route.urlTemplate
    .replaceAll('{{origin}}', input.origin)
    .replaceAll('{{pluginId}}', parsed.pluginId)
    .replaceAll('{{routePath}}', parsed.routePath);
}

export function registerPlugin(manifest: PluginManifest): void {
  if (manifest.apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(
      `Plugin ${manifest.id} targets unsupported plugin API version ${manifest.apiVersion}. Expected ${PLUGIN_API_VERSION}.`,
    );
  }

  registryState = registerManifest(registryState, manifest, new Date().toISOString());
  notifyListeners();
}

export function clearPluginRegistryForTests(): void {
  registryState = createEmptyPluginRegistryState();
  notifyListeners();
}

function registerManifest(
  currentState: PluginRegistryState,
  manifest: PluginManifest,
  registeredAt: string,
): PluginRegistryState {
  const nextState: PluginRegistryState = {
    plugins: { ...currentState.plugins },
    tabPresets: removePluginContributions(currentState.tabPresets, manifest.id),
    spaceTypes: removePluginContributions(currentState.spaceTypes, manifest.id),
    tabGroupFactories: removePluginContributions(currentState.tabGroupFactories, manifest.id),
    craftSurfaces: removePluginContributions(currentState.craftSurfaces, manifest.id),
    internalRoutes: removePluginContributions(currentState.internalRoutes, manifest.id),
  };

  const plugin: RegisteredPluginManifest = {
    ...manifest,
    registeredAt,
  };
  nextState.plugins[manifest.id] = plugin;

  for (const preset of manifest.contributions.tabPresets || []) {
    const key = getNamespacedContributionKey(manifest.id, preset.key);
    const registeredPreset: RegisteredTabPresetContribution = {
      ...preset,
      key,
      pluginId: manifest.id,
      sourceKey: preset.key,
    };
    nextState.tabPresets[key] = registeredPreset;
  }

  for (const spaceType of manifest.contributions.spaceTypes || []) {
    const key = getNamespacedContributionKey(manifest.id, spaceType.key);
    const registeredSpaceType: RegisteredSpaceTypeContribution = {
      ...spaceType,
      key,
      pluginId: manifest.id,
      sourceKey: spaceType.key,
    };
    nextState.spaceTypes[key] = registeredSpaceType;
  }

  for (const factory of manifest.contributions.tabGroupFactories || []) {
    const key = getNamespacedContributionKey(manifest.id, factory.key);
    const registeredFactory: RegisteredTabGroupFactoryContribution = {
      ...factory,
      key,
      pluginId: manifest.id,
      sourceKey: factory.key,
    };
    nextState.tabGroupFactories[key] = registeredFactory;
  }

  for (const surface of manifest.contributions.craftSurfaces || []) {
    const key = getNamespacedContributionKey(manifest.id, surface.key);
    const registeredSurface: RegisteredCraftSurfaceContribution = {
      ...surface,
      key,
      pluginId: manifest.id,
      sourceKey: surface.key,
    };
    nextState.craftSurfaces[key] = registeredSurface;
  }

  for (const route of manifest.contributions.internalRoutes || []) {
    const key = getNamespacedContributionKey(manifest.id, route.key);
    const registeredRoute: RegisteredPluginInternalRouteContribution = {
      ...route,
      key,
      pluginId: manifest.id,
      sourceKey: route.key,
    };
    nextState.internalRoutes[key] = registeredRoute;
  }

  return nextState;
}

function removePluginContributions<T extends { pluginId: string }>(
  contributions: Record<string, T>,
  pluginId: string,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(contributions).filter(([, contribution]) => contribution.pluginId !== pluginId),
  );
}

function notifyListeners(): void {
  for (const listener of listeners) listener();
}
