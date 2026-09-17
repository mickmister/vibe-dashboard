import type { Craft } from '../types';
import { getPluginRegistrySnapshot } from '../modules/plugins/vibe-dashboard/registry';
import { getEffectiveTabs } from '../modules/plugins/vibe-dashboard/craft-surfaces';
import { parsePluginInternalUrl } from '../modules/plugins/vibe-dashboard/runtime';
import type { PluginRegistryState } from '../modules/plugins/vibe-dashboard/types';
import { VibeKanbanServerClient, type Session, type Workspace } from '../server/vk-client';
import type { PanelTargetResolutionContext, TrustedWorkspace } from './panelTargetRegistry';
import { getPanelTargetRuntimeRegistrySnapshot, type PanelTargetRuntimeRegistrySnapshot } from './panelTargetRuntimeRegistry';

type AuthorityClient = Pick<VibeKanbanServerClient, 'getWorkspaces' | 'getWorkspaceRepos' | 'getSessions'>;

function productionOrigin(env: Record<string, string | undefined>): string {
  const configured = env.VITE_VK_BASE_ORIGIN?.trim();
  if (!configured) throw Object.assign(new Error('Canonical workspace delivery service is not ready'), { code: 'MIGRATION_AUTHORITY_UNAVAILABLE' });
  try {
    const parsed = new URL(configured);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.origin !== configured.replace(/\/$/, '')) throw new Error();
    return parsed.origin;
  } catch { throw Object.assign(new Error('Canonical workspace delivery service is malformed'), { code: 'MIGRATION_AUTHORITY_UNAVAILABLE' }); }
}

/** Immutable snapshot of the live VK, plugin, Craft-surface and Caddy authorities used by runtime. */
export async function createProductionPanelTargetContextProvider(options: {
  env?: Record<string, string | undefined>;
  client?: AuthorityClient;
  pluginRegistry?: PluginRegistryState;
  runtimeRegistry?: PanelTargetRuntimeRegistrySnapshot;
} = {}): Promise<(craft: Craft, workspaceId: string) => PanelTargetResolutionContext | null> {
  const origin = productionOrigin(options.env ?? process.env);
  const client = options.client ?? new VibeKanbanServerClient();
  const plugins = structuredClone(options.pluginRegistry ?? getPluginRegistrySnapshot());
  const runtime = structuredClone(options.runtimeRegistry ?? getPanelTargetRuntimeRegistrySnapshot());
  const current = (await client.getWorkspaces()).filter(({ archived }) => !archived);
  const details = await Promise.all(current.map(async (workspace) => ({ workspace,
    repos: await client.getWorkspaceRepos(workspace.id), sessions: await client.getSessions(workspace.id) })));
  const byId = new Map(details.map((detail) => [detail.workspace.id, detail]));
  const agentSessions = Object.fromEntries(details.flatMap(({ workspace, sessions }) => sessions.map((session) => [session.id, sessionTarget(workspace, session)])));

  return (craft, workspaceId) => {
    const detail = byId.get(workspaceId);
    if (!detail || craft.workspace?.workspaceId !== workspaceId || !detail.workspace.agent_working_dir) return null;
    const authoritativeCraft: Craft = { ...craft, workspace: { ...craft.workspace, workspaceDir: detail.workspace.agent_working_dir } };
    const effectiveTabs = getEffectiveTabs(authoritativeCraft, { craftSurfaces: Object.values(plugins.craftSurfaces), origin });
    const tab = (id: string) => effectiveTabs.find((candidate) => candidate.id === id)?.url ?? '';
    const workspace: TrustedWorkspace = {
      id: workspaceId, available: true, directory: detail.workspace.agent_working_dir, origin,
      repositoryIds: detail.repos.map(({ id }) => id),
      locations: { overview: tab('agent'), code: tab('code'), changes: tab('agent'), beads: tab('beads'), forms: tab('forms') },
    };
    if (Object.values(workspace.locations).some((location) => !location)) return null;
    const allowedPluginTargets = new Set(Object.keys(plugins.craftSurfaces));
    const factoryUrls = new Set(Object.values(plugins.tabGroupFactories).flatMap(({ workspaceComposition }) => workspaceComposition?.tabs.map(({ urlTemplate }) => urlTemplate) ?? []));
    for (const view of craft.tabs) {
      const parsed = parsePluginInternalUrl(view.url);
      const route = parsed && Object.values(plugins.internalRoutes).find((candidate) => candidate.pluginId === parsed.pluginId && candidate.path === parsed.routePath);
      if (route && factoryUrls.has(view.url)) allowedPluginTargets.add(route.key);
    }
    const redirectGuards = Object.fromEntries(['craft-overview', 'code', 'changes', 'beads', 'forms'].map((kind) => {
      const location = workspace.locations[kind === 'craft-overview' ? 'overview' : kind as keyof TrustedWorkspace['locations']];
      return [`${kind}:${workspaceId}`, { deliveryUrl: location, upstreamOrigin: new URL(location, origin).origin }];
    }));
    return {
      craftId: craft.id, hostOrigin: origin,
      crafts: { [craft.id]: { workspaceId, allowedPluginTargets: [...allowedPluginTargets].sort() } },
      workspaces: { [workspaceId]: workspace }, agentSessions,
      terminals: runtime.terminals, previews: runtime.previews, builtInRoutes: runtime.builtInRoutes, redirectGuards,
      getPluginRegistry: () => plugins,
    };
  };
}

function sessionTarget(workspace: Workspace, session: Session) {
  return { workspaceId: workspace.id, location: `/workspaces/${encodeURIComponent(workspace.id)}` };
}
