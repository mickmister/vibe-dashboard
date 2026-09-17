import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { getProductionPanelTargetRouterAuthoritySnapshot } from './panelTargetRouterAuthority';
import { registerPanelTargetDeliveryRoutes } from './panel-target-delivery-routes';

describe('production Panel target delivery route owner', () => {
  it('publishes readiness only through real registration and removes it on disposal', () => {
    const owner = registerPanelTargetDeliveryRoutes(new Hono(), { vkOrigin: 'https://vk.test', vkClient: { getPreviewSlotUrl: vi.fn() } });
    expect(getProductionPanelTargetRouterAuthoritySnapshot()).toMatchObject({ status: 'ready', definitions: { deliveryRoutes: { previewPrefix: '/internal/panel-target/previews' } } });
    owner.dispose();
    expect(getProductionPanelTargetRouterAuthoritySnapshot()).toEqual({ status: 'not-ready' });
  });

  it('resolves preview delivery server-side without exposing a workspace token', async () => {
    const app = new Hono();
    const getPreviewSlotUrl = vi.fn(async () => ({ previewSlotId: 'preview-1', url: 'https://preview.test/' }));
    registerPanelTargetDeliveryRoutes(app, { vkOrigin: 'https://vk.test', previewCustomerSlug: 'customer', vkClient: { getPreviewSlotUrl } as never });
    const response = await app.request('/internal/panel-target/previews/workspace-1/preview-1');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://preview.test/');
    expect(getPreviewSlotUrl).toHaveBeenCalledWith('workspace-1', 'preview-1', { customerSlug: 'customer' });
    expect(JSON.stringify(getPreviewSlotUrl.mock.calls)).not.toContain('workspaceToken');
  });

  it('uses a distinct agent-session query and never overloads Voyage session', async () => {
    const app = new Hono();
    registerPanelTargetDeliveryRoutes(app, { vkOrigin: 'https://vk.test', vkClient: { getPreviewSlotUrl: vi.fn() } });
    const response = await app.request('/internal/panel-target/agent-sessions/workspace-1/agent-1');
    expect(response.headers.get('location')).toBe('https://vk.test/workspaces/workspace-1?agentSessionId=agent-1');
  });

  it('fails closed for mismatched or unsafe preview resolution', async () => {
    const app = new Hono();
    registerPanelTargetDeliveryRoutes(app, { vkOrigin: 'https://vk.test', vkClient: { getPreviewSlotUrl: vi.fn(async () => ({ previewSlotId: 'preview-1', url: 'http://unsafe.test/' })) } as never });
    expect((await app.request('/internal/panel-target/previews/workspace-1/preview-1')).status).toBe(404);
  });
});
