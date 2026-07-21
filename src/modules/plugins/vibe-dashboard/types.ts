export const PLUGIN_API_VERSION = '1.0.0';

export type TabPresetMode = 'immediate' | 'urlPrompt';

export interface TabPresetContribution {
  key: string;
  title: string;
  description: string;
  mode: TabPresetMode;
  urlTemplate: string;
  defaultTitle?: string;
  order?: number;
}

export interface RegisteredTabPresetContribution extends TabPresetContribution {
  pluginId: string;
  sourceKey: string;
}

export interface SpaceTypeContribution {
  key: string;
  icon: string;
}

export interface RegisteredSpaceTypeContribution extends SpaceTypeContribution {
  pluginId: string;
  sourceKey: string;
}

export type TabGroupFactoryLaunchMode = 'vk-workspace';

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

export interface RegisteredTabGroupFactoryContribution
  extends TabGroupFactoryContribution {
  pluginId: string;
  sourceKey: string;
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

export type SettingsMenuTarget = {
  kind: 'builtin';
  id: 'vardash';
};

export interface SettingsMenuContribution {
  key: string;
  title: string;
  description?: string;
  target: SettingsMenuTarget;
  order?: number;
}

export interface RegisteredCraftSurfaceContribution extends CraftSurfaceContribution {
  pluginId: string;
  sourceKey: string;
}

export interface RegisteredPluginInternalRouteContribution extends PluginInternalRouteContribution {
  pluginId: string;
  sourceKey: string;
}

export interface RegisteredSettingsMenuContribution extends SettingsMenuContribution {
  pluginId: string;
  sourceKey: string;
}

export interface PluginFrontendPolicy {
  allowSameOrigin?: boolean;
}

export interface PluginContributions {
  settingsMenus?: SettingsMenuContribution[];
  tabPresets?: TabPresetContribution[];
  spaceTypes?: SpaceTypeContribution[];
  tabGroupFactories?: TabGroupFactoryContribution[];
  craftSurfaces?: CraftSurfaceContribution[];
  internalRoutes?: PluginInternalRouteContribution[];
}

export interface PluginManifest {
  id: string;
  displayName: string;
  version: string;
  apiVersion: string;
  frontend?: PluginFrontendPolicy;
  contributions: PluginContributions;
}

export interface RegisteredPluginManifest extends PluginManifest {
  registeredAt: string;
}

export interface PluginRegistryState {
  plugins: Record<string, RegisteredPluginManifest>;
  settingsMenus: Record<string, RegisteredSettingsMenuContribution>;
  tabPresets: Record<string, RegisteredTabPresetContribution>;
  spaceTypes: Record<string, RegisteredSpaceTypeContribution>;
  tabGroupFactories: Record<string, RegisteredTabGroupFactoryContribution>;
  craftSurfaces: Record<string, RegisteredCraftSurfaceContribution>;
  internalRoutes: Record<string, RegisteredPluginInternalRouteContribution>;
}

export function createEmptyPluginRegistryState(): PluginRegistryState {
  return {
    plugins: {},
    settingsMenus: {},
    tabPresets: {},
    spaceTypes: {},
    tabGroupFactories: {},
    craftSurfaces: {},
    internalRoutes: {},
  };
}

export function getNamespacedContributionKey(pluginId: string, key: string): string {
  return `${pluginId}/${key}`;
}
