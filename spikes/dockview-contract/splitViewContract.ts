import {
  findCompatibleSplitTargets,
  resolvePanelTarget,
  type PanelTarget,
  type ResolvedPanelTarget,
  type TrustedTargetRegistry,
} from './targetRegistry';

const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export type SplitIntent = {
  voyageToken: string;
  invokingPanelToken: string;
  craftToken?: string;
  surfaceKey: string;
};

export type RuntimeFixture = {
  targetIdentity: string;
  runtimeId: string;
  generation: number;
  hostId: string;
  pluginId?: string;
};

export type SplitFixtures = {
  currentVoyageToken: string;
  panels: Array<{
    token: string;
    voyageToken: string;
    craftId: string;
    target: PanelTarget;
  }>;
  voyageCraftIds: string[];
  candidates: Array<{ craftId: string; surfaceKey: string; target: PanelTarget }>;
  targetRegistry: TrustedTargetRegistry;
  runtimes: RuntimeFixture[];
};

export type AcquirableTarget = {
  targetIdentity: string;
  craftId: string;
  resolved: ResolvedPanelTarget;
  runtime:
    | { kind: 'leaseable'; runtimeId: string; generation: number; hostId: string }
    | { kind: 'recreatable'; continuity: string }
    | { kind: 'unsupported'; reason: string };
  pluginId?: string;
};

export function parseSplitIntent(search: string): SplitIntent | null {
  const params = new URLSearchParams(search);
  const allowed = new Set(['voyage', 'split', 'withCraft', 'withSurface']);
  if ([...params.keys()].some((key) => !allowed.has(key))) return null;
  if ([...allowed].some((key) => params.getAll(key).length > 1)) return null;
  const voyageToken = params.get('voyage');
  const invokingPanelToken = params.get('split');
  const craftToken = params.get('withCraft') || undefined;
  const surfaceKey = params.get('withSurface');
  if (!voyageToken || !invokingPanelToken || !surfaceKey) return null;
  if (![voyageToken, invokingPanelToken, surfaceKey, ...(craftToken ? [craftToken] : [])].every((value) => TOKEN.test(value))) return null;
  return { voyageToken, invokingPanelToken, ...(craftToken ? { craftToken } : {}), surfaceKey };
}

function identity(craftId: string, resolved: ResolvedPanelTarget): string {
  return `${craftId}\0${resolved.equivalenceKey}`;
}

function acquirable(craftId: string, resolved: ResolvedPanelTarget, fixtures: SplitFixtures): AcquirableTarget {
  const targetIdentity = identity(craftId, resolved);
  const runtime = fixtures.runtimes.find((item) => item.targetIdentity === targetIdentity);
  const pluginId = resolved.target.kind === 'plugin-surface' || resolved.target.kind === 'plugin-internal-route' ? resolved.target.pluginId : undefined;
  if (resolved.runtime.kind === 'unsupported') return { targetIdentity, craftId, resolved, runtime: { kind: 'unsupported', reason: resolved.runtime.reason } };
  if (resolved.runtime.kind === 'recreatable-transient-runtime') return { targetIdentity, craftId, resolved, runtime: { kind: 'recreatable', continuity: resolved.runtime.continuity }, ...(pluginId ? { pluginId } : {}) };
  if (!runtime) return { targetIdentity, craftId, resolved, runtime: { kind: 'unsupported', reason: 'runtime-unavailable' } };
  return { targetIdentity, craftId, resolved, runtime: { kind: 'leaseable', runtimeId: runtime.runtimeId, generation: runtime.generation, hostId: runtime.hostId }, ...(runtime.pluginId ? { pluginId: runtime.pluginId } : {}) };
}

