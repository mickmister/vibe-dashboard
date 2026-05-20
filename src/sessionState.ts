import { useState, useEffect, useRef } from "react";
import type { WorkspaceState, SavedWorkspaceSession } from "./types";

/**
 * Session-level workspace navigation state.
 * All navigation IDs are synced to URL path params for shareable deep links.
 * sessionStorage is used as a fallback when URL params are incomplete.
 */
export interface SessionWorkspaceNav {
  activeSpaceId: string;
  activeTabGroupId: string;
  // Map of tabGroupId -> activeItemId (tab or pair ID)
  activeItems: Record<string, string>;
  // Most recently visited tab groups for this browser session
  visitedTabGroupIds: string[];
}

export interface RouteParams {
  spaceId?: string;
  tabGroupId?: string;
  itemId?: string;
}

const SESSION_KEY = "workspace-nav";
const BROWSER_SESSION_ID_KEY = 'workspace-browser-session-id';

function createBrowserSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createNewBrowserSessionId(): string {
  return createBrowserSessionId();
}

export function getOrCreateBrowserSessionId(): string {
  try {
    const existing = sessionStorage.getItem(BROWSER_SESSION_ID_KEY);
    if (existing) return existing;

    const next = createBrowserSessionId();
    sessionStorage.setItem(BROWSER_SESSION_ID_KEY, next);
    return next;
  } catch {
    return createBrowserSessionId();
  }
}

export function setBrowserSessionId(sessionId: string) {
  try {
    sessionStorage.setItem(BROWSER_SESSION_ID_KEY, sessionId);
  } catch {
    // Ignore storage errors
  }
}

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

  [activeTabGroupId, ...(visitedTabGroupIds || [])].forEach((tabGroupId) => {
    if (!tabGroupId || !validTabGroupIds.has(tabGroupId) || seen.has(tabGroupId)) {
      return;
    }

    seen.add(tabGroupId);
    nextVisited.push(tabGroupId);
  });

  return nextVisited;
}

function createDefaultSessionNav(workspace: WorkspaceState): SessionWorkspaceNav {
  const activeItems: Record<string, string> = {};
  workspace.tabGroups.forEach((tg) => {
    const firstItem = tg.tabs[0]?.id || tg.pairs[0]?.id || "";
    activeItems[tg.id] = firstItem;
  });

  const firstSpace = workspace.spaces[0];
  const firstTabGroup = firstSpace
    ? workspace.tabGroups.find((tg) => firstSpace.tabGroupIds.includes(tg.id))
    : workspace.tabGroups[0];

  const activeSpaceId = firstSpace?.id || "";
  const activeTabGroupId = firstTabGroup?.id || "";

  return {
    activeSpaceId,
    activeTabGroupId,
    activeItems,
    visitedTabGroupIds: getValidVisitedTabGroupIds(
      workspace,
      [],
      activeTabGroupId,
    ),
  };
}

/**
 * Load session navigation state.
 * Route params take priority, then saved session state, then sessionStorage,
 * then first available defaults.
 */
