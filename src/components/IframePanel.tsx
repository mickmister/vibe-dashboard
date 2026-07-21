import React, { useRef, useEffect, useState, useCallback, useLayoutEffect } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { TabGroup, Tab } from '../types';
import type { WorkspaceState, SavedWorkspaceSession } from '../types';
import { AppLoadingScreen } from './AppLoadingScreen';
import { SpacesOverview } from './SpacesOverview';
import { hasSameBaseOrigin } from '../lib/originTrust';
import { getPluginIframePolicy, getPluginIframePostMessageTargetOrigin, parsePluginInternalUrl } from '../modules/plugins/vibe-dashboard/runtime';
import { getRegisteredPluginIframePolicy, resolvePluginInternalRouteIframeSrc } from '../modules/plugins/vibe-dashboard/registry';

const INTERNAL_URL_PREFIX = 'internal://';
const CADDY_PORT = process.env.CADDY_PORT || '';

const MOBILE_VIEWPORT_INSET_STYLE = {
  bottom: 'var(--mobile-footer-offset)',
};

interface IframePanelProps {
  tabGroup: TabGroup;
  activeItemId: string;
  onUpdatePairRatios: (pairId: string, ratios: number[]) => void;
  workspace?: WorkspaceState;
  savedSessions?: SavedWorkspaceSession[];
  currentSessionId?: string;
  onResumeSession?: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, name: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onStartNewSession?: () => void;
  onNavigateToTabGroup?: (spaceId: string, tabGroupId: string) => void | Promise<void>;
  onOpenVKWorkspace?: (taskAttemptId: string, name: string, containerRef: string, spaceId: string) => void | Promise<void>;
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
  readyToShow: boolean;
  loadError: boolean;
  lastAccessedAt: number;
  listeners: Set<() => void>;
  revealDelayTimeoutId: ReturnType<typeof setTimeout> | null;
  loadToken: number;
  readinessDebugLastSignature: string | null;
};

type TabRenderTarget =
  | { kind: 'internal'; internalPath: string }
  | { kind: 'blocked-self-app' }
  | { kind: 'iframe'; iframeSrc: string };

type RetainedIframeTab = {
  tab: Tab;
  iframeKey: string;
};

let iframeStore: Map<string, IframeEntry> = new Map();
let retainedSessionId: string | null = null;
let retainedTabIds: Set<string> = new Set();
let keyboardIsolationDocuments: WeakSet<Document> = new WeakSet();
let activatedIframeKeys: Set<string> = new Set();
const MAX_RETAINED_IFRAMES = 5;
export const IFRAME_REVEAL_DELAY_MS = 250;
const IFRAME_ACTIVATION_SHIELD_MS = 1000;
const IFRAME_VISUAL_READY_TIMEOUT_MS = 30000;
const WHITE_SCREEN_DEBUG_PREFIX = 'WHITE SCREEN DEBUG:';

function logWhiteScreenDebug(message: string, details?: Record<string, unknown>) {
  if (details) {
    console.info(`${WHITE_SCREEN_DEBUG_PREFIX} ${message}`, details);
    return;
  }

  console.info(`${WHITE_SCREEN_DEBUG_PREFIX} ${message}`);
}

// Preserve iframe store across HMR updates using Vite's HMR API.
try {
  // @ts-expect-error -- import.meta.hot is Vite-specific, not available under module: commonjs
  const hot = import.meta.hot;
  if (hot) {
    if (hot.data.iframeStore) {
      iframeStore = hot.data.iframeStore;
    }
    if (hot.data.retainedSessionId) {
      retainedSessionId = hot.data.retainedSessionId;
    }
    if (hot.data.retainedTabIds) {
      retainedTabIds = hot.data.retainedTabIds;
    }
    if (hot.data.keyboardIsolationDocuments) {
      keyboardIsolationDocuments = hot.data.keyboardIsolationDocuments;
    }
    if (hot.data.activatedIframeKeys) {
      activatedIframeKeys = hot.data.activatedIframeKeys;
    }
    hot.dispose((data: Record<string, unknown>) => {
      data.iframeStore = iframeStore;
      data.retainedSessionId = retainedSessionId;
      data.retainedTabIds = retainedTabIds;
      data.keyboardIsolationDocuments = keyboardIsolationDocuments;
      data.activatedIframeKeys = activatedIframeKeys;
    });
  }
} catch {
  // Not in Vite dev mode
}

function isTrustedIframeOrigin(origin: string): boolean {
  return hasSameBaseOrigin(origin, window.location.origin);
}

function applyIframePolicy(iframe: HTMLIFrameElement, iframeSrc: string) {
  const registeredPolicy = getRegisteredPluginIframePolicy({
    iframeSrc,
    origin: window.location.origin,
  });
  const pluginPolicy = getPluginIframePolicy({
    iframeSrc,
    hostOrigin: window.location.origin,
    allowSameOrigin: registeredPolicy?.allowSameOrigin,
  });

  if (pluginPolicy.isPluginFrontendAsset) {
    iframe.setAttribute('sandbox', pluginPolicy.sandbox);
    iframe.setAttribute('allow', pluginPolicy.allow);
    iframe.dataset.pluginEventOrigin = pluginPolicy.targetOrigin;
    iframe.dataset.pluginPostMessageTargetOrigin = getPluginIframePostMessageTargetOrigin(pluginPolicy);
    if (pluginPolicy.requiresSeparateOriginForSameOriginStorage) {
      iframe.dataset.pluginSameOriginStorageBlocked = 'true';
      console.warn(
        'Plugin iframe requested allow-same-origin on the host origin; keeping the iframe opaque until a separate plugin origin is configured.',
        { iframeSrc },
      );
    } else {
      delete iframe.dataset.pluginSameOriginStorageBlocked;
    }
    return;
  }

  const trusted = (() => {
    try {
      return isTrustedIframeOrigin(new URL(iframeSrc).origin);
    } catch {
      return false;
    }
  })();

  iframe.setAttribute(
    'sandbox',
    trusted
      ? 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals'
      : 'allow-scripts allow-forms allow-popups allow-modals',
  );
  iframe.setAttribute(
    'allow',
    trusted ? 'clipboard-read; clipboard-write; fullscreen' : 'fullscreen',
  );
}

function installIframeKeyboardIsolation(iframe: HTMLIFrameElement) {
  try {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;
    if (keyboardIsolationDocuments.has(doc)) return;

    keyboardIsolationDocuments.add(doc);

    doc.addEventListener(
      'keydown',
      (event) => {
        const key = event.key.toLowerCase();
        if ((event.metaKey || event.ctrlKey) && key === 's') {
          event.stopPropagation();
        }
      },
      { capture: true },
    );
  } catch {
    // Cross-origin iframes keep their own keyboard handling.
  }
}

