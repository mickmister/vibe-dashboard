import springboard from 'springboard';
import type {
  PluginRegistryModule,
  PluginRegistryState,
  SpaceTypeContribution,
  TabGroupFactoryContribution,
  TabPresetContribution,
} from './types';
import { createEmptyPluginRegistryState } from './types';

springboard.registerModule('plugin-registry', {}, async (moduleAPI) => {
  const registry = await moduleAPI.statesAPI.createSharedState<PluginRegistryState>(
    'plugin-registry',
    createEmptyPluginRegistryState()
  );

  const actions = moduleAPI.createActions({
    registerContributions: async (contributions) => {
      for (const preset of contributions.tabPresets || []) {
        registry.setStateImmer((draft) => {
          draft.tabPresets[preset.key] = preset;
        });
      }

      for (const spaceType of contributions.spaceTypes || []) {
        registry.setStateImmer((draft) => {
          draft.spaceTypes[spaceType.key] = spaceType;
        });
      }

      for (const factory of contributions.tabGroupFactories || []) {
        registry.setStateImmer((draft) => {
          draft.tabGroupFactories[factory.key] = factory;
        });
      }
    },
    registerTabPreset: (preset: TabPresetContribution) => {
      registry.setStateImmer((draft) => {
        draft.tabPresets[preset.key] = preset;
      });
    },
    registerSpaceType: (spaceType: SpaceTypeContribution) => {
      registry.setStateImmer((draft) => {
        draft.spaceTypes[spaceType.key] = spaceType;
      });
    },
    registerTabGroupFactory: (factory: TabGroupFactoryContribution) => {
      registry.setStateImmer((draft) => {
        draft.tabGroupFactories[factory.key] = factory;
      });
    },
  });

  return {
    states: {
      registry,
    },
    actions,
  } satisfies PluginRegistryModule;
});
