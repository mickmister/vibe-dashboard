import { afterEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { initVdDb, type VdDbHandle } from './database';
import { DbResponsePipeStore, ResponsePipeStoreTransitionError } from './response-pipe-store';

const handles: VdDbHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.db.destroy();
    handle.sqlite.close();
  }
});

describe('DbResponsePipeStore', () => {
  it('initializes response pipe tables and stores refs-only collection/delivery records', async () => {
    const { handle, store } = await createStore();

    const tables = await sql<{ name: string }>`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('ResponseCollection', 'ResponsePipeDelivery')
      ORDER BY name
    `.execute(handle.db);
    expect(tables.rows.map((table) => table.name)).toEqual(['ResponseCollection', 'ResponsePipeDelivery']);

    const collection = await store.createCollection({
      collectionId: 'collection-1',
      workflowInstanceId: 'instance-1',
      triggerId: 'trigger-1',
      expectedCount: 1,
      metadata: { purpose: 'manual-pipe' },
    });
    expect(collection).toMatchObject({
      collectionId: 'collection-1',
      mode: 'manual',
      status: 'collecting',
      expectedCount: 1,
      metadata: { purpose: 'manual-pipe' },
    });

    const planned = await store.planDelivery(deliveryInput());
    expect(planned.created).toBe(true);
    expect(planned.delivery).toMatchObject({
      deliveryId: 'delivery-1',
      collectionId: 'collection-1',
      status: 'planned',
      sourceExecutionProcessId: 'exec-source',
      targetSessionId: 'session-b',
      templateHash: 'template-hash',
      renderedPromptHash: null,
      renderedPromptLength: null,
      queueItemId: null,
    });
    expect(planned.delivery).not.toHaveProperty('renderedPrompt');
    expect(planned.delivery).not.toHaveProperty('prompt');
  });

  it('moves a delivery through planned rendered queued lifecycle with guarded transitions', async () => {
    const { store } = await createStore();
    await store.createCollection({ collectionId: 'collection-1' });
    await store.planDelivery(deliveryInput());

    const rendered = await store.markDeliveryRendered('delivery-1', {
      promptHash: 'prompt-hash',
      promptLength: 42,
    });
    expect(rendered).toMatchObject({
      status: 'rendered',
      renderedPromptHash: 'prompt-hash',
      renderedPromptLength: 42,
    });

    const queued = await store.markDeliveryQueued('delivery-1', {
      queueItemId: 'queue-1',
    });
    expect(queued).toMatchObject({
      status: 'queued',
      queueItemId: 'queue-1',
      attemptCount: 1,
    });

    await expect(store.markDeliveryRendered('delivery-1', { promptHash: 'again', promptLength: 1 })).rejects.toBeInstanceOf(ResponsePipeStoreTransitionError);
  });

  it('dedupes planned deliveries by dedupe key without creating a conflicting row', async () => {
    const { store } = await createStore();
    await store.createCollection({ collectionId: 'collection-1' });
    const first = await store.planDelivery(deliveryInput({ deliveryId: 'delivery-1', dedupeKey: 'dedupe' }));
    const second = await store.planDelivery(deliveryInput({ deliveryId: 'delivery-2', dedupeKey: 'dedupe' }));

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.delivery.deliveryId).toBe('delivery-1');
  });
});

async function createStore() {
  const handle = await initVdDb({ path: ':memory:' });
  handles.push(handle);
  let now = 10_000;
  const store = new DbResponsePipeStore({ db: handle.db, now: () => now++ });
  return { handle, store };
}

function deliveryInput(overrides: Partial<Parameters<DbResponsePipeStore['planDelivery']>[0]> = {}): Parameters<DbResponsePipeStore['planDelivery']>[0] {
  return {
    deliveryId: 'delivery-1',
    collectionId: 'collection-1',
    workflowInstanceId: 'instance-1',
    workflowRunId: 'run-1',
    triggerId: 'trigger-1',
    sourceWorkspaceId: 'ws-1',
    sourceSessionId: 'session-a',
    sourceExecutionProcessId: 'exec-source',
    sourceCompletedAt: 9_000,
    targetWorkspaceId: 'ws-1',
    targetSessionId: 'session-b',
    templateId: 'builtin.pipe',
    templateVersion: 1,
    templateHash: 'template-hash',
    dedupeKey: 'dedupe-1',
    ...overrides,
  };
}
