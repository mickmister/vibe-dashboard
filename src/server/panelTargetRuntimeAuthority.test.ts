/* eslint-disable formatjs/no-literal-string-in-object -- exact authority fixture */
import { describe, expect, it } from 'vitest';
import { createEmptyPluginRegistryState } from '../modules/plugins/vibe-dashboard/types';
import { createPanelTargetRuntimeAuthoritySnapshot } from './panelTargetRuntimeAuthority';

const base = { hostOrigin: 'https://dashboard.test', plugins: createEmptyPluginRegistryState(), agentSessions: {}, terminals: {}, previews: {}, builtInRoutes: {}, redirectGuards: {} };

describe('runtime Panel target authority', () => {
  it('copies immutable owner definitions and preserves built-in allowlists', () => {
    const snapshot = createPanelTargetRuntimeAuthoritySnapshot({ ...base,
      builtInRoutes: {
        allowed: { location: '/allowed', allowedCraftIds: ['craft-1'] },
        denied: { location: '/denied', allowedCraftIds: ['craft-2'] },
        nobody: { location: '/nobody', allowedCraftIds: [] },
      },
    });
    const craft = { id: 'craft-1', label: 'Craft', tabs: [], pairs: [], order: 0 };
    expect(snapshot.builtInRoutesForCraft(craft)).toEqual({ allowed: { location: '/allowed', allowedCraftIds: ['craft-1'] } });
    expect(snapshot.builtInRoutes.denied?.allowedCraftIds).toEqual(['craft-2']);
    expect(Object.isFrozen(snapshot.builtInRoutes)).toBe(true);
  });

  it('rejects missing owner categories and unsafe origins', () => {
    expect(() => createPanelTargetRuntimeAuthoritySnapshot({ ...base, previews: undefined as never })).toThrow('not ready');
    expect(() => createPanelTargetRuntimeAuthoritySnapshot({ ...base, hostOrigin: 'https://user:secret@dashboard.test' })).toThrow('not ready');
  });
});
