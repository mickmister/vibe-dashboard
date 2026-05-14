import { useState, useEffect, useRef } from "react";
import type { WorkspaceState } from "./types";

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
}

export interface RouteParams {
  spaceId?: string;
  tabGroupId?: string;
  itemId?: string;
}

const SESSION_KEY = "workspace-nav";

/**
 * Load session navigation state.
 * Route params take priority, then sessionStorage, then first available defaults.
 */
function loadSessionNav(
  workspace: WorkspaceState,
  route: RouteParams = {},
): SessionWorkspaceNav {
  // Build initial activeItems map from workspace state
  const activeItems: Record<string, string> = {};
  workspace.tabGroups.forEach((tg) => {
    // Use first tab or pair as default
    const firstItem = tg.tabs[0]?.id || tg.pairs[0]?.id || "";
    activeItems[tg.id] = firstItem;
  });

  const spaceExistsInRoute =
    route.spaceId && workspace.spaces.some((s) => s.id === route.spaceId);

  let activeSpaceId = "";
  let activeTabGroupId = "";

  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<SessionWorkspaceNav>;

      // Use route spaceId if valid, otherwise try sessionStorage
      if (spaceExistsInRoute) {
        activeSpaceId = route.spaceId!;
      } else if (
        parsed.activeSpaceId &&
        workspace.spaces.some((s) => s.id === parsed.activeSpaceId)
      ) {
        activeSpaceId = parsed.activeSpaceId;
      }

      // Resolve tab group: route > sessionStorage
      const space = activeSpaceId
        ? workspace.spaces.find((s) => s.id === activeSpaceId)
        : undefined;
      const routeTabGroupValid =
        route.tabGroupId && space?.tabGroupIds.includes(route.tabGroupId);
      const storedTabGroupValid =
        parsed.activeTabGroupId &&
        workspace.tabGroups.some((tg) => tg.id === parsed.activeTabGroupId);

      if (routeTabGroupValid) {
        activeTabGroupId = route.tabGroupId!;
      } else if (activeSpaceId && storedTabGroupValid) {
        activeTabGroupId = parsed.activeTabGroupId!;
      }

      if (activeSpaceId && activeTabGroupId) {
        // Merge stored activeItems with defaults (in case new tab groups were added)
        const mergedActiveItems = {
          ...activeItems,
          ...(parsed.activeItems || {}),
        };

        // Route itemId overrides stored activeItem for this tab group
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
        };
      }
    }
  } catch {
    // Ignore parse errors
  }

  // Fallback to first space/tab group
  const firstSpace = workspace.spaces[0];
  const firstTabGroup = firstSpace
    ? workspace.tabGroups.find((tg) => firstSpace.tabGroupIds.includes(tg.id))
    : workspace.tabGroups[0];

  activeSpaceId = (spaceExistsInRoute ? route.spaceId : firstSpace?.id) || "";
  activeTabGroupId = firstTabGroup?.id || "";

  return {
    activeSpaceId,
    activeTabGroupId,
    activeItems,
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
) {
  const [nav, setNav] = useState<SessionWorkspaceNav>(() =>
    loadSessionNav(workspace, route),
  );

  // Track previous route params so we only sync when the URL actually changed
  const prevRouteRef = useRef({
    spaceId: route.spaceId,
    tabGroupId: route.tabGroupId,
    itemId: route.itemId,
  });

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

      // Sync spaceId from route
      if (
        route.spaceId &&
        workspace.spaces.some((s) => s.id === route.spaceId) &&
        prev.activeSpaceId !== route.spaceId
      ) {
        const space = workspace.spaces.find((s) => s.id === route.spaceId);
        const firstTabGroupId = space?.tabGroupIds[0] || prev.activeTabGroupId;
        updated = {
          ...updated,
          activeSpaceId: route.spaceId,
          activeTabGroupId: firstTabGroupId,
        };
      }

      // Sync tabGroupId from route
      if (
        route.tabGroupId &&
        workspace.tabGroups.some((tg) => tg.id === route.tabGroupId) &&
        prev.activeTabGroupId !== route.tabGroupId
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
      // Current selection is invalid, reload nav
      const newNav = loadSessionNav(workspace, route);
      setNav(newNav);
    } else if (newTabGroups.length > 0) {
      // Add missing tab groups to activeItems without reloading everything
      setNav((prev) => {
        const updatedActiveItems = { ...prev.activeItems };
        newTabGroups.forEach((tg) => {
          const firstItem = tg.tabs[0]?.id || tg.pairs[0]?.id || "";
          updatedActiveItems[tg.id] = firstItem;
        });
        return { ...prev, activeItems: updatedActiveItems };
      });
    }
  }, [
    workspace.spaces,
    workspace.tabGroups,
    nav.activeSpaceId,
    nav.activeTabGroupId,
    nav.activeItems,
    route,
  ]);

  const selectSpace = (spaceId: string) => {
    const space = workspace.spaces.find((s) => s.id === spaceId);
    if (!space) return;

    // When switching spaces, activate the first tab group in that space
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

  const getActiveItem = (tabGroupId: string): string => {
    return nav.activeItems[tabGroupId] || "";
  };

  const targetPath = buildNavPath(nav);

  return {
    activeSpaceId: nav.activeSpaceId,
    activeTabGroupId: nav.activeTabGroupId,
    activeItems: nav.activeItems,
    targetPath,
    getActiveItem,
    selectSpace,
    selectTab,
    selectPair,
    setActiveTabGroup,
  };
}
