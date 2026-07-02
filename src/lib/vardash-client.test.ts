import { describe, expect, it, vi } from 'vitest';

import {
  VardashClient,
  type VardashSavedValueMetadata,
} from './vardash-client';

describe('VardashClient', () => {
  it('maps metadata API requests without hand-rolled response shapes', async () => {
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/dashboard/api/vardash/workspaces/ws-a/repos/repo-a/env-overview') {
        return jsonResponse({ repoId: 'repo-a', workspaceId: 'ws-a', rows: [], descriptionGuidance: 'Descriptions are metadata. Do not include secret material.' });
      }
      if (input === '/dashboard/api/vardash/repos/repo-a/env-keys' && init?.method == null) {
        return jsonResponse({ keys: [], descriptionGuidance: 'Descriptions are metadata. Do not include secret material.' });
      }
      if (input === '/dashboard/api/vardash/repos/repo-a/env-keys' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ key: 'TOKEN', kind: 'secret', required: true, description: null });
        return jsonResponse({
          key: {
            id: 'key-1',
            repoId: 'repo-a',
            key: 'TOKEN',
            kind: 'secret',
            required: true,
            description: null,
            createdAt: 'now',
            updatedAt: 'now',
          },
          descriptionGuidance: 'Descriptions are metadata. Do not include secret material.',
        });
      }
      if (input === '/dashboard/api/vardash/repos/repo-a/import' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toMatchObject({ dryRun: true, source: 'pasted-env' });
        return jsonResponse({ dryRun: true, keys: [], diagnostics: [], conflicts: [] });
      }
      if (input === '/dashboard/api/vardash/workspaces/ws-a/repos/repo-a/launch/readiness?processDefinitionId=proc-1') {
        return jsonResponse({
          ready: true,
          workspaceId: 'ws-a',
          repoId: 'repo-a',
          process: { id: 'proc-1', name: 'Dev server', isDefault: true },
          missingRequired: [],
          varlock: { enabled: false, available: null },
        });
      }
      return jsonResponse({ error: 'unexpected request' }, 500);
    });

    const client = new VardashClient({ fetch: fetchImpl });

    await expect(client.listRepoEnvOverview('repo-a', 'ws-a')).resolves.toMatchObject({
      repoId: 'repo-a',
      workspaceId: 'ws-a',
      rows: [],
    });
    await expect(client.listRepoEnvKeys('repo-a')).resolves.toEqual({
      keys: [],
      descriptionGuidance: 'Descriptions are metadata. Do not include secret material.',
    });
    await expect(client.upsertRepoEnvKey('repo-a', {
      key: 'TOKEN',
      kind: 'secret',
      required: true,
      description: null,
    })).resolves.toMatchObject({ key: { id: 'key-1', kind: 'secret' } });
    await expect(client.importRepoEnv('repo-a', {
      content: 'TOKEN=value',
      source: 'pasted-env',
      dryRun: true,
      savedValueName: 'imported',
      plainKeys: [],
    })).resolves.toMatchObject({ dryRun: true, conflicts: [] });
    await expect(client.getLaunchReadiness({
      workspaceId: 'ws-a',
      repoId: 'repo-a',
      processDefinitionId: 'proc-1',
    })).resolves.toMatchObject({ ready: true, varlock: { enabled: false } });

    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it('maps launch control API requests using typed status/control payloads', async () => {
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/dashboard/api/vardash/workspaces/ws-a/repos/repo-a/launch' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ processDefinitionId: 'proc-1', useVarlock: true });
        return jsonResponse({ runId: 'run-1', status: 'running' });
      }
      if (input === '/dashboard/api/vardash/launches/run-1/status') {
        return jsonResponse({ runId: 'run-1', status: 'running', startedAt: 'now', stoppedAt: null, exitCode: null });
      }
      if (input === '/dashboard/api/vardash/launches/run-1/stop' && init?.method === 'POST') {
        return jsonResponse({ runId: 'run-1', status: 'stopping' });
      }
      return jsonResponse({ error: 'unexpected request' }, 500);
    });

    const client = new VardashClient({ fetch: fetchImpl });

    await expect(client.launchRepoProcess({ workspaceId: 'ws-a', repoId: 'repo-a', processDefinitionId: 'proc-1', useVarlock: true }))
      .resolves.toEqual({ runId: 'run-1', status: 'running' });
    await expect(client.getLaunchStatus('run-1')).resolves.toMatchObject({ runId: 'run-1', status: 'running' });
    await expect(client.stopLaunch('run-1')).resolves.toEqual({ runId: 'run-1', status: 'stopping' });
  });

  it('does not expose raw error response bodies to UI callers', async () => {
    const client = new VardashClient({
      fetch: async () => jsonResponse({ error: 'conflict', accidentalExtra: 'not surfaced on VardashApiError' }, 409),
    });

    await expect(client.listRepoEnvKeys('repo-a')).rejects.toMatchObject({
      status: 409,
      errorCode: 'conflict',
    });
    await expect(client.listRepoEnvKeys('repo-a')).rejects.not.toHaveProperty('body');
  });

  it('does not allow secret saved-value metadata to carry plaintext at type level', () => {
    const secretValue: VardashSavedValueMetadata = {
      id: 'saved-secret',
      repoId: 'repo-a',
      envKeyId: 'key-secret',
      name: 'prod',
      kind: 'secret',
      hasValue: true,
      createdAt: 'now',
      updatedAt: 'now',
    };

    // @ts-expect-error secret metadata must never include plaintext values
    const invalidSecretValue: VardashSavedValueMetadata = {
      id: 'saved-secret-invalid',
      repoId: 'repo-a',
      envKeyId: 'key-secret',
      name: 'prod',
      kind: 'secret',
      hasValue: true,
      value: 'should-not-typecheck',
      createdAt: 'now',
      updatedAt: 'now',
    };

    const plainValue: VardashSavedValueMetadata = {
      id: 'saved-plain',
      repoId: 'repo-a',
      envKeyId: 'key-plain',
      name: 'local',
      kind: 'plain',
      hasValue: true,
      value: 'localhost',
      createdAt: 'now',
      updatedAt: 'now',
    };

    void invalidSecretValue;
    expect(secretValue).not.toHaveProperty('value');
    expect(plainValue.value).toBe('localhost');
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
