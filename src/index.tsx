// @platform "browser"
import '@vitejs/plugin-react/preamble';
import './styles';

import React, { useEffect } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router';
import { HeroUIProvider } from '@heroui/react';
import { AppLoadingScreen } from './components/AppLoadingScreen';
import { WorkspaceShell } from './components/WorkspaceShell';
import {
  createNewBrowserSessionId,
  getOrCreateBrowserSessionId,
  getStoredBrowserSessionId,
  setBrowserSessionId,
  useSessionWorkspaceNav,
} from './sessionState';
import { resolveWorkspaceContainerRef } from './lib/vkWorkspaceOpen';
import {
  buildCraftParam,
  buildViewParam,
  buildVoyageSlug,
  getVoyageSlug,
  parseCraftParam,
  parseViewsParam,
} from './lib/voyageUrl';
import { resolvePreferredVoyageSessionId } from './lib/voyageSession';

// Ensure dark class is on the document root so portaled elements (modals, popovers)
// inherit dark mode styles
document.documentElement.classList.add('dark');
springboard.registerSplashScreen(AppLoadingScreen);

// @platform end

import springboard from 'springboard';
import { createDefaultWorkspace, getDefaultSpace } from './types';
import { buildWorkspaceFolderUrl } from './lib/vkWorkspaceUrl';
import type {
  WorkspaceState,
  SavedWorkspaceSession,
  SavedWorkspaceSessionState,
} from './types';

// @platform "node"
import './modules/WorkflowServerModule';
// @platform end

const WORKSPACE_CREATE_PATH = '/workspaces/create';
const WORKSPACE_CREATE_TAB_TITLE = 'Create Workspace';
const URL_PARSE_BASE = 'https://workspace.local';
const MOBILE_TAB_EMOJIS = [
  '🚀',
  '🧠',
  '💻',
  '🛠️',
  '📚',
  '🔬',
  '🧪',
  '🎯',
  '🗂️',
  '🌟',
  '⚡',
  '🛰️',
];

/**
 * Get the base URL without port prefix for creating tab URLs.
 * If running on port-{num}.domain.com, returns just the origin without the prefix.
 */
