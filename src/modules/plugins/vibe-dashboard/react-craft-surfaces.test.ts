/* eslint-disable formatjs/no-literal-string-in-object -- Tests assert stable fixture metadata, not rendered copy. */
import { describe, expect, it } from 'vitest';
import type { Tab, TabGroup } from '../../../types';
import {
  FIRST_PARTY_FORMS_PLUGIN_ID,
  FIRST_PARTY_FORMS_SURFACE_KEY,
} from './craft-surfaces';
import { getReactCraftSurfaceTarget, hasReactCraftSurface } from './react-craft-surfaces';

describe('React Craft surfaces', () => {
  it('treats first-party Forms as a raw React surface with workspace props', () => {
    const tabGroup: Pick<TabGroup, 'tabs' | 'workspace'> = {
      workspace: {
        workspaceId: 'workspace-1',
        workspaceDir: '/repo/app',
        formsBeadId: 'vkvw-123',
      },
      tabs: [],
    };
    const tab: Tab = {
      id: 'forms',
      title: 'Forms',
      url: 'internal://forms',
      pinned: true,
      ephemeral: {
        kind: 'craft-surface',
        pluginId: FIRST_PARTY_FORMS_PLUGIN_ID,
        surfaceKey: FIRST_PARTY_FORMS_SURFACE_KEY,
        sourceKey: 'forms',
      },
    };

    expect(hasReactCraftSurface({
      pluginId: FIRST_PARTY_FORMS_PLUGIN_ID,
      surfaceKey: FIRST_PARTY_FORMS_SURFACE_KEY,
    })).toBe(true);
    expect(getReactCraftSurfaceTarget(tab, tabGroup)).toEqual({
      kind: 'react',
      pluginId: FIRST_PARTY_FORMS_PLUGIN_ID,
      surfaceKey: FIRST_PARTY_FORMS_SURFACE_KEY,
      props: {
        workspaceId: 'workspace-1',
        beadId: 'vkvw-123',
      },
    });
  });
});
