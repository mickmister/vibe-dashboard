import { useState, useEffect, useRef } from "react";
import { getDefaultSpace, getFirstTabGroupForSpace } from "./types";
import type { WorkspaceState, SavedWorkspaceSession, VoyageEntry } from "./types";

/**
 * Session-level workspace navigation state.
 * All live navigation IDs are derived from URL params or persisted Voyage data
 * during one-time URL canonicalization. Decomposed sessionStorage navigation is
 * intentionally not restored, so it cannot become a second source of truth.
 */
export interface SessionWorkspaceNav {
  activeSpaceId: string;
  activeTabGroupId: string;
  activeVoyageEntryId: string;
  voyageEntries: VoyageEntry[];
  // Map of voyageEntryId -> activeItemId (tab or pair ID). Source of truth for duplicate crafts.
  activeItemsByVoyageEntryId: Record<string, string>;
  // Map of tabGroupId -> activeItemId (tab or pair ID). Compatibility projection for existing UI.
  activeItems: Record<string, string>;
  // Most recently visited tab groups for this browser session
  visitedTabGroupIds: string[];
}

export interface RouteParams {
  spaceId?: string;
  tabGroupId?: string;
  itemId?: string;
  voyageEntryId?: string;
  viewIds?: string[];
}

export type NewSessionInitialSelection = {
  spaceId?: string;
  tabGroupId?: string;
  tabId?: string;
};

function getSpaceById(workspace: WorkspaceState, spaceId: string | undefined) {
  return spaceId ? workspace.spaces.find((s) => s.id === spaceId) : undefined;
}

function isTabGroupInSpace(
  workspace: WorkspaceState,
  spaceId: string | undefined,
  tabGroupId: string | undefined,
): boolean {
  const space = getSpaceById(workspace, spaceId);
  return Boolean(space && tabGroupId && space.tabGroupIds.includes(tabGroupId));
}