function getBaseOrigin(): string {
  const { protocol, host } = window.location;

  // Check if host matches port-{num}.domain.com pattern
  const portPrefixMatch = host.match(/^port-\d+\.(.+)$/);

  if (portPrefixMatch) {
    // Return base domain without the port prefix (different origin)
    return `${protocol}//${portPrefixMatch[1]}`;
  }

  // Same origin — use relative paths so URLs aren't tied to a specific host
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

function createDefaultSavedSessionState(): SavedWorkspaceSessionState {
  return {
    sessions: [],
  };
}

type OriginSessionResumeState = {
  lastSessionByOrigin: Record<string, string>;
};

function createDefaultOriginSessionResumeState(): OriginSessionResumeState {
  return {
    lastSessionByOrigin: {},
  };
}

function pickRandomMobileEmoji() {
  return MOBILE_TAB_EMOJIS[Math.floor(Math.random() * MOBILE_TAB_EMOJIS.length)];
}

function isInternalTabUrl(url: string): boolean {
  return url.startsWith('internal://');
}

function canPairTabs(tabUrls: string[]): boolean {
  return tabUrls.every((url) => !isInternalTabUrl(url));
}

function getIdSuffix(id: string): string {
  const parts = id.split(/[_-]/).filter(Boolean);
  return parts[parts.length - 1] || id;
}

function resolveQueryCraftSelection(
  workspace: WorkspaceState,
  session: SavedWorkspaceSession | undefined,
  craftParam: string | undefined,
  viewParam: string | undefined,
): {
  spaceId?: string;
  tabGroupId?: string;
  itemId?: string;
  voyageEntryId?: string;
  viewIds?: string[];
} {
  if (!(session && craftParam)) return {};
  const parsedCraft = parseCraftParam(craftParam);
  if (!parsedCraft) return {};

  const matchingEntry = session.voyageEntries?.find(
    (entry) =>
      getIdSuffix(entry.id) === parsedCraft.entrySuffix &&
      getIdSuffix(entry.tabGroupId) === parsedCraft.tabGroupSuffix,
  );
  if (!matchingEntry) return {};

  const tabGroup = workspace.tabGroups.find((entry) => entry.id === matchingEntry.tabGroupId);
  if (!tabGroup) return {};

  const viewSuffixes = parseViewsParam(viewParam);
  const viewIds = viewSuffixes
    .map((suffix) => tabGroup.tabs.find((tab) => getIdSuffix(tab.id) === suffix)?.id)
    .filter((id): id is string => Boolean(id));
  const resolvedViewIds = viewIds.length ? viewIds : matchingEntry.viewIds;
  const itemId =
    resolvedViewIds.length > 1
      ? tabGroup.pairs.find(
          (pair) =>
            pair.tabIds.length === resolvedViewIds.length &&
            pair.tabIds.every((tabId, index) => tabId === resolvedViewIds[index]),
        )?.id || resolvedViewIds[0]
      : resolvedViewIds[0];

  return {
    spaceId: workspace.spaces.find((space) => space.tabGroupIds.includes(tabGroup.id))?.id,
    tabGroupId: tabGroup.id,
    itemId,
    voyageEntryId: matchingEntry.id,
    viewIds: resolvedViewIds,
  };
}

springboard.registerModule(
  'workspace',
  { rpcMode: 'remote' },
  async (moduleAPI) => {
    const workspaceState =
      await moduleAPI.statesAPI.createPersistentState<WorkspaceState>(
        'workspace',
        createDefaultWorkspace(),
      );
    const savedSessionsState =
      await moduleAPI.statesAPI.createPersistentState<SavedWorkspaceSessionState>(
        'workspace-sessions',
        createDefaultSavedSessionState(),
      );
    const originSessionResumeState =
      await moduleAPI.statesAPI.createPersistentState<OriginSessionResumeState>(
        'workspace-origin-session-resume',
        createDefaultOriginSessionResumeState(),
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
            mobileEmoji: pickRandomMobileEmoji(),
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
          // Prevent deletion of system spaces (e.g., Home)
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
          // Prevent renaming of system spaces (e.g., Home)
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

      updateTabGroupMobileDisplay: async (args: {
        tabGroupId: string;
        mobileLabel: string | null;
        mobileEmoji: string | null;
      }) => {
        workspaceState.setStateImmer((draft) => {
          const tabGroup = draft.tabGroups.find(
            (tg) => tg.id === args.tabGroupId,
          );
          if (!tabGroup) return;

          tabGroup.mobileLabel = args.mobileLabel || undefined;
          tabGroup.mobileEmoji = args.mobileEmoji || undefined;
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
            mobileEmoji: pickRandomMobileEmoji(),
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

          const tabGroupIndex = space.tabGroupIds.indexOf(args.tabGroupId);
          if (tabGroupIndex === -1) return;

          if (space.tabGroupIds.length <= 1) {
            nextTabGroupId = `tg_${draft.nextId++}`;

            draft.tabGroups.push(
              space.isSystem
                ? {
                    id: nextTabGroupId,
                    label: 'Overview',
                    tabs: [
                      {
                        id: `tab_${draft.nextId++}`,
                        title: 'Spaces',
                        url: 'internal://spaces-overview',
                        pinned: true,
                      },
                    ],
                    pairs: [],
                    order: 0,
                    createdAt: new Date().toISOString(),
                  }
                : {
                    id: nextTabGroupId,
                    label: 'Main',
                    mobileEmoji: pickRandomMobileEmoji(),
                    tabs: [],
                    pairs: [],
                    order: 0,
                    createdAt: new Date().toISOString(),
                  },
            );

            space.tabGroupIds.push(nextTabGroupId);
          }

          // Remove tab group ID from space
          const updatedIndex = space.tabGroupIds.indexOf(args.tabGroupId);
          space.tabGroupIds.splice(updatedIndex, 1);

          // Remove the tab group itself (this also removes all tabs and pairs)
          draft.tabGroups = draft.tabGroups.filter(
            (tg) => tg.id !== args.tabGroupId,
          );

          // Determine next tab group to select
          nextTabGroupId =
            nextTabGroupId ||
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
          const defaultSpace = getDefaultSpace(draft);
          if (!defaultSpace) return;

          let firstTabGroup =
            defaultSpace.tabGroupIds.length > 0
              ? draft.tabGroups.find((g) => g.id === defaultSpace.tabGroupIds[0])
              : undefined;

          if (!firstTabGroup) {
            const tabGroupId = `tg_${draft.nextId++}`;
            firstTabGroup = {
              id: tabGroupId,
              label: 'Main',
              mobileEmoji: pickRandomMobileEmoji(),
              tabs: [],
              pairs: [],
              order: 0,
              createdAt: new Date().toISOString(),
            };
            draft.tabGroups.push(firstTabGroup);

            if (defaultSpace.tabGroupIds.length > 0) {
              defaultSpace.tabGroupIds[0] = tabGroupId;
            } else {
              defaultSpace.tabGroupIds.push(tabGroupId);
            }
          }

          const existingTab = firstTabGroup.tabs.find((tab) =>
            isWorkspaceTabPath(tab.url, WORKSPACE_CREATE_PATH),
          );
          if (existingTab) {
            result = {
              spaceId: defaultSpace.id,
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
            spaceId: defaultSpace.id,
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
          const tabsToPair = args.tabIds
            .map((tabId) => tg.tabs.find((tab) => tab.id === tabId))
            .filter((tab): tab is NonNullable<typeof tab> => Boolean(tab));
          if (
            tabsToPair.length !== args.tabIds.length ||
            !canPairTabs(tabsToPair.map((tab) => tab.url))
          ) {
            return;
          }

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

          // Generate IDs for tab group and tabs
          tabGroupId = `tg_${draft.nextId++}`;
          pairId = `pair_${draft.nextId++}`;
          const kanbanTabId = `tab_${draft.nextId++}`;
          const codeTabId = `tab_${draft.nextId++}`;

          // Store agent tab ID for return
          agentTabId = kanbanTabId;

          // Create the new tab group with base origin URLs (no port prefix)
          draft.tabGroups.push({
            id: tabGroupId,
            label:
              args.name.length > 30
                ? args.name.substring(0, 27) + '...'
                : args.name,
            mobileEmoji: pickRandomMobileEmoji(),
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
                url: buildWorkspaceFolderUrl(args.baseOrigin, args.containerRef),
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
          const sourceSpace = draft.spaces.find((s) => s.id === args.sourceId);
          const targetSpace = draft.spaces.find((s) => s.id === args.targetId);
          if (sourceSpace?.isSystem || targetSpace?.isSystem) return;

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

      upsertSavedSession: async (args: SavedWorkspaceSession) => {
        savedSessionsState.setStateImmer((draft) => {
          const existing = draft.sessions.find((session) => session.id === args.id);
          if (existing) {
            existing.slug = args.slug;
            existing.name = args.name;
            existing.updatedAt = args.updatedAt;
            existing.activeVoyageEntryId = args.activeVoyageEntryId;
            existing.voyageEntries = args.voyageEntries;
            existing.activeSpaceId = args.activeSpaceId;
            existing.activeTabGroupId = args.activeTabGroupId;
            existing.activeItemsByVoyageEntryId = args.activeItemsByVoyageEntryId;
            existing.activeItems = args.activeItems;
            existing.visitedTabGroupIds = args.visitedTabGroupIds;
            return;
          }

          draft.sessions.unshift(args);
        });
      },
      renameSavedSession: async (args: { id: string; name: string }) => {
        savedSessionsState.setStateImmer((draft) => {
          const existing = draft.sessions.find((session) => session.id === args.id);
          if (!existing) return;
          existing.name = args.name;
          existing.updatedAt = new Date().toISOString();
        });
      },
      deleteSavedSession: async (args: { id: string }) => {
        savedSessionsState.setStateImmer((draft) => {
          draft.sessions = draft.sessions.filter((session) => session.id !== args.id);
        });
        originSessionResumeState.setStateImmer((draft) => {
          Object.entries(draft.lastSessionByOrigin).forEach(([origin, sessionId]) => {
            if (sessionId === args.id) {
              delete draft.lastSessionByOrigin[origin];
            }
          });
        });
      },
      setOriginDefaultSession: async (args: {
        origin: string;
        sessionId: string;
      }) => {
        originSessionResumeState.setStateImmer((draft) => {
          draft.lastSessionByOrigin[args.origin] = args.sessionId;
        });
      },
    });

    // Redirect component for root path (dev server case)
    const RootRedirect = () => {
      const navigate = useNavigate();
      const location = useLocation();
      useEffect(() => {
        navigate(`/dashboard${location.search}`, { replace: true });
      }, [location.search, navigate]);
      return null;
    };

    // Shared route component with legacy path-params plus canonical voyage query-param support
    const WorkspaceRoute = () => {
      const workspace = workspaceState.useState();
      const savedSessions = savedSessionsState.useState();
      const originSessionResume = originSessionResumeState.useState();
      const { spaceId, tabGroupId, itemId } = useParams<{
        spaceId?: string;
        tabGroupId?: string;
        itemId?: string;
      }>();
      const location = useLocation();
      const navigate = useNavigate();
      const sessionSearchParams = new URLSearchParams(location.search);
      const requestedVoyageKey = (() => {
        if (typeof window === 'undefined') return undefined;
        const value =
          sessionSearchParams.get('voyage')?.trim() ||
          sessionSearchParams.get('session')?.trim();
        return value || undefined;
      })();
      const requestedLegacySessionId =
        sessionSearchParams.get('session')?.trim() || undefined;
      const queryCraftParam = sessionSearchParams.get('craft')?.trim() || undefined;
      const queryViewsParam = sessionSearchParams.get('views')?.trim() || undefined;
      const hasVoyageBookmarkParam = requestedVoyageKey != null;
      const currentOrigin =
        typeof window === 'undefined' ? undefined : window.location.origin;
      const originDefaultSessionId =
        currentOrigin
          ? originSessionResume.lastSessionByOrigin[currentOrigin]
          : undefined;
      const storedBrowserSessionId =
        typeof window === 'undefined'
          ? null
          : getStoredBrowserSessionId();
      const preferredSessionId = resolvePreferredVoyageSessionId({
        savedSessions: savedSessions.sessions,
        requestedVoyageKey,
        requestedLegacySessionId,
        storedBrowserSessionId,
        originDefaultSessionId,
        createReplacementSessionId: createNewBrowserSessionId,
      });
      const browserSessionId =
        typeof window === 'undefined'
          ? 'server-session'
          : getOrCreateBrowserSessionId(preferredSessionId);
      const activeSavedSession = savedSessions.sessions.find(
        (session) => session.id === browserSessionId,
      );
      const querySelection = resolveQueryCraftSelection(
        workspace,
        activeSavedSession,
        queryCraftParam,
        queryViewsParam,
      );
      const sessionNav = useSessionWorkspaceNav(
        workspace,
        {
          spaceId: querySelection.spaceId || spaceId,
          tabGroupId: querySelection.tabGroupId || tabGroupId,
          itemId: querySelection.itemId || itemId,
          voyageEntryId: querySelection.voyageEntryId,
          viewIds: querySelection.viewIds,
        },
        activeSavedSession,
      );

      // Update document title to reflect active space and tab group
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

      // Record visit timestamp when active tab group changes
      useEffect(() => {
        if (sessionNav.activeTabGroupId) {
          actions.touchTabGroup({ tabGroupId: sessionNav.activeTabGroupId });
        }
      }, [sessionNav.activeTabGroupId]);

      useEffect(() => {
        if (!(sessionNav.activeSpaceId && sessionNav.activeTabGroupId)) return;

        const now = new Date().toISOString();
        const currentTabGroup = workspace.tabGroups.find(
          (tg) => tg.id === sessionNav.activeTabGroupId,
        );
        void actions.upsertSavedSession({
          id: browserSessionId,
          slug:
            activeSavedSession?.slug ||
            buildVoyageSlug(
              activeSavedSession?.name || currentTabGroup?.label || 'voyage',
              browserSessionId,
            ),
          name: activeSavedSession?.name,
          createdAt: activeSavedSession?.createdAt || now,
          updatedAt: now,
          activeVoyageEntryId: sessionNav.activeVoyageEntryId,
          voyageEntries: sessionNav.voyageEntries,
          activeSpaceId: sessionNav.activeSpaceId,
          activeTabGroupId: sessionNav.activeTabGroupId,
          activeItemsByVoyageEntryId: sessionNav.activeItemsByVoyageEntryId,
          activeItems: sessionNav.activeItems,
          visitedTabGroupIds: sessionNav.visitedTabGroupIds,
        });
      }, [
        activeSavedSession?.createdAt,
        actions,
        browserSessionId,
        sessionNav.activeItems,
        sessionNav.activeSpaceId,
        sessionNav.activeTabGroupId,
        sessionNav.activeVoyageEntryId,
        sessionNav.activeItemsByVoyageEntryId,
        sessionNav.voyageEntries,
        sessionNav.visitedTabGroupIds,
      ]);

      useEffect(() => {
        if (!(currentOrigin && browserSessionId)) return;
        void actions.setOriginDefaultSession({
          origin: currentOrigin,
          sessionId: browserSessionId,
        });
      }, [actions, browserSessionId, currentOrigin]);

      // Sync URL to match canonical voyage/craft/views query params
      useEffect(() => {
        const currentPath = `${location.pathname}${location.search}`;
        const currentTabGroup = workspace.tabGroups.find(
          (tg) => tg.id === sessionNav.activeTabGroupId,
        );
        const activeVoyageEntry = sessionNav.voyageEntries.find(
          (entry) => entry.id === sessionNav.activeVoyageEntryId,
        );
        const currentVoyageSlug =
          activeSavedSession?.slug ||
          buildVoyageSlug(
            activeSavedSession?.name || currentTabGroup?.label || 'voyage',
            browserSessionId,
          );
        const nextSearchParams = new URLSearchParams();
        nextSearchParams.set('voyage', currentVoyageSlug);

        const craftParam = buildCraftParam(currentTabGroup, activeVoyageEntry);
        if (craftParam) {
          nextSearchParams.set('craft', craftParam);
        }

        const activeViewIds = activeVoyageEntry?.viewIds || [];
        const viewTokens = activeViewIds
          .map((viewId) => {
            const tab = currentTabGroup?.tabs.find((entry) => entry.id === viewId);
            return tab ? buildViewParam(tab.title, tab.id) : null;
          })
          .filter((token): token is string => Boolean(token));
        if (viewTokens.length) {
          nextSearchParams.set('views', viewTokens.join(','));
        }

        const nextPath = `/dashboard?${nextSearchParams.toString()}`;
        if (nextPath !== currentPath) {
          navigate(nextPath, { replace: true });
        }
      }, [
        activeSavedSession?.name,
        activeSavedSession?.slug,
        browserSessionId,
        location.search,
        location.pathname,
        navigate,
        sessionNav.activeTabGroupId,
        sessionNav.activeVoyageEntryId,
        sessionNav.voyageEntries,
        workspace.tabGroups,
      ]);

      // Wrap actions that need session parameters
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
          // If action returned a tab to select, select it
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
        addVKWorkspace: async (args: {
          taskAttemptId: string;
          name: string;
          containerRef: string;
          activeSpaceId: string;
        }) => {
          const baseOrigin = getBaseOrigin();
          const containerRef = await resolveWorkspaceContainerRef(
            args.taskAttemptId,
            args.containerRef,
          );
          return actions.addVKWorkspace({ ...args, containerRef, baseOrigin });
        },
        ensureCreateWorkspaceTab: () => {
          const baseOrigin = getBaseOrigin();
          return actions.ensureCreateWorkspaceTab({ baseOrigin });
        },
      };

      const updateBookmarkedSessionSearch = (sessionId: string) => {
        if (!hasVoyageBookmarkParam) return;
        const nextSearchParams = new URLSearchParams(location.search);
        const session = savedSessions.sessions.find((entry) => entry.id === sessionId);
        nextSearchParams.set(
          'voyage',
          session ? getVoyageSlug(session) : buildVoyageSlug(undefined, sessionId),
        );
        nextSearchParams.delete('session');
        navigate(`${location.pathname}?${nextSearchParams.toString()}`, {
          replace: true,
        });
      };

      const sessionActions = {
        selectSpace: sessionNav.selectSpace,
        selectSessionTabGroup: sessionNav.selectSessionTabGroup,
        selectSessionTab: sessionNav.selectSessionTab,
        selectSessionPair: sessionNav.selectSessionPair,
        selectVoyageEntry: sessionNav.selectVoyageEntry,
        selectTab: sessionNav.selectTab,
        selectPair: sessionNav.selectPair,
        setActiveTabGroup: sessionNav.setActiveTabGroup,
        getActiveItem: sessionNav.getActiveItem,
        resumeSession: (sessionId: string, voyageEntryId?: string) => {
          const sessionToResume = savedSessions.sessions.find(
            (session) => session.id === sessionId,
          );
          if (!sessionToResume) return;
          if (typeof window !== 'undefined') {
            setBrowserSessionId(sessionId);
          }
          updateBookmarkedSessionSearch(sessionId);
          sessionNav.resumeSession(sessionToResume, voyageEntryId);
        },
        startNewSession: () => {
          const nextSessionId = createNewBrowserSessionId();
          if (typeof window !== 'undefined') {
            setBrowserSessionId(nextSessionId);
          }
          updateBookmarkedSessionSearch(nextSessionId);
          sessionNav.startNewSession();
        },
        renameSession: (sessionId: string, name: string) => {
          void actions.renameSavedSession({ id: sessionId, name });
        },
        deleteSession: (sessionId: string) => {
          if (sessionId === browserSessionId) {
            const nextSessionId = createNewBrowserSessionId();
            if (typeof window !== 'undefined') {
              setBrowserSessionId(nextSessionId);
            }
            updateBookmarkedSessionSearch(nextSessionId);
            sessionNav.startNewSession();
          }
          void actions.deleteSavedSession({ id: sessionId });
        },
        addTabGroupToSession: (
          tabGroupId: string,
          options?: { allowDuplicate?: boolean; select?: boolean },
        ) => {
          sessionNav.addTabGroupToSession(tabGroupId, options);
        },
        removeVoyageEntryFromSession: (voyageEntryId: string) => {
          sessionNav.removeVoyageEntryFromSession(voyageEntryId);
        },
        removeTabGroupFromSession: (tabGroupId: string) => {
          sessionNav.removeTabGroupFromSession(tabGroupId);
        },
        reorderVoyageEntries: (sourceEntryId: string, targetEntryId: string) => {
          sessionNav.reorderVoyageEntries(sourceEntryId, targetEntryId);
        },
        reorderSessionTabGroups: (sourceId: string, targetId: string) => {
          sessionNav.reorderSessionTabGroups(sourceId, targetId);
        },
      };

      return (
        <>
          <div className="dark w-screen h-screen fixed inset-0">
            <WorkspaceShell
              workspace={workspace}
              session={sessionNav}
              actions={normalizeActionReturns(wrappedActions)}
              sessionActions={sessionActions}
              savedSessions={savedSessions.sessions}
              currentSessionId={browserSessionId}
            />
          </div>
        </>
      );
    };

    // Root redirects to /dashboard (for dev server case)
    moduleAPI.registerRoute('/', { hideApplicationShell: true }, RootRedirect);

    // Register dashboard routes with increasing specificity
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
      Provider: (props: React.PropsWithChildren) => {
        return <HeroUIProvider>{props.children}</HeroUIProvider>;
      },
    };
  },
);

type FlattenNestedPromise<T> =
  T extends Promise<unknown> ? Promise<Awaited<T>> : T;

type NormalizeActionReturns<T extends Record<string, (...args: any[]) => any>> =
  {
    [K in keyof T]: (
      ...args: Parameters<T[K]>
    ) => FlattenNestedPromise<ReturnType<T[K]>>;
  };

function normalizeActionReturns<
  T extends Record<string, (...args: any[]) => any>,
>(actions: T) {
  return actions as NormalizeActionReturns<T>;
}