function notifyIframeListeners(entry: IframeEntry) {
  entry.listeners.forEach((fn) => fn());
}

function clearIframeRevealDelay(entry: IframeEntry) {
  if (entry.revealDelayTimeoutId == null) return;
  logWhiteScreenDebug('clear pending iframe reveal delay', {
    src: entry.iframe.src,
    loadToken: entry.loadToken,
    loaded: entry.loaded,
    contentReady: entry.contentReady,
    readyToShow: entry.readyToShow,
  });
  clearTimeout(entry.revealDelayTimeoutId);
  entry.revealDelayTimeoutId = null;
}

function resetIframeLoadReadiness(entry: IframeEntry) {
  logWhiteScreenDebug('reset iframe load readiness', {
    src: entry.iframe.src,
    previousLoaded: entry.loaded,
    previousContentReady: entry.contentReady,
    previousReadyToShow: entry.readyToShow,
    previousLoadError: entry.loadError,
    previousLoadToken: entry.loadToken,
  });
  clearIframeRevealDelay(entry);
  entry.loaded = false;
  entry.contentReady = false;
  entry.readyToShow = false;
  entry.loadError = false;
  entry.loadToken += 1;
  entry.readinessDebugLastSignature = null;
}

function markIframeReadyToShow(
  entry: IframeEntry,
  expectedLoadToken: number,
  delayMs = IFRAME_REVEAL_DELAY_MS,
) {
  if (entry.loadToken !== expectedLoadToken || entry.readyToShow || entry.revealDelayTimeoutId != null) {
    logWhiteScreenDebug('skip scheduling iframe reveal delay', {
      src: entry.iframe.src,
      expectedLoadToken,
      actualLoadToken: entry.loadToken,
      readyToShow: entry.readyToShow,
      revealDelayAlreadyScheduled: entry.revealDelayTimeoutId != null,
    });
    return;
  }

  logWhiteScreenDebug('schedule iframe reveal delay', {
    src: entry.iframe.src,
    expectedLoadToken,
    delayMs,
  });
  entry.revealDelayTimeoutId = setTimeout(() => {
    entry.revealDelayTimeoutId = null;
    if (entry.loadToken !== expectedLoadToken || entry.readyToShow) {
      logWhiteScreenDebug('skip iframe reveal after delay', {
        src: entry.iframe.src,
        expectedLoadToken,
        actualLoadToken: entry.loadToken,
        readyToShow: entry.readyToShow,
      });
      return;
    }

    entry.readyToShow = true;
    logWhiteScreenDebug('iframe readyToShow set true after reveal delay', {
      src: entry.iframe.src,
      expectedLoadToken,
      delayMs,
    });
    notifyIframeListeners(entry);
  }, delayMs);
}

export function getIframeRevealStyle(readyToShow: boolean): React.CSSProperties {
  return {
    opacity: readyToShow ? 1 : 0,
    pointerEvents: readyToShow ? 'auto' : 'none',
    transition: readyToShow ? 'opacity 120ms ease-out' : 'none',
  };
}

export function shouldShowIframeLoadingOverlay(isLoaded: boolean, activationShielded: boolean): boolean {
  return !isLoaded || activationShielded;
}

function useIframeOverlayDebug({
  context,
  tab,
  iframeKey,
  targetKind,
  isLoaded,
  hasError,
  isActivationShielded,
}: {
  context: string;
  tab: Tab;
  iframeKey: string;
  targetKind: TabRenderTarget['kind'];
  isLoaded: boolean;
  hasError: boolean;
  isActivationShielded: boolean;
}) {
  const shouldShowLoadingOverlay = shouldShowIframeLoadingOverlay(isLoaded, isActivationShielded);

  useEffect(() => {
    logWhiteScreenDebug('overlay state changed', {
      context,
      tabId: tab.id,
      tabTitle: tab.title,
      tabUrl: tab.url,
      iframeKey,
      targetKind,
      isLoaded,
      hasError,
      isActivationShielded,
      shouldShowLoadingOverlay,
    });
  }, [
    context,
    tab.id,
    tab.title,
    tab.url,
    iframeKey,
    targetKind,
    isLoaded,
    hasError,
    isActivationShielded,
    shouldShowLoadingOverlay,
  ]);

  return shouldShowLoadingOverlay;
}

type IframeViewportSample = {
  label: string;
  x: number;
  y: number;
  element: string;
  backgroundChain: string[];
  firstNonBlankBackground: string | null;
};

type IframeVisualReadinessDebug = {
  readyState: DocumentReadyState;
  bodyBackground: string;
  rootBackground: string;
  currentCheckReady: boolean;
  proposedViewportCheckReady: boolean;
  detectedWhiteScreen: boolean;
  reasons: string[];
  samples: IframeViewportSample[];
};

function describeElement(element: Element | null): string {
  if (!element) return '<none>';

  const id = element.id ? `#${element.id}` : '';
  const className = typeof element.className === 'string' && element.className.trim()
    ? `.${element.className.trim().split(/\s+/).slice(0, 4).join('.')}`
    : '';

  return `${element.tagName.toLowerCase()}${id}${className}`;
}

function getElementBackgroundChain(element: Element | null, view: Window): { chain: string[]; firstNonBlankBackground: string | null } {
  const chain: string[] = [];
  let firstNonBlankBackground: string | null = null;
  let current: Element | null = element;

  while (current) {
    const backgroundColor = view.getComputedStyle(current).backgroundColor;
    chain.push(`${describeElement(current)}=${backgroundColor}`);
    if (!firstNonBlankBackground && !isBlankIframeBackgroundColor(backgroundColor)) {
      firstNonBlankBackground = backgroundColor;
    }
    current = current.parentElement;
  }

  return { chain, firstNonBlankBackground };
}

function sampleIframeViewport(doc: Document): IframeViewportSample[] {
  const view = doc.defaultView;
  if (!view) return [];

  const root = doc.documentElement;
  const width = Math.max(root.clientWidth, view.innerWidth || 0);
  const height = Math.max(root.clientHeight, view.innerHeight || 0);
  if (width <= 0 || height <= 0) return [];

  const points = [
    { label: 'center', x: 0.5, y: 0.5 },
    { label: 'top-left', x: 0.1, y: 0.1 },
    { label: 'top-right', x: 0.9, y: 0.1 },
    { label: 'bottom-left', x: 0.1, y: 0.9 },
    { label: 'bottom-right', x: 0.9, y: 0.9 },
  ];

  return points.map((point) => {
    const x = Math.min(Math.max(Math.round(width * point.x), 0), Math.max(width - 1, 0));
    const y = Math.min(Math.max(Math.round(height * point.y), 0), Math.max(height - 1, 0));
    const element = doc.elementFromPoint(x, y);
    const { chain, firstNonBlankBackground } = getElementBackgroundChain(element, view);
    return {
      label: point.label,
      x,
      y,
      element: describeElement(element),
      backgroundChain: chain,
      firstNonBlankBackground,
    };
  });
}

