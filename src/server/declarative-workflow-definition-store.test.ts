import { afterEach, describe, expect, it } from 'vitest';
import { initVdDb, type VdDbHandle } from './database';
import { DbDeclarativeWorkflowDefinitionStore } from './declarative-workflow-definition-store';

const handles: VdDbHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.db.destroy();
    handle.sqlite.close();
  }
});

describe('DbDeclarativeWorkflowDefinitionStore', () => {
  it('saves normalized definitions and lists active records', async () => {
    const { store } = await createStore();

    const saved = await store.saveDefinition({ definition: definition('custom-round') });

    expect(saved).toMatchObject({ definitionId: 'custom-round', version: 1, status: 'active', name: 'Custom round' });
    expect(saved.definition).toMatchObject({ id: 'custom-round', policies: { refsOnlyStorage: true, allowTruncatedSourceDelivery: false } });
    expect(saved.definitionHash).toEqual(expect.any(String));
    await expect(store.listDefinitions()).resolves.toMatchObject([{ definitionId: 'custom-round', status: 'active' }]);
  });

  it('disables definitions non-destructively and excludes disabled by default', async () => {
    const { store } = await createStore();
    await store.saveDefinition({ definition: definition('custom-round') });

    const disabled = await store.disableDefinition('custom-round');

    expect(disabled).toMatchObject({ definitionId: 'custom-round', status: 'disabled', disabledAt: expect.any(Number) });
    await expect(store.getDefinition('custom-round')).resolves.toBeNull();
    await expect(store.getDefinition('custom-round', 1, { includeDisabled: true })).resolves.toMatchObject({ status: 'disabled' });
    await expect(store.listDefinitions()).resolves.toEqual([]);
    await expect(store.listDefinitions({ includeDisabled: true })).resolves.toHaveLength(1);
  });

  it('upserts the same definition id/version without creating duplicates', async () => {
    const { store } = await createStore();
    await store.saveDefinition({ definition: definition('custom-round', 'First') });
    await store.saveDefinition({ definition: definition('custom-round', 'Second') });

    const definitions = await store.listDefinitions({ includeDisabled: true });

    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({ name: 'Second' });
  });

  it('rejects invalid definitions through shared validators', async () => {
    const { store } = await createStore();

    await expect(store.saveDefinition({ definition: { id: 'bad' } })).rejects.toThrow(/definition name is required/);
  });
});

async function createStore() {
  const handle = await initVdDb({ path: ':memory:' });
  handles.push(handle);
  const store = new DbDeclarativeWorkflowDefinitionStore({ db: handle.db, now: (() => { let value = 10; return () => value++; })() });
  return { handle, store };
}

function definition(id: string, name = 'Custom round') {
  return {
    id,
    version: 1,
    name,
    trigger: 'manual',
    inputs: {
      task: { type: 'string', required: true },
      workspaceId: { type: 'string', required: true },
      sourceSessionId: { type: 'string', required: false },
      reviewSessionId: { type: 'string', required: false },
      overseerSessionId: { type: 'string', required: false },
    },
    policies: { refsOnlyStorage: true },
    steps: [
      {
        id: 'resolve_custom',
        type: 'resolve_roles',
        workspaceInput: 'workspaceId',
        roles: [
          { key: 'source', sessionInput: 'sourceSessionId', defaultRole: 'implementer' },
          { key: 'review', sessionInput: 'reviewSessionId', defaultRole: 'reviewer' },
        ],
      },
      { id: 'ask_source', type: 'queue_prompt', target: 'source', template: '{{inputs.task}}' },
      { id: 'wait_source', type: 'wait_for_next_completed_response', target: 'source', after: 'ask_source' },
      { id: 'ask_review', type: 'pipe_response', source: 'wait_source', target: 'review', template: 'Review: {{source.response}}' },
      { id: 'wait_review', type: 'wait_for_next_completed_response', target: 'review', after: 'ask_review' },
      { id: 'notify_overseer', type: 'notify_overseer', sessionInput: 'overseerSessionId', template: 'Done: {{responses.wait_review}}' },
      { id: 'complete', type: 'complete' },
    ],
    outputs: {},
  };
}
