import type { Craft } from '../types';
import { getPluginRegistrySnapshot } from '../modules/plugins/vibe-dashboard/registry';
import { getEffectiveTabs } from '../modules/plugins/vibe-dashboard/craft-surfaces';
import type { PluginRegistryState } from '../modules/plugins/vibe-dashboard/types';
import { VibeKanbanServerClient, type Session, type Workspace } from '../server/vk-client';
import {
  createPanelTargetRuntimeAuthoritySnapshot,
  createServerPanelTargetDeliverySnapshot,
  type PanelTargetRuntimeAuthoritySnapshot,
} from '../server/panelTargetRuntimeAuthority';
import type { PanelTargetResolutionContext, TrustedWorkspace } from './panelTargetRegistry';

type AuthorityClient = Pick<VibeKanbanServerClient,
  'getWorkspaces' | 'getWorkspaceRepos' | 'getSessions' | 'getRunConfigs'>;
type WorkspaceDetail = {
  workspace: Workspace;
  repos: Awaited<ReturnType<AuthorityClient['getWorkspaceRepos']>>;
  sessions: Awaited<ReturnType<AuthorityClient['getSessions']>>;
  runConfigs: Awaited<ReturnType<AuthorityClient['getRunConfigs']>>;
};

export interface ProductionPanelTargetAuthorityServices {
  readonly client: AuthorityClient;
  readonly getPlugins: () => PluginRegistryState;
  readonly getHostOrigin: () => string;
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

/** The real application composition boundary; it contains no migration-only configuration. */
export function createProductionPanelTargetAuthorityServices(input: {
  env?: Record<string, string | undefined>;
  client?: AuthorityClient;
  getPlugins?: () => PluginRegistryState;
} = {}): ProductionPanelTargetAuthorityServices {
  const env = input.env ?? process.env;
  return {
    client: input.client ?? new VibeKanbanServerClient(),
    getPlugins: input.getPlugins ?? getPluginRegistrySnapshot,
    getHostOrigin: () => configuredHostOrigin(env),
  };
}

/** Snapshots the exact authority shared by migration and live target resolution. */
export async function createProductionPanelTargetContextProvider(
  services: ProductionPanelTargetAuthorityServices = createProductionPanelTargetAuthorityServices(),
): Promise<(craft: Craft, workspaceId: string) => PanelTargetResolutionContext | null> {
  const hostOrigin = services.getHostOrigin();
  const plugins = structuredClone(services.getPlugins());
  const current = (await services.client.getWorkspaces()).filter(({ archived }) => !archived);
  const details: WorkspaceDetail[] = await Promise.all(current.map(async (workspace) => {
    const [repos, sessions, runConfigs] = await Promise.all([
      services.client.getWorkspaceRepos(workspace.id),
      services.client.getSessions(workspace.id),
      services.client.getRunConfigs(workspace.id),
    ]);
    return { workspace, repos, sessions, runConfigs };
  }));
  const byId = new Map(details.map((detail) => [detail.workspace.id, detail]));
  const agentSessions = Object.fromEntries(details.flatMap(({ workspace, sessions }) =>
    sessions.map((session) => [session.id, sessionTarget(workspace, session)])));
  const previews = Object.fromEntries(details.flatMap(({ workspace, runConfigs }) =>
    runConfigs.preview_slots.map((slot) => [slot.id, {
      workspaceId: workspace.id,
      location: `/api/preview/resolve?workspaceId=${encodeURIComponent(workspace.id)}&previewSlotId=${encodeURIComponent(slot.id)}`,
    }])));
  const delivery = createServerPanelTargetDeliverySnapshot({
    hostOrigin,
    workspaces: details.flatMap(({ workspace }) => workspace.agent_working_dir
      ? [{ id: workspace.id, directory: workspace.agent_working_dir }] : []),
    agentSessions,
    previews,
  });

  // There is currently no terminal target service or registered host-internal
  // Panel route. These are explicit ready-empty production categories.
  const runtime = createPanelTargetRuntimeAuthoritySnapshot({
    hostOrigin, plugins, terminals: {}, previews, ...delivery,
  });
  return providerFromSnapshot(runtime, byId, agentSessions);
}

function providerFromSnapshot(
  runtime: PanelTargetRuntimeAuthoritySnapshot,
  byId: Map<string, WorkspaceDetail>,
  agentSessions: PanelTargetResolutionContext['agentSessions'],
): (craft: Craft, workspaceId: string) => PanelTargetResolutionContext | null {
  return (craft, workspaceId) => {
    const detail = byId.get(workspaceId);
    if (!detail || craft.workspace?.workspaceId !== workspaceId || !detail.workspace.agent_working_dir) return null;
    const authoritativeCraft: Craft = { ...craft, workspace: { ...craft.workspace, workspaceDir: detail.workspace.agent_working_dir } };
    const allowedPluginTargets = [...runtime.allowedPluginTargets(authoritativeCraft)];
    const effectiveTabs = getEffectiveTabs(authoritativeCraft, {
      craftSurfaces: Object.values(runtime.plugins.craftSurfaces)
        .filter((surface) => allowedPluginTargets.includes(surface.key)),
      origin: runtime.hostOrigin,
    });
    const tab = (id: string) => effectiveTabs.find((candidate) => candidate.id === id)?.url ?? '';
    const workspace: TrustedWorkspace = {
      id: workspaceId, available: true, directory: detail.workspace.agent_working_dir,
      origin: runtime.hostOrigin, repositoryIds: detail.repos.map(({ id }) => id),
      locations: { overview: tab('agent'), code: tab('code'), changes: tab('agent'), beads: tab('beads'), forms: tab('forms') },
    };
    if (Object.values(workspace.locations).some((location) => !location)) return null;
    return {
      craftId: craft.id, hostOrigin: runtime.hostOrigin,
      crafts: { [craft.id]: { workspaceId, allowedPluginTargets } },
      workspaces: { [workspaceId]: workspace }, agentSessions,
      terminals: runtime.terminals, previews: runtime.previews,
      builtInRoutes: runtime.builtInRoutesForCraft(craft), redirectGuards: runtime.redirectGuards,
      getPluginRegistry: () => runtime.plugins,
    };
  };
}

function sessionTarget(workspace: Workspace, _session: Session) {
  return { workspaceId: workspace.id, location: `/workspaces/${encodeURIComponent(workspace.id)}` };
}
