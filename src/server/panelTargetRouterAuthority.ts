import type { PanelBuiltInRoute, PanelRedirectGuard } from './panelTargetRuntimeAuthority';
export type AuthorityReadiness<T> = { readonly status: 'ready'; readonly definitions: T } | { readonly status: 'not-ready' };
export interface PanelTargetDeliveryRoutes {
  readonly workspacePrefix: string;
  readonly previewPrefix: string;
  readonly workspaceUpstreamOrigin: string;
  readonly previewCustomerSlug: string;
}
export interface PanelTargetRouterDefinitions { readonly builtInRoutes: Record<string, PanelBuiltInRoute>; readonly redirectGuards: Record<string, PanelRedirectGuard>; readonly deliveryRoutes: PanelTargetDeliveryRoutes; }
function freeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const nested of Object.values(value as Record<string, unknown>)) freeze(nested); } return value; }
export class PanelTargetRouterAuthorityRegistry {
  private current: AuthorityReadiness<PanelTargetRouterDefinitions> = { status: 'not-ready' };
  publish(definitions: PanelTargetRouterDefinitions): void { this.current = { status: 'ready', definitions: freeze(structuredClone(definitions)) }; }
  markNotReady(): void { this.current = { status: 'not-ready' }; }
  snapshot(): AuthorityReadiness<PanelTargetRouterDefinitions> { return this.current.status === 'ready' ? { status: 'ready', definitions: freeze(structuredClone(this.current.definitions)) } : { status: 'not-ready' }; }
}
const productionRouterAuthority = new PanelTargetRouterAuthorityRegistry();
export function createPanelTargetRouterAuthoritySnapshot(definitions: PanelTargetRouterDefinitions): AuthorityReadiness<PanelTargetRouterDefinitions> {
  const owner = new PanelTargetRouterAuthorityRegistry();
  owner.publish(definitions);
  return owner.snapshot();
}
export function publishProductionPanelTargetRouterAuthority(definitions: PanelTargetRouterDefinitions): void { productionRouterAuthority.publish(definitions); }
export function markProductionPanelTargetRouterAuthorityNotReady(): void { productionRouterAuthority.markNotReady(); }
export function getProductionPanelTargetRouterAuthoritySnapshot(): AuthorityReadiness<PanelTargetRouterDefinitions> { return productionRouterAuthority.snapshot(); }
