/* eslint-disable formatjs/no-literal-string-in-object -- Plugin manifest metadata uses stable contribution titles; rendered UI owns translation. */
import springboard from 'springboard';
import type { PluginManifest } from '../vibe-dashboard/types';
import type { ResolvedWorkspaceComposition } from '../vibe-dashboard/workspace-composition';
import { createPluginManifest, registerPlugin } from '../vibe-dashboard/registry';

const manifest: PluginManifest = createPluginManifest({
  id: 'dev.mickmister.vibe-kanban',
  displayName: 'Vibe Kanban',
  version: '1.0.0',
  contributions: {
    craftSurfaces: [
      {
        key: 'agent',
        title: 'Agent',
        urlTemplate: '{{origin}}/workspaces/{{workspaceId}}',
        defaultTitle: 'Agent',
        order: 10,
      },
    ],
  },
});

registerPlugin(manifest);

springboard.registerModule('plugin-vibe-kanban', {}, async (moduleAPI) => {
  const actions = moduleAPI.createActions({
    addVKWorkspace: async (args: {
      workspaceId: string;
      name: string;
      containerRef: string;
      activeSpaceId: string;
      composition: ResolvedWorkspaceComposition;
    }) => {
      const workspace = moduleAPI.getModule('workspace');
      if (!workspace) {
        return undefined;
      }

      return workspace.actions.addVKWorkspace(args);
    },
  });

  return {
    manifest,
    actions,
  };
});

declare module 'springboard/module_registry/module_registry' {
  interface AllModules {
    'plugin-vibe-kanban': {
      manifest: PluginManifest;
      actions: {
        addVKWorkspace: (args: {
          workspaceId: string;
          name: string;
          containerRef: string;
          activeSpaceId: string;
          composition: ResolvedWorkspaceComposition;
        }) => Promise<{ tabGroupId: string; pairId?: string; agentTabId: string } | undefined>;
      };
    };
  }
}
