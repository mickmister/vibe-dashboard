import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SqlcipherVardashStore } from './store';

const stores: SqlcipherVardashStore[] = [];

afterEach(async () => {
  await Promise.all(stores.map((store) => store.close()));
  stores.length = 0;
});

async function createStore() {
  const root = await mkdtemp(join(tmpdir(), 'vardash-store-'));
  const store = new SqlcipherVardashStore({
    dbPath: join(root, 'private/vardash.db'),
    keyOptions: { privateDir: join(root, 'private/keys') },
  });
  stores.push(store);
  await store.migrate();
  return { root, store };
}

describe('SqlcipherVardashStore', () => {
  it('stores repo env keys, saved values, repo defaults, and workspace-repo overrides', async () => {
    const { store } = await createStore();
    const secretKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'API_TOKEN', kind: 'secret', required: true });
    const plainKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'PORT', kind: 'plain' });
    const defaultToken = await store.createSavedValue({ repoId: 'repo-a', envKeyId: secretKey.id, name: 'default', value: 'repo-token' });
    const workspaceToken = await store.createSavedValue({ repoId: 'repo-a', envKeyId: secretKey.id, name: 'workspace', value: 'workspace-token' });
    const port = await store.createSavedValue({ repoId: 'repo-a', envKeyId: plainKey.id, name: 'local', value: '3000' });

    await store.setRepoDefaultSelection({ repoId: 'repo-a', envKeyId: secretKey.id, savedValueId: defaultToken.id });
    await store.setRepoDefaultSelection({ repoId: 'repo-a', envKeyId: plainKey.id, savedValueId: port.id });
    await store.setWorkspaceRepoSelection({ workspaceId: 'workspace-1', repoId: 'repo-a', envKeyId: secretKey.id, savedValueId: workspaceToken.id });

    const repoBKey = await store.upsertRepoEnvKey({ repoId: 'repo-b', key: 'API_TOKEN', kind: 'secret', required: true });
    await expect(
      store.setWorkspaceRepoSelection({
        workspaceId: 'workspace-1',
        repoId: 'repo-b',
        envKeyId: repoBKey.id,
        savedValueId: workspaceToken.id,
      }),
    ).rejects.toThrow('does not belong');

    await expect(store.resolveRepoEnvForLaunch({ repoId: 'repo-a' })).resolves.toMatchObject({
      env: { API_TOKEN: 'repo-token', PORT: '3000' },
      missingRequired: [],
    });
    await expect(store.resolveRepoEnvForLaunch({ repoId: 'repo-a', workspaceId: 'workspace-1' })).resolves.toMatchObject({
      env: { API_TOKEN: 'workspace-token', PORT: '3000' },
      missingRequired: [],
    });
    const repoB = await store.resolveRepoEnvForLaunch({ repoId: 'repo-b', workspaceId: 'workspace-1' });
    expect(repoB.env).toEqual({});
    expect(repoB.missingRequired.map((key) => key.key)).toEqual(['API_TOKEN']);
  });

  it('returns metadata-only for secrets while allowing plain value recall', async () => {
    const { store } = await createStore();
    const secretKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'SECRET', kind: 'secret' });
    const plainKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'MODE', kind: 'plain' });

    const secret = await store.createSavedValue({ repoId: 'repo-a', envKeyId: secretKey.id, name: 'prod', value: 'do-not-return' });
    const plain = await store.createSavedValue({ repoId: 'repo-a', envKeyId: plainKey.id, name: 'dev', value: 'local' });
    expect(secret).toMatchObject({ name: 'prod', kind: 'secret', hasValue: true });
    expect(secret).not.toHaveProperty('value');
    expect(plain).toMatchObject({ name: 'dev', kind: 'plain', hasValue: true, value: 'local' });

    const replaced = await store.replaceSavedValue({ repoId: 'repo-a', envKeyId: secretKey.id, savedValueId: secret.id, name: 'prod', value: 'still-hidden' });
    expect(replaced).not.toHaveProperty('value');

    const secretList = await store.listSavedValues('repo-a', secretKey.id);
    expect(JSON.stringify(secretList)).not.toContain('still-hidden');
  });

  it('does not reveal a secret when replaceSavedValue is called with a different plain env key', async () => {
    const { store } = await createStore();
    const secretKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'SECRET', kind: 'secret' });
    const plainKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'MODE', kind: 'plain' });
    const secret = await store.createSavedValue({
      repoId: 'repo-a',
      envKeyId: secretKey.id,
      name: 'prod',
      value: 'must-never-leak',
    });

    await expect(
      store.replaceSavedValue({
        repoId: 'repo-a',
        envKeyId: plainKey.id,
        savedValueId: secret.id,
        name: 'prod',
        value: 'ignored',
      }),
    ).rejects.toThrow('exactly one');

    const plainList = await store.listSavedValues('repo-a', plainKey.id);
    const secretList = await store.listSavedValues('repo-a', secretKey.id);
    expect(plainList).toEqual([]);
    expect(JSON.stringify(secretList)).not.toContain('must-never-leak');
  });

  it('blocks secret-to-plain downgrades once saved values exist but allows plain-to-secret', async () => {
    const { store } = await createStore();
    const secretKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'TOKEN', kind: 'secret' });
    await store.createSavedValue({
      repoId: 'repo-a',
      envKeyId: secretKey.id,
      name: 'prod',
      value: 'already-secret',
    });

    await expect(
      store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'TOKEN', kind: 'plain' }),
    ).rejects.toThrow('Cannot change vardash env key from secret to plain');

    const plainKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'MODE', kind: 'plain' });
    await store.createSavedValue({ repoId: 'repo-a', envKeyId: plainKey.id, name: 'dev', value: 'local' });
    await expect(
      store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'MODE', kind: 'secret' }),
    ).resolves.toMatchObject({ key: 'MODE', kind: 'secret' });
    const modeValues = await store.listSavedValues('repo-a', plainKey.id);
    expect(modeValues[0]).not.toHaveProperty('value');
  });

  it('rejects null selections for env keys outside the requested repo', async () => {
    const { store } = await createStore();
    const repoAKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'TOKEN', kind: 'secret' });

    await expect(
      store.setRepoDefaultSelection({ repoId: 'repo-b', envKeyId: repoAKey.id, savedValueId: null }),
    ).rejects.toThrow('Expected vardash row was not found');

    await expect(
      store.setWorkspaceRepoSelection({
        workspaceId: 'workspace-1',
        repoId: 'repo-b',
        envKeyId: repoAKey.id,
        savedValueId: null,
      }),
    ).rejects.toThrow('Expected vardash row was not found');
  });

  it('persists encrypted SQLCipher data and rejects missing or corrupt keys for an existing DB', async () => {
    const { root, store } = await createStore();
    const key = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'SECRET', kind: 'secret' });
    await store.createSavedValue({ repoId: 'repo-a', envKeyId: key.id, name: 'prod', value: 'encrypted-at-rest' });
    await store.close();

    const header = (await readFile(join(root, 'private/vardash.db'))).subarray(0, 16).toString('utf8');
    expect(header).not.toBe('SQLite format 3\0');

    const reopened = new SqlcipherVardashStore({
      dbPath: join(root, 'private/vardash.db'),
      keyOptions: { privateDir: join(root, 'private/keys') },
    });
    stores.push(reopened);
    await reopened.migrate();
    await expect(reopened.listSavedValues('repo-a', key.id)).resolves.toHaveLength(1);
    await reopened.close();

    await writeFile(join(root, 'private/keys/sqlcipher.key'), 'corrupt-key\n');
    const corrupt = new SqlcipherVardashStore({
      dbPath: join(root, 'private/vardash.db'),
      keyOptions: { privateDir: join(root, 'private/keys') },
    });
    stores.push(corrupt);
    await expect(corrupt.migrate()).rejects.toThrow('corrupt or unsupported');
    await corrupt.close();

    await rm(join(root, 'private/keys/sqlcipher.key'));
    const missing = new SqlcipherVardashStore({
      dbPath: join(root, 'private/vardash.db'),
      keyOptions: { privateDir: join(root, 'private/keys') },
    });
    stores.push(missing);
    await expect(missing.migrate()).rejects.toThrow('key file is missing');
  });
});
