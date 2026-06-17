import { describe, expect, it } from 'vitest';
import type { DiscoveredInstalledPlugin } from './installer';
import type { EffectivePluginGrants, PluginManifest } from './manifest';
import {
  createStaticAdminApprovalGate,
  createPluginRuntimeDeploymentState,
  createStagingRuntimeManager,
  getPluginDeploymentAdminView,
  type AdminPromotionApproval,
} from './staging-runtime';

const manifest = (version: string): PluginManifest => ({
  schemaVersion: 1,
  id: 'app.excalidraw.canvas',
  version,
  displayName: 'Excalidraw',
  components: {
    frontend: {
      kind: 'iframe',
      entry: 'frontend/index.html',
      craftSurfaces: [{ id: 'canvas', title: 'Excalidraw', route: '/canvas' }],
    },
    denoBridges: [
      {
        id: 'drawings-storage',
        entry: 'bridges/storage.ts',
        methods: ['drawings.list', 'drawings.write'],
        permissions: { read: ['.vibe/plugins/excalidraw'], write: ['.vibe/plugins/excalidraw'] },
      },
    ],
    healthChecks: [
      { id: 'frontend-entry', kind: 'asset-exists', target: 'frontend/index.html' },
      { id: 'bridge-entry', kind: 'asset-exists', target: 'bridges/storage.ts' },
    ],
  },
  requestedCapabilities: {
    filesystem: [{ scope: 'workspace', path: '.vibe/plugins/excalidraw', access: 'readWrite' }],
  },
});

const plugin = (version: string): DiscoveredInstalledPlugin => ({
  id: 'app.excalidraw.canvas',
  version,
  manifest: manifest(version),
  installPath: `/plugins/app.excalidraw.canvas/${version}`,
  extractedPath: `/plugins/app.excalidraw.canvas/${version}/extracted`,
  verifiedPath: `/plugins/app.excalidraw.canvas/${version}/verified.json`,
  frontendAssetRoot: `/plugins/app.excalidraw.canvas/${version}/extracted/frontend`,
  frontendEntryAssetPath: 'index.html',
  disabled: false,
});

const grants = (version: string): EffectivePluginGrants => ({
  pluginId: 'app.excalidraw.canvas',
  pluginVersion: version,
  requested: {
    vkHttpApi: 'none',
    hostShell: 'none',
    codeServer: 'none',
    hostDocker: 'none',
    filesystem: [{ scope: 'workspace', path: '.vibe/plugins/excalidraw', access: 'readWrite' }],
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
    filesystem: [{ scope: 'workspace', path: '.vibe/plugins/excalidraw', access: 'readWrite' }],
    network: { mode: 'none' },
    env: [],
    secrets: [],
    plugins: [],
  },
  approval: { state: 'approved', approvalId: `grant-${version}`, approvedBy: 'admin' },
});

const approval: AdminPromotionApproval = {
  approvalId: 'approval-1',
  approvedBy: 'admin',
  approvedRole: 'admin',
  secondFactorVerified: true,
};

