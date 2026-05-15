import React, { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { HeroUIProvider } from '@heroui/react';
import springboard from 'springboard';
import type { ModuleAPI } from 'springboard/core/engine/module_api';
import type { StateSupervisor } from 'springboard/core/services/states/shared_state_service';

import { WorkspaceShell } from '../components/WorkspaceShell';
import type { WorkspaceActions } from '../components/WorkspaceShell';
import { useSessionWorkspaceNav } from '../sessionState';
import { createDefaultWorkspace } from '../types';
import type { WorkspaceState } from '../types';

const WORKSPACE_CREATE_PATH = '/workspaces/create';
const WORKSPACE_CREATE_TAB_TITLE = 'Create Workspace';
const URL_PARSE_BASE = 'https://workspace.local';

/**
 * Get the base URL without port prefix for creating tab URLs.
 * If running on port-{num}.domain.com, returns just the origin without the prefix.
 */
function getBaseOrigin(): string {
  const { protocol, host } = window.location;

  const portPrefixMatch = host.match(/^port-\d+\.(.+)$/);

  if (portPrefixMatch) {
    return `${protocol}//${portPrefixMatch[1]}`;
  }

  return '';
}

function buildWorkspaceTabUrl(baseOrigin: string, path: string): string {
  return baseOrigin ? `${baseOrigin}${path}` : path;
}

function isWorkspaceTabPath(url: string, expectedPath: string): boolean {
  try {
    const parsed = new URL(url, URL_PARSE_BASE);
    return (
      parsed.pathname === expectedPath &&
      parsed.search === '' &&
      parsed.hash === ''
    );
  } catch {
    return url === expectedPath;
  }
}

type FlattenNestedPromise<T> =
  T extends Promise<unknown> ? Promise<Awaited<T>> : T;

type NormalizeActionReturns<T extends Record<string, (...args: any[]) => any>> = {
  [K in keyof T]: (
    ...args: Parameters<T[K]>
  ) => FlattenNestedPromise<ReturnType<T[K]>>;
};

function normalizeActionReturns<
  T extends Record<string, (...args: any[]) => any>,
>(actions: T) {
  return actions as NormalizeActionReturns<T>;
}

export type WorkspaceModuleState = {
  workspace: StateSupervisor<WorkspaceState>;
};

export type WorkspaceModulePublicApi = {
  states: WorkspaceModuleState;
  actions: Record<string, (...args: any[]) => Promise<any>>;
  Provider: React.ComponentType<React.PropsWithChildren>;
};

const WorkspaceModule = springboard.defineModule(
  'workspace',
  { rpcMode: 'remote' },
  async (moduleAPI: ModuleAPI) => {
    const workspaceState =
      await moduleAPI.statesAPI.createPersistentState<WorkspaceState>(
        'workspace',
        createDefaultWorkspace(),
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
            createdAt: new Date().toISOString(),
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
        let wasDeleted = false;
        workspaceState.setStateImmer((draft) => {
          const idx = draft.spaces.findIndex((s) => s.id === args.spaceId);
          if (idx === -1 || draft.spaces.length <= 1) return;

          const space = draft.spaces[idx]!;
          if (space.isSystem) return;

          draft.tabGroups = draft.tabGroups.filter(
            (tg) => !space.tabGroupIds.includes(tg.id),
          );
          draft.spaces.splice(idx, 1);
          wasDeleted = true;
        });

        return { wasDeleted, deletedSpaceId: args.spaceId };
      },

      renameSpace: async (args: { spaceId: string; name: string }) => {
        workspaceState.setStateImmer((draft) => {
          const space = draft.spaces.find((s) => s.id === args.spaceId);
          if (space && !space.isSystem) {
            space.name = args.name;
          }
        });
      },

      renameTabGroup: async (args: { tabGroupId: string; label: string }) => {
        workspaceState.setStateImmer((draft) => {
          const tabGroup = draft.tabGroups.find(
            (tg) => tg.id === args.tabGroupId,
          );
          if (tabGroup) {
            tabGroup.label = args.label;
          }
        });
      },

      renameTab: async (args: {
        tabGroupId: string;
        tabId: string;
        title: string;
      }) => {
        workspaceState.setStateImmer((draft) => {
          const tabGroup = draft.tabGroups.find(
            (tg) => tg.id === args.tabGroupId,
          );
          if (!tabGroup) return;
          const tab = tabGroup.tabs.find((t) => t.id === args.tabId);
          if (tab) {
            tab.title = args.title;
          }
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
            createdAt: new Date().toISOString(),
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

          if (space.tabGroupIds.length <= 1) return;

          const tabGroupIndex = space.tabGroupIds.indexOf(args.tabGroupId);
          if (tabGroupIndex === -1) return;

          space.tabGroupIds.splice(tabGroupIndex, 1);
          draft.tabGroups = draft.tabGroups.filter(
            (tg) => tg.id !== args.tabGroupId,
          );

          nextTabGroupId =
            space.tabGroupIds[Math.max(0, tabGroupIndex - 1)] ||
            space.tabGroupIds[0];

          wasDeleted = true;
        });

        return {
          wasDeleted,
          deletedTabGroupId: args.tabGroupId,
          nextTabGroupId,
        };
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

      addTab: async (args: {
        tabGroupId: string;
        title: string;
        url: string;
      }) => {
        let tabId = '';

        workspaceState.setStateImmer((draft) => {
          const tg = draft.tabGroups.find((g) => g.id === args.tabGroupId);
          if (!tg) return;

          tabId = `tab_${draft.nextId++}`;
          tg.tabs.push({ id: tabId, title: args.title, url: args.url });
        });

        return { tabId, tabGroupId: args.tabGroupId };
      },

      ensureCreateWorkspaceTab: async (args: { baseOrigin: string }) => {
        let result:
          | { spaceId: string; tabGroupId: string; tabId: string }
          | undefined;

        workspaceState.setStateImmer((draft) => {
          const firstSpace = draft.spaces[0];
          if (!firstSpace) return;

          let firstTabGroup =
            firstSpace.tabGroupIds.length > 0
              ? draft.tabGroups.find((g) => g.id === firstSpace.tabGroupIds[0])
              : undefined;

          if (!firstTabGroup) {
            const tabGroupId = `tg_${draft.nextId++}`;
            firstTabGroup = {
              id: tabGroupId,
              label: 'Main',
              tabs: [],
              pairs: [],
              order: 0,
              createdAt: new Date().toISOString(),
            };
            draft.tabGroups.push(firstTabGroup);

            if (firstSpace.tabGroupIds.length > 0) {
              firstSpace.tabGroupIds[0] = tabGroupId;
            } else {
              firstSpace.tabGroupIds.push(tabGroupId);
            }
          }

          const existingTab = firstTabGroup.tabs.find((tab) =>
            isWorkspaceTabPath(tab.url, WORKSPACE_CREATE_PATH),
          );
          if (existingTab) {
            result = {
              spaceId: firstSpace.id,
              tabGroupId: firstTabGroup.id,
              tabId: existingTab.id,
            };
            return;
          }

          const tabId = `tab_${draft.nextId++}`;
          firstTabGroup.tabs.push({
            id: tabId,
            title: WORKSPACE_CREATE_TAB_TITLE,
            url: buildWorkspaceTabUrl(args.baseOrigin, WORKSPACE_CREATE_PATH),
          });

          result = {
            spaceId: firstSpace.id,
            tabGroupId: firstTabGroup.id,
            tabId,
          };
        });

        return result;
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

      updatePairRatios: async (args: {
        tabGroupId: string;
        pairId: string;
        ratios: number[];
      }) => {
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
        baseOrigin: string;
      }) => {
        let tabGroupId: string | undefined;
        let pairId: string | undefined;
        let agentTabId: string | undefined;

        workspaceState.setStateImmer((draft) => {
          const space = draft.spaces.find((s) => s.id === args.activeSpaceId);
          if (!space) return;

          tabGroupId = `tg_${draft.nextId++}`;
          pairId = `pair_${draft.nextId++}`;
          const kanbanTabId = `tab_${draft.nextId++}`;
          const codeTabId = `tab_${draft.nextId++}`;

          agentTabId = kanbanTabId;

          draft.tabGroups.push({
            id: tabGroupId,
            label:
              args.name.length > 30
                ? args.name.substring(0, 27) + '...'
                : args.name,
            createdAt: new Date().toISOString(),
            tabs: [
              {
                id: kanbanTabId,
                title: 'Agent',
                url: `${args.baseOrigin}/workspaces/${args.taskAttemptId}`,
              },
              {
                id: codeTabId,
                title: 'Code',
                url: `${args.baseOrigin}/?folder=${args.containerRef}`,
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

          space.tabGroupIds.push(tabGroupId);
        });

        if (!(tabGroupId && pairId && agentTabId)) {
          return undefined;
        }

        return { tabGroupId, pairId, agentTabId };
      },

      updateTabUrl: async (args: {
        tabGroupId: string;
        tabId: string;
        newUrl: string;
      }) => {
        workspaceState.setStateImmer((draft) => {
          const tg = draft.tabGroups.find((g) => g.id === args.tabGroupId);
          if (!tg) return;
          const tab = tg.tabs.find((t) => t.id === args.tabId);
          if (tab) tab.url = args.newUrl;
        });
      },

      reorderTabGroups: async (args: {
        sourceId: string;
        targetId: string;
        activeSpaceId: string;
      }) => {
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

      touchTabGroup: async (args: { tabGroupId: string }) => {
        workspaceState.setStateImmer((draft) => {
          const tg = draft.tabGroups.find((g) => g.id === args.tabGroupId);
          if (tg) {
            tg.lastVisitedAt = new Date().toISOString();
          }
        });
      },

      toggleStarTabGroup: async (args: { tabGroupId: string }) => {
        workspaceState.setStateImmer((draft) => {
          const tg = draft.tabGroups.find((g) => g.id === args.tabGroupId);
          if (tg) {
            tg.starred = !tg.starred;
          }
        });
      },

      reorderSpaces: async (args: { sourceId: string; targetId: string }) => {
        workspaceState.setStateImmer((draft) => {
          const srcIdx = draft.spaces.findIndex((s) => s.id === args.sourceId);
          const tgtIdx = draft.spaces.findIndex((s) => s.id === args.targetId);
          if (srcIdx === -1 || tgtIdx === -1) return;
          const [moved] = draft.spaces.splice(srcIdx, 1);
          if (!moved) return;
          draft.spaces.splice(tgtIdx, 0, moved);
        });
      },

      closeActiveTab: async (args: {
        activeTabGroupId: string;
        activeItemId: string;
      }) => {
        const state = workspaceState.getState();
        const tg = state.tabGroups.find((g) => g.id === args.activeTabGroupId);
        if (!tg) return;

        const activePair = tg.pairs.find((p) => p.id === args.activeItemId);
        if (activePair) {
          return { selectTabId: tg.tabs[0]?.id };
        }

        const activeTab = tg.tabs.find((t) => t.id === args.activeItemId);
        if (activeTab && !activeTab.pinned) {
          const tabIdx = tg.tabs.findIndex((t) => t.id === activeTab.id);
          const nextTabId = tg.tabs[Math.max(0, tabIdx - 1)]?.id;

          workspaceState.setStateImmer((draft) => {
            const dtg = draft.tabGroups.find(
              (g) => g.id === args.activeTabGroupId,
            );
            if (!dtg) return;

            dtg.pairs = dtg.pairs.filter(
              (p) => !p.tabIds.includes(activeTab.id),
            );
            dtg.tabs = dtg.tabs.filter((t) => t.id !== activeTab.id);
          });

          return { selectTabId: nextTabId };
        }
      },
    });

    const RootRedirect = () => {
      const navigate = useNavigate();
      useEffect(() => {
        navigate('/dashboard', { replace: true });
      }, [navigate]);
      return null;
    };

    const WorkspaceRoute = () => {
      const workspace = workspaceState.useState();
      const { spaceId, tabGroupId, itemId } = useParams<{
        spaceId?: string;
        tabGroupId?: string;
        itemId?: string;
      }>();
      const navigate = useNavigate();
      const sessionNav = useSessionWorkspaceNav(workspace, {
        spaceId,
        tabGroupId,
        itemId,
      });

      useEffect(() => {
        const space = workspace.spaces.find(
          (s) => s.id === sessionNav.activeSpaceId,
        );
        const tabGroup = workspace.tabGroups.find(
          (tg) => tg.id === sessionNav.activeTabGroupId,
        );
        if (space && tabGroup) {
          document.title = `${space.name} - ${tabGroup.label}`;
        }
      }, [
        sessionNav.activeSpaceId,
        sessionNav.activeTabGroupId,
        workspace.spaces,
        workspace.tabGroups,
      ]);

      useEffect(() => {
        if (sessionNav.activeTabGroupId) {
          actions.touchTabGroup({ tabGroupId: sessionNav.activeTabGroupId });
        }
      }, [sessionNav.activeTabGroupId]);

      useEffect(() => {
        const segments = [
          '/dashboard',
          spaceId && `spaces/${spaceId}`,
          tabGroupId,
          itemId,
        ].filter(Boolean);
        const currentPath = segments.join('/');
        if (sessionNav.targetPath !== currentPath) {
          navigate(sessionNav.targetPath, { replace: true });
        }
      }, [sessionNav.targetPath, spaceId, tabGroupId, itemId, navigate]);

      const wrappedActions = {
        ...actions,
        reorderTabGroups: (args: { sourceId: string; targetId: string }) => {
          actions.reorderTabGroups({
            ...args,
            activeSpaceId: sessionNav.activeSpaceId,
          });
        },
        closeActiveTab: async () => {
          const activeItemId = sessionNav.getActiveItem(
            sessionNav.activeTabGroupId,
          );
          const result = await actions.closeActiveTab({
            activeTabGroupId: sessionNav.activeTabGroupId,
            activeItemId,
          });
          if (result?.selectTabId) {
            sessionNav.selectTab(
              sessionNav.activeTabGroupId,
              result.selectTabId,
            );
          }
        },
        addTab: async (args: {
          tabGroupId: string;
          title: string;
          url: string;
        }) => {
          const result = await actions.addTab(args);
          if (result?.tabId) {
            sessionNav.selectTab(result.tabGroupId, result.tabId);
          }
        },
        createPair: async (args: { tabGroupId: string; tabIds: string[] }) => {
          const result = await actions.createPair(args);
          if (result?.pairId) {
            sessionNav.selectPair(result.tabGroupId, result.pairId);
          }
        },
        deletePair: async (args: { tabGroupId: string; pairId: string }) => {
          const result = await actions.deletePair(args);
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
          const baseOrigin = getBaseOrigin();
          return actions.addVKWorkspace({ ...args, baseOrigin });
        },
        ensureCreateWorkspaceTab: () => {
          const baseOrigin = getBaseOrigin();
          return actions.ensureCreateWorkspaceTab({ baseOrigin });
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
        <div className="dark fixed inset-0 h-screen w-screen">
          <WorkspaceShell
            workspace={workspace}
            session={sessionNav}
            actions={normalizeActionReturns(wrappedActions) as WorkspaceActions}
            sessionActions={sessionActions}
          />
        </div>
      );
    };

    moduleAPI.registerRoute('/', { hideApplicationShell: true }, RootRedirect);
    moduleAPI.registerRoute(
      '/dashboard',
      { hideApplicationShell: true },
      WorkspaceRoute,
    );
    moduleAPI.registerRoute(
      '/dashboard/spaces/:spaceId',
      { hideApplicationShell: true },
      WorkspaceRoute,
    );
    moduleAPI.registerRoute(
      '/dashboard/spaces/:spaceId/:tabGroupId',
      { hideApplicationShell: true },
      WorkspaceRoute,
    );
    moduleAPI.registerRoute(
      '/dashboard/spaces/:spaceId/:tabGroupId/:itemId',
      { hideApplicationShell: true },
      WorkspaceRoute,
    );

    return {
      states: { workspace: workspaceState },
      actions,
      Provider: (props: React.PropsWithChildren) => {
        return <HeroUIProvider>{props.children}</HeroUIProvider>;
      },
    };
  },
);

export default WorkspaceModule;

declare module 'springboard/module_registry/module_registry' {
  interface AllModules {
    workspace: WorkspaceModulePublicApi;
  }
}
