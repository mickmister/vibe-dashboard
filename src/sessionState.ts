import { useState, useEffect } from 'react';
import type { WorkspaceState } from './types';

/**
 * Session-level workspace navigation state.
 * activeSpaceId is now managed via React Router path params, not sessionStorage.
 * Other navigation state remains in sessionStorage for per-window independence.
 */
export interface SessionWorkspaceNav {
  activeSpaceId: string;
  activeTabGroupId: string;
  // Map of tabGroupId -> activeItemId (tab or pair ID)
  activeItems: Record<string, string>;
}

const SESSION_KEY = 'workspace-nav';

/**
 * Load session navigation state.
 * activeSpaceId comes from route params, other state from sessionStorage.
 * Falls back to first available space/tab group if stored values are invalid.
 */
function loadSessionNav(workspace: WorkspaceState, routeSpaceId?: string): SessionWorkspaceNav {
  // Build initial activeItems map from workspace state
  const activeItems: Record<string, string> = {};
  workspace.tabGroups.forEach(tg => {
    // Use first tab or pair as default
    const firstItem = tg.tabs[0]?.id || tg.pairs[0]?.id || '';
    activeItems[tg.id] = firstItem;
  });

  // Get spaceId from route params first
  const spaceExistsInRoute = routeSpaceId && workspace.spaces.some(s => s.id === routeSpaceId);

  let activeSpaceId = '';
  let activeTabGroupId = '';

  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<SessionWorkspaceNav>;

      // Use route spaceId if valid, otherwise try sessionStorage
      if (spaceExistsInRoute) {
        activeSpaceId = routeSpaceId!;
      } else if (parsed.activeSpaceId && workspace.spaces.some(s => s.id === parsed.activeSpaceId)) {
        activeSpaceId = parsed.activeSpaceId;
      }

      const tabGroupExists = parsed.activeTabGroupId && workspace.tabGroups.some(tg => tg.id === parsed.activeTabGroupId);

      if (activeSpaceId && tabGroupExists) {
        // Merge stored activeItems with defaults (in case new tab groups were added)
        const mergedActiveItems = { ...activeItems, ...(parsed.activeItems || {}) };

        return {
          activeSpaceId,
          activeTabGroupId: parsed.activeTabGroupId!,
          activeItems: mergedActiveItems,
        };
      }
    }
  } catch {
    // Ignore parse errors
  }

  // Fallback to first space/tab group
  const firstSpace = workspace.spaces[0];
  const firstTabGroup = firstSpace ? workspace.tabGroups.find(tg =>
    firstSpace.tabGroupIds.includes(tg.id)
  ) : workspace.tabGroups[0];

  activeSpaceId = (spaceExistsInRoute ? routeSpaceId : firstSpace?.id) || '';
  activeTabGroupId = firstTabGroup?.id || '';

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
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      activeSpaceId: nav.activeSpaceId,
      activeTabGroupId: nav.activeTabGroupId,
      activeItems: nav.activeItems,
    }));
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
}

/**
 * Hook for managing per-window workspace navigation state.
 * activeSpaceId is synced with React Router params for shareable navigation.
 * Returns current active IDs and setters that persist to sessionStorage.
 */
export function useSessionWorkspaceNav(workspace: WorkspaceState, routeSpaceId?: string) {
  const [nav, setNav] = useState<SessionWorkspaceNav>(() => loadSessionNav(workspace, routeSpaceId));

  // Sync route param changes to nav state
  useEffect(() => {
    if (routeSpaceId && workspace.spaces.some(s => s.id === routeSpaceId)) {
      setNav(prev => {
        if (prev.activeSpaceId !== routeSpaceId) {
          // Find first tab group in the new space
          const space = workspace.spaces.find(s => s.id === routeSpaceId);
          const firstTabGroupId = space?.tabGroupIds[0] || prev.activeTabGroupId;
          return { ...prev, activeSpaceId: routeSpaceId, activeTabGroupId: firstTabGroupId };
        }
        return prev;
      });
    }
  }, [routeSpaceId, workspace.spaces]);

  // Sync to sessionStorage whenever nav changes
  useEffect(() => {
    saveSessionNav(nav);
  }, [nav]);

  // Validate nav whenever workspace changes (e.g., space/tab group deleted or added)
  useEffect(() => {
    const spaceExists = workspace.spaces.some(s => s.id === nav.activeSpaceId);
    const tabGroupExists = workspace.tabGroups.some(tg => tg.id === nav.activeTabGroupId);

    // Check if there are new tab groups not in activeItems
    const newTabGroups = workspace.tabGroups.filter(tg => !(tg.id in nav.activeItems));

    if (!spaceExists || !tabGroupExists) {
      // Current selection is invalid, reload nav
      // Keep the current activeSpaceId when reloading
      const newNav = loadSessionNav(workspace, routeSpaceId);
      setNav(newNav);
    } else if (newTabGroups.length > 0) {
      // Add missing tab groups to activeItems without reloading everything
      setNav(prev => {
        const updatedActiveItems = { ...prev.activeItems };
        newTabGroups.forEach(tg => {
          const firstItem = tg.tabs[0]?.id || tg.pairs[0]?.id || '';
          updatedActiveItems[tg.id] = firstItem;
        });
        return { ...prev, activeItems: updatedActiveItems };
      });
    }
  }, [workspace.spaces, workspace.tabGroups, nav.activeSpaceId, nav.activeTabGroupId, nav.activeItems, routeSpaceId]);

  const selectSpace = (spaceId: string) => {
    const space = workspace.spaces.find(s => s.id === spaceId);
    if (!space) return;

    // When switching spaces, activate the first tab group in that space
    const firstTabGroupId = space.tabGroupIds[0];
    if (firstTabGroupId) {
      setNav(prev => ({ ...prev, activeSpaceId: spaceId, activeTabGroupId: firstTabGroupId }));
    }
  };

  const selectTab = (tabGroupId: string, tabId: string) => {
    setNav(prev => ({
      ...prev,
      activeTabGroupId: tabGroupId,
      activeItems: { ...prev.activeItems, [tabGroupId]: tabId },
    }));
  };

  const selectPair = (tabGroupId: string, pairId: string) => {
    setNav(prev => ({
      ...prev,
      activeTabGroupId: tabGroupId,
      activeItems: { ...prev.activeItems, [tabGroupId]: pairId },
    }));
  };

  const setActiveTabGroup = (tabGroupId: string) => {
    setNav(prev => ({ ...prev, activeTabGroupId: tabGroupId }));
  };

  const getActiveItem = (tabGroupId: string): string => {
    return nav.activeItems[tabGroupId] || '';
  };

  return {
    activeSpaceId: nav.activeSpaceId,
    activeTabGroupId: nav.activeTabGroupId,
    activeItems: nav.activeItems,
    getActiveItem,
    selectSpace,
    selectTab,
    selectPair,
    setActiveTabGroup,
  };
}
