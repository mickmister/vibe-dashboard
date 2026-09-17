import type { PreviewSlotUrlParts, VibeKanbanServerClient, WorkspacePanelTargetAuthoritySnapshot } from './vk-client';
import type { AuthorityReadiness } from './panelTargetRouterAuthority';
import type { OwnedPanelBackendTarget, PanelRedirectGuard } from './panelTargetRuntimeAuthority';

export interface BackendTargetAuthorityDefinitions {
  agentSessions: Record<string, OwnedPanelBackendTarget>;
  terminals: Record<string, OwnedPanelBackendTarget>;
  previews: Record<string, OwnedPanelBackendTarget>;
  redirectGuards: Record<string, PanelRedirectGuard>;
  workspaceTargets: Record<string, WorkspacePanelTargetAuthoritySnapshot['workspaceTargets']>;
}
type BackendClient = Pick<VibeKanbanServerClient, 'getPanelTargetAuthority' | 'getPreviewSlotUrl'>;
function validLocation(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { const parsed = new URL(value); return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password; }
  catch { return value.startsWith('/') && !value.startsWith('//'); }
}
function setUnique<T>(record: Record<string, T>, key: string, value: T): void {
  if (key in record) throw new Error('Panel target owner returned a duplicate stable identity');
  record[key] = value;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) freeze(nested);
  }
  return value;
}
function validParts(parts: PreviewSlotUrlParts, previewId: string): boolean {
  return parts.previewSlotId === previewId && [parts.workspaceToken, parts.repoSlug, parts.slotSlug].every((value) => typeof value === 'string' && value.length > 0);
}
export async function loadPanelTargetBackendAuthority(client: BackendClient, workspaceIds: readonly string[]): Promise<AuthorityReadiness<BackendTargetAuthorityDefinitions>> {
  const definitions: BackendTargetAuthorityDefinitions = { agentSessions: {}, terminals: {}, previews: {}, redirectGuards: {}, workspaceTargets: {} };
  for (const workspaceId of workspaceIds) {
    const snapshot = await client.getPanelTargetAuthority(workspaceId);
    if (!snapshot.ready || snapshot.workspaceId !== workspaceId || !snapshot.terminalsReady) return { status: 'not-ready' };
    setUnique(definitions.workspaceTargets, workspaceId, structuredClone(snapshot.workspaceTargets));
    for (const session of snapshot.sessions) {
      if (session.workspaceId !== workspaceId || !session.delivery.available || !session.delivery.factoryKey || !validLocation(session.delivery.location)) continue;
      setUnique(definitions.agentSessions, session.sessionId, { workspaceId, location: session.delivery.location, factoryKey: session.delivery.factoryKey });
    }
    for (const terminal of snapshot.terminals) {
      if (terminal.workspaceId !== workspaceId || !terminal.delivery.available || !terminal.delivery.factoryKey || !validLocation(terminal.delivery.location)) continue;
      setUnique(definitions.terminals, terminal.terminalId, { workspaceId, location: terminal.delivery.location, factoryKey: terminal.delivery.factoryKey });
    }
    for (const preview of snapshot.previews) {
      if (preview.workspaceId !== workspaceId || !preview.available || !preview.factoryKey || !validParts(preview.urlParts, preview.previewSlotId)) continue;
      let resolved;
      try { resolved = await client.getPreviewSlotUrl(workspaceId, preview.previewSlotId, { customerSlug: preview.customerSlug }); }
      catch { continue; }
      if (resolved.previewSlotId !== preview.previewSlotId || !validLocation(resolved.url)) continue;
      setUnique(definitions.previews, preview.previewSlotId, { workspaceId, location: resolved.url, factoryKey: preview.factoryKey });
    }
  }
  return { status: 'ready', definitions: freeze(structuredClone(definitions)) };
}
