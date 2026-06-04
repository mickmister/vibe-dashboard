import {
  buildVoyageSlug,
} from './lib/voyageUrl';
import {
  createSavedWorkspaceSessionState,
  getSavedWorkspaceSessions,
  isSavedWorkspaceSessionStateMigrated,
  migrateSavedWorkspaceSessionStateWithCleanup,
} from './lib/savedVoyageState';

import springboard, { ModuleAPI } from 'springboard';
import { createDefaultWorkspace, getDefaultSpace } from './types';
import { buildWorkspaceFolderUrl } from './lib/vkWorkspaceUrl';
import type {
  WorkspaceState,
  SavedWorkspaceSession,
  SavedWorkspaceSessionState,
  VoyageEntry,
} from './types';

// @platform "browser"
import './modules/MainUIShellModule';
// @platform end

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
  return createSavedWorkspaceSessionState();
}

type OriginSessionResumeState = {
  lastSessionByOrigin: Record<string, string>;
};

function createDefaultOriginSessionResumeState(): OriginSessionResumeState {
  return {
    lastSessionByOrigin: {},
  };
}

function createWorkspaceSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function createVoyageEntryIdForTabGroup(tabGroupId: string): string {
  return `ve_${tabGroupId}`;
}

function getDefaultViewIdsForTabGroup(workspace: WorkspaceState, tabGroupId: string): string[] {
  const tabGroup = workspace.tabGroups.find((entry) => entry.id === tabGroupId);
  if (!tabGroup) return [];
  const firstTabId = tabGroup.tabs[0]?.id;
  if (firstTabId) return [firstTabId];
  const firstPair = tabGroup.pairs[0];
  if (firstPair?.tabIds.length) return [...firstPair.tabIds];
  return [];
}

function getActiveItemIdForViewIds(
  workspace: WorkspaceState,
  tabGroupId: string,
  viewIds: string[],
): string {
  const tabGroup = workspace.tabGroups.find((entry) => entry.id === tabGroupId);
  if (!tabGroup) return '';
  if (viewIds.length > 1) {
    const pair = tabGroup.pairs.find(
      (entry) =>
        entry.tabIds.length === viewIds.length &&
        entry.tabIds.every((tabId, index) => tabId === viewIds[index]),
    );
    if (pair) return pair.id;
  }
  if (viewIds[0] && tabGroup.tabs.some((tab) => tab.id === viewIds[0])) {
    return viewIds[0];
  }
  return tabGroup.tabs[0]?.id || tabGroup.pairs[0]?.id || '';
}

function getSelectedViewIdsForTabGroup(
  workspace: WorkspaceState,
  tabGroupId: string,
  tabId?: string,
): string[] {
  const tabGroup = workspace.tabGroups.find((entry) => entry.id === tabGroupId);
  if (!tabGroup) return [];
  if (tabId && tabGroup.tabs.some((tab) => tab.id === tabId)) return [tabId];
  return getDefaultViewIdsForTabGroup(workspace, tabGroupId);
}

function createUniqueVoyageEntryId(
  existingEntries: VoyageEntry[],
  tabGroupId: string,
): string {
  const baseId = createVoyageEntryIdForTabGroup(tabGroupId);
  const existingIds = new Set(existingEntries.map((entry) => entry.id));
  if (!existingIds.has(baseId)) return baseId;

  let suffix = 1;
  let nextEntryId = `${baseId}_${suffix}`;
  while (existingIds.has(nextEntryId)) {
    suffix += 1;
    nextEntryId = `${baseId}_${suffix}`;
  }
  return nextEntryId;
}

