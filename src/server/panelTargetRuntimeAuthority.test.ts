import { describe, expect, it } from 'vitest';
import { createEmptyPluginRegistryState } from '../modules/plugins/vibe-dashboard/types';
import { createPanelTargetRuntimeAuthoritySnapshot, createServerPanelTargetDeliverySnapshot } from './panelTargetRuntimeAuthority';

describe('runtime Panel target authority', () => {
  it('publishes immutable ready-empty categories and server-owned live guards', () => {
    const delivery = createServerPanelTargetDeliverySnapshot({
      hostOrigin: 'https://dashboard.test',
      workspaces: [{ id: 'workspace-1', directory: '/work' }],
      agentSessions: {},
      previews: { preview: { workspaceId: 'workspace-1', location: '/api/preview' } },
    });
    const snapshot = createPanelTargetRuntimeAuthoritySnapshot({
      hostOrigin: 'https://dashboard.test', plugins: createEmptyPluginRegistryState(),
      terminals: {}, previews: {}, ...delivery,
    });
    expect(snapshot).toMatchObject({ terminals: {}, previews: {}, builtInRoutes: { 'dashboard-home': expect.any(Object) } });
    expect(snapshot.redirectGuards).toMatchObject({
      'code:workspace-1': expect.any(Object),
      'preview:preview': expect.any(Object),
      'internal-route:dashboard-home': expect.any(Object),
    });
    expect(Object.isFrozen(snapshot.redirectGuards)).toBe(true);
  });

  it('rejects missing readiness categories and unsafe origins', () => {
    const base = { hostOrigin: 'https://dashboard.test', plugins: createEmptyPluginRegistryState(), terminals: {}, previews: {}, builtInRoutes: {}, redirectGuards: {} };
    expect(() => createPanelTargetRuntimeAuthoritySnapshot({ ...base, previews: undefined as never })).toThrow('not ready');
    expect(() => createPanelTargetRuntimeAuthoritySnapshot({ ...base, hostOrigin: 'https://user:secret@dashboard.test' })).toThrow('not ready');
  });
});
