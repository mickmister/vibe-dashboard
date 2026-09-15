const KEY = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
export type SplitTarget = {
  key: string; craftId: string; kind: string; splitKeys: string[];
  runtime: { kind: 'leaseable'; runtimeId: string; generation: number } | { kind: 'recreatable'; surfaceKey: string; continuity: string } | { kind: 'unsupported'; reason: string };
};

export function parseSplitIntent(search: string): { craftId: string; surfaceKey: string } | null {
  const params = new URLSearchParams(search);
  const keys = [...params.keys()];
  if (keys.length !== 3 || keys.some((key) => !['split', 'withCraft', 'withSurface'].includes(key)) || params.get('split') !== '1') return null;
  const craftId = params.get('withCraft'); const surfaceKey = params.get('withSurface');
  return craftId && surfaceKey && KEY.test(craftId) && KEY.test(surfaceKey) ? { craftId, surfaceKey } : null;
}

export function rankCompatibleTargets(invoking: SplitTarget, candidates: SplitTarget[]): SplitTarget[] {
  return candidates.filter((candidate) => candidate.runtime.kind !== 'unsupported' && candidate.splitKeys.some((key) => invoking.splitKeys.includes(key)))
    .sort((left, right) => Number(right.craftId === invoking.craftId) - Number(left.craftId === invoking.craftId) || left.key.localeCompare(right.key));
}

type Lease = { runtimeId: string; generation: number; host: string; originalHost: string; splitOnly: boolean; valid: boolean };
type Invocation = { key: string; leases: Lease[]; closed: boolean };

export function createSplitRegistry(targets: SplitTarget[]) {
  const definitions = new Map(targets.map((item) => [item.key, item]));
  const leases = new Map<string, Lease>();
  for (const item of targets) if (item.runtime.kind === 'leaseable') leases.set(item.runtime.runtimeId, { runtimeId: item.runtime.runtimeId, generation: item.runtime.generation, host: `voyage-host:${item.key}`, originalHost: `voyage-host:${item.key}`, splitOnly: false, valid: true });
  let invocation: Invocation | undefined; let sequence = 0; let controllerPins = 0; let rollbackCount = 0; let disposeCount = 0; let detachCount = 0;
  const durable = Object.freeze({ layout: 'voyage-layout-A', revision: 7, history: 3, fromJSONCalls: 0, mutationEvents: 0, writes: 0, panelRows: 0, recencyRows: 0 });

  function acquire(target: SplitTarget, index: number): Lease | { reason: string } {
    if (target.runtime.kind === 'unsupported') return { reason: target.runtime.reason };
    if (target.runtime.kind === 'recreatable') {
      const runtimeId = `split:${++sequence}:${target.craftId}:${target.runtime.surfaceKey}`;
      const lease = { runtimeId, generation: 1, host: `split-host:${index}`, originalHost: '', splitOnly: true, valid: true }; leases.set(runtimeId, lease); return lease;
    }
    const lease = leases.get(target.runtime.runtimeId);
    if (!lease || lease.generation !== target.runtime.generation || !lease.valid) return { reason: 'stale-runtime' };
    if (lease.host !== lease.originalHost) return { reason: 'runtime-busy' };
    lease.host = `split-host:${index}`; return lease;
  }

  return {
    seedLease(runtimeId: string, generation: number, host: string) { const lease = leases.get(runtimeId); if (lease && lease.generation === generation) lease.host = host; },
    leaseHost(runtimeId: string) { return leases.get(runtimeId)?.host; },
    enter(firstKey: string, secondKey: string): { ok: true; reusedInvocation?: true } | { ok: false; reason: string } {
      const invocationKey = `${firstKey}\0${secondKey}`;
      if (invocation && !invocation.closed && invocation.key === invocationKey) return { ok: true, reusedInvocation: true };
      if (invocation && !invocation.closed) return { ok: false, reason: 'split-already-active' };
      const first = definitions.get(firstKey); const second = definitions.get(secondKey);
      if (!first || !second) return { ok: false, reason: 'target-unavailable' };
      if (!second.splitKeys.some((key) => first.splitKeys.includes(key))) return { ok: false, reason: 'incompatible-targets' };
      const acquired: Lease[] = [];
      for (const [index, target] of [first, second].entries()) {
        const result = acquire(target, index);
        if ('reason' in result) {
          for (const lease of acquired) { if (lease.splitOnly) { leases.delete(lease.runtimeId); disposeCount += 1; } else lease.host = lease.originalHost; }
          rollbackCount += acquired.length > 0 ? 1 : 0; return { ok: false, reason: result.reason };
        }
        acquired.push(result);
      }
      invocation = { key: invocationKey, leases: acquired, closed: false }; controllerPins += 1; return { ok: true };
    },
    replaceHost(runtimeId: string, generation: number) { const lease = leases.get(runtimeId); if (lease) { lease.generation = generation; lease.valid = false; } },
    deletePanel(runtimeId: string) { const lease = leases.get(runtimeId); if (lease) lease.valid = false; },
    invalidateVoyage(craftId: string) { for (const target of definitions.values()) if (target.craftId === craftId && target.runtime.kind === 'leaseable') { const lease = leases.get(target.runtime.runtimeId); if (lease) lease.valid = false; } },
    invalidateTarget(key: string) { const target = definitions.get(key); definitions.delete(key); if (target?.runtime.kind === 'leaseable') { const lease = leases.get(target.runtime.runtimeId); if (lease) lease.valid = false; } },
    exit(_reason: 'visible-back' | 'browser-back' | 'abort'): { returned: boolean; fallbackFocus: boolean } {
      if (!invocation || invocation.closed) return { returned: false, fallbackFocus: true };
      invocation.closed = true; let returned = true;
      for (const lease of invocation.leases) {
        detachCount += 1;
        if (lease.splitOnly) { leases.delete(lease.runtimeId); disposeCount += 1; continue; }
        if (!lease.valid) { leases.delete(lease.runtimeId); disposeCount += 1; returned = false; continue; }
        lease.host = lease.originalHost;
      }
      controllerPins -= 1; return { returned, fallbackFocus: !returned };
    },
    durableObservation: () => durable,
    observation: () => ({ activeLeases: [...leases.values()].filter((lease) => lease.host.startsWith('split-host')).length, physicalPayloads: leases.size, controllerPins, budgetCount: leases.size, transientControllers: invocation && !invocation.closed ? 1 : 0, rollbackCount, disposeCount, detachCount, splitOnlyRuntimeCount: [...leases.values()].filter((lease) => lease.splitOnly).length, panelRows: 0, recencyRows: 0 }),
  };
}
