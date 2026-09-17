import type { Hono } from 'hono';
import { VibeKanbanServerClient } from './vk-client';
import { publishProductionPanelTargetRouterAuthority, type IssuedPanelDelivery, type PanelTargetDeliveryGuardOwner } from './panelTargetRouterAuthority';

const WORKSPACE_PREFIX = '/internal/panel-target/workspaces';
const PREVIEW_PREFIX = '/internal/panel-target/previews';
const WORKSPACE_KINDS = new Set(['overview', 'code', 'changes', 'beads', 'forms']);
const MAX_REDIRECTS = 5;

function safeHttps(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url : null;
  } catch { return null; }
}

export async function validatePanelDeliveryRedirectChain(initial: string, fetchImpl: typeof fetch): Promise<string | null> {
  let current = safeHttps(initial);
  if (!current) return null;
  const allowedOrigin = current.origin;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    let response: Response;
    try { response = await fetchImpl(current.href, { method: 'HEAD', redirect: 'manual' }); } catch { return null; }
    if (response.status < 300 || response.status >= 400) return response.ok ? current.href : null;
    const location = response.headers.get('location');
    if (!location) return null;
    const next = safeHttps(new URL(location, current).href);
    if (!next || next.origin !== allowedOrigin) return null;
    current = next;
  }
  return null;
}

export function registerPanelTargetDeliveryRoutes(app: Hono, options: {
  vkClient?: Pick<VibeKanbanServerClient, 'getPreviewSlotUrl'>;
  vkOrigin?: string;
  previewCustomerSlug?: string;
  fetchImpl?: typeof fetch;
} = {}): { dispose(): void } {
  const client = options.vkClient ?? new VibeKanbanServerClient();
  const origin = new URL(options.vkOrigin ?? process.env.VITE_VK_BASE_ORIGIN ?? '').origin;
  const previewCustomerSlug = options.previewCustomerSlug ?? 'preview';
  const fetchImpl = options.fetchImpl ?? fetch;
  let active = true;
  const createGuardOwner = (isRegistered: () => boolean): PanelTargetDeliveryGuardOwner => ({
    isCurrent: () => active && isRegistered(),
    issueWorkspace(kind, workspaceId, applicationOrigin): IssuedPanelDelivery | null {
      if (!active || !isRegistered() || !WORKSPACE_KINDS.has(kind)) return null;
      const upstream = new URL(`/workspaces/${encodeURIComponent(workspaceId)}${kind === 'code' ? '/vscode' : ''}`, origin);
      const delivery = new URL(`${WORKSPACE_PREFIX}/${encodeURIComponent(workspaceId)}/${encodeURIComponent(kind)}`, applicationOrigin);
      return Object.freeze({ location: upstream.href, guard: Object.freeze({ deliveryUrl: delivery.href, upstreamOrigin: upstream.origin }) });
    },
    async issuePreview(workspaceId, previewId, applicationOrigin): Promise<IssuedPanelDelivery | null> {
      if (!active || !isRegistered()) return null;
      try {
        const resolved = await client.getPreviewSlotUrl(workspaceId, previewId, { customerSlug: previewCustomerSlug });
        if (resolved.previewSlotId !== previewId) return null;
        const location = await validatePanelDeliveryRedirectChain(resolved.url, fetchImpl);
        if (!location || !active || !isRegistered()) return null;
        const upstream = new URL(location);
        const delivery = new URL(`${PREVIEW_PREFIX}/${encodeURIComponent(workspaceId)}/${encodeURIComponent(previewId)}`, applicationOrigin);
        return Object.freeze({ location, guard: Object.freeze({ deliveryUrl: delivery.href, upstreamOrigin: upstream.origin }) });
      } catch { return null; }
    },
  });
  let authority: PanelTargetDeliveryGuardOwner | undefined;
  const registration = publishProductionPanelTargetRouterAuthority({
    builtInRoutes: {},
    redirectGuards: {},
    deliveryRoutes: { workspacePrefix: WORKSPACE_PREFIX, previewPrefix: PREVIEW_PREFIX },
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
  app.get(`${PREVIEW_PREFIX}/:workspaceId/:previewId`, async (c) => {
    const issued = await registeredAuthority.issuePreview(c.req.param('workspaceId'), c.req.param('previewId'), new URL(c.req.url).origin);
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
