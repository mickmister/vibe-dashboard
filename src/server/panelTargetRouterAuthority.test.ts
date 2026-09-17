import { describe, expect, it } from 'vitest';
import { createPanelTargetRouterAuthoritySnapshot, getProductionPanelTargetRouterAuthoritySnapshot } from './panelTargetRouterAuthority';

describe('router and redirect-guard Panel authority owner', () => {
  it('publishes an explicit ready-empty production registry', () => {
    expect(getProductionPanelTargetRouterAuthoritySnapshot()).toEqual({ status: 'ready', definitions: { builtInRoutes: {}, redirectGuards: {} } });
  });

  it('copies exact route allowlists and guards into an immutable snapshot', () => {
    const snapshot = createPanelTargetRouterAuthoritySnapshot({
      builtInRoutes: { settings: { location: '/settings', allowedCraftIds: ['craft-1'] } },
      redirectGuards: { settings: { deliveryUrl: 'https://dashboard.test/settings', upstreamOrigin: 'https://dashboard.test' } },
    });
    expect(snapshot).toMatchObject({ status: 'ready', definitions: { builtInRoutes: { settings: { allowedCraftIds: ['craft-1'] } } } });
    if (snapshot.status === 'ready') expect(Object.isFrozen(snapshot.definitions.builtInRoutes.settings?.allowedCraftIds)).toBe(true);
  });
});