function analyzeIframeVisualReadiness(doc: Document): IframeVisualReadinessDebug {
  const view = doc.defaultView;
  const bodyBackground = view && doc.body ? view.getComputedStyle(doc.body).backgroundColor : '';
  const rootBackground = view && doc.documentElement ? view.getComputedStyle(doc.documentElement).backgroundColor : '';
  const currentCheckReady = Boolean(
    view &&
    doc.readyState === 'complete' &&
    (!isBlankIframeBackgroundColor(bodyBackground) || !isBlankIframeBackgroundColor(rootBackground))
  );
  const samples = view ? sampleIframeViewport(doc) : [];
  const blankSamples = samples.filter((sample) => !sample.firstNonBlankBackground);
  const proposedViewportCheckReady = samples.length > 0 && blankSamples.length === 0;
  const reasons: string[] = [];

  if (!view) reasons.push('iframe document has no defaultView');
  if (doc.readyState !== 'complete') reasons.push(`iframe document readyState is ${doc.readyState}`);
  if (isBlankIframeBackgroundColor(bodyBackground)) reasons.push(`body background is blank/white (${bodyBackground || '<empty>'})`);
  if (isBlankIframeBackgroundColor(rootBackground)) reasons.push(`html background is blank/white (${rootBackground || '<empty>'})`);
  if (samples.length === 0) {
    reasons.push('viewport sampling found no measurable iframe viewport');
  } else {
    blankSamples.forEach((sample) => {
      reasons.push(`viewport sample ${sample.label} at ${sample.x},${sample.y} has no non-blank background; element=${sample.element}`);
    });
  }

  return {
    readyState: doc.readyState,
    bodyBackground,
    rootBackground,
    currentCheckReady,
    proposedViewportCheckReady,
    detectedWhiteScreen: reasons.length > 0,
    reasons,
    samples,
  };
}

function logIframeVisualReadinessDebug(
  entry: IframeEntry,
  iframe: HTMLIFrameElement,
  analysis: IframeVisualReadinessDebug,
  context: { elapsedMs: number; stableFrameCount: number; loadToken: number },
) {
  const signature = JSON.stringify({
    readyState: analysis.readyState,
    bodyBackground: analysis.bodyBackground,
    rootBackground: analysis.rootBackground,
    currentCheckReady: analysis.currentCheckReady,
    proposedViewportCheckReady: analysis.proposedViewportCheckReady,
    reasons: analysis.reasons,
    stableFrameCount: context.stableFrameCount,
  });
  if (entry.readinessDebugLastSignature === signature) return;
  entry.readinessDebugLastSignature = signature;

  const details = {
    src: iframe.src,
    elapsedMs: context.elapsedMs,
    loadToken: context.loadToken,
    stableFrameCount: context.stableFrameCount,
    readyState: analysis.readyState,
    bodyBackground: analysis.bodyBackground,
    rootBackground: analysis.rootBackground,
    currentBodyHtmlCheckReady: analysis.currentCheckReady,
    proposedViewportSampleCheckReady: analysis.proposedViewportCheckReady,
    samples: analysis.samples,
  };

  if (analysis.detectedWhiteScreen) {
    console.info(
      `WHITE SCREEN DEBUG: detected white screen condition. reason: ${analysis.reasons.join('; ')}`,
      details,
    );
    return;
  }

  console.info('WHITE SCREEN DEBUG: iframe visual readiness checks passed', details);
}

export function isBlankIframeBackgroundColor(backgroundColor: string): boolean {
  const normalized = backgroundColor.trim().toLowerCase();
  return (
    normalized === '' ||
    normalized === 'transparent' ||
    normalized === 'white' ||
    normalized === '#fff' ||
    normalized === '#ffffff' ||
    normalized === 'rgb(255, 255, 255)' ||
    normalized === 'rgba(255, 255, 255, 1)' ||
    normalized === 'rgba(0, 0, 0, 0)'
  );
}

function hasVisualReadyBackground(doc: Document): boolean {
  return analyzeIframeVisualReadiness(doc).currentCheckReady;
}

function waitForIframeVisualReadiness(
  iframe: HTMLIFrameElement,
  entry: IframeEntry,
  expectedLoadToken: number,
) {
  let stableFrameCount = 0;
  const startedAt = Date.now();

  const checkReady = () => {
    if (entry.loadToken !== expectedLoadToken || entry.readyToShow) return;

    let doc: Document | undefined | null;
    try {
      doc = iframe.contentDocument || iframe.contentWindow?.document;
    } catch {
      logWhiteScreenDebug('iframe document inaccessible; revealing after load', {
        src: iframe.src,
        elapsedMs: Date.now() - startedAt,
        loadToken: expectedLoadToken,
      });
      entry.contentReady = true;
      markIframeReadyToShow(entry, expectedLoadToken);
      return;
    }

    if (!doc) {
      logWhiteScreenDebug('iframe document unavailable; revealing after load', {
        src: iframe.src,
        elapsedMs: Date.now() - startedAt,
        loadToken: expectedLoadToken,
      });
      entry.contentReady = true;
      markIframeReadyToShow(entry, expectedLoadToken);
      return;
    }

    const elapsedMs = Date.now() - startedAt;
    const analysis = analyzeIframeVisualReadiness(doc);
    if (analysis.currentCheckReady) {
      stableFrameCount += 1;
    } else {
      stableFrameCount = 0;
    }
    logIframeVisualReadinessDebug(entry, iframe, analysis, {
      elapsedMs,
      stableFrameCount,
      loadToken: expectedLoadToken,
    });

    if (analysis.currentCheckReady && stableFrameCount >= 2) {
      entry.contentReady = true;
      logWhiteScreenDebug('iframe visual readiness accepted', {
        src: iframe.src,
        elapsedMs,
        loadToken: expectedLoadToken,
        stableFrameCount,
      });
      markIframeReadyToShow(entry, expectedLoadToken);
      return;
    }

    if (elapsedMs >= IFRAME_VISUAL_READY_TIMEOUT_MS) {
      logWhiteScreenDebug('Timed out waiting for iframe visual readiness; revealing after fallback timeout.', { src: iframe.src });
      entry.contentReady = true;
      markIframeReadyToShow(entry, expectedLoadToken);
      return;
    }

    requestAnimationFrame(checkReady);
  };

  requestAnimationFrame(checkReady);
}

