import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { TabGroup, Tab } from '../types';
import type { WorkspaceState } from '../types';
import { SpacesOverview } from './SpacesOverview';

interface IframePanelProps {
  tabGroup: TabGroup;
  activeItemId: string;
  onUpdatePairRatios: (pairId: string, ratios: number[]) => void;
  workspace?: WorkspaceState;
  onNavigateToTabGroup?: (spaceId: string, tabGroupId: string) => void;
  onOpenVKWorkspace?: (taskAttemptId: string, name: string, containerRef: string, spaceId: string) => void;
}

/**
 * Module-level iframe store that persists across HMR updates.
 * Iframe DOM elements are managed imperatively so React re-renders
 * (including HMR fast refresh) never recreate them.
 */
type IframeEntry = {
  iframe: HTMLIFrameElement;
  container: HTMLDivElement;
  loaded: boolean;
  contentReady: boolean;
  listeners: Set<() => void>;
};

let iframeStore: Map<string, IframeEntry> = new Map();

// Preserve iframe store across HMR updates using Vite's HMR API.
try {
  // @ts-expect-error -- import.meta.hot is Vite-specific, not available under module: commonjs
  const hot = import.meta.hot;
  if (hot) {
    if (hot.data.iframeStore) {
      iframeStore = hot.data.iframeStore;
    }
    hot.dispose((data: Record<string, unknown>) => {
      data.iframeStore = iframeStore;
    });
  }
} catch {
  // Not in Vite dev mode
}

function getOrCreateIframe(tab: Tab): IframeEntry {
  const existing = iframeStore.get(tab.id);
  if (existing) return existing;

  // Don't create iframes for internal URLs
  if (tab.url.startsWith('internal://')) {
    const container = document.createElement('div');
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.position = 'absolute';
    container.style.inset = '0';

    const iframe = document.createElement('iframe');
    iframe.className = 'w-full h-full border-0';

    const entry: IframeEntry = {
      iframe,
      container,
      loaded: true,
      contentReady: true,
      listeners: new Set(),
    };

    iframeStore.set(tab.id, entry);
    return entry;
  }

  const container = document.createElement('div');
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.position = 'absolute';
  container.style.inset = '0';

  const iframe = document.createElement('iframe');
  iframe.src = tab.url;
  iframe.title = tab.title;
  iframe.className = 'w-full h-full border-0';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals');
  iframe.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen');
  iframe.setAttribute('role', 'region');

  const entry: IframeEntry = { iframe, container, loaded: false, contentReady: false, listeners: new Set() };

  iframe.addEventListener('load', () => {
    entry.loaded = true;
    entry.listeners.forEach((fn) => fn());

    // Start checking if content is ready (not showing white screen)
    checkContentReady(iframe, entry);
  });

  container.appendChild(iframe);
  iframeStore.set(tab.id, entry);

  return entry;
}

/**
 * Checks if the iframe content is actually ready by detecting white screens.
 * For same-origin iframes, we can check the background color to see if the SPA has loaded.
 */
function checkContentReady(iframe: HTMLIFrameElement, entry: IframeEntry) {
  try {
    // Try to access iframe content (will throw if cross-origin)
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      // Can't access content (likely cross-origin), assume ready after load
      entry.contentReady = true;
      entry.listeners.forEach((fn) => fn());
      return;
    }

    // Check if the background is white (indicating SPA still loading)
    const checkInterval = setInterval(() => {
      try {
        const body = doc.body;
        if (!body) return;

        const bgColor = window.getComputedStyle(body).backgroundColor;

        // Check if background is white or transparent
        const isWhite =
          bgColor === 'rgb(255, 255, 255)' ||
          bgColor === '#ffffff' ||
          bgColor === '#fff' ||
          bgColor === 'white' ||
          bgColor === 'rgba(0, 0, 0, 0)' ||
          bgColor === 'transparent';

        // Also check if there's actual content rendered
        const hasContent = body.children.length > 0 &&
          body.offsetHeight > 0 &&
          body.scrollHeight > 100; // Some minimum content height

        if (!isWhite || hasContent) {
          // Content is ready!
          entry.contentReady = true;
          entry.listeners.forEach((fn) => fn());
          clearInterval(checkInterval);
        }
      } catch (e) {
        // Lost access to iframe (navigation happened), assume ready
        entry.contentReady = true;
        entry.listeners.forEach((fn) => fn());
        clearInterval(checkInterval);
      }
    }, 100); // Check every 100ms

    // Timeout after 10 seconds to prevent infinite checking
    setTimeout(() => {
      clearInterval(checkInterval);
      entry.contentReady = true;
      entry.listeners.forEach((fn) => fn());
    }, 10000);

  } catch (e) {
    // Cross-origin iframe, can't check content, assume ready
    entry.contentReady = true;
    entry.listeners.forEach((fn) => fn());
  }
}

