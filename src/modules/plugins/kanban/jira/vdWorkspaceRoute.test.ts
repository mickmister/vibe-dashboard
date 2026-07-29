import { describe, expect, it } from 'vitest';
import type { SavedWorkspaceSession, WorkspaceState } from '../../../../types';
import { buildExistingVdWorkspaceDashboardPath, findSavedVoyageForVdWorkspaceRoute } from './vdWorkspaceRoute';

const workspace: WorkspaceState = {
  spaces: [{ id: 'space_home', name: 'Home', icon: '🏠', isSystem: true, tabGroupIds: ['tg_default', 'tg_existing'] }],
  tabGroups: [
    {
      id: 'tg_default',
      label: 'Default craft',
      tabs: [{ id: 'tab_default', title: 'Default', url: '/default' }],
      pairs: [],
      order: 0,
      createdAt: '2026-07-28T00:00:00Z',
    },
    {
      id: 'tg_existing',
      label: 'Existing workspace',
      workspace: { workspaceId: 'ws-1', workspaceDir: '/work/ws-1' },
      tabs: [],
      pairs: [],
      order: 1,
      createdAt: '2026-07-28T00:00:00Z',
    },
  ],
  nextId: 3,
};

const savedVoyage: SavedWorkspaceSession = {
  id: 'session_1',
  slug: 'existing-session-1',
  name: 'Existing workspace',
  createdAt: '2026-07-28T00:00:00Z',
  updatedAt: '2026-07-28T00:00:00Z',
  activeVoyageEntryId: 'entry_default',
  voyageEntries: [
    { id: 'entry_default', tabGroupId: 'tg_default', viewIds: ['tab_default'] },
    { id: 'entry_workspace', tabGroupId: 'tg_existing', viewIds: ['agent'] },
  ],
  activeSpaceId: 'space_home',
  activeTabGroupId: 'tg_default',
  activeItemsByVoyageEntryId: { entry_default: 'tab_default', entry_workspace: 'agent' },
  visitedTabGroupIds: ['tg_default', 'tg_existing'],
};

describe('VD workspace route helpers', () => {
  it('finds an existing saved voyage for a VK workspace craft to keep links idempotent', () => {
    expect(findSavedVoyageForVdWorkspaceRoute(workspace, [savedVoyage], 'ws-1')).toEqual({
      session: savedVoyage,
      voyageEntryId: 'entry_workspace',
    });
  });

  it('builds an existing-route URL for the matched workspace craft instead of the active/default craft', () => {
    const existing = findSavedVoyageForVdWorkspaceRoute(workspace, [savedVoyage], 'ws-1');
    expect(existing).toBeDefined();

    const path = buildExistingVdWorkspaceDashboardPath({
      workspace,
      savedVoyages: [savedVoyage],
      existing: existing!,
    });

    expect(path).toContain('voyage=existing-workspace-1');
    expect(path).toContain('craft=existing-workspace-existing-workspace');
    expect(path).not.toContain('craft=default-craft');
  });

  it('returns undefined when the workspace route has no existing craft', () => {
    expect(findSavedVoyageForVdWorkspaceRoute(workspace, [savedVoyage], 'ws-missing')).toBeUndefined();
  });
});