function markIframeReadyToShowImmediately(entry: IframeEntry) {
  clearIframeRevealDelay(entry);
  entry.readyToShow = true;
  logWhiteScreenDebug('iframe readyToShow set true immediately', {
    src: entry.iframe.src,
    loadToken: entry.loadToken,
    loaded: entry.loaded,
    contentReady: entry.contentReady,
    loadError: entry.loadError,
  });
  notifyIframeListeners(entry);
}

function normalizeIframeEntry(entry: IframeEntry) {
  entry.readyToShow ??= entry.loaded && entry.contentReady;
  entry.revealDelayTimeoutId ??= null;
  entry.loadToken ??= 0;
  entry.readinessDebugLastSignature ??= null;
}

function isIframeReadyToShow(entry: IframeEntry) {
  return entry.readyToShow ?? (entry.loaded && entry.contentReady);
}

function getIframeResolutionOrigin(url: string): string {
  if (hasExplicitOrigin(url)) {
    return window.location.origin;
  }

  const { protocol, host, hostname } = window.location;
  if (CADDY_PORT && isIpAddress(hostname)) {
    return `${protocol}//${formatHostnameForOrigin(hostname)}:${CADDY_PORT}`;
  }

  if (!url.startsWith('/')) {
    return window.location.origin;
  }

  const portPrefixMatch = host.match(/^port-\d+\.(.+)$/);

  if (portPrefixMatch) {
    return `${protocol}//${portPrefixMatch[1]}`;
  }

  return window.location.origin;
}

function hasExplicitOrigin(url: string): boolean {
  if (url.startsWith('//')) {
    return true;
  }

  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function isIpAddress(hostname: string): boolean {
  const normalizedHostname = hostname.replace(/^\[(.*)]$/, '$1');

  if (normalizedHostname === 'localhost') {
    return false;
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalizedHostname)) {
    return normalizedHostname.split('.').every((segment) => {
      const value = Number(segment);
      return Number.isInteger(value) && value >= 0 && value <= 255;
    });
  }

  return normalizedHostname.includes(':');
}

