import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { getProductionPanelTargetRouterAuthoritySnapshot } from './panelTargetRouterAuthority';
import { registerPanelTargetDeliveryRoutes, validatePanelDeliveryRedirectChain } from './panel-target-delivery-routes';

const okFetch = vi.fn(async () => new Response(null, { status: 204 }));

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
    registerPanelTargetDeliveryRoutes(app, { vkOrigin: 'https://vk.test', previewCustomerSlug: 'customer', vkClient: { getPreviewSlotUrl } as never, fetchImpl: okFetch as never });
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

  it('publishes lifecycle-owned guard issuance and revokes it exactly once', () => {
    const owner = registerPanelTargetDeliveryRoutes(new Hono(), { vkOrigin: 'https://vk.test', previewCustomerSlug: 'customer', vkClient: { getPreviewSlotUrl: vi.fn() } });
    const snapshot = getProductionPanelTargetRouterAuthoritySnapshot();
    expect(snapshot.status).toBe('ready');
    if (snapshot.status !== 'ready') throw new Error('route owner not ready');
    expect(snapshot.definitions.deliveryGuardOwner.issueWorkspace('code', 'workspace-1', 'https://dashboard.test')).toEqual({
      location: 'https://vk.test/workspaces/workspace-1/vscode',
      guard: { deliveryUrl: 'https://dashboard.test/internal/panel-target/workspaces/workspace-1/code', upstreamOrigin: 'https://vk.test' },
    });
    owner.dispose();
    owner.dispose();
    expect(snapshot.definitions.deliveryGuardOwner.isCurrent()).toBe(false);
    expect(snapshot.definitions.deliveryGuardOwner.issueWorkspace('code', 'workspace-1', 'https://dashboard.test')).toBeNull();
    expect(getProductionPanelTargetRouterAuthoritySnapshot()).toEqual({ status: 'not-ready' });
  });

  it('replaces owner policy on route restart and never retains a prior upstream', () => {
    const first = registerPanelTargetDeliveryRoutes(new Hono(), { vkOrigin: 'https://old-vk.test', vkClient: { getPreviewSlotUrl: vi.fn() } });
    first.dispose();
    const second = registerPanelTargetDeliveryRoutes(new Hono(), { vkOrigin: 'https://current-vk.test', vkClient: { getPreviewSlotUrl: vi.fn() } });
    const snapshot = getProductionPanelTargetRouterAuthoritySnapshot();
    expect(snapshot.status).toBe('ready');
    if (snapshot.status !== 'ready') throw new Error('route owner not ready');
    expect(snapshot.definitions.deliveryGuardOwner.issueWorkspace('code', 'workspace-1', 'https://dashboard.test')?.location).toBe('https://current-vk.test/workspaces/workspace-1/vscode');
    second.dispose();
    expect(getProductionPanelTargetRouterAuthoritySnapshot()).toEqual({ status: 'not-ready' });
  });

  it('fails closed for mismatched or unsafe preview resolution', async () => {
    const app = new Hono();
    registerPanelTargetDeliveryRoutes(app, { vkOrigin: 'https://vk.test', vkClient: { getPreviewSlotUrl: vi.fn(async () => ({ previewSlotId: 'preview-1', url: 'http://unsafe.test/' })) } as never });
    expect((await app.request('/internal/panel-target/previews/workspace-1/preview-1')).status).toBe(404);
  });

  it('accepts only same-origin HTTPS redirect chains and rejects unsafe or cross-origin hops', async () => {
    const sameOrigin = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/next' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(validatePanelDeliveryRedirectChain('https://preview.test/start', sameOrigin)).resolves.toBe('https://preview.test/next');
    const crossOrigin = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://evil.test/' } }));
    await expect(validatePanelDeliveryRedirectChain('https://preview.test/start', crossOrigin)).resolves.toBeNull();
    const unsafe = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'javascript:alert(1)' } }));
    await expect(validatePanelDeliveryRedirectChain('https://preview.test/start', unsafe)).resolves.toBeNull();
  });
});
