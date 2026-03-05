import React, { useEffect, useRef } from 'react';
import type { TabGroup } from '../types';

interface TabContextMenuProps {
  /** Position to show the menu */
  position: { x: number; y: number };
  /** The tab/group label that was right-clicked */
  tabId: string;
  /** The tab group containing the tab (or the group itself for group labels) */
  tabGroup: TabGroup;
  /** The currently active item ID */
  activeItemId: string;
  /** The active space ID (for tab group deletion) */
  activeSpaceId: string;
  /** Called when user wants to close the menu */
  onClose: () => void;
  /** Called when user selects a tab to pair with */
  onCreatePair: (tabIds: string[]) => void;
  /** Called when user wants to close a tab */
  onCloseTab: (tabId: string) => void;
  /** Called when user wants to split a pair */
  onSplitPair?: (pairId: string) => void;
  /** Called when user wants to delete a tab group */
  onDeleteTabGroup?: (spaceId: string, tabGroupId: string) => void;
}

export function TabContextMenu({
  position,
  tabId,
  tabGroup,
  activeItemId,
  activeSpaceId,
  onClose,
  onCreatePair,
  onCloseTab,
  onSplitPair,
  onDeleteTabGroup,
}: TabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Check if this is a group label, pair, or regular tab
  const isGroupLabel = tabId.startsWith('group-label-');
  const isPair = !isGroupLabel && tabGroup.pairs.some((p) => p.id === tabId);
  const tab = !isGroupLabel ? tabGroup.tabs.find((t) => t.id === tabId) : undefined;
  const pair = !isGroupLabel ? tabGroup.pairs.find((p) => p.id === tabId) : undefined;

  // Get other tabs that can be paired with (exclude current tab and tabs already in pairs)
  const tabsInPairs = new Set(tabGroup.pairs.flatMap((p) => p.tabIds));
  const availableTabs = tabGroup.tabs.filter(
    (t) => t.id !== tabId && !tabsInPairs.has(t.id)
  );

  // Adjust menu position to stay within viewport
  const adjustedPosition = { ...position };
  if (menuRef.current) {
    const rect = menuRef.current.getBoundingClientRect();
    if (position.x + rect.width > window.innerWidth) {
      adjustedPosition.x = window.innerWidth - rect.width - 10;
    }
    if (position.y + rect.height > window.innerHeight) {
      adjustedPosition.y = window.innerHeight - rect.height - 10;
    }
  }

  const handlePairWith = (targetTabId: string) => {
    onCreatePair([tabId, targetTabId]);
    onClose();
  };

  const handleCloseTab = () => {
    onCloseTab(tabId);
    onClose();
  };

  const handleSplitPair = () => {
    if (pair && onSplitPair) {
      onSplitPair(pair.id);
      onClose();
    }
  };

  const handleDeleteTabGroup = () => {
    if (onDeleteTabGroup && confirm(`Delete tab group "${tabGroup.label}"? All tabs in this group will be closed.`)) {
      onDeleteTabGroup(activeSpaceId, tabGroup.id);
      onClose();
    }
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] bg-neutral-800 border border-neutral-700 rounded-md shadow-xl py-1 min-w-[200px]"
      style={{
        left: `${adjustedPosition.x}px`,
        top: `${adjustedPosition.y}px`,
      }}
    >
      {/* If it's a group label, show group management options */}
      {isGroupLabel && (
        <>
          {onDeleteTabGroup && (
            <button
              className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-neutral-700 transition-colors"
              onClick={handleDeleteTabGroup}
            >
              Delete Tab Group
            </button>
          )}
        </>
      )}

      {/* If it's a pair, show split option */}
      {isPair && onSplitPair && (
        <>
          <button
            className="w-full text-left px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-700 transition-colors"
            onClick={handleSplitPair}
          >
            Split Pair
          </button>
          <div className="border-t border-neutral-700 my-1" />
        </>
      )}

      {/* If it's a regular tab, show pair options */}
      {!isGroupLabel && !isPair && availableTabs.length > 0 && (
        <>
          <div className="px-4 py-2 text-xs text-neutral-500 uppercase tracking-wider">
            Open with...
          </div>
          {availableTabs.map((t) => (
            <button
              key={t.id}
              className="w-full text-left px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-700 transition-colors"
              onClick={() => handlePairWith(t.id)}
            >
              <span className="text-neutral-500 mr-2">⊞</span>
              {t.title}
            </button>
          ))}
          <div className="border-t border-neutral-700 my-1" />
        </>
      )}

      {/* Close tab option (if not pinned) */}
      {!isGroupLabel && !isPair && tab && !tab.pinned && (
        <button
          className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-neutral-700 transition-colors"
          onClick={handleCloseTab}
        >
          Close Tab
        </button>
      )}

      {/* If no actions available */}
      {!isGroupLabel && !isPair && availableTabs.length === 0 && (!tab || tab.pinned) && (
        <div className="px-4 py-2 text-sm text-neutral-500 italic">
          No actions available
        </div>
      )}
    </div>
  );
}
