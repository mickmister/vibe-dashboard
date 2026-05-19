import springboard from 'springboard';
import {
  createPluginManifest,
  type PluginManifest,
} from '../vibe-dashboard/types';

const manifest: PluginManifest = createPluginManifest({
  id: 'dev.mickmister.code-server',
  displayName: 'Code Server',
  version: '1.0.0',
  contributions: {
    tabPresets: [
      {
        key: 'editor',
        title: 'Code Server',
        description: 'VS Code editor with custom folder path',
        mode: 'urlPrompt',
        urlTemplate: '{{origin}}/?folder=',
        defaultTitle: 'Code Server',
        order: 20,
      },
    ],
    spaceTypes: [
      {
        key: 'code',
        icon: '</>',
      },
    ],
  },
});

springboard.registerModule('plugin-code-server', {}, async (moduleAPI) => {
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
    'plugin-code-server': {
      manifest: PluginManifest;
    };
  }
}
