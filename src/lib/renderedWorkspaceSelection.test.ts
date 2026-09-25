/* eslint-disable formatjs/no-literal-string-in-object -- Tests assert stable registry fixture metadata, not rendered copy. */
import { describe, expect, it } from 'vitest';
import {
  createEffectiveWorkspaceWithCraftSurfaces,
  FIRST_PARTY_AGENT_PLUGIN_ID,
  FIRST_PARTY_AGENT_SURFACE_KEY,
  FIRST_PARTY_CODE_PLUGIN_ID,
  FIRST_PARTY_CODE_SURFACE_KEY,
  FIRST_PARTY_FORMS_PLUGIN_ID,
  FIRST_PARTY_FORMS_SURFACE_KEY,
} from '../modules/plugins/vibe-dashboard/craft-surfaces';
import { getRenderedPairViewIds } from './renderedWorkspaceSelection';
import type { WorkspaceState } from '../types';
import type { RegisteredCraftSurfaceContribution } from '../modules/plugins/vibe-dashboard/types';

const persistedWorkspace: WorkspaceState = {
  spaces: [
    {
      id: 'space_home',
      name: 'Home',
      icon: 'home',
      tabGroupIds: ['craft_workspace'],
    },
  ],
  tabGroups: [
    {
      id: 'craft_workspace',
      label: 'Workspace Craft',
      workspace: {
        workspaceId: 'workspace_1',
        workspaceDir: '/home/vkuser/repos/app',
      },
      tabs: [],
      pairs: [],
      order: 0,
    },
  ],
  nextId: 2,
};

const firstPartySurfaces: RegisteredCraftSurfaceContribution[] = [
  {
    pluginId: FIRST_PARTY_AGENT_PLUGIN_ID,
    sourceKey: 'agent',
    key: FIRST_PARTY_AGENT_SURFACE_KEY,
    title: 'Agent',
    defaultTitle: 'Agent',
    urlTemplate: '{{origin}}/workspaces/{{workspaceId}}',
    order: 10,
  },
  {
    pluginId: FIRST_PARTY_CODE_PLUGIN_ID,
    sourceKey: 'code',
    key: FIRST_PARTY_CODE_SURFACE_KEY,
    title: 'Code',
    defaultTitle: 'Code',
    urlTemplate: '{{origin}}/?folder={{containerRef}}',
    order: 20,
  },
  {
    pluginId: FIRST_PARTY_FORMS_PLUGIN_ID,
    sourceKey: 'forms',
    key: FIRST_PARTY_FORMS_SURFACE_KEY,
    title: 'Forms',
    defaultTitle: 'Forms',
    urlTemplate: 'internal://forms',
    order: 40,
  },
];

describe('rendered workspace selection helpers', () => {
  it('returns registry-authoritative generated pair view IDs from the effective workspace', () => {
    const effectiveWorkspace = createEffectiveWorkspaceWithCraftSurfaces({
      workspace: persistedWorkspace,
      craftSurfaces: firstPartySurfaces,
      origin: 'https://vd.example.test',
    });

    expect(
      getRenderedPairViewIds(effectiveWorkspace, 'craft_workspace', 'agent+code'),
    ).toEqual(['agent', 'code']);
  });

  it('does not synthesize Agent/Code pairs without registered first-party surfaces', () => {
    const effectiveWorkspace = createEffectiveWorkspaceWithCraftSurfaces({
      workspace: persistedWorkspace,
      craftSurfaces: [],
      origin: 'https://vd.example.test',
    });

    expect(
      getRenderedPairViewIds(effectiveWorkspace, 'craft_workspace', 'agent+code'),
    ).toBeUndefined();
  });

  it('does not pretend generated pairs exist in the raw persisted workspace', () => {
    expect(
      getRenderedPairViewIds(persistedWorkspace, 'craft_workspace', 'agent+code'),
    ).toBeUndefined();
  });
});
