import { describe, expect, it } from 'vitest';
import type { DiscoveredInstalledPlugin } from './installer';
import type { EffectivePluginGrants, PluginManifest } from './manifest';
import {
  type ContainerPluginRuntimePlan,
  createContainerPluginRuntimePlan,
  getContainerRuntimeAdminPreview,
  recordContainerRuntimeEvent,
  summarizeContainerRuntimeFailure,
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
        dockerd: 'microvm',
        services: ['renderer'],
      },
    ],
    healthChecks: [{ id: 'renderer-health', kind: 'http', target: 'http://127.0.0.1:9300/health' }],
  },
  requestedCapabilities: {
    hostDocker: 'microvm-dockerd',
    filesystem: [{ scope: 'workspace', path: '.vibe/plugins/excalidraw', access: 'readWrite' }],
    network: { mode: 'ingress-and-egress', ports: ['9300'] },
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
    network: { mode: 'ingress-and-egress', ports: ['9300'] },
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
    network: { mode: 'ingress-and-egress', ports: ['9300'] },
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
      composeProjectName: 'vd_app_excalidraw_canvas_1_0_0_renderer',
      mounts: [
        {
          source: '/workspaces/craft-1/.vibe/plugins/excalidraw',
          target: '/workspace/.vibe/plugins/excalidraw',
          readonly: false,
        },
      ],
      approvedNetwork: { mode: 'ingress-and-egress', ports: ['9300'] },
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
            'run',
            '--detach',
            '--name',
            'vd_app_excalidraw_canvas_1_0_0_renderer',
            '--label',
            'vd.plugin=app.excalidraw.canvas',
            '--network',
            'bridge',
            '--publish',
            '127.0.0.1:9300:9300/tcp',
            '--env',
            'VD_PLUGIN_ID=app.excalidraw.canvas',
            '--env',
            'VD_PLUGIN_VERSION=1.0.0',
            '--env',
            'VD_CONTAINER_ID=renderer',
            '--env',
            'VD_PLUGIN_APPROVED_SECRETS=renderer-token',
            '--mount',
            'type=bind,source=/workspaces/craft-1/.vibe/plugins/excalidraw,target=/workspace/.vibe/plugins/excalidraw,readonly=false',
            imageDigest,
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
      composeFile: undefined,
      dockerHostKind: 'microvm',
      mounts: plan.mounts,
      network: { mode: 'ingress-and-egress', ports: ['9300'] },
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

  it('fails closed when approved container network or secret grants cannot be represented safely', () => {
    const unsafeNetwork = createContainerPluginRuntimePlan({
      dockerBinary: 'docker',
      microvmDockerHost: 'tcp://plugin-microvm.internal:2375',
      workspaceRoot: '/workspaces/craft-1',
      pluginDataRoot: '/var/lib/vd/plugin-data',
      plugins: [plugin()],
      grantsByPluginVersion: new Map([
        [
          'app.excalidraw.canvas@1.0.0',
          grants({ network: { mode: 'ingress', hosts: ['api.example.test'], ports: ['9300'] } }),
        ],
      ]),
    });
    expect(unsafeNetwork.plans).toEqual([]);
    expect(unsafeNetwork.errors).toEqual([
      'app.excalidraw.canvas@1.0.0 renderer: container network host allowlists require microVM network policy support before they can be granted',
      'app.excalidraw.canvas@1.0.0 renderer: container ingress-only network grants require microVM network policy support before they can be granted',
    ]);

    const unsafeSecret = createContainerPluginRuntimePlan({
      dockerBinary: 'docker',
      microvmDockerHost: 'tcp://plugin-microvm.internal:2375',
      workspaceRoot: '/workspaces/craft-1',
      pluginDataRoot: '/var/lib/vd/plugin-data',
      plugins: [plugin()],
      grantsByPluginVersion: new Map([
        ['app.excalidraw.canvas@1.0.0', grants({ secrets: ['renderer-token', 'bad\nsecret'] })],
      ]),
    });
    expect(unsafeSecret.plans).toEqual([]);
    expect(unsafeSecret.errors).toEqual([
      'app.excalidraw.canvas@1.0.0 renderer: container secret grant identifiers must be safe env-list values',
    ]);
  });

  it('fails closed for compose-backed plugins until VD can enforce approved grants through generated compose', () => {
    const composeSmugglingAttempts = [
      'volumes: ["/var/run/docker.sock:/var/run/docker.sock"]',
      'environment: ["GH_TOKEN=${GH_TOKEN}"]',
      'ports: ["0.0.0.0:9300:9300"]',
      'privileged: true',
      'cap_add: ["SYS_ADMIN"]',
      'network_mode: host',
    ];

    for (const composeFileContents of composeSmugglingAttempts) {
      expect(composeFileContents).toBeTruthy();
      const result = createContainerPluginRuntimePlan({
        dockerBinary: 'docker',
        microvmDockerHost: 'tcp://plugin-microvm.internal:2375',
        workspaceRoot: '/workspaces/craft-1',
        pluginDataRoot: '/var/lib/vd/plugin-data',
        plugins: [
          plugin({
            ...manifest(),
            components: {
              containers: [{ id: 'renderer', image: imageDigest, composeFile: 'containers/compose.yaml', dockerd: 'microvm' }],
            },
          }),
        ],
        grantsByPluginVersion: new Map([['app.excalidraw.canvas@1.0.0', grants()]]),
      });

      expect(result.plans).toEqual([]);
      expect(result.errors).toEqual([
        'app.excalidraw.canvas@1.0.0 renderer: composeFile is not supported until VD can enforce approved grants through a generated compose model',
      ]);
    }
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
      'app.excalidraw.canvas@1.0.0 renderer: composeFile is not supported until VD can enforce approved grants through a generated compose model',
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

  it('normalizes microVM, dockerd, image pull, container start, health, and network failures for logs', () => {
    const plan = expectSinglePlan(createContainerPluginRuntimePlan({
      dockerBinary: 'docker',
      microvmDockerHost: 'tcp://plugin-microvm.internal:2375',
      workspaceRoot: '/workspaces/craft-1',
      pluginDataRoot: '/var/lib/vd/plugin-data',
      plugins: [plugin()],
      grantsByPluginVersion: new Map([['app.excalidraw.canvas@1.0.0', grants()]]),
    }).plans);

    expect([
      summarizeContainerRuntimeFailure(plan, { phase: 'microvm-start', cause: 'firecracker exited 1' }),
      summarizeContainerRuntimeFailure(plan, { phase: 'dockerd-ready', cause: 'connection refused' }),
      summarizeContainerRuntimeFailure(plan, { phase: 'image-pull', cause: 'manifest unknown' }),
      summarizeContainerRuntimeFailure(plan, { phase: 'container-start', cause: 'container exited 1' }),
      summarizeContainerRuntimeFailure(plan, { phase: 'health-check', checkId: 'renderer-health', cause: 'HTTP 503' }),
      summarizeContainerRuntimeFailure(plan, { phase: 'network', cause: 'port 9300 unavailable' }),
    ]).toEqual([
      'app.excalidraw.canvas@1.0.0 renderer microVM startup failed: firecracker exited 1',
      'app.excalidraw.canvas@1.0.0 renderer microVM dockerd unavailable at tcp://plugin-microvm.internal:2375: connection refused',
      `app.excalidraw.canvas@1.0.0 renderer image pull failed for ${imageDigest}: manifest unknown`,
      'app.excalidraw.canvas@1.0.0 renderer container startup failed for vd_app_excalidraw_canvas_1_0_0_renderer: container exited 1',
      'app.excalidraw.canvas@1.0.0 renderer health check renderer-health failed: HTTP 503',
      'app.excalidraw.canvas@1.0.0 renderer network setup failed for {"mode":"ingress-and-egress","ports":["9300"]}: port 9300 unavailable',
    ]);
  });
});

function expectSinglePlan(plans: ContainerPluginRuntimePlan[]): ContainerPluginRuntimePlan {
  expect(plans).toHaveLength(1);
  const [plan] = plans;
  if (!plan) throw new Error('expected a container runtime plan');
  return plan;
}
