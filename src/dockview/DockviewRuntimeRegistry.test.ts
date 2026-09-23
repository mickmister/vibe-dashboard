import { describe, expect, it } from 'vitest';
import {
  createWarmVoyageControllerCache,
  DockviewRuntimeRegistry,
  type RuntimeHostToken,
} from './DockviewRuntimeRegistry';

function runtime(registry: DockviewRuntimeRegistry, runtimeId: string, visibility: 'visible' | 'inactive' = 'inactive') {
  return registry.registerRuntime({
    runtimeId,
    voyageId: runtimeId.split(':')[0] ?? 'voyage',
    panelId: runtimeId.split(':')[1] ?? runtimeId,
    url: `https://example.test/${runtimeId}`,
    visibility,
  });
}

function host(runtimeId: string, generation = 1): RuntimeHostToken {
  const [voyageId = 'voyage', panelId = runtimeId] = runtimeId.split(':');
  return { voyageId, panelId, hostId: `host-${runtimeId}`, generation };
}

describe('DockView M3.4 runtime registry', () => {
  it('TEST_CASE_M3_4A enforces one global iframe budget while protecting visible runtimes', () => {
    const registry = new DockviewRuntimeRegistry(2);
    runtime(registry, 'voyage-a:panel-a', 'visible');
    runtime(registry, 'voyage-a:panel-b', 'inactive');
    runtime(registry, 'voyage-b:panel-c', 'inactive');
    expect(registry.status()).toMatchObject({
      runtimeCount: 2,
      visibleRuntimeIds: ['voyage-a:panel-a'],
      evictedRuntimeIds: ['voyage-a:panel-b'],
      overBudget: false,
    });

    registry.setIframeLimit(0);
    expect(registry.status()).toMatchObject({
      runtimeCount: 1,
      visibleRuntimeIds: ['voyage-a:panel-a'],
      overBudget: true,
    });
    registry.disposeRuntime('voyage-a:panel-a');
    registry.disposeRuntime('voyage-a:panel-a');
    expect(registry.status().runtimeCount).toBe(0);
  });

  it('TEST_CASE_M3_4B evicts warm Voyage controllers by LRU after flushing and honors pins', async () => {
    const disposed: string[] = [];
    const flushed: string[] = [];
    const cache = createWarmVoyageControllerCache({
      warmLimit: 2,
      create: (voyageId: string) => ({
        voyageId,
        flush: async () => { flushed.push(voyageId); },
        dispose: () => { disposed.push(voyageId); },
      }),
    });

    await cache.get('voyage-a');
    const pin = cache.pin('voyage-a');
    await cache.get('voyage-b');
    await cache.get('voyage-c');
    expect(cache.ids()).toEqual(['voyage-a', 'voyage-c']);
    expect(flushed).toEqual(['voyage-b']);
    await pin.release();
    expect(cache.ids()).toEqual(['voyage-a', 'voyage-c']);
    expect(disposed).toEqual(['voyage-b']);
  });

  it('TEST_CASE_M3_4C preserves retained runtime identity and discloses evicted reloads', () => {
    const registry = new DockviewRuntimeRegistry(2);
    const retained = runtime(registry, 'voyage-a:panel-a', 'inactive').bootId;
    runtime(registry, 'voyage-a:panel-b', 'inactive');
    registry.setVisibility('voyage-a:panel-a', 'inactive');
    runtime(registry, 'voyage-a:panel-c', 'inactive');
    expect(registry.status().bootIds['voyage-a:panel-a']).toBe(retained);
    expect(registry.status().reloadDisclosures['voyage-a:panel-b']).toBe('Runtime reloaded after eviction');

    const recreated = runtime(registry, 'voyage-a:panel-b', 'visible').bootId;
    expect(recreated).not.toBe(retained);
    expect(registry.status().visibleRuntimeIds).toContain('voyage-a:panel-b');
  });

  it('TEST_CASE_M3_4D uses exclusive generation-checked leases and rolls back ordered acquisition', () => {
    const registry = new DockviewRuntimeRegistry(5);
    runtime(registry, 'voyage-a:panel-b');
    runtime(registry, 'voyage-a:panel-a');
    const hostA = registry.registerHost(host('voyage-a:panel-a'));
    const hostB = registry.registerHost(host('voyage-a:panel-b'));

    const lease = registry.acquireLeases(['voyage-a:panel-b', 'voyage-a:panel-a']);
    expect(lease.runtimeIds).toEqual(['voyage-a:panel-a', 'voyage-a:panel-b']);
    lease.attach('voyage-a:panel-a', hostA);
    lease.attach('voyage-a:panel-b', hostB);
    expect(() => registry.acquireLeases(['voyage-a:panel-a'])).toThrow('runtime-leased');
    expect(() => lease.attach('voyage-a:panel-a', { ...hostA, generation: 2 })).toThrow('stale-host-generation');
    lease.release();
    lease.release();
    expect(registry.status().leases).toEqual([]);
  });

  it('TEST_CASE_M3_4E pins invoking controllers and treats leased foreground runtimes as visible budget work', async () => {
    const registry = new DockviewRuntimeRegistry(2);
    runtime(registry, 'voyage-a:panel-a', 'inactive');
    runtime(registry, 'voyage-b:panel-b', 'inactive');
    const token = registry.registerHost(host('voyage-a:panel-a'));
    const lease = registry.acquireLeases(['voyage-a:panel-a']);
    registry.setVisibility('voyage-a:panel-a', 'visible');
    lease.attach('voyage-a:panel-a', token);
    registry.setIframeLimit(1);
    expect(registry.status()).toMatchObject({
      runtimeCount: 1,
      visibleRuntimeIds: ['voyage-a:panel-a'],
      evictedRuntimeIds: ['voyage-b:panel-b'],
    });

    const cache = createWarmVoyageControllerCache({
      warmLimit: 1,
      create: (voyageId: string) => ({ voyageId }),
    });
    await cache.get('voyage-a');
    const pin = cache.pin('voyage-a');
    await cache.get('voyage-b');
    expect(cache.ids()).toEqual(['voyage-a']);
    lease.release();
    await pin.release();
    expect(cache.ids()).toEqual(['voyage-a']);
  });
});
