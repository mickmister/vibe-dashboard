import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { registerPanelTargetDeliveryRoutes } from './panel-target-delivery-routes';
import { getProductionPanelTargetRouterAuthoritySnapshot } from './panelTargetRouterAuthority';

describe('production Panel target delivery route owner', () => {
  it('publishes Code delivery and its guard from one lifecycle owner', async () => {
    const app = new Hono();
    const registration = registerPanelTargetDeliveryRoutes(app, { vkOrigin: 'https://vk.test' });
    const snapshot = getProductionPanelTargetRouterAuthoritySnapshot();
    expect(snapshot.status).toBe('ready');
    if (snapshot.status !== 'ready') throw new Error('route owner not ready');
    expect(snapshot.definitions.deliveryGuardOwner.issueWorkspace('code', 'workspace-1', 'https://dashboard.test')).toEqual({
      location: 'https://vk.test/workspaces/workspace-1/vscode',
      guard: { deliveryUrl: 'https://dashboard.test/internal/panel-target/workspaces/workspace-1/code', upstreamOrigin: 'https://vk.test' },
    });
    expect((await app.request('/internal/panel-target/workspaces/workspace-1/code')).headers.get('location')).toBe('https://vk.test/workspaces/workspace-1/vscode');
    registration.dispose();
  });

  it('publishes no preview route, definition, or guard', async () => {
    const app = new Hono();
    const registration = registerPanelTargetDeliveryRoutes(app, { vkOrigin: 'https://vk.test' });
    const snapshot = getProductionPanelTargetRouterAuthoritySnapshot();
    if (snapshot.status !== 'ready') throw new Error('route owner not ready');
    await expect(snapshot.definitions.deliveryGuardOwner.issuePreview('workspace-1', 'preview-1', 'https://dashboard.test')).resolves.toBeNull();
    expect((await app.request('/internal/panel-target/previews/workspace-1/preview-1')).status).toBe(404);
    registration.dispose();
  });

  it('falls back to the application origin when no VK origin is configured', async () => {
    const app = new Hono();
    const registration = registerPanelTargetDeliveryRoutes(app);
    const snapshot = getProductionPanelTargetRouterAuthoritySnapshot();
    if (snapshot.status !== 'ready') throw new Error('route owner not ready');
    expect(snapshot.definitions.deliveryGuardOwner.issueWorkspace('overview', 'workspace-1', 'https://dashboard.test')).toEqual({
      location: 'https://dashboard.test/workspaces/workspace-1',
      guard: { deliveryUrl: 'https://dashboard.test/internal/panel-target/workspaces/workspace-1/overview', upstreamOrigin: 'https://dashboard.test' },
    });
    registration.dispose();
  });

  it('revokes captured providers atomically and idempotently', () => {
    const registration = registerPanelTargetDeliveryRoutes(new Hono(), { vkOrigin: 'https://vk.test' });
    const snapshot = getProductionPanelTargetRouterAuthoritySnapshot();
    if (snapshot.status !== 'ready') throw new Error('route owner not ready');
    registration.dispose();
    registration.dispose();
    expect(snapshot.definitions.deliveryGuardOwner.isCurrent()).toBe(false);
    expect(snapshot.definitions.deliveryGuardOwner.issueWorkspace('code', 'workspace-1', 'https://dashboard.test')).toBeNull();
    expect(getProductionPanelTargetRouterAuthoritySnapshot()).toEqual({ status: 'not-ready' });
  });

  it('does not publish inert agent-session or terminal delivery', async () => {
    const app = new Hono();
    const registration = registerPanelTargetDeliveryRoutes(app, { vkOrigin: 'https://vk.test' });
    expect((await app.request('/internal/panel-target/agent-sessions/workspace-1/session-1')).status).toBe(404);
    expect((await app.request('/internal/panel-target/terminals/workspace-1/terminal-1')).status).toBe(404);
    registration.dispose();
  });
});