describe('staged plugin runtime and promotion workflow', () => {
  it('keeps staging artifacts/grants separate from production until explicit approved promotion', () => {
    const state = createPluginRuntimeDeploymentState();
    const manager = createStagingRuntimeManager(state);

    const staged = manager.installToStaging({ plugin: plugin('1.0.0'), grants: grants('1.0.0'), actor: 'agent' });
    expect(staged.environment).toBe('staging');
    expect(state.production.active).toEqual({});
    expect(state.staging['app.excalidraw.canvas']).toMatchObject({
      plugin: { version: '1.0.0' },
      grants: { pluginVersion: '1.0.0' },
      status: 'staged',
    });

    manager.runStagingChecks({
      pluginId: 'app.excalidraw.canvas',
      healthResults: { 'frontend-entry': true, 'bridge-entry': true },
      smokeTests: [{ id: 'iframe-rpc', passed: true, log: 'postMessage nonce accepted' }],
    });

    manager.promoteStaging({ pluginId: 'app.excalidraw.canvas', approval });

    expect(state.staging).toEqual({});
    expect(state.production.active['app.excalidraw.canvas']).toMatchObject({
      plugin: { version: '1.0.0' },
      status: 'active',
      promotion: approval,
    });
  });

  it('blocks promotion on failed health, missing 2FA, or disabled plugin unless explicit override is supplied', () => {
    const state = createPluginRuntimeDeploymentState();
    const manager = createStagingRuntimeManager(state);
    manager.installToStaging({ plugin: plugin('1.0.0'), grants: grants('1.0.0'), actor: 'agent' });
    manager.runStagingChecks({
      pluginId: 'app.excalidraw.canvas',
      healthResults: { 'frontend-entry': false, 'bridge-entry': true },
      smokeTests: [{ id: 'iframe-rpc', passed: true }],
    });

    expect(() => manager.promoteStaging({ pluginId: 'app.excalidraw.canvas', approval })).toThrow(
      'Cannot promote app.excalidraw.canvas: health check frontend-entry failed',
    );
    expect(() =>
      manager.promoteStaging({
        pluginId: 'app.excalidraw.canvas',
        approval: { ...approval, secondFactorVerified: false },
        overrideFailedChecks: true,
      }),
    ).toThrow('Promotion approval approval-1 requires a verified second factor');

    manager.promoteStaging({ pluginId: 'app.excalidraw.canvas', approval, overrideFailedChecks: true });
    expect(state.production.active['app.excalidraw.canvas']?.status).toBe('active');

    manager.installToStaging({
      plugin: { ...plugin('2.0.0'), disabled: true },
      grants: grants('2.0.0'),
      actor: 'agent',
    });
    expect(() =>
      manager.runStagingChecks({
        pluginId: 'app.excalidraw.canvas',
        healthResults: { 'frontend-entry': true, 'bridge-entry': true },
        smokeTests: [],
      }),
    ).toThrow('Cannot start disabled staged plugin app.excalidraw.canvas');
  });

  it('requires an authenticated admin approval gate for promotion and rollback actions', () => {
    const state = createPluginRuntimeDeploymentState();
    const gate = createStaticAdminApprovalGate({ requiredSecondFactor: true });
    const manager = createStagingRuntimeManager(state, { approvalGate: gate });

    manager.installToStaging({ plugin: plugin('1.0.0'), grants: grants('1.0.0'), actor: 'agent' });
    manager.runStagingChecks({
      pluginId: 'app.excalidraw.canvas',
      healthResults: { 'frontend-entry': true, 'bridge-entry': true },
      smokeTests: [{ id: 'iframe-rpc', passed: true }],
    });

    expect(() =>
      manager.promoteStaging({
        pluginId: 'app.excalidraw.canvas',
        approval: {
          approvalId: 'approval-agent',
          approvedBy: 'agent',
          approvedRole: 'agent',
          secondFactorVerified: true,
        },
      }),
    ).toThrow('Promotion approval approval-agent must be approved by an admin');

    expect(() =>
      manager.promoteStaging({
        pluginId: 'app.excalidraw.canvas',
        approval: {
          approvalId: 'approval-anonymous',
          approvedBy: '',
          approvedRole: 'admin',
          secondFactorVerified: true,
        },
      }),
    ).toThrow('Promotion approval approval-anonymous requires an authenticated approver');

    manager.promoteStaging({ pluginId: 'app.excalidraw.canvas', approval });

    manager.installToStaging({ plugin: plugin('2.0.0'), grants: grants('2.0.0'), actor: 'agent' });
    manager.runStagingChecks({
      pluginId: 'app.excalidraw.canvas',
      healthResults: { 'frontend-entry': true, 'bridge-entry': true },
      smokeTests: [{ id: 'iframe-rpc', passed: true }],
    });
    manager.promoteStaging({ pluginId: 'app.excalidraw.canvas', approval: { ...approval, approvalId: 'approval-2' } });

    expect(() =>
      manager.rollbackProduction({
        pluginId: 'app.excalidraw.canvas',
        version: '1.0.0',
        approval: { ...approval, approvalId: 'rollback-agent', approvedRole: 'agent' },
      }),
    ).toThrow('Promotion approval rollback-agent must be approved by an admin');
  });

  it('retains the latest three active versions and supports rollback from retained production records', () => {
    const state = createPluginRuntimeDeploymentState();
    const manager = createStagingRuntimeManager(state);

    for (const version of ['1.0.0', '2.0.0', '3.0.0', '4.0.0']) {
      manager.installToStaging({ plugin: plugin(version), grants: grants(version), actor: 'agent' });
      manager.runStagingChecks({
        pluginId: 'app.excalidraw.canvas',
        healthResults: { 'frontend-entry': true, 'bridge-entry': true },
        smokeTests: [{ id: 'runtime-smoke', passed: true }],
      });
      manager.promoteStaging({
        pluginId: 'app.excalidraw.canvas',
        approval: { ...approval, approvalId: `approval-${version}` },
      });
    }

    expect(state.production.active['app.excalidraw.canvas']?.plugin.version).toBe('4.0.0');
    expect(state.production.retained['app.excalidraw.canvas']?.map((record) => record.plugin.version)).toEqual([
      '3.0.0',
      '2.0.0',
      '1.0.0',
    ]);

    manager.rollbackProduction({ pluginId: 'app.excalidraw.canvas', version: '2.0.0', approval });
    expect(state.production.active['app.excalidraw.canvas']?.plugin.version).toBe('2.0.0');
    expect(state.production.retained['app.excalidraw.canvas']?.map((record) => record.plugin.version)).toEqual([
      '4.0.0',
      '3.0.0',
      '1.0.0',
    ]);
  });

  it('exposes an admin deployment view with logs, health, grants, manifests, test results, and rollback targets', () => {
    const state = createPluginRuntimeDeploymentState();
    const manager = createStagingRuntimeManager(state);
    manager.installToStaging({ plugin: plugin('1.0.0'), grants: grants('1.0.0'), actor: 'agent' });
    manager.runStagingChecks({
      pluginId: 'app.excalidraw.canvas',
      healthResults: { 'frontend-entry': true, 'bridge-entry': true },
      smokeTests: [{ id: 'iframe-rpc', passed: true, log: 'rpc ok' }],
    });

    expect(getPluginDeploymentAdminView(state, 'app.excalidraw.canvas')).toMatchObject({
      pluginId: 'app.excalidraw.canvas',
      staging: {
        plugin: { version: '1.0.0' },
        status: 'healthy',
        source: {
          verifiedPath: '/plugins/app.excalidraw.canvas/1.0.0/verified.json',
          installPath: '/plugins/app.excalidraw.canvas/1.0.0',
        },
        compatibility: undefined,
        grants: {
          approved: {
            filesystem: [{ scope: 'workspace', path: '.vibe/plugins/excalidraw', access: 'readWrite' }],
          },
        },
        manifest: {
          id: 'app.excalidraw.canvas',
          displayName: 'Excalidraw',
        },
        health: { 'frontend-entry': 'pass', 'bridge-entry': 'pass' },
        tests: [{ id: 'iframe-rpc', passed: true, log: 'rpc ok' }],
        logs: [
          'agent staged app.excalidraw.canvas@1.0.0',
          'started staging runtime for app.excalidraw.canvas@1.0.0',
          'health frontend-entry pass',
          'health bridge-entry pass',
          'test iframe-rpc pass',
        ],
      },
      production: null,
      rollbackTargets: [],
    });
  });
});
