import { describe, expect, it } from 'vitest';
import { createPanelTargetRouterAuthoritySnapshot, PanelTargetRouterAuthorityRegistry } from './panelTargetRouterAuthority';

describe('router and redirect-guard Panel authority owner', () => {
  it('publishes an explicit ready-empty production registry', () => {
    const owner = new PanelTargetRouterAuthorityRegistry();
    expect(owner.snapshot()).toEqual({ status: 'not-ready' });
    owner.publish({ builtInRoutes: {}, redirectGuards: {}, deliveryRoutes: { workspacePrefix: '/w', agentSessionPrefix: '/s', terminalPrefix: '/t', previewPrefix: '/p' } });
    expect(owner.snapshot()).toMatchObject({ status: 'ready', definitions: { builtInRoutes: {}, redirectGuards: {} } });
  });

  it('copies exact route allowlists and guards into an immutable snapshot', () => {
    const snapshot = createPanelTargetRouterAuthoritySnapshot({
      builtInRoutes: { settings: { location: '/settings', allowedCraftIds: ['craft-1'] } },
      redirectGuards: { settings: { deliveryUrl: 'https://dashboard.test/settings', upstreamOrigin: 'https://dashboard.test' } },
      deliveryRoutes: { workspacePrefix: '/w', agentSessionPrefix: '/s', terminalPrefix: '/t', previewPrefix: '/p' },
    });
    expect(snapshot).toMatchObject({ status: 'ready', definitions: { builtInRoutes: { settings: { allowedCraftIds: ['craft-1'] } } } });
    if (snapshot.status === 'ready') expect(Object.isFrozen(snapshot.definitions.builtInRoutes.settings?.allowedCraftIds)).toBe(true);
  });
});
