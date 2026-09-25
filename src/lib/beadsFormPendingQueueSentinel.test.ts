import { describe, expect, it } from 'vitest';
import {
  initialPendingQueueSentinel,
  shouldRefreshPendingQueueForSentinel,
  touchPendingQueueSentinel,
} from './beadsFormPendingQueueSentinel';

describe('BeadsForm pending queue sentinel', () => {
  it('increments a lightweight version and records scoped dirty keys', () => {
    const sentinel = touchPendingQueueSentinel(
      initialPendingQueueSentinel,
      ['pending:repo-parent'],
      new Date('2026-08-12T00:00:00Z'),
    );

    expect(sentinel).toEqual({
      version: 1,
      updatedAt: '2026-08-12T00:00:00.000Z',
      scopes: { 'pending:repo-parent': 1 },
    });
  });

  it('does not request a fresh refresh on first observation but does after relevant updates', () => {
    const sentinel = touchPendingQueueSentinel(initialPendingQueueSentinel, ['pending:repo-parent']);

    expect(shouldRefreshPendingQueueForSentinel({
      previousVersion: undefined,
      sentinel,
      scopeKey: 'pending:repo-parent',
    })).toBe(false);
    expect(shouldRefreshPendingQueueForSentinel({
      previousVersion: 0,
      sentinel,
      scopeKey: 'pending:repo-parent',
    })).toBe(true);
  });
});
