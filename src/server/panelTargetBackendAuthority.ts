import type { VibeKanbanServerClient, WorkspacePanelTargetAuthoritySnapshot } from './vk-client';
import type { AuthorityReadiness, PanelTargetDeliveryRoutes } from './panelTargetRouterAuthority';
import type { OwnedPanelBackendTarget, PanelRedirectGuard } from './panelTargetRuntimeAuthority';
export interface BackendTargetAuthorityDefinitions { agentSessions: Record<string, OwnedPanelBackendTarget>; terminals: Record<string, OwnedPanelBackendTarget>; previews: Record<string, OwnedPanelBackendTarget>; redirectGuards: Record<string, PanelRedirectGuard>; workspaceTargets: Record<string, Record<string, { location: string; available: boolean; factoryKey: string }>>; }
type BackendClient = Pick<VibeKanbanServerClient, 'getPanelTargetAuthority'>;
const join = (prefix: string, ...parts: string[]) => `${prefix.replace(/\/$/, '')}/${parts.map(encodeURIComponent).join('/')}`;
function setUnique<T>(record: Record<string, T>, key: string, value: T): void { if (key in record) throw new Error('Panel target owner returned a duplicate stable identity'); record[key] = value; }
function freeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const nested of Object.values(value as Record<string, unknown>)) freeze(nested); } return value; }
export async function loadPanelTargetBackendAuthority(client: BackendClient, workspaceIds: readonly string[], routes: PanelTargetDeliveryRoutes): Promise<AuthorityReadiness<BackendTargetAuthorityDefinitions>> {
  const definitions: BackendTargetAuthorityDefinitions = { agentSessions: {}, terminals: {}, previews: {}, redirectGuards: {}, workspaceTargets: {} };
  for (const workspaceId of workspaceIds) {
    const snapshot: WorkspacePanelTargetAuthoritySnapshot = await client.getPanelTargetAuthority(workspaceId);
    if (!snapshot.ready || snapshot.workspaceId !== workspaceId || !snapshot.terminalsReady) return { status: 'not-ready' };
    const targets: Record<string, { location: string; available: boolean; factoryKey: string }> = {};
    for (const [kind, reference] of Object.entries(snapshot.workspaceTargets)) if (reference?.available && reference.factoryKey) targets[kind] = { location: join(routes.workspacePrefix, workspaceId, kind), available: true, factoryKey: reference.factoryKey };
    setUnique(definitions.workspaceTargets, workspaceId, targets);
    for (const session of snapshot.sessions) if (session.workspaceId === workspaceId && session.factory.available && session.factory.factoryKey) setUnique(definitions.agentSessions, session.sessionId, { workspaceId, location: join(routes.agentSessionPrefix, workspaceId, session.sessionId), factoryKey: session.factory.factoryKey });
    for (const terminal of snapshot.terminals) if (terminal.workspaceId === workspaceId && terminal.factory.available && terminal.factory.factoryKey) setUnique(definitions.terminals, terminal.terminalId, { workspaceId, location: join(routes.terminalPrefix, workspaceId, terminal.terminalId), factoryKey: terminal.factory.factoryKey });
    for (const preview of snapshot.previews) if (preview.workspaceId === workspaceId && preview.available && preview.factoryKey) setUnique(definitions.previews, preview.previewSlotId, { workspaceId, location: join(routes.previewPrefix, workspaceId, preview.previewSlotId), factoryKey: preview.factoryKey });
  }
  return { status: 'ready', definitions: freeze(structuredClone(definitions)) };
}
