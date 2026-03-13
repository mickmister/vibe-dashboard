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

export interface SpaceTypeContribution {
  key: string;
  icon: string;
}

export type TabGroupFactoryLaunchMode = 'vk-workspace';

export interface TabGroupFactoryContribution {
  key: string;
  title: string;
  description: string;
  launchMode: TabGroupFactoryLaunchMode;
  order?: number;
}

export interface PluginContributions {
  tabPresets?: TabPresetContribution[];
  spaceTypes?: SpaceTypeContribution[];
  tabGroupFactories?: TabGroupFactoryContribution[];
}

export interface PluginRegistryState {
  tabPresets: Record<string, TabPresetContribution>;
  spaceTypes: Record<string, SpaceTypeContribution>;
  tabGroupFactories: Record<string, TabGroupFactoryContribution>;
}

export function createEmptyPluginRegistryState(): PluginRegistryState {
  return {
    tabPresets: {},
    spaceTypes: {},
    tabGroupFactories: {},
  };
}

export interface PluginRegistryModule {
  states: {
    registry: {
      useState: () => PluginRegistryState;
      getState: () => PluginRegistryState;
    };
  };
  actions: {
    registerContributions: (contributions: PluginContributions) => Promise<void>;
    registerTabPreset: (preset: TabPresetContribution) => Promise<void>;
    registerSpaceType: (spaceType: SpaceTypeContribution) => Promise<void>;
    registerTabGroupFactory: (factory: TabGroupFactoryContribution) => Promise<void>;
  };
}

declare module 'springboard/module_registry/module_registry' {
  interface AllModules {
    'plugin-registry': PluginRegistryModule;
  }
}