export function resolveSplitIntent(search: string, fixtures: SplitFixtures):
  | { ok: true; intent: SplitIntent; invoking: AcquirableTarget; selected: AcquirableTarget }
  | { ok: false; reason: string } {
  const intent = parseSplitIntent(search);
  if (!intent) return { ok: false, reason: 'invalid-route' };
  if (intent.voyageToken !== fixtures.currentVoyageToken) return { ok: false, reason: 'stale-voyage' };
  const panel = fixtures.panels.find((item) => item.token === intent.invokingPanelToken && item.voyageToken === intent.voyageToken);
  if (!panel) return { ok: false, reason: 'invoking-panel-unavailable' };
  if (!fixtures.voyageCraftIds.includes(panel.craftId)) return { ok: false, reason: 'invoking-craft-unavailable' };
  const invoking = resolvePanelTarget(panel.target, { craftId: panel.craftId }, fixtures.targetRegistry);
  if (!invoking.ok) return { ok: false, reason: invoking.reason };
  const selectedCraftId = intent.craftToken ?? panel.craftId;
  if (!fixtures.voyageCraftIds.includes(selectedCraftId)) return { ok: false, reason: 'craft-unavailable' };
  const candidate = fixtures.candidates.find((item) => item.craftId === selectedCraftId && item.surfaceKey === intent.surfaceKey);
  if (!candidate) return { ok: false, reason: 'surface-unavailable' };
  const compatible = findCompatibleSplitTargets(invoking, panel.craftId, [candidate], fixtures.targetRegistry)[0];
  if (!compatible) return { ok: false, reason: 'surface-unauthorized-or-incompatible' };
  const invokingTarget = acquirable(panel.craftId, invoking, fixtures);
  const selectedTarget = acquirable(compatible.craftId, compatible.resolved, fixtures);
  if (invokingTarget.runtime.kind === 'unsupported') return { ok: false, reason: invokingTarget.runtime.reason };
  if (selectedTarget.runtime.kind === 'unsupported') return { ok: false, reason: selectedTarget.runtime.reason };
  return { ok: true, intent, invoking: invokingTarget, selected: selectedTarget };
}

type Lease = {
  targetIdentity: string;
  pluginId?: string;
  runtimeId: string;
  generation: number;
  host: string;
  originalHost: string;
  disposalOwner: 'registry' | 'split-invocation';
  valid: boolean;
  disposed: boolean;
};
type State = { phase: 'inactive' } | { phase: 'entering' | 'active' | 'exiting'; token: number; key: string; leases: Lease[] };

