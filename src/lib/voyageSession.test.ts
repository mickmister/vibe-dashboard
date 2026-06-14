import { describe, expect, it } from 'vitest';
import {
  resolveLastDashboardVoyageSessionId,
  resolveDashboardVoyage,
  resolveRequestedVoyageSessionId,
} from './voyageSession';
import type { SavedWorkspaceSession } from '../types';

function session(
  id: string,
  slug = `voyage-${id}`,
): SavedWorkspaceSession {
  const entry = { id: 've_tg_1', tabGroupId: 'tg_1', viewIds: ['tab_1'] };
  return {
    id,
    slug,
    name: '',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    activeVoyageEntryId: entry.id,
    voyageEntries: [entry],
    activeSpaceId: 'space_home',
    activeTabGroupId: 'tg_1',
    activeItemsByVoyageEntryId: { [entry.id]: 'tab_1' },
    visitedTabGroupIds: ['tg_1'],
  };
}

describe('resolveLastDashboardVoyageSessionId', () => {
  it('resolves requested voyage identity without consulting stored defaults', () => {
    const savedSessions = [session('a', 'alpha-a'), session('b', 'beta-b')];

    expect(
      resolveRequestedVoyageSessionId({
        savedSessions,
        requestedVoyageKey: 'beta-b',
      }),
    ).toBe('b');
    expect(
      resolveRequestedVoyageSessionId({
        savedSessions,
        requestedVoyageKey: 'missing',
      }),
    ).toBeUndefined();
  });

  it('resolves readable short-id voyage params without using labels as identity', () => {
    const savedSessions = [
      session('session_current_a_123', 'legacy-alpha-full'),
      session('session_current_b_123', 'legacy-beta-full'),
    ];

    expect(
      resolveRequestedVoyageSessionId({
        savedSessions,
        requestedVoyageKey: 'anything-b_123',
      }),
    ).toBe('session_current_b_123');
    expect(
      resolveRequestedVoyageSessionId({
        savedSessions,
        requestedVoyageKey: 'anything-123',
      }),
    ).toBeUndefined();
  });

  it('reads a stored full dashboard URL only when it names an existing voyage', () => {
    expect(
      resolveLastDashboardVoyageSessionId({
        savedSessions: [session('a', 'alpha-a'), session('b', 'beta-b')],
        storedDashboardUrl: '/dashboard?voyage=beta-b&craft=craft-1-2',
      }),
    ).toBe('b');

    expect(
      resolveLastDashboardVoyageSessionId({
        savedSessions: [session('a', 'alpha-a')],
        storedDashboardUrl: '/dashboard?voyage=missing',
      }),
    ).toBeUndefined();
  });
});

describe('resolveDashboardVoyage', () => {
  it('uses the requested voyage as the live source of truth over cached URLs', () => {
    expect(
      resolveDashboardVoyage({
        savedSessions: [session('a', 'alpha-a'), session('b', 'beta-b')],
        requestedVoyageKey: 'beta-b',
        storedDashboardUrl: '/dashboard?voyage=alpha-a',
      }),
    ).toEqual({ status: 'resolved', sessionId: 'b' });
  });

  it('reports a not-found state for invalid requested voyages instead of falling back to cached URLs', () => {
    expect(
      resolveDashboardVoyage({
        savedSessions: [session('a', 'alpha-a')],
        requestedVoyageKey: 'missing',
        storedDashboardUrl: '/dashboard?voyage=alpha-a',
      }),
    ).toEqual({ status: 'not-found', requestedVoyageKey: 'missing' });
  });

  it('uses the last full dashboard URL only when the voyage param is missing', () => {
    expect(
      resolveDashboardVoyage({
        savedSessions: [session('a', 'alpha-a'), session('b', 'beta-b')],
        storedDashboardUrl: '/dashboard?voyage=beta-b&craft=craft-1-2',
      }),
    ).toEqual({ status: 'missing-param', sessionId: 'b' });
  });

  it('does not let stale decomposed storage choose a missing-param voyage', () => {
    expect(
      resolveDashboardVoyage({
        savedSessions: [session('a', 'alpha-a')],
        storedDashboardUrl: '/dashboard?voyage=missing',
      }),
    ).toEqual({ status: 'missing-param', sessionId: undefined });
  });
});
