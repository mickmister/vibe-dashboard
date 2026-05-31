import { describe, expect, it } from 'vitest';
import { resolvePreferredVoyageSessionId } from './voyageSession';
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

  it('accepts legacy session ids only when they already exist', () => {
    expect(
      resolvePreferredVoyageSessionId({
        savedSessions: [session('existing')],
        requestedLegacySessionId: 'existing',
      }),
    ).toBe('existing');

    expect(
      resolvePreferredVoyageSessionId({
        savedSessions: [session('existing')],
        requestedLegacySessionId: 'unknown-from-url',
      }),
    ).toBeUndefined();
  });

  it('reuses a stale stored browser session id instead of minting replacements', () => {
    expect(
      resolvePreferredVoyageSessionId({
        savedSessions: [session('existing')],
        requestedVoyageKey: 'missing',
        requestedLegacySessionId: 'unknown-from-url',
        storedBrowserSessionId: 'stale-local-id',
      }),
    ).toBe('stale-local-id');
  });
});