export function createSplitRegistry(targets: AcquirableTarget[]) {
  const definitions = new Map(targets.map((target) => [target.targetIdentity, target]));
  const leases = new Map<string, Lease>();
  for (const target of targets) if (target.runtime.kind === 'leaseable') leases.set(target.runtime.runtimeId, { targetIdentity: target.targetIdentity, ...(target.pluginId ? { pluginId: target.pluginId } : {}), runtimeId: target.runtime.runtimeId, generation: target.runtime.generation, host: target.runtime.hostId, originalHost: target.runtime.hostId, disposalOwner: 'registry', valid: true, disposed: false });
  let state: State = { phase: 'inactive' };
  let transitionSequence = 0; let splitSequence = 0; let pins = 0; let rollbackCount = 0; let disposeCount = 0;
  const events: string[] = [];

  function dispose(lease: Lease) { if (lease.disposed) return; lease.disposed = true; leases.delete(lease.runtimeId); disposeCount += 1; events.push(`dispose:${lease.runtimeId}`); }
  function finish(returned: boolean) { pins -= 1; events.push('unpin'); state = { phase: 'inactive' }; return { returned, fallbackFocus: !returned }; }
  function exit(_reason: 'visible-back' | 'browser-back' | 'abort' | 'invalidation') {
    if (state.phase === 'inactive' || state.phase === 'exiting') return { returned: false, fallbackFocus: true };
    if (state.phase === 'entering') return finish(false);
    const active = state; state = { ...active, phase: 'exiting' }; events.push(`exiting:${active.token}`); let returned = true;
    for (const lease of [...active.leases].reverse()) { events.push(`detach:${lease.runtimeId}`); if (lease.disposalOwner === 'split-invocation' || !lease.valid) { dispose(lease); if (lease.disposalOwner === 'registry') returned = false; } else { lease.host = lease.originalHost; events.push(`return:${lease.runtimeId}`); } }
    return finish(returned);
  }
  function invalidate(predicate: (lease: Lease) => boolean) { const affected = [...leases.values()].filter(predicate); for (const lease of affected) lease.valid = false; if (state.phase !== 'inactive' && state.leases.some((lease) => affected.includes(lease))) exit('invalidation'); }
  const api = {
    seedLease(runtimeId: string, host: string) { const lease = leases.get(runtimeId); if (lease) lease.host = host; },
    beginEnter(firstIdentity: string, secondIdentity: string) { if (state.phase !== 'inactive') return { ok: false as const, reason: 'split-busy' }; const token = ++transitionSequence; pins += 1; events.push('pin', `entering:${token}`); state = { phase: 'entering', token, key: `${firstIdentity}\0${secondIdentity}`, leases: [] }; return { ok: true as const, token }; },
    completeEnter(token: number, firstIdentity: string, secondIdentity: string) {
      if (state.phase !== 'entering' || state.token !== token) return { ok: false as const, reason: 'stale-transition' };
      const selected = [definitions.get(firstIdentity), definitions.get(secondIdentity)];
      if (selected.some((item) => !item)) { exit('abort'); return { ok: false as const, reason: 'target-unavailable' }; }
      const ordered = (selected as AcquirableTarget[]).sort((a, b) => {
        const left = a.runtime.kind === 'leaseable' ? a.runtime.runtimeId : `split:${a.targetIdentity}`;
        const right = b.runtime.kind === 'leaseable' ? b.runtime.runtimeId : `split:${b.targetIdentity}`;
        return left.localeCompare(right);
      });
      const acquired: Lease[] = [];
      for (const [index, target] of ordered.entries()) {
        let lease: Lease | undefined;
        if (target.runtime.kind === 'leaseable') { const current = leases.get(target.runtime.runtimeId); if (current?.valid && current.generation === target.runtime.generation && current.host === current.originalHost) lease = current; }
        if (target.runtime.kind === 'recreatable') { const runtimeId = `split:${++splitSequence}:${target.targetIdentity}`; lease = { targetIdentity: target.targetIdentity, ...(target.pluginId ? { pluginId: target.pluginId } : {}), runtimeId, generation: 1, host: `split-host:${index}`, originalHost: '', disposalOwner: 'split-invocation', valid: true, disposed: false }; leases.set(runtimeId, lease); }
        if (!lease) { for (const item of [...acquired].reverse()) { events.push(`rollback:${item.runtimeId}`); if (item.disposalOwner === 'split-invocation') dispose(item); else item.host = item.originalHost; } rollbackCount += acquired.length ? 1 : 0; exit('abort'); return { ok: false as const, reason: 'runtime-unavailable-or-busy' }; }
        lease.host = `split-host:${index}`; acquired.push(lease); events.push(`acquire:${lease.runtimeId}`);
      }
      state = { phase: 'active', token, key: state.key, leases: acquired }; events.push(`active:${token}`); return { ok: true as const };
    },
    enter(firstIdentity: string, secondIdentity: string) { if (state.phase === 'active' && state.key === `${firstIdentity}\0${secondIdentity}`) return { ok: true as const, reusedInvocation: true as const }; const started = api.beginEnter(firstIdentity, secondIdentity); return started.ok ? api.completeEnter(started.token, firstIdentity, secondIdentity) : started; },
    exit,
    invalidateTarget(targetIdentity: string) { invalidate((lease) => lease.targetIdentity === targetIdentity); definitions.delete(targetIdentity); },
    invalidatePlugin(pluginId: string) { invalidate((lease) => lease.pluginId === pluginId); for (const [key, target] of definitions) if (target.pluginId === pluginId) definitions.delete(key); },
    invalidateVoyage() { invalidate(() => true); },
    replaceHost(runtimeId: string, generation: number) { const lease = leases.get(runtimeId); if (lease) { lease.generation = generation; lease.valid = false; } invalidate((item) => item.runtimeId === runtimeId); },
    observation: () => ({ phase: state.phase, controllerPins: pins, activeLeases: state.phase === 'active' ? state.leases.length : 0, rollbackCount, disposeCount, events: [...events], splitOnlyRuntimeCount: [...leases.values()].filter((lease) => lease.disposalOwner === 'split-invocation').length }),
  };
  return api;
}
