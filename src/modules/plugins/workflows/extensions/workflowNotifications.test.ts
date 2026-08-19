import { describe, expect, it } from 'vitest';
import {
  InMemoryWorkflowNotificationProvider,
  buildMetaWorkflowTerminalNotification,
  buildWorkflowRunTerminalNotification,
  shouldNotifyWorkflowRun,
} from './workflowNotifications';

describe('workflow notification providers 7XWL', () => {
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
});
