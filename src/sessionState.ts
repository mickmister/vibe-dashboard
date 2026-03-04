import { useState, useEffect } from 'react';
import type { WorkspaceState } from './types';

/**
 * Session-level workspace navigation state.
 * activeSpaceId is now managed via URL hash params, not sessionStorage.
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
 * Extract spaceId from URL hash (e.g., #/space_1 or #space_1)
 */
function getSpaceIdFromUrl(): string | null {
  const hash = window.location.hash;
  if (!hash) return null;

  // Handle both #/space_1 and #space_1 formats
  const match = hash.match(/^#\/?(.+)$/);
  return match ? match[1] : null;
}

/**
 * Update URL hash with spaceId
 */
function setSpaceIdInUrl(spaceId: string) {
  window.location.hash = `#/${spaceId}`;
}

/**
 * Load session navigation state.
 * activeSpaceId comes from URL hash, other state from sessionStorage.
 * Falls back to first available space/tab group if stored values are invalid.
 */
function loadSessionNav(workspace: WorkspaceState): SessionWorkspaceNav {
  // Build initial activeItems map from workspace state
  const activeItems: Record<string, string> = {};
  workspace.tabGroups.forEach(tg => {
    // Use first tab or pair as default
    const firstItem = tg.tabs[0]?.id || tg.pairs[0]?.id || '';
    activeItems[tg.id] = firstItem;
  });

  // Get spaceId from URL hash first
  const urlSpaceId = getSpaceIdFromUrl();
  const spaceExistsInUrl = urlSpaceId && workspace.spaces.some(s => s.id === urlSpaceId);

  let activeSpaceId = '';
  let activeTabGroupId = '';

  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<SessionWorkspaceNav>;

      // Use URL spaceId if valid, otherwise try sessionStorage
      if (spaceExistsInUrl) {
        activeSpaceId = urlSpaceId!;
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

  activeSpaceId = (spaceExistsInUrl ? urlSpaceId : firstSpace?.id) || '';
  activeTabGroupId = firstTabGroup?.id || '';

  return {
    activeSpaceId,
    activeTabGroupId,
    activeItems,
  };
}

/**
 * Save session navigation state to sessionStorage and URL.
 * activeSpaceId is saved to URL hash, other state to sessionStorage.
 */
function saveSessionNav(nav: SessionWorkspaceNav) {
  try {
    // Save spaceId to URL hash
    setSpaceIdInUrl(nav.activeSpaceId);

    // Save other nav state to sessionStorage
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
 * activeSpaceId is synced with URL hash for shareable navigation.
 * Returns current active IDs and setters that persist to URL and sessionStorage.
 */
export function useSessionWorkspaceNav(workspace: WorkspaceState) {
  const [nav, setNav] = useState<SessionWorkspaceNav>(() => loadSessionNav(workspace));

  // Sync to URL and sessionStorage whenever nav changes
  useEffect(() => {
    saveSessionNav(nav);
  }, [nav]);

  // Listen to hashchange for browser back/forward navigation
  useEffect(() => {
    const handleHashChange = () => {
      const urlSpaceId = getSpaceIdFromUrl();
      if (urlSpaceId && workspace.spaces.some(s => s.id === urlSpaceId)) {
        // Only update if spaceId changed and is valid
        setNav(prev => {
          if (prev.activeSpaceId !== urlSpaceId) {
            // Find first tab group in the new space
            const space = workspace.spaces.find(s => s.id === urlSpaceId);
            const firstTabGroupId = space?.tabGroupIds[0] || prev.activeTabGroupId;
            return { ...prev, activeSpaceId: urlSpaceId, activeTabGroupId: firstTabGroupId };
          }
          return prev;
        });
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [workspace.spaces]);

  // Validate nav whenever workspace changes (e.g., space/tab group deleted or added)
  useEffect(() => {
    const spaceExists = workspace.spaces.some(s => s.id === nav.activeSpaceId);
    const tabGroupExists = workspace.tabGroups.some(tg => tg.id === nav.activeTabGroupId);

    // Check if there are new tab groups not in activeItems
    const hasNewTabGroups = workspace.tabGroups.some(tg => !(tg.id in nav.activeItems));

    if (!spaceExists || !tabGroupExists || hasNewTabGroups) {
      // Current selection is invalid or workspace has new tab groups, reload
      const newNav = loadSessionNav(workspace);
      setNav(newNav);
    }
  }, [workspace.spaces, workspace.tabGroups, nav.activeSpaceId, nav.activeTabGroupId, nav.activeItems]);

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
