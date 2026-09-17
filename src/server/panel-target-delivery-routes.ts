import type { Hono } from 'hono';
import { publishProductionPanelTargetRouterAuthority, type IssuedPanelDelivery, type PanelTargetDeliveryGuardOwner } from './panelTargetRouterAuthority';

const WORKSPACE_PREFIX = '/internal/panel-target/workspaces';
const WORKSPACE_KINDS = new Set(['overview', 'code', 'changes', 'beads', 'forms']);

export function registerPanelTargetDeliveryRoutes(app: Hono, options: { vkOrigin?: string } = {}): { dispose(): void } {
  const origin = new URL(options.vkOrigin ?? process.env.VITE_VK_BASE_ORIGIN ?? '').origin;
  let active = true;
  const createGuardOwner = (isRegistered: () => boolean): PanelTargetDeliveryGuardOwner => ({
    isCurrent: () => active && isRegistered(),
    issueWorkspace(kind, workspaceId, applicationOrigin): IssuedPanelDelivery | null {
      if (!active || !isRegistered() || !WORKSPACE_KINDS.has(kind)) return null;
      const upstream = new URL(`/workspaces/${encodeURIComponent(workspaceId)}${kind === 'code' ? '/vscode' : ''}`, origin);
      const delivery = new URL(`${WORKSPACE_PREFIX}/${encodeURIComponent(workspaceId)}/${encodeURIComponent(kind)}`, applicationOrigin);
      return Object.freeze({ location: upstream.href, guard: Object.freeze({ deliveryUrl: delivery.href, upstreamOrigin: upstream.origin }) });
    },
    // Preview delivery is deliberately unsupported in v1. A browser redirect
    // cannot be bound atomically to the URL/guard resolved by the owner.
    issuePreview: async () => null,
  });
  let authority: PanelTargetDeliveryGuardOwner | undefined;
  const registration = publishProductionPanelTargetRouterAuthority({
    builtInRoutes: {},
    redirectGuards: {},
    deliveryRoutes: { workspacePrefix: WORKSPACE_PREFIX },
    createGuardOwner(isCurrent) {
      authority = createGuardOwner(isCurrent);
      return authority;
    },
  });
  if (!authority) throw new Error('Panel target route authority registration failed');
  const registeredAuthority = authority;
  app.get(`${WORKSPACE_PREFIX}/:workspaceId/:surface`, (c) => {
    const issued = registeredAuthority.issueWorkspace(c.req.param('surface'), c.req.param('workspaceId'), new URL(c.req.url).origin);
    return issued ? c.redirect(issued.location, 302) : c.notFound();
  });
  let disposed = false;
  return { dispose(): void {
    if (disposed) return;
    disposed = true;
    active = false;
    registration.dispose();
  } };
}
