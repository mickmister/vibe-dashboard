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

export interface TabGroupFactoryContribution {
  key: string;
  title: string;
  description: string;
  launchMode: TabGroupFactoryLaunchMode;
  order?: number;
}

export interface RegisteredTabGroupFactoryContribution
  extends TabGroupFactoryContribution {
  pluginId: string;
  sourceKey: string;
}

export interface PluginContributions {
  tabPresets?: TabPresetContribution[];
  spaceTypes?: SpaceTypeContribution[];
  tabGroupFactories?: TabGroupFactoryContribution[];
}

export interface PluginManifest {
  id: string;
  displayName: string;
  version: string;
  apiVersion: string;
  contributions: PluginContributions;
}

export interface RegisteredPluginManifest extends PluginManifest {
  registeredAt: string;
}

export interface PluginRegistryState {
  plugins: Record<string, RegisteredPluginManifest>;
  tabPresets: Record<string, RegisteredTabPresetContribution>;
  spaceTypes: Record<string, RegisteredSpaceTypeContribution>;
  tabGroupFactories: Record<string, RegisteredTabGroupFactoryContribution>;
}

export function createEmptyPluginRegistryState(): PluginRegistryState {
  return {
    plugins: {},
    tabPresets: {},
    spaceTypes: {},
    tabGroupFactories: {},
  };
}

export function createPluginManifest(
  manifest: Omit<PluginManifest, 'apiVersion'> & {
    apiVersion?: string;
  },
): PluginManifest {
  return {
    ...manifest,
    apiVersion: manifest.apiVersion ?? PLUGIN_API_VERSION,
  };
}

export function getNamespacedContributionKey(pluginId: string, key: string): string {
  return `${pluginId}/${key}`;
}

export interface PluginRegistryModule {
  states: {
    registry: {
      useState: () => PluginRegistryState;
      getState: () => PluginRegistryState;
    };
  };
  actions: {
    registerPlugin: (manifest: PluginManifest) => Promise<void>;
  };
}

declare module 'springboard/module_registry/module_registry' {
  interface AllModules {
    'plugin-registry': PluginRegistryModule;
  }
}
