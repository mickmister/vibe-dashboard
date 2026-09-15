const KEY = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
export type SplitRuntime = { kind: 'leaseable'; runtimeId: string; generation: number } | { kind: 'recreatable'; surfaceKey: string; continuity: string } | { kind: 'unsupported'; reason: string };
export type SplitTarget = { key: string; craftId: string; kind: string; splitKeys: string[]; runtime: SplitRuntime };
export type SplitIntent = { voyageId: string; invokingPanelToken: string; craftId?: string; surfaceKey: string };
export type SplitFixtures = { currentVoyageId: string; voyages: Array<{ id: string; panels: Array<{ token: string; targetKey: string }> }>; crafts: Array<{ id: string; voyageId: string; workspaceId: string }>; surfaces: Array<SplitTarget & { installed: boolean; authorized: boolean }> };
type Failure = { ok: false; reason: string };

export function parseSplitIntent(pathname: string, search = ''): SplitIntent | null {
  const match = /^\/voyages\/([^/]+)\/split\/([^/]+)$/.exec(pathname);
  if (!match || !KEY.test(match[1]!) || !KEY.test(match[2]!)) return null;
  const params = new URLSearchParams(search);
  if ([...params.keys()].some((key) => !['withCraft', 'withSurface'].includes(key))) return null;
  const craftId = params.get('withCraft') ?? undefined; const surfaceKey = params.get('withSurface');
  return surfaceKey && KEY.test(surfaceKey) && (!craftId || KEY.test(craftId)) ? { voyageId: match[1]!, invokingPanelToken: match[2]!, ...(craftId ? { craftId } : {}), surfaceKey } : null;
}
export function resolveSplitIntent(pathname: string, search: string, fixtures: SplitFixtures) {
  const intent = parseSplitIntent(pathname, search); if (!intent) return { ok: false, reason: 'invalid-route' } as const;
  if (intent.voyageId !== fixtures.currentVoyageId) return { ok: false, reason: 'stale-voyage' } as const;
  const voyage = fixtures.voyages.find((item) => item.id === intent.voyageId); if (!voyage) return { ok: false, reason: 'voyage-unavailable' } as const;
  const panel = voyage.panels.find((item) => item.token === intent.invokingPanelToken); if (!panel) return { ok: false, reason: 'invoking-panel-unavailable' } as const;
  if (intent.craftId && !fixtures.crafts.some((craft) => craft.id === intent.craftId && craft.voyageId === voyage.id)) return { ok: false, reason: 'craft-unavailable' } as const;
  const invoking = fixtures.surfaces.find((item) => item.key === panel.targetKey && item.installed);
  const selected = fixtures.surfaces.find((item) => item.key === intent.surfaceKey && item.installed && (!intent.craftId || item.craftId === intent.craftId));
  if (!invoking || !selected) return { ok: false, reason: 'surface-unavailable' } as const;
  if (!invoking.authorized || !selected.authorized) return { ok: false, reason: 'surface-unauthorized' } as const;
  if (invoking.runtime.kind === 'unsupported') return { ok: false, reason: invoking.runtime.reason } as const;
  if (selected.runtime.kind === 'unsupported') return { ok: false, reason: selected.runtime.reason } as const;
  if (!selected.splitKeys.some((key) => invoking.splitKeys.includes(key))) return { ok: false, reason: 'incompatible-targets' } as const;
  return { ok: true, intent, invoking, selected } as const;
}
export function rankCompatibleTargets(invoking: SplitTarget, candidates: SplitTarget[]) { return candidates.filter((candidate) => candidate.runtime.kind !== 'unsupported' && candidate.splitKeys.some((key) => invoking.splitKeys.includes(key))).sort((a, b) => Number(b.craftId === invoking.craftId) - Number(a.craftId === invoking.craftId) || a.key.localeCompare(b.key)); }