function getValidVisitedTabGroupIds(
  workspace: WorkspaceState,
  visitedTabGroupIds: string[] | undefined,
  activeTabGroupId: string,
): string[] {
  const validTabGroupIds = new Set(workspace.tabGroups.map((tg) => tg.id));
  const seen = new Set<string>();
  const nextVisited: string[] = [];

  (visitedTabGroupIds || []).forEach((tabGroupId) => {
    if (!tabGroupId || !validTabGroupIds.has(tabGroupId) || seen.has(tabGroupId)) {
      return;
    }

    seen.add(tabGroupId);
    nextVisited.push(tabGroupId);
  });

  if (
    activeTabGroupId &&
    validTabGroupIds.has(activeTabGroupId) &&
    !seen.has(activeTabGroupId)
  ) {
    nextVisited.push(activeTabGroupId);
  }

  return nextVisited;
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

function getActiveViewIdsForItem(
  workspace: WorkspaceState,
  tabGroupId: string,
  activeItemId: string | undefined,
): string[] {
  const tabGroup = workspace.tabGroups.find((entry) => entry.id === tabGroupId);
  if (!tabGroup) return [];
  if (!activeItemId) {
    return getDefaultViewIdsForTabGroup(workspace, tabGroupId);
  }

  const pair = tabGroup.pairs.find((entry) => entry.id === activeItemId);
  if (pair?.tabIds.length) {
    return [...pair.tabIds];
  }

  if (tabGroup.tabs.some((tab) => tab.id === activeItemId)) {
    return [activeItemId];
  }

  return getDefaultViewIdsForTabGroup(workspace, tabGroupId);
}

function normalizeViewIdsForTabGroup(
  workspace: WorkspaceState,
  tabGroupId: string,
  viewIds: string[] | undefined,
): string[] {
  const tabGroup = workspace.tabGroups.find((entry) => entry.id === tabGroupId);
  if (!tabGroup) return [];

  const validViewIds = (viewIds || []).filter((viewId) =>
    tabGroup.tabs.some((tab) => tab.id === viewId),
  );

  return validViewIds.length
    ? validViewIds
    : getDefaultViewIdsForTabGroup(workspace, tabGroupId);
}

function getActiveItemIdForViewIds(
  workspace: WorkspaceState,
  tabGroupId: string,
  viewIds: string[] | undefined,
): string {
  const tabGroup = workspace.tabGroups.find((entry) => entry.id === tabGroupId);
  if (!tabGroup) return "";
  const normalizedViewIds = (viewIds || []).filter(Boolean);
  if (normalizedViewIds.length > 1) {
    const pair = tabGroup.pairs.find(
      (entry) =>
        entry.tabIds.length === normalizedViewIds.length &&
        entry.tabIds.every((tabId, index) => tabId === normalizedViewIds[index]),
    );
    if (pair) return pair.id;
  }
  if (normalizedViewIds[0] && tabGroup.tabs.some((tab) => tab.id === normalizedViewIds[0])) {
    return normalizedViewIds[0];
  }
  return tabGroup.tabs[0]?.id || tabGroup.pairs[0]?.id || "";
}

function projectActiveItemsFromVoyageEntries(
  workspace: WorkspaceState,
  voyageEntries: VoyageEntry[] | undefined,
  activeItemsByVoyageEntryId: Record<string, string> | undefined,
): Record<string, string> {
  const activeItems: Record<string, string> = {};
  for (const entry of voyageEntries || []) {
    activeItems[entry.tabGroupId] =
      activeItemsByVoyageEntryId?.[entry.id] ||
      getActiveItemIdForViewIds(workspace, entry.tabGroupId, entry.viewIds);
  }
  return activeItems;
}

function createVoyageEntryId(tabGroupId: string, index = 0): string {
  return `ve_${tabGroupId}${index > 0 ? `_${index}` : ''}`;
}

function ensureUniqueVoyageEntryId(existingIds: Set<string>, baseId: string): string {
  if (!existingIds.has(baseId)) return baseId;
  let index = 1;
  let nextId = `${baseId}_${index}`;
  while (existingIds.has(nextId)) {
    index += 1;
    nextId = `${baseId}_${index}`;
  }
  return nextId;
}

function createVoyageEntryForTabGroup(
  workspace: WorkspaceState,
  existingIds: Set<string>,
  tabGroupId: string,
  viewIds?: string[],
): VoyageEntry {
  const entryId = ensureUniqueVoyageEntryId(existingIds, createVoyageEntryId(tabGroupId));
  existingIds.add(entryId);
  return {
    id: entryId,
    tabGroupId,
    viewIds: normalizeViewIdsForTabGroup(workspace, tabGroupId, viewIds),
  };
}

function deriveVoyageEntriesFromLegacyState(
  workspace: WorkspaceState,
  visitedTabGroupIds: string[] | undefined,
  activeItems: Record<string, string> | undefined,
): VoyageEntry[] {
  const validVisited = getValidVisitedTabGroupIds(workspace, visitedTabGroupIds, "");
  const existingIds = new Set<string>();
  return validVisited.map((tabGroupId) =>
    createVoyageEntryForTabGroup(
      workspace,
      existingIds,
      tabGroupId,
      getActiveViewIdsForItem(workspace, tabGroupId, activeItems?.[tabGroupId]),
    ),
  );
}

function getEntryScopedActiveItem(
  entry: VoyageEntry,
  activeItemsByVoyageEntryId?: Record<string, string>,
  activeItems?: Record<string, string>,
): string | undefined {
  return (
    activeItemsByVoyageEntryId?.[entry.id] ||
    activeItems?.[entry.tabGroupId]
  );
}

function getValidVoyageEntries(
  workspace: WorkspaceState,
  voyageEntries: VoyageEntry[] | undefined,
  activeVoyageEntryId: string | undefined,
  fallbackActiveTabGroupId: string,
  activeItems?: Record<string, string>,
  activeItemsByVoyageEntryId?: Record<string, string>,
): { entries: VoyageEntry[]; activeVoyageEntryId: string } {
  const validTabGroupIds = new Set(workspace.tabGroups.map((entry) => entry.id));
  const existingIds = new Set<string>();
  const entries = (voyageEntries || [])
    .filter((entry) => entry && validTabGroupIds.has(entry.tabGroupId))
    .map((entry) => {
      const nextId = ensureUniqueVoyageEntryId(existingIds, entry.id || createVoyageEntryId(entry.tabGroupId));
      existingIds.add(nextId);
      return {
        id: nextId,
        tabGroupId: entry.tabGroupId,
        viewIds: normalizeViewIdsForTabGroup(
          workspace,
          entry.tabGroupId,
          entry.viewIds?.length
            ? entry.viewIds
            : getActiveViewIdsForItem(
                workspace,
                entry.tabGroupId,
                getEntryScopedActiveItem(
                  { ...entry, id: nextId },
                  activeItemsByVoyageEntryId,
                  activeItems,
                ),
              ),
        ),
      };
    });

  if (!entries.length && fallbackActiveTabGroupId) {
    entries.push(
      createVoyageEntryForTabGroup(
        workspace,
        existingIds,
        fallbackActiveTabGroupId,
        getActiveViewIdsForItem(
          workspace,
          fallbackActiveTabGroupId,
          activeItems?.[fallbackActiveTabGroupId],
        ),
      ),
    );
  }

  const resolvedActiveEntryId =
    entries.find((entry) => entry.id === activeVoyageEntryId)?.id ||
    entries.find((entry) => entry.tabGroupId === fallbackActiveTabGroupId)?.id ||
    entries[0]?.id ||
    "";

  return { entries, activeVoyageEntryId: resolvedActiveEntryId };
}

function buildLegacyStateFromVoyageEntries(
  workspace: WorkspaceState,
  voyageEntries: VoyageEntry[],
  activeVoyageEntryId: string,
): Pick<SessionWorkspaceNav, 'activeSpaceId' | 'activeTabGroupId' | 'activeItemsByVoyageEntryId' | 'activeItems' | 'visitedTabGroupIds'> {
  const activeEntry =
    voyageEntries.find((entry) => entry.id === activeVoyageEntryId) ||
    voyageEntries[0];
  const activeTabGroupId = activeEntry?.tabGroupId || "";
  const activeSpaceId =
    workspace.spaces.find((space) => space.tabGroupIds.includes(activeTabGroupId))?.id || "";
  const activeItems: Record<string, string> = {};
  const activeItemsByVoyageEntryId: Record<string, string> = {};
  voyageEntries.forEach((entry) => {
    const activeItemId = getActiveItemIdForViewIds(
      workspace,
      entry.tabGroupId,
      entry.viewIds,
    );
    activeItemsByVoyageEntryId[entry.id] = activeItemId;
    activeItems[entry.tabGroupId] = activeItemId;
  });
  if (activeEntry) {
    const activeItemId = getActiveItemIdForViewIds(
      workspace,
      activeEntry.tabGroupId,
      activeEntry.viewIds,
    );
    activeItemsByVoyageEntryId[activeEntry.id] = activeItemId;
    activeItems[activeEntry.tabGroupId] = activeItemId;
  }
  workspace.tabGroups.forEach((entry) => {
    if (!(entry.id in activeItems)) {
      activeItems[entry.id] = getActiveItemIdForViewIds(
        workspace,
        entry.id,
        getDefaultViewIdsForTabGroup(workspace, entry.id),
      );
    }
  });

  return {
    activeSpaceId,
    activeTabGroupId,
    activeItemsByVoyageEntryId,
    activeItems,
    visitedTabGroupIds: getValidVisitedTabGroupIds(
      workspace,
      voyageEntries.map((entry) => entry.tabGroupId),
      activeTabGroupId,
    ),
  };
}

function buildSessionNavFromVoyageEntries(
  workspace: WorkspaceState,
  voyageEntries: VoyageEntry[],
  activeVoyageEntryId: string,
): SessionWorkspaceNav {
  const legacyState = buildLegacyStateFromVoyageEntries(
    workspace,
    voyageEntries,
    activeVoyageEntryId,
  );
  return {
    ...legacyState,
    activeVoyageEntryId,
    voyageEntries,
  };
}

function createDefaultSessionNav(workspace: WorkspaceState): SessionWorkspaceNav {
  const defaultSpace = getDefaultSpace(workspace);
  const firstTabGroup = defaultSpace
    ? getFirstTabGroupForSpace(workspace, defaultSpace.id)
    : workspace.tabGroups[0];

  const activeTabGroupId = firstTabGroup?.id || "";
  const activeVoyageEntryId = activeTabGroupId
    ? createVoyageEntryId(activeTabGroupId)
    : "";
  const voyageEntries = activeTabGroupId
    ? [
        {
          id: activeVoyageEntryId,
          tabGroupId: activeTabGroupId,
          viewIds: getDefaultViewIdsForTabGroup(workspace, activeTabGroupId),
        },
      ]
    : [];

  return buildSessionNavFromVoyageEntries(
    workspace,
    voyageEntries,
    activeVoyageEntryId,
  );
}

function loadStoredSessionNavFallback(): Partial<SessionWorkspaceNav> | undefined {
  // URL-driven navigation must not restore decomposed active voyage/craft state
  // from sessionStorage. Keep this seam explicit so legacy storage cannot become
  // a second source of truth again.
  return undefined;
}

/**
 * Load session navigation state.
 * Route params take priority, then saved session state, then first available
 * defaults. Legacy decomposed sessionStorage is intentionally ignored.
 */
function loadSessionNav(
  workspace: WorkspaceState,
  route: RouteParams = {},
  savedSession?: SavedWorkspaceSession,
): SessionWorkspaceNav {
  const activeItems: Record<string, string> = {};
  workspace.tabGroups.forEach((tg) => {
    activeItems[tg.id] = getActiveItemIdForViewIds(
      workspace,
      tg.id,
      getDefaultViewIdsForTabGroup(workspace, tg.id),
    );
  });

  const spaceExistsInRoute = Boolean(getSpaceById(workspace, route.spaceId));

  let activeSpaceId = "";
  let activeTabGroupId = "";
  let activeVoyageEntryId = "";
  const parsed = loadStoredSessionNavFallback();

  try {
    const parsedActiveSpaceId = parsed?.activeSpaceId;

    if (spaceExistsInRoute) {
      activeSpaceId = route.spaceId!;
    } else if (
      savedSession?.activeSpaceId &&
      workspace.spaces.some((s) => s.id === savedSession.activeSpaceId)
    ) {
      activeSpaceId = savedSession.activeSpaceId;
    } else if (
      parsedActiveSpaceId &&
      workspace.spaces.some((s) => s.id === parsedActiveSpaceId)
    ) {
      activeSpaceId = parsedActiveSpaceId;
    }

    const routeTabGroupValid = isTabGroupInSpace(
      workspace,
      activeSpaceId,
      route.tabGroupId,
    );
    const savedTabGroupValid =
      isTabGroupInSpace(
        workspace,
        activeSpaceId,
        savedSession?.activeTabGroupId,
      );
    const storedTabGroupValid =
      isTabGroupInSpace(workspace, activeSpaceId, parsed?.activeTabGroupId);

    if (routeTabGroupValid) {
      activeTabGroupId = route.tabGroupId!;
    } else if (savedTabGroupValid) {
      activeTabGroupId = savedSession!.activeTabGroupId;
    } else if (storedTabGroupValid) {
      activeTabGroupId = parsed!.activeTabGroupId!;
    }

    if (!activeTabGroupId && activeSpaceId) {
      const activeSpace = getSpaceById(workspace, activeSpaceId);
      activeTabGroupId = activeSpace?.tabGroupIds[0] || "";
    }

    if (activeSpaceId && activeTabGroupId) {
      const savedActiveItems = projectActiveItemsFromVoyageEntries(
        workspace,
        savedSession?.voyageEntries,
        savedSession?.activeItemsByVoyageEntryId,
      );
      const mergedActiveItems = {
        ...activeItems,
        ...(parsed?.activeItems || {}),
        ...savedActiveItems,
      };
      const mergedEntryActiveItems = {
        ...(parsed?.activeItemsByVoyageEntryId || {}),
        ...(savedSession?.activeItemsByVoyageEntryId || {}),
      };
      const legacyVoyageEntries = deriveVoyageEntriesFromLegacyState(
        workspace,
        savedSession?.visitedTabGroupIds || parsed?.visitedTabGroupIds,
        mergedActiveItems,
      );
      const normalizedVoyageEntries = getValidVoyageEntries(
        workspace,
        savedSession?.voyageEntries || parsed?.voyageEntries || legacyVoyageEntries,
        savedSession?.activeVoyageEntryId || parsed?.activeVoyageEntryId,
        activeTabGroupId,
        mergedActiveItems,
        mergedEntryActiveItems,
      );
      activeVoyageEntryId = normalizedVoyageEntries.activeVoyageEntryId;

      if (routeTabGroupValid) {
        let routeEntry = normalizedVoyageEntries.entries.find(
          (entry) => entry.tabGroupId === activeTabGroupId,
        );
        if (!routeEntry) {
          routeEntry = createVoyageEntryForTabGroup(
            workspace,
            new Set(normalizedVoyageEntries.entries.map((entry) => entry.id)),
            activeTabGroupId,
            route.viewIds?.length
              ? route.viewIds
              : getActiveViewIdsForItem(
                  workspace,
                  activeTabGroupId,
                  route.itemId || mergedActiveItems[activeTabGroupId],
                ),
          );
          normalizedVoyageEntries.entries.push(routeEntry);
        }
        activeVoyageEntryId = routeEntry.id;
      }

      if (route.voyageEntryId && normalizedVoyageEntries.entries.some((entry) => entry.id === route.voyageEntryId)) {
        activeVoyageEntryId = route.voyageEntryId;
      }

      if (route.viewIds?.length && activeVoyageEntryId) {
        const activeEntry = normalizedVoyageEntries.entries.find(
          (entry) => entry.id === activeVoyageEntryId,
        );
        if (activeEntry) {
          activeEntry.viewIds = normalizeViewIdsForTabGroup(
            workspace,
            activeEntry.tabGroupId,
            route.viewIds,
          );
          mergedActiveItems[activeEntry.tabGroupId] = getActiveItemIdForViewIds(
            workspace,
            activeEntry.tabGroupId,
            activeEntry.viewIds,
          );
          mergedEntryActiveItems[activeEntry.id] =
            mergedActiveItems[activeEntry.tabGroupId] || "";
          activeTabGroupId = activeEntry.tabGroupId;
          activeSpaceId =
            getSpaceIdForTabGroup(workspace, activeEntry.tabGroupId) || activeSpaceId;
        }
      } else if (route.itemId && activeTabGroupId) {
        const tg = workspace.tabGroups.find((g) => g.id === activeTabGroupId);
        const itemExists =
          tg &&
          (tg.tabs.some((t) => t.id === route.itemId) ||
            tg.pairs.some((p) => p.id === route.itemId));
        if (itemExists) {
          mergedActiveItems[activeTabGroupId] = route.itemId!;
          const activeEntry = normalizedVoyageEntries.entries.find(
            (entry) => entry.id === activeVoyageEntryId,
          );
          if (activeEntry?.tabGroupId === activeTabGroupId) {
            mergedEntryActiveItems[activeEntry.id] = route.itemId!;
            activeEntry.viewIds = getActiveViewIdsForItem(
              workspace,
              activeTabGroupId,
              route.itemId,
            );
          }
        }
      }

      const nextNav = buildSessionNavFromVoyageEntries(
        workspace,
        normalizedVoyageEntries.entries,
        activeVoyageEntryId,
      );
      return {
        ...nextNav,
        activeSpaceId,
        activeTabGroupId,
        activeItemsByVoyageEntryId: {
          ...nextNav.activeItemsByVoyageEntryId,
          ...mergedEntryActiveItems,
        },
        activeItems: {
          ...nextNav.activeItems,
          ...mergedActiveItems,
        },
      };
    }
  } catch {
    // Ignore parse errors
  }

  const fallbackNav = createDefaultSessionNav(workspace);
  const fallbackSpaceId = spaceExistsInRoute
    ? route.spaceId || fallbackNav.activeSpaceId
    : fallbackNav.activeSpaceId;
  const fallbackSpace = getSpaceById(workspace, fallbackSpaceId);
  const fallbackTabGroupId =
    fallbackSpace?.tabGroupIds[0] || fallbackNav.activeTabGroupId;
  const fallbackEntry =
    fallbackNav.voyageEntries.find((entry) => entry.tabGroupId === fallbackTabGroupId) ||
    fallbackNav.voyageEntries[0];

  return buildSessionNavFromVoyageEntries(
    workspace,
    fallbackNav.voyageEntries,
    fallbackEntry?.id || fallbackNav.activeVoyageEntryId,
  );
}

/**
 * Build the canonical URL path for the current nav state.
 */
function buildNavPath(nav: SessionWorkspaceNav): string {
  return "/dashboard";
}

type PendingNavSelection = {
  activeSpaceId: string;
  activeTabGroupId: string;
  activeItemId?: string;
};

function getSpaceIdForTabGroup(
  workspace: WorkspaceState,
  tabGroupId: string,
): string | undefined {
  return workspace.spaces.find((space) => space.tabGroupIds.includes(tabGroupId))?.id;
}

function getTabGroupById(workspace: WorkspaceState, tabGroupId: string) {
  return workspace.tabGroups.find((tabGroup) => tabGroup.id === tabGroupId);
}

function getSavedSessionNavSignature(savedSession?: SavedWorkspaceSession): string {
  if (!savedSession) return '';
  return JSON.stringify({
    id: savedSession.id,
    activeSpaceId: savedSession.activeSpaceId,
    activeTabGroupId: savedSession.activeTabGroupId,
    activeVoyageEntryId: savedSession.activeVoyageEntryId,
    voyageEntries: savedSession.voyageEntries.map((entry) => ({
      id: entry.id,
      tabGroupId: entry.tabGroupId,
      viewIds: entry.viewIds,
    })),
    activeItemsByVoyageEntryId: savedSession.activeItemsByVoyageEntryId,
    visitedTabGroupIds: savedSession.visitedTabGroupIds,
  });
}

/**
 * Hook for managing per-window workspace navigation state.
 * Navigation IDs are synced with React Router path params for shareable deep links.
 * Returns current active IDs, setters, and the target URL path.
 */
export function useSessionWorkspaceNav(
  workspace: WorkspaceState,
  route: RouteParams = {},
  savedSession?: SavedWorkspaceSession,
  _options: { persistToSessionStorage?: boolean } = {},
) {
  const [nav, setNav] = useState<SessionWorkspaceNav>(() =>
    loadSessionNav(workspace, route, savedSession),
  );

  // Track previous route params so we only sync when the URL actually changed
  const prevRouteRef = useRef({
    spaceId: route.spaceId,
    tabGroupId: route.tabGroupId,
    itemId: route.itemId,
    voyageEntryId: route.voyageEntryId,
    viewIdsKey: route.viewIds?.join(',') || '',
  });
  const savedSessionNavSignature = getSavedSessionNavSignature(savedSession);
  const prevSavedSessionNavSignatureRef = useRef(savedSessionNavSignature);
  const pendingSelectionRef = useRef<PendingNavSelection | null>(null);

  const rebuildNav = (prev: SessionWorkspaceNav, voyageEntries: VoyageEntry[], activeVoyageEntryId: string) => {
    const nextNav = buildSessionNavFromVoyageEntries(
      workspace,
      voyageEntries,
      activeVoyageEntryId,
    );
    return {
      ...prev,
      ...nextNav,
    };
  };

  const ensureVoyageEntryForTabGroup = (
    prev: SessionWorkspaceNav,
    tabGroupId: string,
    viewIds?: string[],
    options: { allowDuplicate?: boolean } = {},
  ): { entries: VoyageEntry[]; activeEntryId: string } => {
    const existingEntry =
      prev.voyageEntries.find(
        (entry) =>
          entry.id === prev.activeVoyageEntryId &&
          entry.tabGroupId === tabGroupId,
      ) ||
      prev.voyageEntries.find((entry) => entry.tabGroupId === tabGroupId);
    if (existingEntry && !options.allowDuplicate) {
      return {
        entries: viewIds
          ? prev.voyageEntries.map((entry) =>
              entry.id === existingEntry.id
                ? {
                    ...entry,
                    viewIds: normalizeViewIdsForTabGroup(workspace, tabGroupId, viewIds),
                  }
                : entry,
            )
          : prev.voyageEntries,
        activeEntryId: existingEntry.id,
      };
    }

    const nextEntry = createVoyageEntryForTabGroup(
      workspace,
      new Set(prev.voyageEntries.map((entry) => entry.id)),
      tabGroupId,
      viewIds,
    );

    return {
      entries: [...prev.voyageEntries, nextEntry],
      activeEntryId: nextEntry.id,
    };
  };

  const setPendingSelection = (selection: PendingNavSelection) => {
    pendingSelectionRef.current = selection;
  };

  useEffect(() => {
    if (savedSessionNavSignature === prevSavedSessionNavSignatureRef.current) return;
    prevSavedSessionNavSignatureRef.current = savedSessionNavSignature;
    setNav(loadSessionNav(workspace, route, savedSession));
  }, [route, savedSession, savedSessionNavSignature, workspace]);

  useEffect(() => {
    const pendingSelection = pendingSelectionRef.current;
    if (!pendingSelection) return;

    const navMatchesPending =
      nav.activeSpaceId === pendingSelection.activeSpaceId &&
      nav.activeTabGroupId === pendingSelection.activeTabGroupId &&
      (
        pendingSelection.activeItemId === undefined ||
        nav.activeItems[pendingSelection.activeTabGroupId] === pendingSelection.activeItemId
      );

    if (!navMatchesPending) {
      pendingSelectionRef.current = null;
      return;
    }

    const routeMatchesPending =
      route.spaceId === pendingSelection.activeSpaceId &&
      route.tabGroupId === pendingSelection.activeTabGroupId &&
      (
        pendingSelection.activeItemId === undefined ||
        route.itemId === pendingSelection.activeItemId
      );

    if (
      routeMatchesPending &&
      isTabGroupInSpace(
        workspace,
        pendingSelection.activeSpaceId,
        pendingSelection.activeTabGroupId,
      )
    ) {
      pendingSelectionRef.current = null;
    }
  }, [
    nav.activeItems,
    nav.activeSpaceId,
    nav.activeTabGroupId,
    route.itemId,
    route.spaceId,
    route.tabGroupId,
    route.voyageEntryId,
    route.viewIds,
    workspace,
  ]);

  // Sync route param changes to nav state (only when route actually changed)
  useEffect(() => {
    const prev = prevRouteRef.current;
    const routeChanged =
      prev.spaceId !== route.spaceId ||
      prev.tabGroupId !== route.tabGroupId ||
      prev.itemId !== route.itemId ||
      prev.voyageEntryId !== route.voyageEntryId ||
      prev.viewIdsKey !== (route.viewIds?.join(',') || '');

    prevRouteRef.current = {
      spaceId: route.spaceId,
      tabGroupId: route.tabGroupId,
      itemId: route.itemId,
      voyageEntryId: route.voyageEntryId,
      viewIdsKey: route.viewIds?.join(',') || '',
    };

    if (!routeChanged) return;

    setNav((prev) => {
      let updated = prev;
      const pendingSelection = pendingSelectionRef.current;
      const shouldDeferRouteSync =
        pendingSelection != null &&
        prev.activeSpaceId === pendingSelection.activeSpaceId &&
        prev.activeTabGroupId === pendingSelection.activeTabGroupId &&
        (
          pendingSelection.activeItemId === undefined ||
          prev.activeItems[pendingSelection.activeTabGroupId] === pendingSelection.activeItemId
        ) &&
        (
          route.spaceId !== pendingSelection.activeSpaceId ||
          route.tabGroupId !== pendingSelection.activeTabGroupId ||
          (
            pendingSelection.activeItemId !== undefined &&
            route.itemId !== pendingSelection.activeItemId
          )
        );

      if (shouldDeferRouteSync) {
        return prev;
      }

      const nextSpaceId =
        route.spaceId && getSpaceById(workspace, route.spaceId)
          ? route.spaceId
          : updated.activeSpaceId;

      if (
        nextSpaceId &&
        prev.activeSpaceId !== nextSpaceId
      ) {
        const space = getSpaceById(workspace, nextSpaceId);
        const routeTabGroupInSpace =
          route.tabGroupId && space?.tabGroupIds.includes(route.tabGroupId)
            ? route.tabGroupId
            : undefined;
        const firstTabGroupId =
          routeTabGroupInSpace || space?.tabGroupIds[0] || prev.activeTabGroupId;
        const next = ensureVoyageEntryForTabGroup(updated, firstTabGroupId);
        updated = rebuildNav(
          {
            ...updated,
            activeSpaceId: nextSpaceId,
            activeTabGroupId: firstTabGroupId,
          },
          next.entries,
          next.activeEntryId,
        );
      }

      if (
        route.tabGroupId &&
        isTabGroupInSpace(workspace, nextSpaceId, route.tabGroupId) &&
        updated.activeTabGroupId !== route.tabGroupId
      ) {
        const next = ensureVoyageEntryForTabGroup(updated, route.tabGroupId);
        updated = rebuildNav(
          { ...updated, activeTabGroupId: route.tabGroupId },
          next.entries,
          next.activeEntryId,
        );
      }

      if (route.voyageEntryId && updated.voyageEntries.some((entry) => entry.id === route.voyageEntryId)) {
        updated = rebuildNav(updated, updated.voyageEntries, route.voyageEntryId);
      }

      // Sync itemId from route
      if (route.viewIds?.length && route.tabGroupId) {
        const next = ensureVoyageEntryForTabGroup(
          updated,
          route.tabGroupId,
          route.viewIds,
        );
        updated = rebuildNav(updated, next.entries, route.voyageEntryId || next.activeEntryId);
      } else if (route.itemId && route.tabGroupId) {
        const tg = workspace.tabGroups.find((g) => g.id === route.tabGroupId);
        const itemExists =
          tg &&
          (tg.tabs.some((t) => t.id === route.itemId) ||
            tg.pairs.some((p) => p.id === route.itemId));
        if (
          itemExists &&
          updated.activeItems[route.tabGroupId!] !== route.itemId
        ) {
          const next = ensureVoyageEntryForTabGroup(
            updated,
            route.tabGroupId,
            getActiveViewIdsForItem(workspace, route.tabGroupId, route.itemId),
          );
          updated = {
            ...rebuildNav(updated, next.entries, next.activeEntryId),
            activeItems: {
              ...updated.activeItems,
              [route.tabGroupId!]: route.itemId,
            },
          };
        }
      }

      return updated === prev ? prev : updated;
    });
  }, [
    route.spaceId,
    route.tabGroupId,
    route.itemId,
    route.voyageEntryId,
    route.viewIds,
    workspace.spaces,
    workspace.tabGroups,
  ]);

  useEffect(() => {
    setNav((prev) => {
      const normalized = getValidVoyageEntries(
        workspace,
        prev.voyageEntries,
        prev.activeVoyageEntryId,
        prev.activeTabGroupId,
        prev.activeItems,
      );
      if (
        normalized.activeVoyageEntryId === prev.activeVoyageEntryId &&
        normalized.entries.length === prev.voyageEntries.length &&
        normalized.entries.every((entry, index) => {
          const current = prev.voyageEntries[index];
          return (
            current &&
            current.id === entry.id &&
            current.tabGroupId === entry.tabGroupId &&
            current.viewIds.length === entry.viewIds.length &&
            current.viewIds.every((viewId, viewIndex) => viewId === entry.viewIds[viewIndex])
          );
        })
      ) {
        return prev;
      }
      return rebuildNav(prev, normalized.entries, normalized.activeVoyageEntryId);
    });
  }, [workspace, nav.activeTabGroupId, nav.activeVoyageEntryId, nav.voyageEntries]);

  // Validate nav whenever workspace changes (e.g., space/tab group deleted or added)
  useEffect(() => {
    const spaceExists = workspace.spaces.some(
      (s) => s.id === nav.activeSpaceId,
    );
    const tabGroupExists = workspace.tabGroups.some(
      (tg) => tg.id === nav.activeTabGroupId,
    );
    const pendingSelection = pendingSelectionRef.current;
    const isHoldingPendingSelection =
      pendingSelection != null &&
      nav.activeSpaceId === pendingSelection.activeSpaceId &&
      nav.activeTabGroupId === pendingSelection.activeTabGroupId &&
      (
        pendingSelection.activeItemId === undefined ||
        nav.activeItems[pendingSelection.activeTabGroupId] === pendingSelection.activeItemId
      );

    const newTabGroups = workspace.tabGroups.filter((tg) => !(tg.id in nav.activeItems));

    if (!spaceExists) {
      const newNav = loadSessionNav(workspace, route, savedSession);
      setNav(newNav);
    } else if (!tabGroupExists) {
      if (isHoldingPendingSelection) {
        return;
      }

      const newNav = loadSessionNav(workspace, route, savedSession);
      setNav(newNav);
    } else if (newTabGroups.length > 0) {
      setNav((prev) => {
        const updatedActiveItems = { ...prev.activeItems };
        newTabGroups.forEach((tg) => {
          updatedActiveItems[tg.id] = getActiveItemIdForViewIds(
            workspace,
            tg.id,
            getDefaultViewIdsForTabGroup(workspace, tg.id),
          );
        });
        return rebuildNav(
          { ...prev, activeItems: updatedActiveItems },
          prev.voyageEntries,
          prev.activeVoyageEntryId,
        );
      });
    }
  }, [
    workspace.spaces,
    workspace.tabGroups,
    nav.activeSpaceId,
    nav.activeTabGroupId,
    nav.activeItems,
    nav.visitedTabGroupIds,
    route,
    savedSession,
    workspace,
  ]);

  const selectSpace = (spaceId: string) => {
    const space = workspace.spaces.find((s) => s.id === spaceId);
    if (!space) return;

    const firstTabGroupId = space.tabGroupIds[0];
    if (firstTabGroupId) {
      setPendingSelection({
        activeSpaceId: spaceId,
        activeTabGroupId: firstTabGroupId,
      });
      setNav((prev) => {
        const next = ensureVoyageEntryForTabGroup(prev, firstTabGroupId);
        return rebuildNav(prev, next.entries, next.activeEntryId);
      });
    }
  };

  const selectSessionTabGroup = (spaceId: string, tabGroupId: string) => {
    if (!isTabGroupInSpace(workspace, spaceId, tabGroupId)) {
      return;
    }

    setPendingSelection({
      activeSpaceId: spaceId,
      activeTabGroupId: tabGroupId,
    });
    setNav((prev) => {
      const next = ensureVoyageEntryForTabGroup(prev, tabGroupId);
      return rebuildNav(prev, next.entries, next.activeEntryId);
    });
  };

  const selectSessionTab = (
    spaceId: string,
    tabGroupId: string,
    tabId: string,
  ) => {
    const tabGroup = getTabGroupById(workspace, tabGroupId);
    if (
      !isTabGroupInSpace(workspace, spaceId, tabGroupId) ||
      !tabGroup?.tabs.some((tab) => tab.id === tabId)
    ) {
      return;
    }

    setPendingSelection({
      activeSpaceId: spaceId,
      activeTabGroupId: tabGroupId,
      activeItemId: tabId,
    });
    setNav((prev) => {
      const next = ensureVoyageEntryForTabGroup(prev, tabGroupId, [tabId]);
      return rebuildNav(
        { ...prev, activeItems: { ...prev.activeItems, [tabGroupId]: tabId } },
        next.entries,
        next.activeEntryId,
      );
    });
  };

  const selectSessionPair = (
    spaceId: string,
    tabGroupId: string,
    pairId: string,
  ) => {
    const tabGroup = getTabGroupById(workspace, tabGroupId);
    if (
      !isTabGroupInSpace(workspace, spaceId, tabGroupId) ||
      !tabGroup?.pairs.some((pair) => pair.id === pairId)
    ) {
      return;
    }

    setPendingSelection({
      activeSpaceId: spaceId,
      activeTabGroupId: tabGroupId,
      activeItemId: pairId,
    });
    setNav((prev) => {
      const pair = tabGroup.pairs.find((entry) => entry.id === pairId);
      const next = ensureVoyageEntryForTabGroup(
        prev,
        tabGroupId,
        pair ? [...pair.tabIds] : undefined,
      );
      return rebuildNav(
        { ...prev, activeItems: { ...prev.activeItems, [tabGroupId]: pairId } },
        next.entries,
        next.activeEntryId,
      );
    });
  };

  const selectTab = (tabGroupId: string, tabId: string) => {
    const activeSpaceId =
      getSpaceIdForTabGroup(workspace, tabGroupId) || nav.activeSpaceId;
    selectSessionTab(activeSpaceId, tabGroupId, tabId);
  };

  const selectPair = (tabGroupId: string, pairId: string) => {
    const activeSpaceId =
      getSpaceIdForTabGroup(workspace, tabGroupId) || nav.activeSpaceId;
    selectSessionPair(activeSpaceId, tabGroupId, pairId);
  };

  const setActiveTabGroup = (tabGroupId: string) => {
    const activeSpaceId =
      getSpaceIdForTabGroup(workspace, tabGroupId) || nav.activeSpaceId;
    setPendingSelection({
      activeSpaceId,
      activeTabGroupId: tabGroupId,
    });
    setNav((prev) => {
      const next = ensureVoyageEntryForTabGroup(prev, tabGroupId);
      return rebuildNav(prev, next.entries, next.activeEntryId);
    });
  };

  const resumeSession = (
    sessionToResume: SavedWorkspaceSession,
    voyageEntryId?: string,
  ) => {
    const loadedNav = loadSessionNav(workspace, {}, sessionToResume);
    const nextNav =
      voyageEntryId &&
      loadedNav.voyageEntries.some((entry) => entry.id === voyageEntryId)
        ? rebuildNav(loadedNav, loadedNav.voyageEntries, voyageEntryId)
        : loadedNav;
    setPendingSelection({
      activeSpaceId: nextNav.activeSpaceId,
      activeTabGroupId: nextNav.activeTabGroupId,
      activeItemId: nextNav.activeItems[nextNav.activeTabGroupId] || undefined,
    });
    setNav(nextNav);
  };

  const startNewSession = (initialSelection?: NewSessionInitialSelection) => {
    const initialTabGroup = initialSelection?.tabGroupId
      ? getTabGroupById(workspace, initialSelection.tabGroupId)
      : undefined;
    const initialSpaceId =
      (initialSelection?.tabGroupId
        ? getSpaceIdForTabGroup(workspace, initialSelection.tabGroupId)
        : undefined) ||
      initialSelection?.spaceId;
    const initialTabExists =
      initialTabGroup &&
      initialSelection?.tabId &&
      initialTabGroup.tabs.some((tab) => tab.id === initialSelection.tabId);
    const initialViewIds = initialTabExists
      ? [initialSelection!.tabId!]
      : initialSelection?.tabGroupId
        ? getDefaultViewIdsForTabGroup(workspace, initialSelection.tabGroupId)
        : undefined;
    const initialEntryId = initialSelection?.tabGroupId
      ? createVoyageEntryId(initialSelection.tabGroupId)
      : '';
    const nextNav = initialSelection?.tabGroupId && initialSpaceId
      ? {
          ...buildSessionNavFromVoyageEntries(
            workspace,
            [
              {
                id: initialEntryId,
                tabGroupId: initialSelection.tabGroupId,
                viewIds: initialViewIds || [],
              },
            ],
            initialEntryId,
          ),
          activeSpaceId: initialSpaceId,
          activeTabGroupId: initialSelection.tabGroupId,
        }
      : createDefaultSessionNav(workspace);
    setPendingSelection({
      activeSpaceId: nextNav.activeSpaceId,
      activeTabGroupId: nextNav.activeTabGroupId,
      activeItemId: nextNav.activeItems[nextNav.activeTabGroupId] || undefined,
    });
    setNav(nextNav);
  };

  const getActiveItem = (tabGroupId: string): string => {
    const activeEntry = nav.voyageEntries.find(
      (candidate) =>
        candidate.id === nav.activeVoyageEntryId &&
        candidate.tabGroupId === tabGroupId,
    );
    if (activeEntry) {
      return nav.activeItemsByVoyageEntryId[activeEntry.id] || "";
    }
    return nav.activeItems[tabGroupId] || "";
  };

  const getActiveViewIds = (tabGroupId: string): string[] => {
    const entry =
      nav.voyageEntries.find(
        (candidate) =>
          candidate.id === nav.activeVoyageEntryId &&
          candidate.tabGroupId === tabGroupId,
      ) ||
      nav.voyageEntries.find((candidate) => candidate.tabGroupId === tabGroupId);
    return entry?.viewIds || [];
  };

  const selectVoyageEntry = (voyageEntryId: string) => {
    const entry = nav.voyageEntries.find((candidate) => candidate.id === voyageEntryId);
    if (!entry) return;

    const activeSpaceId =
      getSpaceIdForTabGroup(workspace, entry.tabGroupId) || nav.activeSpaceId;
    setPendingSelection({
      activeSpaceId,
      activeTabGroupId: entry.tabGroupId,
      activeItemId: getActiveItemIdForViewIds(workspace, entry.tabGroupId, entry.viewIds),
    });
    setNav((prev) =>
      prev.voyageEntries.some((candidate) => candidate.id === voyageEntryId)
        ? rebuildNav(prev, prev.voyageEntries, voyageEntryId)
        : prev,
    );
  };

  const addTabGroupToSession = (
    tabGroupId: string,
    options: { allowDuplicate?: boolean; select?: boolean } = {},
  ) => {
    setNav((prev) => {
      if (
        !workspace.tabGroups.some((tabGroup) => tabGroup.id === tabGroupId) ||
        (!options.allowDuplicate && prev.voyageEntries.some((entry) => entry.tabGroupId === tabGroupId))
      ) {
        return prev;
      }
      const next = ensureVoyageEntryForTabGroup(prev, tabGroupId, undefined, {
        allowDuplicate: options.allowDuplicate,
      });
      const activeEntryId = options.select ? next.activeEntryId : prev.activeVoyageEntryId;
      return rebuildNav(prev, next.entries, activeEntryId);
    });
  };

  const removeVoyageEntryFromSession = (voyageEntryId: string) => {
    let pendingSelection: PendingNavSelection | null = null;

    setNav((prev) => {
      const entryToRemove = prev.voyageEntries.find((entry) => entry.id === voyageEntryId);
      const nextEntries = prev.voyageEntries.filter((entry) => entry.id !== voyageEntryId);
      if (!entryToRemove || nextEntries.length === prev.voyageEntries.length) {
        return prev;
      }

      if (voyageEntryId !== prev.activeVoyageEntryId) {
        return rebuildNav(prev, nextEntries, prev.activeVoyageEntryId);
      }

      const currentIndex = prev.voyageEntries.findIndex((entry) => entry.id === voyageEntryId);
      const fallbackEntry =
        (currentIndex > 0 ? prev.voyageEntries[currentIndex - 1] : undefined) ||
        prev.voyageEntries[currentIndex + 1] ||
        nextEntries[0];

      if (!fallbackEntry) {
        return prev;
      }
      const nextNav = rebuildNav(prev, nextEntries, fallbackEntry.id);

      pendingSelection = {
        activeSpaceId: nextNav.activeSpaceId,
        activeTabGroupId: nextNav.activeTabGroupId,
        activeItemId: nextNav.activeItems[nextNav.activeTabGroupId] || undefined,
      };

      return nextNav;
    });

    if (pendingSelection) {
      setPendingSelection(pendingSelection);
    }
  };

  const removeTabGroupFromSession = (tabGroupId: string) => {
    let pendingSelection: PendingNavSelection | null = null;

    setNav((prev) => {
      const nextEntries = prev.voyageEntries.filter((entry) => entry.tabGroupId !== tabGroupId);
      if (nextEntries.length === prev.voyageEntries.length) {
        return prev;
      }

      if (tabGroupId !== prev.activeTabGroupId) {
        return rebuildNav(prev, nextEntries, prev.activeVoyageEntryId);
      }

      const currentIndex = prev.voyageEntries.findIndex((entry) => entry.tabGroupId === tabGroupId);
      const fallbackEntry =
        (currentIndex > 0 ? prev.voyageEntries[currentIndex - 1] : undefined) ||
        prev.voyageEntries[currentIndex + 1] ||
        nextEntries[0];

      if (!fallbackEntry) {
        return prev;
      }
      const nextNav = rebuildNav(prev, nextEntries, fallbackEntry.id);

      pendingSelection = {
        activeSpaceId: nextNav.activeSpaceId,
        activeTabGroupId: nextNav.activeTabGroupId,
        activeItemId: nextNav.activeItems[nextNav.activeTabGroupId] || undefined,
      };

      return nextNav;
    });

    if (pendingSelection) {
      setPendingSelection(pendingSelection);
    }
  };

  const reorderVoyageEntries = (sourceEntryId: string, targetEntryId: string) => {
    setNav((prev) => {
      const sourceIndex = prev.voyageEntries.findIndex((entry) => entry.id === sourceEntryId);
      const targetIndex = prev.voyageEntries.findIndex((entry) => entry.id === targetEntryId);

      if (
        sourceIndex === -1 ||
        targetIndex === -1 ||
        sourceIndex === targetIndex
      ) {
        return prev;
      }

      const nextEntries = [...prev.voyageEntries];
      const [moved] = nextEntries.splice(sourceIndex, 1);
      if (!moved) return prev;
      nextEntries.splice(targetIndex, 0, moved);
      return rebuildNav(prev, nextEntries, prev.activeVoyageEntryId);
    });
  };

  const reorderSessionTabGroups = (sourceId: string, targetId: string) => {
    setNav((prev) => {
      const sourceIndex = prev.voyageEntries.findIndex((entry) => entry.tabGroupId === sourceId);
      const targetIndex = prev.voyageEntries.findIndex((entry) => entry.tabGroupId === targetId);

      if (
        sourceIndex === -1 ||
        targetIndex === -1 ||
        sourceIndex === targetIndex
      ) {
        return prev;
      }

      const nextEntries = [...prev.voyageEntries];
      const [moved] = nextEntries.splice(sourceIndex, 1);
      if (!moved) return prev;
      nextEntries.splice(targetIndex, 0, moved);
      return rebuildNav(prev, nextEntries, prev.activeVoyageEntryId);
    });
  };

  const targetPath = buildNavPath(nav);

  return {
    activeSpaceId: nav.activeSpaceId,
    activeTabGroupId: nav.activeTabGroupId,
    activeVoyageEntryId: nav.activeVoyageEntryId,
    voyageEntries: nav.voyageEntries,
    activeItemsByVoyageEntryId: nav.activeItemsByVoyageEntryId,
    activeItems: nav.activeItems,
    visitedTabGroupIds: nav.visitedTabGroupIds,
    targetPath,
    getActiveItem,
    getActiveViewIds,
    selectVoyageEntry,
    selectSpace,
    selectSessionTabGroup,
    selectSessionTab,
    selectSessionPair,
    selectTab,
    selectPair,
    setActiveTabGroup,
    resumeSession,
    startNewSession,
    addTabGroupToSession,
    removeVoyageEntryFromSession,
    removeTabGroupFromSession,
    reorderVoyageEntries,
    reorderSessionTabGroups,
  };
}
