import type { PanelBuiltInRoute, PanelRedirectGuard } from './panelTargetRuntimeAuthority';

export type AuthorityReadiness<T> = { readonly status: 'ready'; readonly definitions: T } | { readonly status: 'not-ready' };
export type IssuedPanelDelivery = { readonly location: string; readonly guard: PanelRedirectGuard };
export interface PanelTargetDeliveryGuardOwner {
  issueWorkspace(kind: string, workspaceId: string, applicationOrigin: string): IssuedPanelDelivery | null;
  issuePreview(workspaceId: string, previewId: string, applicationOrigin: string): Promise<IssuedPanelDelivery | null>;
  isCurrent(): boolean;
}
export interface PanelTargetDeliveryRoutes { readonly workspacePrefix: string }
export interface PanelTargetRouterDefinitions {
  readonly builtInRoutes: Record<string, PanelBuiltInRoute>;
  readonly redirectGuards: Record<string, PanelRedirectGuard>;
  readonly deliveryRoutes: PanelTargetDeliveryRoutes;
  readonly deliveryGuardOwner: PanelTargetDeliveryGuardOwner;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) freeze(nested);
  }
  return value;
}

export class PanelTargetRouterAuthorityRegistry {
  private generation = 0;
  private current: AuthorityReadiness<PanelTargetRouterDefinitions> = { status: 'not-ready' };

  publish(input: Omit<PanelTargetRouterDefinitions, 'deliveryGuardOwner'> & {
    createGuardOwner(isCurrent: () => boolean): PanelTargetDeliveryGuardOwner;
  }): { dispose(): void } {
    const generation = ++this.generation;
    const isCurrent = () => this.generation === generation && this.current.status === 'ready';
    this.current = { status: 'ready', definitions: Object.freeze({
      builtInRoutes: freeze(structuredClone(input.builtInRoutes)),
      redirectGuards: freeze(structuredClone(input.redirectGuards)),
      deliveryRoutes: freeze(structuredClone(input.deliveryRoutes)),
      deliveryGuardOwner: Object.freeze(input.createGuardOwner(isCurrent)),
    }) };
    let disposed = false;
    return { dispose: () => {
      if (disposed) return;
      disposed = true;
      if (this.generation === generation) {
        ++this.generation;
        this.current = { status: 'not-ready' };
      }
    } };
  }

  markNotReady(): void { ++this.generation; this.current = { status: 'not-ready' }; }
  snapshot(): AuthorityReadiness<PanelTargetRouterDefinitions> { return this.current; }
}

const productionRouterAuthority = new PanelTargetRouterAuthorityRegistry();
export function createPanelTargetRouterAuthoritySnapshot(
  definitions: Omit<PanelTargetRouterDefinitions, 'deliveryGuardOwner'> & { deliveryGuardOwner?: PanelTargetDeliveryGuardOwner },
): AuthorityReadiness<PanelTargetRouterDefinitions> {
  const owner = new PanelTargetRouterAuthorityRegistry();
  owner.publish({ ...definitions, createGuardOwner: (isCurrent) => definitions.deliveryGuardOwner ?? {
    issueWorkspace: () => null, issuePreview: async () => null, isCurrent,
  } });
  return owner.snapshot();
}
export function publishProductionPanelTargetRouterAuthority(
  definitions: Parameters<PanelTargetRouterAuthorityRegistry['publish']>[0],
): { dispose(): void } { return productionRouterAuthority.publish(definitions); }
export function markProductionPanelTargetRouterAuthorityNotReady(): void { productionRouterAuthority.markNotReady(); }
export function getProductionPanelTargetRouterAuthoritySnapshot(): AuthorityReadiness<PanelTargetRouterDefinitions> { return productionRouterAuthority.snapshot(); }
