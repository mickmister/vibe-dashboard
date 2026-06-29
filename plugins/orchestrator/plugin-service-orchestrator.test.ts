import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import beadsWebOnlyCatalog from '../fixtures/beads-web.plugins.json';
import firstPartyPluginCatalog from '../builtin.plugins.json';
import { composeCatalogs, runPluginServiceOrchestratorCli } from './plugin-service-orchestrator-cli';
import {
  applySupervisorConfigChanges,
  applyCaddyPluginConfigChange,
  createPluginServiceDryRunPlan,
  discoverCachedArtifacts,
  isPluginEnabled,
  materializePluginArtifacts,
  readExistingCaddyPluginConfig,
  readExistingSupervisorConfigs,
  renderCaddyPluginExposureConfig,
  renderSupervisorProgramConfig,
  renderServiceArgv,
  type PluginServiceCatalog,
} from './plugin-service-orchestrator';

describe('plugin service supervisor orchestration dry run', () => {
  const paths = {
    artifactCacheRoot: '/var/lib/vd/plugin-cache',
    installRoot: '/var/lib/vd/plugins',
    supervisorConfigDir: '/etc/supervisor/conf.d/vd-generated',
    caddyPluginConfigPath: '/etc/caddy/plugins.caddy',
  };

  it('imports the checked-in plugin catalog for startup-managed plugin services', () => {
    const catalog = firstPartyPluginCatalog as PluginServiceCatalog;

    expect(catalog.plugins.map((plugin) => plugin.id)).toEqual(['vd.beads-web']);
    expect(catalog.plugins[0]).toMatchObject({
      id: 'vd.beads-web',
      version: 'v0.11.6',
      installers: [
        {
          kind: 'github-release-asset',
          tag: 'v0.11.6',
          variants: {
            'linux-amd64': {
              sha256: 'd37eb1c979015e1ede0018f8bc049b72f2eb68a6033ff7bf4d63572183200371',
            },
            'linux-arm64': {
              asset: 'beads-web-linux-arm64',
              sha256: '384bd5433ac6fc5dc9fa8f43d87b1d8effe5d5af164622881ae105bea61d504f',
            },
          },
          materialize: { kind: 'file', installAs: 'bin/beads-web' },
        },
      ],
    });
  });

  it('plans downloads only for release assets that are not already cached with the requested sha', () => {
    const plan = createPluginServiceDryRunPlan({
      catalog: firstPartyPluginCatalog as PluginServiceCatalog,
      paths,
      cachedArtifacts: [
        {
          pluginId: 'vd.beads-web',
          version: 'v0.11.6',
          sha256: 'd37eb1c979015e1ede0018f8bc049b72f2eb68a6033ff7bf4d63572183200371',
          path: '/var/lib/vd/plugin-cache/github/mickmister/beads-web/v0.11.6/beads-web-linux-x64',
        },
      ],
      existingSupervisorConfigs: {},
    });

    expect(plan.artifacts).toEqual([
      expect.objectContaining({ pluginId: 'vd.beads-web', action: 'cached' }),
    ]);
  });

  it('returns idempotent supervisor config changes without mutating the host', () => {
    const existingConfig = renderSupervisorProgramConfig({
      plugin: (firstPartyPluginCatalog as PluginServiceCatalog).plugins[0]!,
      service: (firstPartyPluginCatalog as PluginServiceCatalog).plugins[0]!.services[0]!,
      paths,
    });

    const plan = createPluginServiceDryRunPlan({
      catalog: firstPartyPluginCatalog as PluginServiceCatalog,
      paths,
      cachedArtifacts: [],
      existingSupervisorConfigs: {
        '/etc/supervisor/conf.d/vd-generated/vd-plugin--vd_beads_web--web.conf': existingConfig,
        '/etc/supervisor/conf.d/vd-generated/vd-plugin--old_plugin--web.conf': '[program:old]\ncommand=old\n',
      },
    });

    expect(plan.supervisorChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'unchanged',
          program: 'vd-plugin--vd_beads_web--web',
          path: '/etc/supervisor/conf.d/vd-generated/vd-plugin--vd_beads_web--web.conf',
        }),
        expect.objectContaining({
          action: 'delete',
          path: '/etc/supervisor/conf.d/vd-generated/vd-plugin--old_plugin--web.conf',
        }),
      ]),
    );
  });

  it('renders hardened supervisor config for a service using persisted plugin install paths', () => {
    const beadsWebConfig = renderSupervisorProgramConfig({
      plugin: (firstPartyPluginCatalog as PluginServiceCatalog).plugins[0]!,
      service: (firstPartyPluginCatalog as PluginServiceCatalog).plugins[0]!.services[0]!,
      paths,
    });
    expect(beadsWebConfig).toContain('command=/usr/local/bin/vd-plugin-service-runner.mjs');
    expect(beadsWebConfig).not.toContain('command=/var/lib/vd/plugins/vd.beads-web/v0.11.6/extracted/bin/beads-web');
    expect(beadsWebConfig).toContain('environment=BEADS_WEB_PORT="3109",BEADS_WEB_PORT_BIND="0.0.0.0",HOST="0.0.0.0",PORT="3109",HOME="/home/vkuser",XDG_CONFIG_HOME="/home/vkuser/.config",VD_PLUGIN_ID="vd.beads-web",VD_PLUGIN_VERSION="v0.11.6",VD_SERVICE_ID="web",VD_SERVICE_ARGV_BASE64="');

    const encodedArgv = beadsWebConfig.match(/VD_SERVICE_ARGV_BASE64="([^"]+)"/)?.[1];
    expect(encodedArgv).toBeDefined();
    expect(JSON.parse(Buffer.from(encodedArgv!, 'base64').toString('utf8'))).toEqual([
      '/var/lib/vd/plugins/vd.beads-web/v0.11.6/extracted/bin/beads-web',
    ]);
  });

  it('renders plugin service commands as structured argv and preserves shell metacharacters in args', () => {
    const plugin = {
      id: 'test.argv',
      name: 'Argv Test',
      version: '1.0.0',
      installers: [{ kind: 'bundled-current-repo' }],
      services: [],
    } satisfies PluginServiceCatalog['plugins'][number];
    const service = {
      id: 'web',
      command: '${PLUGIN_DIR}/bin/run service',
      args: ['--name', 'value with spaces', 'literal; rm -rf /', 'quote"and$HOME'],
      directory: '${PLUGIN_DIR}',
      user: 'vkuser',
      autostart: true,
      autorestart: true,
    };

    expect(renderServiceArgv(plugin, service, paths)).toEqual([
      '/var/lib/vd/plugins/test.argv/1.0.0/extracted/bin/run service',
      '--name',
      'value with spaces',
      'literal; rm -rf /',
      'quote"and$HOME',
    ]);

    const config = renderSupervisorProgramConfig({ plugin, service, paths });
    expect(config).toContain('command=/usr/local/bin/vd-plugin-service-runner.mjs');
    expect(config).not.toContain('literal; rm -rf /');
    const encodedArgv = config.match(/VD_SERVICE_ARGV_BASE64="([^"]+)"/)?.[1];
    expect(encodedArgv).toBeDefined();
    expect(JSON.parse(Buffer.from(encodedArgv!, 'base64').toString('utf8'))).toEqual([
      '/var/lib/vd/plugins/test.argv/1.0.0/extracted/bin/run service',
      '--name',
      'value with spaces',
      'literal; rm -rf /',
      'quote"and$HOME',
    ]);
  });

  it('supports a beads-web-only catalog for isolated supervisor experiments', () => {
    const plan = createPluginServiceDryRunPlan({
      catalog: beadsWebOnlyCatalog as PluginServiceCatalog,
      paths,
      cachedArtifacts: [],
      existingSupervisorConfigs: {},
    });

    expect(plan.artifacts).toEqual([
      expect.objectContaining({
        action: 'download',
        pluginId: 'vd.beads-web',
        url: 'https://github.com/mickmister/beads-web/releases/download/v0.11.6/beads-web-linux-x64',
      }),
    ]);
    expect(plan.supervisorChanges).toEqual([
      expect.objectContaining({
        action: 'create',
        program: 'vd-plugin--vd_beads_web--web',
      }),
    ]);
    expect(plan.caddyConfigChange).toEqual(
      expect.objectContaining({
        action: 'create',
        path: '/etc/caddy/plugins.caddy',
        content: expect.stringContaining('@vd_plugin_vd_beads_web_web host beads-web.{$PROXY_DOMAIN}'),
      }),
    );
  });

  it('omits built-in plugins disabled via instance pluginStates from runtime Supervisor and Caddy config while planning supervisor removal, then re-enables them', () => {
    const catalog = composeCatalogs([
      structuredClone(firstPartyPluginCatalog) as PluginServiceCatalog,
      { plugins: [], pluginStates: { 'vd.beads-web': { enable: false } } },
    ]);
    const existingConfig = renderSupervisorProgramConfig({
      plugin: (firstPartyPluginCatalog as PluginServiceCatalog).plugins[0]!,
      service: (firstPartyPluginCatalog as PluginServiceCatalog).plugins[0]!.services[0]!,
      paths,
    });

    const disabledPlan = createPluginServiceDryRunPlan({
      catalog,
      paths,
      cachedArtifacts: [],
      existingSupervisorConfigs: {
        '/etc/supervisor/conf.d/vd-generated/vd-plugin--vd_beads_web--web.conf': existingConfig,
      },
      existingCaddyPluginConfig: '# previous generated plugin routes\n',
    });

    expect(disabledPlan.supervisorChanges).toEqual([
      expect.objectContaining({
        action: 'delete',
        path: '/etc/supervisor/conf.d/vd-generated/vd-plugin--vd_beads_web--web.conf',
      }),
    ]);
    expect(disabledPlan.caddyConfigChange).toEqual(expect.objectContaining({
      action: 'update',
      content: expect.not.stringContaining('beads-web.{$PROXY_DOMAIN}'),
    }));
    expect(disabledPlan.artifacts).toEqual([
      expect.objectContaining({
        action: 'download',
        pluginId: 'vd.beads-web',
      }),
    ]);

    const reenabledCatalog = composeCatalogs([
      structuredClone(firstPartyPluginCatalog) as PluginServiceCatalog,
      { plugins: [], pluginStates: { 'vd.beads-web': { enable: true } } },
    ]);
    const reenabledPlan = createPluginServiceDryRunPlan({
      catalog: reenabledCatalog,
      paths,
      cachedArtifacts: [],
      existingSupervisorConfigs: {},
      existingCaddyPluginConfig: disabledPlan.caddyConfigChange?.content,
    });

    expect(reenabledPlan.supervisorChanges).toEqual([
      expect.objectContaining({
        action: 'create',
        program: 'vd-plugin--vd_beads_web--web',
      }),
    ]);
    expect(reenabledPlan.caddyConfigChange).toEqual(expect.objectContaining({
      action: 'update',
      content: expect.stringContaining('beads-web.{$PROXY_DOMAIN}'),
    }));
  });

  it('renders plugin-owned Caddy exposure as structured host snippets without raw Caddyfile input', () => {
    const content = renderCaddyPluginExposureConfig({
      catalog: beadsWebOnlyCatalog as PluginServiceCatalog,
    });

    expect(content).toContain('# generated by VD plugin service orchestrator');
    expect(content).toContain('@vd_plugin_vd_beads_web_web host beads-web.{$PROXY_DOMAIN}');
    expect(content).toContain('handle @vd_plugin_vd_beads_web_web');
    expect(content).toContain('reverse_proxy 127.0.0.1:3109');
    expect(content).not.toContain('reverse_proxy 0.0.0.0:3109');
    expect(content).not.toContain('port-3109');
  });

  it('updates the single plugin-owned Caddy file idempotently', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-caddy-apply-'));
    const caddyPluginConfigPath = join(tempRoot, 'plugins.caddy');
    const isolatedPaths = {
      artifactCacheRoot: join(tempRoot, 'cache'),
      installRoot: join(tempRoot, 'plugins'),
      supervisorConfigDir: join(tempRoot, 'supervisor/conf.d/plugins'),
      caddyPluginConfigPath,
    };
    const firstPlan = createPluginServiceDryRunPlan({
      catalog: beadsWebOnlyCatalog as PluginServiceCatalog,
      paths: isolatedPaths,
      cachedArtifacts: [],
      existingSupervisorConfigs: {},
      existingCaddyPluginConfig: await readExistingCaddyPluginConfig(caddyPluginConfigPath),
    });

    await expect(applyCaddyPluginConfigChange(firstPlan.caddyConfigChange)).resolves.toEqual({
      action: 'create',
      path: caddyPluginConfigPath,
    });
    await expect(readFile(caddyPluginConfigPath, 'utf8')).resolves.toContain('beads-web.{$PROXY_DOMAIN}');

    const secondPlan = createPluginServiceDryRunPlan({
      catalog: beadsWebOnlyCatalog as PluginServiceCatalog,
      paths: isolatedPaths,
      cachedArtifacts: [],
      existingSupervisorConfigs: {},
      existingCaddyPluginConfig: await readExistingCaddyPluginConfig(caddyPluginConfigPath),
    });
    expect(secondPlan.caddyConfigChange).toEqual(expect.objectContaining({ action: 'unchanged' }));
  });

  it('validates candidate Caddy config before replacing the active plugin-owned file', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-caddy-validate-'));
    const caddyPluginConfigPath = join(tempRoot, 'plugins.caddy');
    const previousConfig = '# previous valid config\n';
    await writeFile(caddyPluginConfigPath, previousConfig);

    await expect(applyCaddyPluginConfigChange({
      action: 'update',
      path: caddyPluginConfigPath,
      content: '# candidate\n',
    }, {
      validateCandidate: async ({ candidatePath, content }) => {
        expect(candidatePath).toContain(`${caddyPluginConfigPath}.tmp-`);
        expect(content).toBe('# candidate\n');
      },
    })).resolves.toEqual({ action: 'update', path: caddyPluginConfigPath });
    await expect(readFile(caddyPluginConfigPath, 'utf8')).resolves.toBe('# candidate\n');

    await expect(applyCaddyPluginConfigChange({
      action: 'update',
      path: caddyPluginConfigPath,
      content: '# invalid candidate\n',
    }, {
      validateCandidate: async () => {
        throw new Error('caddy adapt failed');
      },
    })).rejects.toThrow('caddy adapt failed');
    await expect(readFile(caddyPluginConfigPath, 'utf8')).resolves.toBe('# candidate\n');
  });

  it('rejects unsafe Caddy exposure declarations before rendering config', () => {
    const catalog = structuredClone(beadsWebOnlyCatalog) as PluginServiceCatalog;
    catalog.plugins[0]!.services[0]!.httpExposure = {
      kind: 'caddy-subdomain',
      subdomain: 'beads-web.example.com',
      port: 'http',
    };

    expect(() => createPluginServiceDryRunPlan({
      catalog,
      paths,
      cachedArtifacts: [],
      existingSupervisorConfigs: {},
    })).toThrow(/Invalid Caddy subdomain/);

    catalog.plugins[0]!.services[0]!.httpExposure = {
      kind: 'caddy-subdomain',
      subdomain: 'beads-web',
      port: 'missing',
    };
    expect(() => createPluginServiceDryRunPlan({
      catalog,
      paths,
      cachedArtifacts: [],
      existingSupervisorConfigs: {},
    })).toThrow(/unknown port/);
  });

  it('rejects unsafe service catalog fields before they can reach supervisor or Caddy', () => {
    const invalidCases: Array<{ mutate: (catalog: PluginServiceCatalog) => void; message: RegExp }> = [
      {
        mutate: (catalog) => { catalog.plugins[0]!.id = '../evil'; },
        message: /Invalid plugin id/,
      },
      {
        mutate: (catalog) => {
          const installer = catalog.plugins[0]!.installers[0]!;
          if (installer.kind === 'github-release-asset') installer.repository = 'owner/repo/extra';
        },
        message: /Invalid GitHub repository/,
      },
      {
        mutate: (catalog) => {
          const installer = catalog.plugins[0]!.installers[0]!;
          if (installer.kind === 'github-release-asset') installer.variants['linux-amd64']!.asset = '../beads-web';
        },
        message: /Invalid artifact asset/,
      },
      {
        mutate: (catalog) => {
          const installer = catalog.plugins[0]!.installers[0]!;
          if (installer.kind === 'github-release-asset') installer.variants['linux-amd64']!.sha256 = 'not-a-sha';
        },
        message: /Invalid artifact sha256/,
      },
      {
        mutate: (catalog) => {
          const installer = catalog.plugins[0]!.installers[0]!;
          if (installer.kind === 'github-release-asset') installer.variants['linux-amd64']!.signature = 'TODO';
        },
        message: /Unsupported artifact signature/,
      },
      {
        mutate: (catalog) => { catalog.plugins[0]!.services[0]!.user = 'root'; },
        message: /Invalid service user/,
      },
      {
        mutate: (catalog) => { catalog.plugins[0]!.services[0]!.command = 'echo ok\nmalicious'; },
        message: /Invalid service command/,
      },
      {
        mutate: (catalog) => { catalog.plugins[0]!.services[0]!.env = { 'BAD-KEY': 'value' }; },
        message: /Invalid env key/,
      },
      {
        mutate: (catalog) => { catalog.plugins[0]!.services[0]!.ports![0]!.default = 70000; },
        message: /Invalid port default/,
      },
      {
        mutate: (catalog) => { catalog.plugins[0]!.services[0]!.ports![0]!.bind = 'example.com'; },
        message: /Invalid port bind/,
      },
    ];

    for (const { mutate, message } of invalidCases) {
      const catalog = structuredClone(beadsWebOnlyCatalog) as PluginServiceCatalog;
      mutate(catalog);
      expect(() => createPluginServiceDryRunPlan({
        catalog,
        paths,
        cachedArtifacts: [],
        existingSupervisorConfigs: {},
      })).toThrow(message);
    }
  });

  it('rejects legacy preStart shell hooks instead of rendering them into supervisor commands', () => {
    const catalog = structuredClone(beadsWebOnlyCatalog) as PluginServiceCatalog;
    (catalog.plugins[0]!.services[0]! as unknown as { preStart: string[] }).preStart = ['echo unsafe && touch /tmp/file'];

    expect(() => createPluginServiceDryRunPlan({
      catalog,
      paths,
      cachedArtifacts: [],
      existingSupervisorConfigs: {},
    })).toThrow(/Unsupported service preStart/);
  });

  it('rejects malformed service catalog JSON shapes with validation errors', () => {
    const invalidCases: Array<{ catalog: unknown; message: RegExp }> = [
      { catalog: null, message: /Invalid plugin catalog/ },
      { catalog: { plugins: {} }, message: /plugins must be an array/ },
      { catalog: { plugins: [], pluginStates: [] }, message: /pluginStates must be an object/ },
      { catalog: { plugins: [], pluginStates: { '../evil': { enable: true } } }, message: /Invalid plugin state id/ },
      { catalog: { plugins: [], pluginStates: { 'vd.beads-web': null } }, message: /Invalid plugin state for vd\.beads-web/ },
      { catalog: { plugins: [], pluginStates: { 'vd.beads-web': { enable: 'yes' } } }, message: /Invalid plugin state enable/ },
      { catalog: { plugins: [null] }, message: /Invalid plugin definition/ },
      { catalog: { plugins: [{ ...structuredClone(beadsWebOnlyCatalog).plugins[0], installers: null }] }, message: /Invalid installers/ },
      { catalog: { plugins: [{ ...structuredClone(beadsWebOnlyCatalog).plugins[0], services: [null] }] }, message: /Invalid service definition/ },
      { catalog: { plugins: [{ ...structuredClone(beadsWebOnlyCatalog).plugins[0], services: [{ ...structuredClone(beadsWebOnlyCatalog).plugins[0]!.services[0], args: 'nope' }] }] }, message: /Invalid service args/ },
      { catalog: { plugins: [{ ...structuredClone(beadsWebOnlyCatalog).plugins[0], services: [{ ...structuredClone(beadsWebOnlyCatalog).plugins[0]!.services[0], env: [] }] }] }, message: /Invalid service env/ },
      { catalog: { plugins: [{ ...structuredClone(beadsWebOnlyCatalog).plugins[0], services: [{ ...structuredClone(beadsWebOnlyCatalog).plugins[0]!.services[0], ports: [null] }] }] }, message: /Invalid port definition/ },
      { catalog: { plugins: [{ ...structuredClone(beadsWebOnlyCatalog).plugins[0], services: [{ ...structuredClone(beadsWebOnlyCatalog).plugins[0]!.services[0], autostart: 'yes' }] }] }, message: /Invalid service autostart/ },
    ];

    for (const { catalog, message } of invalidCases) {
      expect(() => createPluginServiceDryRunPlan({
        catalog: catalog as PluginServiceCatalog,
        paths,
        cachedArtifacts: [],
        existingSupervisorConfigs: {},
      })).toThrow(message);
    }
  });

  it('supports asset-only plugins that need download/install but no supervisor service', () => {
    const catalog: PluginServiceCatalog = {
      plugins: [{
        id: 'vd.excalidraw',
        name: 'Excalidraw',
        version: '0.18.0',
        installers: [{
          kind: 'github-release-asset',
          repository: 'excalidraw/excalidraw',
          tag: 'v0.18.0',
          variants: { 'linux-amd64': { asset: 'excalidraw-0.18.0.tgz', sha256: '0f2851674434336f19f10b5f217977eac7a0714de7e31a559bc5dd37f2c2dc21' } },
          materialize: { kind: 'file', installAs: 'excalidraw-0.18.0.tgz', outputs: [{ kind: 'file', path: 'excalidraw-0.18.0.tgz' }] },
        }],
        services: [],
      }],
    };

    const plan = createPluginServiceDryRunPlan({
      catalog,
      paths,
      cachedArtifacts: [],
      existingSupervisorConfigs: {},
    });

    expect(plan.artifacts).toEqual([
      expect.objectContaining({
        action: 'download',
        pluginId: 'vd.excalidraw',
        url: 'https://github.com/excalidraw/excalidraw/releases/download/v0.18.0/excalidraw-0.18.0.tgz',
      }),
    ]);
    expect(plan.supervisorChanges).toEqual([]);
  });

  it('discovers cached artifacts by hashing files in the persistent artifact cache', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-plugin-cache-'));
    const cachePath = join(tempRoot, 'cache/github/mickmister/beads-web/v0.11.6/beads-web-linux-x64');
    const bytes = Buffer.from('fake beads-web artifact');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const catalog = structuredClone(beadsWebOnlyCatalog) as PluginServiceCatalog;
    const installer = catalog.plugins[0]!.installers[0]!;
    if (installer.kind !== 'github-release-asset') throw new Error('expected github-release-asset fixture');
    installer.variants['linux-amd64']!.sha256 = sha256;
    await mkdir(join(tempRoot, 'cache/github/mickmister/beads-web/v0.11.6'), { recursive: true });
    await writeFile(cachePath, bytes);

    await expect(discoverCachedArtifacts({
      catalog,
      paths: {
        artifactCacheRoot: join(tempRoot, 'cache'),
        installRoot: join(tempRoot, 'plugins'),
        supervisorConfigDir: join(tempRoot, 'supervisor'),
      },
    })).resolves.toEqual([{ pluginId: 'vd.beads-web', version: 'v0.11.6', sha256, path: cachePath }]);
  });

  it('downloads a binary release asset, allows explicit hash bypass for smoke runs, and installs it executable', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-plugin-materialize-'));
    const materialized = await materializePluginArtifacts({
      catalog: beadsWebOnlyCatalog as PluginServiceCatalog,
      paths: {
        artifactCacheRoot: join(tempRoot, 'cache'),
        installRoot: join(tempRoot, 'plugins'),
        supervisorConfigDir: join(tempRoot, 'supervisor'),
      },
      allowHashMismatch: true,
      fetchBytes: async () => Buffer.from('#!/bin/sh\necho fake beads-web\\n'),
    });

    expect(materialized).toEqual([
      expect.objectContaining({ action: 'downloaded', pluginId: 'vd.beads-web' }),
    ]);
    await expect(readFile(join(tempRoot, 'plugins/vd.beads-web/v0.11.6/extracted/bin/beads-web'), 'utf8')).resolves.toContain('fake beads-web');
  });

  it('does not poison the persistent artifact cache when a download fails sha verification', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-plugin-materialize-bad-sha-'));
    const paths = {
      artifactCacheRoot: join(tempRoot, 'cache'),
      installRoot: join(tempRoot, 'plugins'),
      supervisorConfigDir: join(tempRoot, 'supervisor'),
    };
    const catalog = structuredClone(beadsWebOnlyCatalog) as PluginServiceCatalog;
    const installer = catalog.plugins[0]!.installers[0]!;
    if (installer.kind !== 'github-release-asset') throw new Error('expected github-release-asset fixture');
    installer.variants['linux-amd64']!.sha256 = '0'.repeat(64);
    const cachePath = join(tempRoot, 'cache/github/mickmister/beads-web/v0.11.6/beads-web-linux-x64');

    await expect(materializePluginArtifacts({
      catalog,
      paths,
      fetchBytes: async () => Buffer.from('tampered bytes'),
    })).rejects.toThrow(/sha256 mismatch/);
    await expect(access(cachePath)).rejects.toThrow();

    const validBytes = Buffer.from('valid bytes');
    installer.variants['linux-amd64']!.sha256 = createHash('sha256').update(validBytes).digest('hex');
    await expect(materializePluginArtifacts({
      catalog,
      paths,
      fetchBytes: async () => validBytes,
    })).resolves.toEqual([
      expect.objectContaining({ action: 'downloaded', pluginId: 'vd.beads-web' }),
    ]);
    await expect(readFile(cachePath, 'utf8')).resolves.toBe('valid bytes');
  });

  it('quarantines a stale bad cache entry and refetches the requested artifact once', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-plugin-stale-cache-'));
    const paths = {
      artifactCacheRoot: join(tempRoot, 'cache'),
      installRoot: join(tempRoot, 'plugins'),
      supervisorConfigDir: join(tempRoot, 'supervisor'),
    };
    const catalog = structuredClone(beadsWebOnlyCatalog) as PluginServiceCatalog;
    const installer = catalog.plugins[0]!.installers[0]!;
    if (installer.kind !== 'github-release-asset') throw new Error('expected github-release-asset fixture');
    const validBytes = Buffer.from('#!/bin/sh\necho valid beads-web\n');
    installer.variants['linux-amd64']!.sha256 = createHash('sha256').update(validBytes).digest('hex');
    const cachePath = join(tempRoot, 'cache/github/mickmister/beads-web/v0.11.6/beads-web-linux-x64');
    await mkdir(join(tempRoot, 'cache/github/mickmister/beads-web/v0.11.6'), { recursive: true });
    await writeFile(cachePath, 'stale bad cache');
    let fetchCount = 0;

    await expect(materializePluginArtifacts({
      catalog,
      paths,
      fetchBytes: async () => {
        fetchCount += 1;
        return validBytes;
      },
    })).resolves.toEqual([
      expect.objectContaining({ action: 'downloaded', pluginId: 'vd.beads-web' }),
    ]);

    expect(fetchCount).toBe(1);
    await expect(readFile(cachePath, 'utf8')).resolves.toBe(validBytes.toString());
  });

  it('does not overwrite an already-installed matching binary on repeated materialization', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-plugin-materialize-idempotent-'));
    const paths = {
      artifactCacheRoot: join(tempRoot, 'cache'),
      installRoot: join(tempRoot, 'plugins'),
      supervisorConfigDir: join(tempRoot, 'supervisor'),
    };
    const catalog = structuredClone(beadsWebOnlyCatalog) as PluginServiceCatalog;
    const installer = catalog.plugins[0]!.installers[0]!;
    if (installer.kind !== 'github-release-asset') throw new Error('expected github-release-asset fixture');
    const bytes = Buffer.from('#!/bin/sh\necho stable beads-web\\n');
    installer.variants['linux-amd64']!.sha256 = createHash('sha256').update(bytes).digest('hex');
    let fetchCount = 0;
    const fetchBytes = async () => {
      fetchCount += 1;
      return bytes;
    };

    await materializePluginArtifacts({ catalog, paths, fetchBytes });
    await materializePluginArtifacts({ catalog, paths, fetchBytes });

    expect(fetchCount).toBe(1);
    await expect(readFile(join(tempRoot, 'plugins/vd.beads-web/v0.11.6/extracted/bin/beads-web'), 'utf8')).resolves.toContain('stable beads-web');
  });

  it('extracts a selected zip entry after download verification and installs it as the runnable artifact', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-plugin-zip-materialize-'));
    const paths = {
      artifactCacheRoot: join(tempRoot, 'cache'),
      installRoot: join(tempRoot, 'plugins'),
      supervisorConfigDir: join(tempRoot, 'supervisor'),
    };
    const executable = '#!/bin/sh\necho silverbullet\n';
    const zipBytes = createZipFixture([
      { name: 'silverbullet', data: executable, deflate: true },
      { name: 'README.md', data: 'ignored\n' },
    ]);
    const catalog: PluginServiceCatalog = {
      plugins: [
        {
          id: 'vd.silverbullet',
          name: 'SilverBullet',
          version: '2.9.0',
          installers: [{
            kind: 'github-release-asset',
            repository: 'silverbulletmd/silverbullet',
            tag: '2.9.0',
            variants: { 'linux-amd64': { asset: 'silverbullet-server-linux-x86_64.zip', sha256: createHash('sha256').update(zipBytes).digest('hex') } },
            materialize: { kind: 'zip-entry', entry: 'silverbullet', installAs: 'bin/silverbullet', outputs: [{ kind: 'file', path: 'bin/silverbullet', mode: '0755' }] },
          }],
          services: [
            {
              id: 'web',
              command: '${PLUGIN_DIR}/bin/silverbullet',
              directory: '${PLUGIN_DIR}',
              user: 'vkuser',
              autostart: true,
              autorestart: true,
            },
          ],
        },
      ],
    };

    await expect(materializePluginArtifacts({
      catalog,
      paths,
      fetchBytes: async () => zipBytes,
    })).resolves.toEqual([
      expect.objectContaining({ action: 'downloaded', pluginId: 'vd.silverbullet' }),
    ]);

    const installTarget = join(tempRoot, 'plugins/vd.silverbullet/2.9.0/extracted/bin/silverbullet');
    await expect(readFile(installTarget, 'utf8')).resolves.toBe(executable);
    await expect(readFile(join(tempRoot, 'cache/github/silverbulletmd/silverbullet/2.9.0/silverbullet-server-linux-x86_64.zip'))).resolves.toEqual(zipBytes);
  });

  it('extracts archive trees, strips release directory prefixes, validates outputs, and exposes declared bins', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-plugin-archive-tree-'));
    const paths = {
      artifactCacheRoot: join(tempRoot, 'cache'),
      installRoot: join(tempRoot, 'plugins'),
      supervisorConfigDir: join(tempRoot, 'supervisor'),
      pluginBinDir: join(tempRoot, 'plugin-bin'),
    };
    const executable = '#!/bin/sh\necho filebrowser\n';
    const tarGzBytes = createTarGzFixture([
      { name: 'filebrowser-v1/filebrowser', data: executable },
      { name: 'filebrowser-v1/README.md', data: 'docs\n' },
    ]);
    const catalog: PluginServiceCatalog = {
      plugins: [{
        id: 'vd.filebrowser',
        name: 'File Browser',
        version: '1.0.0',
        installers: [{
          kind: 'github-release-asset',
          repository: 'filebrowser/filebrowser',
          tag: 'v1.0.0',
          variants: { 'linux-amd64': { asset: 'linux-amd64-filebrowser.tar.gz', sha256: createHash('sha256').update(tarGzBytes).digest('hex') } },
          materialize: {
            kind: 'archive-tree',
            format: 'tar.gz',
            stripComponents: 1,
            outputs: [{ kind: 'file', path: 'filebrowser', mode: '0755' }],
          },
          bin: { filebrowser: 'filebrowser' },
        }],
        services: [],
      }],
    };

    await expect(materializePluginArtifacts({ catalog, paths, fetchBytes: async () => tarGzBytes })).resolves.toEqual([
      expect.objectContaining({ action: 'downloaded', pluginId: 'vd.filebrowser' }),
    ]);
    await expect(readFile(join(tempRoot, 'plugins/vd.filebrowser/1.0.0/extracted/filebrowser'), 'utf8')).resolves.toBe(executable);
    await expect(readlink(join(tempRoot, 'plugin-bin/filebrowser'))).resolves.toBe(join(tempRoot, 'plugins/vd.filebrowser/1.0.0/extracted/filebrowser'));
  });

  it('rejects archive trees whose declared uncompressed size exceeds the safety cap', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-plugin-archive-size-cap-'));
    const paths = {
      artifactCacheRoot: join(tempRoot, 'cache'),
      installRoot: join(tempRoot, 'plugins'),
      supervisorConfigDir: join(tempRoot, 'supervisor'),
    };
    const zipBytes = createZipFixtureWithDeclaredSize('huge.bin', 1024 * 1024 * 1024 + 1);
    const catalog: PluginServiceCatalog = {
      plugins: [{
        id: 'vd.huge',
        name: 'Huge',
        version: '1.0.0',
        installers: [{
          kind: 'github-release-asset',
          repository: 'example/huge',
          tag: 'v1.0.0',
          variants: { 'linux-amd64': { asset: 'huge.zip', sha256: createHash('sha256').update(zipBytes).digest('hex') } },
          materialize: {
            kind: 'archive-tree',
            format: 'zip',
            outputs: [{ kind: 'file', path: 'huge.bin' }],
          },
        }],
        services: [],
      }],
    };

    await expect(materializePluginArtifacts({ catalog, paths, fetchBytes: async () => zipBytes }))
      .rejects.toThrow('Archive tree exceeds maximum uncompressed size');
  });

  it('rejects archive trees with excessive entry counts', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-plugin-archive-entry-cap-'));
    const paths = {
      artifactCacheRoot: join(tempRoot, 'cache'),
      installRoot: join(tempRoot, 'plugins'),
      supervisorConfigDir: join(tempRoot, 'supervisor'),
    };
    const tarGzBytes = createTarGzFixture(Array.from({ length: 10_001 }, (_, index) => ({
      name: `tree/file-${index}.txt`,
      data: 'x',
    })));
    const catalog: PluginServiceCatalog = {
      plugins: [{
        id: 'vd.too-many-files',
        name: 'Too Many Files',
        version: '1.0.0',
        installers: [{
          kind: 'github-release-asset',
          repository: 'example/too-many-files',
          tag: 'v1.0.0',
          variants: { 'linux-amd64': { asset: 'too-many-files.tar.gz', sha256: createHash('sha256').update(tarGzBytes).digest('hex') } },
          materialize: {
            kind: 'archive-tree',
            format: 'tar.gz',
            stripComponents: 2,
            outputs: [{ kind: 'file', path: 'file-0.txt' }],
          },
        }],
        services: [],
      }],
    };

    await expect(materializePluginArtifacts({ catalog, paths, fetchBytes: async () => tarGzBytes }))
      .rejects.toThrow('Archive tree exceeds maximum entry count');
  });

  it('runs package-manager installers against the persistent toolchain roots', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-plugin-package-installers-'));
    const paths = {
      artifactCacheRoot: join(tempRoot, 'cache'),
      installRoot: join(tempRoot, 'plugins'),
      supervisorConfigDir: join(tempRoot, 'supervisor'),
      toolchainRoot: join(tempRoot, 'toolchains'),
    };
    const catalog: PluginServiceCatalog = {
      plugins: [{
        id: 'vd.tools',
        name: 'Tools',
        version: '1.0.0',
        installers: [
          { kind: 'uv-tool', package: 'ruff', version: '0.9.0' },
          { kind: 'npm-global', package: '@modelcontextprotocol/server-filesystem', version: '1.0.0' },
          { kind: 'cargo-crate', crate: 'just', version: '1.40.0' },
          { kind: 'go-install', module: 'github.com/example/tool', version: 'v1.2.3' },
        ],
        services: [],
      }],
    };
    const commands: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];

    await expect(materializePluginArtifacts({
      catalog,
      paths,
      executeCommand: async (command, args, options) => {
        commands.push({ command, args, env: options.env });
      },
    })).resolves.toEqual([
      expect.objectContaining({ action: 'installed', installerKind: 'uv-tool' }),
      expect.objectContaining({ action: 'installed', installerKind: 'npm-global' }),
      expect.objectContaining({ action: 'installed', installerKind: 'cargo-crate' }),
      expect.objectContaining({ action: 'installed', installerKind: 'go-install' }),
    ]);

    expect(commands.map((entry) => [entry.command, entry.args])).toEqual([
      ['uv', ['tool', 'install', 'ruff==0.9.0']],
      ['npm', ['install', '--global', '@modelcontextprotocol/server-filesystem@1.0.0']],
      ['cargo', ['install', 'just', '--version', '1.40.0', '--root', join(tempRoot, 'toolchains')]],
      ['go', ['install', 'github.com/example/tool@v1.2.3']],
    ]);
    expect(commands[0]!.env.UV_TOOL_BIN_DIR).toBe(join(tempRoot, 'toolchains/bin'));
    expect(commands[1]!.env.NPM_CONFIG_PREFIX).toBe(join(tempRoot, 'toolchains/npm'));
    expect(commands[3]!.env.GOBIN).toBe(join(tempRoot, 'toolchains/bin'));
  });

  it('rejects zip artifact descriptors that try to extract unsafe paths', async () => {
    const catalog = structuredClone(beadsWebOnlyCatalog) as PluginServiceCatalog;
    const installer = catalog.plugins[0]!.installers[0]!;
    if (installer.kind !== 'github-release-asset') throw new Error('expected github-release-asset fixture');
    installer.variants['linux-amd64']!.asset = 'plugin.zip';
    installer.materialize = {
      kind: 'zip-entry',
      entry: '../beads-web',
      installAs: 'bin/beads-web',
      outputs: [{ kind: 'file', path: 'bin/beads-web' }],
    };

    await expect(materializePluginArtifacts({
      catalog,
      paths: {
        artifactCacheRoot: '/tmp/cache',
        installRoot: '/tmp/plugins',
        supervisorConfigDir: '/tmp/supervisor',
      },
      fetchBytes: async () => Buffer.from('not reached'),
    })).rejects.toThrow('Invalid materializer zip entry');
  });

  it('applies generated supervisor configs to a separate config directory idempotently', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-supervisor-apply-'));
    const isolatedPaths = {
      artifactCacheRoot: join(tempRoot, 'cache'),
      installRoot: join(tempRoot, 'plugins'),
      supervisorConfigDir: join(tempRoot, 'supervisor/conf.d/plugins'),
    };
    const catalog = beadsWebOnlyCatalog as PluginServiceCatalog;
    const firstPlan = createPluginServiceDryRunPlan({
      catalog,
      paths: isolatedPaths,
      cachedArtifacts: [],
      existingSupervisorConfigs: await readExistingSupervisorConfigs(isolatedPaths.supervisorConfigDir),
    });

    await expect(applySupervisorConfigChanges(firstPlan.supervisorChanges)).resolves.toEqual([
      expect.objectContaining({ action: 'create', path: join(isolatedPaths.supervisorConfigDir, 'vd-plugin--vd_beads_web--web.conf') }),
    ]);
    await expect(readFile(join(isolatedPaths.supervisorConfigDir, 'vd-plugin--vd_beads_web--web.conf'), 'utf8')).resolves.toContain(
      '[program:vd-plugin--vd_beads_web--web]',
    );

    const secondPlan = createPluginServiceDryRunPlan({
      catalog,
      paths: isolatedPaths,
      cachedArtifacts: [],
      existingSupervisorConfigs: await readExistingSupervisorConfigs(isolatedPaths.supervisorConfigDir),
    });
    expect(secondPlan.supervisorChanges).toEqual([
      expect.objectContaining({ action: 'unchanged', path: join(isolatedPaths.supervisorConfigDir, 'vd-plugin--vd_beads_web--web.conf') }),
    ]);
  });

  it('exposes a CLI boundary that can dry-run or apply without touching core supervisor config', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-plugin-cli-'));
    const catalogPath = join(tempRoot, 'beads-web.plugins.json');
    const supervisorConfigDir = join(tempRoot, 'supervisor/conf.d/plugins');
    await writeFile(catalogPath, JSON.stringify(beadsWebOnlyCatalog));

    const dryRun = await runPluginServiceOrchestratorCli([
      'dry-run',
      '--catalog', catalogPath,
      '--artifact-cache-root', join(tempRoot, 'cache'),
      '--install-root', join(tempRoot, 'plugins'),
      '--supervisor-config-dir', supervisorConfigDir,
    ]);
    expect(dryRun.plan.supervisorChanges).toEqual([
      expect.objectContaining({ action: 'create', path: join(supervisorConfigDir, 'vd-plugin--vd_beads_web--web.conf') }),
    ]);
    await expect(readExistingSupervisorConfigs(supervisorConfigDir)).resolves.toEqual({});

    const applied = await runPluginServiceOrchestratorCli([
      'apply',
      '--catalog', catalogPath,
      '--artifact-cache-root', join(tempRoot, 'cache'),
      '--install-root', join(tempRoot, 'plugins'),
      '--supervisor-config-dir', supervisorConfigDir,
    ]);
    expect(applied.applied).toEqual([
      expect.objectContaining({ action: 'create', path: join(supervisorConfigDir, 'vd-plugin--vd_beads_web--web.conf') }),
    ]);
  });

  it('refreshes github-release-asset plugin files to a new release tag with verified sha256 values', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-plugin-cli-refresh-'));
    const catalogPath = join(tempRoot, 'beads-web.plugins.json');
    const pluginPath = join(tempRoot, 'beads-web.plugin.json');
    const catalog = structuredClone(beadsWebOnlyCatalog) as PluginServiceCatalog;
    await writeFile(catalogPath, JSON.stringify(catalog));
    await writeFile(pluginPath, JSON.stringify(catalog.plugins[0]));

    const bytesByAsset = new Map([
      ['beads-web-linux-x64', Buffer.from('linux x64 v9.9.9')],
      ['beads-web-linux-arm64', Buffer.from('linux arm64 v9.9.9')],
    ]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlString = String(url);
      const asset = [...bytesByAsset.keys()].find((candidate) => urlString.endsWith(`/${candidate}`));
      if (!asset) return new Response('not found', { status: 404, statusText: 'Not Found' });
      return new Response(bytesByAsset.get(asset));
    }) as typeof fetch;

    try {
      const result = await runPluginServiceOrchestratorCli([
        'refresh-github-release',
        '--plugin-id', 'vd.beads-web',
        '--tag', 'v9.9.9',
        '--catalog', catalogPath,
        '--plugin', pluginPath,
      ]);

      expect(result).toMatchObject({
        mode: 'refresh-github-release',
        pluginId: 'vd.beads-web',
        tag: 'v9.9.9',
        files: [
          expect.objectContaining({ path: catalogPath, kind: 'catalog', previousVersion: 'v0.11.6', version: 'v9.9.9' }),
          expect.objectContaining({ path: pluginPath, kind: 'plugin', previousVersion: 'v0.11.6', version: 'v9.9.9' }),
        ],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    for (const path of [catalogPath, pluginPath]) {
      const refreshed = JSON.parse(await readFile(path, 'utf8'));
      const plugin = path === catalogPath ? refreshed.plugins[0] : refreshed;
      const installer = plugin.installers[0];
      expect(plugin.version).toBe('v9.9.9');
      expect(installer.tag).toBe('v9.9.9');
      expect(installer.variants['linux-amd64'].sha256).toBe(
        createHash('sha256').update(bytesByAsset.get('beads-web-linux-x64')!).digest('hex'),
      );
      expect(installer.variants['linux-arm64'].sha256).toBe(
        createHash('sha256').update(bytesByAsset.get('beads-web-linux-arm64')!).digest('hex'),
      );
    }
  });

  it('composes checked-in catalog with a missing optional per-instance catalog', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-plugin-cli-missing-optional-'));
    const builtinCatalogPath = join(tempRoot, 'builtin.plugins.json');
    await writeFile(builtinCatalogPath, JSON.stringify(beadsWebOnlyCatalog));

    const result = await runPluginServiceOrchestratorCli([
      'dry-run',
      '--catalog', builtinCatalogPath,
      '--optional-catalog', join(tempRoot, 'missing-instance/plugins.json'),
      '--artifact-cache-root', join(tempRoot, 'cache'),
      '--install-root', join(tempRoot, 'plugins'),
      '--supervisor-config-dir', join(tempRoot, 'supervisor/conf.d/plugins'),
    ]);

    expect(result.catalogPaths).toEqual([builtinCatalogPath]);
    expect(result.optionalCatalogPaths).toEqual([join(tempRoot, 'missing-instance/plugins.json')]);
    expect(result.plan.artifacts).toEqual([
      expect.objectContaining({ action: 'download', pluginId: 'vd.beads-web' }),
    ]);
  });

  it('validates raw catalog files before overlay composition', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-plugin-cli-invalid-catalog-'));
    const invalidCatalogPath = join(tempRoot, 'invalid.plugins.json');
    const builtinCatalogPath = join(tempRoot, 'builtin.plugins.json');
    const optionalCatalogPath = join(tempRoot, 'optional.plugins.json');

    await writeFile(invalidCatalogPath, 'null');
    await expect(runPluginServiceOrchestratorCli([
      'dry-run',
      '--catalog', invalidCatalogPath,
      '--artifact-cache-root', join(tempRoot, 'cache'),
      '--install-root', join(tempRoot, 'plugins'),
      '--supervisor-config-dir', join(tempRoot, 'supervisor/conf.d/plugins'),
    ])).rejects.toThrow(/Invalid plugin catalog/);

    await writeFile(builtinCatalogPath, JSON.stringify(beadsWebOnlyCatalog));
    await writeFile(optionalCatalogPath, JSON.stringify({ plugins: [null] }));
    await expect(runPluginServiceOrchestratorCli([
      'dry-run',
      '--catalog', builtinCatalogPath,
      '--optional-catalog', optionalCatalogPath,
      '--artifact-cache-root', join(tempRoot, 'cache'),
      '--install-root', join(tempRoot, 'plugins'),
      '--supervisor-config-dir', join(tempRoot, 'supervisor/conf.d/plugins'),
    ])).rejects.toThrow(/Invalid plugin definition/);
  });

  it('rejects duplicate plugin ids inside one catalog while allowing per-instance override by id', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-plugin-cli-duplicates-'));
    const duplicateCatalogPath = join(tempRoot, 'duplicates.plugins.json');
    const builtinCatalogPath = join(tempRoot, 'builtin.plugins.json');
    const instanceCatalogPath = join(tempRoot, 'instance.plugins.json');
    const duplicateCatalog = {
      plugins: [
        (beadsWebOnlyCatalog as PluginServiceCatalog).plugins[0],
        (beadsWebOnlyCatalog as PluginServiceCatalog).plugins[0],
      ],
    };
    await writeFile(duplicateCatalogPath, JSON.stringify(duplicateCatalog));

    await expect(runPluginServiceOrchestratorCli([
      'dry-run',
      '--catalog', duplicateCatalogPath,
      '--artifact-cache-root', join(tempRoot, 'cache'),
      '--install-root', join(tempRoot, 'plugins'),
      '--supervisor-config-dir', join(tempRoot, 'supervisor/conf.d/plugins'),
    ])).rejects.toThrow(/Duplicate plugin id/);

    const overrideCatalog = structuredClone(beadsWebOnlyCatalog) as PluginServiceCatalog;
    const overridePlugin = overrideCatalog.plugins[0]!;
    const installer = overridePlugin.installers[0]!;
    if (installer.kind !== 'github-release-asset') throw new Error('expected github-release-asset fixture');
    overridePlugin.version = 'beads-web-assets-cli-override';
    installer.tag = 'beads-web-assets-cli-override';
    installer.variants['linux-amd64']!.sha256 = 'd'.repeat(64);
    await writeFile(builtinCatalogPath, JSON.stringify(beadsWebOnlyCatalog));
    await writeFile(instanceCatalogPath, JSON.stringify(overrideCatalog));

    const result = await runPluginServiceOrchestratorCli([
      'dry-run',
      '--catalog', builtinCatalogPath,
      '--optional-catalog', instanceCatalogPath,
      '--artifact-cache-root', join(tempRoot, 'cache'),
      '--install-root', join(tempRoot, 'plugins'),
      '--supervisor-config-dir', join(tempRoot, 'supervisor/conf.d/plugins'),
    ]);
    expect(result.plan.artifacts).toEqual([
      expect.objectContaining({
        pluginId: 'vd.beads-web',
        version: 'beads-web-assets-cli-override',
      }),
    ]);
  });

  it('lets per-instance catalog override a checked-in plugin by id', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-plugin-cli-overlay-'));
    const builtinCatalogPath = join(tempRoot, 'builtin.plugins.json');
    const instanceCatalogPath = join(tempRoot, 'instance.plugins.json');
    const overrideCatalog = structuredClone(beadsWebOnlyCatalog) as PluginServiceCatalog;
    const overridePlugin = overrideCatalog.plugins[0]!;
    const installer = overridePlugin.installers[0]!;
    if (installer.kind !== 'github-release-asset') throw new Error('expected github-release-asset fixture');
    overridePlugin.version = 'beads-web-assets-override';
    installer.tag = 'beads-web-assets-override';
    installer.variants['linux-amd64']!.sha256 = 'e'.repeat(64);
    await writeFile(builtinCatalogPath, JSON.stringify(beadsWebOnlyCatalog));
    await writeFile(instanceCatalogPath, JSON.stringify(overrideCatalog));

    const result = await runPluginServiceOrchestratorCli([
      'dry-run',
      '--catalog', builtinCatalogPath,
      '--optional-catalog', instanceCatalogPath,
      '--artifact-cache-root', join(tempRoot, 'cache'),
      '--install-root', join(tempRoot, 'plugins'),
      '--supervisor-config-dir', join(tempRoot, 'supervisor/conf.d/plugins'),
    ]);

    expect(result.plan.artifacts).toEqual([
      expect.objectContaining({
        pluginId: 'vd.beads-web',
        version: 'beads-web-assets-override',
        url: 'https://github.com/mickmister/beads-web/releases/download/beads-web-assets-override/beads-web-linux-x64',
      }),
    ]);
    expect(result.plan.supervisorChanges).toEqual([
      expect.objectContaining({
        content: expect.stringContaining('command=/usr/local/bin/vd-plugin-service-runner.mjs'),
      }),
    ]);
    const supervisorChange = result.plan.supervisorChanges[0];
    expect(supervisorChange).toMatchObject({ action: 'create' });
    if (!supervisorChange || supervisorChange.action === 'delete') throw new Error('expected rendered supervisor config');
    const encodedArgv = supervisorChange.content.match(/VD_SERVICE_ARGV_BASE64="([^"]+)"/)?.[1];
    expect(encodedArgv).toBeDefined();
    expect(JSON.parse(Buffer.from(encodedArgv!, 'base64').toString('utf8'))).toEqual([
      join(tempRoot, 'plugins/vd.beads-web/beads-web-assets-override/extracted/bin/beads-web'),
    ]);
  });

  it('defaults missing plugin state to enabled while honoring explicit enable states', () => {
    const catalog = structuredClone(beadsWebOnlyCatalog) as PluginServiceCatalog;

    expect(isPluginEnabled(catalog, 'vd.beads-web')).toBe(true);
    catalog.pluginStates = { 'vd.beads-web': { enable: false } };
    expect(isPluginEnabled(catalog, 'vd.beads-web')).toBe(false);
    catalog.pluginStates = { 'vd.beads-web': { enable: true } };
    expect(isPluginEnabled(catalog, 'vd.beads-web')).toBe(true);
  });

  it('composes plugin manifests and plugin states independently with later catalogs winning', () => {
    const builtinCatalog = structuredClone(beadsWebOnlyCatalog) as PluginServiceCatalog;
    builtinCatalog.pluginStates = {
      'vd.beads-web': { enable: true },
      'vd.only-in-state': { enable: false },
    };
    const optionalCatalog = structuredClone(beadsWebOnlyCatalog) as PluginServiceCatalog;
    const overridePlugin = optionalCatalog.plugins[0]!;
    const installer = overridePlugin.installers[0]!;
    if (installer.kind !== 'github-release-asset') throw new Error('expected github-release-asset fixture');
    overridePlugin.version = 'beads-web-state-override';
    installer.tag = 'beads-web-state-override';
    installer.variants['linux-amd64']!.sha256 = 'f'.repeat(64);
    optionalCatalog.pluginStates = {
      'vd.beads-web': { enable: false },
    };

    const composed = composeCatalogs([builtinCatalog, optionalCatalog]);

    expect(composed.plugins).toHaveLength(1);
    expect(composed.plugins[0]!.version).toBe('beads-web-state-override');
    expect(composed.pluginStates).toEqual({
      'vd.beads-web': { enable: false },
      'vd.only-in-state': { enable: false },
    });
    expect(isPluginEnabled(composed, 'vd.beads-web')).toBe(false);
    expect(isPluginEnabled(composed, 'vd.unmentioned')).toBe(true);
  });
});