function formatHostnameForOrigin(hostname: string): string {
  if (hostname.includes(':') && !hostname.startsWith('[')) {
    return `[${hostname}]`;
  }

  return hostname;
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

function isSelfAppOrigin(origin: string): boolean {
  if (origin === window.location.origin) {
    return true;
  }

  try {
    return origin === new URL(getIframeResolutionOrigin('/')).origin;
  } catch {
    return false;
  }
}

function getTabRenderTarget(url: string): TabRenderTarget {
  if (url.startsWith(INTERNAL_URL_PREFIX)) {
    const pluginIframeSrc = resolvePluginInternalRouteIframeSrc({
      internalUrl: url,
      origin: window.location.origin,
    });
    if (pluginIframeSrc) {
      return { kind: 'iframe', iframeSrc: pluginIframeSrc };
    }

    return {
      kind: 'internal',
      internalPath: url.slice(INTERNAL_URL_PREFIX.length),
    };
  }

  try {
    const resolvedUrl = new URL(url, getIframeResolutionOrigin(url));
    if (
      isSelfAppOrigin(resolvedUrl.origin) &&
      isSelfAppPath(resolvedUrl.pathname, resolvedUrl.searchParams)
    ) {
      return { kind: 'blocked-self-app' };
    }

    return { kind: 'iframe', iframeSrc: resolvedUrl.href };
  } catch {
    return { kind: 'iframe', iframeSrc: url };
  }
}

function getOrCreateIframe(retainedTab: RetainedIframeTab): IframeEntry {
  const { tab, iframeKey } = retainedTab;
  const existing = iframeStore.get(iframeKey);
  if (existing) {
    normalizeIframeEntry(existing);
    logWhiteScreenDebug('reuse retained iframe entry', {
      tabId: tab.id,
      tabTitle: tab.title,
      iframeKey,
      src: existing.iframe.src,
      loaded: existing.loaded,
      contentReady: existing.contentReady,
      readyToShow: existing.readyToShow,
      loadError: existing.loadError,
      loadToken: existing.loadToken,
    });
    return existing;
  }
  const target = getTabRenderTarget(tab.url);
  logWhiteScreenDebug('create iframe entry', {
    tabId: tab.id,
    tabTitle: tab.title,
    iframeKey,
    tabUrl: tab.url,
    targetKind: target.kind,
    iframeSrc: target.kind === 'iframe' ? target.iframeSrc : undefined,
  });

  const container = document.createElement('div');
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.position = 'absolute';
  container.style.inset = '0';

  const iframe = document.createElement('iframe');
  iframe.title = tab.title;
  iframe.className = 'w-full h-full border-0';
  iframe.setAttribute('role', 'region');

  const entry: IframeEntry = {
    iframe,
    container,
    loaded: target.kind !== 'iframe',
    contentReady: target.kind !== 'iframe',
    readyToShow: target.kind !== 'iframe',
    loadError: false,
    lastAccessedAt: Date.now(),
    listeners: new Set(),
    revealDelayTimeoutId: null,
    loadToken: 0,
    readinessDebugLastSignature: null,
  };

  iframe.addEventListener('load', () => {
    const currentLoadToken = entry.loadToken;
    logWhiteScreenDebug('iframe load event fired', {
      tabId: tab.id,
      tabTitle: tab.title,
      iframeKey,
      src: iframe.src,
      loadToken: currentLoadToken,
      readyState: (() => {
        try {
          return iframe.contentDocument?.readyState ?? null;
        } catch {
          return 'inaccessible';
        }
      })(),
    });
    entry.loaded = true;
    installIframeKeyboardIsolation(iframe);

    waitForIframeVisualReadiness(iframe, entry, currentLoadToken);
  });

  iframe.addEventListener('error', () => {
    logWhiteScreenDebug('iframe error event fired', {
      tabId: tab.id,
      tabTitle: tab.title,
      iframeKey,
      src: iframe.src,
      loadToken: entry.loadToken,
    });
    clearIframeRevealDelay(entry);
    entry.loadError = true;
    entry.loaded = true;
    entry.contentReady = true;
    markIframeReadyToShowImmediately(entry);
  });

  if (target.kind === 'iframe') {
    applyIframePolicy(iframe, target.iframeSrc);
    logWhiteScreenDebug('set iframe src on creation', {
      tabId: tab.id,
      tabTitle: tab.title,
      iframeKey,
      iframeSrc: target.iframeSrc,
      loadToken: entry.loadToken,
    });
    iframe.src = target.iframeSrc;
  }

  container.appendChild(iframe);
  iframeStore.set(iframeKey, entry);

  return entry;
}

function removeIframe(tabId: string) {
  const entry = iframeStore.get(tabId);
  if (entry) {
    clearIframeRevealDelay(entry);
    entry.container.remove();
    entry.listeners.clear();
    iframeStore.delete(tabId);
  }
  retainedTabIds.delete(tabId);
}

function removeAllIframes() {
  for (const tabId of Array.from(iframeStore.keys())) {
    removeIframe(tabId);
  }
}

export function hasKnownIframeMessageSource(source: MessageEventSource | null): boolean {
  if (!source) return false;
  return Array.from(iframeStore.values()).some(
    (entry) => entry.iframe.contentWindow === source,
  );
}

function getIframeRetentionKey(tabGroupId: string, tabId: string): string {
  return `${tabGroupId}:${tabId}`;
}

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function useIframeActivationShield(
  tabs: RetainedIframeTab[],
  visibleIframeKeys: Set<string>,
) {
  const [activationShieldState, setActivationShieldState] = useState<Map<string, boolean>>(new Map());
  const activationTimeoutIdsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const visibleActivationSignature = tabs
    .filter((retainedTab) => visibleIframeKeys.has(retainedTab.iframeKey))
    .map((retainedTab) => `${retainedTab.iframeKey}:${retainedTab.tab.id}`)
    .join('|');

  useEffect(() => {
    return () => {
      activationTimeoutIdsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
      activationTimeoutIdsRef.current.clear();
    };
  }, []);

  useIsomorphicLayoutEffect(() => {
    for (const retainedTab of tabs) {
      if (!visibleIframeKeys.has(retainedTab.iframeKey)) continue;
      if (activatedIframeKeys.has(retainedTab.iframeKey)) continue;

      activatedIframeKeys.add(retainedTab.iframeKey);
      logWhiteScreenDebug('activation shield started for first visible iframe activation', {
        tabId: retainedTab.tab.id,
        tabTitle: retainedTab.tab.title,
        iframeKey: retainedTab.iframeKey,
        durationMs: IFRAME_ACTIVATION_SHIELD_MS,
      });
      setActivationShieldState((prev) => {
        if (prev.get(retainedTab.iframeKey) === true) return prev;
        const next = new Map(prev);
        next.set(retainedTab.iframeKey, true);
        return next;
      });

      const timeoutId = setTimeout(() => {
        activationTimeoutIdsRef.current.delete(retainedTab.iframeKey);
        logWhiteScreenDebug('activation shield timeout elapsed', {
          tabId: retainedTab.tab.id,
          tabTitle: retainedTab.tab.title,
          iframeKey: retainedTab.iframeKey,
          durationMs: IFRAME_ACTIVATION_SHIELD_MS,
        });
        setActivationShieldState((prev) => {
          if (prev.get(retainedTab.iframeKey) !== true) return prev;
          const next = new Map(prev);
          next.set(retainedTab.iframeKey, false);
          return next;
        });
      }, IFRAME_ACTIVATION_SHIELD_MS);
      activationTimeoutIdsRef.current.set(retainedTab.iframeKey, timeoutId);
    }
  }, [visibleActivationSignature]);

  return activationShieldState;
}

function useImperativeIframes(
  currentSessionId: string | undefined,
  tabs: RetainedIframeTab[],
  visibleIframeKeys: Set<string>,
  allKnownIframeKeys?: Set<string>,
) {
  const [storeVersion, setStoreVersion] = useState(0);

  const bumpStoreVersion = useCallback(() => {
    setStoreVersion((prev) => prev + 1);
  }, []);

  const [loadingState, setLoadingState] = useState<Map<string, boolean>>(() => {
    const initial = new Map<string, boolean>();
    for (const retainedTab of tabs) {
      const entry = iframeStore.get(retainedTab.iframeKey);
      // Already-mounted iframes that have completed their reveal delay should show immediately.
      initial.set(retainedTab.iframeKey, entry ? isIframeReadyToShow(entry) : false);
    }
    return initial;
  });

  const [errorState, setErrorState] = useState<Map<string, boolean>>(() => {
    const initial = new Map<string, boolean>();
    for (const retainedTab of tabs) {
      const entry = iframeStore.get(retainedTab.iframeKey);
      initial.set(retainedTab.iframeKey, entry?.loadError ?? false);
    }
    return initial;
  });

  useEffect(() => {
    const nextSessionId = currentSessionId || null;
    if (retainedSessionId === nextSessionId) return;

    logWhiteScreenDebug('iframe retained session changed; removing retained iframes', {
      previousSessionId: retainedSessionId,
      nextSessionId,
      retainedIframeCount: iframeStore.size,
    });
    retainedSessionId = nextSessionId;
    retainedTabIds = new Set();
    removeAllIframes();
    bumpStoreVersion();
  }, [bumpStoreVersion, currentSessionId]);

  useEffect(() => {
    let createdIframe = false;

    for (const retainedTab of tabs) {
      const existing = iframeStore.get(retainedTab.iframeKey);
      if (existing) continue;
      getOrCreateIframe(retainedTab);
      createdIframe = true;
    }

    if (createdIframe) {
      bumpStoreVersion();
    }
  }, [bumpStoreVersion, tabs]);

  // Update iframe src when tab URL changes
  useEffect(() => {
    for (const retainedTab of tabs) {
      const entry = iframeStore.get(retainedTab.iframeKey);
      const tab = retainedTab.tab;
      if (!entry) continue;
      const target = getTabRenderTarget(tab.url);

      if (target.kind !== 'iframe') {
        if (entry.iframe.src !== 'about:blank') {
          logWhiteScreenDebug('set iframe src to about:blank for non-iframe target', {
            tabId: tab.id,
            tabTitle: tab.title,
            iframeKey: retainedTab.iframeKey,
            previousSrc: entry.iframe.src,
            targetKind: target.kind,
          });
          entry.iframe.src = 'about:blank';
        }
        clearIframeRevealDelay(entry);
        entry.loaded = true;
        entry.contentReady = true;
        entry.readyToShow = true;
        entry.loadError = false;
        entry.loadToken += 1;
        setLoadingState((prev) => {
          const next = new Map(prev);
          next.set(retainedTab.iframeKey, true);
          return next;
        });
        setErrorState((prev) => {
          const next = new Map(prev);
          next.set(retainedTab.iframeKey, false);
          return next;
        });
        continue;
      }

      // Update iframe src if URL has changed.
      // Resolve tab.url before comparing, since
      // the browser always returns an absolute URL from iframe.src.
      applyIframePolicy(entry.iframe, target.iframeSrc);

      if (entry.iframe.src !== target.iframeSrc) {
        logWhiteScreenDebug('iframe tab url changed; updating src', {
          tabId: tab.id,
          tabTitle: tab.title,
          iframeKey: retainedTab.iframeKey,
          previousSrc: entry.iframe.src,
          nextSrc: target.iframeSrc,
          previousLoadToken: entry.loadToken,
        });
        resetIframeLoadReadiness(entry);
        entry.iframe.src = target.iframeSrc;
        setLoadingState((prev) => {
          const next = new Map(prev);
          next.set(retainedTab.iframeKey, false);
          return next;
        });
        setErrorState((prev) => {
          const next = new Map(prev);
          next.set(retainedTab.iframeKey, false);
          return next;
        });
      }
    }
  }, [tabs]);

  useEffect(() => {
    const now = Date.now();
    let removedIframe = false;

    for (const retainedTab of tabs) {
      if (!visibleIframeKeys.has(retainedTab.iframeKey)) continue;
      retainedTabIds.add(retainedTab.iframeKey);
      const entry = iframeStore.get(retainedTab.iframeKey);
      if (entry) {
        entry.lastAccessedAt = now;
      }
    }

    if (allKnownIframeKeys) {
      for (const tabId of Array.from(retainedTabIds)) {
        if (!allKnownIframeKeys.has(tabId)) {
          removeIframe(tabId);
          removedIframe = true;
        }
      }
    }

    const visibleIds = new Set(visibleIframeKeys);
    const evictableIds = Array.from(retainedTabIds)
      .filter((tabId) => !visibleIds.has(tabId))
      .sort((leftId, rightId) => {
        const leftEntry = iframeStore.get(leftId);
        const rightEntry = iframeStore.get(rightId);
        return (
          (leftEntry?.lastAccessedAt ?? 0) - (rightEntry?.lastAccessedAt ?? 0)
        );
      });

    while (retainedTabIds.size > MAX_RETAINED_IFRAMES && evictableIds.length > 0) {
      const tabId = evictableIds.shift();
      if (!tabId) break;
      removeIframe(tabId);
      removedIframe = true;
    }

    if (removedIframe) {
      bumpStoreVersion();
    }
  }, [allKnownIframeKeys, bumpStoreVersion, tabs, visibleIframeKeys]);

  // Subscribe to load events
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    for (const retainedTab of tabs) {
      const entry = iframeStore.get(retainedTab.iframeKey);
      if (!entry) continue;

      // If already loaded, content ready, and past the reveal delay, update state immediately.
      if (isIframeReadyToShow(entry)) {
        setLoadingState((prev) => {
          if (prev.get(retainedTab.iframeKey) === true) return prev;
          const next = new Map(prev);
          next.set(retainedTab.iframeKey, true);
          return next;
        });
        if (entry.loadError) {
          setErrorState((prev) => {
            const next = new Map(prev);
            next.set(retainedTab.iframeKey, true);
            return next;
          });
        }
        continue;
      }

      // Otherwise subscribe to load/content ready events
      const listener = () => {
        // Only mark as ready after the iframe loaded, content is ready, and the reveal delay elapsed.
        if (isIframeReadyToShow(entry)) {
          setLoadingState((prev) => {
            const next = new Map(prev);
            next.set(retainedTab.iframeKey, true);
            return next;
          });
          if (entry.loadError) {
            setErrorState((prev) => {
              const next = new Map(prev);
              next.set(retainedTab.iframeKey, true);
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

  const retryTab = useCallback((tabId: string) => {
    const iframeKey = tabs.find((item) => visibleIframeKeys.has(item.iframeKey) && item.tab.id === tabId)?.iframeKey
      ?? tabs.find((item) => item.tab.id === tabId)?.iframeKey
      ?? tabId;
    const entry = iframeStore.get(iframeKey);
    if (!entry) return;
    logWhiteScreenDebug('retry iframe tab requested', {
      tabId,
      iframeKey,
      src: entry.iframe.src,
      previousLoadToken: entry.loadToken,
    });
    resetIframeLoadReadiness(entry);
    entry.lastAccessedAt = Date.now();
    entry.iframe.src = entry.iframe.src; // reload
    setLoadingState((prev) => {
      const next = new Map(prev);
      next.set(iframeKey, false);
      return next;
    });
    setErrorState((prev) => {
      const next = new Map(prev);
      next.set(iframeKey, false);
      return next;
    });
  }, [tabs, visibleIframeKeys]);

  return { loadingState, errorState, retryTab, storeVersion };
}

/**
 * A container div that imperatively hosts an iframe DOM element.
 * The iframe is appended via useEffect, not rendered by React,
 * so it survives HMR and re-renders.
 */
function IframeHost({ iframeKey, storeVersion }: { iframeKey: string; storeVersion: number }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useIsomorphicLayoutEffect(() => {
    const host = hostRef.current;
    const entry = iframeStore.get(iframeKey);
    if (!host || !entry) return;
    if (entry.container.parentElement === host) return;

    logWhiteScreenDebug('append retained iframe container to React host', {
      iframeKey,
      src: entry.iframe.src,
      loaded: entry.loaded,
      contentReady: entry.contentReady,
      readyToShow: entry.readyToShow,
      loadError: entry.loadError,
      loadToken: entry.loadToken,
    });
    host.appendChild(entry.container);
  }, [storeVersion, iframeKey]);

  useIsomorphicLayoutEffect(() => {
    return () => {
      const host = hostRef.current;
      const entry = iframeStore.get(iframeKey);
      if (!host || !entry) return;

      if (entry.container.parentElement === host) {
        logWhiteScreenDebug('detach retained iframe container from React host', {
          iframeKey,
          src: entry.iframe.src,
          loaded: entry.loaded,
          contentReady: entry.contentReady,
          readyToShow: entry.readyToShow,
          loadError: entry.loadError,
          loadToken: entry.loadToken,
        });
        host.removeChild(entry.container);
      }
    };
  }, [iframeKey]);

  return (
    <div ref={hostRef} className="w-full h-full relative" />
  );
}

export function IframePanel({
  tabGroup,
  activeItemId,
  onUpdatePairRatios,
  workspace,
  savedSessions,
  currentSessionId,
  onResumeSession,
  onRenameSession,
  onDeleteSession,
  onStartNewSession,
  onNavigateToTabGroup,
  onOpenVKWorkspace,
}: IframePanelProps) {
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

  const visibleIframeTabs = tabGroup.tabs.filter((tab) => {
    if (!visibleTabIds.has(tab.id)) return false;
    return getTabRenderTarget(tab.url).kind === 'iframe';
  });

  const visibleRetainedIframeTabs = visibleIframeTabs.map((tab): RetainedIframeTab => ({
    tab,
    iframeKey: getIframeRetentionKey(tabGroup.id, tab.id),
  }));
  const allKnownIframeTabs = workspace?.tabGroups.flatMap((group) =>
    group.tabs
      .filter((tab) => getTabRenderTarget(tab.url).kind === 'iframe')
      .map((tab): RetainedIframeTab => ({
        tab,
        iframeKey: getIframeRetentionKey(group.id, tab.id),
      })),
  );
  const visibleIframeKeys = new Set(visibleRetainedIframeTabs.map((item) => item.iframeKey));
  const activeIframeKey = activeTab ? getIframeRetentionKey(tabGroup.id, activeTab.id) : null;
  const retainedTabs =
    allKnownIframeTabs?.filter(
      (item) => retainedTabIds.has(item.iframeKey) || visibleIframeKeys.has(item.iframeKey),
    ) ?? visibleRetainedIframeTabs;
  const allKnownIframeKeys = allKnownIframeTabs
    ? new Set(allKnownIframeTabs.map((item) => item.iframeKey))
    : undefined;

  const activationShieldState = useIframeActivationShield(retainedTabs, visibleIframeKeys);
  const { loadingState, errorState, retryTab, storeVersion } = useImperativeIframes(
    currentSessionId,
    retainedTabs,
    visibleIframeKeys,
    allKnownIframeKeys,
  );

  return (
    <div className="w-full h-full relative">
      <PersistentIframeLayer
        retainedTabs={retainedTabs}
        activeTab={activeTab}
        activePair={activePair}
        tabGroup={tabGroup}
        storeVersion={storeVersion}
        loadingState={loadingState}
        activationShieldState={activationShieldState}
      />
      {activePair ? (
        <PairView
          activePair={activePair}
          tabGroup={tabGroup}
          loadingState={loadingState}
          errorState={errorState}
          activationShieldState={activationShieldState}
          retryTab={retryTab}
          onUpdatePairRatios={onUpdatePairRatios}
        />
      ) : activeTab ? (
          <SingleTabView
            activeTab={activeTab}
            activeIframeKey={activeIframeKey ?? activeTab.id}
            loadingState={loadingState}
            errorState={errorState}
            activationShieldState={activationShieldState}
            retryTab={retryTab}
            {...(workspace ? { workspace } : {})}
            {...(savedSessions ? { savedSessions } : {})}
            {...(currentSessionId ? { currentSessionId } : {})}
            {...(onResumeSession ? { onResumeSession } : {})}
            {...(onRenameSession ? { onRenameSession } : {})}
            {...(onDeleteSession ? { onDeleteSession } : {})}
            {...(onStartNewSession ? { onStartNewSession } : {})}
            {...(onNavigateToTabGroup ? { onNavigateToTabGroup } : {})}
            {...(onOpenVKWorkspace ? { onOpenVKWorkspace } : {})}
          />
      ) : (
        <EmptyView />
      )}
    </div>
  );
}

function PersistentIframeLayer({
  retainedTabs,
  activeTab,
  activePair,
  tabGroup,
  storeVersion,
  loadingState,
  activationShieldState,
}: {
  retainedTabs: RetainedIframeTab[];
  activeTab?: Tab;
  activePair?: { id: string; tabIds: string[]; ratios: number[] };
  tabGroup: TabGroup;
  storeVersion: number;
  loadingState: Map<string, boolean>;
  activationShieldState: Map<string, boolean>;
}) {
  const layoutStyles = new Map<string, React.CSSProperties>();

  if (activePair) {
    const pairTabs = activePair.tabIds
      .map((id) => tabGroup.tabs.find((tab) => tab.id === id))
      .filter((tab): tab is Tab => tab != null)
      .filter((tab) => getTabRenderTarget(tab.url).kind === 'iframe');

    const separatorWidth = 4;
    const totalSeparatorWidth = Math.max(pairTabs.length - 1, 0) * separatorWidth;
    const totalRatio = activePair.ratios.reduce((sum, ratio) => sum + ratio, 0) || 1;
    let cumulativeRatio = 0;

    pairTabs.forEach((tab, index) => {
      const ratio = activePair.ratios[index] || 0;
      const ratioFraction = ratio / totalRatio;
      const cumulativeFraction = cumulativeRatio / totalRatio;

      layoutStyles.set(getIframeRetentionKey(tabGroup.id, tab.id), {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: `calc(${(cumulativeFraction * 100).toFixed(6)}% + ${(index * separatorWidth - cumulativeFraction * totalSeparatorWidth).toFixed(3)}px)`,
        width: `calc(${(ratioFraction * 100).toFixed(6)}% - ${(ratioFraction * totalSeparatorWidth).toFixed(3)}px)`,
        visibility: 'visible',
        pointerEvents: 'auto',
      });

      cumulativeRatio += ratio;
    });
  } else if (activeTab && getTabRenderTarget(activeTab.url).kind === 'iframe') {
    layoutStyles.set(getIframeRetentionKey(tabGroup.id, activeTab.id), {
      position: 'absolute',
      inset: 0,
      visibility: 'visible',
      pointerEvents: 'auto',
    });
  }

  return (
    <div
      className="absolute inset-x-0 top-0 overflow-hidden box-border bg-neutral-950 md:bottom-0"
      style={MOBILE_VIEWPORT_INSET_STYLE}
    >
      {retainedTabs.map(({ tab, iframeKey }) => {
        const activeStyle = layoutStyles.get(iframeKey);
        const readyToShow = (loadingState.get(iframeKey) ?? false) && !(activationShieldState.get(iframeKey) ?? false);
        return (
          <div
            key={iframeKey}
            className="absolute inset-0"
            style={
              activeStyle
                ? { ...activeStyle, ...getIframeRevealStyle(readyToShow) }
                : {
                    position: 'absolute',
                    inset: 0,
                    visibility: 'hidden',
                    pointerEvents: 'none',
                  }
            }
          >
            <IframeHost iframeKey={iframeKey} storeVersion={storeVersion} />
          </div>
        );
      })}
    </div>
  );
}

function SingleTabView({
  activeTab,
  activeIframeKey,
  loadingState,
  errorState,
  activationShieldState,
  retryTab,
  workspace,
  savedSessions,
  currentSessionId,
  onResumeSession,
  onRenameSession,
  onDeleteSession,
  onStartNewSession,
  onNavigateToTabGroup,
  onOpenVKWorkspace,
}: {
  activeTab: Tab;
  activeIframeKey: string;
  loadingState: Map<string, boolean>;
  errorState: Map<string, boolean>;
  activationShieldState: Map<string, boolean>;
  retryTab: (tabId: string) => void;
  workspace?: WorkspaceState;
  savedSessions?: SavedWorkspaceSession[];
  currentSessionId?: string;
  onResumeSession?: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, name: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onStartNewSession?: () => void;
  onNavigateToTabGroup?: (spaceId: string, tabGroupId: string) => void | Promise<void>;
  onOpenVKWorkspace?: (taskAttemptId: string, name: string, containerRef: string, spaceId: string) => void | Promise<void>;
}) {
  const isLoaded = loadingState.get(activeIframeKey) ?? false;
  const hasError = errorState.get(activeIframeKey) ?? false;
  const isActivationShielded = activationShieldState.get(activeIframeKey) ?? false;
  const target = getTabRenderTarget(activeTab.url);
  const shouldShowLoadingOverlay = useIframeOverlayDebug({
    context: 'single-tab',
    tab: activeTab,
    iframeKey: activeIframeKey,
    targetKind: target.kind,
    isLoaded,
    hasError,
    isActivationShielded,
  });

  // Check if this is an internal URL that should render a special component
  if (target.kind === 'internal') {
    const { internalPath } = target;

    if (
      internalPath === 'spaces-overview' &&
      workspace &&
      onNavigateToTabGroup &&
      onResumeSession &&
      onRenameSession &&
      onDeleteSession &&
      onStartNewSession
    ) {
      return (
        <div className="flex-1 min-h-0 relative h-full">
          <SpacesOverview
            workspace={workspace}
            savedSessions={savedSessions || []}
            currentSessionId={currentSessionId}
            onResumeSession={onResumeSession}
            onRenameSession={onRenameSession}
            onDeleteSession={onDeleteSession}
            onStartNewSession={onStartNewSession}
            onNavigateToTabGroup={onNavigateToTabGroup}
            {...(onOpenVKWorkspace ? { onOpenVKWorkspace } : {})}
          />
        </div>
      );
    }

    const pluginRoute = parsePluginInternalUrl(activeTab.url);
    if (pluginRoute) {
      return <PluginInternalRoutePlaceholder pluginId={pluginRoute.pluginId} routePath={pluginRoute.routePath} />;
    }

    return <UnknownInternalRoutePlaceholder url={activeTab.url} />;
  }

  if (target.kind === 'blocked-self-app') {
    return <BlockedSelfAppPlaceholder url={activeTab.url} />;
  }

  return (
    <div className="absolute inset-x-0 top-0 md:bottom-0 pointer-events-none" style={MOBILE_VIEWPORT_INSET_STYLE}>
      {hasError ? (
        <ErrorOverlay url={activeTab.url} onRetry={() => retryTab(activeTab.id)} />
      ) : shouldShowLoadingOverlay ? (
        <AppLoadingScreen className="absolute inset-0 z-30" />
      ) : null}
    </div>
  );
}

function PairView({
  activePair,
  tabGroup,
  loadingState,
  errorState,
  activationShieldState,
  retryTab,
  onUpdatePairRatios,
}: {
  activePair: { id: string; tabIds: string[]; ratios: number[] };
  tabGroup: TabGroup;
  loadingState: Map<string, boolean>;
  errorState: Map<string, boolean>;
  activationShieldState: Map<string, boolean>;
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
      className="flex-1 min-h-0 absolute inset-x-0 top-0 md:bottom-0 z-10 pointer-events-none"
      style={MOBILE_VIEWPORT_INSET_STYLE}
      onLayoutChanged={handleLayoutChange}
    >
      {pairTabs.map((tab, i) => {
        const iframeKey = getIframeRetentionKey(tabGroup.id, tab.id);
        const isLoaded = loadingState.get(iframeKey) ?? false;
        const hasError = errorState.get(iframeKey) ?? false;
        const isActivationShielded = activationShieldState.get(iframeKey) ?? false;

        return (
          <React.Fragment key={tab.id}>
            <Panel id={tab.id} defaultSize={percentages[i]} minSize={10} className="pointer-events-none">
              <PairTabView
                tab={tab}
                iframeKey={iframeKey}
                isLoaded={isLoaded}
                hasError={hasError}
                isActivationShielded={isActivationShielded}
                retryTab={retryTab}
              />
            </Panel>
            {i < pairTabs.length - 1 && (
              <Separator className="w-1 bg-neutral-700 hover:bg-neutral-500 data-[resize-handle-state=drag]:bg-primary-500 transition-colors cursor-col-resize flex-shrink-0 z-20 pointer-events-auto" />
            )}
          </React.Fragment>
        );
      })}
    </Group>
  );
}

function PairTabView({
  tab,
  iframeKey,
  isLoaded,
  hasError,
  isActivationShielded,
  retryTab,
}: {
  tab: Tab;
  iframeKey: string;
  isLoaded: boolean;
  hasError: boolean;
  isActivationShielded: boolean;
  retryTab: (tabId: string) => void;
}) {
  const target = getTabRenderTarget(tab.url);
  const shouldShowLoadingOverlay = useIframeOverlayDebug({
    context: 'pair-tab',
    tab,
    iframeKey,
    targetKind: target.kind,
    isLoaded,
    hasError,
    isActivationShielded,
  });

  if (target.kind === 'blocked-self-app') {
    return <BlockedSelfAppPlaceholder url={tab.url} />;
  }

  return (
    <div className="relative w-full h-full pointer-events-none">
      {hasError ? (
        <ErrorOverlay url={tab.url} onRetry={() => retryTab(tab.id)} />
      ) : shouldShowLoadingOverlay ? (
        <AppLoadingScreen className="absolute inset-0 z-30" />
      ) : null}
    </div>
  );
}

function EmptyView() {
  return (
    <div className="absolute inset-x-0 top-0 md:bottom-0 flex items-center justify-center text-neutral-500" style={MOBILE_VIEWPORT_INSET_STYLE}>
      <p>No tab selected. Click + to add a tab.</p>
    </div>
  );
}

function PluginInternalRoutePlaceholder({ pluginId, routePath }: { pluginId: string; routePath: string }) {
  return (
    <div className="flex-1 h-full bg-neutral-950 text-neutral-400 flex items-center justify-center">
      <div className="max-w-md px-6 text-center">
        <p className="text-sm font-medium text-neutral-200">Plugin route unavailable</p>
        <p className="mt-2 text-xs">This plugin-owned route is not active in the host registry yet.</p>
        <p className="mt-2 text-xs break-all">{pluginId}{routePath}</p>
      </div>
    </div>
  );
}

function UnknownInternalRoutePlaceholder({ url }: { url: string }) {
  return (
    <div className="flex-1 h-full bg-neutral-950 text-neutral-400 flex items-center justify-center">
      <div className="max-w-md px-6 text-center">
        <p className="text-sm font-medium text-neutral-200">Unknown internal route</p>
        <p className="mt-2 text-xs break-all">{url}</p>
      </div>
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
    <div className="absolute inset-0 bg-neutral-950 flex items-center justify-center z-10 pointer-events-auto">
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
