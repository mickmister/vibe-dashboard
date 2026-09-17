import type { Session, VibeKanbanServerClient, Workspace } from './vk-client';
import type { AuthorityReadiness } from './panelTargetRouterAuthority';
import type { OwnedPanelBackendTarget, PanelRedirectGuard } from './panelTargetRuntimeAuthority';

export interface AuthoritativeDelivery {
  location: string;
  available: boolean;
  factoryKey: string;
  redirectGuard?: PanelRedirectGuard;
}
export interface AuthorityWorkspace extends Workspace {
  panel_targets?: Partial<Record<'overview' | 'code' | 'changes' | 'beads' | 'forms', AuthoritativeDelivery>>;
}
export interface AuthoritySession extends Session {
  panel_target?: AuthoritativeDelivery;
  terminal_target?: AuthoritativeDelivery & { terminalId: string; allowedCraftIds?: string[]; available: boolean };
}
export interface AuthorityPreviewUrlPart {
  previewSlotId: string;
  factoryKey?: string;
  customerSlug?: string;
  baseDomain?: string;
  allowedCraftIds?: string[];
  available?: boolean;
  redirectGuard?: PanelRedirectGuard;
}
export interface BackendTargetAuthorityDefinitions {
  agentSessions: Record<string, OwnedPanelBackendTarget>;
  terminals: Record<string, OwnedPanelBackendTarget>;
  previews: Record<string, OwnedPanelBackendTarget>;
  redirectGuards: Record<string, PanelRedirectGuard>;
}

type BackendClient = Pick<VibeKanbanServerClient, 'getSessions' | 'getRunConfigs' | 'getPreviewSlotUrl'>;

function validLocation(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { const parsed = new URL(value); return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password; }
  catch { return value.startsWith('/') && !value.startsWith('//'); }
}

function target(workspaceId: string, delivery: AuthoritativeDelivery, allowedCraftIds?: string[]): OwnedPanelBackendTarget | null {
  return delivery.available && validLocation(delivery.location) && delivery.factoryKey
    ? { workspaceId, location: delivery.location, factoryKey: delivery.factoryKey, allowedCraftIds } : null;
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

/** Immutable snapshot adapter over the VK session/terminal and preview-slot owners. */
export async function loadPanelTargetBackendAuthority(
  client: BackendClient,
  workspaces: readonly AuthorityWorkspace[],
): Promise<AuthorityReadiness<BackendTargetAuthorityDefinitions>> {
  const definitions: BackendTargetAuthorityDefinitions = { agentSessions: {}, terminals: {}, previews: {}, redirectGuards: {} };
  for (const workspace of workspaces) {
    const workspaceGuardKeys = {
      overview: `craft-overview:${workspace.id}`, code: `code:${workspace.id}`,
      changes: `changes:${workspace.id}`, beads: `beads:${workspace.id}`, forms: `forms:${workspace.id}`,
    } as const;
    for (const [kind, delivery] of Object.entries(workspace.panel_targets ?? {}) as Array<[keyof typeof workspaceGuardKeys, AuthoritativeDelivery]>) {
      if (delivery.available && delivery.redirectGuard) setUnique(definitions.redirectGuards, workspaceGuardKeys[kind], structuredClone(delivery.redirectGuard));
    }
    const [sessions, runConfigs] = await Promise.all([
      client.getSessions(workspace.id) as Promise<AuthoritySession[]>, client.getRunConfigs(workspace.id),
    ]);
    for (const session of sessions) {
      if (session.workspace_id !== workspace.id) continue;
      if (session.panel_target) {
        const current = target(workspace.id, session.panel_target);
        if (current) setUnique(definitions.agentSessions, session.id, current);
        if (current && session.panel_target.redirectGuard) setUnique(definitions.redirectGuards, `agent-session:${session.id}`, structuredClone(session.panel_target.redirectGuard));
      }
      const terminal = session.terminal_target;
      if (terminal?.available && Array.isArray(terminal.allowedCraftIds)) {
        const current = target(workspace.id, terminal, terminal.allowedCraftIds);
        if (current) setUnique(definitions.terminals, terminal.terminalId, current);
        if (current && terminal.redirectGuard) setUnique(definitions.redirectGuards, `terminal:${terminal.terminalId}`, structuredClone(terminal.redirectGuard));
      }
    }
    const parts = runConfigs.preview_url_parts as AuthorityPreviewUrlPart[];
    for (const part of parts) {
      if (part.available === false || !part.customerSlug || !part.factoryKey || !Array.isArray(part.allowedCraftIds)) continue;
      let resolved;
      try {
        resolved = await client.getPreviewSlotUrl(workspace.id, part.previewSlotId, {
          customerSlug: part.customerSlug, baseDomain: part.baseDomain,
        });
      } catch { continue; }
      if (resolved.previewSlotId !== part.previewSlotId || !validLocation(resolved.url)) continue;
      setUnique(definitions.previews, part.previewSlotId, {
        workspaceId: workspace.id, location: resolved.url, factoryKey: part.factoryKey, allowedCraftIds: part.allowedCraftIds,
      });
      if (part.redirectGuard) setUnique(definitions.redirectGuards, `preview:${part.previewSlotId}`, structuredClone(part.redirectGuard));
    }
  }
  return { status: 'ready', definitions: freeze(structuredClone(definitions)) };
}
