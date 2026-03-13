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

      const trimmedLabel = args.name.trim();
      const label = trimmedLabel.length > 30 ? `${trimmedLabel.slice(0, 27)}...` : trimmedLabel;

      const tabGroupResult = await workspace.actions.addTabGroup({
        spaceId: args.activeSpaceId,
        label: label || 'Workspace',
      });
      if (!tabGroupResult?.tabGroupId) {
        return undefined;
      }

      const tabGroupId = tabGroupResult.tabGroupId;
      const baseOrigin = getBaseOrigin();

      const agentTabResult = await workspace.actions.addTab({
        tabGroupId,
        title: 'Agent',
        url: `${baseOrigin}/workspaces/${args.taskAttemptId}`,
      });
      if (!agentTabResult?.tabId) {
        return undefined;
      }

      const codeTabResult = await workspace.actions.addTab({
        tabGroupId,
        title: 'Code',
        url: `${baseOrigin}/?folder=${args.containerRef}`,
      });
      if (!codeTabResult?.tabId) {
        return undefined;
      }

      const pairResult = await workspace.actions.createPair({
        tabGroupId,
        tabIds: [agentTabResult.tabId, codeTabResult.tabId],
      });
      if (!pairResult?.pairId) {
        return undefined;
      }

      return {
        tabGroupId,
        pairId: pairResult.pairId,
        agentTabId: agentTabResult.tabId,
      };
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
