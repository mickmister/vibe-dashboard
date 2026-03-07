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
