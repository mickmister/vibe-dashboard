// @platform "browser"
import '@vitejs/plugin-react/preamble';
import './styles';

import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { HeroUIProvider } from '@heroui/react';
import { WorkspaceShell } from './components/WorkspaceShell';
import { useSessionWorkspaceNav } from './sessionState';
// @platform end

import springboard from 'springboard';
import { createDefaultWorkspace } from './types';
import type { WorkspaceState } from './types';

(globalThis as {useHashRouter?: boolean}).useHashRouter = true

console.log('outside of module')
springboard.registerModule('workspace', {rpcMode: 'remote'}, async (moduleAPI) => {
  console.log('inside of module')

  const workspaceState = await moduleAPI.statesAPI.createPersistentState<WorkspaceState>(
    'workspace',
    createDefaultWorkspace()
  );

  const actions = moduleAPI.createActions({
    addSpace: async (args: { name: string }) => {
      let spaceId: string | undefined;
      let tabGroupId: string | undefined;

      workspaceState.setStateImmer((draft) => {
        spaceId = `space_${draft.nextId++}`;
        tabGroupId = `tg_${draft.nextId++}`;

        draft.tabGroups.push({
          id: tabGroupId,
          label: 'Main',
          tabs: [],
          pairs: [],
          order: 0,
        });

        draft.spaces.push({
          id: spaceId,
          name: args.name,
          icon: 'default',
          tabGroupIds: [tabGroupId],
        });

      });

      if (!(spaceId && tabGroupId)) {
        return undefined;
      }
      
      return { spaceId, tabGroupId };
    },

    deleteSpace: async (args: { spaceId: string }) => {
      workspaceState.setStateImmer((draft) => {
        const idx = draft.spaces.findIndex((s) => s.id === args.spaceId);
        if (idx === -1 || draft.spaces.length <= 1) return { wasDeleted: false };

        const space = draft.spaces[idx];
        draft.tabGroups = draft.tabGroups.filter(
          (tg) => !space!.tabGroupIds.includes(tg.id)
        );
        draft.spaces.splice(idx, 1);

      });
      
      return { wasDeleted: true, deletedSpaceId: args.spaceId };
    },

    renameSpace: async (args: { spaceId: string; name: string }) => {
      workspaceState.setStateImmer((draft) => {
        const space = draft.spaces.find((s) => s.id === args.spaceId);
        if (space) space.name = args.name;
      });
    },

    addTabGroup: async (args: { spaceId: string; label: string }) => {
      let tabGroupId: string | undefined;

      workspaceState.setStateImmer((draft) => {
        const space = draft.spaces.find((s) => s.id === args.spaceId);
        if (!space) return;

        tabGroupId = `tg_${draft.nextId++}`;

        draft.tabGroups.push({
          id: tabGroupId,
          label: args.label,
          tabs: [],
          pairs: [],
          order: space.tabGroupIds.length,
        });

        space.tabGroupIds.push(tabGroupId);
      });

      return { tabGroupId, spaceId: args.spaceId };
    },

    deleteTabGroup: async (args: { spaceId: string; tabGroupId: string }) => {
      let wasDeleted = false;
      let nextTabGroupId: string | undefined;

      workspaceState.setStateImmer((draft) => {
        const space = draft.spaces.find((s) => s.id === args.spaceId);
        if (!space) return;

        // Prevent deletion if it's the last tab group in the space
        if (space.tabGroupIds.length <= 1) return;

        const tabGroupIndex = space.tabGroupIds.indexOf(args.tabGroupId);
        if (tabGroupIndex === -1) return;

        // Remove tab group ID from space
        space.tabGroupIds.splice(tabGroupIndex, 1);

        // Remove the tab group itself (this also removes all tabs and pairs)
        draft.tabGroups = draft.tabGroups.filter((tg) => tg.id !== args.tabGroupId);

        // Determine next tab group to select
        nextTabGroupId = space.tabGroupIds[Math.max(0, tabGroupIndex - 1)] || space.tabGroupIds[0];

        wasDeleted = true;
      });

      return { wasDeleted, deletedTabGroupId: args.tabGroupId, nextTabGroupId };
    },

    closeTab: async (args: { tabGroupId: string; tabId: string }) => {
      workspaceState.setStateImmer((draft) => {
        const tg = draft.tabGroups.find((g) => g.id === args.tabGroupId);
        if (!tg) return;

        const tab = tg.tabs.find((t) => t.id === args.tabId);
        if (tab?.pinned) return;

        tg.pairs = tg.pairs.filter((p) => !p.tabIds.includes(args.tabId));
        tg.tabs = tg.tabs.filter((t) => t.id !== args.tabId);
      });
    },

    addTab: async (args: { tabGroupId: string; title: string; url: string }) => {
      let tabId = '';

      workspaceState.setStateImmer((draft) => {
        const tg = draft.tabGroups.find((g) => g.id === args.tabGroupId);
        if (!tg) return;

        tabId = `tab_${draft.nextId++}`;
        tg.tabs.push({ id: tabId, title: args.title, url: args.url });
      });
      
      return { tabId, tabGroupId: args.tabGroupId };
    },

    createPair: async (args: { tabGroupId: string; tabIds: string[] }) => {
      let pairId = '';

      workspaceState.setStateImmer((draft) => {
        const tg = draft.tabGroups.find((g) => g.id === args.tabGroupId);
        if (!tg) return;

        pairId = `pair_${draft.nextId++}`;
        const ratios = args.tabIds.map(() => 100 / args.tabIds.length);
        tg.pairs.push({ id: pairId, tabIds: args.tabIds, ratios });
      });
      
      return { pairId, tabGroupId: args.tabGroupId };
    },

    updatePairRatios: async (args: { tabGroupId: string; pairId: string; ratios: number[] }) => {
      workspaceState.setStateImmer((draft) => {
        const tg = draft.tabGroups.find((g) => g.id === args.tabGroupId);
        if (!tg) return;
        const pair = tg.pairs.find((p) => p.id === args.pairId);
        if (pair) pair.ratios = args.ratios;
      });
    },

    deletePair: async (args: { tabGroupId: string; pairId: string }) => {
      let firstTabId: string | undefined;

      workspaceState.setStateImmer((draft) => {
        const tg = draft.tabGroups.find((g) => g.id === args.tabGroupId);
        if (!tg) return;

        const pair = tg.pairs.find((p) => p.id === args.pairId);
        if (pair) {
          firstTabId = pair.tabIds[0];
          tg.pairs = tg.pairs.filter((p) => p.id !== args.pairId);
        }
      });

      return { firstTabId, tabGroupId: args.tabGroupId };
    },

    addVKWorkspace: async (args: {
      taskAttemptId: string;
      name: string;
      containerRef: string;
      activeSpaceId: string;
    }) => {
      let tabGroupId: string | undefined;
      let pairId: string | undefined;
      let agentTabId: string | undefined;

      workspaceState.setStateImmer((draft) => {
        const space = draft.spaces.find((s) => s.id === args.activeSpaceId);
        if (!space) return;

        // Generate IDs for tab group and tabs
        tabGroupId = `tg_${draft.nextId++}`;
        pairId = `pair_${draft.nextId++}`;
        const kanbanTabId = `tab_${draft.nextId++}`;
        const codeTabId = `tab_${draft.nextId++}`;

        // Store agent tab ID for return
        agentTabId = kanbanTabId;

        // Create the new tab group
        draft.tabGroups.push({
          id: tabGroupId,
          label: args.name.length > 30 ? args.name.substring(0, 27) + '...' : args.name,
          tabs: [
            {
              id: kanbanTabId,
              title: 'Agent',
              url: `/workspaces/${args.taskAttemptId}`,
            },
            {
              id: codeTabId,
              title: 'Code',
              url: `/?folder=${args.containerRef}`,
            },
          ],
          pairs: [
            {
              id: pairId,
              tabIds: [kanbanTabId, codeTabId],
              ratios: [50, 50],
            },
          ],
          order: space.tabGroupIds.length,
        });

        // Add tab group to the space
        space.tabGroupIds.push(tabGroupId);
      });

      if (!(tabGroupId && pairId && agentTabId)) {
        return undefined;
      }

      return { tabGroupId, pairId, agentTabId };
    },

    updateTabUrl: async (args: { tabGroupId: string; tabId: string; newUrl: string }) => {
      workspaceState.setStateImmer((draft) => {
        const tg = draft.tabGroups.find((g) => g.id === args.tabGroupId);
        if (!tg) return;
        const tab = tg.tabs.find((t) => t.id === args.tabId);
        if (tab) tab.url = args.newUrl;
      });
    },

    reorderTabGroups: async (args: { sourceId: string; targetId: string; activeSpaceId: string }) => {
      workspaceState.setStateImmer((draft) => {
        const space = draft.spaces.find((s) => s.id === args.activeSpaceId);
        if (!space) return;

        const ids = space.tabGroupIds;
        const srcIdx = ids.indexOf(args.sourceId);
        const tgtIdx = ids.indexOf(args.targetId);
        if (srcIdx === -1 || tgtIdx === -1) return;

        ids.splice(srcIdx, 1);
        ids.splice(tgtIdx, 0, args.sourceId);
      });
    },

    closeActiveTab: async (args: { activeTabGroupId: string; activeItemId: string }) => {
      const state = workspaceState.getState();
      const tg = state.tabGroups.find((g) => g.id === args.activeTabGroupId);
      if (!tg) return;

      // Check if it's a pair - if so, return first tab ID to select
      const activePair = tg.pairs.find((p) => p.id === args.activeItemId);
      if (activePair) {
        return { selectTabId: tg.tabs[0]?.id };
      }

      // Otherwise close active tab (if not pinned)
      const activeTab = tg.tabs.find((t) => t.id === args.activeItemId);
      if (activeTab && !activeTab.pinned) {
        const tabIdx = tg.tabs.findIndex((t) => t.id === activeTab.id);
        const nextTabId = tg.tabs[Math.max(0, tabIdx - 1)]?.id;

        workspaceState.setStateImmer((draft) => {
          const dtg = draft.tabGroups.find((g) => g.id === args.activeTabGroupId);
          if (!dtg) return;

          dtg.pairs = dtg.pairs.filter((p) => !p.tabIds.includes(activeTab.id));
          dtg.tabs = dtg.tabs.filter((t) => t.id !== activeTab.id);
        });

        return { selectTabId: nextTabId };
      }
    },
  });

  // Shared route component with space parameter support
  const WorkspaceRoute = () => {
    const workspace = workspaceState.useState();
    const { spaceId } = useParams<{ spaceId?: string }>();
    const navigate = useNavigate();
    const sessionNav = useSessionWorkspaceNav(workspace, spaceId);

    // Navigate to URL when space changes (unless already there)
    useEffect(() => {
      const targetPath = sessionNav.activeSpaceId ? `/${sessionNav.activeSpaceId}` : '/';
      const currentPath = spaceId ? `/${spaceId}` : '/';

      if (targetPath !== currentPath) {
        navigate(targetPath, { replace: true });
      }
    }, [sessionNav.activeSpaceId, spaceId, navigate]);

    // Wrap actions that need session parameters
    const wrappedActions = {
      ...actions,
      reorderTabGroups: (args: { sourceId: string; targetId: string }) => {
        actions.reorderTabGroups({ ...args, activeSpaceId: sessionNav.activeSpaceId });
      },
      closeActiveTab: async () => {
        const activeItemId = sessionNav.getActiveItem(sessionNav.activeTabGroupId);
        const result = await actions.closeActiveTab({
          activeTabGroupId: sessionNav.activeTabGroupId,
          activeItemId,
        });
        // If action returned a tab to select, select it
        if (result?.selectTabId) {
          sessionNav.selectTab(sessionNav.activeTabGroupId, result.selectTabId);
        }
      },
      addTab: async (args: { tabGroupId: string; title: string; url: string }) => {
        const result = await actions.addTab(args);
        // Auto-select the newly added tab
        if (result?.tabId) {
          sessionNav.selectTab(result.tabGroupId, result.tabId);
        }
      },
      createPair: async (args: { tabGroupId: string; tabIds: string[] }) => {
        const result = await actions.createPair(args);
        // Auto-select the newly created pair
        if (result?.pairId) {
          sessionNav.selectPair(result.tabGroupId, result.pairId);
        }
      },
      deletePair: async (args: { tabGroupId: string; pairId: string }) => {
        const result = await actions.deletePair(args);
        // Auto-select the first tab from the deleted pair
        if (result?.firstTabId) {
          sessionNav.selectTab(result.tabGroupId, result.firstTabId);
        }
      },
      addVKWorkspace: (args: {
        taskAttemptId: string;
        name: string;
        containerRef: string;
        activeSpaceId: string;
      }) => {
        return actions.addVKWorkspace(args);
      },
    };

    const sessionActions = {
      selectSpace: sessionNav.selectSpace,
      selectTab: sessionNav.selectTab,
      selectPair: sessionNav.selectPair,
      setActiveTabGroup: sessionNav.setActiveTabGroup,
      getActiveItem: sessionNav.getActiveItem,
    };

    return (
      <>
        <div className="dark w-screen h-screen fixed inset-0">
          <WorkspaceShell
            workspace={workspace}
            session={sessionNav}
            actions={normalizeActionReturns(wrappedActions)}
            sessionActions={sessionActions}
          />
        </div>
      </>
    );
  };

  // Register routes for both root and space-specific paths
  moduleAPI.registerRoute('/', { hideApplicationShell: true }, WorkspaceRoute);
  moduleAPI.registerRoute('/:spaceId', { hideApplicationShell: true }, WorkspaceRoute);

  return {
    states: { workspace: workspaceState },
    Provider: (props: React.PropsWithChildren) => {
      return (
        <HeroUIProvider>
          {props.children}
        </HeroUIProvider>
      );
    },
  };
});

type FlattenNestedPromise<T> = T extends Promise<unknown> ? Promise<Awaited<T>> : T;

type NormalizeActionReturns<T extends Record<string, (...args: any[]) => any>> = {
  [K in keyof T]: (...args: Parameters<T[K]>) => FlattenNestedPromise<ReturnType<T[K]>>;
};

function normalizeActionReturns<T extends Record<string, (...args: any[]) => any>>(actions: T) {
  return actions as NormalizeActionReturns<T>;
}
