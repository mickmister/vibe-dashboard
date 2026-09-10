import { afterEach, describe, expect, it, vi } from 'vitest';
import { initVdDb, type VdDbHandle } from './database';
import {
  DbWorkflowWebhookInboxStore,
  WorkflowWebhookWakeup,
  parseVkWorkflowWebhookPayload,
  signVkWebhookPayload,
  verifyVkWebhookSignature,
} from './workflow-webhook-inbox';

const handles: VdDbHandle[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const handle of handles.splice(0)) {
    await handle.db.destroy();
    handle.sqlite.close();
  }
});

describe('workflow webhook inbox', () => {
  it('verifies VK HMAC signatures over timestamp.body', () => {
    const body = JSON.stringify(payload());
    const signature = signVkWebhookPayload('secret', '1786200000', body);

    expect(() => verifyVkWebhookSignature({
      secret: 'secret',
      timestamp: '1786200000',
      algorithm: 'hmac-sha256',
      signature,
      body,
      now: 1786200000_000,
    })).not.toThrow();
    expect(() => verifyVkWebhookSignature({
      secret: 'secret',
      timestamp: '1786200000',
      algorithm: 'hmac-sha256',
      signature: signVkWebhookPayload('other', '1786200000', body),
      body,
      now: 1786200000_000,
    })).toThrow(/Invalid VK webhook signature/);
    expect(() => verifyVkWebhookSignature({
      secret: 'secret',
      timestamp: '1786190000',
      algorithm: 'hmac-sha256',
      signature,
      body,
      now: 1786200000_000,
    })).toThrow(/timestamp is outside replay tolerance/);
  });

  it('parses refs-only terminal execution payloads and drops message fields', () => {
    const event = parseVkWorkflowWebhookPayload({ ...payload(), title: 'title text', message: 'full message text' });

    expect(event).toMatchObject({
      source: 'vk',
      deliveryId: 'delivery-1',
      dedupeKey: 'delivery:delivery-1',
      eventType: 'execution.completed',
      eventStatus: 'completed',
      workspaceId: 'ws-1',
      sessionId: 'session-1',
      executionProcessId: 'exec-1',
    });
    expect(JSON.stringify(event.payload)).not.toContain('full message text');
  });

  it('accepts execution.killed terminal events', () => {
    const event = parseVkWorkflowWebhookPayload({ ...payload(), event_type: 'execution.killed', delivery_id: 'delivery-killed' });

    expect(event).toMatchObject({
      deliveryId: 'delivery-killed',
      eventType: 'execution.killed',
      eventStatus: 'killed',
      executionProcessId: 'exec-1',
    });
  });

  it('stores and dedupes inbox events', async () => {
    const { store } = await createStore();
    const event = parseVkWorkflowWebhookPayload(payload());

    const first = await store.insertEvent({ event, signatureHeader: 'sha256=abc', timestampHeader: '1786200000' });
    const duplicate = await store.insertEvent({ event, signatureHeader: 'sha256=abc', timestampHeader: '1786200000' });

    expect(first).toMatchObject({ inserted: true, duplicate: false, inbox: { status: 'received', eventType: 'execution.completed' } });
    expect(duplicate).toMatchObject({ inserted: false, duplicate: true, inbox: { inboxId: first.inbox.inboxId } });
    await expect(store.listEvents()).resolves.toMatchObject({ events: [{ inboxId: first.inbox.inboxId }] });
  });

  it('coalesces overlapping wakeups into a follow-up pass without parallel runReady calls', async () => {
    const releases: Array<() => void> = [];
    const runReady = vi.fn(async () => {
      await new Promise<void>((resolve) => { releases.push(resolve); });
    });
    const wakeup = new WorkflowWebhookWakeup(runReady);

    const first = wakeup.trigger();
    await waitUntil(() => releases.length === 1);
    await expect(wakeup.trigger()).resolves.toEqual({ started: false, queued: true });
    expect(runReady).toHaveBeenCalledTimes(1);

    releases[0]!();
    await waitUntil(() => releases.length === 2);
    expect(runReady).toHaveBeenCalledTimes(2);
    releases[1]!();
    await expect(first).resolves.toEqual({ started: true, queued: false, passes: 2, result: undefined });
  });
});

async function createStore() {
  const handle = await initVdDb({ path: ':memory:' });
  handles.push(handle);
  const store = new DbWorkflowWebhookInboxStore({ db: handle.db, now: (() => { let value = 1; return () => value++; })(), createId: (() => { let value = 0; return () => `inbox-${++value}`; })() });
  return { handle, store };
}

function payload() {
  return {
    event_type: 'execution.completed',
    delivery_id: 'delivery-1',
    timestamp: '2026-08-08T00:00:00.000Z',
    workspace_id: 'ws-1',
    session_id: 'session-1',
    execution_id: 'exec-1',
    queue_item_id: 'queue-1',
    exit_code: 0,
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('condition not met');
}
