import springboard from 'springboard';
import {
  createPluginManifest,
  type PluginManifest,
} from '../vibe-dashboard/types';

const manifest: PluginManifest = createPluginManifest({
  id: 'dev.mickmister.app-development',
  displayName: 'App Development',
  version: '1.0.0',
  contributions: {
    tabGroupFactories: [
      {
        key: 'new-workspace',
        title: 'New Workspace',
        description: 'Start a VK workspace with optional workflow orchestration',
        launchMode: 'new-workspace',
        order: 5,
      },
      {
        key: 'open-existing-workspace',
        title: 'Open Existing Workspace',
        description: 'Add workspace with Agent + Code split view',
        launchMode: 'vk-workspace',
        order: 10,
      },
    ],
  },
});

springboard.registerModule('plugin-app-development', {}, async (moduleAPI) => {
  const pluginRegistry = moduleAPI.getModule('plugin-registry');
  if (pluginRegistry) {
    await pluginRegistry.actions.registerPlugin(manifest);
  }

  return {
    manifest,
  };
});

declare module 'springboard/module_registry/module_registry' {
  interface AllModules {
    'plugin-app-development': {
      manifest: PluginManifest;
    };
  }
}