function createSavedSessionFromSelection({
  workspace,
  name,
  spaceId,
  tabGroupId,
  tabId,
}: {
  workspace: WorkspaceState;
  name: string;
  spaceId: string;
  tabGroupId: string;
  tabId?: string;
}): SavedWorkspaceSession | undefined {
  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.toLowerCase() === 'home') return undefined;

  const space = workspace.spaces.find(
    (entry) => entry.id === spaceId && entry.tabGroupIds.includes(tabGroupId),
  );
  const tabGroup = workspace.tabGroups.find((entry) => entry.id === tabGroupId);
  if (!(space && tabGroup)) return undefined;

  const selectedViewIds = getSelectedViewIdsForTabGroup(
    workspace,
    tabGroup.id,
    tabId,
  );
  if (!selectedViewIds.length) return undefined;

  const id = createWorkspaceSessionId();
  const now = new Date().toISOString();
  const voyageEntry = {
    id: createVoyageEntryIdForTabGroup(tabGroup.id),
    tabGroupId: tabGroup.id,
    viewIds: selectedViewIds,
  };
  const activeItemId = getActiveItemIdForViewIds(
    workspace,
    tabGroup.id,
    selectedViewIds,
  );

  return {
    id,
    slug: buildVoyageSlug(trimmedName, id),
    name: trimmedName,
    createdAt: now,
    updatedAt: now,
    activeVoyageEntryId: voyageEntry.id,
    voyageEntries: [voyageEntry],
    activeSpaceId: space.id,
    activeTabGroupId: tabGroup.id,
    activeItemsByVoyageEntryId: {
      [voyageEntry.id]: activeItemId,
    },
    activeItems: {
      [tabGroup.id]: activeItemId,
    },
    visitedTabGroupIds: [tabGroup.id],
  };
}

function addCreateWorkspaceCraftToWorkspace(
  workspace: WorkspaceState,
  args: { baseOrigin: string; label?: string },
): { spaceId: string; tabGroupId: string; tabId: string } | undefined {
  const defaultSpace = getDefaultSpace(workspace);
  if (!defaultSpace) return undefined;

  const tabGroupId = `tg_${workspace.nextId++}`;
  const tabId = `tab_${workspace.nextId++}`;
  const label = args.label?.trim() || WORKSPACE_CREATE_TAB_TITLE;

  workspace.tabGroups.push({
    id: tabGroupId,
    label,
    mobileEmoji: pickRandomMobileEmoji(),
    tabs: [
      {
        id: tabId,
        title: WORKSPACE_CREATE_TAB_TITLE,
        url: buildWorkspaceTabUrl(args.baseOrigin, WORKSPACE_CREATE_PATH),
      },
    ],
    pairs: [],
    order: defaultSpace.tabGroupIds.length,
    createdAt: new Date().toISOString(),
  });
  defaultSpace.tabGroupIds.push(tabGroupId);

  return {
    spaceId: defaultSpace.id,
    tabGroupId,
    tabId,
  };
}

function cloneSavedSession(session: SavedWorkspaceSession): SavedWorkspaceSession {
  return {
    ...session,
    activeItems: { ...(session.activeItems || {}) },
    activeItemsByVoyageEntryId: {
      ...(session.activeItemsByVoyageEntryId || {}),
    },
    voyageEntries: session.voyageEntries
      ? session.voyageEntries.map((entry) => ({
          ...entry,
          viewIds: [...entry.viewIds],
        }))
      : undefined,
    visitedTabGroupIds: [...(session.visitedTabGroupIds || [])],
  };
}

function normalizeVoyageEntryForWorkspace(
  workspace: WorkspaceState,
  entry: VoyageEntry,
): VoyageEntry | undefined {
  const tabGroup = workspace.tabGroups.find(
    (candidate) => candidate.id === entry.tabGroupId,
  );
  if (!tabGroup) return undefined;

  const validViewIds = entry.viewIds.filter((viewId) =>
    tabGroup.tabs.some((tab) => tab.id === viewId),
  );
  return {
    ...entry,
    viewIds: validViewIds.length
      ? validViewIds
      : getDefaultViewIdsForTabGroup(workspace, entry.tabGroupId),
  };
}