function createZipFixtureWithDeclaredSize(entryName: string, declaredUncompressedSize: number): Buffer {
  const name = Buffer.from(entryName);
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt32LE(0, 14);
  localHeader.writeUInt32LE(0, 18);
  localHeader.writeUInt32LE(declaredUncompressedSize, 22);
  localHeader.writeUInt16LE(name.length, 26);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt32LE(0, 16);
  centralHeader.writeUInt32LE(0, 20);
  centralHeader.writeUInt32LE(declaredUncompressedSize, 24);
  centralHeader.writeUInt16LE(name.length, 28);
  centralHeader.writeUInt32LE(0, 42);

  const centralDirectoryOffset = localHeader.length + name.length;
  const centralDirectory = Buffer.concat([centralHeader, name]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralDirectoryOffset, 16);
  return Buffer.concat([localHeader, name, centralDirectory, end]);
}

function createZipFixture(entries: Array<{ name: string; data: string; deflate?: boolean }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const rawData = Buffer.from(entry.data);
    const compressedData = entry.deflate ? deflateRawSync(rawData) : rawData;
    const method = entry.deflate ? 8 : 0;
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(compressedData.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localParts.push(localHeader, name, compressedData);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(compressedData.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + compressedData.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function createTarGzFixture(entries: Array<{ name: string; data: string }>): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data);
    const header = Buffer.alloc(512);
    name.copy(header, 0, 0, Math.min(name.length, 100));
    header.write('0000755', 100, 'ascii');
    header.write('0000000', 108, 'ascii');
    header.write('0000000', 116, 'ascii');
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
    header.write('00000000000\0', 136, 'ascii');
    header.fill(' ', 148, 156);
    header.write('0', 156, 'ascii');
    header.write('ustar\0', 257, 'ascii');
    header.write('00', 263, 'ascii');
    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
    parts.push(header, data);
    const padding = (512 - (data.length % 512)) % 512;
    if (padding > 0) parts.push(Buffer.alloc(padding));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}
