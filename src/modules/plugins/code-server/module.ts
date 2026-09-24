import springboard from 'springboard';
import type { PluginManifest } from '../vibe-dashboard/types';
import { createPluginManifest, registerPlugin } from '../vibe-dashboard/registry';

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
    craftSurfaces: [
      {
        key: 'editor',
        title: 'Code Server',
        urlTemplate: '{{origin}}/?folder=/home/vkuser/repos',
        defaultTitle: 'Code Server',
        order: 20,
      },
    ],
  },
});

registerPlugin(manifest);

springboard.registerModule('plugin-code-server', {}, async () => {
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