function removeIframe(tabId: string) {
  const entry = iframeStore.get(tabId);
  if (entry) {
    entry.container.remove();
    entry.listeners.clear();
    iframeStore.delete(tabId);
  }
}

/**
 * Ensure all iframes exist for the given tabs (eagerly, not in an effect).
 * Clean up stale entries in an effect.
 */
function useImperativeIframes(tabs: Tab[]) {
  // Eagerly create iframes so they're available for IframeHost immediately
  for (const tab of tabs) {
    getOrCreateIframe(tab);
  }

  const [loadingState, setLoadingState] = useState<Map<string, boolean>>(() => {
    const initial = new Map<string, boolean>();
    for (const tab of tabs) {
      const entry = iframeStore.get(tab.id);
      // Only consider ready when BOTH loaded AND content is ready
      initial.set(tab.id, (entry?.loaded && entry?.contentReady) ?? false);
    }
    return initial;
  });

  // Update iframe src when tab URL changes
  useEffect(() => {
    for (const tab of tabs) {
      const entry = iframeStore.get(tab.id);
      if (!entry) continue;

      // Skip internal URLs - they don't use actual iframes
      if (tab.url.startsWith('internal://')) continue;

      // Update iframe src if URL has changed
      if (entry.iframe.src !== tab.url) {
        entry.iframe.src = tab.url;
        // Reset loading state
        entry.loaded = false;
        entry.contentReady = false;
        setLoadingState((prev) => {
          const next = new Map(prev);
          next.set(tab.id, false);
          return next;
        });
      }
    }
  }, [tabs]);

  // Subscribe to load events
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    for (const tab of tabs) {
      const entry = iframeStore.get(tab.id);
      if (!entry) continue;

      // If already loaded AND content ready, update state immediately
      if (entry.loaded && entry.contentReady) {
        setLoadingState((prev) => {
          if (prev.get(tab.id) === true) return prev;
          const next = new Map(prev);
          next.set(tab.id, true);
          return next;
        });
        continue;
      }

      // Otherwise subscribe to load/content ready events
      const listener = () => {
        // Only mark as ready when both loaded AND content is ready
        if (entry.loaded && entry.contentReady) {
          setLoadingState((prev) => {
            const next = new Map(prev);
            next.set(tab.id, true);
            return next;
          });
        }
      };
      entry.listeners.add(listener);
      unsubs.push(() => entry.listeners.delete(listener));
    }

    return () => unsubs.forEach((fn) => fn());
  }, [tabs]);

  // Clean up stale iframes
  useEffect(() => {
    const currentTabIds = new Set(tabs.map((t) => t.id));
    for (const [id] of iframeStore.entries()) {
      if (!currentTabIds.has(id)) {
        removeIframe(id);
      }
    }
  }, [tabs]);

  return { loadingState };
}

/**
 * A container div that imperatively hosts an iframe DOM element.
 * The iframe is appended via useEffect, not rendered by React,
 * so it survives HMR and re-renders.
 */
function IframeHost({ tabId, visible }: { tabId: string; visible: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const entry = iframeStore.get(tabId);
    if (!host || !entry) return;

    host.appendChild(entry.container);

    return () => {
      if (entry.container.parentElement === host) {
        host.removeChild(entry.container);
      }
    };
  }, [tabId]);

  return (
    <div
      ref={hostRef}
      className="w-full h-full relative"
      style={{ display: visible ? 'block' : 'none' }}
    />
  );
}

