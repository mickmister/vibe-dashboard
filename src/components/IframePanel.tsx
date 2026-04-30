import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { TabGroup, Tab } from '../types';
import type { WorkspaceState } from '../types';
import { AppLoadingScreen } from './AppLoadingScreen';
import { SpacesOverview } from './SpacesOverview';

const INTERNAL_URL_PREFIX = 'internal://';

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
  loadError: boolean;
  listeners: Set<() => void>;
};

type TabRenderTarget =
  | { kind: 'internal'; internalPath: string }
  | { kind: 'blocked-self-app' }
  | { kind: 'iframe'; iframeSrc: string };

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

function getSelfAppOrigins(): Set<string> {
  const origins = new Set([window.location.origin]);
  const { protocol, host } = window.location;
  const portPrefixMatch = host.match(/^port-\d+\.(.+)$/);

  if (portPrefixMatch) {
    origins.add(`${protocol}//${portPrefixMatch[1]}`);
  }

  return origins;
}

function isSelfAppPath(pathname: string, searchParams: URLSearchParams): boolean {
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
    return true;
  }

  if (pathname !== '/') {
    return false;
  }

  return !searchParams.has('folder');
}

function getTabRenderTarget(url: string): TabRenderTarget {
  if (url.startsWith(INTERNAL_URL_PREFIX)) {
    return {
      kind: 'internal',
      internalPath: url.slice(INTERNAL_URL_PREFIX.length),
    };
  }

  try {
    const resolvedUrl = new URL(url, window.location.origin);
    const selfAppOrigins = getSelfAppOrigins();

    if (
      selfAppOrigins.has(resolvedUrl.origin) &&
      isSelfAppPath(resolvedUrl.pathname, resolvedUrl.searchParams)
    ) {
      return { kind: 'blocked-self-app' };
    }

    return { kind: 'iframe', iframeSrc: resolvedUrl.href };
  } catch {
    return { kind: 'iframe', iframeSrc: url };
  }
}

