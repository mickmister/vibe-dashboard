import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerVkProxyRoutes } from './vk-proxy';

describe('VK proxy routes', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('proxies GET requests without appending /api twice', async () => {
    vi.stubEnv('VIBE_API_URL', 'http://vk.local/api');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ success: true, data: [{ id: 'ws1' }] }),
    );
    const app = new Hono();
    registerVkProxyRoutes(app);

    const response = await app.request('/vk-api/workspaces');

    expect(fetchMock).toHaveBeenCalledWith('http://vk.local/api/workspaces');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: [{ id: 'ws1' }],
    });
  });

  it('appends /api when the configured VK URL is an origin', async () => {
    vi.stubEnv('VIBE_API_URL', 'http://vk.local');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ success: true, data: [] }),
    );
    const app = new Hono();
    registerVkProxyRoutes(app);

    await app.request('/vk-api/workspaces');

    expect(fetchMock).toHaveBeenCalledWith('http://vk.local/api/workspaces');
  });

  it('proxies wildcard paths and preserves the query string', async () => {
    vi.stubEnv('VIBE_API_URL', 'http://vk.local/api');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ success: true, data: [] }),
    );
    const app = new Hono();
    registerVkProxyRoutes(app);

    await app.request('/vk-api/workspaces/ws1/repos?include_archived=true');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://vk.local/api/workspaces/ws1/repos?include_archived=true',
    );
  });

  it('does not forward stale encoded-body headers', async () => {
    vi.stubEnv('VIBE_API_URL', 'http://vk.local/api');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          'Content-Encoding': 'gzip',
          'Content-Length': '999',
          'Content-Type': 'application/json',
          'Transfer-Encoding': 'chunked',
        },
      }),
    );
    const app = new Hono();
    registerVkProxyRoutes(app);

    const response = await app.request('/vk-api/workspaces');

    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.has('content-encoding')).toBe(false);
    expect(response.headers.has('content-length')).toBe(false);
    expect(response.headers.has('transfer-encoding')).toBe(false);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}
