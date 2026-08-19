import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  InMemoryWorkflowNotificationProvider,
  buildMetaWorkflowTerminalNotification,
  buildWorkflowRunTerminalNotification,
  getBrowserWorkflowNotificationState,
  maybeNotifyBrowserWorkflowTerminal,
  requestBrowserWorkflowNotifications,
  shouldNotifyWorkflowRun,
} from './workflowNotifications';

describe('workflow notification providers 7XWL', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { Notification?: unknown }).Notification;
  });

  it('builds product-safe PWA workflow and meta-workflow notification payloads', async () => {
    const provider = new InMemoryWorkflowNotificationProvider();
    const workflow = buildWorkflowRunTerminalNotification({
      runId: 'run-a',
      workflowName: 'Deploy via /Users/me/repo and bd show secret',
      workspaceId: 'workspace-a',
      status: 'failed',
      blockedReason: { message: 'webhook queue item failed with raw XML' },
      now: 1,
    });
    expect(workflow).toMatchObject({ channel: 'pwa', subjectKind: 'workflow_run', status: 'failed', link: '/dashboard/workflows/run-a?workspaceId=workspace-a' });
    await provider.notify(workflow!);
    expect(JSON.stringify(provider.notifications)).not.toMatch(/\/Users\/|bd show|webhook|queue item|raw XML/i);

    const meta = buildMetaWorkflowTerminalNotification({
      metaRunId: 'meta-a',
      title: 'Roadmap run',
      parentWorkspaceId: 'workspace-a',
      status: 'completed',
      now: 2,
    });
    expect(meta).toMatchObject({ channel: 'pwa', subjectKind: 'meta_workflow_run', title: 'Roadmap run completed', link: '/dashboard/workflows/meta-runs?workspaceId=workspace-a&metaRunId=meta-a' });
  });

  it('suppresses notifications for non-terminal and meta-workflow child runs', () => {
    expect(shouldNotifyWorkflowRun({ previousStatus: 'running', nextStatus: 'completed' })).toBe(true);
    expect(shouldNotifyWorkflowRun({ previousStatus: 'running', nextStatus: 'running' })).toBe(false);
    expect(shouldNotifyWorkflowRun({ previousStatus: 'running', nextStatus: 'completed', runInputs: { metaRunId: 'meta-a', itemId: 'item-a' } })).toBe(false);
  });

  it('respects disabled notification channels', async () => {
    const provider = new InMemoryWorkflowNotificationProvider({ enabled: false });
    const payload = buildWorkflowRunTerminalNotification({ runId: 'run-disabled', workflowName: 'Disabled flow', workspaceId: 'workspace-a', status: 'completed', now: 1 })!;
    await expect(provider.notify(payload)).resolves.toMatchObject({ skippedReason: 'notification_channel_disabled' });
    expect(provider.notifications).toEqual([]);
  });

  it('handles browser notification unavailable, denied, granted, dedupe, suppression, and click link behavior', async () => {
    expect(getBrowserWorkflowNotificationState()).toMatchObject({ supported: false, permission: 'unsupported', enabled: false });

    const denied = installBrowserNotificationMock({ permission: 'denied' });
    expect(getBrowserWorkflowNotificationState()).toMatchObject({ supported: true, permission: 'denied', enabled: false });
    const deniedPayload = buildWorkflowRunTerminalNotification({ runId: 'run-denied', workflowName: 'Denied flow', workspaceId: 'workspace-a', status: 'completed', now: 1 })!;
    expect(maybeNotifyBrowserWorkflowTerminal(deniedPayload)).toBe(false);
    expect(denied.created).toEqual([]);

    const granted = installBrowserNotificationMock({ permission: 'granted' });
    const existing = buildWorkflowRunTerminalNotification({ runId: 'run-existing', workflowName: 'Existing flow', workspaceId: 'workspace-a', status: 'completed', now: 1 })!;
    await expect(requestBrowserWorkflowNotifications({ suppressExisting: [existing] })).resolves.toMatchObject({ permission: 'granted', enabled: true });
    expect(maybeNotifyBrowserWorkflowTerminal(existing)).toBe(false);
    const next = buildWorkflowRunTerminalNotification({ runId: 'run-next', workflowName: 'Next flow', workspaceId: 'workspace-a', status: 'completed', now: 2 })!;
    expect(maybeNotifyBrowserWorkflowTerminal(next)).toBe(true);
    expect(maybeNotifyBrowserWorkflowTerminal(next)).toBe(false);
    expect(granted.created).toHaveLength(1);
    granted.created[0]!.onclick();
    expect(granted.assign).toHaveBeenCalledWith('/dashboard/workflows/run-next?workspaceId=workspace-a');

    const requested = installBrowserNotificationMock({ permission: 'default', requestResult: 'granted' });
    await requestBrowserWorkflowNotifications();
    expect(requested.requestPermission).toHaveBeenCalledTimes(1);
    expect(getBrowserWorkflowNotificationState()).toMatchObject({ permission: 'granted', enabled: true });

    const rejected = installBrowserNotificationMock({ permission: 'default', requestResult: 'denied' });
    await requestBrowserWorkflowNotifications();
    expect(rejected.requestPermission).toHaveBeenCalledTimes(1);
    expect(getBrowserWorkflowNotificationState()).toMatchObject({ permission: 'denied', enabled: false });
  });
});

function installBrowserNotificationMock(options: { permission: NotificationPermission; requestResult?: NotificationPermission }) {
  const store = new Map<string, string>();
  const assign = vi.fn();
  const focus = vi.fn();
  const created: Array<{ title: string; options?: NotificationOptions; onclick: () => void }> = [];
  const requestPermission = vi.fn(async () => {
    MockNotification.permission = options.requestResult ?? options.permission;
    return MockNotification.permission;
  });
  class MockNotification {
    static permission: NotificationPermission = options.permission;
    static requestPermission = requestPermission;
    title: string;
    options?: NotificationOptions;
    onclick: () => void = () => {};
    constructor(title: string, notificationOptions?: NotificationOptions) {
      this.title = title;
      this.options = notificationOptions;
      created.push(this);
    }
  }
  (globalThis as { Notification?: unknown }).Notification = MockNotification;
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
    focus,
    location: { assign },
  };
  return { created, assign, focus, requestPermission };
}
