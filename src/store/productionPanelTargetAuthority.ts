import type { Craft } from '../types';
import { getPluginRegistrySnapshot } from '../modules/plugins/vibe-dashboard/registry';
import type { PluginRegistryState } from '../modules/plugins/vibe-dashboard/types';
import { VibeKanbanServerClient } from '../server/vk-client';
import { loadPanelTargetBackendAuthority } from '../server/panelTargetBackendAuthority';
import {
  getProductionPanelTargetRouterAuthoritySnapshot,
  type AuthorityReadiness,
  type PanelTargetRouterDefinitions,
} from '../server/panelTargetRouterAuthority';
import { createPanelTargetRuntimeAuthoritySnapshot, type PanelTargetRuntimeAuthoritySnapshot } from '../server/panelTargetRuntimeAuthority';
import type { PanelTargetResolutionContext, TrustedWorkspace } from './panelTargetRegistry';

type AuthorityClient = Pick<VibeKanbanServerClient,
  'getWorkspaces' | 'getWorkspaceRepos' | 'getPanelTargetAuthority'>;
type WorkspaceDetail = {
  workspace: Awaited<ReturnType<AuthorityClient['getWorkspaces']>>[number];
  repos: Awaited<ReturnType<AuthorityClient['getWorkspaceRepos']>>;
};
const WORKSPACE_TARGET_KEYS = ['overview', 'code', 'changes', 'beads', 'forms'] as const;

export interface ProductionPanelTargetAuthorityServices {
  readonly client: AuthorityClient;
  readonly getPlugins: () => PluginRegistryState;
  readonly getHostOrigin: () => string;
  readonly getRouterAuthority: () => AuthorityReadiness<PanelTargetRouterDefinitions>;
}

function unavailable(message: string): Error {
  return Object.assign(new Error(message), { code: 'MIGRATION_AUTHORITY_UNAVAILABLE' });
}

function configuredHostOrigin(env: Record<string, string | undefined>): string {
  const configured = env.VITE_VK_BASE_ORIGIN?.trim();
  if (!configured) throw unavailable('Canonical workspace delivery service is not ready');
  try {
    const parsed = new URL(configured);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.origin !== configured.replace(/\/$/, '')) throw new Error();
    return parsed.origin;
  } catch { throw unavailable('Canonical workspace delivery service is malformed'); }
}

/** Real application composition; every privilege-bearing field has a named owner. */
export function createProductionPanelTargetAuthorityServices(input: {
  env?: Record<string, string | undefined>;
  client?: AuthorityClient;
  getPlugins?: () => PluginRegistryState;
  getRouterAuthority?: () => AuthorityReadiness<PanelTargetRouterDefinitions>;
} = {}): ProductionPanelTargetAuthorityServices {
  const env = input.env ?? process.env;
  return {
    client: input.client ?? new VibeKanbanServerClient(),
    getPlugins: input.getPlugins ?? getPluginRegistrySnapshot,
    getHostOrigin: () => configuredHostOrigin(env),
    getRouterAuthority: input.getRouterAuthority ?? getProductionPanelTargetRouterAuthoritySnapshot,
  };
}

/**
 * Authority ownership audit:
 * - workspace ownership/locations, sessions and explicit terminal readiness:
 *   VK's typed workspace Panel-target authority endpoint;
 * - previews: that endpoint's typed preview metadata plus the preview-slot URL resolver;
 * - plugin targets/grants: installed plugin/factory registry;
 * - built-in routes/redirect guards: application router/guard registry.
 * This adapter only validates, clones, combines, and filters owner snapshots.
 */
export async function createProductionPanelTargetContextProvider(
  services: ProductionPanelTargetAuthorityServices = createProductionPanelTargetAuthorityServices(),
): Promise<(craft: Craft, workspaceId: string) => PanelTargetResolutionContext | null> {
  const hostOrigin = services.getHostOrigin();
  const plugins = structuredClone(services.getPlugins());
  const current = (await services.client.getWorkspaces()).filter(({ archived }) => !archived);
  const details: WorkspaceDetail[] = await Promise.all(current.map(async (workspace) => ({
    workspace, repos: await services.client.getWorkspaceRepos(workspace.id),
  })));
  const router = services.getRouterAuthority();
  if (router.status !== 'ready') throw unavailable('Panel target router authority is not ready');
  if (Object.values(router.definitions.deliveryRoutes).some((value) => !value)) throw unavailable('Panel target delivery authority is not ready');
  const backend = await loadPanelTargetBackendAuthority(services.client, current.map(({ id }) => id), router.definitions.deliveryRoutes);
  if (backend.status !== 'ready') throw unavailable('Panel target backend authority is not ready');
  const duplicateGuard = Object.keys(backend.definitions.redirectGuards)
    .find((key) => key in router.definitions.redirectGuards);
  if (duplicateGuard) throw unavailable('Panel target redirect-guard owners conflict');
  const runtime = createPanelTargetRuntimeAuthoritySnapshot({
    hostOrigin, plugins,
    agentSessions: backend.definitions.agentSessions,
    terminals: backend.definitions.terminals,
    previews: backend.definitions.previews,
    builtInRoutes: router.definitions.builtInRoutes,
    redirectGuards: { ...backend.definitions.redirectGuards, ...router.definitions.redirectGuards },
  });
  return providerFromSnapshot(runtime, new Map(details.map((detail) => [detail.workspace.id, detail])), backend.definitions.workspaceTargets);
}

function providerFromSnapshot(runtime: PanelTargetRuntimeAuthoritySnapshot, byId: Map<string, WorkspaceDetail>, workspaceTargets: BackendWorkspaceTargets) {
  return (craft: Craft, workspaceId: string): PanelTargetResolutionContext | null => {
    const detail = byId.get(workspaceId);
    const targets = workspaceTargets[workspaceId];
    if (!detail || craft.workspace?.workspaceId !== workspaceId || !detail.workspace.agent_working_dir || !targets) return null;
    const keys = WORKSPACE_TARGET_KEYS;
    if (keys.some((key) => !targets[key]?.available || !targets[key]?.location || !targets[key]?.factoryKey)) return null;
    const workspace: TrustedWorkspace = {
      id: workspaceId, available: true, directory: detail.workspace.agent_working_dir,
      origin: runtime.hostOrigin, repositoryIds: detail.repos.map(({ id }) => id),
      locations: Object.fromEntries(keys.map((key) => [key, targets[key]!.location])) as TrustedWorkspace['locations'],
    };
    const allowedPluginTargets = [...runtime.allowedPluginTargets(craft)];
    return {
      craftId: craft.id, hostOrigin: runtime.hostOrigin,
      crafts: { [craft.id]: { workspaceId, allowedPluginTargets } }, workspaces: { [workspaceId]: workspace },
      agentSessions: runtime.agentSessions, terminals: runtime.terminals, previews: runtime.previews,
      builtInRoutes: runtime.builtInRoutesForCraft(craft), redirectGuards: runtime.redirectGuards,
      getPluginRegistry: () => runtime.plugins,
    };
  };
}

type BackendWorkspaceTargets = Record<string, Partial<Record<string, { location: string; available: boolean; factoryKey: string }>>>;
