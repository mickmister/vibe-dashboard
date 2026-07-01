import { buildVoyageSlug } from "./lib/voyageUrl";
import {
  createSavedWorkspaceSessionState,
  getSavedWorkspaceSessions,
  isSavedWorkspaceSessionStateMigrated,
  migrateSavedWorkspaceSessionStateWithCleanup,
} from "./lib/savedVoyageState";
import {
  activateVoyageEntryInLayout,
  createVoyageLayoutFromEntries,
  findVoyageEntryInLayout,
  flattenVoyageLayoutEntries,
  normalizeVoyageLayout,
  removeVoyageEntryFromLayout,
  reorderVoyageEntryInLayout,
  upsertVoyageEntryInLayout,
} from "./sessionState";

import springboard, { ModuleAPI } from "springboard";
import { createDefaultWorkspace, getDefaultSpace } from "./types";
import type { ResolvedWorkspaceComposition } from "./modules/plugins/vibe-dashboard/workspace-composition";
import {
  BUILT_IN_AGENT_CODE_PAIR_ID,
  BUILT_IN_AGENT_TAB_ID,
  isEphemeralCraftSurfaceTabId,
  migrateWorkspaceBuiltInTabs,
} from "./modules/plugins/vibe-dashboard/craft-surfaces";
import type {
  WorkspaceState,
  SavedWorkspaceSession,
  SavedWorkspaceSessionState,
  VoyageEntry,
  VoyageCraftSelection,
  VoyageLayout,
} from "./types";

// @platform "browser"
import "./modules/plugins";
import "./modules/MainUIShellModule";
// @platform end

// @platform "node"
import "./modules/WorkflowServerModule";
// @platform end

const WORKSPACE_CREATE_PATH = "/workspaces/create";
const WORKSPACE_CREATE_TAB_TITLE = "Create Workspace";
const URL_PARSE_BASE = "https://workspace.local";
const MOBILE_TAB_EMOJIS = [
  "🚀",
  "🧠",
  "💻",
  "🛠️",
  "📚",
  "🔬",
  "🧪",
  "🎯",
  "🗂️",
  "🌟",
  "⚡",
  "🛰️",
];

function buildWorkspaceTabUrl(baseOrigin: string, path: string): string {
  return baseOrigin ? `${baseOrigin}${path}` : path;
}

function isWorkspaceTabPath(url: string, expectedPath: string): boolean {
  try {
    const parsed = new URL(url, URL_PARSE_BASE);
    return (
      parsed.pathname === expectedPath &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return url === expectedPath;
  }
}

function createDefaultSavedSessionState(): SavedWorkspaceSessionState {
  return createSavedWorkspaceSessionState();
}

function createWorkspaceSessionId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function createVoyageEntryIdForTabGroup(tabGroupId: string): string {
  return `ve_${tabGroupId}`;
}

function getDefaultViewIdsForTabGroup(
  workspace: WorkspaceState,
  tabGroupId: string,
): string[] {
  const tabGroup = workspace.tabGroups.find((entry) => entry.id === tabGroupId);
  if (!tabGroup) return [];
  const firstTabId = tabGroup.tabs[0]?.id;
  if (firstTabId) return [firstTabId];
  if (tabGroup.workspace?.workspaceId) return [BUILT_IN_AGENT_TAB_ID];
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
  if (!tabGroup) return "";
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
  if (viewIds[0] && tabGroup.workspace?.workspaceId) {
    return viewIds[0];
  }
  return tabGroup.tabs[0]?.id || tabGroup.pairs[0]?.id || "";
}

function getSelectedViewIdsForTabGroup(
  workspace: WorkspaceState,
  tabGroupId: string,
  tabId?: string,
): string[] {
  const tabGroup = workspace.tabGroups.find((entry) => entry.id === tabGroupId);
  if (!tabGroup) return [];
  if (tabId && tabGroup.tabs.some((tab) => tab.id === tabId)) return [tabId];
  if (tabId && tabGroup.workspace?.workspaceId) return [tabId];
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
  if (!trimmedName || trimmedName.toLowerCase() === "home") return undefined;

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
    visitedTabGroupIds: [tabGroup.id],
  };
}

