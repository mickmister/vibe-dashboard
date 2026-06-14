import { describe, expect, it } from 'vitest';
import type { DiscoveredInstalledPlugin } from './installer';
import type { EffectivePluginGrants, PluginManifest } from './manifest';
import {
  type ContainerPluginRuntimePlan,
  createContainerPluginRuntimePlan,
  getContainerRuntimeAdminPreview,
  recordContainerRuntimeEvent,
} from './container-runtime';

const imageDigest = 'ghcr.io/acme/excalidraw-worker@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const manifest = (overrides: Partial<PluginManifest> = {}): PluginManifest => ({
  schemaVersion: 1,
  id: 'app.excalidraw.canvas',
  version: '1.0.0',
  displayName: 'Excalidraw',
  kind: 'marketplace',
  components: {
    containers: [
      {
        id: 'renderer',
        image: imageDigest,
        composeFile: 'containers/compose.yaml',
        dockerd: 'microvm',
        services: ['renderer'],
      },
    ],
    healthChecks: [{ id: 'renderer-health', kind: 'http', target: 'http://127.0.0.1:9300/health' }],
  },
  requestedCapabilities: {
    hostDocker: 'microvm-dockerd',
    filesystem: [{ scope: 'workspace', path: '.vibe/plugins/excalidraw', access: 'readWrite' }],
    network: { mode: 'ingress', ports: ['9300'] },
    secrets: ['renderer-token'],
  },
  ...overrides,
});

const plugin = (pluginManifest = manifest()): DiscoveredInstalledPlugin => ({
  id: pluginManifest.id,
  version: pluginManifest.version,
  manifest: pluginManifest,
  installPath: `/plugins/${pluginManifest.id}/${pluginManifest.version}`,
  extractedPath: `/plugins/${pluginManifest.id}/${pluginManifest.version}/extracted`,
  verifiedPath: `/plugins/${pluginManifest.id}/${pluginManifest.version}/verified.json`,
  disabled: false,
});

const grants = (approved: Partial<EffectivePluginGrants['approved']> = {}): EffectivePluginGrants => ({
  pluginId: 'app.excalidraw.canvas',
  pluginVersion: '1.0.0',
  requested: {
    vkHttpApi: 'none',
    hostShell: 'none',
    codeServer: 'none',
    hostDocker: 'microvm-dockerd',
    filesystem: [{ scope: 'workspace', path: '.vibe/plugins/excalidraw', access: 'readWrite' }],
    network: { mode: 'ingress', ports: ['9300'] },
    env: [],
    secrets: ['renderer-token'],
    plugins: [],
  },
  approved: {
    vkHttpApi: 'none',
    hostShell: 'none',
    codeServer: 'none',
    hostDocker: 'microvm-dockerd',
    filesystem: [{ scope: 'workspace', path: '.vibe/plugins/excalidraw', access: 'readWrite' }],
    network: { mode: 'ingress', ports: ['9300'] },
    env: [],
    secrets: ['renderer-token'],
    plugins: [],
    ...approved,
  },
  approval: { state: 'approved', approvalId: 'approval-1', approvedBy: 'admin' },
});

