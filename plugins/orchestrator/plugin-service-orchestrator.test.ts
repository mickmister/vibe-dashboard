import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import beadsWebOnlyCatalog from '../fixtures/beads-web.plugins.json';
import firstPartyPluginCatalog from '../builtin.plugins.json';
import { runPluginServiceOrchestratorCli } from './plugin-service-orchestrator-cli';
import {
  applySupervisorConfigChanges,
  applyCaddyPluginConfigChange,
  createPluginServiceDryRunPlan,
  discoverCachedArtifacts,
  materializePluginArtifacts,
  readExistingCaddyPluginConfig,
  readExistingSupervisorConfigs,
  renderCaddyPluginExposureConfig,
  renderSupervisorProgramConfig,
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
      version: 'beads-web-assets-42cc6ca1709d4b0aa76833d91d326e6de9659a28',
      artifact: {
        kind: 'github-release-asset',
        tag: 'beads-web-assets-42cc6ca1709d4b0aa76833d91d326e6de9659a28',
        sha256: '03691990c33a6695ac2520be9dc59f4dd692730fc35f49a9f5df784fa0e2242d',
      },
    });
  });

  it('plans downloads only for release assets that are not already cached with the requested sha', () => {
    const plan = createPluginServiceDryRunPlan({
      catalog: firstPartyPluginCatalog as PluginServiceCatalog,
      paths,
      cachedArtifacts: [
        {
          pluginId: 'vd.beads-web',
          version: 'beads-web-assets-42cc6ca1709d4b0aa76833d91d326e6de9659a28',
          sha256: '03691990c33a6695ac2520be9dc59f4dd692730fc35f49a9f5df784fa0e2242d',
          path: '/var/lib/vd/plugin-cache/github/mickmister/beads-web/beads-web-assets-42cc6ca1709d4b0aa76833d91d326e6de9659a28/beads-web-linux-x64',
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
    expect(beadsWebConfig).toContain('command=/var/lib/vd/plugins/vd.beads-web/beads-web-assets-42cc6ca1709d4b0aa76833d91d326e6de9659a28/extracted/bin/beads-web');
    expect(beadsWebConfig).toContain('environment=BEADS_WEB_PORT="3109",BEADS_WEB_PORT_BIND="0.0.0.0",HOST="0.0.0.0",PORT="3109",HOME="/home/vkuser",XDG_CONFIG_HOME="/home/vkuser/.config",VD_PLUGIN_ID="vd.beads-web",VD_PLUGIN_VERSION="beads-web-assets-42cc6ca1709d4b0aa76833d91d326e6de9659a28",VD_SERVICE_ID="web"');
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
        url: 'https://github.com/mickmister/beads-web/releases/download/beads-web-assets-42cc6ca1709d4b0aa76833d91d326e6de9659a28/beads-web-linux-x64',
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
          const artifact = catalog.plugins[0]!.artifact;
          if (artifact.kind === 'github-release-asset') artifact.repository = 'owner/repo/extra';
        },
        message: /Invalid GitHub repository/,
      },
      {
        mutate: (catalog) => {
          const artifact = catalog.plugins[0]!.artifact;
          if (artifact.kind === 'github-release-asset') artifact.asset = '../beads-web';
        },
        message: /Invalid artifact asset/,
      },
      {
        mutate: (catalog) => {
          const artifact = catalog.plugins[0]!.artifact;
          if (artifact.kind === 'github-release-asset') artifact.sha256 = 'not-a-sha';
        },
        message: /Invalid artifact sha256/,
      },
      {
        mutate: (catalog) => {
          const artifact = catalog.plugins[0]!.artifact;
          if (artifact.kind === 'github-release-asset') artifact.signature = 'TODO';
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

  it('rejects malformed service catalog JSON shapes with validation errors', () => {
    const invalidCases: Array<{ catalog: unknown; message: RegExp }> = [
      { catalog: null, message: /Invalid plugin catalog/ },
      { catalog: { plugins: {} }, message: /plugins must be an array/ },
      { catalog: { plugins: [null] }, message: /Invalid plugin definition/ },
      { catalog: { plugins: [{ ...structuredClone(beadsWebOnlyCatalog).plugins[0], artifact: null }] }, message: /Invalid artifact/ },
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
        artifact: {
          kind: 'github-release-asset',
          repository: 'excalidraw/excalidraw',
          tag: 'v0.18.0',
          asset: 'excalidraw-0.18.0.tgz',
          installAs: 'excalidraw-0.18.0.tgz',
          sha256: '0f2851674434336f19f10b5f217977eac7a0714de7e31a559bc5dd37f2c2dc21',
        },
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
    const cachePath = join(tempRoot, 'cache/github/mickmister/beads-web/beads-web-assets-42cc6ca1709d4b0aa76833d91d326e6de9659a28/beads-web-linux-x64');
    const bytes = Buffer.from('fake beads-web artifact');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const catalog = structuredClone(beadsWebOnlyCatalog) as PluginServiceCatalog;
    const artifact = catalog.plugins[0]!.artifact;
    if (artifact.kind !== 'github-release-asset') throw new Error('expected github-release-asset fixture');
    artifact.sha256 = sha256;
    await mkdir(join(tempRoot, 'cache/github/mickmister/beads-web/beads-web-assets-42cc6ca1709d4b0aa76833d91d326e6de9659a28'), { recursive: true });
    await writeFile(cachePath, bytes);

    await expect(discoverCachedArtifacts({
      catalog,
      paths: {
        artifactCacheRoot: join(tempRoot, 'cache'),
        installRoot: join(tempRoot, 'plugins'),
        supervisorConfigDir: join(tempRoot, 'supervisor'),
      },
    })).resolves.toEqual([{ pluginId: 'vd.beads-web', version: 'beads-web-assets-42cc6ca1709d4b0aa76833d91d326e6de9659a28', sha256, path: cachePath }]);
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
    await expect(readFile(join(tempRoot, 'plugins/vd.beads-web/beads-web-assets-42cc6ca1709d4b0aa76833d91d326e6de9659a28/extracted/bin/beads-web'), 'utf8')).resolves.toContain('fake beads-web');
  });

  it('does not poison the persistent artifact cache when a download fails sha verification', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-plugin-materialize-bad-sha-'));
    const paths = {
      artifactCacheRoot: join(tempRoot, 'cache'),
      installRoot: join(tempRoot, 'plugins'),
      supervisorConfigDir: join(tempRoot, 'supervisor'),
    };
    const catalog = structuredClone(beadsWebOnlyCatalog) as PluginServiceCatalog;
    const artifact = catalog.plugins[0]!.artifact;
    if (artifact.kind !== 'github-release-asset') throw new Error('expected github-release-asset fixture');
    artifact.sha256 = '0'.repeat(64);
    const cachePath = join(tempRoot, 'cache/github/mickmister/beads-web/beads-web-assets-42cc6ca1709d4b0aa76833d91d326e6de9659a28/beads-web-linux-x64');

    await expect(materializePluginArtifacts({
      catalog,
      paths,
      fetchBytes: async () => Buffer.from('tampered bytes'),
    })).rejects.toThrow(/sha256 mismatch/);
    await expect(access(cachePath)).rejects.toThrow();

    const validBytes = Buffer.from('valid bytes');
    artifact.sha256 = createHash('sha256').update(validBytes).digest('hex');
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
    const artifact = catalog.plugins[0]!.artifact;
    if (artifact.kind !== 'github-release-asset') throw new Error('expected github-release-asset fixture');
    const validBytes = Buffer.from('#!/bin/sh\necho valid beads-web\n');
    artifact.sha256 = createHash('sha256').update(validBytes).digest('hex');
    const cachePath = join(tempRoot, 'cache/github/mickmister/beads-web/beads-web-assets-42cc6ca1709d4b0aa76833d91d326e6de9659a28/beads-web-linux-x64');
    await mkdir(join(tempRoot, 'cache/github/mickmister/beads-web/beads-web-assets-42cc6ca1709d4b0aa76833d91d326e6de9659a28'), { recursive: true });
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
    const artifact = catalog.plugins[0]!.artifact;
    if (artifact.kind !== 'github-release-asset') throw new Error('expected github-release-asset fixture');
    const bytes = Buffer.from('#!/bin/sh\necho stable beads-web\\n');
    artifact.sha256 = createHash('sha256').update(bytes).digest('hex');
    let fetchCount = 0;
    const fetchBytes = async () => {
      fetchCount += 1;
      return bytes;
    };

    await materializePluginArtifacts({ catalog, paths, fetchBytes });
    await materializePluginArtifacts({ catalog, paths, fetchBytes });

    expect(fetchCount).toBe(1);
    await expect(readFile(join(tempRoot, 'plugins/vd.beads-web/beads-web-assets-42cc6ca1709d4b0aa76833d91d326e6de9659a28/extracted/bin/beads-web'), 'utf8')).resolves.toContain('stable beads-web');
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
    const artifact = overridePlugin.artifact;
    if (artifact.kind !== 'github-release-asset') throw new Error('expected github-release-asset fixture');
    overridePlugin.version = 'beads-web-assets-cli-override';
    artifact.tag = 'beads-web-assets-cli-override';
    artifact.sha256 = 'd'.repeat(64);
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
    const artifact = overridePlugin.artifact;
    if (artifact.kind !== 'github-release-asset') throw new Error('expected github-release-asset fixture');
    overridePlugin.version = 'beads-web-assets-override';
    artifact.tag = 'beads-web-assets-override';
    artifact.sha256 = 'e'.repeat(64);
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
        content: expect.stringContaining('/plugins/vd.beads-web/beads-web-assets-override/extracted/bin/beads-web'),
      }),
    ]);
  });
});
