import type { Hono } from 'hono';
import { VibeKanbanServerClient } from './vk-client';
import { markProductionPanelTargetRouterAuthorityNotReady, publishProductionPanelTargetRouterAuthority } from './panelTargetRouterAuthority';
export const PANEL_TARGET_DELIVERY_ROUTES = Object.freeze({ workspacePrefix: '/internal/panel-target/workspaces', agentSessionPrefix: '/internal/panel-target/agent-sessions', terminalPrefix: '/internal/panel-target/terminals', previewPrefix: '/internal/panel-target/previews' });
function safeRedirect(value: string): string | null { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; } }
export function registerPanelTargetDeliveryRoutes(app: Hono, options: { vkClient?: Pick<VibeKanbanServerClient, 'getPreviewSlotUrl'>; vkOrigin?: string; previewCustomerSlug?: string } = {}): { dispose(): void } {
  const client = options.vkClient ?? new VibeKanbanServerClient();
  const origin = new URL(options.vkOrigin ?? process.env.VITE_VK_BASE_ORIGIN ?? '').origin;
  const previewCustomerSlug = options.previewCustomerSlug ?? 'preview';
  app.get(`${PANEL_TARGET_DELIVERY_ROUTES.workspacePrefix}/:workspaceId/:surface`, (c) => c.redirect(new URL(c.req.param('surface') === 'code' ? `/workspaces/${encodeURIComponent(c.req.param('workspaceId'))}/vscode` : `/workspaces/${encodeURIComponent(c.req.param('workspaceId'))}`, origin).href, 302));
  app.get(`${PANEL_TARGET_DELIVERY_ROUTES.agentSessionPrefix}/:workspaceId/:sessionId`, (c) => { const url = new URL(`/workspaces/${encodeURIComponent(c.req.param('workspaceId'))}`, origin); url.searchParams.set('agentSessionId', c.req.param('sessionId')); return c.redirect(url.href, 302); });
  app.get(`${PANEL_TARGET_DELIVERY_ROUTES.terminalPrefix}/:workspaceId/:terminalId`, (c) => c.notFound());
  app.get(`${PANEL_TARGET_DELIVERY_ROUTES.previewPrefix}/:workspaceId/:previewId`, async (c) => { try { const resolved = await client.getPreviewSlotUrl(c.req.param('workspaceId'), c.req.param('previewId'), { customerSlug: previewCustomerSlug }); const location = resolved.previewSlotId === c.req.param('previewId') ? safeRedirect(resolved.url) : null; return location ? c.redirect(location, 302) : c.notFound(); } catch { return c.notFound(); } });
  publishProductionPanelTargetRouterAuthority({ builtInRoutes: {}, redirectGuards: {}, deliveryRoutes: PANEL_TARGET_DELIVERY_ROUTES });
  return { dispose: markProductionPanelTargetRouterAuthorityNotReady };
}
