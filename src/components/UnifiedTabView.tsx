import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { ChromeTabs } from '../../react-chrome-tabs/src/ChromeTabs';
import type { TabProperties } from '../../react-chrome-tabs/src/chrome-tabs';
import { AddressBar } from './AddressBar';
import { IframePanel } from './IframePanel';
import { TabContextMenu } from './TabContextMenu';
import type { TabGroup, WorkspaceState } from '../types';
import type { WorkspaceActions, SessionActions } from './WorkspaceShell';

interface UnifiedTabViewProps {
  tabGroups: TabGroup[];
  activeTabGroupId: string;
  activeSpaceId: string;
  actions: WorkspaceActions;
  sessionActions: SessionActions;
  onOpenAddTabModal: (tabGroupId: string) => void;
  workspace: WorkspaceState;
}

/**
 * Unified tab view with auto-hiding top bar:
 * - Address bar at the very top
 * - Chrome tabs below address bar
 * - Auto-hide on mouse leave, show on hover at top of page
 * - Pin toggle to keep bar visible
 * - Content adjusts position based on pinned state
 */
export function UnifiedTabView({
  tabGroups,
  activeTabGroupId,
  activeSpaceId,
  actions,
  sessionActions,
  onOpenAddTabModal,
  workspace,
}: UnifiedTabViewProps) {
  const [isPinned, setIsPinned] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    tabId: string;
    position: { x: number; y: number };
  } | null>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const hoverTriggerRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const longPressTabIdRef = useRef<string | null>(null);
  const hoverDelayTimerRef = useRef<NodeJS.Timeout | null>(null);

  const isVisible = isPinned || isHovering;

  // Build visual tabs: group labels + tabs from active group only
  const visualTabs = useMemo(() => {
    const result: (TabProperties & {
      isGroupLabel?: boolean;
      groupId?: string;
      tabCount?: number;
      isPair?: boolean;
      pairId?: string;
    })[] = [];

    tabGroups.forEach((group) => {
      const tabCount = group.tabs.length;
      const pairCount = group.pairs.length;
      const activeItemId = sessionActions.getActiveItem(group.id);
      const isActiveGroup = group.id === activeTabGroupId;

      // Add group label as a special "tab" with count badge
      result.push({
        id: `group-label-${group.id}`,
        title: group.label,
        active: false,
        isGroupLabel: true,
        groupId: group.id,
        tabCount: tabCount + pairCount,
        isCloseIconVisible: false,
        favicon: false,
      });

      // Only show tabs and pairs for the active tab group
      if (isActiveGroup) {
        // Add individual tabs
        group.tabs.forEach((tab) => {
          result.push({
            id: tab.id,
            title: tab.title,
            active: activeItemId === tab.id,
            favicon: false,
            isCloseIconVisible: !tab.pinned,
          });
        });

        // Add pair tabs with special styling
        group.pairs.forEach((pair) => {
          const tabNames = pair.tabIds
            .map((id) => group.tabs.find((t) => t.id === id)?.title)
            .filter(Boolean)
            .join(' | ');

          result.push({
            id: pair.id,
            title: `⊞ ${tabNames}`,
            active: activeItemId === pair.id,
            favicon: false,
            isCloseIconVisible: true,
            isPair: true,
            pairId: pair.id,
          });
        });
      }
    });

    return result;
  }, [tabGroups, activeTabGroupId, sessionActions]);

  const handleTabActive = (tabId: string) => {
    // Check if it's a group label
    if (tabId.startsWith('group-label-')) {
      const groupId = tabId.replace('group-label-', '');
      sessionActions.setActiveTabGroup(groupId);
      return;
    }

    // Find which group this tab belongs to
    for (const group of tabGroups) {
      // Check if it's a regular tab
      if (group.tabs.some((t) => t.id === tabId)) {
        sessionActions.selectTab(group.id, tabId);
        return;
      }

      // Check if it's a pair
      if (group.pairs.some((p) => p.id === tabId)) {
        sessionActions.selectPair(group.id, tabId);
        return;
      }
    }
  };

  const handleTabClose = (tabId: string) => {
    // Ignore if it's a group label
    if (tabId.startsWith('group-label-')) return;

    // Find which group this tab belongs to
    for (const group of tabGroups) {
      // Check if it's a regular tab
      const tab = group.tabs.find((t) => t.id === tabId);
      if (tab && !tab.pinned) {
        actions.closeTab({ tabGroupId: group.id, tabId });
        return;
      }

      // Pairs can be closed by closing one of their tabs
      // For now, just ignore pair close buttons
    }
  };

  const handleContextMenu = (tabId: string, event: MouseEvent) => {
    event.preventDefault();

    // Allow context menu for both tabs and group labels
    setContextMenu({
      tabId,
      position: { x: event.clientX, y: event.clientY },
    });
  };

  const handleCreatePair = (tabIds: string[]) => {
    // Find which group contains the first tab
    for (const group of tabGroups) {
      if (group.tabs.some((t) => t.id === tabIds[0])) {
        actions.createPair({ tabGroupId: group.id, tabIds });
        return;
      }
    }
  };

  const handleSplitPair = (pairId: string) => {
    // Find which group contains this pair and remove it
    for (const group of tabGroups) {
      const pair = group.pairs.find((p) => p.id === pairId);
      if (pair) {
        actions.deletePair({ tabGroupId: group.id, pairId });
        return;
      }
    }
  };

  // Long-press support for mobile
  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      const tabElement = target.closest('[data-tab-id]');

      if (tabElement) {
        const tabId = tabElement.getAttribute('data-tab-id');
        if (tabId) {
          longPressTabIdRef.current = tabId;

          // Start long-press timer (500ms)
          longPressTimerRef.current = setTimeout(() => {
            const touch = e.touches[0];
            if (touch && longPressTabIdRef.current) {
              setContextMenu({
                tabId: longPressTabIdRef.current,
                position: { x: touch.clientX, y: touch.clientY },
              });
            }
          }, 500);
        }
      }
    };

    const handleTouchEnd = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      longPressTabIdRef.current = null;
    };

    const handleTouchMove = () => {
      // Cancel long-press if user moves finger
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };

    document.addEventListener('touchstart', handleTouchStart);
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchmove', handleTouchMove);

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchmove', handleTouchMove);

      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
      if (hoverDelayTimerRef.current) {
        clearTimeout(hoverDelayTimerRef.current);
      }
    };
  }, []);

  const activeTabGroup = tabGroups.find((tg) => tg.id === activeTabGroupId);

  // Calculate top bar height for content offset when pinned
  const topBarHeight = topBarRef.current?.offsetHeight || 0;

  return (
    <div className="flex flex-col flex-1 min-h-0 relative">
      {/* Invisible hover trigger at top of viewport */}
      <div
        ref={hoverTriggerRef}
        className="absolute top-0 left-0 right-0 h-2 z-40"
        onMouseEnter={() => {
          // Start timer to show bar after 0.5s
          hoverDelayTimerRef.current = setTimeout(() => {
            setIsHovering(true);
          }, 500);
        }}
        onMouseLeave={() => {
          // Cancel timer if mouse leaves before delay completes
          if (hoverDelayTimerRef.current) {
            clearTimeout(hoverDelayTimerRef.current);
            hoverDelayTimerRef.current = null;
          }
        }}
      />

      {/* Auto-hiding top bar container */}
      <div
        ref={topBarRef}
        className={`absolute top-0 left-0 right-0 z-50 transition-transform duration-200 ${
          isVisible ? 'translate-y-0' : '-translate-y-full'
        }`}
        onMouseEnter={() => {
          // Clear any pending delay timer
          if (hoverDelayTimerRef.current) {
            clearTimeout(hoverDelayTimerRef.current);
            hoverDelayTimerRef.current = null;
          }
          setIsHovering(true);
        }}
        onMouseLeave={() => setIsHovering(false)}
      >
        {/* Address bar at the very top */}
        {activeTabGroup && (
          <AddressBar
            tabGroup={activeTabGroup}
            activeItemId={sessionActions.getActiveItem(activeTabGroup.id)}
            onNavigate={(tabId, newUrl) =>
              actions.updateTabUrl({
                tabGroupId: activeTabGroup.id,
                tabId,
                newUrl,
              })
            }
          />
        )}

        {/* Chrome tabs below address bar */}
        <div className="bg-neutral-900 border-b border-neutral-800">
          <ChromeTabs
            tabs={visualTabs}
            darkMode={true}
            onTabActive={handleTabActive}
            onTabClose={handleTabClose}
            onContextMenu={handleContextMenu}
            draggable={true}
            pinnedRight={
              <button
                onClick={() => onOpenAddTabModal(activeTabGroupId)}
                className="bg-transparent hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200 px-3 py-1 rounded transition-colors text-lg font-light"
                title="Add new tab"
              >
                +
              </button>
            }
          />
        </div>

        {/* Pin toggle button */}
        <button
          onClick={() => setIsPinned(!isPinned)}
          className="absolute bottom-2 right-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-2 py-1 rounded text-xs transition-colors"
          title={isPinned ? 'Unpin top bar' : 'Pin top bar'}
        >
          {isPinned ? '📌' : '📍'}
        </button>
      </div>

      {/* Content area - adjusts top padding based on pinned state */}
      <div
        className="flex-1 min-h-0 transition-all duration-200"
        style={{
          paddingTop: isPinned ? `${topBarHeight}px` : '0px',
        }}
      >
        {activeTabGroup ? (
          <IframePanel
            tabGroup={activeTabGroup}
            activeItemId={sessionActions.getActiveItem(activeTabGroup.id)}
            onUpdatePairRatios={(pairId, ratios) =>
              actions.updatePairRatios({
                tabGroupId: activeTabGroup.id,
                pairId,
                ratios,
              })
            }
            workspace={workspace}
            onNavigateToTabGroup={(spaceId, tabGroupId) => {
              sessionActions.selectSpace(spaceId);
              sessionActions.setActiveTabGroup(tabGroupId);
            }}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-neutral-500">
            <p>No tab group selected</p>
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (() => {
        // For group labels, find the tab group from the label ID
        const isGroupLabel = contextMenu.tabId.startsWith('group-label-');
        const tabGroup = isGroupLabel
          ? tabGroups.find(tg => `group-label-${tg.id}` === contextMenu.tabId)
          : activeTabGroup;

        if (!tabGroup) return null;

        return (
          <TabContextMenu
            position={contextMenu.position}
            tabId={contextMenu.tabId}
            tabGroup={tabGroup}
            activeItemId={sessionActions.getActiveItem(tabGroup.id)}
            activeSpaceId={activeSpaceId}
            onClose={() => setContextMenu(null)}
            onCreatePair={handleCreatePair}
            onCloseTab={(tabId) =>
              actions.closeTab({ tabGroupId: tabGroup.id, tabId })
            }
            onSplitPair={handleSplitPair}
            onDeleteTabGroup={async (spaceId, tabGroupId) => {
              const result = await actions.deleteTabGroup({ spaceId, tabGroupId });
              if (result?.wasDeleted && result.nextTabGroupId) {
                sessionActions.setActiveTabGroup(result.nextTabGroupId);
              }
            }}
          />
        );
      })()}
    </div>
  );
}
