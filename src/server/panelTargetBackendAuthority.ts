import type { VibeKanbanServerClient, WorkspacePanelTargetAuthoritySnapshot } from './vk-client';
import type { AuthorityReadiness, PanelTargetDeliveryGuardOwner } from './panelTargetRouterAuthority';
import type { OwnedPanelBackendTarget, PanelRedirectGuard } from './panelTargetRuntimeAuthority';
export interface BackendTargetAuthorityDefinitions { agentSessions: Record<string, OwnedPanelBackendTarget>; terminals: Record<string, OwnedPanelBackendTarget>; previews: Record<string, OwnedPanelBackendTarget>; redirectGuards: Record<string, PanelRedirectGuard>; workspaceTargets: Record<string, Record<string, { location: string; available: boolean; factoryKey: string }>>; }
type BackendClient = Pick<VibeKanbanServerClient, 'getPanelTargetAuthority'>;
function setUnique<T>(record: Record<string, T>, key: string, value: T): void { if (key in record) throw new Error('Panel target owner returned a duplicate stable identity'); record[key] = value; }
function freeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const nested of Object.values(value as Record<string, unknown>)) freeze(nested); } return value; }
export async function loadPanelTargetBackendAuthority(client: BackendClient, workspaceIds: readonly string[], guardOwner: PanelTargetDeliveryGuardOwner, applicationOrigin: string): Promise<AuthorityReadiness<BackendTargetAuthorityDefinitions>> {
  if (!guardOwner.isCurrent()) return { status: 'not-ready' };
  const definitions: BackendTargetAuthorityDefinitions = { agentSessions: {}, terminals: {}, previews: {}, redirectGuards: {}, workspaceTargets: {} };
  for (const workspaceId of workspaceIds) {
    const snapshot: WorkspacePanelTargetAuthoritySnapshot = await client.getPanelTargetAuthority(workspaceId);
    if (!snapshot.ready || snapshot.workspaceId !== workspaceId || !snapshot.terminalsReady) return { status: 'not-ready' };
    const targets: Record<string, { location: string; available: boolean; factoryKey: string }> = {};
    for (const [kind, reference] of Object.entries(snapshot.workspaceTargets)) if (reference?.available && reference.factoryKey) {
      const issued = guardOwner.issueWorkspace(kind, workspaceId, applicationOrigin);
      if (!issued) continue;
      targets[kind] = { location: issued.location, available: true, factoryKey: reference.factoryKey };
      setUnique(definitions.redirectGuards, `${kind === 'overview' ? 'craft-overview' : kind}:${workspaceId}`, issued.guard);
    }
    setUnique(definitions.workspaceTargets, workspaceId, targets);
    // Session and terminal identities remain owner data, but no runtime route
    // currently consumes them. Do not publish privileged, inert definitions.
    // Preview identities remain owner data only. Until the route owner can
    // issue an atomic delivery lease, publishing a location/guard is unsafe.
  }
  return guardOwner.isCurrent() ? { status: 'ready', definitions: freeze(structuredClone(definitions)) } : { status: 'not-ready' };
}