type Lease = { runtimeId: string; generation: number; host: string; originalHost: string; splitOnly: boolean; valid: boolean };
type State = { phase: 'inactive' } | { phase: 'entering' | 'active' | 'exiting'; token: number; key: string; leases: Lease[] };
export function createSplitRegistry(targets: SplitTarget[]) {
  const definitions = new Map(targets.map((item) => [item.key, item])); const leases = new Map<string, Lease>();
  for (const item of targets) if (item.runtime.kind === 'leaseable') leases.set(item.runtime.runtimeId, { runtimeId: item.runtime.runtimeId, generation: item.runtime.generation, host: `voyage-host:${item.key}`, originalHost: `voyage-host:${item.key}`, splitOnly: false, valid: true });
  let state: State = { phase: 'inactive' }; let tokens = 0; let splitSequence = 0; let pins = 0; let rollbackCount = 0; let disposeCount = 0; let detachCount = 0; const events: string[] = [];
  const durable = Object.freeze({ layout: 'voyage-layout-A', revision: 7, history: 3, fromJSONCalls: 0, mutationEvents: 0, writes: 0, panelRows: 0, recencyRows: 0 });
  const finish = (returned: boolean) => { pins -= 1; events.push('unpin'); state = { phase: 'inactive' }; return { returned, fallbackFocus: !returned }; };
  const exit = (_reason: 'visible-back' | 'browser-back' | 'abort' | 'invalidation') => {
    if (state.phase === 'inactive' || state.phase === 'exiting') return { returned: false, fallbackFocus: true };
    if (state.phase === 'entering') return finish(false);
    const active = state; state = { ...active, phase: 'exiting' }; events.push(`exiting:${active.token}`); let returned = true;
    for (const lease of [...active.leases].reverse()) { detachCount++; events.push(`detach:${lease.runtimeId}`); if (lease.splitOnly || !lease.valid) { leases.delete(lease.runtimeId); disposeCount++; events.push(`dispose:${lease.runtimeId}`); if (!lease.splitOnly) returned = false; } else { lease.host = lease.originalHost; events.push(`return:${lease.runtimeId}`); } }
    return finish(returned);
  };
  const invalidate = (predicate: (target: SplitTarget) => boolean) => {
    const affected = [...definitions.values()].filter(predicate);
    const affectedRuntimeIds = affected.flatMap((target) => target.runtime.kind === 'leaseable' ? [target.runtime.runtimeId] : []);
    for (const runtimeId of affectedRuntimeIds) { const lease = leases.get(runtimeId); if (lease) lease.valid = false; }
    const activeRuntimeIds = state.phase === 'inactive' ? [] : state.leases.map((lease) => lease.runtimeId);
    if (affectedRuntimeIds.some((runtimeId) => activeRuntimeIds.includes(runtimeId))) exit('invalidation');
  };
  const api = {
    seedLease(runtimeId: string, generation: number, host: string) { const lease = leases.get(runtimeId); if (lease?.generation === generation) lease.host = host; }, leaseHost(runtimeId: string) { return leases.get(runtimeId)?.host; },
    beginEnter(firstKey: string, secondKey: string) { if (state.phase !== 'inactive') return { ok: false as const, reason: 'split-busy' }; const token = ++tokens; pins++; events.push('pin', `entering:${token}`); state = { phase: 'entering', token, key: `${firstKey}\0${secondKey}`, leases: [] }; return { ok: true as const, token }; },
    completeEnter(token: number, firstKey: string, secondKey: string) {
      if (state.phase !== 'entering' || state.token !== token) return { ok: false as const, reason: 'stale-transition' }; const first = definitions.get(firstKey); const second = definitions.get(secondKey);
      if (!first || !second) { exit('abort'); return { ok: false as const, reason: 'target-unavailable' }; } if (!second.splitKeys.some((key) => first.splitKeys.includes(key))) { exit('abort'); return { ok: false as const, reason: 'incompatible-targets' }; }
      const identity = (item: SplitTarget) => item.runtime.kind === 'leaseable' ? item.runtime.runtimeId : `split:${item.key}`; const ordered = [first, second].sort((a, b) => identity(a).localeCompare(identity(b))); const acquired: Lease[] = [];
      for (const [index, item] of ordered.entries()) { let result: Lease | Failure; if (item.runtime.kind === 'unsupported') result = { ok: false, reason: item.runtime.reason }; else if (item.runtime.kind === 'recreatable') { const runtimeId = `split:${++splitSequence}:${item.craftId}:${item.runtime.surfaceKey}`; result = { runtimeId, generation: 1, host: `split-host:${index}`, originalHost: '', splitOnly: true, valid: true }; leases.set(runtimeId, result); events.push(`acquire:${runtimeId}`); } else { const lease = leases.get(item.runtime.runtimeId); result = !lease || lease.generation !== item.runtime.generation || !lease.valid ? { ok: false, reason: 'stale-runtime' } : lease.host !== lease.originalHost ? { ok: false, reason: 'runtime-busy' } : lease; if (!('ok' in result)) { result.host = `split-host:${index}`; events.push(`acquire:${result.runtimeId}`); } }
        if ('ok' in result) { for (const lease of [...acquired].reverse()) { events.push(`rollback:${lease.runtimeId}`); if (lease.splitOnly) leases.delete(lease.runtimeId); else lease.host = lease.originalHost; } rollbackCount += acquired.length ? 1 : 0; exit('abort'); return result; } acquired.push(result); }
      state = { phase: 'active', token, key: state.key, leases: acquired }; events.push(`active:${token}`); return { ok: true as const };
    },
    enter(firstKey: string, secondKey: string) { if (state.phase === 'active' && state.key === `${firstKey}\0${secondKey}`) return { ok: true as const, reusedInvocation: true as const }; const started = api.beginEnter(firstKey, secondKey); return started.ok ? api.completeEnter(started.token, firstKey, secondKey) : started; },
    replaceHost(runtimeId: string, generation: number) { const lease = leases.get(runtimeId); if (lease) { lease.generation = generation; lease.valid = false; } if (state.phase !== 'inactive' && state.leases.some((item) => item.runtimeId === runtimeId)) exit('invalidation'); }, deletePanel(runtimeId: string) { const lease = leases.get(runtimeId); if (lease) lease.valid = false; if (state.phase !== 'inactive' && state.leases.some((item) => item.runtimeId === runtimeId)) exit('invalidation'); },
    invalidateVoyage(craftId: string) { invalidate((target) => target.craftId === craftId); }, invalidateTarget(key: string) { invalidate((target) => target.key === key); definitions.delete(key); }, exit,
    durableObservation: () => durable, observation: () => ({ phase: state.phase, transitionToken: state.phase === 'inactive' ? null : state.token, events: [...events], activeLeases: [...leases.values()].filter((lease) => lease.host.startsWith('split-host')).length, physicalPayloads: leases.size, controllerPins: pins, budgetCount: leases.size, transientControllers: state.phase === 'active' ? 1 : 0, rollbackCount, disposeCount, detachCount, splitOnlyRuntimeCount: [...leases.values()].filter((lease) => lease.splitOnly).length, panelRows: 0, recencyRows: 0 }),
  }; return api;
}
