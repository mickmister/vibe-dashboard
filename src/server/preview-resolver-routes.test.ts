import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { registerPreviewResolverRoutes } from './preview-resolver-routes';
import type { PreviewResolveRequest } from './vk-client';

describe('registerPreviewResolverRoutes', () => {
  it('proxies named preview resolve payloads to VK', async () => {
    const resolvePreview = vi.fn(async () => ({
      status: 'ready' as const,
      upstream: 'http://127.0.0.1:4567',
      executionProcessId: 'process-1',
    }));
    const app = new Hono();
    registerPreviewResolverRoutes(app, { vkClient: { resolvePreview } });

    const payload: PreviewResolveRequest = {
      host: '0123456789abcdef-vibekanban-web-mickmister.vibedashboard.dev',
      workspaceToken: '0123456789abcdef',
      repoSlug: 'vibekanban',
      slotSlug: 'web',
      customerSlug: 'mickmister',
      ensure: true,
      method: 'GET',
      path: '/',
    };
    const response = await app.request('/internal/preview/resolve', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    });

    await expect(response.json()).resolves.toEqual({
      status: 'ready',
      upstream: 'http://127.0.0.1:4567',
      executionProcessId: 'process-1',
    });
    expect(resolvePreview).toHaveBeenCalledWith(payload);
  });

  it('rejects impossible tokens locally without calling VK', async () => {
    const resolvePreview = vi.fn();
    const app = new Hono();
    registerPreviewResolverRoutes(app, { vkClient: { resolvePreview } });

    const response = await app.request('/internal/preview/resolve', {
      method: 'POST',
      body: JSON.stringify({
        host: '0123456789abcdeg-vibekanban-web-mickmister.vibedashboard.dev',
        workspaceToken: '0123456789abcdeg',
        repoSlug: 'vibekanban',
        slotSlug: 'web',
        customerSlug: 'mickmister',
        ensure: true,
        method: 'GET',
        path: '/',
      }),
      headers: { 'content-type': 'application/json' },
    });

    await expect(response.json()).resolves.toMatchObject({
      status: 'not_found',
      message: 'Invalid preview workspace token',
    });
    expect(resolvePreview).not.toHaveBeenCalled();
  });
});
