import springboard from 'springboard';
import {
  createPluginManifest,
  type PluginManifest,
} from '../vibe-dashboard/types';
import { getBaseOrigin } from '../../../utils/origin';

const manifest: PluginManifest = createPluginManifest({
  id: 'dev.mickmister.vibe-kanban',
  displayName: 'Vibe Kanban',
  version: '1.0.0',
  contributions: {
    tabPresets: [
      {
        key: 'board',
        title: 'Kanban',
        description: 'Vibe Kanban board view',
        mode: 'immediate',
        urlTemplate: '{{origin}}/',
        order: 30,
      },
    ],
    spaceTypes: [
      {
        key: 'kanban',
        icon: 'KB',
      },
    ],
  },
});

springboard.registerModule('plugin-vibe-kanban', {}, async (moduleAPI) => {
  const pluginRegistry = moduleAPI.getModule('plugin-registry');
  if (pluginRegistry) {
    await pluginRegistry.actions.registerPlugin(manifest);
  }

  const actions = moduleAPI.createActions({
    addVKWorkspace: async (args: {
      workspaceId: string;
      name: string;
      containerRef: string;
      activeSpaceId: string;
    }) => {
      const workspace = moduleAPI.getModule('workspace');
      if (!workspace) {
        return undefined;
      }

      const baseOrigin = getBaseOrigin();
      return workspace.actions.addVKWorkspace({
        ...args,
        baseOrigin,
      });
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
        }) => Promise<{ tabGroupId: string; pairId: string; agentTabId: string } | undefined>;
      };
    };
  }
}
