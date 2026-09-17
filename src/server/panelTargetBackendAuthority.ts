import type { VibeKanbanServerClient, WorkspacePanelTargetAuthoritySnapshot } from './vk-client';
import type { AuthorityReadiness, PanelTargetDeliveryRoutes } from './panelTargetRouterAuthority';
import type { OwnedPanelBackendTarget, PanelRedirectGuard } from './panelTargetRuntimeAuthority';
export interface BackendTargetAuthorityDefinitions { agentSessions: Record<string, OwnedPanelBackendTarget>; terminals: Record<string, OwnedPanelBackendTarget>; previews: Record<string, OwnedPanelBackendTarget>; redirectGuards: Record<string, PanelRedirectGuard>; workspaceTargets: Record<string, Record<string, { location: string; available: boolean; factoryKey: string }>>; }
type BackendClient = Pick<VibeKanbanServerClient, 'getPanelTargetAuthority' | 'getPreviewSlotUrl'>;
const join = (prefix: string, ...parts: string[]) => `${prefix.replace(/\/$/, '')}/${parts.map(encodeURIComponent).join('/')}`;
function setUnique<T>(record: Record<string, T>, key: string, value: T): void { if (key in record) throw new Error('Panel target owner returned a duplicate stable identity'); record[key] = value; }
function freeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const nested of Object.values(value as Record<string, unknown>)) freeze(nested); } return value; }
function origin(value: string): string | null { try { const parsed = new URL(value); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.origin : null; } catch { return null; } }
export async function loadPanelTargetBackendAuthority(client: BackendClient, workspaceIds: readonly string[], routes: PanelTargetDeliveryRoutes, applicationOrigin: string): Promise<AuthorityReadiness<BackendTargetAuthorityDefinitions>> {
  const definitions: BackendTargetAuthorityDefinitions = { agentSessions: {}, terminals: {}, previews: {}, redirectGuards: {}, workspaceTargets: {} };
  for (const workspaceId of workspaceIds) {
    const snapshot: WorkspacePanelTargetAuthoritySnapshot = await client.getPanelTargetAuthority(workspaceId);
    if (!snapshot.ready || snapshot.workspaceId !== workspaceId || !snapshot.terminalsReady) return { status: 'not-ready' };
    const targets: Record<string, { location: string; available: boolean; factoryKey: string }> = {};
    for (const [kind, reference] of Object.entries(snapshot.workspaceTargets)) if (reference?.available && reference.factoryKey) {
      const delivery = join(routes.workspacePrefix, workspaceId, kind);
      const location = `${routes.workspaceUpstreamPrefix}/${encodeURIComponent(workspaceId)}${kind === 'code' ? '/vscode' : ''}`;
      targets[kind] = { location, available: true, factoryKey: reference.factoryKey };
      setUnique(definitions.redirectGuards, `${kind === 'overview' ? 'craft-overview' : kind}:${workspaceId}`, { deliveryUrl: new URL(delivery, applicationOrigin).href, upstreamOrigin: routes.workspaceUpstreamOrigin });
    }
    setUnique(definitions.workspaceTargets, workspaceId, targets);
    // Session and terminal identities remain owner data, but no runtime route
    // currently consumes them. Do not publish privileged, inert definitions.
    for (const preview of snapshot.previews) if (preview.workspaceId === workspaceId && preview.available && preview.factoryKey) {
      try {
        const resolved = await client.getPreviewSlotUrl(workspaceId, preview.previewSlotId, { customerSlug: routes.previewCustomerSlug });
        const upstreamOrigin = resolved.previewSlotId === preview.previewSlotId ? origin(resolved.url) : null;
        if (!upstreamOrigin) continue;
        const location = join(routes.previewPrefix, workspaceId, preview.previewSlotId);
        setUnique(definitions.previews, preview.previewSlotId, { workspaceId, location: resolved.url, factoryKey: preview.factoryKey });
        setUnique(definitions.redirectGuards, `preview:${preview.previewSlotId}`, { deliveryUrl: new URL(location, applicationOrigin).href, upstreamOrigin });
      } catch { /* unavailable preview targets are intentionally omitted */ }
    }
  }
  return { status: 'ready', definitions: freeze(structuredClone(definitions)) };
}