function createSavedSessionFromVoyageEntry({
  workspace,
  name,
  voyageEntry,
  activeItemId,
}: {
  workspace: WorkspaceState;
  name: string;
  voyageEntry: VoyageEntry;
  activeItemId?: string;
}): SavedWorkspaceSession | undefined {
  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.toLowerCase() === "home") return undefined;

  const normalizedEntry = normalizeVoyageEntryForWorkspace(
    workspace,
    voyageEntry,
  );
  if (!normalizedEntry?.viewIds.length) return undefined;

  const activeSpaceId =
    workspace.spaces.find((space) =>
      space.tabGroupIds.includes(normalizedEntry.tabGroupId),
    )?.id || "";
  if (!activeSpaceId) return undefined;

  const id = createWorkspaceSessionId();
  const now = new Date().toISOString();
  const resolvedActiveItemId =
    activeItemId ||
    getActiveItemIdForViewIds(
      workspace,
      normalizedEntry.tabGroupId,
      normalizedEntry.viewIds,
    );

  return {
    id,
    slug: buildVoyageSlug(trimmedName, id),
    name: trimmedName,
    createdAt: now,
    updatedAt: now,
    activeVoyageEntryId: normalizedEntry.id,
    voyageEntries: [
      {
        ...normalizedEntry,
        viewIds: [...normalizedEntry.viewIds],
      },
    ],
    activeSpaceId,
    activeTabGroupId: normalizedEntry.tabGroupId,
    activeItemsByVoyageEntryId: {
      [normalizedEntry.id]: resolvedActiveItemId,
    },
    visitedTabGroupIds: [normalizedEntry.tabGroupId],
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

function getSpaceIdForTabGroup(
  workspace: WorkspaceState,
  tabGroupId: string,
): string | undefined {
  return workspace.spaces.find((space) =>
    space.tabGroupIds.includes(tabGroupId),
  )?.id;
}

function getTabPathname(url: string): string | undefined {
  try {
    return new URL(url, URL_PARSE_BASE).pathname;
  } catch {
    return url.startsWith("/") ? url : undefined;
  }
}

function findVKWorkspaceSelection(
  workspace: WorkspaceState,
  taskAttemptId: string,
): VoyageCraftSelection | undefined {
  if (!taskAttemptId) return undefined;
  const expectedPath = `/workspaces/${taskAttemptId}`;

  for (const tabGroup of workspace.tabGroups) {
    const matchesWorkspaceMetadata =
      tabGroup.workspace?.workspaceId === taskAttemptId;
    const agentTab = tabGroup.tabs.find(
      (tab) => getTabPathname(tab.url) === expectedPath,
    );
    if (!(matchesWorkspaceMetadata || agentTab)) continue;

    const spaceId = getSpaceIdForTabGroup(workspace, tabGroup.id);
    if (!spaceId) continue;

    return {
      spaceId,
      tabGroupId: tabGroup.id,
      tabId: agentTab?.id ?? BUILT_IN_AGENT_TAB_ID,
    };
  }

  return undefined;
}

function addVKWorkspaceCraftToWorkspace(
  workspace: WorkspaceState,
  args: {
    taskAttemptId: string;
    name: string;
    containerRef: string;
    activeSpaceId: string;
    composition: ResolvedWorkspaceComposition;
  },
): VoyageCraftSelection | undefined {
  const space = workspace.spaces.find((s) => s.id === args.activeSpaceId);
  if (!space) return undefined;

  const tabGroupId = `tg_${workspace.nextId++}`;

  workspace.tabGroups.push({
    id: tabGroupId,
    label: args.name,
    workspace: {
      workspaceId: args.taskAttemptId,
      workspaceDir: args.containerRef,
    },
    mobileEmoji: pickRandomMobileEmoji(),
    createdAt: new Date().toISOString(),
    tabs: [],
    pairs: [],
    order: space.tabGroupIds.length,
  });

  space.tabGroupIds.push(tabGroupId);

  return {
    spaceId: space.id,
    tabGroupId,
    tabId: BUILT_IN_AGENT_TAB_ID,
  };
}

function cloneSavedSession(
  session: SavedWorkspaceSession,
): SavedWorkspaceSession {
  const voyageLayout = session.voyageLayout ||
    createVoyageLayoutFromEntries(
      { spaces: [], tabGroups: [], nextId: 0 },
      session.voyageEntries,
      session.activeVoyageEntryId,
    );
  return {
    ...session,
    activeItemsByVoyageEntryId: {
      ...session.activeItemsByVoyageEntryId,
    },
    voyageEntries: session.voyageEntries.map((entry) => ({
      ...entry,
      viewIds: [...entry.viewIds],
    })),
    voyageLayout: {
      ...voyageLayout,
      cells: voyageLayout.cells.map((cell) => ({
        ...cell,
        voyageEntries: cell.voyageEntries.map((entry) => ({
          ...entry,
          viewIds: [...entry.viewIds],
        })),
      })),
    },
    visitedTabGroupIds: [...session.visitedTabGroupIds],
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

  const validViewIds = entry.viewIds.filter(
    (viewId) =>
      tabGroup.tabs.some((tab) => tab.id === viewId) ||
      Boolean(tabGroup.workspace?.workspaceId),
  );
  return {
    ...entry,
    viewIds: validViewIds.length
      ? validViewIds
      : getDefaultViewIdsForTabGroup(workspace, entry.tabGroupId),
  };
}

function getNormalizedSavedSessionLayout(
  session: SavedWorkspaceSession,
  workspace: WorkspaceState,
): VoyageLayout {
  return normalizeVoyageLayout(
    workspace,
    session.voyageLayout,
    session.voyageEntries || [],
    session.activeVoyageEntryId,
  );
}

function syncSavedSessionFromLayout(
  session: SavedWorkspaceSession,
  workspace: WorkspaceState,
  layout: VoyageLayout,
  options: { activeVoyageEntryId?: string; updatedAt?: string } = {},
): SavedWorkspaceSession | undefined {
  const normalizedLayout = options.activeVoyageEntryId
    ? activateVoyageEntryInLayout(workspace, layout, options.activeVoyageEntryId)
    : normalizeVoyageLayout(
        workspace,
        layout,
        flattenVoyageLayoutEntries(layout),
        layout.cells.find((cell) => cell.id === layout.activeCellId)?.activeVoyageEntryId ||
          session.activeVoyageEntryId,
      );
  const activeCell =
    normalizedLayout.cells.find((cell) => cell.id === normalizedLayout.activeCellId) ||
    normalizedLayout.cells[0];
  const activeEntry =
    activeCell?.voyageEntries.find((entry) => entry.id === activeCell.activeVoyageEntryId) ||
    activeCell?.voyageEntries[0];
  if (!activeEntry) return undefined;

  const voyageEntries = flattenVoyageLayoutEntries(normalizedLayout);
  const activeItemsByVoyageEntryId: Record<string, string> = {};
  voyageEntries.forEach((entry) => {
    activeItemsByVoyageEntryId[entry.id] = getActiveItemIdForViewIds(
      workspace,
      entry.tabGroupId,
      entry.viewIds,
    );
  });

  return {
    ...session,
    activeVoyageEntryId: activeEntry.id,
    voyageEntries,
    voyageLayout: normalizedLayout,
    activeSpaceId:
      workspace.spaces.find((space) => space.tabGroupIds.includes(activeEntry.tabGroupId))?.id ||
      session.activeSpaceId,
    activeTabGroupId: activeEntry.tabGroupId,
    activeItemsByVoyageEntryId,
    visitedTabGroupIds: Array.from(new Set(voyageEntries.map((entry) => entry.tabGroupId))),
    ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
  };
}

function repairSavedSessionForWorkspace(
  session: SavedWorkspaceSession,
  workspace: WorkspaceState,
): SavedWorkspaceSession | undefined {
  const normalizedLayout = getNormalizedSavedSessionLayout(session, workspace);
  if (!flattenVoyageLayoutEntries(normalizedLayout).length) return undefined;
  return syncSavedSessionFromLayout(session, workspace, normalizedLayout);
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

function pickRandomMobileEmoji() {
  return MOBILE_TAB_EMOJIS[
    Math.floor(Math.random() * MOBILE_TAB_EMOJIS.length)
  ];
}

function isInternalTabUrl(url: string): boolean {
  return url.startsWith("internal://");
}

function canPairTabs(tabUrls: string[]): boolean {
  return tabUrls.every((url) => !isInternalTabUrl(url));
}

declare module "springboard/module_registry/module_registry" {
  interface AllModules {
    workspace: WorkspaceModuleReturnValue;
  }
}

type WorkspaceModuleReturnValue = Awaited<
  ReturnType<typeof createWorkspaceModule>
>;

springboard.registerModule(
  "workspace",
  { rpcMode: "remote" },
  async (moduleAPI): Promise<WorkspaceModuleReturnValue> => {
    return createWorkspaceModule(moduleAPI);
  },
);

const createWorkspaceModule = async (moduleAPI: ModuleAPI) => {
  const workspaceState =
    await moduleAPI.statesAPI.createPersistentState<WorkspaceState>(
      "workspace",
      createDefaultWorkspace(),
    );
  const savedSessionsState =
    await moduleAPI.statesAPI.createPersistentState<SavedWorkspaceSessionState>(
      "workspace-sessions",
      createDefaultSavedSessionState(),
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
      },
    );
    savedSessionsState.setState(migratedSavedSessions.state);
  }

  const repairSavedVoyagesForCurrentWorkspace = () => {
    const repaired = repairSavedSessionsForWorkspace(
      savedSessionsState.getState(),
      workspaceState.getState(),
    );
    savedSessionsState.setState(repaired.state);
  };

  if (moduleAPI.deps.core.isMaestro()) {
    repairSavedVoyagesForCurrentWorkspace();
  }

  const currentWorkspace = workspaceState.getState();
  const builtInMigratedWorkspace =
    migrateWorkspaceBuiltInTabs(currentWorkspace);
  if (builtInMigratedWorkspace !== currentWorkspace) {
    workspaceState.setState(builtInMigratedWorkspace);
  }

  const actions = moduleAPI.createActions({
    addSpace: async (args: { name: string }) => {
      let spaceId: string | undefined;
      let tabGroupId: string | undefined;

      workspaceState.setStateImmer((draft) => {
        spaceId = `space_${draft.nextId++}`;
        tabGroupId = `tg_${draft.nextId++}`;

        draft.tabGroups.push({
          id: tabGroupId,
          label: "Main",
          mobileEmoji: pickRandomMobileEmoji(),
          tabs: [],
          pairs: [],
          order: 0,
          createdAt: new Date().toISOString(),
        });

        draft.spaces.push({
          id: spaceId,
          name: args.name,
          icon: "default",
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
      if (isEphemeralCraftSurfaceTabId(args.tabId)) return;
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
                  label: "Overview",
                  tabs: [
                    {
                      id: `tab_${draft.nextId++}`,
                      title: "Spaces",
                      url: "internal://spaces-overview",
                      pinned: true,
                    },
                  ],
                  pairs: [],
                  order: 0,
                  createdAt: new Date().toISOString(),
                }
              : {
                  id: nextTabGroupId,
                  label: "Main",
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
      if (isEphemeralCraftSurfaceTabId(args.tabId)) return;
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
      let tabId = "";

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
            label: "Main",
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

    createCreateWorkspaceCraft: async (args: {
      baseOrigin: string;
      label?: string;
    }) => {
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
      if (!voyageName || voyageName.toLowerCase() === "home") return undefined;

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
      if (args.tabIds.some(isEphemeralCraftSurfaceTabId)) return undefined;
      let pairId = "";

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
      taskAttemptId?: string;
      workspaceId?: string;
      name: string;
      containerRef: string;
      activeSpaceId: string;
      composition: ResolvedWorkspaceComposition;
    }) => {
      const taskAttemptId = args.taskAttemptId ?? args.workspaceId ?? "";
      let selection: VoyageCraftSelection | undefined;

      workspaceState.setStateImmer((draft) => {
        selection =
          findVKWorkspaceSelection(draft, taskAttemptId) ||
          addVKWorkspaceCraftToWorkspace(draft, {
            taskAttemptId,
            name: args.name,
            containerRef: args.containerRef,
            activeSpaceId: args.activeSpaceId,
            composition: args.composition,
          });
      });

      if (!(selection?.tabGroupId && selection.tabId)) {
        return undefined;
      }

      return {
        tabGroupId: selection.tabGroupId,
        pairId: BUILT_IN_AGENT_CODE_PAIR_ID,
        agentTabId: selection.tabId,
      };
    },

    createSavedSessionForVKWorkspace: async (args: {
      voyageName: string;
      taskAttemptId: string;
      workspaceName: string;
      containerRef: string;
      activeSpaceId: string;
      composition: ResolvedWorkspaceComposition;
    }) => {
      const voyageName = args.voyageName.trim();
      if (!voyageName || voyageName.toLowerCase() === "home") return undefined;

      let selection: VoyageCraftSelection | undefined;
      workspaceState.setStateImmer((draft) => {
        selection =
          findVKWorkspaceSelection(draft, args.taskAttemptId) ||
          addVKWorkspaceCraftToWorkspace(draft, {
            taskAttemptId: args.taskAttemptId,
            name: args.workspaceName,
            containerRef: args.containerRef,
            activeSpaceId: args.activeSpaceId,
            composition: args.composition,
          });
      });
      if (!(selection?.tabGroupId && selection.tabId)) return undefined;

      const savedSession = createSavedSessionFromSelection({
        workspace: workspaceState.getState(),
        name: voyageName,
        spaceId: selection.spaceId,
        tabGroupId: selection.tabGroupId,
        tabId: selection.tabId,
      });
      if (!savedSession) return undefined;

      savedSessionsState.setState((current) => {
        const sessions = getSavedWorkspaceSessions(current).filter(
          (session) => session.id !== savedSession.id,
        );
        sessions.unshift(savedSession);
        return createSavedWorkspaceSessionState(sessions);
      });

      return { savedSession, selection };
    },

    openVKWorkspaceInSavedSession: async (args: {
      sessionId: string;
      taskAttemptId: string;
      name: string;
      containerRef: string;
      activeSpaceId: string;
      composition: ResolvedWorkspaceComposition;
    }) => {
      const existingTarget = getSavedWorkspaceSessions(
        savedSessionsState.getState(),
      ).find((session) => session.id === args.sessionId);
      if (!existingTarget) return undefined;

      let selection: VoyageCraftSelection | undefined;
      workspaceState.setStateImmer((draft) => {
        selection =
          findVKWorkspaceSelection(draft, args.taskAttemptId) ||
          addVKWorkspaceCraftToWorkspace(draft, args);
      });
      if (!(selection?.tabGroupId && selection.tabId)) return undefined;

      const workspace = workspaceState.getState();
      const selectedViewIds = getSelectedViewIdsForTabGroup(
        workspace,
        selection.tabGroupId,
        selection.tabId,
      );
      if (!selectedViewIds.length) return undefined;

      const activeItemId = getActiveItemIdForViewIds(
        workspace,
        selection.tabGroupId,
        selectedViewIds,
      );
      const now = new Date().toISOString();
      let savedSession: SavedWorkspaceSession | undefined;

      savedSessionsState.setState((current) => {
        const sessions =
          getSavedWorkspaceSessions(current).map(cloneSavedSession);
        const target = sessions.find(
          (session) => session.id === args.sessionId,
        );
        if (!target) return createSavedWorkspaceSessionState(sessions);

        const layout = getNormalizedSavedSessionLayout(target, workspace);
        const existingEntry = flattenVoyageLayoutEntries(layout).find(
          (entry) => entry.tabGroupId === selection!.tabGroupId,
        );
        const activeEntry: VoyageEntry = existingEntry
          ? { ...existingEntry, viewIds: selectedViewIds }
          : {
              id: createUniqueVoyageEntryId(
                flattenVoyageLayoutEntries(layout),
                selection!.tabGroupId,
              ),
              tabGroupId: selection!.tabGroupId,
              viewIds: selectedViewIds,
            };
        const nextLayout = upsertVoyageEntryInLayout(workspace, layout, activeEntry, {
          existingEntryId: existingEntry?.id,
          matchTabGroup: true,
        });
        const synced = syncSavedSessionFromLayout(target, workspace, nextLayout, {
          activeVoyageEntryId: activeEntry.id,
          updatedAt: now,
        });
        if (!synced) return createSavedWorkspaceSessionState(sessions);
        Object.assign(target, {
          ...synced,
          activeSpaceId: selection!.spaceId,
          activeItemsByVoyageEntryId: {
            ...synced.activeItemsByVoyageEntryId,
            [activeEntry.id]: activeItemId,
          },
          updatedAt: now,
        });
        savedSession = cloneSavedSession(target);
        return createSavedWorkspaceSessionState(sessions);
      });

      return savedSession ? { savedSession, selection } : undefined;
    },

    updateTabUrl: async (args: {
      tabGroupId: string;
      tabId: string;
      newUrl: string;
    }) => {
      if (isEphemeralCraftSurfaceTabId(args.tabId)) return;
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
      if (isEphemeralCraftSurfaceTabId(args.activeItemId)) return undefined;
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

          dtg.pairs = dtg.pairs.filter((p) => !p.tabIds.includes(activeTab.id));
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

    createSavedSessionFromVoyageEntry: async (args: {
      name: string;
      sourceSessionId?: string;
      voyageEntry: VoyageEntry;
      activeItemId?: string;
    }) => {
      const workspace = workspaceState.getState();
      const targetSession = createSavedSessionFromVoyageEntry({
        workspace,
        name: args.name,
        voyageEntry: args.voyageEntry,
        activeItemId: args.activeItemId,
      });
      if (!targetSession) return undefined;

      let result:
        | {
            sourceSession?: SavedWorkspaceSession;
            targetSession: SavedWorkspaceSession;
          }
        | undefined;

      savedSessionsState.setState((current) => {
        const sessions =
          getSavedWorkspaceSessions(current).map(cloneSavedSession);
        const nextSessions = sessions.filter(
          (session) => session.id !== targetSession.id,
        );
        let sourceSession: SavedWorkspaceSession | undefined;

        if (args.sourceSessionId) {
          const source = nextSessions.find(
            (session) => session.id === args.sourceSessionId,
          );
          if (!source || source.voyageEntries.length <= 1) {
            return createSavedWorkspaceSessionState(sessions);
          }

          const sourceLayout = getNormalizedSavedSessionLayout(source, workspace);
          if (!findVoyageEntryInLayout(sourceLayout, args.voyageEntry.id)) {
            return createSavedWorkspaceSessionState(sessions);
          }
          const repairedSource = syncSavedSessionFromLayout(
            source,
            workspace,
            removeVoyageEntryFromLayout(workspace, sourceLayout, args.voyageEntry.id),
            { updatedAt: targetSession.updatedAt },
          );
          if (!repairedSource)
            return createSavedWorkspaceSessionState(sessions);

          Object.assign(source, repairedSource);
          sourceSession = cloneSavedSession(source);
        }

        nextSessions.unshift(targetSession);
        result = {
          ...(sourceSession ? { sourceSession } : {}),
          targetSession: cloneSavedSession(targetSession),
        };
        return createSavedWorkspaceSessionState(nextSessions);
      });

      return result;
    },

    addSelectionToSavedSession: async (args: {
      sessionId: string;
      spaceId: string;
      tabGroupId: string;
      voyageEntryId?: string;
      tabId?: string;
      viewIds?: string[];
    }) => {
      const workspace = workspaceState.getState();
      const space = workspace.spaces.find(
        (entry) =>
          entry.id === args.spaceId &&
          entry.tabGroupIds.includes(args.tabGroupId),
      );
      const tabGroup = workspace.tabGroups.find(
        (entry) => entry.id === args.tabGroupId,
      );
      if (!(space && tabGroup)) return undefined;

      const selectedViewIds = args.viewIds?.length
        ? normalizeVoyageEntryForWorkspace(workspace, {
            id: createVoyageEntryIdForTabGroup(tabGroup.id),
            tabGroupId: tabGroup.id,
            viewIds: args.viewIds,
          })?.viewIds || []
        : getSelectedViewIdsForTabGroup(workspace, tabGroup.id, args.tabId);
      if (!selectedViewIds.length) return undefined;

      const now = new Date().toISOString();
      let updatedSession: SavedWorkspaceSession | undefined;

      savedSessionsState.setState((current) => {
        const sessions =
          getSavedWorkspaceSessions(current).map(cloneSavedSession);
        const target = sessions.find(
          (session) => session.id === args.sessionId,
        );
        if (!target) return createSavedWorkspaceSessionState(sessions);

        const layout = getNormalizedSavedSessionLayout(target, workspace);
        const existingEntry = args.voyageEntryId
          ? findVoyageEntryInLayout(layout, args.voyageEntryId)?.entry
          : flattenVoyageLayoutEntries(layout).find((entry) => entry.tabGroupId === tabGroup.id);
        if (args.voyageEntryId && existingEntry?.tabGroupId !== tabGroup.id) {
          return createSavedWorkspaceSessionState(sessions);
        }
        const activeEntry: VoyageEntry = existingEntry
          ? { ...existingEntry, viewIds: selectedViewIds }
          : {
              id: createUniqueVoyageEntryId(flattenVoyageLayoutEntries(layout), tabGroup.id),
              tabGroupId: tabGroup.id,
              viewIds: selectedViewIds,
            };
        const nextLayout = upsertVoyageEntryInLayout(workspace, layout, activeEntry, {
          existingEntryId: existingEntry?.id,
          matchTabGroup: !args.voyageEntryId,
        });
        const synced = syncSavedSessionFromLayout(target, workspace, nextLayout, {
          activeVoyageEntryId: activeEntry.id,
          updatedAt: now,
        });
        if (!synced) return createSavedWorkspaceSessionState(sessions);
        Object.assign(target, synced, { activeSpaceId: space.id });
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
        const workspace = workspaceState.getState();
        const sessions =
          getSavedWorkspaceSessions(current).map(cloneSavedSession);
        const target = sessions.find(
          (session) => session.id === args.sessionId,
        );
        if (!target) return createSavedWorkspaceSessionState(sessions);
        const layout = getNormalizedSavedSessionLayout(target, workspace);
        if (!findVoyageEntryInLayout(layout, args.voyageEntryId)) {
          return createSavedWorkspaceSessionState(sessions);
        }
        const synced = syncSavedSessionFromLayout(
          target,
          workspace,
          activateVoyageEntryInLayout(workspace, layout, args.voyageEntryId),
          { activeVoyageEntryId: args.voyageEntryId, updatedAt: new Date().toISOString() },
        );
        if (!synced) return createSavedWorkspaceSessionState(sessions);
        Object.assign(target, synced);
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
        const workspace = workspaceState.getState();
        const sessions =
          getSavedWorkspaceSessions(current).map(cloneSavedSession);
        const target = sessions.find(
          (session) => session.id === args.sessionId,
        );
        if (!target) return createSavedWorkspaceSessionState(sessions);
        const layout = getNormalizedSavedSessionLayout(target, workspace);
        if (!findVoyageEntryInLayout(layout, args.voyageEntryId)) {
          return createSavedWorkspaceSessionState(sessions);
        }
        const nextLayout = removeVoyageEntryFromLayout(workspace, layout, args.voyageEntryId);
        if (findVoyageEntryInLayout(nextLayout, args.voyageEntryId)) {
          return createSavedWorkspaceSessionState(sessions);
        }
        const synced = syncSavedSessionFromLayout(target, workspace, nextLayout, {
          updatedAt: new Date().toISOString(),
        });
        if (!synced) return createSavedWorkspaceSessionState(sessions);
        Object.assign(target, synced);
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
        const workspace = workspaceState.getState();
        const sessions =
          getSavedWorkspaceSessions(current).map(cloneSavedSession);
        const target = sessions.find(
          (session) => session.id === args.sessionId,
        );
        if (!target) return createSavedWorkspaceSessionState(sessions);
        const layout = getNormalizedSavedSessionLayout(target, workspace);
        const source = findVoyageEntryInLayout(layout, args.sourceEntryId);
        const reorderTarget = findVoyageEntryInLayout(layout, args.targetEntryId);
        if (!(source && reorderTarget) || source.cell.id !== reorderTarget.cell.id) {
          return createSavedWorkspaceSessionState(sessions);
        }
        const nextLayout = reorderVoyageEntryInLayout(
          workspace,
          layout,
          args.sourceEntryId,
          args.targetEntryId,
        );
        const synced = syncSavedSessionFromLayout(target, workspace, nextLayout, {
          activeVoyageEntryId: target.activeVoyageEntryId,
          updatedAt: new Date().toISOString(),
        });
        if (!synced) return createSavedWorkspaceSessionState(sessions);
        Object.assign(target, synced);
        updatedSession = target;
        return createSavedWorkspaceSessionState(sessions);
      });
      return updatedSession;
    },

    upsertSavedSession: async (args: SavedWorkspaceSession) => {
      const name = args.name?.trim();
      if (
        !name ||
        name.toLowerCase() === "home" ||
        !args.activeTabGroupId ||
        !args.voyageEntries?.length
      )
        return;
      savedSessionsState.setState((current) => {
        const sessions =
          getSavedWorkspaceSessions(current).map(cloneSavedSession);
        const nextSession = cloneSavedSession({
          ...args,
          slug: buildVoyageSlug(name, args.id),
          name,
        });
        const existing = sessions.find((session) => session.id === args.id);
        if (existing) {
          Object.assign(existing, {
            ...nextSession,
            createdAt: existing.createdAt || nextSession.createdAt,
          });
          return createSavedWorkspaceSessionState(sessions);
        }

        sessions.unshift(nextSession);
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
        if (!existing || !name || name.toLowerCase() === "home") {
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
    },
    moveVoyageEntryBetweenSavedSessions: async (args: {
      sourceSessionId: string;
      targetSessionId: string;
      voyageEntryId: string;
      activeItemId?: string;
    }) => {
      if (args.sourceSessionId === args.targetSessionId) return undefined;

      const now = new Date().toISOString();
      const workspace = workspaceState.getState();
      let moveResult:
        | {
            sourceSession: SavedWorkspaceSession;
            targetSession: SavedWorkspaceSession;
          }
        | undefined;

      savedSessionsState.setState((current) => {
        const sessions =
          getSavedWorkspaceSessions(current).map(cloneSavedSession);
        const source = sessions.find(
          (session) => session.id === args.sourceSessionId,
        );
        const target = sessions.find(
          (session) => session.id === args.targetSessionId,
        );
        if (!(source && target)) {
          return createSavedWorkspaceSessionState(sessions);
        }

        const sourceLayout = getNormalizedSavedSessionLayout(source, workspace);
        const targetLayout = getNormalizedSavedSessionLayout(target, workspace);
        const sourceEntries = flattenVoyageLayoutEntries(sourceLayout);
        if (sourceEntries.length <= 1) {
          return createSavedWorkspaceSessionState(sessions);
        }

        const sourceEntry = findVoyageEntryInLayout(sourceLayout, args.voyageEntryId)?.entry;
        if (!sourceEntry) return createSavedWorkspaceSessionState(sessions);
        if (
          flattenVoyageLayoutEntries(targetLayout).some(
            (entry) => entry.tabGroupId === sourceEntry.tabGroupId,
          )
        ) {
          return createSavedWorkspaceSessionState(sessions);
        }

        const existingTargetIds = new Set(
          flattenVoyageLayoutEntries(targetLayout).map((entry) => entry.id),
        );
        let nextEntryId = sourceEntry.id;
        let suffix = 1;
        while (existingTargetIds.has(nextEntryId)) {
          nextEntryId = `${sourceEntry.id}_moved_${suffix++}`;
        }

        const movedEntry = {
          ...sourceEntry,
          id: nextEntryId,
          viewIds: [...sourceEntry.viewIds],
        };
        const targetSpaceId =
          workspace.spaces.find((space) =>
            space.tabGroupIds.includes(movedEntry.tabGroupId),
          )?.id || target.activeSpaceId;
        const activeItemId =
          args.activeItemId ||
          source.activeItemsByVoyageEntryId[sourceEntry.id] ||
          movedEntry.viewIds[0] ||
          '';

        const nextSourceLayout = removeVoyageEntryFromLayout(
          workspace,
          sourceLayout,
          args.voyageEntryId,
        );
        if (findVoyageEntryInLayout(nextSourceLayout, args.voyageEntryId)) {
          return createSavedWorkspaceSessionState(sessions);
        }
        const repairedSource = syncSavedSessionFromLayout(
          source,
          workspace,
          nextSourceLayout,
          { updatedAt: now },
        );
        if (!repairedSource)
          return createSavedWorkspaceSessionState(sessions);

        Object.assign(source, {
          ...repairedSource,
          updatedAt: now,
        });

        const nextTargetLayout = upsertVoyageEntryInLayout(
          workspace,
          targetLayout,
          movedEntry,
        );
        const repairedTarget = syncSavedSessionFromLayout(
          target,
          workspace,
          nextTargetLayout,
          { activeVoyageEntryId: movedEntry.id, updatedAt: now },
        );
        if (!repairedTarget) return createSavedWorkspaceSessionState(sessions);

        Object.assign(target, {
          ...repairedTarget,
          activeSpaceId: targetSpaceId,
          activeItemsByVoyageEntryId: {
            ...repairedTarget.activeItemsByVoyageEntryId,
            [movedEntry.id]: activeItemId,
          },
          updatedAt: now,
        });

        moveResult = {
          sourceSession: cloneSavedSession(source),
          targetSession: cloneSavedSession(target),
        };
        return createSavedWorkspaceSessionState(sessions);
      });

      return moveResult;
    },
  });

  return {
    states: {
      workspace: workspaceState,
      savedVoyages: savedSessionsState,
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
