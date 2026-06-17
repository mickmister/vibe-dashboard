import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLUGIN_CAPABILITY_REQUESTS,
  createDeniedEffectivePluginGrants,
  getRequestedCapabilities,
  validatePluginManifest,
  type PluginManifest,
} from './manifest';

const excalidrawManifest: PluginManifest = {
  schemaVersion: 1,
  id: 'app.excalidraw.canvas',
  version: '1.0.0',
  displayName: 'Excalidraw',
  kind: 'marketplace',
  compatibility: {
    vibeDashboard: '^1.0.0',
  },
  components: {
    frontend: {
      kind: 'iframe',
      entry: 'frontend/index.html',
      routes: [
        {
          id: 'canvas',
          title: 'Excalidraw',
          path: '/canvas',
        },
      ],
      craftSurfaces: [
        {
          id: 'canvas',
          title: 'Excalidraw',
          route: '/canvas',
        },
      ],
    },
    denoBridges: [
      {
        id: 'drawings-storage',
        entry: 'bridges/storage.ts',
        methods: ['drawings.list', 'drawings.read', 'drawings.write'],
        permissions: {
          read: ['.vibe/plugins/excalidraw'],
          write: ['.vibe/plugins/excalidraw'],
        },
      },
    ],
    storage: [
      {
        id: 'drawings',
        scope: 'workspace',
        path: '.vibe/plugins/excalidraw',
        access: 'readWrite',
      },
    ],
    healthChecks: [
      {
        id: 'frontend-entry',
        kind: 'asset-exists',
        target: 'frontend/index.html',
      },
    ],
  },
  requestedCapabilities: {
    filesystem: [
      {
        scope: 'workspace',
        path: '.vibe/plugins/excalidraw',
        access: 'readWrite',
      },
    ],
  },
};

const firstPartyVkManifest: PluginManifest = {
  schemaVersion: 1,
  id: 'first-party.vibe-kanban',
  version: '2026.06.14',
  displayName: 'Vibe Kanban',
  kind: 'first-party-service',
  compatibility: {
    vibeDashboard: '^1.0.0',
  },
  components: {
    services: [
      {
        id: 'vibe-kanban',
        runtime: 'supervisor',
        command: 'npx vibe-kanban@${VIBE_KANBAN_VERSION}',
        versionSource: {
          kind: 'github-release-asset',
          repository: 'mickmister/vibe-kanban',
          tag: 'vk-assets-example',
          asset: 'vibe-kanban-node.tar.gz',
        },
      },
    ],
    lifecycle: {
      start: 'vibe-kanban',
      stop: 'vibe-kanban',
    },
  },
  requestedCapabilities: {
    vkHttpApi: 'agentPrompt',
    codeServer: 'workspace',
    hostShell: {
      commands: ['npx vibe-kanban@${VIBE_KANBAN_VERSION}'],
    },
    filesystem: [
      {
        scope: 'repo',
        path: '/home/vkuser/repos',
        access: 'readWrite',
      },
    ],
    network: {
      mode: 'ingress-and-egress',
      ports: ['${BACKEND_PORT}'],
    },
    env: ['VIBE_KANBAN_VERSION', 'VK_SHARED_API_BASE'],
  },
};