describe('microVM dockerd container plugin runtime planning', () => {
  it('targets only the configured microVM dockerd endpoint and exposes admin-reviewed runtime details', () => {
    const result = createContainerPluginRuntimePlan({
      dockerBinary: 'docker',
      microvmDockerHost: 'tcp://plugin-microvm.internal:2375',
      workspaceRoot: '/workspaces/craft-1',
      pluginDataRoot: '/var/lib/vd/plugin-data',
      plugins: [plugin()],
      grantsByPluginVersion: new Map([['app.excalidraw.canvas@1.0.0', grants()]]),
    });

    expect(result.errors).toEqual([]);
    expect(result.plans).toHaveLength(1);
    const plan = expectSinglePlan(result.plans);
    expect(plan).toMatchObject({
      pluginId: 'app.excalidraw.canvas',
      pluginVersion: '1.0.0',
      unitId: 'renderer',
      dockerHost: 'tcp://plugin-microvm.internal:2375',
      image: imageDigest,
      composeFile: '/plugins/app.excalidraw.canvas/1.0.0/extracted/containers/compose.yaml',
      composeProjectName: 'vd_app_excalidraw_canvas_1_0_0_renderer',
      mounts: [
        {
          source: '/workspaces/craft-1/.vibe/plugins/excalidraw',
          target: '/workspace/.vibe/plugins/excalidraw',
          readonly: false,
        },
      ],
      approvedNetwork: { mode: 'ingress', ports: ['9300'] },
      approvedSecrets: ['renderer-token'],
      lifecycle: {
        pull: {
          command: 'docker',
          args: ['pull', imageDigest],
          env: { DOCKER_HOST: 'tcp://plugin-microvm.internal:2375' },
        },
        up: {
          command: 'docker',
          args: [
            'compose',
            '--file',
            '/plugins/app.excalidraw.canvas/1.0.0/extracted/containers/compose.yaml',
            '--project-name',
            'vd_app_excalidraw_canvas_1_0_0_renderer',
            'up',
            '--detach',
          ],
          env: expect.objectContaining({
            DOCKER_HOST: 'tcp://plugin-microvm.internal:2375',
            VD_PLUGIN_ID: 'app.excalidraw.canvas',
            VD_CONTAINER_ID: 'renderer',
          }),
        },
      },
    });

    expect(getContainerRuntimeAdminPreview(plan)).toEqual({
      pluginId: 'app.excalidraw.canvas',
      pluginVersion: '1.0.0',
      unitId: 'renderer',
      image: imageDigest,
      composeFile: '/plugins/app.excalidraw.canvas/1.0.0/extracted/containers/compose.yaml',
      dockerHostKind: 'microvm',
      mounts: plan.mounts,
      network: { mode: 'ingress', ports: ['9300'] },
      secrets: ['renderer-token'],
      healthChecks: [{ id: 'renderer-health', kind: 'http', target: 'http://127.0.0.1:9300/health' }],
      lifecycleCommands: ['pull', 'up', 'down', 'logs'],
    });
  });

  it('rejects host docker socket endpoints, unapproved docker grants, and unpinned images', () => {
    const unsafeDockerHost = createContainerPluginRuntimePlan({
      dockerBinary: 'docker',
      microvmDockerHost: 'unix:///var/run/docker.sock',
      workspaceRoot: '/workspaces/craft-1',
      pluginDataRoot: '/var/lib/vd/plugin-data',
      plugins: [plugin()],
      grantsByPluginVersion: new Map([['app.excalidraw.canvas@1.0.0', grants()]]),
    });
    expect(unsafeDockerHost.errors).toEqual([
      'container runtime: microVM docker host must not point at the host Docker socket',
    ]);

    const deniedDockerGrant = createContainerPluginRuntimePlan({
      dockerBinary: 'docker',
      microvmDockerHost: 'tcp://plugin-microvm.internal:2375',
      workspaceRoot: '/workspaces/craft-1',
      pluginDataRoot: '/var/lib/vd/plugin-data',
      plugins: [plugin()],
      grantsByPluginVersion: new Map([['app.excalidraw.canvas@1.0.0', grants({ hostDocker: 'none' })]]),
    });
    expect(deniedDockerGrant.errors).toEqual([
      'app.excalidraw.canvas@1.0.0 renderer: container runtime requires approved microvm-dockerd access',
    ]);

    const unpinned = createContainerPluginRuntimePlan({
      dockerBinary: 'docker',
      microvmDockerHost: 'tcp://plugin-microvm.internal:2375',
      workspaceRoot: '/workspaces/craft-1',
      pluginDataRoot: '/var/lib/vd/plugin-data',
      plugins: [
        plugin({
          ...manifest(),
          components: {
            containers: [{ id: 'renderer', image: 'docker.io/library/redis:latest', dockerd: 'microvm' }],
          },
        }),
      ],
      grantsByPluginVersion: new Map([['app.excalidraw.canvas@1.0.0', grants()]]),
    });
    expect(unpinned.errors).toEqual([
      'app.excalidraw.canvas@1.0.0 renderer: container image must be ghcr.io and digest-pinned',
    ]);
  });

  it('fails closed for unsafe compose files, host-socket grants, and broad filesystem mounts', () => {
    const result = createContainerPluginRuntimePlan({
      dockerBinary: 'docker',
      microvmDockerHost: 'tcp://plugin-microvm.internal:2375',
      workspaceRoot: '/workspaces/craft-1',
      pluginDataRoot: '/var/lib/vd/plugin-data',
      plugins: [
        plugin({
          ...manifest(),
          components: {
            containers: [{ id: 'renderer', image: imageDigest, composeFile: '../compose.yaml', dockerd: 'microvm' }],
          },
        }),
      ],
      grantsByPluginVersion: new Map([
        [
          'app.excalidraw.canvas@1.0.0',
          grants({
            hostDocker: 'host-socket',
            filesystem: [{ scope: 'absolute', path: '/var/run/docker.sock', access: 'readWrite' }],
          }),
        ],
      ]),
    });

    expect(result.plans).toEqual([]);
    expect(result.errors).toEqual([
      'app.excalidraw.canvas@1.0.0 renderer: host Docker socket grants are forbidden for plugins',
      'app.excalidraw.canvas@1.0.0 renderer: container runtime requires approved microvm-dockerd access',
      'app.excalidraw.canvas@1.0.0 renderer: composeFile must be a safe relative path',
      'app.excalidraw.canvas@1.0.0 renderer: container filesystem mounts may only use plugin-data or workspace scopes',
    ]);
  });

  it('records logs and health per containerized plugin for staging and promotion review', () => {
    const result = createContainerPluginRuntimePlan({
      dockerBinary: 'docker',
      microvmDockerHost: 'tcp://plugin-microvm.internal:2375',
      workspaceRoot: '/workspaces/craft-1',
      pluginDataRoot: '/var/lib/vd/plugin-data',
      plugins: [plugin()],
      grantsByPluginVersion: new Map([['app.excalidraw.canvas@1.0.0', grants()]]),
    });
    const state = expectSinglePlan(result.plans).status;

    recordContainerRuntimeEvent(state, { type: 'log', message: 'pulled renderer image' });
    recordContainerRuntimeEvent(state, { type: 'health', id: 'renderer-health', passed: true, message: '200 OK' });

    expect(state.logs).toEqual(['pulled renderer image', 'health renderer-health pass: 200 OK']);
    expect(state.health).toEqual({ 'renderer-health': 'pass' });
  });
});

function expectSinglePlan(plans: ContainerPluginRuntimePlan[]): ContainerPluginRuntimePlan {
  expect(plans).toHaveLength(1);
  const [plan] = plans;
  if (!plan) throw new Error('expected a container runtime plan');
  return plan;
}
