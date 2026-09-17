import type { Craft } from '../types';
import type { PluginRegistryState } from '../modules/plugins/vibe-dashboard/types';
import { getAllowedPluginTargetsForCraft } from '../modules/plugins/vibe-dashboard/registry';
import type { PanelTargetResolutionContext } from '../store/panelTargetRegistry';

export type OwnedPanelBackendTarget = { workspaceId: string; location: string };
export type PanelBuiltInRoute = { location: string; allowedCraftIds: string[]; capabilities?: unknown };
export type PanelRedirectGuard = { deliveryUrl: string; upstreamOrigin: string };

export interface PanelTargetRuntimeAuthoritySnapshot {
  readonly hostOrigin: string;
  readonly plugins: PluginRegistryState;
  readonly terminals: Record<string, OwnedPanelBackendTarget>;
  readonly previews: Record<string, OwnedPanelBackendTarget>;
  readonly builtInRoutes: Record<string, PanelBuiltInRoute>;
  readonly redirectGuards: Record<string, PanelRedirectGuard>;
  allowedPluginTargets(craft: Craft): readonly string[];
  builtInRoutesForCraft(craft: Craft): Record<string, PanelBuiltInRoute>;
}

export interface PanelTargetRuntimeAuthorityInputs {
  hostOrigin: string;
  plugins: PluginRegistryState;
  terminals: Record<string, OwnedPanelBackendTarget>;
  previews: Record<string, OwnedPanelBackendTarget>;
  builtInRoutes: Record<string, PanelBuiltInRoute>;
  redirectGuards: Record<string, PanelRedirectGuard>;
}

export interface WorkspacePanelDeliveryDefinition { id: string; directory: string }
export const DASHBOARD_HOME_PANEL_ROUTE = '/';

/** Canonical server-route delivery policy; consumers never manufacture guards. */
export function createServerPanelTargetDeliverySnapshot(input: {
  hostOrigin: string;
  workspaces: readonly WorkspacePanelDeliveryDefinition[];
  agentSessions: Record<string, OwnedPanelBackendTarget>;
  previews: Record<string, OwnedPanelBackendTarget>;
}): Pick<PanelTargetRuntimeAuthorityInputs, 'builtInRoutes' | 'redirectGuards'> {
  const redirectGuards: Record<string, PanelRedirectGuard> = {};
  const add = (key: string, location: string) => {
    const resolved = new URL(location, input.hostOrigin);
    redirectGuards[key] = { deliveryUrl: resolved.href, upstreamOrigin: resolved.origin };
  };
  add('internal-route:dashboard-home', DASHBOARD_HOME_PANEL_ROUTE);
  for (const workspace of input.workspaces) {
    add(`craft-overview:${workspace.id}`, `/workspaces/${encodeURIComponent(workspace.id)}`);
    add(`code:${workspace.id}`, `/?folder=${encodeURIComponent(workspace.directory)}`);
    add(`changes:${workspace.id}`, `/workspaces/${encodeURIComponent(workspace.id)}`);
    add(`beads:${workspace.id}`, '/');
    add(`forms:${workspace.id}`, `/dashboard/forms?workspaceId=${encodeURIComponent(workspace.id)}`);
  }
  for (const [id, target] of Object.entries(input.agentSessions)) add(`agent-session:${id}`, target.location);
  for (const [id, target] of Object.entries(input.previews)) add(`preview:${id}`, target.location);
  return { builtInRoutes: { 'dashboard-home': { location: DASHBOARD_HOME_PANEL_ROUTE, allowedCraftIds: [] } }, redirectGuards };
}

function unavailable(message: string): Error {
  return Object.assign(new Error(message), { code: 'MIGRATION_AUTHORITY_UNAVAILABLE' });
}

function clone<T>(value: T): T { return structuredClone(value); }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

/**
 * Creates the immutable security authority consumed by both live target
 * resolution and legacy migration.  All categories are required explicitly;
 * an empty object means the owning runtime service is ready and has no current
 * definitions, rather than an implicit/default-empty registry.
 */
export function createPanelTargetRuntimeAuthoritySnapshot(
  input: PanelTargetRuntimeAuthorityInputs,
): PanelTargetRuntimeAuthoritySnapshot {
  for (const category of ['plugins', 'terminals', 'previews', 'builtInRoutes', 'redirectGuards'] as const) {
    if (!input[category] || typeof input[category] !== 'object') throw unavailable(`Panel target ${category} authority is not ready`);
  }
  let origin: string;
  try {
    const parsed = new URL(input.hostOrigin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.origin !== input.hostOrigin.replace(/\/$/, '')) throw new Error();
    origin = parsed.origin;
  } catch { throw unavailable('Panel target delivery authority is not ready'); }

  const plugins = deepFreeze(clone(input.plugins));
  return Object.freeze({
    hostOrigin: origin,
    plugins,
    terminals: deepFreeze(clone(input.terminals)),
    previews: deepFreeze(clone(input.previews)),
    builtInRoutes: deepFreeze(clone(input.builtInRoutes)),
    redirectGuards: deepFreeze(clone(input.redirectGuards)),
    allowedPluginTargets(craft: Craft): readonly string[] {
      return getAllowedPluginTargetsForCraft(plugins, craft);
    },
    builtInRoutesForCraft(craft: Craft): Record<string, PanelBuiltInRoute> {
      return Object.fromEntries(Object.entries(input.builtInRoutes).map(([key, route]) => [key, {
        ...clone(route), allowedCraftIds: [craft.id],
      }]));
    },
  });
}

export type RuntimePanelTargetContextProvider =
  (craft: Craft, workspaceId: string) => PanelTargetResolutionContext | null;
