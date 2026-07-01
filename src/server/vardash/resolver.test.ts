import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveVardashRepoEnv } from './resolver';
import { SqlcipherVardashStore } from './store';

const stores: SqlcipherVardashStore[] = [];

afterEach(async () => {
  await Promise.all(stores.map((store) => store.close()));
  stores.length = 0;
});

async function createStore() {
  const root = await mkdtemp(join(tmpdir(), 'vardash-resolver-'));
  const store = new SqlcipherVardashStore({
    dbPath: join(root, 'private/vardash.db'),
    keyOptions: { privateDir: join(root, 'private/keys') },
  });
  stores.push(store);
  await store.migrate();
  return store;
}

describe('resolveVardashRepoEnv', () => {
  it('resolves workspace-repo selections over repo defaults and omits secret metadata values', async () => {
    const store = await createStore();
    const tokenKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'API_TOKEN', kind: 'secret', required: true });
    const portKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'PORT', kind: 'plain', required: true });
    const defaultToken = await store.createSavedValue({ repoId: 'repo-a', envKeyId: tokenKey.id, name: 'repo', value: 'repo-token' });
    const workspaceToken = await store.createSavedValue({ repoId: 'repo-a', envKeyId: tokenKey.id, name: 'workspace', value: 'workspace-token' });
    const port = await store.createSavedValue({ repoId: 'repo-a', envKeyId: portKey.id, name: 'local', value: '3000' });
    await store.setRepoDefaultSelection({ repoId: 'repo-a', envKeyId: tokenKey.id, savedValueId: defaultToken.id });
    await store.setRepoDefaultSelection({ repoId: 'repo-a', envKeyId: portKey.id, savedValueId: port.id });
    await store.setWorkspaceRepoSelection({
      workspaceId: 'workspace-1',
      repoId: 'repo-a',
      envKeyId: tokenKey.id,
      savedValueId: workspaceToken.id,
    });

    const resolved = await resolveVardashRepoEnv({ store, repoId: 'repo-a', workspaceId: 'workspace-1' });

    expect(resolved.canLaunch).toBe(true);
    expect(resolved.env).toEqual({ API_TOKEN: 'workspace-token', PORT: '3000' });
    expect(resolved.missingRequired).toEqual([]);
    expect(JSON.stringify(resolved.metadata)).not.toContain('workspace-token');
    expect(resolved.metadata).toContainEqual({
      key: 'API_TOKEN',
      kind: 'secret',
      savedValueId: workspaceToken.id,
      savedValueName: 'workspace',
    });
  });

  it('uses repo defaults when workspace selection is unset or explicitly null', async () => {
    const store = await createStore();
    const tokenKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'API_TOKEN', kind: 'secret', required: true });
    const defaultToken = await store.createSavedValue({ repoId: 'repo-a', envKeyId: tokenKey.id, name: 'repo', value: 'repo-token' });
    await store.setRepoDefaultSelection({ repoId: 'repo-a', envKeyId: tokenKey.id, savedValueId: defaultToken.id });

    await expect(resolveVardashRepoEnv({ store, repoId: 'repo-a', workspaceId: 'workspace-1' })).resolves.toMatchObject({
      env: { API_TOKEN: 'repo-token' },
      selectionSemantics: 'workspace-null-inherits-repo-default',
    });

    await store.setWorkspaceRepoSelection({
      workspaceId: 'workspace-1',
      repoId: 'repo-a',
      envKeyId: tokenKey.id,
      savedValueId: null,
    });

    await expect(resolveVardashRepoEnv({ store, repoId: 'repo-a', workspaceId: 'workspace-1' })).resolves.toMatchObject({
      env: { API_TOKEN: 'repo-token' },
      selectionSemantics: 'workspace-null-inherits-repo-default',
    });
  });

  it('reports unset required values and blocks launch readiness', async () => {
    const store = await createStore();
    await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'API_TOKEN', kind: 'secret', required: true });

    const resolved = await resolveVardashRepoEnv({ store, repoId: 'repo-a' });

    expect(resolved.canLaunch).toBe(false);
    expect(resolved.env).toEqual({});
    expect(resolved.missingRequired.map((key) => key.key)).toEqual(['API_TOKEN']);
  });
});
