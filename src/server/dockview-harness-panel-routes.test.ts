import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { dockviewM32HarnessPanelRoutePrefix } from '../dockview/DockviewM32HarnessStartup';
import { registerDockviewHarnessPanelRoutes } from './dockview-harness-panel-routes';

describe('DockView harness panel routes', () => {
  const previous = process.env.VD_DOCKVIEW_M3_2_HARNESS;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.VD_DOCKVIEW_M3_2_HARNESS;
    } else {
      process.env.VD_DOCKVIEW_M3_2_HARNESS = previous;
    }
  });

  it('serves a valid harness Panel surface only for the isolated QA workspace', async () => {
    process.env.VD_DOCKVIEW_M3_2_HARNESS = '1';
    const app = new Hono();
    registerDockviewHarnessPanelRoutes(app);

    const response = await app.request(`${dockviewM32HarnessPanelRoutePrefix}/workspace-a/craft-overview`);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('DockView QA Craft Agent');
    expect((await app.request(`${dockviewM32HarnessPanelRoutePrefix}/workspace-a/unknown`)).status).toBe(404);
    expect((await app.request(`${dockviewM32HarnessPanelRoutePrefix}/foreign/craft-overview`)).status).toBe(404);
  });

  it('does not register QA Panel surfaces outside harness startup', async () => {
    delete process.env.VD_DOCKVIEW_M3_2_HARNESS;
    const app = new Hono();
    registerDockviewHarnessPanelRoutes(app);

    expect((await app.request(`${dockviewM32HarnessPanelRoutePrefix}/workspace-a/craft-overview`)).status).toBe(404);
  });
});