function getOrCreateIframe(tab: Tab): IframeEntry {
  const existing = iframeStore.get(tab.id);
  if (existing) return existing;
  const target = getTabRenderTarget(tab.url);

  const container = document.createElement('div');
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.position = 'absolute';
  container.style.inset = '0';

  const iframe = document.createElement('iframe');
  iframe.title = tab.title;
  iframe.className = 'w-full h-full border-0';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals');
  iframe.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen');
  iframe.setAttribute('role', 'region');

  const entry: IframeEntry = {
    iframe,
    container,
    loaded: target.kind !== 'iframe',
    contentReady: target.kind !== 'iframe',
    loadError: false,
    listeners: new Set(),
  };

  iframe.addEventListener('load', () => {
    entry.loaded = true;
    entry.listeners.forEach((fn) => fn());

    // Start checking if content is ready (not showing white screen)
    checkContentReady(iframe, entry);
  });

  iframe.addEventListener('error', () => {
    entry.loadError = true;
    entry.loaded = true;
    entry.contentReady = true;
    entry.listeners.forEach((fn) => fn());
  });

  if (target.kind === 'iframe') {
    iframe.src = target.iframeSrc;
  }

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
      if (!entry.contentReady) {
        entry.contentReady = true;
        entry.listeners.forEach((fn) => fn());
      }
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

  const [errorState, setErrorState] = useState<Map<string, boolean>>(() => {
    const initial = new Map<string, boolean>();
    for (const tab of tabs) {
      const entry = iframeStore.get(tab.id);
      initial.set(tab.id, entry?.loadError ?? false);
    }
    return initial;
  });

  // Update iframe src when tab URL changes
  useEffect(() => {
    for (const tab of tabs) {
      const entry = iframeStore.get(tab.id);
      if (!entry) continue;
      const target = getTabRenderTarget(tab.url);

      if (target.kind !== 'iframe') {
        if (entry.iframe.src !== 'about:blank') {
          entry.iframe.src = 'about:blank';
        }
        entry.loaded = true;
        entry.contentReady = true;
        entry.loadError = false;
        setLoadingState((prev) => {
          const next = new Map(prev);
          next.set(tab.id, true);
          return next;
        });
        setErrorState((prev) => {
          const next = new Map(prev);
          next.set(tab.id, false);
          return next;
        });
        continue;
      }

      // Update iframe src if URL has changed.
      // Resolve tab.url before comparing, since
      // the browser always returns an absolute URL from iframe.src.
      if (entry.iframe.src !== target.iframeSrc) {
        entry.iframe.src = target.iframeSrc;
        // Reset loading and error state
        entry.loaded = false;
        entry.contentReady = false;
        entry.loadError = false;
        setLoadingState((prev) => {
          const next = new Map(prev);
          next.set(tab.id, false);
          return next;
        });
        setErrorState((prev) => {
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
        if (entry.loadError) {
          setErrorState((prev) => {
            const next = new Map(prev);
            next.set(tab.id, true);
            return next;
          });
        }
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
          if (entry.loadError) {
            setErrorState((prev) => {
              const next = new Map(prev);
              next.set(tab.id, true);
              return next;
            });
          }
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

  const retryTab = useCallback((tabId: string) => {
    const entry = iframeStore.get(tabId);
    if (!entry) return;
    entry.loaded = false;
    entry.contentReady = false;
    entry.loadError = false;
    entry.iframe.src = entry.iframe.src; // reload
    setLoadingState((prev) => {
      const next = new Map(prev);
      next.set(tabId, false);
      return next;
    });
    setErrorState((prev) => {
      const next = new Map(prev);
      next.set(tabId, false);
      return next;
    });
  }, []);

  return { loadingState, errorState, retryTab };
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
  const { loadingState, errorState, retryTab } = useImperativeIframes(tabGroup.tabs);

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
          errorState={errorState}
          retryTab={retryTab}
          onUpdatePairRatios={onUpdatePairRatios}
        />
      ) : activeTab ? (
        <SingleTabView
          activeTab={activeTab}
          loadingState={loadingState}
          errorState={errorState}
          retryTab={retryTab}
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
  errorState,
  retryTab,
  workspace,
  onNavigateToTabGroup,
  onOpenVKWorkspace,
}: {
  activeTab: Tab;
  loadingState: Map<string, boolean>;
  errorState: Map<string, boolean>;
  retryTab: (tabId: string) => void;
  workspace?: WorkspaceState;
  onNavigateToTabGroup?: (spaceId: string, tabGroupId: string) => void;
  onOpenVKWorkspace?: (taskAttemptId: string, name: string, containerRef: string, spaceId: string) => void;
}) {
  const isLoaded = loadingState.get(activeTab.id) ?? false;
  const hasError = errorState.get(activeTab.id) ?? false;
  const target = getTabRenderTarget(activeTab.url);

  // Check if this is an internal URL that should render a special component
  if (target.kind === 'internal') {
    const { internalPath } = target;

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

  if (target.kind === 'blocked-self-app') {
    return <BlockedSelfAppPlaceholder url={activeTab.url} />;
  }

  return (
    <div className="flex-1 min-h-0 relative h-full">
      <IframeHost tabId={activeTab.id} visible={!hasError} />
      {hasError ? (
        <ErrorOverlay url={activeTab.url} onRetry={() => retryTab(activeTab.id)} />
      ) : !isLoaded ? (
        <AppLoadingScreen className="absolute inset-0 z-10" />
      ) : null}
    </div>
  );
}

function PairView({
  activePair,
  tabGroup,
  loadingState,
  errorState,
  retryTab,
  onUpdatePairRatios,
}: {
  activePair: { id: string; tabIds: string[]; ratios: number[] };
  tabGroup: TabGroup;
  loadingState: Map<string, boolean>;
  errorState: Map<string, boolean>;
  retryTab: (tabId: string) => void;
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
        const hasError = errorState.get(tab.id) ?? false;

        return (
          <React.Fragment key={tab.id}>
            <Panel id={tab.id} defaultSize={percentages[i]} minSize={10}>
              <PairTabView
                tab={tab}
                isLoaded={isLoaded}
                hasError={hasError}
                retryTab={retryTab}
              />
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

function PairTabView({
  tab,
  isLoaded,
  hasError,
  retryTab,
}: {
  tab: Tab;
  isLoaded: boolean;
  hasError: boolean;
  retryTab: (tabId: string) => void;
}) {
  const target = getTabRenderTarget(tab.url);

  if (target.kind === 'blocked-self-app') {
    return <BlockedSelfAppPlaceholder url={tab.url} />;
  }

  return (
    <div className="relative w-full h-full">
      <IframeHost tabId={tab.id} visible={!hasError} />
      {hasError ? (
        <ErrorOverlay url={tab.url} onRetry={() => retryTab(tab.id)} />
      ) : !isLoaded ? (
        <AppLoadingScreen className="absolute inset-0 z-10" />
      ) : null}
    </div>
  );
}

function EmptyView() {
  return (
    <div className="flex-1 flex items-center justify-center text-neutral-500">
      <p>No tab selected. Click + to add a tab.</p>
    </div>
  );
}

function BlockedSelfAppPlaceholder({ url }: { url: string }) {
  return (
    <div className="flex-1 h-full bg-neutral-950 text-neutral-400 flex items-center justify-center">
      <div className="max-w-md px-6 text-center">
        <p className="text-sm font-medium text-neutral-200">
          stopped loading app recursively
        </p>
        <p className="mt-2 text-xs break-all">{url}</p>
      </div>
    </div>
  );
}

function ErrorOverlay({ url, onRetry }: { url: string; onRetry: () => void }) {
  return (
    <div className="absolute inset-0 bg-neutral-950 flex items-center justify-center z-10">
      <div className="flex flex-col items-center gap-4 max-w-md px-6 text-center">
        <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center">
          <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <div>
          <p className="text-neutral-300 text-sm font-medium mb-1">Failed to load</p>
          <p className="text-neutral-500 text-xs break-all">{url}</p>
        </div>
        <button
          onClick={onRetry}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-800 text-neutral-300 border border-neutral-700 hover:bg-neutral-700 hover:text-white transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
