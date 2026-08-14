import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { EventEmitter } from 'node:events';

import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { encodeVardashVarlockPathSegment, registerVardashRoutes } from './api';
import { VardashLaunchRunner, type VardashChildProcess, type VardashProcessSpawnOptions, type VardashProcessSpawner } from './launch';
import { SqlcipherVardashStore } from './store';

const stores: SqlcipherVardashStore[] = [];

afterEach(async () => {
  await Promise.all(stores.map((store) => store.close()));
  stores.length = 0;
  vi.unstubAllGlobals();
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
  registerVardashRoutes(app, {
    validateWorkspaceRepo: async () => ({ repoRoot: '/workspace/repo-a' }),
    ...options,
    store,
  });
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

function pathSegment(value: string): string {
  return encodeVardashVarlockPathSegment(value);
}

describe('vardash API boundary', () => {

  it('does not expose repo-only vardash routes unless explicitly enabled', async () => {
    const { app, store } = await createApi();
    const key = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'TOKEN', kind: 'plain' });
    await store.createSavedValue({ repoId: 'repo-a', envKeyId: key.id, name: 'local', value: 'plain-value' });

    const readKeys = await app.request('/dashboard/api/vardash/repos/repo-a/env-keys');
    const writeKey = await postJson(app, '/dashboard/api/vardash/repos/repo-a/env-keys', { key: 'NEW_KEY', kind: 'secret' });
    const listValues = await app.request(`/dashboard/api/vardash/repos/repo-a/env-keys/${key.id}/saved-values`);
    const importEnv = await postJson(app, '/dashboard/api/vardash/repos/repo-a/import', {
      source: 'pasted-env',
      content: 'NEW_IMPORT=value',
      dryRun: false,
    });
    const process = await postJson(app, '/dashboard/api/vardash/repos/repo-a/process-definitions', {
      name: 'Dev server',
      command: 'npm run dev',
    });

    for (const response of [readKeys, writeKey, listValues, importEnv, process]) {
      expect(response.status).toBe(404);
    }
    expect((await store.listRepoEnvKeys('repo-a')).map((entry) => entry.key)).toEqual(['TOKEN']);
    expect(await store.listRepoProcessDefinitions('repo-a')).toEqual([]);
  });

  it('lists and writes secret values as metadata-only while plain values remain recallable', async () => {
    const { app } = await createApi({ exposeRepoOnlyRoutes: true });
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
    const { app } = await createApi({ exposeRepoOnlyRoutes: true });
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
    const { app } = await createApi({ exposeRepoOnlyRoutes: true });
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
    const { app, store } = await createApi({ exposeRepoOnlyRoutes: true });

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
    const { app, store } = await createApi({ exposeRepoOnlyRoutes: true });
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
    const { app, store } = await createApi({ exposeRepoOnlyRoutes: true });
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
    const { app, store } = await createApi({ exposeRepoOnlyRoutes: true });
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
    const { app } = await createApi({ exposeRepoOnlyRoutes: true });
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
    const { app, store } = await createApi({ exposeRepoOnlyRoutes: true });

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
    const { app } = await createApi({ exposeRepoOnlyRoutes: true });

    const legacy = await postJson(app, '/dashboard/api/vardash/repos/repo-a/process-definitions/import-legacy-dev-server', {
      dev_server_script: ' npm run dev ',
    });
    expect(legacy.status).toBe(200);
    const legacyBody = await legacy.json() as { process: { id: string } };
    expect(legacyBody).toMatchObject({
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
    const workerBody = await worker.json() as { process: { id: string } };
    expect(workerBody).toMatchObject({
      process: { repoId: 'repo-a', name: 'Worker', command: 'npm run worker', source: 'manual' },
    });

    const workerDefault = await postJson(
      app,
      `/dashboard/api/vardash/repos/repo-a/process-definitions/${workerBody.process.id}/default`,
      {},
    );
    expect(await workerDefault.json()).toMatchObject({
      process: { name: 'Worker', source: 'manual', isDefault: true },
    });
    const legacyDefault = await postJson(
      app,
      `/dashboard/api/vardash/repos/repo-a/process-definitions/${legacyBody.process.id}/default`,
      {},
    );
    expect(await legacyDefault.json()).toMatchObject({
      process: { name: 'Dev server', source: 'legacy_dev_server_script', isDefault: true },
    });

    const repoProcesses = await app.request('/dashboard/api/vardash/repos/repo-a/process-definitions');
    expect(await repoProcesses.json()).toMatchObject({
      processes: [
        { name: 'Dev server', source: 'legacy_dev_server_script', isDefault: true },
        { name: 'Worker', source: 'manual', isDefault: false },
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
    const { app, store } = await createApi({ exposeRepoOnlyRoutes: true });
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

  it('default workspace validation uses direct workspace lookup so qa-mode hidden workspace lists still load panels', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === 'http://localhost:3007/api/workspaces') {
        return Response.json({ success: true, data: [] });
      }
      if (url === 'http://localhost:3007/api/workspaces/ws-hidden') {
        return Response.json({
          success: true,
          data: {
            id: 'ws-hidden',
            task_id: null,
            container_ref: null,
            branch: 'vk/ws-hidden',
            agent_working_dir: '/workspace/repo-a',
            created_at: '2026-08-14T00:00:00.000Z',
            updated_at: '2026-08-14T00:00:00.000Z',
            archived: false,
            pinned: false,
            name: 'Hidden qa-mode workspace',
          },
        });
      }
      if (url === 'http://localhost:3007/api/workspaces/ws-hidden/repos') {
        return Response.json({
          success: true,
          data: [
            {
              id: 'repo-a',
              name: 'basic-seeded-repo',
              display_name: 'basic-seeded-repo',
              target_branch: 'main',
            },
          ],
        });
      }
      return new Response('not found', { status: 404 });
    });

    const { app, store } = await createApi({ validateWorkspaceRepo: undefined });
    await store.upsertRepoProcessDefinition({
      repoId: 'repo-a',
      name: 'Dev server',
      command: 'npm run dev',
      isDefault: true,
    });

    const overview = await app.request('/dashboard/api/vardash/workspaces/ws-hidden/repos/repo-a/env-overview');
    const processes = await app.request('/dashboard/api/vardash/workspaces/ws-hidden/repos/repo-a/process-definitions');
    const readiness = await app.request('/dashboard/api/vardash/workspaces/ws-hidden/repos/repo-a/launch/readiness');

    expect(overview.status).toBe(200);
    expect(processes.status).toBe(200);
    expect(readiness.status).toBe(200);
    expect(await overview.json()).toMatchObject({ repoId: 'repo-a', workspaceId: 'ws-hidden' });
    expect(await processes.json()).toMatchObject({
      processes: [{ name: 'Dev server' }],
    });
    expect(await readiness.json()).toMatchObject({
      workspaceId: 'ws-hidden',
      repoId: 'repo-a',
      launch: { repoRootResolved: true },
    });
    expect(calls).not.toContain('http://localhost:3007/api/workspaces');
    expect(calls).toContain('http://localhost:3007/api/workspaces/ws-hidden');
    expect(calls).toContain('http://localhost:3007/api/workspaces/ws-hidden/repos');
  });

  it('returns metadata-only launch readiness after workspace/repo/process ownership validation', async () => {
    const validated: Array<{ workspaceId: string; repoId: string }> = [];
    const { app, store } = await createApi({
      validateWorkspaceRepo: async (input) => { validated.push(input); return { repoRoot: '/workspace/repo-a' }; },
      varlockRuntime: { enabled: true, isAvailable: async () => true },
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
      varlock: { enabled: true, configured: true, available: true },
      selectionSemantics: 'workspace-null-inherits-repo-default',
      normalAgentEnvIncludesVardashSecrets: false,
    });
  });

  it('marks readiness ineligible when requested Varlock runtime is disabled or unavailable', async () => {
    const { app, store } = await createApi({
      validateWorkspaceRepo: async () => undefined,
      varlockRuntime: { enabled: true, isAvailable: async () => false },
    });
    const tokenKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'API_TOKEN', kind: 'secret', required: true });
    const token = await store.createSavedValue({ repoId: 'repo-a', envKeyId: tokenKey.id, name: 'local', value: 'readiness-varlock-secret' });
    await store.setRepoDefaultSelection({ repoId: 'repo-a', envKeyId: tokenKey.id, savedValueId: token.id });
    await store.upsertRepoProcessDefinition({ repoId: 'repo-a', name: 'Dev server', command: 'npm run dev', isDefault: true });

    const response = await app.request('/dashboard/api/vardash/workspaces/ws-a/repos/repo-a/launch/readiness?useVarlock=true');
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain('readiness-varlock-secret');
    expect(JSON.parse(text)).toMatchObject({
      eligible: false,
      varlock: { enabled: true, configured: true, available: false, reason: 'varlock_unavailable' },
    });

    const disabled = await createApi({ validateWorkspaceRepo: async () => undefined });
    const disabledKey = await disabled.store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'API_TOKEN', kind: 'secret', required: true });
    const disabledToken = await disabled.store.createSavedValue({ repoId: 'repo-a', envKeyId: disabledKey.id, name: 'local', value: 'disabled-varlock-secret' });
    await disabled.store.setRepoDefaultSelection({ repoId: 'repo-a', envKeyId: disabledKey.id, savedValueId: disabledToken.id });
    await disabled.store.upsertRepoProcessDefinition({ repoId: 'repo-a', name: 'Dev server', command: 'npm run dev', isDefault: true });
    const disabledResponse = await disabled.app.request('/dashboard/api/vardash/workspaces/ws-a/repos/repo-a/launch/readiness?useVarlock=true');
    const disabledText = await disabledResponse.text();
    expect(disabledText).not.toContain('disabled-varlock-secret');
    expect(JSON.parse(disabledText)).toMatchObject({
      eligible: false,
      varlock: { enabled: true, configured: false, available: false, reason: 'varlock_not_configured' },
    });
  });

  it('marks readiness ineligible when workspace repo root cannot be safely resolved', async () => {
    const { app, store } = await createApi({
      validateWorkspaceRepo: async () => undefined,
    });
    const tokenKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'API_TOKEN', kind: 'secret', required: true });
    const token = await store.createSavedValue({ repoId: 'repo-a', envKeyId: tokenKey.id, name: 'local', value: 'repo-root-secret' });
    await store.setRepoDefaultSelection({ repoId: 'repo-a', envKeyId: tokenKey.id, savedValueId: token.id });
    await store.upsertRepoProcessDefinition({ repoId: 'repo-a', name: 'Dev server', command: 'npm run dev', isDefault: true });

    const response = await app.request('/dashboard/api/vardash/workspaces/ws-multi/repos/repo-a/launch/readiness');
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain('repo-root-secret');
    expect(JSON.parse(text)).toMatchObject({
      eligible: false,
      launch: { repoRootResolved: false, reason: 'repo_root_unresolved' },
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

  it('validates workspace-scoped env and process mutations before touching repo metadata', async () => {
    const { app, store } = await createApi({
      validateWorkspaceRepo: async () => { throw new Error('not allowed metadata-secret'); },
    });
    const key = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'TOKEN', kind: 'secret', required: true });

    const overview = await app.request('/dashboard/api/vardash/workspaces/ws-denied/repos/repo-a/env-overview');
    const createKey = await postJson(app, '/dashboard/api/vardash/workspaces/ws-denied/repos/repo-a/env-keys', {
      key: 'NEW_KEY',
      kind: 'secret',
    });
    const createValue = await postJson(
      app,
      `/dashboard/api/vardash/workspaces/ws-denied/repos/repo-a/env-keys/${key.id}/saved-values`,
      { name: 'local', value: 'mutation-secret' },
    );
    const importEnv = await postJson(app, '/dashboard/api/vardash/workspaces/ws-denied/repos/repo-a/import', {
      source: 'pasted-env',
      content: 'NEW_IMPORT=secret',
      dryRun: false,
    });
    const process = await postJson(app, '/dashboard/api/vardash/workspaces/ws-denied/repos/repo-a/process-definitions', {
      name: 'Dev server',
      command: 'npm run dev',
    });

    for (const response of [overview, createKey, createValue, importEnv, process]) {
      expect(response.status).toBe(403);
      const text = await response.text();
      expect(text).toContain('workspace_repo_forbidden');
      expect(text).not.toContain('metadata-secret');
      expect(text).not.toContain('mutation-secret');
    }
    expect(await store.listRepoEnvKeys('repo-a')).toHaveLength(1);
    expect(await store.listSavedValues('repo-a', key.id)).toHaveLength(0);
    expect(await store.listRepoProcessDefinitions('repo-a')).toHaveLength(0);
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

  it('launches explicit vardash process, exposes secret-safe status, and stops by run id', async () => {
    const validated: Array<{ workspaceId: string; repoId: string }> = [];
    const spawner = new FakeVardashSpawner();
    const launchRunner = new VardashLaunchRunner({ spawner, idGenerator: () => 'run-api-1' });
    const { app, store } = await createApi({
      validateWorkspaceRepo: async (input) => {
        validated.push(input);
        return { repoRoot: '/workspace/repo-a' };
      },
      launchRunner,
      launchBaseEnv: { PATH: '/usr/bin', API_TOKEN: 'ambient-secret' },
    });
    const tokenKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'API_TOKEN', kind: 'secret', required: true });
    const token = await store.createSavedValue({ repoId: 'repo-a', envKeyId: tokenKey.id, name: 'local', value: 'launch-secret' });
    await store.setRepoDefaultSelection({ repoId: 'repo-a', envKeyId: tokenKey.id, savedValueId: token.id });
    const process = await store.upsertRepoProcessDefinition({ repoId: 'repo-a', name: 'Dev server', command: 'npm run dev', isDefault: true });

    const launch = await postJson(app, '/dashboard/api/vardash/workspaces/ws-a/repos/repo-a/launch', {
      processDefinitionId: process.id,
    });

    expect(launch.status).toBe(200);
    expect(await launch.json()).toEqual({ runId: 'run-api-1', status: 'running' });
    expect(validated).toEqual([{ workspaceId: 'ws-a', repoId: 'repo-a' }]);
    expect(spawner.calls[0]).toMatchObject({
      command: 'sh',
      args: ['-lc', 'npm run dev'],
      options: { cwd: '/workspace/repo-a', env: { PATH: '/usr/bin', API_TOKEN: 'launch-secret' }, stdio: 'ignore' },
    });

    const status = await app.request('/dashboard/api/vardash/launches/run-api-1/status');
    const statusText = await status.text();
    expect(status.status).toBe(200);
    expect(statusText).not.toContain('launch-secret');
    expect(statusText).not.toContain('ambient-secret');
    expect(JSON.parse(statusText)).toMatchObject({ runId: 'run-api-1', status: 'running', process: { id: process.id, name: 'Dev server' } });

    const stop = await postJson(app, '/dashboard/api/vardash/launches/run-api-1/stop', {});
    expect(await stop.json()).toEqual({ runId: 'run-api-1', status: 'stopping' });
    expect(spawner.children[0]?.killedWith).toBe('SIGTERM');
    expect(validated).toEqual([
      { workspaceId: 'ws-a', repoId: 'repo-a' },
      { workspaceId: 'ws-a', repoId: 'repo-a' },
      { workspaceId: 'ws-a', repoId: 'repo-a' },
    ]);
  });

  it('keeps launch errors generic and validates workspace/repo before resolving env', async () => {
    const { app } = await createApi({
      validateWorkspaceRepo: async () => { throw new Error('not allowed launch-secret'); },
      launchRunner: new VardashLaunchRunner({ spawner: new FakeVardashSpawner() }),
    });

    const response = await postJson(app, '/dashboard/api/vardash/workspaces/ws-a/repos/repo-a/launch', {});

    expect(response.status).toBe(403);
    const text = await response.text();
    expect(text).toContain('workspace_repo_forbidden');
    expect(text).not.toContain('launch-secret');
  });

  it('uses server-controlled Varlock runtime config and writes metadata-only schema when enabled', async () => {
    const schemaDir = await mkdtemp(join(tmpdir(), 'vardash-varlock-schema-'));
    const spawner = new FakeVardashSpawner();
    const { app, store } = await createApi({
      validateWorkspaceRepo: async () => ({ repoRoot: '/workspace/repo-a' }),
      launchRunner: new VardashLaunchRunner({ spawner }),
      varlockRuntime: {
        enabled: true,
        bin: 'server-varlock',
        schemaDir,
        isAvailable: async () => true,
      },
    });
    const tokenKey = await store.upsertRepoEnvKey({
      repoId: 'repo-a',
      key: 'API_TOKEN',
      kind: 'secret',
      required: true,
      description: 'do not leak description-secret',
    });
    const token = await store.createSavedValue({ repoId: 'repo-a', envKeyId: tokenKey.id, name: 'local', value: 'varlock-secret' });
    await store.setRepoDefaultSelection({ repoId: 'repo-a', envKeyId: tokenKey.id, savedValueId: token.id });
    await store.upsertRepoProcessDefinition({ repoId: 'repo-a', name: 'Dev server', command: 'npm run dev', isDefault: true });

    const response = await postJson(app, '/dashboard/api/vardash/workspaces/ws-a/repos/repo-a/launch', {
      useVarlock: true,
      varlockBin: '/tmp/malicious-varlock',
      varlockSchemaPath: '/tmp/schema',
    });
    expect(response.status).toBe(200);
    expect(spawner.calls[0]).toMatchObject({
      command: 'server-varlock',
      args: ['run', '--path', join(schemaDir, pathSegment('ws-a'), `${pathSegment('repo-a')}.env.schema`), '--inject', 'vars', '--', 'sh', '-lc', 'npm run dev'],
      options: {
        cwd: '/workspace/repo-a',
        env: { API_TOKEN: 'varlock-secret' },
        stdio: 'ignore',
      },
    });
    expect(spawner.calls[0]?.args).not.toContain('/tmp/malicious-varlock');
    expect(spawner.calls[0]?.args).not.toContain('/tmp/schema');
    expect(spawner.calls[0]?.options.env).not.toHaveProperty('__VARLOCK_ENV');
    const schema = await readFile(join(schemaDir, pathSegment('ws-a'), `${pathSegment('repo-a')}.env.schema`), 'utf8');
    expect(schema).toContain('API_TOKEN=');
    expect(schema).toContain('@sensitive');
    expect(schema).toContain('@required');
    expect(schema).not.toContain('varlock-secret');
    expect(schema).not.toContain('description-secret');

    const traversalSchemaPath = join(schemaDir, encodeVardashVarlockPathSegment('..'), `${encodeVardashVarlockPathSegment('repo-a')}.env.schema`);
    const relativeTraversalSchemaPath = relative(resolve(schemaDir), resolve(traversalSchemaPath));
    expect(encodeVardashVarlockPathSegment('..')).not.toBe('..');
    expect(relativeTraversalSchemaPath).not.toBe('..');
    expect(relativeTraversalSchemaPath.startsWith('..')).toBe(false);
    await expect(readFile(join(schemaDir, '..', 'repo-a.env.schema'), 'utf8')).rejects.toThrow();
  });

  it('blocks unavailable Varlock and unresolved repo roots with generic launch errors', async () => {
    const spawner = new FakeVardashSpawner();
    const { app, store } = await createApi({
      validateWorkspaceRepo: async () => undefined,
      launchRunner: new VardashLaunchRunner({ spawner }),
      varlockRuntime: { enabled: true, isAvailable: async () => false },
    });
    await store.upsertRepoProcessDefinition({ repoId: 'repo-a', name: 'Dev server', command: 'npm run dev', isDefault: true });

    const varlock = await postJson(app, '/dashboard/api/vardash/workspaces/ws-a/repos/repo-a/launch', { useVarlock: true });
    expect(varlock.status).toBe(409);
    expect(await varlock.json()).toEqual({ error: 'launch_failed' });
    expect(spawner.calls).toHaveLength(0);

    const unresolvedRoot = await postJson(app, '/dashboard/api/vardash/workspaces/ws-a/repos/repo-a/launch', {});
    const text = await unresolvedRoot.text();
    expect(unresolvedRoot.status).toBe(409);
    expect(text).toContain('launch_failed');
    expect(text).not.toContain('Repo root');
    expect(spawner.calls).toHaveLength(0);
  });

  it('validates status and stop access against the launched workspace/repo', async () => {
    const spawner = new FakeVardashSpawner();
    const launchRunner = new VardashLaunchRunner({ spawner, idGenerator: () => 'run-denied' });
    launchRunner.launch({
      workspaceId: 'ws-a',
      repoId: 'repo-a',
      process: {
        id: 'proc-a',
        repoId: 'repo-a',
        name: 'Dev server',
        command: 'npm run dev',
        cwd: null,
        source: 'manual',
        isDefault: true,
        createdAt: 'now',
        updatedAt: 'now',
      },
      command: 'sh',
      args: ['-lc', 'npm run dev'],
      env: { API_TOKEN: 'status-secret' },
      cwd: '/workspace/repo-a',
      missingRequired: [],
    });
    const { app } = await createApi({
      validateWorkspaceRepo: async () => { throw new Error('forbidden status-secret'); },
      launchRunner,
    });

    const status = await app.request('/dashboard/api/vardash/launches/run-denied/status');
    const statusText = await status.text();
    expect(status.status).toBe(403);
    expect(statusText).toContain('workspace_repo_forbidden');
    expect(statusText).not.toContain('status-secret');

    const stop = await postJson(app, '/dashboard/api/vardash/launches/run-denied/stop', {});
    const stopText = await stop.text();
    expect(stop.status).toBe(403);
    expect(stopText).toContain('workspace_repo_forbidden');
    expect(stopText).not.toContain('status-secret');
    expect(spawner.children[0]?.killedWith).toBeUndefined();
  });

});


class FakeVardashSpawner implements VardashProcessSpawner {
  readonly calls: Array<{ command: string; args: string[]; options: VardashProcessSpawnOptions }> = [];
  readonly children: FakeVardashChildProcess[] = [];

  spawn(command: string, args: string[], options: VardashProcessSpawnOptions): VardashChildProcess {
    this.calls.push({ command, args, options });
    const child = new FakeVardashChildProcess();
    this.children.push(child);
    return child;
  }
}

class FakeVardashChildProcess extends EventEmitter implements VardashChildProcess {
  killedWith: NodeJS.Signals | undefined;

  kill(signal?: NodeJS.Signals): boolean {
    this.killedWith = signal;
    return true;
  }
}
