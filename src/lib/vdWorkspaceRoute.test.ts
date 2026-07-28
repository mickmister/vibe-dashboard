import { describe, expect, it } from 'vitest';
import type { SavedWorkspaceSession, WorkspaceState } from '../types';
import { findSavedVoyageForVdWorkspaceRoute } from './vdWorkspaceRoute';

const workspace: WorkspaceState = {
  spaces: [{ id: 'space_home', name: 'Home', icon: '🏠', isSystem: true, tabGroupIds: ['tg_existing'] }],
  tabGroups: [
    {
      id: 'tg_existing',
      label: 'Existing workspace',
      workspace: { workspaceId: 'ws-1', workspaceDir: '/work/ws-1' },
      tabs: [],
      pairs: [],
      order: 0,
      createdAt: '2026-07-28T00:00:00Z',
    },
  ],
  nextId: 2,
};

const savedVoyage: SavedWorkspaceSession = {
  id: 'session_1',
  slug: 'existing-session-1',
  name: 'Existing workspace',
  createdAt: '2026-07-28T00:00:00Z',
  updatedAt: '2026-07-28T00:00:00Z',
  activeVoyageEntryId: 'entry_1',
  voyageEntries: [{ id: 'entry_1', tabGroupId: 'tg_existing', viewIds: ['agent'] }],
  activeSpaceId: 'space_home',
  activeTabGroupId: 'tg_existing',
  activeItemsByVoyageEntryId: { entry_1: 'agent' },
  visitedTabGroupIds: ['tg_existing'],
};

describe('VD workspace route helpers', () => {
  it('finds an existing saved voyage for a VK workspace craft to keep links idempotent', () => {
    expect(findSavedVoyageForVdWorkspaceRoute(workspace, [savedVoyage], 'ws-1')).toEqual({
      session: savedVoyage,
      voyageEntryId: 'entry_1',
    });
  });

  it('returns undefined when the workspace route has no existing craft', () => {
    expect(findSavedVoyageForVdWorkspaceRoute(workspace, [savedVoyage], 'ws-missing')).toBeUndefined();
  });
});
