import { Hono } from 'hono';
import { type DenoBackendPluginUnit, type PluginCatalog, PluginMarketplaceInstaller } from './sample-marketplace';
import { DenoBackendRunner } from './sample-runtime';

export function createSampleMarketplaceApp(options: {
  catalog: PluginCatalog;
  installer: PluginMarketplaceInstaller;
  runner: DenoBackendRunner;
}) {
  const app = new Hono();

  app.get('/api/v1/plugins', (c) => c.json({ plugins: options.catalog.plugins }));

  app.post('/api/v1/plugins/:pluginId/install', async (c) => {
    const installed = await options.installer.install({ pluginId: c.req.param('pluginId') });
    return c.json(toSerializableInstalled(installed), 202);
  });

  app.post('/api/v1/plugins/:pluginId/backend/:unitId/run', async (c) => {
    const installed = options.installer.getInstalled(c.req.param('pluginId'));
    if (!installed) return c.json({ error: 'Plugin is not installed' }, 404);

    const unit = installed.backendUnits.find((candidate) => candidate.id === c.req.param('unitId'));
    if (!unit) return c.json({ error: 'Backend unit not found' }, 404);
    if (unit.kind !== 'deno') return c.json({ error: 'Only Deno units run in this sample app' }, 400);

    const result = await options.runner.run({ pluginId: installed.pluginId, unit: unit as DenoBackendPluginUnit });
    return c.json(result);
  });

  return app;
}

function toSerializableInstalled(installed: Awaited<ReturnType<PluginMarketplaceInstaller['install']>>) {
  return {
    pluginId: installed.pluginId,
    version: installed.version,
    enabled: installed.enabled,
    assetUrl: installed.assetUrl,
    sha256: installed.sha256,
    signature: installed.signature,
    frontendAssetRoute: installed.frontendAssetRoute,
    backendUnits: installed.backendUnits,
  };
}
