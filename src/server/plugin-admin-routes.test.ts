import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { registerPluginAdminRoutes } from './plugin-admin-routes';
import type { PluginServiceCatalog } from '../../plugins/orchestrator/plugin-service-orchestrator';

const catalog: PluginServiceCatalog = {
  plugins: [
    {
      id: 'vd.beads-web',
      name: 'Beads Web',
      version: 'v0.11.5',
      installers: [{ kind: 'bundled-current-repo' }],
      services: [
        {
          id: 'web',
          command: '${PLUGIN_DIR}/bin/beads-web',
          directory: '${PLUGIN_DIR}',
          user: 'vkuser',
          autostart: true,
          autorestart: true,
          ports: [{ name: 'http', env: 'PORT', default: 3109, bind: '0.0.0.0' }],
          httpExposure: { kind: 'caddy-subdomain', subdomain: 'beads-web', port: 'http' },
        },
      ],
    },
    {
      id: 'app.failed',
      name: 'Failed Plugin',
      version: '1.0.0',
      installers: [{ kind: 'bundled-current-repo' }],
      services: [
        {
          id: 'api',
          command: '${PLUGIN_DIR}/bin/api',
          directory: '${PLUGIN_DIR}',
          user: 'vkuser',
          autostart: true,
          autorestart: true,
        },
      ],
    },
    {
      id: 'app.disabled',
      name: 'Disabled Plugin',
      version: '2.0.0',
      installers: [{ kind: 'bundled-current-repo' }],
      services: [
        {
          id: 'worker',
          command: '${PLUGIN_DIR}/bin/worker',
          directory: '${PLUGIN_DIR}',
          user: 'vkuser',
          autostart: true,
          autorestart: true,
        },
      ],
    },
  ],
  pluginStates: { 'app.disabled': { enable: false } },
};

describe('plugin admin API routes', () => {
  it('returns desired enable state, install paths, observed runtime state, and errors', async () => {
    const app = new Hono();
    registerPluginAdminRoutes(app, {
      loadCatalog: async () => catalog,
      paths: {
        artifactCacheRoot: '/cache',
        installRoot: '/var/lib/vd/plugins',
        supervisorConfigDir: '/supervisor',
      },
      readSupervisorStatuses: async () => new Map([
        ['vd-plugin--vd_beads_web--web', { state: 'RUNNING', detail: 'pid 42' }],
        ['vd-plugin--app_failed--api', { state: 'FATAL', detail: 'Exited too quickly' }],
      ]),
      setPluginEnabled: async () => undefined,
      applyRuntimeSync: async () => undefined,
    });

    const response = await app.request('/dashboard/api/admin/plugins/status');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      plugins: [
        {
          pluginId: 'vd.beads-web',
          name: 'Beads Web',
          version: 'v0.11.5',
          pluginPath: '/var/lib/vd/plugins/vd.beads-web/v0.11.5',
          installPath: '/var/lib/vd/plugins/vd.beads-web/v0.11.5',
          desiredEnabled: true,
          observedState: 'running',
        },
        {
          pluginId: 'app.failed',
          name: 'Failed Plugin',
          version: '1.0.0',
          pluginPath: '/var/lib/vd/plugins/app.failed/1.0.0',
          installPath: '/var/lib/vd/plugins/app.failed/1.0.0',
          desiredEnabled: true,
          observedState: 'failed_to_start',
          error: 'api: FATAL Exited too quickly',
        },
        {
          pluginId: 'app.disabled',
          name: 'Disabled Plugin',
          version: '2.0.0',
          pluginPath: '/var/lib/vd/plugins/app.disabled/2.0.0',
          installPath: '/var/lib/vd/plugins/app.disabled/2.0.0',
          desiredEnabled: false,
          observedState: 'disabled',
        },
      ],
    });
  });

  it('returns catalog-derived rows when Supervisor status collection fails', async () => {
    const app = new Hono();
    registerPluginAdminRoutes(app, {
      loadCatalog: async () => catalog,
      paths: {
        artifactCacheRoot: '/cache',
        installRoot: '/var/lib/vd/plugins',
        supervisorConfigDir: '/supervisor',
      },
      readSupervisorStatuses: async () => {
        throw new Error('supervisorctl unavailable');
      },
      setPluginEnabled: async () => undefined,
      applyRuntimeSync: async () => undefined,
    });

    const response = await app.request('/dashboard/api/admin/plugins/status');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      plugins: [
        {
          pluginId: 'vd.beads-web',
          desiredEnabled: true,
          observedState: 'failed',
          error: 'Supervisor status collection failed: supervisorctl unavailable',
        },
        {
          pluginId: 'app.failed',
          desiredEnabled: true,
          observedState: 'failed',
          error: 'Supervisor status collection failed: supervisorctl unavailable',
        },
        {
          pluginId: 'app.disabled',
          desiredEnabled: false,
          observedState: 'disabled',
        },
      ],
    });
  });

  it('persists desired enable state before applying runtime sync and returns refreshed status', async () => {
    const calls: string[] = [];
    let enabled = true;
    const app = new Hono();
    registerPluginAdminRoutes(app, {
      loadCatalog: async () => ({
        ...catalog,
        pluginStates: { 'vd.beads-web': { enable: enabled } },
      }),
      paths: {
        artifactCacheRoot: '/cache',
        installRoot: '/var/lib/vd/plugins',
        supervisorConfigDir: '/supervisor',
      },
      readSupervisorStatuses: async () => new Map(
        enabled ? [['vd-plugin--vd_beads_web--web', { state: 'RUNNING', detail: 'pid 42' }]] : [],
      ),
      setPluginEnabled: async (pluginId, nextEnabled) => {
        calls.push(`persist:${pluginId}:${String(nextEnabled)}`);
        enabled = nextEnabled;
      },
      applyRuntimeSync: async () => {
        calls.push('sync');
      },
    });

    const response = await app.request('/dashboard/api/admin/plugins/vd.beads-web/enable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable: false }),
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual(['persist:vd.beads-web:false', 'sync']);
    await expect(response.json()).resolves.toMatchObject({
      plugin: {
        pluginId: 'vd.beads-web',
        desiredEnabled: false,
        observedState: 'disabled',
      },
    });
  });
  it('rejects unknown plugin ids before writing persistent desired state', async () => {
    const calls: string[] = [];
    const app = new Hono();
    registerPluginAdminRoutes(app, {
      loadCatalog: async () => catalog,
      paths: {
        artifactCacheRoot: '/cache',
        installRoot: '/var/lib/vd/plugins',
        supervisorConfigDir: '/supervisor',
      },
      readSupervisorStatuses: async () => {
        throw new Error('supervisor should not be read for unknown plugins');
      },
      setPluginEnabled: async (pluginId, enable) => {
        calls.push(`${pluginId}:${String(enable)}`);
      },
      applyRuntimeSync: async () => {
        calls.push('sync');
      },
    });

    const response = await app.request('/dashboard/api/admin/plugins/missing.plugin/enable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable: false }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'plugin_not_found' });
    expect(calls).toEqual([]);
  });
});
