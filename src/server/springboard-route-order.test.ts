import { describe, expect, it } from 'vitest';
import { initApp } from 'springboard/server/hono_app';
import { resetServerRegistry, serverRegistry } from 'springboard/server/register';

const kv = {
  get: async () => null,
  set: async () => undefined,
  getAll: async () => ({}),
};

describe('Springboard server route ordering', () => {
  it('lets server module API routes win over the SPA fallback', async () => {
    resetServerRegistry();
    serverRegistry.registerServerModule((api) => {
      api.hono.get('/dashboard/api/test-route-order', (c) => c.json({ ok: true }));
    });

    const { app, injectResources } = initApp({
      remoteKV: kv,
      userAgentKV: kv,
      broadcastMessage: () => undefined,
    });

    injectResources({
      engine: {} as never,
      getEnvValue: () => 'test',
      serveStaticFile: async (c, fileName, headers) => {
        for (const [key, value] of Object.entries(headers)) {
          c.header(key, value);
        }
        return c.body(`<html>${fileName}</html>`);
      },
    });

    const apiResponse = await app.request('/dashboard/api/test-route-order');
    await expect(apiResponse.json()).resolves.toEqual({ ok: true });

    const spaResponse = await app.request('/some/spa/path');
    expect(await spaResponse.text()).toBe('<html>index.html</html>');
  });
});
