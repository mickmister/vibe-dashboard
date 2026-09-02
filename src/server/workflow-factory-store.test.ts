import { afterEach, describe, expect, it } from 'vitest';
import { initVdDb, type VdDbHandle } from './database';
import { DbWorkflowFactoryStore, WorkflowFactoryStoreTransitionError } from './workflow-factory-store';

const handles: VdDbHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.db.destroy();
    handle.sqlite.close();
  }
});

describe('DbWorkflowFactoryStore', () => {
  it('creates durable factory work items and orders pending work deterministically', async () => {
    const { store } = await createStore();
    await store.createWorkItem(workItem({ itemId: 'low-old', priority: 1 }));
    await store.createWorkItem(workItem({ itemId: 'high', priority: 10 }));
    await store.createWorkItem(workItem({ itemId: 'low-new', priority: 1 }));

    const pending = await store.listWorkItems({ status: 'pending' });

    expect(pending.map((item) => item.itemId)).toEqual(['high', 'low-old', 'low-new']);
    expect(pending[0]).toMatchObject({
      status: 'pending',
      promptHash: expect.any(String),
      promptLength: 'Prompt for high'.length,
      source: 'workflow',
    });
  });

  it('moves work items through reserved and queued lifecycle with guarded transitions', async () => {
    const { store } = await createStore();
    await store.createWorkItem(workItem({ itemId: 'item-1' }));

    const reserved = await store.reserveWorkItem('item-1', {
      sessionId: 'session-1',
      bindingId: 'binding-1',
    });
    expect(reserved).toMatchObject({
      status: 'reserved',
      reservedSessionId: 'session-1',
      reservedBindingId: 'binding-1',
    });

    const queued = await store.markWorkItemQueued('item-1', { queueItemId: 'queue-1' });
    expect(queued).toMatchObject({
      status: 'queued',
      queueItemId: 'queue-1',
      attemptCount: 1,
    });
    await expect(store.reserveWorkItem('item-1', { sessionId: 'session-2' })).rejects.toBeInstanceOf(WorkflowFactoryStoreTransitionError);
  });

  it('releases reservations back to pending for safe retry after queue failure', async () => {
    const { store } = await createStore();
    await store.createWorkItem(workItem({ itemId: 'item-1' }));
    await store.reserveWorkItem('item-1', { sessionId: 'session-1' });

    const released = await store.releaseReservationForRetry('item-1', { message: 'queue failed' });

    expect(released).toMatchObject({
      status: 'pending',
      reservedSessionId: null,
      queueItemId: null,
      attemptCount: 0,
      lastError: { message: 'queue failed' },
    });
  });

  it('releases only stale reserved work items and preserves queued/terminal rows', async () => {
    const harness = await createStore();
    await harness.store.createWorkItem(workItem({ itemId: 'stale' }));
    await harness.store.createWorkItem(workItem({ itemId: 'fresh' }));
    await harness.store.createWorkItem(workItem({ itemId: 'queued' }));
    await harness.store.createWorkItem(workItem({ itemId: 'cancelled' }));

    harness.setNow(1_000);
    await harness.store.reserveWorkItem('stale', { sessionId: 'session-stale' });
    harness.setNow(20_000);
    await harness.store.reserveWorkItem('fresh', { sessionId: 'session-fresh' });
    await harness.store.reserveWorkItem('queued', { sessionId: 'session-queued' });
    await harness.store.markWorkItemQueued('queued', { queueItemId: 'queue-1' });
    await harness.store.reserveWorkItem('cancelled', { sessionId: 'session-cancelled' });
    await harness.store.cancelWorkItem('cancelled');

    harness.setNow(24_999);
    const released = await harness.store.releaseStaleReservations({ olderThanMs: 5_000 });

    expect(released.map((item) => item.itemId)).toEqual(['stale']);
    await expect(harness.store.getWorkItem('stale')).resolves.toMatchObject({
      status: 'pending',
      reservedSessionId: null,
      reservedAt: null,
      lastError: { reason: 'reservation_expired' },
    });
    await expect(harness.store.getWorkItem('fresh')).resolves.toMatchObject({
      status: 'reserved',
      reservedSessionId: 'session-fresh',
    });
    await expect(harness.store.getWorkItem('queued')).resolves.toMatchObject({
      status: 'queued',
      queueItemId: 'queue-1',
    });
    await expect(harness.store.getWorkItem('cancelled')).resolves.toMatchObject({
      status: 'cancelled',
      reservedSessionId: 'session-cancelled',
    });
  });
});

async function createStore() {
  const handle = await initVdDb({ path: ':memory:' });
  handles.push(handle);
  let now = 10_000;
  const store = new DbWorkflowFactoryStore({ db: handle.db, now: () => now++ });
  return { handle, store, setNow: (value: number) => { now = value; } };
}

function workItem(overrides: Partial<Parameters<DbWorkflowFactoryStore['createWorkItem']>[0]> = {}): Parameters<DbWorkflowFactoryStore['createWorkItem']>[0] {
  const itemId = overrides.itemId ?? 'item-1';
  return {
    itemId,
    workspaceId: 'ws-1',
    roleId: 'role-a',
    laneId: null,
    priority: 0,
    prompt: `Prompt for ${itemId}`,
    ...overrides,
  };
}