export function IframePanel({
  tabGroup,
  activeItemId,
  onUpdatePairRatios,
  workspace,
  onNavigateToTabGroup,
  onOpenVKWorkspace,
}: IframePanelProps) {
  const { loadingState } = useImperativeIframes(tabGroup.tabs);

  const activeTab = tabGroup.tabs.find(
    (t) => t.id === activeItemId
  );
  const activePair = tabGroup.pairs.find(
    (p) => p.id === activeItemId
  );

  const visibleTabIds = new Set<string>();
  if (activePair) {
    activePair.tabIds.forEach((id) => visibleTabIds.add(id));
  } else if (activeTab) {
    visibleTabIds.add(activeTab.id);
  }

  return (
    <>
      {tabGroup.tabs.map((tab) => {
        if (visibleTabIds.has(tab.id)) return null;
        return <IframeHost key={tab.id} tabId={tab.id} visible={false} />;
      })}

      {activePair ? (
        <PairView
          activePair={activePair}
          tabGroup={tabGroup}
          loadingState={loadingState}
          onUpdatePairRatios={onUpdatePairRatios}
        />
      ) : activeTab ? (
        <SingleTabView
          activeTab={activeTab}
          loadingState={loadingState}
          {...(workspace ? { workspace } : {})}
          {...(onNavigateToTabGroup ? { onNavigateToTabGroup } : {})}
          {...(onOpenVKWorkspace ? { onOpenVKWorkspace } : {})}
        />
      ) : (
        <EmptyView />
      )}
    </>
  );
}

function SingleTabView({
  activeTab,
  loadingState,
  workspace,
  onNavigateToTabGroup,
  onOpenVKWorkspace,
}: {
  activeTab: Tab;
  loadingState: Map<string, boolean>;
  workspace?: WorkspaceState;
  onNavigateToTabGroup?: (spaceId: string, tabGroupId: string) => void;
  onOpenVKWorkspace?: (taskAttemptId: string, name: string, containerRef: string, spaceId: string) => void;
}) {
  const isLoaded = loadingState.get(activeTab.id) ?? false;

  // Check if this is an internal URL that should render a special component
  if (activeTab.url.startsWith('internal://')) {
    const internalPath = activeTab.url.replace('internal://', '');

    if (internalPath === 'spaces-overview' && workspace && onNavigateToTabGroup) {
      return (
        <div className="flex-1 min-h-0 relative h-full">
          <SpacesOverview
            workspace={workspace}
            onNavigateToTabGroup={onNavigateToTabGroup}
            {...(onOpenVKWorkspace ? { onOpenVKWorkspace } : {})}
          />
        </div>
      );
    }
  }

  return (
    <div className="flex-1 min-h-0 relative h-full">
      <IframeHost tabId={activeTab.id} visible={true} />
      {!isLoaded && <LoadingOverlay />}
    </div>
  );
}

function PairView({
  activePair,
  tabGroup,
  loadingState,
  onUpdatePairRatios,
}: {
  activePair: { id: string; tabIds: string[]; ratios: number[] };
  tabGroup: TabGroup;
  loadingState: Map<string, boolean>;
  onUpdatePairRatios: (pairId: string, ratios: number[]) => void;
}) {
  const pairTabs = activePair.tabIds
    .map((id) => tabGroup.tabs.find((t) => t.id === id))
    .filter((t): t is Tab => t != null);

  const percentages = activePair.ratios;

  const handleLayoutChange = (layout: { [id: string]: number }) => {
    const newRatios = pairTabs.map((tab) => layout[tab.id] || 0);
    onUpdatePairRatios(activePair.id, newRatios);
  };

  return (
    <Group
      orientation="horizontal"
      className="flex-1 min-h-0"
      onLayoutChanged={handleLayoutChange}
    >
      {pairTabs.map((tab, i) => {
        const isLoaded = loadingState.get(tab.id) ?? false;

        return (
          <React.Fragment key={tab.id}>
            <Panel id={tab.id} defaultSize={percentages[i]} minSize={10}>
              <div className="relative w-full h-full">
                <IframeHost tabId={tab.id} visible={true} />
                {!isLoaded && <LoadingOverlay />}
              </div>
            </Panel>
            {i < pairTabs.length - 1 && (
              <Separator className="w-1 bg-neutral-700 hover:bg-neutral-500 data-[resize-handle-state=drag]:bg-primary-500 transition-colors cursor-col-resize flex-shrink-0" />
            )}
          </React.Fragment>
        );
      })}
    </Group>
  );
}

function EmptyView() {
  return (
    <div className="flex-1 flex items-center justify-center text-neutral-500">
      <p>No tab selected. Click + to add a tab.</p>
    </div>
  );
}

function LoadingOverlay() {
  return (
    <div className="absolute inset-0 bg-neutral-950 flex items-center justify-center z-10">
      <div className="flex flex-col items-center gap-3">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
        <p className="text-neutral-400 text-sm">Loading...</p>
      </div>
    </div>
  );
}
