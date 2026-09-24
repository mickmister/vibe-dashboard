import { describe, expect, it } from 'vitest';
import type { DenoComponent, EffectivePluginGrants, PluginManifest } from './manifest';
import {
  buildDenoBridgeCommand,
  prepareDenoBridgeInvocation,
  type BridgeInvocationRequest,
} from './deno-bridge-runtime';

const bridge: DenoComponent = {
  id: 'drawings-storage',
  entry: 'bridges/storage.ts',
  methods: ['drawings.list', 'drawings.write'],
  permissions: {
    read: ['.vibe/plugins/excalidraw'],
    write: ['.vibe/plugins/excalidraw'],
    net: ['api.excalidraw.test:443'],
    env: ['EXCALIDRAW_MODE'],
  },
};

const manifest: PluginManifest = {
  schemaVersion: 1,
  id: 'app.excalidraw.canvas',
  version: '1.0.0',
  displayName: 'Excalidraw',
  components: { denoBridges: [bridge] },
  requestedCapabilities: {
    filesystem: [{ scope: 'workspace', path: '.vibe/plugins/excalidraw', access: 'readWrite' }],
    network: { mode: 'egress', hosts: ['api.excalidraw.test:443'] },
    env: ['EXCALIDRAW_MODE'],
  },
};

const approvedGrants: EffectivePluginGrants = {
  pluginId: manifest.id,
  pluginVersion: manifest.version,
  requested: {
    vkHttpApi: 'none',
    hostShell: 'none',
    codeServer: 'none',
    hostDocker: 'none',
    filesystem: [{ scope: 'workspace', path: '.vibe/plugins/excalidraw', access: 'readWrite' }],
    network: { mode: 'egress', hosts: ['api.excalidraw.test:443'] },
    env: ['EXCALIDRAW_MODE'],
    secrets: [],
    plugins: [],
  },
  approved: {
    vkHttpApi: 'none',
    hostShell: 'none',
    codeServer: 'none',
    hostDocker: 'none',
    filesystem: [{ scope: 'workspace', path: '.vibe/plugins/excalidraw', access: 'readWrite' }],
    network: { mode: 'egress', hosts: ['api.excalidraw.test:443'] },
    env: ['EXCALIDRAW_MODE'],
    secrets: [],
    plugins: [],
  },
  approval: { state: 'approved', approvalId: 'approval-1', approvedBy: 'admin' },
};

const request: BridgeInvocationRequest = {
  pluginId: manifest.id,
  pluginVersion: manifest.version,
  bridgeId: bridge.id,
  method: 'drawings.write',
  argsJson: JSON.stringify({ id: 'board-1' }),
};

describe('Deno bridge runtime ACL', () => {
  it('builds explicit deno flags only from approved bridge permissions', () => {
    const prepared = prepareDenoBridgeInvocation({ manifest, grants: approvedGrants, request });
    const command = buildDenoBridgeCommand({ denoBinary: 'deno', prepared });

    expect(command).toEqual({
      command: 'deno',
      args: [
        'run',
        '--no-prompt',
        '--allow-read=.vibe/plugins/excalidraw',
        '--allow-write=.vibe/plugins/excalidraw',
        '--allow-net=api.excalidraw.test:443',
        '--allow-env=EXCALIDRAW_MODE',
        'bridges/storage.ts',
        JSON.stringify({ method: 'drawings.write', argsJson: request.argsJson }),
      ],
      env: {
        VD_PLUGIN_ID: manifest.id,
        VD_PLUGIN_VERSION: manifest.version,
        VD_BRIDGE_ID: bridge.id,
      },
    });
  });

  it('rejects unapproved bridge methods, plugin identity mismatches, and denied sensitive capabilities', () => {
    expect(() =>
      prepareDenoBridgeInvocation({
        manifest,
        grants: approvedGrants,
        request: { ...request, method: 'drawings.delete' },
      }),
    ).toThrow('Bridge method drawings.delete is not declared for drawings-storage');

    expect(() =>
      prepareDenoBridgeInvocation({
        manifest,
        grants: approvedGrants,
        request: { ...request, pluginId: 'app.other' },
      }),
    ).toThrow('Bridge invocation plugin identity does not match manifest');

    expect(() =>
      prepareDenoBridgeInvocation({
        manifest,
        grants: {
          ...approvedGrants,
          approved: { ...approvedGrants.approved, network: { mode: 'none' } },
        },
        request,
      }),
    ).toThrow('Deno bridge drawings-storage requests unapproved network host api.excalidraw.test:443');
  });

  it('keeps VK API, host shell, code-server, host Docker, and plugin access default-denied for bridges', () => {
    expect(() =>
      prepareDenoBridgeInvocation({
        manifest,
        grants: {
          ...approvedGrants,
          approved: { ...approvedGrants.approved, vkHttpApi: 'read' },
        },
        request,
      }),
    ).toThrow('Deno bridge grants cannot include VK HTTP API access');

    expect(() =>
      prepareDenoBridgeInvocation({
        manifest,
        grants: {
          ...approvedGrants,
          approved: { ...approvedGrants.approved, hostShell: { commands: ['gh'] } },
        },
        request,
      }),
    ).toThrow('Deno bridge grants cannot include host shell access');

    expect(() =>
      prepareDenoBridgeInvocation({
        manifest,
        grants: {
          ...approvedGrants,
          approved: { ...approvedGrants.approved, plugins: [{ pluginId: 'other', methods: ['*'] }] },
        },
        request,
      }),
    ).toThrow('Deno bridge grants cannot include direct inter-plugin access');
  });
});
