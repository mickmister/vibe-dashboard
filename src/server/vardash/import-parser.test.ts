import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { importVardashEnv, parseDotenv } from './import-parser';
import { SqlcipherVardashStore } from './store';

const stores: SqlcipherVardashStore[] = [];

afterEach(async () => {
  await Promise.all(stores.map((store) => store.close()));
  stores.length = 0;
});

async function createStore() {
  const root = await mkdtemp(join(tmpdir(), 'vardash-import-'));
  const store = new SqlcipherVardashStore({
    dbPath: join(root, 'private/vardash.db'),
    keyOptions: { privateDir: join(root, 'private/keys') },
  });
  stores.push(store);
  await store.migrate();
  return store;
}

describe('parseDotenv', () => {
  it('handles comments, exports, quotes, escaped values, empty values, and invalid keys', () => {
    const parsed = parseDotenv(`
# full-line comment
export API_TOKEN=abc123 # inline comment
CLIENT_ID="client # not a comment"
CLIENT_SECRET='literal # not a comment'
EMPTY=
NO_ASSIGNMENT
ESCAPED="line\\nnext"
INVALID-KEY=value
`);

    expect(parsed.entries).toEqual([
      { key: 'API_TOKEN', value: 'abc123', line: 3, hasAssignment: true },
      { key: 'CLIENT_ID', value: 'client # not a comment', line: 4, hasAssignment: true },
      { key: 'CLIENT_SECRET', value: 'literal # not a comment', line: 5, hasAssignment: true },
      { key: 'EMPTY', value: '', line: 6, hasAssignment: true },
      { key: 'NO_ASSIGNMENT', value: '', line: 7, hasAssignment: false },
      { key: 'ESCAPED', value: 'line\nnext', line: 8, hasAssignment: true },
    ]);
    expect(parsed.diagnostics).toEqual([{ line: 9, message: 'Invalid environment variable key' }]);
  });

  it('does not echo malformed secret-like input in diagnostics', () => {
    const pastedSecret = 'sk-live-this-should-not-echo';
    const parsed = parseDotenv(pastedSecret);

    expect(parsed.entries).toEqual([]);
    expect(parsed.diagnostics).toEqual([{ line: 1, message: 'Invalid environment variable key' }]);
    expect(JSON.stringify(parsed.diagnostics)).not.toContain(pastedSecret);
  });
});

describe('importVardashEnv', () => {
  it('imports pasted .env values as secret by default with explicit plain overrides', async () => {
    const store = await createStore();
    const result = await importVardashEnv({
      store,
      repoId: 'repo-a',
      source: 'pasted-env',
      plainKeys: ['PORT'],
      savedValueName: 'local paste',
      content: `
API_TOKEN=secret-token
PORT=3000
EMPTY=
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.savedValues).toHaveLength(3);
    const keys = await store.listRepoEnvKeys('repo-a');
    expect(keys.map((key) => [key.key, key.kind, key.required])).toEqual([
      ['API_TOKEN', 'secret', true],
      ['EMPTY', 'secret', true],
      ['PORT', 'plain', true],
    ]);

    const tokenKey = keys.find((key) => key.key === 'API_TOKEN');
    const portKey = keys.find((key) => key.key === 'PORT');
    expect(tokenKey).toBeDefined();
    expect(portKey).toBeDefined();
    expect(await store.listSavedValues('repo-a', tokenKey!.id)).toMatchObject([
      { name: 'local paste', kind: 'secret', hasValue: true },
    ]);
    expect(JSON.stringify(await store.listSavedValues('repo-a', tokenKey!.id))).not.toContain('secret-token');
    expect(await store.listSavedValues('repo-a', portKey!.id)).toMatchObject([
      { name: 'local paste', kind: 'plain', hasValue: true, value: '3000' },
    ]);
  });

  it('seeds .env.sample keys as required metadata only and creates no values', async () => {
    const store = await createStore();
    const result = await importVardashEnv({
      store,
      repoId: 'repo-a',
      source: 'sample-template',
      plainKeys: ['PORT'],
      content: `
API_TOKEN=
PORT=3000
`,
    });

    expect(result.savedValues).toEqual([]);
    const keys = await store.listRepoEnvKeys('repo-a');
    expect(keys.map((key) => [key.key, key.kind, key.required])).toEqual([
      ['API_TOKEN', 'secret', true],
      ['PORT', 'plain', true],
    ]);
    const apiTokenKey = keys.find((key) => key.key === 'API_TOKEN');
    const portKey = keys.find((key) => key.key === 'PORT');
    expect(apiTokenKey).toBeDefined();
    expect(portKey).toBeDefined();
    await expect(store.listSavedValues('repo-a', apiTokenKey!.id)).resolves.toEqual([]);
    await expect(store.listSavedValues('repo-a', portKey!.id)).resolves.toEqual([]);
  });
});
