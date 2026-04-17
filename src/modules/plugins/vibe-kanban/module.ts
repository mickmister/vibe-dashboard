import springboard from 'springboard';
import type { PluginContributions } from '../vibe-dashboard/types';
import { getBaseOrigin } from '../../../utils/origin';

const contributions: PluginContributions = {
  tabPresets: [
    {
      key: 'vibe-kanban',
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
};

springboard.registerModule('plugin-vibe-kanban', {}, async (moduleAPI) => {
  const pluginRegistry = moduleAPI.getModule('plugin-registry');
  if (pluginRegistry) {
    await pluginRegistry.actions.registerContributions(contributions);
  }

  const actions = moduleAPI.createActions({
    addVKWorkspace: async (args: {
      taskAttemptId: string;
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
    contributions,
    actions,
  };
});

declare module 'springboard/module_registry/module_registry' {
  interface AllModules {
    'plugin-vibe-kanban': {
      contributions: PluginContributions;
      actions: {
        addVKWorkspace: (args: {
          taskAttemptId: string;
          name: string;
          containerRef: string;
          activeSpaceId: string;
        }) => Promise<{ tabGroupId: string; pairId: string; agentTabId: string } | undefined>;
      };
    };
  }
}
