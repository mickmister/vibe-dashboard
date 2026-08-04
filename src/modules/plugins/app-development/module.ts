import springboard from 'springboard';
import type { PluginManifest } from '../vibe-dashboard/types';
import { createPluginManifest, registerPlugin } from '../vibe-dashboard/registry';

const manifest: PluginManifest = createPluginManifest({
  id: 'dev.mickmister.app-development',
  displayName: 'App Development',
  version: '1.0.0',
  contributions: {
    tabGroupFactories: [
      {
        key: 'open-existing-workspace',
        title: 'Open Existing Workspace',
        description: 'Add workspace with Agent + Code + Diff split views',
        launchMode: 'vk-workspace',
        order: 10,
        workspaceComposition: {
          primaryTabKey: 'agent',
          defaultPairTabKeys: ['agent', 'code', 'diff'],
          tabs: [
            {
              key: 'agent',
              title: 'Agent',
              urlTemplate: '{{origin}}/workspaces/{{workspaceId}}',
            },
            {
              key: 'code',
              title: 'Code',
              urlTemplate: '{{origin}}/?folder={{containerRef}}',
            },
            {
              key: 'diff',
              title: 'Diff',
              urlTemplate:
                'internal://diff?workspaceId={{workspaceId}}&workspaceDir={{containerRef}}',
            },
          ],
        },
      },
    ],
  },
});

registerPlugin(manifest);

springboard.registerModule('plugin-app-development', {}, async () => {
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
