import { describe, expect, it } from 'vitest';
import {
  createSavedWorkspaceSessionState,
  getSavedWorkspaceSessions,
  isSavedWorkspaceSessionStateMigrated,
  migrateSavedWorkspaceSessionState,
} from './savedVoyageState';
import type { SavedWorkspaceSession } from '../types';

function session(id: string): SavedWorkspaceSession {
  return {
    id,
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    activeSpaceId: 'space_home',
    activeTabGroupId: 'tg_1',
    activeItems: { tg_1: 'tab_1' },
    visitedTabGroupIds: ['tg_1'],
  };
}

describe('savedVoyageState migration', () => {
  it('migrates legacy array state to versioned data', () => {
    const legacy = [session('a')];

    expect(migrateSavedWorkspaceSessionState(legacy)).toEqual({
      version: 2,
      data: legacy,
    });
  });

  it('migrates legacy sessions-object state to versioned data', () => {
    const legacy = { sessions: [session('a'), session('b')] };

    expect(migrateSavedWorkspaceSessionState(legacy)).toEqual({
      version: 2,
      data: legacy.sessions,
    });
  });

  it('reads migrated state without changing data', () => {
    const migrated = createSavedWorkspaceSessionState([session('a')]);

    expect(isSavedWorkspaceSessionStateMigrated(migrated)).toBe(true);
    expect(getSavedWorkspaceSessions(migrated)).toEqual([session('a')]);
  });
});
