import { describe, expect, it } from 'vitest';
import type { EffectivePluginGrants, PluginManifest } from './manifest';
import { InMemorySecretProvider, VarlockCommandSecretProvider, resolveApprovedPluginSecret } from './secrets-provider';

const manifest: PluginManifest = {
  schemaVersion: 1,
  id: 'app.excalidraw.canvas',
  version: '1.0.0',
  displayName: 'Excalidraw',
  components: {
    secrets: [{ id: 'storage-token', provider: 'varlock', ref: 'varlock://plugins/excalidraw/storage-token' }],
  },
};

const grants: EffectivePluginGrants = {
  pluginId: manifest.id,
  pluginVersion: manifest.version,
  requested: {
    vkHttpApi: 'none',
    hostShell: 'none',
    codeServer: 'none',
    hostDocker: 'none',
    filesystem: [],
    network: { mode: 'none' },
    env: [],
    secrets: ['storage-token'],
    plugins: [],
  },
  approved: {
    vkHttpApi: 'none',
    hostShell: 'none',
    codeServer: 'none',
    hostDocker: 'none',
    filesystem: [],
    network: { mode: 'none' },
    env: [],
    secrets: ['storage-token'],
    plugins: [],
  },
  approval: { state: 'approved', approvalId: 'approval-1', approvedBy: 'admin' },
};

describe('plugin secrets provider abstraction', () => {
  it('resolves only declared and approved secret references and redacts display values', async () => {
    const provider = new InMemorySecretProvider({
      'varlock://plugins/excalidraw/storage-token': 'super-secret-token',
    });

    const resolved = await resolveApprovedPluginSecret({
      manifest,
      grants,
      provider,
      secretId: 'storage-token',
    });

    expect(resolved).toEqual({
      id: 'storage-token',
      provider: 'varlock',
      ref: 'varlock://plugins/excalidraw/storage-token',
      value: 'super-secret-token',
      redacted: '**************oken',
    });
    expect(provider.auditLog).toEqual([
      {
        pluginId: manifest.id,
        pluginVersion: manifest.version,
        ref: 'varlock://plugins/excalidraw/storage-token',
        action: 'read',
      },
    ]);
  });

  it('denies undeclared, unapproved, revoked, and missing secrets without leaking values', async () => {
    const provider = new InMemorySecretProvider({
      'varlock://plugins/excalidraw/storage-token': 'super-secret-token',
    });

    await expect(
      resolveApprovedPluginSecret({ manifest, grants, provider, secretId: 'missing' }),
    ).rejects.toThrow('Plugin app.excalidraw.canvas does not declare secret missing');

    await expect(
      resolveApprovedPluginSecret({
        manifest,
        grants: { ...grants, approved: { ...grants.approved, secrets: [] } },
        provider,
        secretId: 'storage-token',
      }),
    ).rejects.toThrow('Secret storage-token is not approved for plugin app.excalidraw.canvas');

    provider.revoke('varlock://plugins/excalidraw/storage-token');
    await expect(
      resolveApprovedPluginSecret({ manifest, grants, provider, secretId: 'storage-token' }),
    ).rejects.toThrow('Secret ref varlock://plugins/excalidraw/storage-token is revoked or unavailable');
    expect(JSON.stringify(provider.auditLog)).not.toContain('super-secret-token');
  });

  it('supports a Varlock command adapter without leaking secret values into audit metadata', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const provider = new VarlockCommandSecretProvider({
      varlockBinary: 'varlock-test',
      exec: async (command, args) => {
        calls.push({ command, args });
        return { stdout: 'varlock-value\n' };
      },
    });

    const resolved = await resolveApprovedPluginSecret({
      manifest,
      grants,
      provider,
      secretId: 'storage-token',
    });

    expect(resolved.value).toBe('varlock-value');
    expect(resolved.redacted).toBe('*********alue');
    expect(calls).toEqual([
      {
        command: 'varlock-test',
        args: [
          'read',
          'varlock://plugins/excalidraw/storage-token',
          '--caller',
          'app.excalidraw.canvas@1.0.0',
        ],
      },
    ]);
  });

});
