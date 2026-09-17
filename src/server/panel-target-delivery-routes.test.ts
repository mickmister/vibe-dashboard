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

  it('does not publish or register an inert agent-session delivery route', async () => {
    const app = new Hono();
    registerPanelTargetDeliveryRoutes(app, { vkOrigin: 'https://vk.test', vkClient: { getPreviewSlotUrl: vi.fn() } });
    const response = await app.request('/internal/panel-target/agent-sessions/workspace-1/agent-1');
    expect(response.status).toBe(404);
    expect(JSON.stringify(getProductionPanelTargetRouterAuthoritySnapshot())).not.toContain('agentSession');
  });

  it('publishes lifecycle-owned delivery policy and revokes it exactly once', () => {
    const owner = registerPanelTargetDeliveryRoutes(new Hono(), { vkOrigin: 'https://vk.test', previewCustomerSlug: 'customer', vkClient: { getPreviewSlotUrl: vi.fn() } });
    expect(getProductionPanelTargetRouterAuthoritySnapshot()).toMatchObject({ status: 'ready', definitions: { deliveryRoutes: {
      workspaceUpstreamOrigin: 'https://vk.test', previewCustomerSlug: 'customer',
    } } });
    owner.dispose();
    owner.dispose();
    expect(getProductionPanelTargetRouterAuthoritySnapshot()).toEqual({ status: 'not-ready' });
  });

  it('replaces owner policy on route restart and never retains a prior upstream', () => {
    const first = registerPanelTargetDeliveryRoutes(new Hono(), { vkOrigin: 'https://old-vk.test', vkClient: { getPreviewSlotUrl: vi.fn() } });
    first.dispose();
    const second = registerPanelTargetDeliveryRoutes(new Hono(), { vkOrigin: 'https://current-vk.test', vkClient: { getPreviewSlotUrl: vi.fn() } });
    expect(getProductionPanelTargetRouterAuthoritySnapshot()).toMatchObject({ status: 'ready', definitions: { deliveryRoutes: {
      workspaceUpstreamOrigin: 'https://current-vk.test', workspaceUpstreamPrefix: 'https://current-vk.test/workspaces',
    } } });
    second.dispose();
    expect(getProductionPanelTargetRouterAuthoritySnapshot()).toEqual({ status: 'not-ready' });
  });

  it('fails closed for mismatched or unsafe preview resolution', async () => {
    const app = new Hono();
    registerPanelTargetDeliveryRoutes(app, { vkOrigin: 'https://vk.test', vkClient: { getPreviewSlotUrl: vi.fn(async () => ({ previewSlotId: 'preview-1', url: 'http://unsafe.test/' })) } as never });
    expect((await app.request('/internal/panel-target/previews/workspace-1/preview-1')).status).toBe(404);
  });
});
