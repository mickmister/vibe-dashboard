import React, { useState } from 'react';
import type { TabGroup } from '../types';
import { getEffectivePairs, getEffectiveTabs } from '../lib/builtInWorkspaceTabs';

interface AddressBarProps {
  tabGroup: TabGroup;
  activeItemId: string;
  onNavigate: (tabId: string, newUrl: string) => void;
}

/**
 * Address bar displaying and editing the URL(s) of the currently active tab(s)
 */
export function AddressBar({ tabGroup, activeItemId, onNavigate }: AddressBarProps) {
  const tabs = getEffectiveTabs(tabGroup);
  const activeTab = tabs.find(
    (t) => t.id === activeItemId
  );
  const activePair = getEffectivePairs(tabGroup).find(
    (p) => p.id === activeItemId
  );

  // Collect tab info to display
  const tabsToShow: { id: string; url: string }[] = [];
  if (activePair) {
    // Show URLs of all tabs in the pair
    const pairTabs = activePair.tabIds
      .map((id) => tabs.find((t) => t.id === id))
      .filter((t) => t !== undefined);
    tabsToShow.push(...pairTabs.map((t) => ({ id: t.id, url: t.url })));
  } else if (activeTab) {
    tabsToShow.push({ id: activeTab.id, url: activeTab.url });
  }

  if (tabsToShow.length === 0) {
    return null; // Don't render address bar if no tab is active
  }

  return (
    <div className="bg-neutral-900 border-b border-neutral-800 px-3 py-1.5 flex items-center gap-2">
      {tabsToShow.map((tab, index) => (
        <AddressBarInput
          key={tab.id}
          tabId={tab.id}
          url={tab.url}
          showSeparator={index > 0}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}

interface AddressBarInputProps {
  tabId: string;
  url: string;
  showSeparator: boolean;
  onNavigate: (tabId: string, newUrl: string) => void;
}

function AddressBarInput({ tabId, url, showSeparator, onNavigate }: AddressBarInputProps) {
  const [editedUrl, setEditedUrl] = useState(url);
  const [isEditing, setIsEditing] = useState(false);

  // Sync with prop when not editing
  React.useEffect(() => {
    if (!isEditing) {
      setEditedUrl(url);
    }
  }, [url, isEditing]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (editedUrl.trim() && editedUrl !== url) {
        onNavigate(tabId, editedUrl.trim());
      }
      setIsEditing(false);
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setEditedUrl(url); // Revert changes
      setIsEditing(false);
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <>
      {showSeparator && (
        <span className="text-neutral-600">|</span>
      )}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-neutral-500 text-xs flex-shrink-0">🌐</span>
        <input
          type="text"
          value={editedUrl}
          onChange={(e) => setEditedUrl(e.target.value)}
          onFocus={() => setIsEditing(true)}
          onBlur={() => {
            setIsEditing(false);
            setEditedUrl(url); // Revert if not submitted via Enter
          }}
          onKeyDown={handleKeyDown}
          className="bg-neutral-800 text-neutral-300 text-xs px-2 py-1 rounded flex-1 min-w-0 border border-neutral-700 focus:outline-none focus:border-primary-500"
          placeholder="Enter URL..."
        />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-neutral-500 hover:text-neutral-300 flex-shrink-0 transition-colors"
          title="Open in new browser tab"
          tabIndex={-1}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </div>
    </>
  );
}
