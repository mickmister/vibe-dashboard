import { describe, expect, it, vi } from 'vitest';
import {
  BeadsFormReadCache,
  directBeadFormsCacheKey,
  pendingBeadsFormsCacheKey,
  workspaceBeadFormsCacheKey,
} from './beadsFormReadCache';

describe('BeadsFormReadCache', () => {
  it('returns fresh data on first load and cached data on later loads', async () => {
    let now = Date.parse('2026-07-31T00:00:00Z');
    const cache = new BeadsFormReadCache({ now: () => now, ttlMs: 1_000 });
    const load = vi.fn(async () => ({ value: 'first' }));

    await expect(cache.cachedOrLoad('key', load)).resolves.toEqual({
      value: 'first',
      cache: {
        key: 'key',
        status: 'fresh',
        loadedAt: '2026-07-31T00:00:00.000Z',
        ageMs: 0,
        stale: false,
      },
    });

    now += 1_500;
    await expect(cache.cachedOrLoad('key', async () => ({ value: 'second' }))).resolves.toEqual({
      value: 'first',
      cache: {
        key: 'key',
        status: 'cached',
        loadedAt: '2026-07-31T00:00:00.000Z',
        ageMs: 1_500,
        stale: true,
      },
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('refreshes cached data and deduplicates concurrent refreshes', async () => {
    let now = Date.parse('2026-07-31T00:00:00Z');
    const cache = new BeadsFormReadCache({ now: () => now });
    await cache.cachedOrLoad('key', async () => ({ value: 'old' }));

    now += 100;
    const load = vi.fn(async () => ({ value: 'new' }));
    const [left, right] = await Promise.all([
      cache.refresh('key', load),
      cache.refresh('key', load),
    ]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(left.value).toBe('new');
    expect(right.value).toBe('new');
    expect(left.cache.status).toBe('fresh');
    await expect(cache.cachedOrLoad('key', async () => ({ value: 'unused' }))).resolves.toMatchObject({
      value: 'new',
      cache: { status: 'cached' },
    });
  });

  it('allows preloading a cached value with an older loaded timestamp', () => {
    let now = Date.parse('2026-07-31T00:01:00Z');
    const cache = new BeadsFormReadCache({ now: () => now, ttlMs: 30_000 });
    const loadedAtMs = Date.parse('2026-07-31T00:00:00Z');

    expect(cache.set('key', { value: 'disk' }, loadedAtMs)).toEqual({
      value: 'disk',
      cache: {
        key: 'key',
        status: 'cached',
        loadedAt: '2026-07-31T00:00:00.000Z',
        ageMs: 60_000,
        stale: true,
      },
    });
    expect(cache.get<{ value: string }>('key')?.value).toBe('disk');
  });

  it('invalidates and bounds cached entries', async () => {
    const cache = new BeadsFormReadCache({ maxEntries: 1 });
    await cache.cachedOrLoad('a', async () => ({ value: 'a' }));
    await cache.cachedOrLoad('b', async () => ({ value: 'b' }));
    expect(cache.size()).toBe(1);

    const loadA = vi.fn(async () => ({ value: 'a2' }));
    await expect(cache.cachedOrLoad('a', loadA)).resolves.toMatchObject({ value: 'a2', cache: { status: 'fresh' } });
    expect(loadA).toHaveBeenCalledTimes(1);

    cache.invalidate('a');
    await expect(cache.cachedOrLoad('a', loadA)).resolves.toMatchObject({ value: 'a2', cache: { status: 'fresh' } });
    expect(loadA).toHaveBeenCalledTimes(2);
  });

  it('keys direct, workspace, and pending reads by their safe route inputs', () => {
    expect(directBeadFormsCacheKey({ dir: '/repo', beadId: 'bd-1', formId: 'review' })).toBe(
      'direct:{"dir":"/repo","beadId":"bd-1","formId":"review"}',
    );
    expect(workspaceBeadFormsCacheKey({ workspaceId: 'ws', beadId: 'bd-1', includeOtherWorkspaces: true })).toBe(
      'workspace:{"workspaceId":"ws","beadId":"bd-1","formId":"","includeOtherWorkspaces":true}',
    );
    expect(pendingBeadsFormsCacheKey({ reposRoot: '/repos', repoLimit: 20 })).toBe(
      'pending:{"reposRoot":"/repos","repoLimit":20}',
    );
  });
});
