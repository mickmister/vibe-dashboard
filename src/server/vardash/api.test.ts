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

async function createApi(options: Parameters<typeof registerVardashRoutes>[1] = {}) {
  const root = await mkdtemp(join(tmpdir(), 'vardash-api-'));
  const store = new SqlcipherVardashStore({
    dbPath: join(root, 'private/vardash.db'),
    keyOptions: { privateDir: join(root, 'private/keys') },
  });
  stores.push(store);
  await store.migrate();
  const app = new Hono();
  registerVardashRoutes(app, { ...options, store });
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
      description: 'Do not put secret material here',
    });
    expect(await secretKeyResponse.clone().json()).toMatchObject({
      descriptionGuidance: 'Descriptions are metadata. Do not include secret material.',
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

  it('preflights sample-template secret-to-plain conflicts before creating earlier keys', async () => {
    const { app, store } = await createApi();
    const tokenKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'TOKEN', kind: 'secret' });
    await store.createSavedValue({
      repoId: 'repo-a',
      envKeyId: tokenKey.id,
      name: 'prod',
      value: 'existing-secret',
    });

    const response = await postJson(app, '/dashboard/api/vardash/repos/repo-a/import', {
      source: 'sample-template',
      content: 'NEW_KEY=\nTOKEN=\n',
      plainKeys: ['TOKEN'],
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

  it('exposes repo process definitions and legacy dev_server_script import without launching processes', async () => {
    const { app } = await createApi();

    const legacy = await postJson(app, '/dashboard/api/vardash/repos/repo-a/process-definitions/import-legacy-dev-server', {
      dev_server_script: ' npm run dev ',
    });
    expect(legacy.status).toBe(200);
    expect(await legacy.json()).toMatchObject({
      process: {
        repoId: 'repo-a',
        name: 'Dev server',
        command: 'npm run dev',
        source: 'legacy_dev_server_script',
        isDefault: true,
      },
    });

    const worker = await postJson(app, '/dashboard/api/vardash/repos/repo-a/process-definitions', {
      name: 'Worker',
      command: 'npm run worker',
      source: 'legacy_dev_server_script',
    });
    expect(worker.status).toBe(200);
    expect(await worker.json()).toMatchObject({
      process: { repoId: 'repo-a', name: 'Worker', command: 'npm run worker', source: 'manual' },
    });

    const repoProcesses = await app.request('/dashboard/api/vardash/repos/repo-a/process-definitions');
    expect(await repoProcesses.json()).toMatchObject({
      processes: [
        { name: 'Dev server', isDefault: true },
        { name: 'Worker', isDefault: false },
      ],
    });

    const workspaceProcesses = await app.request(
      '/dashboard/api/vardash/workspaces/workspace-1/repos/repo-a/process-definitions',
    );
    expect(await workspaceProcesses.json()).toMatchObject({
      processes: [
        { workspaceId: 'workspace-1', repoId: 'repo-a', name: 'Dev server' },
        { workspaceId: 'workspace-1', repoId: 'repo-a', name: 'Worker' },
      ],
    });
  });
  it('returns metadata-only repo env overview with defaults and workspace selections', async () => {
    const { app, store } = await createApi();
    const tokenKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'API_TOKEN', kind: 'secret', required: true });
    const portKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'PORT', kind: 'plain', required: true });
    const prodToken = await store.createSavedValue({ repoId: 'repo-a', envKeyId: tokenKey.id, name: 'prod', value: 'super-secret' });
    const localToken = await store.createSavedValue({ repoId: 'repo-a', envKeyId: tokenKey.id, name: 'local-dev', value: 'local-secret' });
    const localPort = await store.createSavedValue({ repoId: 'repo-a', envKeyId: portKey.id, name: 'local', value: '3000' });
    await store.setRepoDefaultSelection({ repoId: 'repo-a', envKeyId: tokenKey.id, savedValueId: prodToken.id });
    await store.setWorkspaceRepoSelection({ workspaceId: 'ws-a', repoId: 'repo-a', envKeyId: tokenKey.id, savedValueId: localToken.id });
    await store.setRepoDefaultSelection({ repoId: 'repo-a', envKeyId: portKey.id, savedValueId: localPort.id });

    const response = await app.request('/dashboard/api/vardash/workspaces/ws-a/repos/repo-a/env-overview');

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('super-secret');
    expect(text).not.toContain('local-secret');
    expect(JSON.parse(text)).toMatchObject({
      repoId: 'repo-a',
      workspaceId: 'ws-a',
      descriptionGuidance: 'Descriptions are metadata. Do not include secret material.',
      rows: [
        {
          key: { key: 'API_TOKEN', kind: 'secret', required: true },
          savedValueCount: 2,
          repoDefaultSelection: { savedValueId: prodToken.id, savedValueName: 'prod', kind: 'secret' },
          workspaceSelection: { mode: 'selected', savedValueId: localToken.id, savedValueName: 'local-dev', kind: 'secret' },
          savedValues: [
            { name: 'local-dev', kind: 'secret', hasValue: true },
            { name: 'prod', kind: 'secret', hasValue: true },
          ],
        },
        {
          key: { key: 'PORT', kind: 'plain', required: true },
          savedValueCount: 1,
          repoDefaultSelection: { savedValueId: localPort.id, savedValueName: 'local', kind: 'plain' },
          workspaceSelection: { mode: 'inherit' },
          savedValues: [{ name: 'local', kind: 'plain', hasValue: true, value: '3000' }],
        },
      ],
    });
  });

  it('returns metadata-only launch readiness after workspace/repo/process ownership validation', async () => {
    const validated: Array<{ workspaceId: string; repoId: string }> = [];
    const { app, store } = await createApi({
      validateWorkspaceRepo: async (input) => { validated.push(input); },
    });
    const tokenKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'API_TOKEN', kind: 'secret', required: true });
    const portKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'PORT', kind: 'plain', required: true });
    const token = await store.createSavedValue({ repoId: 'repo-a', envKeyId: tokenKey.id, name: 'workspace', value: 'super-secret-readiness' });
    const port = await store.createSavedValue({ repoId: 'repo-a', envKeyId: portKey.id, name: 'local', value: '3000' });
    await store.setWorkspaceRepoSelection({ workspaceId: 'ws-a', repoId: 'repo-a', envKeyId: tokenKey.id, savedValueId: token.id });
    await store.setRepoDefaultSelection({ repoId: 'repo-a', envKeyId: portKey.id, savedValueId: port.id });
    const process = await store.upsertRepoProcessDefinition({ repoId: 'repo-a', name: 'Dev server', command: 'npm run dev', isDefault: true });

    const response = await app.request(`/dashboard/api/vardash/workspaces/ws-a/repos/repo-a/launch/readiness?processDefinitionId=${process.id}&useVarlock=true`);

    expect(response.status).toBe(200);
    expect(validated).toEqual([{ workspaceId: 'ws-a', repoId: 'repo-a' }]);
    const text = await response.text();
    expect(text).not.toContain('super-secret-readiness');
    expect(text).not.toContain('3000');
    expect(JSON.parse(text)).toMatchObject({
      workspaceId: 'ws-a',
      repoId: 'repo-a',
      eligible: true,
      process: { id: process.id, repoId: 'repo-a', name: 'Dev server', isDefault: true },
      missingRequired: [],
      selectedValues: [
        { key: 'API_TOKEN', kind: 'secret', savedValueId: token.id, savedValueName: 'workspace' },
        { key: 'PORT', kind: 'plain', savedValueId: port.id, savedValueName: 'local' },
      ],
      varlock: { enabled: true, configured: true, available: null },
      selectionSemantics: 'workspace-null-inherits-repo-default',
      normalAgentEnvIncludesVardashSecrets: false,
    });
  });

  it('blocks readiness for repos outside the workspace and process ids outside the repo without secret echo', async () => {
    const { app, store } = await createApi({
      validateWorkspaceRepo: async () => { throw new Error('workspace_repo_not_found super-secret-owner'); },
    });
    await store.upsertRepoProcessDefinition({ repoId: 'repo-a', name: 'Dev server', command: 'npm run dev', isDefault: true });

    const response = await app.request('/dashboard/api/vardash/workspaces/ws-a/repos/repo-a/launch/readiness');

    expect(response.status).toBe(403);
    const text = await response.text();
    expect(text).toContain('workspace_repo_forbidden');
    expect(text).not.toContain('super-secret-owner');

    const { app: app2, store: store2 } = await createApi({ validateWorkspaceRepo: async () => undefined });
    await store2.upsertRepoProcessDefinition({ repoId: 'repo-a', name: 'Dev server', command: 'npm run dev', isDefault: true });
    await store2.upsertRepoProcessDefinition({ repoId: 'repo-b', name: 'Other', command: 'npm run other', isDefault: true });
    const otherProcess = (await store2.listRepoProcessDefinitions('repo-b'))[0];
    expect(otherProcess).toBeDefined();

    const wrongProcess = await app2.request(`/dashboard/api/vardash/workspaces/ws-a/repos/repo-a/launch/readiness?processDefinitionId=${otherProcess!.id}`);
    expect(wrongProcess.status).toBe(404);
    expect(await wrongProcess.json()).toEqual({ error: 'process_not_found' });
  });

  it('reports missing required values by metadata only and never exposes raw resolved env', async () => {
    const { app, store } = await createApi({ validateWorkspaceRepo: async () => undefined });
    const tokenKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'API_TOKEN', kind: 'secret', required: true });
    await store.createSavedValue({ repoId: 'repo-a', envKeyId: tokenKey.id, name: 'unused', value: 'unused-secret' });
    await store.upsertRepoProcessDefinition({ repoId: 'repo-a', name: 'Dev server', command: 'npm run dev', isDefault: true });

    const response = await app.request('/dashboard/api/vardash/workspaces/ws-a/repos/repo-a/launch/readiness');

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('unused-secret');
    expect(JSON.parse(text)).toMatchObject({
      eligible: false,
      missingRequired: [{ key: 'API_TOKEN', kind: 'secret', required: true }],
      selectedValues: [{ key: 'API_TOKEN', kind: 'secret', savedValueId: null, savedValueName: null }],
    });
  });

});
