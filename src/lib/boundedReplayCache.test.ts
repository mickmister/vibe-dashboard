import { describe, expect, it } from 'vitest';
import { BoundedReplayCache } from './boundedReplayCache';

describe('BoundedReplayCache', () => {
  it('returns defensive copies and lazily expires entries', () => {
    let now = 0;
    const cache = new BoundedReplayCache<{ warnings: string[] }>({ maxEntries: 2, ttlMs: 10, now: () => now });
    cache.set('a', { warnings: ['saved'] });
    const first = cache.get('a')!;
    first.warnings.push('mutated');
    expect(cache.get('a')).toEqual({ warnings: ['saved'] });
    now = 11;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('evicts the oldest completed result at the maximum entry bound', () => {
    const cache = new BoundedReplayCache<number>({ maxEntries: 2, ttlMs: 100, now: () => 0 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });
});