function loadSessionNav(
  workspace: WorkspaceState,
  route: RouteParams = {},
  savedSession?: SavedWorkspaceSession,
): SessionWorkspaceNav {
  // Build initial activeItems map from workspace state
  const activeItems: Record<string, string> = {};
  workspace.tabGroups.forEach((tg) => {
    // Use first tab or pair as default
    const firstItem = tg.tabs[0]?.id || tg.pairs[0]?.id || "";
    activeItems[tg.id] = firstItem;
  });

  const spaceExistsInRoute = Boolean(getSpaceById(workspace, route.spaceId));

  let activeSpaceId = "";
  let activeTabGroupId = "";
  let parsed: Partial<SessionWorkspaceNav> | undefined;

  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    parsed = stored
      ? (JSON.parse(stored) as Partial<SessionWorkspaceNav>)
      : undefined;
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
      const mergedActiveItems = {
        ...activeItems,
        ...(parsed?.activeItems || {}),
        ...(savedSession?.activeItems || {}),
      };

      if (route.itemId && activeTabGroupId) {
        const tg = workspace.tabGroups.find((g) => g.id === activeTabGroupId);
        const itemExists =
          tg &&
          (tg.tabs.some((t) => t.id === route.itemId) ||
            tg.pairs.some((p) => p.id === route.itemId));
        if (itemExists) {
          mergedActiveItems[activeTabGroupId] = route.itemId!;
        }
      }

      return {
        activeSpaceId,
        activeTabGroupId,
        activeItems: mergedActiveItems,
        visitedTabGroupIds: getValidVisitedTabGroupIds(
          workspace,
          savedSession?.visitedTabGroupIds || parsed?.visitedTabGroupIds,
          activeTabGroupId,
        ),
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

  return {
    ...fallbackNav,
    activeSpaceId: fallbackSpaceId,
    activeTabGroupId: fallbackTabGroupId,
    visitedTabGroupIds: getValidVisitedTabGroupIds(
      workspace,
      savedSession?.visitedTabGroupIds || parsed?.visitedTabGroupIds,
      fallbackTabGroupId,
    ),
  };
}

/**
 * Save session navigation state to sessionStorage.
 * activeSpaceId is managed via React Router, not sessionStorage.
 */
function saveSessionNav(nav: SessionWorkspaceNav) {
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        activeSpaceId: nav.activeSpaceId,
        activeTabGroupId: nav.activeTabGroupId,
        activeItems: nav.activeItems,
        visitedTabGroupIds: nav.visitedTabGroupIds,
      }),
    );
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
}

/**
 * Build the canonical URL path for the current nav state.
 */
