import { describe, expect, it } from 'vitest';
import type { DiscoveredInstalledPlugin } from './installer';
import type { EffectivePluginGrants, PluginManifest } from './manifest';
import { createServerPluginStartupPlan } from './server-plugin-loader';

const manifest: PluginManifest = {
  schemaVersion: 1,
  id: 'app.backend.worker',
  version: '1.0.0',
  displayName: 'Backend Worker',
  components: {
    denoBackends: [
      {
        id: 'worker',
        entry: 'backend/worker.ts',
        permissions: {
          read: ['.vibe/plugins/backend-worker'],
          write: ['.vibe/plugins/backend-worker'],
        },
      },
    ],
    lifecycle: { start: 'worker' },
  },
};

const discovered: DiscoveredInstalledPlugin = {
  id: manifest.id,
  version: manifest.version,
  manifest,
  installPath: '/plugins/app.backend.worker/1.0.0',
  extractedPath: '/plugins/app.backend.worker/1.0.0/extracted',
  verifiedPath: '/plugins/app.backend.worker/1.0.0/verified.json',
  disabled: false,
};

const grants: EffectivePluginGrants = {
  pluginId: manifest.id,
  pluginVersion: manifest.version,
  requested: {
    vkHttpApi: 'none',
    hostShell: 'none',
    codeServer: 'none',
    hostDocker: 'none',
    filesystem: [{ scope: 'plugin-data', path: '.vibe/plugins/backend-worker', access: 'readWrite' }],
    network: { mode: 'none' },
    env: [],
    secrets: [],
    plugins: [],
  },
  approved: {
    vkHttpApi: 'none',
    hostShell: 'none',
    codeServer: 'none',
    hostDocker: 'none',
    filesystem: [{ scope: 'plugin-data', path: '.vibe/plugins/backend-worker', access: 'readWrite' }],
    network: { mode: 'none' },
    env: [],
    secrets: [],
    plugins: [],
  },
  approval: { state: 'approved', approvalId: 'approval-1', approvedBy: 'admin' },
};

describe('server plugin startup loader', () => {
  it('creates isolated Deno backend startup plans from discovered verified plugins', () => {
    expect(
      createServerPluginStartupPlan({
        denoBinary: 'deno',
        plugins: [discovered],
        grantsByPluginVersion: new Map([[`${manifest.id}@${manifest.version}`, grants]]),
      }),
    ).toEqual({
      plans: [
        {
          pluginId: manifest.id,
          pluginVersion: manifest.version,
          unitId: 'worker',
          restartRequiredForCodeChanges: true,
          command: {
            command: 'deno',
            args: [
              'run',
              '--no-prompt',
              '--allow-read=.vibe/plugins/backend-worker',
              '--allow-write=.vibe/plugins/backend-worker',
              '/plugins/app.backend.worker/1.0.0/extracted/backend/worker.ts',
            ],
            env: {
              VD_PLUGIN_ID: manifest.id,
              VD_PLUGIN_VERSION: manifest.version,
              VD_BACKEND_ID: 'worker',
            },
          },
        },
      ],
      errors: [],
    });
  });

  it('isolates disabled plugins and broken backend permissions from the rest of startup', () => {
    const broken: DiscoveredInstalledPlugin = {
      ...discovered,
      id: 'app.broken',
      manifest: {
        ...manifest,
        id: 'app.broken',
        components: {
          denoBackends: [
            { id: 'bad', entry: 'backend/bad.ts', permissions: { read: ['/etc'] } },
          ],
        },
      },
    };

    const result = createServerPluginStartupPlan({
      denoBinary: 'deno',
      plugins: [{ ...discovered, disabled: true }, broken],
      grantsByPluginVersion: new Map([[`${broken.id}@${broken.version}`, { ...grants, pluginId: broken.id }]]),
    });

    expect(result.plans).toEqual([]);
    expect(result.errors).toEqual([
      'app.broken@1.0.0 bad: Deno bridge bad requests unapproved filesystem path /etc',
    ]);
  });
});
