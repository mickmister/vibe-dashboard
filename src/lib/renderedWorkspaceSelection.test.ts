import { describe, expect, it } from 'vitest';
import { createEffectiveWorkspaceWithCraftSurfaces } from '../modules/plugins/vibe-dashboard/craft-surfaces';
import { getRenderedPairViewIds } from './renderedWorkspaceSelection';
import type { WorkspaceState } from '../types';

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
        baseOrigin: 'https://vd.example.test',
      },
      tabs: [],
      pairs: [],
      order: 0,
    },
  ],
  nextId: 2,
};

describe('rendered workspace selection helpers', () => {
  it('returns generated built-in pair view IDs from the effective workspace', () => {
    const effectiveWorkspace = createEffectiveWorkspaceWithCraftSurfaces({
      workspace: persistedWorkspace,
      craftSurfaces: [],
      origin: 'https://vd.example.test',
    });

    expect(
      getRenderedPairViewIds(effectiveWorkspace, 'craft_workspace', 'agent+code'),
    ).toEqual(['agent', 'code']);
    expect(
      getRenderedPairViewIds(effectiveWorkspace, 'craft_workspace', 'agent+beads'),
    ).toEqual(['agent', 'beads']);
  });

  it('does not pretend generated pairs exist in the raw persisted workspace', () => {
    expect(
      getRenderedPairViewIds(persistedWorkspace, 'craft_workspace', 'agent+code'),
    ).toBeUndefined();
  });
});
