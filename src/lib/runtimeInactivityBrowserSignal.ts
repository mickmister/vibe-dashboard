export type RuntimeInactivityBrowserActivityEvent =
  | 'load'
  | 'visible'
  | 'focus'
  | 'interaction'
  | 'heartbeat'
  | 'hide'
  | 'pagehide';

export interface RuntimeInactivityBrowserActivityPayload {
  schemaVersion: 'runtime-inactivity-browser-activity.v1';
  eventType: RuntimeInactivityBrowserActivityEvent;
  occurredAt: string;
  visibilityState: 'visible' | 'hidden' | 'unknown';
}

export interface RuntimeInactivityBrowserSignalOptions {
  endpoint?: string;
  heartbeatMs?: number;
  minSendIntervalMs?: number;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  sendBeacon?: Navigator['sendBeacon'];
  windowObj?: Pick<Window, 'addEventListener' | 'removeEventListener' | 'setInterval' | 'clearInterval'>;
  documentObj?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
}

export interface RuntimeInactivityBrowserSignalController {
  stop: () => void;
  sendActivity: (eventType: RuntimeInactivityBrowserActivityEvent, force?: boolean) => void;
}

const DEFAULT_ENDPOINT = '/internal/inactivity/browser-activity';
const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_MIN_SEND_INTERVAL_MS = 5_000;

export function installRuntimeInactivityBrowserSignal(
  options: RuntimeInactivityBrowserSignalOptions = {},
): RuntimeInactivityBrowserSignalController | null {
  const windowObj = options.windowObj ?? (typeof window === 'undefined' ? undefined : window);
  const documentObj = options.documentObj ?? (typeof document === 'undefined' ? undefined : document);
  if (!windowObj || !documentObj) return null;

  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const heartbeatMs = normalizePositiveInteger(options.heartbeatMs, DEFAULT_HEARTBEAT_MS);
  const minSendIntervalMs = normalizePositiveInteger(options.minSendIntervalMs, DEFAULT_MIN_SEND_INTERVAL_MS);
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? (typeof fetch === 'undefined' ? undefined : fetch.bind(globalThis));
  const sendBeacon = options.sendBeacon ?? (typeof navigator === 'undefined' ? undefined : navigator.sendBeacon?.bind(navigator));
  let lastSentAt = 0;

  const buildPayload = (eventType: RuntimeInactivityBrowserActivityEvent): RuntimeInactivityBrowserActivityPayload => ({
    schemaVersion: 'runtime-inactivity-browser-activity.v1',
    eventType,
    occurredAt: now().toISOString(),
    visibilityState: documentObj.visibilityState === 'visible'
      ? 'visible'
      : documentObj.visibilityState === 'hidden'
        ? 'hidden'
        : 'unknown',
  });

  const sendActivity = (eventType: RuntimeInactivityBrowserActivityEvent, force = false): void => {
    const current = now().getTime();
    if (!force && current - lastSentAt < minSendIntervalMs) return;
    lastSentAt = current;

    const body = JSON.stringify(buildPayload(eventType));
    if (sendBeacon) {
      try {
        const blob = new Blob([body], { type: 'application/json' });
        if (sendBeacon(endpoint, blob)) return;
      } catch {
        // Fall through to fetch. Activity reporting must never break the app shell.
      }
    }

    if (fetchImpl) {
      void fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }
  };

  const sendVisibleHeartbeat = (): void => {
    if (documentObj.visibilityState !== 'hidden') sendActivity('heartbeat');
  };
  const onVisibilityChange = (): void => {
    sendActivity(documentObj.visibilityState === 'hidden' ? 'hide' : 'visible', true);
  };
  const onFocus = (): void => sendActivity('focus', true);
  const onInteraction = (): void => sendActivity('interaction');
  const onPageHide = (): void => sendActivity('pagehide', true);

  documentObj.addEventListener('visibilitychange', onVisibilityChange);
  windowObj.addEventListener('focus', onFocus);
  windowObj.addEventListener('pointerdown', onInteraction, { passive: true } as AddEventListenerOptions);
  windowObj.addEventListener('keydown', onInteraction, { passive: true } as AddEventListenerOptions);
  windowObj.addEventListener('pagehide', onPageHide);
  const interval = windowObj.setInterval(sendVisibleHeartbeat, heartbeatMs);
  sendActivity(documentObj.visibilityState === 'hidden' ? 'hide' : 'load', true);

  return {
    stop: () => {
      documentObj.removeEventListener('visibilitychange', onVisibilityChange);
      windowObj.removeEventListener('focus', onFocus);
      windowObj.removeEventListener('pointerdown', onInteraction);
      windowObj.removeEventListener('keydown', onInteraction);
      windowObj.removeEventListener('pagehide', onPageHide);
      windowObj.clearInterval(interval);
    },
    sendActivity,
  };
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  return fallback;
}
