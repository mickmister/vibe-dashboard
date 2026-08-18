import springboard from 'springboard';
import type { PluginManifest } from '../vibe-dashboard/types';
import type { ResolvedWorkspaceComposition } from '../vibe-dashboard/workspace-composition';
import { createPluginManifest, registerPlugin } from '../vibe-dashboard/registry';

const manifest: PluginManifest = createPluginManifest({
  id: 'dev.mickmister.vibe-kanban',
  displayName: 'Vibe Kanban',
  version: '1.0.0',
  contributions: {},
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

// @platform "node"
import {serverRegistry} from 'springboard/server/register';

serverRegistry.registerServerModule(({hono}) => {
  hono.get('/vk-api/workspaces', async c => {
    const url = `${process.env.VIBE_API_URL}/api/workspaces`;
    return fetch(url);
  });
})
// @platform end