describe('sandbox-first plugin manifest contract', () => {
  it('accepts Excalidraw as a north-star plugin with only scoped file storage', () => {
    const result = validatePluginManifest(excalidrawManifest);

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(getRequestedCapabilities(excalidrawManifest)).toEqual({
      ...DEFAULT_PLUGIN_CAPABILITY_REQUESTS,
      filesystem: [
        {
          scope: 'workspace',
          path: '.vibe/plugins/excalidraw',
          access: 'readWrite',
        },
      ],
    });
  });

  it('defaults every sensitive capability to denied when omitted', () => {
    const result = validatePluginManifest({
      schemaVersion: 1,
      id: 'app.readonly-notes',
      version: '1.0.0',
      displayName: 'Readonly Notes',
      kind: 'marketplace',
      components: {
        frontend: {
          kind: 'iframe',
          entry: 'frontend/index.html',
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.manifest && getRequestedCapabilities(result.manifest)).toEqual(
      DEFAULT_PLUGIN_CAPABILITY_REQUESTS,
    );
  });

  it('keeps requested capabilities distinct from admin-approved effective grants', () => {
    const grants = createDeniedEffectivePluginGrants(excalidrawManifest);

    expect(grants.pluginId).toBe(excalidrawManifest.id);
    expect(grants.approval.state).toBe('unapproved');
    expect(grants.requested.filesystem).toHaveLength(1);
    expect(grants.approved).toEqual(DEFAULT_PLUGIN_CAPABILITY_REQUESTS);
  });

  it('accepts privileged first-party VK service declarations without making them marketplace defaults', () => {
    const result = validatePluginManifest(firstPartyVkManifest);

    expect(result.success).toBe(true);
    expect(getRequestedCapabilities(firstPartyVkManifest).vkHttpApi).toBe('agentPrompt');
    expect(getRequestedCapabilities(excalidrawManifest).vkHttpApi).toBe('none');
  });

  it('rejects marketplace requests for VK API, host shell, code-server, host Docker socket, repo fs, env, and plugin access', () => {
    const result = validatePluginManifest({
      ...excalidrawManifest,
      requestedCapabilities: {
        vkHttpApi: 'agentPrompt',
        hostShell: { commands: ['gh auth token'] },
        codeServer: 'workspace',
        hostDocker: 'host-socket',
        filesystem: [{ scope: 'repo', path: '/home/vkuser/repos', access: 'readWrite' }],
        network: { mode: 'egress', hosts: ['github.com'] },
        env: ['GH_TOKEN'],
        secrets: ['github-token'],
        plugins: [{ pluginId: 'first-party.vibe-kanban', methods: ['runPrompt'] }],
      },
    });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'Marketplace plugins cannot request VK HTTP API access in V1',
        'Marketplace plugins cannot request host shell access',
        'Marketplace plugins cannot request code-server access',
        'Host Docker socket access is never a plugin capability; use microvm-dockerd containers',
        'Marketplace plugins cannot request repo-wide filesystem access',
        'Marketplace plugins cannot request direct environment variable access; request named secrets instead',
        'Marketplace plugins cannot request direct access to other plugins in V1',
      ]),
    );
  });

  it('validates each component family and fails closed on unknown fields', () => {
    const result = validatePluginManifest({
      schemaVersion: 1,
      id: 'app.kitchen-sink',
      version: '1.0.0',
      displayName: 'Kitchen Sink',
      kind: 'marketplace',
      components: {
        frontend: { kind: 'iframe', entry: 'frontend/index.html' },
        denoBackends: [{ id: 'api', entry: 'backend/api.ts', permissions: { net: ['api.example.test'] } }],
        containers: [
          {
            id: 'worker',
            image: 'ghcr.io/example/worker@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            composeFile: 'compose.yaml',
            dockerd: 'microvm',
          },
        ],
        mcp: [
          {
            id: 'docs',
            serverName: 'docs',
            transport: 'stdio',
            command: 'node server.js',
          },
        ],
        storage: [{ id: 'cache', scope: 'plugin-data', path: 'cache', access: 'readWrite' }],
        secrets: [{ id: 'api-token', provider: 'varlock', ref: 'plugins/kitchen-sink/api-token' }],
        healthChecks: [{ id: 'worker-health', kind: 'http', target: 'http://127.0.0.1:9000/health' }],
        lifecycle: { start: 'worker', stop: 'worker' },
      },
      requestedCapabilities: {
        hostDocker: 'microvm-dockerd',
        secrets: ['api-token'],
      },
      unexpected: true,
    });

    expect(result.success).toBe(false);
    expect(result.errors).toContain('Unknown manifest field: unexpected');
    expect(result.errors).not.toContain('Plugin must declare at least one component');
  });

  it('rejects malformed nested capability requests and Deno permission values fail-closed', () => {
    const result = validatePluginManifest({
      ...excalidrawManifest,
      components: {
        ...excalidrawManifest.components,
        denoBridges: [
          {
            id: 'bad-bridge',
            entry: 'bridges/storage.ts',
            methods: ['drawings.list', 123],
            permissions: {
              read: ['.vibe/plugins/excalidraw', '../secrets'],
              write: 'not-an-array',
              net: ['api.example.test', 8080],
              env: ['TOKEN'],
              run: [42],
              imports: ['https://deno.land/std/mod.ts', '../local.ts'],
            },
          },
        ],
        services: [
          {
            id: 'bad-service',
            runtime: 'deno',
            command: 'deno run service.ts',
            versionSource: {
              kind: 'github-release-asset',
              repository: '../bad',
              tag: '',
              asset: '../asset.tar.gz',
            },
          },
        ],
        lifecycle: { start: 123, stop: 'stop', restart: '' },
      },
      requestedCapabilities: {
        filesystem: [
          { scope: 'workspace', path: '.vibe/plugins/excalidraw', access: 'readWrite' },
          { scope: 'workspace', path: '../secrets', access: 'readWrite' },
          { scope: 'repo', path: '/home/vkuser/repos', access: 'admin' },
          'not-an-object',
        ],
        network: { mode: 'egress', hosts: ['api.example.test', 123], ports: ['443', false] },
        plugins: [
          { pluginId: 'first-party.vibe-kanban', methods: ['runPrompt', 42] },
          { pluginId: '../bad', methods: ['ok'] },
          'not-an-object',
        ],
      },
    });

    expect(result.success).toBe(false);
    expect(result.manifest).toBeUndefined();
    expect(result.errors).toEqual(expect.arrayContaining([
      'requestedCapabilities.filesystem[1].path must be safe relative path',
      'requestedCapabilities.filesystem[2].access must be read or readWrite',
      'requestedCapabilities.filesystem[3] must be an object',
      'requestedCapabilities.network.hosts must be a string array',
      'requestedCapabilities.network.ports must be a string array',
      'requestedCapabilities.plugins[0].methods must be a string array',
      'requestedCapabilities.plugins[1].pluginId must be a safe identifier',
      'requestedCapabilities.plugins[2] must be an object',
      'components.denoBridges[0].methods must be a string array',
      'components.denoBridges[0].permissions.read[1] must be a safe relative path',
      'components.denoBridges[0].permissions.write must be a string array',
      'components.denoBridges[0].permissions.net must be a string array',
      'components.denoBridges[0].permissions.run must be a string array',
      'components.denoBridges[0].permissions.imports[1] must be a safe import specifier',
      'components.services[0].versionSource.repository must be owner/repo',
      'components.services[0].versionSource.tag is required',
      'components.services[0].versionSource.asset must be a safe relative path',
      'components.lifecycle.start must be a non-empty string',
      'components.lifecycle.restart must be a non-empty string',
    ]));
  });

  it('returns validation errors instead of throwing for malformed nested manifests', () => {
    const malformedManifests = [
      {
        ...excalidrawManifest,
        requestedCapabilities: {
          filesystem: [null],
        },
      },
      {
        ...excalidrawManifest,
        components: {
          ...excalidrawManifest.components,
          secrets: {},
        },
      },
      {
        ...excalidrawManifest,
        components: {
          ...excalidrawManifest.components,
          secrets: [null],
        },
        requestedCapabilities: {
          secrets: ['missing-secret'],
        },
      },
    ];

    for (const manifest of malformedManifests) {
      expect(() => validatePluginManifest(manifest)).not.toThrow();
      const result = validatePluginManifest(manifest);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.manifest).toBeUndefined();
    }
  });
});
