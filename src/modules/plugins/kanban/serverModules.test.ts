import { describe, expect, it, vi } from 'vitest';

function createNeverResolvingDbHandle() {
  return new Promise<never>(() => {});
}

function createRouteRecorder() {
  const routes: Array<{ method: string; path: string }> = [];
  const record = (method: string) => (path: string) => {
    routes.push({ method, path });
    return recorder;
  };
  const recorder = {
    all: vi.fn(record('all')),
    delete: vi.fn(record('delete')),
    get: vi.fn(record('get')),
    post: vi.fn(record('post')),
  };
  return { recorder, routes };
}

async function loadRegisteredServerCallbacks(modulePath: './jira/serverModule' | './linear/serverModule') {
  vi.resetModules();
  vi.doMock('./server/database', () => ({
    getExternalIntegrationsDb: vi.fn(createNeverResolvingDbHandle),
  }));

  const { resetServerRegistry, serverRegistry } = await import('springboard/server/register');
  resetServerRegistry();
  await import(modulePath);

  return ((serverRegistry.registerServerModule as unknown as { calls?: Array<(api: unknown) => void> }).calls ?? []);
}

describe('external Kanban server modules', () => {
  it('registers Jira routes synchronously before the external integrations DB is ready', async () => {
    const callbacks = await loadRegisteredServerCallbacks('./jira/serverModule');
    const { recorder, routes } = createRouteRecorder();

    expect(callbacks).toHaveLength(1);
    const callback = callbacks[0];
    if (!callback) throw new Error('expected Jira server module callback');
    callback({
      hono: recorder,
      hooks: { registerRpcMiddleware: vi.fn() },
      getEngine: vi.fn(),
    });

    expect(routes).toEqual(expect.arrayContaining([
      { method: 'all', path: '/dashboard/api/auth/*' },
      { method: 'get', path: '/dashboard/api/external-trackers/auth/status' },
      { method: 'post', path: '/dashboard/api/external-trackers/auth/:provider/link' },
      { method: 'get', path: '/dashboard/api/external-trackers/jira/board' },
    ]));
  });

  it('registers Linear routes synchronously before the external integrations DB is ready', async () => {
    const callbacks = await loadRegisteredServerCallbacks('./linear/serverModule');
    const { recorder, routes } = createRouteRecorder();

    expect(callbacks).toHaveLength(1);
    const callback = callbacks[0];
    if (!callback) throw new Error('expected Linear server module callback');
    callback({
      hono: recorder,
      hooks: { registerRpcMiddleware: vi.fn() },
      getEngine: vi.fn(),
    });

    expect(routes).toContainEqual({ method: 'get', path: '/dashboard/api/external-trackers/linear/board' });
  });
});
