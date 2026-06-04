import { describe, expect, it } from 'vitest';
import {
  resolvePendingVoyageSessionId,
  resolvePreferredVoyageSessionId,
  resolveRequestedVoyageSessionId,
} from './voyageSession';
import type { SavedWorkspaceSession } from '../types';

function session(
  id: string,
  slug = `voyage-${id}`,
): SavedWorkspaceSession {
  return {
    id,
    slug,
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    activeSpaceId: 'space_home',
    activeTabGroupId: 'tg_1',
    activeItems: { tg_1: 'tab_1' },
    visitedTabGroupIds: ['tg_1'],
  };
}

describe('resolvePreferredVoyageSessionId', () => {
  it('resolves unsaved pending voyage slugs back to their generated session id', () => {
    expect(
      resolvePendingVoyageSessionId({
        requestedVoyageKey: 'focused-session_123',
        pendingVoyageSlugSessionIds: {
          'focused-session_123': 'session_123',
        },
      }),
    ).toBe('session_123');

    expect(
      resolvePendingVoyageSessionId({
        requestedVoyageKey: 'missing',
        pendingVoyageSlugSessionIds: {
          'focused-session_123': 'session_123',
        },
      }),
    ).toBeUndefined();
  });

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

  it('prefers an existing voyage slug over stored defaults', () => {
    expect(
      resolvePreferredVoyageSessionId({
        savedSessions: [session('a', 'alpha-a'), session('b', 'beta-b')],
        requestedVoyageKey: 'beta-b',
        storedBrowserSessionId: 'a',
        originDefaultSessionId: 'a',
      }),
    ).toBe('b');
  });

  it('reuses a stale stored browser session id instead of minting replacements', () => {
    expect(
      resolvePreferredVoyageSessionId({
        savedSessions: [session('existing')],
        requestedVoyageKey: 'missing',
        storedBrowserSessionId: 'stale-local-id',
      }),
    ).toBe('stale-local-id');
  });
});
