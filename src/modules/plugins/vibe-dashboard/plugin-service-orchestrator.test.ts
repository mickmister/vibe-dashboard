import { describe, expect, it } from 'vitest';
import firstPartyPluginCatalog from './plugins.json';
import {
  createPluginServiceDryRunPlan,
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
});
