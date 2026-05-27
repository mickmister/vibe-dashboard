import springboard from 'springboard';
import type {
  PluginManifest,
  PluginRegistryModule,
  PluginRegistryState,
  RegisteredPluginManifest,
  RegisteredSpaceTypeContribution,
  RegisteredTabGroupFactoryContribution,
  RegisteredTabPresetContribution,
} from './types';
import {
  PLUGIN_API_VERSION,
  createEmptyPluginRegistryState,
  getNamespacedContributionKey,
} from './types';

function registerManifest(
  draft: PluginRegistryState,
  manifest: PluginManifest,
  registeredAt: string,
) {
  const plugin: RegisteredPluginManifest = {
    ...manifest,
    registeredAt,
  };

  draft.plugins[manifest.id] = plugin;

  for (const preset of manifest.contributions.tabPresets || []) {
    const key = getNamespacedContributionKey(manifest.id, preset.key);
    const registeredPreset: RegisteredTabPresetContribution = {
      ...preset,
      key,
      pluginId: manifest.id,
      sourceKey: preset.key,
    };
    draft.tabPresets[key] = registeredPreset;
  }

  for (const spaceType of manifest.contributions.spaceTypes || []) {
    const key = getNamespacedContributionKey(manifest.id, spaceType.key);
    const registeredSpaceType: RegisteredSpaceTypeContribution = {
      ...spaceType,
      key,
      pluginId: manifest.id,
      sourceKey: spaceType.key,
    };
    draft.spaceTypes[key] = registeredSpaceType;
  }

  for (const factory of manifest.contributions.tabGroupFactories || []) {
    const key = getNamespacedContributionKey(manifest.id, factory.key);
    const registeredFactory: RegisteredTabGroupFactoryContribution = {
      ...factory,
      key,
      pluginId: manifest.id,
      sourceKey: factory.key,
    };
    draft.tabGroupFactories[key] = registeredFactory;
  }
}

springboard.registerModule('plugin-registry', { rpcMode: 'local' }, async (moduleAPI) => {
  const registry = await moduleAPI.statesAPI.createSharedState<PluginRegistryState>(
    'plugin-registry',
    createEmptyPluginRegistryState(),
  );

  const actions = moduleAPI.createActions({
    registerPlugin: (manifest: PluginManifest) => {
      if (manifest.apiVersion !== PLUGIN_API_VERSION) {
        throw new Error(
          `Plugin ${manifest.id} targets unsupported plugin API version ${manifest.apiVersion}. Expected ${PLUGIN_API_VERSION}.`,
        );
      }

      registry.setStateImmer((draft) => {
        registerManifest(draft, manifest, new Date().toISOString());
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
