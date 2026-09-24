import {
  createPanelTargetRegistry,
  findSplitCompatibleTargets,
  type PanelTargetResolutionContext,
  type ResolvedPanelTarget,
  type StoredPanelTarget,
} from '../store/panelTargetRegistry';

export type SplitViewIntent = {
  voyageId: string;
  invokingPanelId: string;
  withCraft?: string;
  withSurface: string;
};

export type SplitViewPanelRef = {
  panelId: string;
  voyageId: string;
  craftWorkspaceId: string;
  target: StoredPanelTarget;
};

export type SplitViewCandidate = {
  craftWorkspaceId: string;
  surface: string;
  target: StoredPanelTarget;
};

export type SplitViewResolution =
  | { ok: true; intent: SplitViewIntent; invoking: SplitViewPanelRef; invokingResolved: ResolvedPanelTarget; selected: SplitViewCandidate; selectedResolved: ResolvedPanelTarget; splitOnly: boolean }
  | { ok: false; reason: string };

export function parseSplitViewIntent(search: string): SplitViewIntent | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const allowed = new Set(['voyage', 'split', 'withCraft', 'withSurface']);
  for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1) return null;
  const voyageId = params.get('voyage');
  const invokingPanelId = params.get('split');
  const withSurface = params.get('withSurface');
  const withCraft = params.get('withCraft') ?? undefined;
  if (!safeToken(voyageId) || !safeToken(invokingPanelId) || !safeToken(withSurface) || (withCraft !== undefined && !safeToken(withCraft))) return null;
  return { voyageId, invokingPanelId, withSurface, ...(withCraft ? { withCraft } : {}) };
}

export function resolveSplitViewIntent(input: {
  search: string;
  currentVoyageId: string;
  panels: SplitViewPanelRef[];
  candidates: SplitViewCandidate[];
  contextForCraft: (craftWorkspaceId: string) => PanelTargetResolutionContext | null;
}): SplitViewResolution {
  const intent = parseSplitViewIntent(input.search);
  if (!intent) return { ok: false, reason: 'malformed-split-intent' };
  if (intent.voyageId !== input.currentVoyageId) return { ok: false, reason: 'stale-voyage' };
  const invoking = input.panels.find((panel) => panel.panelId === intent.invokingPanelId && panel.voyageId === intent.voyageId);
  if (!invoking) return { ok: false, reason: 'invoking-panel-unavailable' };
  const invokingContext = input.contextForCraft(invoking.craftWorkspaceId);
  if (!invokingContext) return { ok: false, reason: 'invoking-craft-unavailable' };
  const registry = createPanelTargetRegistry();
  const invokingResolved = registry.resolve(invoking.target, invokingContext);
  if (invokingResolved.status !== 'resolved') return { ok: false, reason: invokingResolved.reason };
  const selectedCraft = intent.withCraft ?? invoking.craftWorkspaceId;
  const selected = input.candidates.find((candidate) => candidate.craftWorkspaceId === selectedCraft && candidate.surface === intent.withSurface);
  if (!selected) return { ok: false, reason: 'surface-unavailable' };
  const compatible = findSplitCompatibleTargets(
    invokingResolved,
    invoking.craftWorkspaceId,
    [{ craftId: selected.craftWorkspaceId, target: selected.target }],
    input.contextForCraft,
    registry,
  )[0];
  if (!compatible) return { ok: false, reason: 'surface-unauthorized-or-incompatible' };
  return {
    ok: true,
    intent,
    invoking,
    invokingResolved,
    selected,
    selectedResolved: compatible.resolved,
    splitOnly: !input.panels.some((panel) =>
      panel.craftWorkspaceId === selected.craftWorkspaceId
      && sameTarget(panel.target, selected.target)),
  };
}

export function createSplitViewLeaseSession(input: {
  pin(): void;
  unpin(): void;
  acquire(runtimeId: string): void;
  release(runtimeId: string): void;
  dispose(runtimeId: string): void;
}) {
  let state: { phase: 'inactive' } | { phase: 'active'; runtimes: string[]; splitOnly: Set<string> } = { phase: 'inactive' };
  return {
    enter(runtimes: Array<{ runtimeId: string; splitOnly?: boolean }>): { ok: true } | { ok: false; reason: string } {
      if (state.phase !== 'inactive') return { ok: false, reason: 'split-busy' };
      input.pin();
      const acquired: Array<{ runtimeId: string; splitOnly: boolean }> = [];
      try {
        for (const runtime of [...runtimes].sort((left, right) => left.runtimeId.localeCompare(right.runtimeId))) {
          input.acquire(runtime.runtimeId);
          acquired.push({ runtimeId: runtime.runtimeId, splitOnly: Boolean(runtime.splitOnly) });
        }
        state = {
          phase: 'active',
          runtimes: acquired.map(({ runtimeId }) => runtimeId),
          splitOnly: new Set(acquired.filter(({ splitOnly }) => splitOnly).map(({ runtimeId }) => runtimeId)),
        };
        return { ok: true };
      } catch (error) {
        for (const runtime of acquired.reverse()) {
          input.release(runtime.runtimeId);
          if (runtime.splitOnly) input.dispose(runtime.runtimeId);
        }
        input.unpin();
        return { ok: false, reason: error instanceof Error ? error.message : 'split-enter-failed' };
      }
    },
    exit() {
      if (state.phase === 'inactive') return;
      const active = state;
      state = { phase: 'inactive' };
      for (const runtimeId of [...active.runtimes].reverse()) {
        input.release(runtimeId);
        if (active.splitOnly.has(runtimeId)) input.dispose(runtimeId);
      }
      input.unpin();
    },
    phase() {
      return state.phase;
    },
  };
}

function safeToken(value: string | null | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) && !value.includes('..'));
}

function sameTarget(left: StoredPanelTarget, right: StoredPanelTarget): boolean {
  return left.kind === right.kind && left.version === right.version && JSON.stringify(left.payload) === JSON.stringify(right.payload);
}