function repairSavedSessionForWorkspace(
  session: SavedWorkspaceSession,
  workspace: WorkspaceState,
): SavedWorkspaceSession | undefined {
  const voyageEntries = (session.voyageEntries || [])
    .map((entry) => normalizeVoyageEntryForWorkspace(workspace, entry))
    .filter((entry): entry is VoyageEntry => Boolean(entry));
  if (!voyageEntries.length) return undefined;

  const activeVoyageEntryId =
    voyageEntries.find((entry) => entry.id === session.activeVoyageEntryId)?.id ||
    voyageEntries[0]!.id;
  const activeEntry =
    voyageEntries.find((entry) => entry.id === activeVoyageEntryId) ||
    voyageEntries[0]!;
  const activeSpaceId =
    workspace.spaces.find((space) => space.tabGroupIds.includes(activeEntry.tabGroupId))?.id ||
    session.activeSpaceId;
  const activeItemsByVoyageEntryId: Record<string, string> = {};
  const activeItems: Record<string, string> = {};

  voyageEntries.forEach((entry) => {
    const activeItemId = getActiveItemIdForViewIds(
      workspace,
      entry.tabGroupId,
      entry.viewIds,
    );
    activeItemsByVoyageEntryId[entry.id] = activeItemId;
    activeItems[entry.tabGroupId] = activeItemId;
  });

  return {
    ...session,
    activeVoyageEntryId,
    voyageEntries,
    activeSpaceId,
    activeTabGroupId: activeEntry.tabGroupId,
    activeItemsByVoyageEntryId,
    activeItems,
    visitedTabGroupIds: Array.from(new Set(voyageEntries.map((entry) => entry.tabGroupId))),
  };
}

function repairSavedSessionsForWorkspace(
  state: SavedWorkspaceSessionState,
  workspace: WorkspaceState,
): { state: SavedWorkspaceSessionState; removedSessionIds: string[] } {
  const repairedSessions: SavedWorkspaceSession[] = [];
  const removedSessionIds: string[] = [];

  getSavedWorkspaceSessions(state).forEach((session) => {
    const repairedSession = repairSavedSessionForWorkspace(
      cloneSavedSession(session),
      workspace,
    );
    if (repairedSession) {
      repairedSessions.push(repairedSession);
    } else {
      removedSessionIds.push(session.id);
    }
  });

  return {
    state: createSavedWorkspaceSessionState(repairedSessions),
    removedSessionIds,
  };
}

