import type { PanelBuiltInRoute, PanelRedirectGuard } from './panelTargetRuntimeAuthority';

export type AuthorityReadiness<T> =
  | { readonly status: 'ready'; readonly definitions: T }
  | { readonly status: 'not-ready' };

export interface PanelTargetRouterDefinitions {
  readonly builtInRoutes: Record<string, PanelBuiltInRoute>;
  readonly redirectGuards: Record<string, PanelRedirectGuard>;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) freeze(nested);
  }
  return value;
}

/** Read-only adapter owned by the application router and redirect-guard server. */
export function createPanelTargetRouterAuthoritySnapshot(
  definitions: PanelTargetRouterDefinitions,
): AuthorityReadiness<PanelTargetRouterDefinitions> {
  return { status: 'ready', definitions: freeze(structuredClone(definitions)) };
}

/**
 * The current production router registers no host-internal Panel targets and
 * no Panel redirect guards. Its explicit ready-empty snapshot is distinct from
 * server registration not having completed (`not-ready`).
 */
export function getProductionPanelTargetRouterAuthoritySnapshot(): AuthorityReadiness<PanelTargetRouterDefinitions> {
  return createPanelTargetRouterAuthoritySnapshot({ builtInRoutes: {}, redirectGuards: {} });
}
