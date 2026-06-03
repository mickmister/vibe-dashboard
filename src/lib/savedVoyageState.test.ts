import { describe, expect, it } from 'vitest';
import {
  createSavedWorkspaceSessionState,
  getSavedWorkspaceSessions,
  isSavedWorkspaceSessionStateMigrated,
  migrateSavedWorkspaceSessionState,
  migrateSavedWorkspaceSessionStateWithCleanup,
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
    const legacy = {
      sessions: [
        session('a'),
        {
          ...session('b'),
          activeTabGroupId: 'tg_2',
          activeItems: { tg_2: 'tab_2' },
          visitedTabGroupIds: ['tg_2'],
        },
      ],
    };

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

  it('removes home voyages by explicit name or active craft label', () => {
    const explicitHome = { ...session('home_name'), name: 'Home' };
    const implicitHome = {
      ...session('home_label'),
      activeTabGroupId: 'tg_home',
    };
    const realVoyage = { ...session('real'), name: 'Real voyage' };

    expect(
      migrateSavedWorkspaceSessionStateWithCleanup(
        [explicitHome, implicitHome, realVoyage],
        {
          workspace: {
            tabGroups: [
              {
                id: 'tg_home',
                label: 'Home',
                tabs: [],
                pairs: [],
                order: 0,
              },
            ],
          },
        },
      ).state,
    ).toEqual({
      version: 2,
      data: [realVoyage],
    });
  });

  it('dedupes duplicate voyages and rewrites origin resume references to the keeper', () => {
    const older = {
      ...session('older'),
      name: 'Pairing',
      updatedAt: '2026-06-01T00:00:00.000Z',
    };
    const newer = {
      ...session('newer'),
      name: 'Pairing',
      updatedAt: '2026-06-02T00:00:00.000Z',
    };
    const other = { ...session('other'), name: 'Other' };

    const result = migrateSavedWorkspaceSessionStateWithCleanup(
      [older, newer, other],
      {
        originResumeState: {
          lastSessionByOrigin: {
            'https://example.test': 'older',
            'https://other.example.test': 'newer',
          },
        },
      },
    );

    expect(result.state).toEqual({
      version: 2,
      data: [newer, other],
    });
    expect(result.originResumeState).toEqual({
      lastSessionByOrigin: {
        'https://example.test': 'newer',
        'https://other.example.test': 'newer',
      },
    });
  });

  it('keeps the origin-referenced duplicate when choosing a dedupe keeper', () => {
    const referenced = {
      ...session('referenced'),
      name: 'Pairing',
      updatedAt: '2026-06-01T00:00:00.000Z',
    };
    const newer = {
      ...session('newer'),
      name: 'Pairing',
      updatedAt: '2026-06-02T00:00:00.000Z',
    };

    const result = migrateSavedWorkspaceSessionStateWithCleanup(
      [referenced, newer],
      {
        originResumeState: {
          lastSessionByOrigin: {
            'https://example.test': 'referenced',
          },
        },
      },
    );

    expect(result.state).toEqual({
      version: 2,
      data: [referenced],
    });
    expect(result.originResumeState).toEqual({
      lastSessionByOrigin: {
        'https://example.test': 'referenced',
      },
    });
  });
});