function removeOriginDefaultsForSessions(
  originState: OriginSessionResumeState,
  removedSessionIds: string[],
) {
  if (!removedSessionIds.length) return;
  const removedIds = new Set(removedSessionIds);
  Object.entries(originState.lastSessionByOrigin).forEach(([origin, sessionId]) => {
    if (removedIds.has(sessionId)) {
      delete originState.lastSessionByOrigin[origin];
    }
  });
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

declare module 'springboard/module_registry/module_registry' {
    interface AllModules {
        workspace: WorkspaceModuleReturnValue;
    }
}

type WorkspaceModuleReturnValue = Awaited<ReturnType<typeof createWorkspaceModule>>;

springboard.registerModule(
  'workspace',
  { rpcMode: 'remote' },
  async (moduleAPI): Promise<WorkspaceModuleReturnValue> => {
    return createWorkspaceModule(moduleAPI);
  });

const createWorkspaceModule = async (moduleAPI: ModuleAPI) => {
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
    // v2 is the first shipped saved-voyage migration. Since no production
    // state has been written as v2 yet, the v2 migration also performs the
    // Home-voyage removal and duplicate cleanup before marking state migrated.
    if (
      moduleAPI.deps.core.isMaestro() &&
      !isSavedWorkspaceSessionStateMigrated(savedSessionsState.getState())
    ) {
      const migratedSavedSessions = migrateSavedWorkspaceSessionStateWithCleanup(
        savedSessionsState.getState(),
        {
          workspace: workspaceState.getState(),
          originResumeState: originSessionResumeState.getState(),
        },
      );
      savedSessionsState.setState(migratedSavedSessions.state);
      if (migratedSavedSessions.originResumeState) {
        originSessionResumeState.setState(
          migratedSavedSessions.originResumeState,
        );
      }
    }

    const repairSavedVoyagesForCurrentWorkspace = () => {
      const repaired = repairSavedSessionsForWorkspace(
        savedSessionsState.getState(),
        workspaceState.getState(),
      );
      savedSessionsState.setState(repaired.state);
      if (repaired.removedSessionIds.length) {
        originSessionResumeState.setStateImmer((draft) => {
          removeOriginDefaultsForSessions(draft, repaired.removedSessionIds);
        });
      }
    };

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
        if (wasDeleted) {
          repairSavedVoyagesForCurrentWorkspace();
        }

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
        if (wasDeleted) {
          repairSavedVoyagesForCurrentWorkspace();
        }

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
        repairSavedVoyagesForCurrentWorkspace();
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

      createCreateWorkspaceCraft: async (args: { baseOrigin: string; label?: string }) => {
        let result:
          | { spaceId: string; tabGroupId: string; tabId: string }
          | undefined;

        workspaceState.setStateImmer((draft) => {
          result = addCreateWorkspaceCraftToWorkspace(draft, args);
        });

        return result;
      },

      createCreateWorkspaceSavedSession: async (args: {
        baseOrigin: string;
        name: string;
        label?: string;
      }) => {
        const voyageName = args.name.trim();
        if (!voyageName || voyageName.toLowerCase() === 'home') return undefined;

        let result:
          | { spaceId: string; tabGroupId: string; tabId: string }
          | undefined;

        workspaceState.setStateImmer((draft) => {
          result = addCreateWorkspaceCraftToWorkspace(draft, args);
        });

        if (!result) return undefined;

        const savedSession = createSavedSessionFromSelection({
          workspace: workspaceState.getState(),
          name: voyageName,
          spaceId: result.spaceId,
          tabGroupId: result.tabGroupId,
          tabId: result.tabId,
        });
        if (!savedSession) return undefined;

        savedSessionsState.setState((current) => {
          const sessions = getSavedWorkspaceSessions(current).filter(
            (session) => session.id !== savedSession.id,
          );
          sessions.unshift(savedSession);
          return createSavedWorkspaceSessionState(sessions);
        });

        return savedSession;
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
        if (firstTabId) {
          repairSavedVoyagesForCurrentWorkspace();
        }

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
            label: args.name,
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

      createSavedSessionForSelection: async (args: {
        name: string;
        spaceId: string;
        tabGroupId: string;
        tabId?: string;
      }) => {
        const workspace = workspaceState.getState();
        const savedSession = createSavedSessionFromSelection({
          workspace,
          name: args.name,
          spaceId: args.spaceId,
          tabGroupId: args.tabGroupId,
          ...(args.tabId ? { tabId: args.tabId } : {}),
        });
        if (!savedSession) return undefined;

        savedSessionsState.setState((current) => {
          const sessions = getSavedWorkspaceSessions(current).filter(
            (session) => session.id !== savedSession.id,
          );
          sessions.unshift(savedSession);
          return createSavedWorkspaceSessionState(sessions);
        });

        return savedSession;
      },

      addSelectionToSavedSession: async (args: {
        sessionId: string;
        spaceId: string;
        tabGroupId: string;
        tabId?: string;
        viewIds?: string[];
      }) => {
        const workspace = workspaceState.getState();
        const space = workspace.spaces.find(
          (entry) => entry.id === args.spaceId && entry.tabGroupIds.includes(args.tabGroupId),
        );
        const tabGroup = workspace.tabGroups.find((entry) => entry.id === args.tabGroupId);
        if (!(space && tabGroup)) return undefined;

        const selectedViewIds = args.viewIds?.length
          ? normalizeVoyageEntryForWorkspace(workspace, {
              id: createVoyageEntryIdForTabGroup(tabGroup.id),
              tabGroupId: tabGroup.id,
              viewIds: args.viewIds,
            })?.viewIds || []
          : getSelectedViewIdsForTabGroup(
              workspace,
              tabGroup.id,
              args.tabId,
            );
        if (!selectedViewIds.length) return undefined;

        const now = new Date().toISOString();
        const activeItemId = getActiveItemIdForViewIds(
          workspace,
          tabGroup.id,
          selectedViewIds,
        );
        let updatedSession: SavedWorkspaceSession | undefined;

        savedSessionsState.setState((current) => {
          const sessions = getSavedWorkspaceSessions(current).map((session) => ({
            ...session,
            activeItems: { ...(session.activeItems || {}) },
            activeItemsByVoyageEntryId: {
              ...(session.activeItemsByVoyageEntryId || {}),
            },
            voyageEntries: session.voyageEntries
              ? session.voyageEntries.map((entry) => ({ ...entry, viewIds: [...entry.viewIds] }))
              : undefined,
            visitedTabGroupIds: [...(session.visitedTabGroupIds || [])],
          }));
          const target = sessions.find((session) => session.id === args.sessionId);
          if (!target) return createSavedWorkspaceSessionState(sessions);

          const existingEntries = target.voyageEntries || [];
          const existingEntry = existingEntries.find(
            (entry) => entry.tabGroupId === tabGroup.id,
          );
          const activeEntry =
            existingEntry ||
            ({
              id: createUniqueVoyageEntryId(existingEntries, tabGroup.id),
              tabGroupId: tabGroup.id,
              viewIds: selectedViewIds,
            } satisfies VoyageEntry);
          activeEntry.viewIds = selectedViewIds;
          const nextEntries = existingEntry
            ? existingEntries
            : [...existingEntries, activeEntry];

          target.voyageEntries = nextEntries;
          target.activeVoyageEntryId = activeEntry.id;
          target.activeSpaceId = space.id;
          target.activeTabGroupId = tabGroup.id;
          target.activeItemsByVoyageEntryId = {
            ...(target.activeItemsByVoyageEntryId || {}),
            [activeEntry.id]: activeItemId,
          };
          target.activeItems = {
            ...(target.activeItems || {}),
            [tabGroup.id]: activeItemId,
          };
          target.visitedTabGroupIds = Array.from(
            new Set([...(target.visitedTabGroupIds || []), tabGroup.id]),
          );
          target.updatedAt = now;
          updatedSession = target;
          return createSavedWorkspaceSessionState(sessions);
        });

        return updatedSession;
      },

      activateSavedVoyageEntry: async (args: {
        sessionId: string;
        voyageEntryId: string;
      }) => {
        let updatedSession: SavedWorkspaceSession | undefined;
        savedSessionsState.setState((current) => {
          const sessions = getSavedWorkspaceSessions(current).map(cloneSavedSession);
          const target = sessions.find((session) => session.id === args.sessionId);
          const entry = target?.voyageEntries?.find(
            (candidate) => candidate.id === args.voyageEntryId,
          );
          if (!(target && entry)) return createSavedWorkspaceSessionState(sessions);

          const workspace = workspaceState.getState();
          const activeSpaceId =
            workspace.spaces.find((space) => space.tabGroupIds.includes(entry.tabGroupId))?.id ||
            target.activeSpaceId;
          const activeItemId = getActiveItemIdForViewIds(
            workspace,
            entry.tabGroupId,
            entry.viewIds,
          );
          target.activeVoyageEntryId = entry.id;
          target.activeTabGroupId = entry.tabGroupId;
          target.activeSpaceId = activeSpaceId;
          target.activeItemsByVoyageEntryId = {
            ...(target.activeItemsByVoyageEntryId || {}),
            [entry.id]: activeItemId,
          };
          target.activeItems = {
            ...(target.activeItems || {}),
            [entry.tabGroupId]: activeItemId,
          };
          target.updatedAt = new Date().toISOString();
          updatedSession = target;
          return createSavedWorkspaceSessionState(sessions);
        });
        return updatedSession;
      },

      removeVoyageEntryFromSavedSession: async (args: {
        sessionId: string;
        voyageEntryId: string;
      }) => {
        let updatedSession: SavedWorkspaceSession | undefined;
        savedSessionsState.setState((current) => {
          const sessions = getSavedWorkspaceSessions(current).map(cloneSavedSession);
          const target = sessions.find((session) => session.id === args.sessionId);
          if (!(target?.voyageEntries?.length)) {
            return createSavedWorkspaceSessionState(sessions);
          }

          const nextEntries = target.voyageEntries.filter(
            (entry) => entry.id !== args.voyageEntryId,
          );
          if (nextEntries.length === target.voyageEntries.length || !nextEntries.length) {
            return createSavedWorkspaceSessionState(sessions);
          }

          const fallbackEntry =
            nextEntries.find((entry) => entry.id === target.activeVoyageEntryId) ||
            nextEntries[0]!;
          const repaired = repairSavedSessionForWorkspace(
            {
              ...target,
              voyageEntries: nextEntries,
              activeVoyageEntryId: fallbackEntry.id,
            },
            workspaceState.getState(),
          );
          if (!repaired) return createSavedWorkspaceSessionState(sessions);

          Object.assign(target, {
            ...repaired,
            updatedAt: new Date().toISOString(),
          });
          updatedSession = target;
          return createSavedWorkspaceSessionState(sessions);
        });
        return updatedSession;
      },

      reorderSavedVoyageEntries: async (args: {
        sessionId: string;
        sourceEntryId: string;
        targetEntryId: string;
      }) => {
        let updatedSession: SavedWorkspaceSession | undefined;
        savedSessionsState.setState((current) => {
          const sessions = getSavedWorkspaceSessions(current).map(cloneSavedSession);
          const target = sessions.find((session) => session.id === args.sessionId);
          if (!target?.voyageEntries) return createSavedWorkspaceSessionState(sessions);

          const sourceIndex = target.voyageEntries.findIndex(
            (entry) => entry.id === args.sourceEntryId,
          );
          const targetIndex = target.voyageEntries.findIndex(
            (entry) => entry.id === args.targetEntryId,
          );
          if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
            return createSavedWorkspaceSessionState(sessions);
          }

          const nextEntries = [...target.voyageEntries];
          const [moved] = nextEntries.splice(sourceIndex, 1);
          if (!moved) return createSavedWorkspaceSessionState(sessions);
          nextEntries.splice(targetIndex, 0, moved);
          target.voyageEntries = nextEntries;
          target.updatedAt = new Date().toISOString();
          updatedSession = target;
          return createSavedWorkspaceSessionState(sessions);
        });
        return updatedSession;
      },

      upsertSavedSession: async (args: SavedWorkspaceSession) => {
        const name = args.name?.trim();
        if (
          !name ||
          name.toLowerCase() === 'home' ||
          !args.activeTabGroupId ||
          !(args.voyageEntries?.length)
        ) return;
        savedSessionsState.setState((current) => {
          const sessions = getSavedWorkspaceSessions(current).map((session) => ({
            ...session,
          }));
          const existing = sessions.find((session) => session.id === args.id);
          if (existing) {
            existing.slug = buildVoyageSlug(name, args.id);
            existing.name = name;
            existing.updatedAt = args.updatedAt;
            existing.activeVoyageEntryId = args.activeVoyageEntryId;
            existing.voyageEntries = args.voyageEntries;
            existing.activeSpaceId = args.activeSpaceId;
            existing.activeTabGroupId = args.activeTabGroupId;
            existing.activeItemsByVoyageEntryId = args.activeItemsByVoyageEntryId;
            existing.activeItems = args.activeItems;
            existing.visitedTabGroupIds = args.visitedTabGroupIds;
            return createSavedWorkspaceSessionState(sessions);
          }

          sessions.unshift({ ...args, slug: buildVoyageSlug(name, args.id), name });
          return createSavedWorkspaceSessionState(sessions);
        });
      },
      renameSavedSession: async (args: { id: string; name: string }) => {
        savedSessionsState.setState((current) => {
          const sessions = getSavedWorkspaceSessions(current).map((session) => ({
            ...session,
          }));
          const existing = sessions.find((session) => session.id === args.id);
          const name = args.name.trim();
          if (!existing || !name || name.toLowerCase() === 'home') {
            return createSavedWorkspaceSessionState(sessions);
          }
          existing.name = name;
          existing.slug = buildVoyageSlug(name, args.id);
          existing.updatedAt = new Date().toISOString();
          return createSavedWorkspaceSessionState(sessions);
        });
      },
      deleteSavedSession: async (args: { id: string }) => {
        savedSessionsState.setState((current) =>
          createSavedWorkspaceSessionState(
            getSavedWorkspaceSessions(current).filter(
              (session) => session.id !== args.id,
            ),
          ),
        );
        originSessionResumeState.setStateImmer((draft) => {
          Object.entries(draft.lastSessionByOrigin).forEach(([origin, sessionId]) => {
            if (sessionId === args.id) {
              delete draft.lastSessionByOrigin[origin];
            }
          });
        });
      },
      moveVoyageEntryToSavedSession: async (args: {
        targetSessionId: string;
        voyageEntry: VoyageEntry;
        activeItemId?: string;
      }) => {
        const now = new Date().toISOString();
        const workspace = workspaceState.getState();
        const targetSpaceId =
          workspace.spaces.find((space) =>
            space.tabGroupIds.includes(args.voyageEntry.tabGroupId),
          )?.id || '';
        let updatedSession: SavedWorkspaceSession | undefined;

        savedSessionsState.setState((current) => {
          const sessions = getSavedWorkspaceSessions(current).map((session) => ({
            ...session,
            activeItems: { ...(session.activeItems || {}) },
            activeItemsByVoyageEntryId: {
              ...(session.activeItemsByVoyageEntryId || {}),
            },
            voyageEntries: session.voyageEntries
              ? session.voyageEntries.map((entry) => ({ ...entry, viewIds: [...entry.viewIds] }))
              : undefined,
            visitedTabGroupIds: [...(session.visitedTabGroupIds || [])],
          }));
          const target = sessions.find(
            (session) => session.id === args.targetSessionId,
          );
          if (!target) return createSavedWorkspaceSessionState(sessions);

          const existingEntries = target.voyageEntries || [];
          const existingIds = new Set(existingEntries.map((entry) => entry.id));
          let nextEntryId = args.voyageEntry.id;
          let suffix = 1;
          while (existingIds.has(nextEntryId)) {
            nextEntryId = `${args.voyageEntry.id}_moved_${suffix++}`;
          }

          const nextEntry = {
            ...args.voyageEntry,
            id: nextEntryId,
          };
          const nextEntries = [...existingEntries, nextEntry];
          target.voyageEntries = nextEntries;
          target.activeVoyageEntryId = nextEntry.id;
          target.activeTabGroupId = nextEntry.tabGroupId;
          target.activeSpaceId = targetSpaceId || target.activeSpaceId;
          target.updatedAt = now;
          target.visitedTabGroupIds = Array.from(
            new Set([...(target.visitedTabGroupIds || []), nextEntry.tabGroupId]),
          );
          target.activeItemsByVoyageEntryId = {
            ...(target.activeItemsByVoyageEntryId || {}),
            ...(args.activeItemId ? { [nextEntry.id]: args.activeItemId } : {}),
          };
          target.activeItems = {
            ...(target.activeItems || {}),
            ...(args.activeItemId ? { [nextEntry.tabGroupId]: args.activeItemId } : {}),
          };
          updatedSession = target;
          return createSavedWorkspaceSessionState(sessions);
        });

        return updatedSession;
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

    return {
      states: {
        workspace: workspaceState,
        savedVoyages: savedSessionsState,
        originVoyageResumeState: originSessionResumeState,
      },
      actions,
    };
};

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
