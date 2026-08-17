import React, { useState } from 'react';
import {
  isBuiltInWorkspaceTabId,
  isEphemeralCraftSurfaceTab,
} from '../modules/plugins/vibe-dashboard/craft-surfaces';
import type { Tab, TabGroup } from '../types';

interface AddressBarProps {
  tabGroup: TabGroup;
  activeItemId: string;
  onNavigate: (tabId: string, newUrl: string) => void;
}

/**
 * Address bar displaying and editing the URL(s) of the currently active tab(s)
 */
export function AddressBar({ tabGroup, activeItemId, onNavigate }: AddressBarProps) {
  const tabsToShow = getAddressBarEntries(tabGroup, activeItemId);

  if (tabsToShow.length === 0) {
    return null; // Don't render address bar if no tab is active
  }

  return (
    <div className="bg-neutral-900 border-b border-neutral-800 px-3 py-1.5 flex items-center gap-2">
      {tabsToShow.map((tab, index) => (
        <AddressBarInput
          key={tab.id}
          tabId={tab.id}
          title={tab.title}
          url={tab.url}
          displayUrl={tab.displayUrl}
          readOnly={tab.readOnly}
          showSeparator={index > 0}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}

interface AddressBarEntry {
  id: string;
  title: string;
  url: string;
  displayUrl: string;
  readOnly: boolean;
}

export function getAddressBarEntries(
  tabGroup: TabGroup,
  activeItemId: string,
): AddressBarEntry[] {
  const activeTab = tabGroup.tabs.find((tab) => tab.id === activeItemId);
  const activePair = tabGroup.pairs.find((pair) => pair.id === activeItemId);
  const tabs = activePair
    ? activePair.tabIds
        .map((id) => tabGroup.tabs.find((tab) => tab.id === id))
        .filter((tab): tab is Tab => tab !== undefined)
    : activeTab
      ? [activeTab]
      : [];

  return tabs
    .filter(shouldShowTabInAddressBar)
    .map((tab) => ({
      id: tab.id,
      title: tab.title,
      url: tab.url,
      displayUrl: isBuiltInWorkspaceTabId(tab.id)
        ? decodeUrlForDisplay(tab.url)
        : tab.url,
      readOnly: isBuiltInWorkspaceTabId(tab.id),
    }));
}

function shouldShowTabInAddressBar(tab: Tab): boolean {
  return !isEphemeralCraftSurfaceTab(tab) || isBuiltInWorkspaceTabId(tab.id);
}

function decodeUrlForDisplay(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

interface AddressBarInputProps {
  tabId: string;
  title: string;
  url: string;
  displayUrl: string;
  readOnly: boolean;
  showSeparator: boolean;
  onNavigate: (tabId: string, newUrl: string) => void;
}

function AddressBarInput({
  tabId,
  title,
  url,
  displayUrl,
  readOnly,
  showSeparator,
  onNavigate,
}: AddressBarInputProps) {
  const [editedUrl, setEditedUrl] = useState(displayUrl);
  const [isEditing, setIsEditing] = useState(false);

  // Sync with prop when not editing
  React.useEffect(() => {
    if (!isEditing) {
      setEditedUrl(displayUrl);
    }
  }, [displayUrl, isEditing]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!readOnly && editedUrl.trim() && editedUrl !== url) {
        onNavigate(tabId, editedUrl.trim());
      }
      setIsEditing(false);
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setEditedUrl(displayUrl); // Revert changes
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
        <span className="text-neutral-500 text-xs flex-shrink-0" title={title}>
          🌐
        </span>
        <input
          type="text"
          value={editedUrl}
          onChange={(e) => setEditedUrl(e.target.value)}
          readOnly={readOnly}
          aria-label={`${title} address`}
          title={
            readOnly
              ? `${title} address (read-only generated tab)`
              : `${title} address`
          }
          onFocus={(event) => {
            setIsEditing(true);
            if (readOnly) event.currentTarget.select();
          }}
          onBlur={() => {
            setIsEditing(false);
            setEditedUrl(displayUrl); // Revert if not submitted via Enter
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
