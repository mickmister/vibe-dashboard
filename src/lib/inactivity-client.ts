import {
  type ActivityBeaconPayload,
  type ActivityEventType,
  INACTIVITY_ACTIVITY_PATH,
} from './inactivity';

const DEFAULT_ACTIVITY_DEBOUNCE_MS = 5000;

let lastActivitySentAt = 0;

type RecordUserActivityOptions = {
  force?: boolean;
  spaceId?: string;
  tabGroupId?: string;
  itemId?: string;
  iframeTabId?: string;
  href?: string;
};

export async function recordUserActivity(
  type: ActivityEventType,
  source: ActivityBeaconPayload['source'],
  options: RecordUserActivityOptions = {},
) {
  if (typeof window === 'undefined') return;

  const now = Date.now();
  if (
    !options.force &&
    now - lastActivitySentAt < DEFAULT_ACTIVITY_DEBOUNCE_MS
  ) {
    return;
  }

  lastActivitySentAt = now;

  const payload: ActivityBeaconPayload = {
    type,
    source,
    href: options.href ?? window.location.href,
    spaceId: options.spaceId,
    tabGroupId: options.tabGroupId,
    itemId: options.itemId,
    iframeTabId: options.iframeTabId,
    occurredAt: new Date(now).toISOString(),
  };

  try {
    await fetch(INACTIVITY_ACTIVITY_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: 'same-origin',
    });
  } catch (error) {
    console.warn('Failed to record user activity', error);
  }
}