function buildNavPath(nav: SessionWorkspaceNav): string {
  if (!nav.activeSpaceId) return "/dashboard";
  const activeItem = nav.activeItems[nav.activeTabGroupId] || "";
  let path = `/dashboard/spaces/${nav.activeSpaceId}`;
  if (nav.activeTabGroupId) {
    path += `/${nav.activeTabGroupId}`;
    if (activeItem) {
      path += `/${activeItem}`;
    }
  }
  return path;
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
) {
  const [nav, setNav] = useState<SessionWorkspaceNav>(() =>
    loadSessionNav(workspace, route, savedSession),
  );

  // Track previous route params so we only sync when the URL actually changed
  const prevRouteRef = useRef({
    spaceId: route.spaceId,
    tabGroupId: route.tabGroupId,
    itemId: route.itemId,
  });
  const prevSavedSessionIdRef = useRef<string | undefined>(savedSession?.id);

  useEffect(() => {
    if (savedSession?.id === prevSavedSessionIdRef.current) return;
    prevSavedSessionIdRef.current = savedSession?.id;
    setNav(loadSessionNav(workspace, {}, savedSession));
  }, [savedSession?.id, workspace]);

  // Sync route param changes to nav state (only when route actually changed)
  useEffect(() => {
    const prev = prevRouteRef.current;
    const routeChanged =
      prev.spaceId !== route.spaceId ||
      prev.tabGroupId !== route.tabGroupId ||
      prev.itemId !== route.itemId;

    prevRouteRef.current = {
      spaceId: route.spaceId,
      tabGroupId: route.tabGroupId,
      itemId: route.itemId,
    };

    if (!routeChanged) return;

    setNav((prev) => {
      let updated = prev;
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
        updated = {
          ...updated,
          activeSpaceId: nextSpaceId,
          activeTabGroupId: firstTabGroupId,
        };
      }

      if (
        route.tabGroupId &&
        isTabGroupInSpace(workspace, nextSpaceId, route.tabGroupId) &&
        updated.activeTabGroupId !== route.tabGroupId
      ) {
        updated = { ...updated, activeTabGroupId: route.tabGroupId };
      }

      // Sync itemId from route
      if (route.itemId && route.tabGroupId) {
        const tg = workspace.tabGroups.find((g) => g.id === route.tabGroupId);
        const itemExists =
          tg &&
          (tg.tabs.some((t) => t.id === route.itemId) ||
            tg.pairs.some((p) => p.id === route.itemId));
        if (
          itemExists &&
          prev.activeItems[route.tabGroupId!] !== route.itemId
        ) {
          updated = {
            ...updated,
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
    workspace.spaces,
    workspace.tabGroups,
  ]);

  useEffect(() => {
    setNav((prev) => {
      const nextVisited = getValidVisitedTabGroupIds(
        workspace,
        prev.visitedTabGroupIds,
        prev.activeTabGroupId,
      );

      if (
        nextVisited.length === prev.visitedTabGroupIds.length &&
        nextVisited.every((tabGroupId, index) => tabGroupId === prev.visitedTabGroupIds[index])
      ) {
        return prev;
      }

      return {
        ...prev,
        visitedTabGroupIds: nextVisited,
      };
    });
  }, [workspace, nav.activeTabGroupId]);

  // Sync to sessionStorage whenever nav changes
  useEffect(() => {
    saveSessionNav(nav);
  }, [nav]);

  // Validate nav whenever workspace changes (e.g., space/tab group deleted or added)
  useEffect(() => {
    const spaceExists = workspace.spaces.some(
      (s) => s.id === nav.activeSpaceId,
    );
    const tabGroupExists = workspace.tabGroups.some(
      (tg) => tg.id === nav.activeTabGroupId,
    );

    // Check if there are new tab groups not in activeItems
    const newTabGroups = workspace.tabGroups.filter(
      (tg) => !(tg.id in nav.activeItems),
    );

    if (!spaceExists || !tabGroupExists) {
      const newNav = loadSessionNav(workspace, route, savedSession);
      setNav(newNav);
    } else if (newTabGroups.length > 0) {
      setNav((prev) => {
        const updatedActiveItems = { ...prev.activeItems };
        newTabGroups.forEach((tg) => {
          const firstItem = tg.tabs[0]?.id || tg.pairs[0]?.id || "";
          updatedActiveItems[tg.id] = firstItem;
        });
        return {
          ...prev,
          activeItems: updatedActiveItems,
          visitedTabGroupIds: getValidVisitedTabGroupIds(
            workspace,
            prev.visitedTabGroupIds,
            prev.activeTabGroupId,
          ),
        };
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
      setNav((prev) => ({
        ...prev,
        activeSpaceId: spaceId,
        activeTabGroupId: firstTabGroupId,
      }));
    }
  };

  const selectTab = (tabGroupId: string, tabId: string) => {
    setNav((prev) => ({
      ...prev,
      activeTabGroupId: tabGroupId,
      activeItems: { ...prev.activeItems, [tabGroupId]: tabId },
    }));
  };

  const selectPair = (tabGroupId: string, pairId: string) => {
    setNav((prev) => ({
      ...prev,
      activeTabGroupId: tabGroupId,
      activeItems: { ...prev.activeItems, [tabGroupId]: pairId },
    }));
  };

  const setActiveTabGroup = (tabGroupId: string) => {
    setNav((prev) => ({ ...prev, activeTabGroupId: tabGroupId }));
  };

  const resumeSession = (sessionToResume: SavedWorkspaceSession) => {
    setNav(loadSessionNav(workspace, {}, sessionToResume));
  };

  const startNewSession = () => {
    setNav(createDefaultSessionNav(workspace));
  };

  const getActiveItem = (tabGroupId: string): string => {
    return nav.activeItems[tabGroupId] || "";
  };

  const targetPath = buildNavPath(nav);

  return {
    activeSpaceId: nav.activeSpaceId,
    activeTabGroupId: nav.activeTabGroupId,
    activeItems: nav.activeItems,
    visitedTabGroupIds: nav.visitedTabGroupIds,
    targetPath,
    getActiveItem,
    selectSpace,
    selectTab,
    selectPair,
    setActiveTabGroup,
    resumeSession,
    startNewSession,
  };
}
