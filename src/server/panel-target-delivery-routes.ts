import type { Hono } from 'hono';
import { VibeKanbanServerClient } from './vk-client';
import { markProductionPanelTargetRouterAuthorityNotReady, publishProductionPanelTargetRouterAuthority } from './panelTargetRouterAuthority';
const WORKSPACE_PREFIX = '/internal/panel-target/workspaces';
const PREVIEW_PREFIX = '/internal/panel-target/previews';
function safeRedirect(value: string): string | null { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; } }
export function registerPanelTargetDeliveryRoutes(app: Hono, options: { vkClient?: Pick<VibeKanbanServerClient, 'getPreviewSlotUrl'>; vkOrigin?: string; previewCustomerSlug?: string } = {}): { dispose(): void } {
  const client = options.vkClient ?? new VibeKanbanServerClient();
  const origin = new URL(options.vkOrigin ?? process.env.VITE_VK_BASE_ORIGIN ?? '').origin;
  const previewCustomerSlug = options.previewCustomerSlug ?? 'preview';
  app.get(`${WORKSPACE_PREFIX}/:workspaceId/:surface`, (c) => {
    const surface = c.req.param('surface');
    if (!['overview', 'code', 'changes', 'beads', 'forms'].includes(surface)) return c.notFound();
    return c.redirect(new URL(surface === 'code' ? `/workspaces/${encodeURIComponent(c.req.param('workspaceId'))}/vscode` : `/workspaces/${encodeURIComponent(c.req.param('workspaceId'))}`, origin).href, 302);
  });
  app.get(`${PREVIEW_PREFIX}/:workspaceId/:previewId`, async (c) => { try { const resolved = await client.getPreviewSlotUrl(c.req.param('workspaceId'), c.req.param('previewId'), { customerSlug: previewCustomerSlug }); const location = resolved.previewSlotId === c.req.param('previewId') ? safeRedirect(resolved.url) : null; return location ? c.redirect(location, 302) : c.notFound(); } catch { return c.notFound(); } });
  publishProductionPanelTargetRouterAuthority({ builtInRoutes: {}, redirectGuards: {}, deliveryRoutes: Object.freeze({
    workspacePrefix: WORKSPACE_PREFIX,
    previewPrefix: PREVIEW_PREFIX,
    workspaceUpstreamOrigin: origin,
    workspaceUpstreamPrefix: new URL('/workspaces', origin).href.replace(/\/$/, ''),
    previewCustomerSlug,
  }) });
  let disposed = false;
  return { dispose(): void { if (!disposed) { disposed = true; markProductionPanelTargetRouterAuthorityNotReady(); } } };
}
