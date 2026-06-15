import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import beadsWebOnlyCatalog from './fixtures/beads-web.plugins.json';
import firstPartyPluginCatalog from './plugins.json';
import { runPluginServiceOrchestratorCli } from './plugin-service-orchestrator-cli';
import {
  applySupervisorConfigChanges,
  createPluginServiceDryRunPlan,
  discoverCachedArtifacts,
  readExistingSupervisorConfigs,
  renderSupervisorProgramConfig,
  type PluginServiceCatalog,
} from './plugin-service-orchestrator';

describe('plugin service supervisor orchestration dry run', () => {
  const paths = {
    artifactCacheRoot: '/var/lib/vd/plugin-cache',
    installRoot: '/var/lib/vd/plugins',
    supervisorConfigDir: '/etc/supervisor/conf.d/vd-generated',
  };

  it('imports the first-party plugins.json catalog and keeps vibe-dashboard bundled from the current repo', () => {
    const catalog = firstPartyPluginCatalog as PluginServiceCatalog;

    expect(catalog.plugins.map((plugin) => plugin.id)).toEqual([
      'vd.vibe-dashboard',
      'vd.vibe-kanban',
      'vd.beads-web',
      'vd.excalidraw',
    ]);
    expect(catalog.plugins.find((plugin) => plugin.id === 'vd.vibe-dashboard')?.artifact).toEqual({
      kind: 'bundled-current-repo',
    });
  });

  it('plans downloads only for release assets that are not already cached with the requested sha', () => {
    const plan = createPluginServiceDryRunPlan({
      catalog: firstPartyPluginCatalog as PluginServiceCatalog,
      paths,
      cachedArtifacts: [
        {
          pluginId: 'vd.beads-web',
          version: '0.1.0',
          sha256: 'c'.repeat(64),
          path: '/var/lib/vd/plugin-cache/github/mickmister/beads-web/v0.1.0/beads-web-linux-x64.tar.gz',
        },
      ],
      existingSupervisorConfigs: {},
    });

    expect(plan.artifacts).toEqual([
      expect.objectContaining({ pluginId: 'vd.vibe-dashboard', action: 'bundled-current-repo' }),
      expect.objectContaining({ pluginId: 'vd.vibe-kanban', action: 'download' }),
      expect.objectContaining({ pluginId: 'vd.beads-web', action: 'cached' }),
      expect.objectContaining({ pluginId: 'vd.excalidraw', action: 'download' }),
    ]);
    expect(plan.artifacts.find((artifact) => artifact.pluginId === 'vd.vibe-kanban')).toMatchObject({
      url: 'https://github.com/mickmister/vibe-kanban/releases/download/v0.1.0/vibe-kanban-linux-x64.tar.gz',
      cachePath: '/var/lib/vd/plugin-cache/github/mickmister/vibe-kanban/v0.1.0/vibe-kanban-linux-x64.tar.gz',
      installPath: '/var/lib/vd/plugins/vd.vibe-kanban/0.1.0',
    });
  });

  it('returns idempotent supervisor config changes without mutating the host', () => {
    const existingConfig = renderSupervisorProgramConfig({
      plugin: (firstPartyPluginCatalog as PluginServiceCatalog).plugins[2]!,
      service: (firstPartyPluginCatalog as PluginServiceCatalog).plugins[2]!.services[0]!,
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
          action: 'create',
          program: 'vd-plugin--vd_vibe_dashboard--web',
          path: '/etc/supervisor/conf.d/vd-generated/vd-plugin--vd_vibe_dashboard--web.conf',
        }),
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
      plugin: (firstPartyPluginCatalog as PluginServiceCatalog).plugins[2]!,
      service: (firstPartyPluginCatalog as PluginServiceCatalog).plugins[2]!.services[0]!,
      paths,
    });
    const vibeDashboardConfig = renderSupervisorProgramConfig({
      plugin: (firstPartyPluginCatalog as PluginServiceCatalog).plugins[0]!,
      service: (firstPartyPluginCatalog as PluginServiceCatalog).plugins[0]!.services[0]!,
      paths,
    });

    expect(beadsWebConfig).toContain('command=/var/lib/vd/plugins/vd.beads-web/0.1.0/extracted/bin/beads-web --host 127.0.0.1 --port %(ENV_BEADS_WEB_PORT)s');
    expect(beadsWebConfig).toContain('environment=BEADS_WEB_PORT="3109",HOME="/home/vkuser",XDG_CONFIG_HOME="/home/vkuser/.config",VD_PLUGIN_ID="vd.beads-web",VD_PLUGIN_VERSION="0.1.0",VD_SERVICE_ID="web"');
    expect(vibeDashboardConfig).toContain('PORT="%(ENV_DASHBOARD_PORT)s"');
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
        url: 'https://github.com/mickmister/beads-web/releases/download/v0.1.0/beads-web-linux-x64.tar.gz',
      }),
    ]);
    expect(plan.supervisorChanges).toEqual([
      expect.objectContaining({
        action: 'create',
        program: 'vd-plugin--vd_beads_web--web',
      }),
    ]);
  });

  it('discovers cached artifacts by hashing files in the persistent artifact cache', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-plugin-cache-'));
    const cachePath = join(tempRoot, 'cache/github/mickmister/beads-web/v0.1.0/beads-web-linux-x64.tar.gz');
    const bytes = Buffer.from('fake beads-web artifact');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const catalog = structuredClone(beadsWebOnlyCatalog) as PluginServiceCatalog;
    const artifact = catalog.plugins[0]!.artifact;
    if (artifact.kind !== 'github-release-asset') throw new Error('expected github-release-asset fixture');
    artifact.sha256 = sha256;
    await mkdir(join(tempRoot, 'cache/github/mickmister/beads-web/v0.1.0'), { recursive: true });
    await writeFile(cachePath, bytes);

    await expect(discoverCachedArtifacts({
      catalog,
      paths: {
        artifactCacheRoot: join(tempRoot, 'cache'),
        installRoot: join(tempRoot, 'plugins'),
        supervisorConfigDir: join(tempRoot, 'supervisor'),
      },
    })).resolves.toEqual([{ pluginId: 'vd.beads-web', version: '0.1.0', sha256, path: cachePath }]);
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
});
