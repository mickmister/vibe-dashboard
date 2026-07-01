import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

import { registerVardashRoutes } from './api';
import { SqlcipherVardashStore } from './store';

const stores: SqlcipherVardashStore[] = [];

afterEach(async () => {
  await Promise.all(stores.map((store) => store.close()));
  stores.length = 0;
});

async function createApi() {
  const root = await mkdtemp(join(tmpdir(), 'vardash-api-'));
  const store = new SqlcipherVardashStore({
    dbPath: join(root, 'private/vardash.db'),
    keyOptions: { privateDir: join(root, 'private/keys') },
  });
  stores.push(store);
  await store.migrate();
  const app = new Hono();
  registerVardashRoutes(app, { store });
  return { app, store };
}

async function postJson(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function putJson(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('vardash API boundary', () => {
  it('lists and writes secret values as metadata-only while plain values remain recallable', async () => {
    const { app } = await createApi();
    const secretKeyResponse = await postJson(app, '/dashboard/api/vardash/repos/repo-a/env-keys', {
      key: 'API_TOKEN',
      kind: 'secret',
      required: true,
    });
    const secretKeyBody = await secretKeyResponse.json() as { key: { id: string } };
    const plainKeyResponse = await postJson(app, '/dashboard/api/vardash/repos/repo-a/env-keys', {
      key: 'PORT',
      kind: 'plain',
    });
    const plainKeyBody = await plainKeyResponse.json() as { key: { id: string } };

    const secretCreate = await postJson(
      app,
      `/dashboard/api/vardash/repos/repo-a/env-keys/${secretKeyBody.key.id}/saved-values`,
      { name: 'prod', value: 'super-secret' },
    );
    expect(secretCreate.status).toBe(200);
    expect(await secretCreate.json()).toMatchObject({
      savedValue: { name: 'prod', kind: 'secret', hasValue: true },
    });
    const secretList = await app.request(`/dashboard/api/vardash/repos/repo-a/env-keys/${secretKeyBody.key.id}/saved-values`);
    expect(JSON.stringify(await secretList.json())).not.toContain('super-secret');

    const plainCreate = await postJson(
      app,
      `/dashboard/api/vardash/repos/repo-a/env-keys/${plainKeyBody.key.id}/saved-values`,
      { name: 'local', value: '3000' },
    );
    expect(await plainCreate.json()).toMatchObject({
      savedValue: { name: 'local', kind: 'plain', hasValue: true, value: '3000' },
    });
  });

  it('replace responses never expose secret plaintext and no reveal endpoint exists', async () => {
    const { app } = await createApi();
    const key = await postJson(app, '/dashboard/api/vardash/repos/repo-a/env-keys', {
      key: 'API_TOKEN',
      kind: 'secret',
    }).then((response) => response.json()) as { key: { id: string } };
    const saved = await postJson(
      app,
      `/dashboard/api/vardash/repos/repo-a/env-keys/${key.key.id}/saved-values`,
      { name: 'prod', value: 'old-secret' },
    ).then((response) => response.json()) as { savedValue: { id: string } };

    const replaced = await putJson(
      app,
      `/dashboard/api/vardash/repos/repo-a/env-keys/${key.key.id}/saved-values/${saved.savedValue.id}`,
      { name: 'prod', value: 'new-secret' },
    );

    expect(replaced.status).toBe(200);
    const bodyText = JSON.stringify(await replaced.json());
    expect(bodyText).not.toContain('new-secret');
    expect(bodyText).not.toContain('old-secret');
    const reveal = await app.request(
      `/dashboard/api/vardash/repos/repo-a/env-keys/${key.key.id}/saved-values/${saved.savedValue.id}/reveal`,
    );
    expect(reveal.status).toBe(404);
  });

  it('does not expose resolved secret env through the metadata API boundary', async () => {
    const { app } = await createApi();
    const key = await postJson(app, '/dashboard/api/vardash/repos/repo-a/env-keys', {
      key: 'API_TOKEN',
      kind: 'secret',
      required: true,
    }).then((response) => response.json()) as { key: { id: string } };
    const saved = await postJson(
      app,
      `/dashboard/api/vardash/repos/repo-a/env-keys/${key.key.id}/saved-values`,
      { name: 'prod', value: 'launch-secret' },
    ).then((response) => response.json()) as { savedValue: { id: string } };
    await postJson(app, '/dashboard/api/vardash/repos/repo-a/default-selections', {
      envKeyId: key.key.id,
      savedValueId: saved.savedValue.id,
    });

    const response = await app.request('/dashboard/api/vardash/workspaces/ws-1/repos/repo-a/resolve');
    expect(response.status).toBe(404);
  });

  it('preflights import conflicts and avoids partial mutation for duplicate keys', async () => {
    const { app, store } = await createApi();

    const duplicate = await postJson(app, '/dashboard/api/vardash/repos/repo-a/import', {
      source: 'pasted-env',
      content: 'API_TOKEN=one\nAPI_TOKEN=two\n',
    });

    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      conflicts: [{ key: 'API_TOKEN', reason: 'duplicate_key_in_import' }],
    });
    expect(await store.listRepoEnvKeys('repo-a')).toEqual([]);
  });

  it('preflights existing saved-value-name conflicts before applying import', async () => {
    const { app, store } = await createApi();
    const first = await postJson(app, '/dashboard/api/vardash/repos/repo-a/import', {
      source: 'pasted-env',
      content: 'API_TOKEN=one\nPORT=3000\n',
      plainKeys: ['PORT'],
      savedValueName: 'local',
    });
    expect(first.status).toBe(200);

    const second = await postJson(app, '/dashboard/api/vardash/repos/repo-a/import', {
      source: 'pasted-env',
      content: 'API_TOKEN=two\nNEW_KEY=value\n',
      savedValueName: 'local',
    });

    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      conflicts: [{ key: 'API_TOKEN', reason: 'saved_value_name_exists', savedValueName: 'local' }],
    });
    expect((await store.listRepoEnvKeys('repo-a')).map((key) => key.key)).toEqual(['API_TOKEN', 'PORT']);
  });

  it('preflights secret-to-plain import conflicts before creating earlier keys', async () => {
    const { app, store } = await createApi();
    const tokenKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'TOKEN', kind: 'secret' });
    await store.createSavedValue({
      repoId: 'repo-a',
      envKeyId: tokenKey.id,
      name: 'prod',
      value: 'existing-secret',
    });

    const response = await postJson(app, '/dashboard/api/vardash/repos/repo-a/import', {
      source: 'pasted-env',
      content: 'NEW_KEY=value\nTOKEN=not-plain\n',
      plainKeys: ['TOKEN'],
      savedValueName: 'local',
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      conflicts: [{ key: 'TOKEN', reason: 'secret_to_plain_with_existing_values' }],
    });
    expect((await store.listRepoEnvKeys('repo-a')).map((key) => key.key)).toEqual(['TOKEN']);
  });

  it('does not echo malformed pasted secret material in import diagnostics', async () => {
    const { app } = await createApi();
    const pastedSecret = 'sk-live-this-should-not-echo';

    const response = await postJson(app, '/dashboard/api/vardash/repos/repo-a/import', {
      source: 'pasted-env',
      content: pastedSecret,
      dryRun: true,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      diagnostics: [{ line: 1, message: 'Invalid environment variable key' }],
    });
    expect(JSON.stringify(body)).not.toContain(pastedSecret);
  });

  it('supports dry-run sample import plans without mutating the store', async () => {
    const { app, store } = await createApi();

    const dryRun = await postJson(app, '/dashboard/api/vardash/repos/repo-a/import', {
      source: 'sample-template',
      content: 'API_TOKEN=\nPORT=3000\n',
      plainKeys: ['PORT'],
      dryRun: true,
    });

    expect(dryRun.status).toBe(200);
    expect(await dryRun.json()).toMatchObject({
      dryRun: true,
      keys: [
        { key: 'API_TOKEN', kind: 'secret', required: true, willCreateSavedValue: false },
        { key: 'PORT', kind: 'plain', required: true, willCreateSavedValue: false },
      ],
      conflicts: [],
    });
    expect(await store.listRepoEnvKeys('repo-a')).toEqual([]);
  });
});
