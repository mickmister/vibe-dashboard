import { describe, expect, it } from 'vitest';
import { createSplitRegistry, parseSplitIntent, rankCompatibleTargets, type SplitTarget } from './splitViewContract';

const target = (overrides: Partial<SplitTarget> = {}): SplitTarget => ({
  key: 'agent', craftId: 'craft-a', kind: 'agent', splitKeys: ['work'], runtime: { kind: 'leaseable', runtimeId: 'agent-runtime', generation: 1 }, ...overrides,
});

describe('Split View target and route contract', () => {
  it('parses only allowlisted untrusted route inputs', () => {
    expect(parseSplitIntent('?split=1&withCraft=craft-a&withSurface=code')).toEqual({ craftId: 'craft-a', surfaceKey: 'code' });
    for (const value of ['?split=0&withCraft=craft-a&withSurface=code', '?split=1&withCraft=../x&withSurface=code', '?split=1&withCraft=a&withSurface=x&url=https://evil.test']) expect(parseSplitIntent(value)).toBeNull();
  });

  it('defaults compatible choices to same Craft without target-kind assumptions', () => {
    const invoking = target();
    const ranked = rankCompatibleTargets(invoking, [
      target({ key: 'form-other', craftId: 'craft-b', kind: 'form', runtime: { kind: 'recreatable', surfaceKey: 'form', continuity: 'fresh' } }),
      target({ key: 'code-same', kind: 'code', runtime: { kind: 'leaseable', runtimeId: 'code', generation: 2 } }),
      target({ key: 'unsupported', runtime: { kind: 'unsupported', reason: 'no-split-renderer' } }),
    ]);
    expect(ranked.map((item) => item.key)).toEqual(['code-same', 'form-other']);
  });
});

describe('exclusive runtime leases', () => {
  it('acquires two runtimes transactionally and rolls the first back when the second fails', () => {
    const registry = createSplitRegistry([target(), target({ key: 'busy', runtime: { kind: 'leaseable', runtimeId: 'busy', generation: 3 } })]);
    registry.seedLease('busy', 3, 'other-host');
    expect(registry.enter('agent', 'busy')).toEqual({ ok: false, reason: 'runtime-busy' });
    expect(registry.observation()).toMatchObject({ activeLeases: 0, controllerPins: 0, transientControllers: 0, rollbackCount: 1 });
    expect(registry.leaseHost('agent-runtime')).toBe('voyage-host:agent');
  });

  it('is generation checked, idempotent, budget-accounted, and preserves durable state', () => {
    const registry = createSplitRegistry([target(), target({ key: 'code', runtime: { kind: 'leaseable', runtimeId: 'code-runtime', generation: 4 } })]);
    const durableBefore = registry.durableObservation();
    expect(registry.enter('agent', 'code')).toMatchObject({ ok: true });
    expect(registry.enter('agent', 'code')).toMatchObject({ ok: true, reusedInvocation: true });
    expect(registry.observation()).toMatchObject({ activeLeases: 2, physicalPayloads: 2, controllerPins: 1, budgetCount: 2, transientControllers: 1 });
    registry.replaceHost('code-runtime', 5);
    expect(registry.exit('visible-back')).toEqual({ returned: false, fallbackFocus: true });
    expect(registry.exit('browser-back')).toEqual({ returned: false, fallbackFocus: true });
    expect(registry.observation()).toMatchObject({ controllerPins: 0, transientControllers: 0, disposeCount: 1, detachCount: 2 });
    expect(registry.durableObservation()).toEqual(durableBefore);
  });

  it('creates and disposes an absent split-only runtime without durable rows', () => {
    const registry = createSplitRegistry([target(), target({ key: 'form', runtime: { kind: 'recreatable', surfaceKey: 'form', continuity: 'fresh form' } })]);
    expect(registry.enter('agent', 'form')).toMatchObject({ ok: true });
    expect(registry.observation()).toMatchObject({ splitOnlyRuntimeCount: 1, panelRows: 0, recencyRows: 0 });
    registry.exit('abort'); registry.exit('abort');
    expect(registry.observation()).toMatchObject({ splitOnlyRuntimeCount: 0, disposeCount: 1, controllerPins: 0 });
  });

  it.each([
    [target(), target({ key: 'cross-form', craftId: 'craft-b', kind: 'form', runtime: { kind: 'recreatable', surfaceKey: 'form', continuity: 'fresh' } })],
    [target({ key: 'form', kind: 'form', runtime: { kind: 'recreatable', surfaceKey: 'form', continuity: 'fresh' } }), target({ key: 'code', kind: 'code', runtime: { kind: 'leaseable', runtimeId: 'code', generation: 1 } })],
    [target({ key: 'plugin', kind: 'plugin', runtime: { kind: 'leaseable', runtimeId: 'plugin', generation: 1 } }), target({ key: 'agent-two', kind: 'agent', runtime: { kind: 'leaseable', runtimeId: 'agent-two', generation: 1 } })],
  ])('permits capability-compatible target-kind and cross-Craft pairs', (first, second) => {
    expect(createSplitRegistry([first, second]).enter(first.key, second.key)).toEqual({ ok: true });
  });

  it('fails closed for unsupported, stale route, deletion, and plugin invalidation', () => {
    const registry = createSplitRegistry([target(), target({ key: 'plugin', kind: 'plugin', runtime: { kind: 'leaseable', runtimeId: 'plugin-runtime', generation: 2 } }), target({ key: 'unsupported', runtime: { kind: 'unsupported', reason: 'no-runtime-host' } })]);
    expect(registry.enter('agent', 'missing')).toEqual({ ok: false, reason: 'target-unavailable' });
    expect(registry.enter('agent', 'unsupported')).toEqual({ ok: false, reason: 'no-runtime-host' });
    registry.enter('agent', 'plugin'); registry.invalidateTarget('plugin');
    expect(registry.exit('browser-back')).toEqual({ returned: false, fallbackFocus: true });
    expect(registry.observation()).toMatchObject({ disposeCount: 1, activeLeases: 0 });
  });

  it('does not resurrect an invoking Panel or Voyage deleted while leased', () => {
    const panelDeleted = createSplitRegistry([target(), target({ key: 'code', runtime: { kind: 'leaseable', runtimeId: 'code', generation: 1 } })]);
    panelDeleted.enter('agent', 'code'); panelDeleted.deletePanel('agent-runtime');
    expect(panelDeleted.exit('visible-back')).toEqual({ returned: false, fallbackFocus: true });
    const voyageDeleted = createSplitRegistry([target(), target({ key: 'code', runtime: { kind: 'leaseable', runtimeId: 'code', generation: 1 } })]);
    voyageDeleted.enter('agent', 'code'); voyageDeleted.invalidateVoyage('craft-a');
    expect(voyageDeleted.exit('browser-back')).toEqual({ returned: false, fallbackFocus: true });
  });
});
