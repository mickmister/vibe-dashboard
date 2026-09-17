import type { Craft } from '../types';
import { getPluginRegistrySnapshot } from '../modules/plugins/vibe-dashboard/registry';
import type { PluginRegistryState } from '../modules/plugins/vibe-dashboard/types';
import { VibeKanbanServerClient, type RepoWithBranch, type Session, type Workspace } from '../server/vk-client';
import type { PanelTargetResolutionContext, TrustedWorkspace } from './panelTargetRegistry';

type AuthorityClient = Pick<VibeKanbanServerClient, 'getWorkspaces' | 'getWorkspaceRepos' | 'getSessions'>;
type AuthorityConfiguration = {
  hostOrigin: string;
  workspaceOrigin: string;
  locations: TrustedWorkspace['locations'];
  redirectGuards: PanelTargetResolutionContext['redirectGuards'];
  craftPluginAuthorizations: Record<string, string[]>;
};

function parseConfiguration(env: Record<string, string | undefined>): AuthorityConfiguration {
  const raw = env.VD_VOYAGE_TARGET_AUTHORITY_JSON;
  if (!raw) throw Object.assign(new Error('Voyage target authority configuration is unavailable'), { code: 'MIGRATION_AUTHORITY_UNAVAILABLE' });
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw Object.assign(new Error('Voyage target authority configuration is malformed'), { code: 'MIGRATION_AUTHORITY_UNAVAILABLE' }); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Voyage target authority configuration is malformed'), { code: 'MIGRATION_AUTHORITY_UNAVAILABLE' });
  const candidate = value as AuthorityConfiguration;
  const locationKeys = ['overview', 'code', 'changes', 'beads', 'forms'];
  if (!candidate.locations || locationKeys.some((key) => typeof candidate.locations[key as keyof TrustedWorkspace['locations']] !== 'string')
    || !candidate.redirectGuards || !candidate.craftPluginAuthorizations) {
    throw Object.assign(new Error('Voyage target authority configuration is incomplete'), { code: 'MIGRATION_AUTHORITY_UNAVAILABLE' });
  }
  for (const origin of [candidate.hostOrigin, candidate.workspaceOrigin]) {
    try { if (new URL(origin).origin !== origin) throw new Error(); } catch { throw Object.assign(new Error('Voyage target authority origin is invalid'), { code: 'MIGRATION_AUTHORITY_UNAVAILABLE' }); }
  }
  return structuredClone(candidate);
}

/** Immutable production snapshot used by migration and post-cutover commands. */
export async function createProductionPanelTargetContextProvider(options: {
  env?: Record<string, string | undefined>;
  client?: AuthorityClient;
  pluginRegistry?: PluginRegistryState;
} = {}): Promise<(craft: Craft, workspaceId: string) => PanelTargetResolutionContext | null> {
  const configuration = parseConfiguration(options.env ?? process.env);
  const client = options.client ?? new VibeKanbanServerClient();
  const plugins = structuredClone(options.pluginRegistry ?? getPluginRegistrySnapshot());
  const contributionKeys = new Set([...Object.keys(plugins.internalRoutes), ...Object.keys(plugins.craftSurfaces)]);
  for (const targets of Object.values(configuration.craftPluginAuthorizations)) {
    if (!Array.isArray(targets) || targets.some((target) => typeof target !== 'string' || !contributionKeys.has(target)) || new Set(targets).size !== targets.length) {
      throw Object.assign(new Error('Voyage target plugin authorization is invalid'), { code: 'MIGRATION_AUTHORITY_UNAVAILABLE' });
    }
  }
  for (const guard of Object.values(configuration.redirectGuards)) {
    try {
      const delivery = new URL(guard.deliveryUrl); const upstream = new URL(guard.upstreamOrigin);
      if (!['http:', 'https:'].includes(delivery.protocol) || !['http:', 'https:'].includes(upstream.protocol)
        || delivery.username || delivery.password || upstream.username || upstream.password) throw new Error();
    } catch { throw Object.assign(new Error('Voyage redirect guard configuration is invalid'), { code: 'MIGRATION_AUTHORITY_UNAVAILABLE' }); }
  }
  const current = (await client.getWorkspaces()).filter(({ archived }) => !archived);
  const details = await Promise.all(current.map(async (workspace) => ({
    workspace,
    repos: await client.getWorkspaceRepos(workspace.id),
    sessions: await client.getSessions(workspace.id),
  })));
  const workspaces = Object.fromEntries(details.map(({ workspace, repos }) => [workspace.id, trustedWorkspace(workspace, repos, configuration)]));
  const agentSessions = Object.fromEntries(details.flatMap(({ workspace, sessions }) => sessions.map((session) => [session.id, sessionTarget(workspace, session)])));
  const authorizations = structuredClone(configuration.craftPluginAuthorizations);
  const redirectGuards = structuredClone(configuration.redirectGuards);
  return (craft, workspaceId) => {
    const workspace = workspaces[workspaceId];
    if (!workspace || craft.workspace?.workspaceId !== workspaceId) return null;
    return {
      craftId: craft.id,
      hostOrigin: configuration.hostOrigin,
      crafts: { [craft.id]: { workspaceId, allowedPluginTargets: [...(authorizations[craft.id] ?? [])] } },
      workspaces,
      agentSessions,
      terminals: {}, previews: {}, builtInRoutes: {}, redirectGuards,
      getPluginRegistry: () => plugins,
    };
  };
}

function trustedWorkspace(workspace: Workspace, repos: RepoWithBranch[], configuration: AuthorityConfiguration): TrustedWorkspace {
  const expand = (template: string) => template.replaceAll('{{workspaceId}}', encodeURIComponent(workspace.id));
  return {
    id: workspace.id, available: true, directory: workspace.agent_working_dir ?? '', origin: configuration.workspaceOrigin,
    repositoryIds: repos.map(({ id }) => id),
    locations: Object.fromEntries(Object.entries(configuration.locations).map(([key, value]) => [key, expand(value)])) as TrustedWorkspace['locations'],
  };
}

function sessionTarget(workspace: Workspace, session: Session) {
  return { workspaceId: workspace.id, location: `/workspaces/${encodeURIComponent(workspace.id)}/sessions/${encodeURIComponent(session.id)}` };
}
