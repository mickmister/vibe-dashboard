import type { PanelTarget, ResolvedPanelTarget } from './targetRegistry';

export type OpenIntent = 'beside' | 'maximized';

export type DurablePanel = {
  id: string;
  voyageId: string;
  craftId: string;
  target: PanelTarget;
  equivalenceKey: string;
  groupId: string;
  lastActivatedSequence: number | null;
  runtimeId: string;
};

export type DurableGroup = {
  id: string;
  panelIds: string[];
  activePanelId: string;
  widthRatio: number;
};

export type VoyageState = {
  id: string;
  width: number;
  revision: number;
  activationSequence: number;
  historyCheckpointCount: number;
  groups: DurableGroup[];
  panels: Record<string, DurablePanel>;
  maximizedGroupId: string | null;
};

export type StructuralSnapshot = Pick<VoyageState, 'groups' | 'maximizedGroupId'> & {
  panels: Record<string, Omit<DurablePanel, 'lastActivatedSequence'>>;
};

export type CoordinatorPorts = {
  resolve(target: PanelTarget, craftId: string): ResolvedPanelTarget | { ok: false; reason: string };
  compareAndSwap(voyageId: string, expectedRevision: number, next: VoyageState): boolean;
  checkpoint(voyageId: string, before: StructuralSnapshot, after: StructuralSnapshot): void;
};

export type OpenSurfaceInput = {
  voyageId: string;
  invokingPanelId: string;
  craftId: string;
  target: PanelTarget;
  intent: OpenIntent;
};

export type OpenSurfaceResult = {
  panelId: string;
  created: boolean;
  moved: boolean;
  focusedOnly: boolean;
  revision: number;
};

function cloneState(state: VoyageState): VoyageState {
  return structuredClone(state);
}

export function structuralSnapshot(state: VoyageState): StructuralSnapshot {
  return {
    groups: structuredClone(state.groups),
    maximizedGroupId: state.maximizedGroupId,
    panels: Object.fromEntries(Object.entries(state.panels).map(([id, panel]) => {
      const { lastActivatedSequence: _recency, ...structural } = panel;
      return [id, structuredClone(structural)];
    })),
  };
}

function byRecencyThenId(left: DurablePanel, right: DurablePanel): number {
  return (right.lastActivatedSequence ?? -1) - (left.lastActivatedSequence ?? -1) || left.id.localeCompare(right.id);
}

function panelIsVisible(state: VoyageState, panel: DurablePanel): boolean {
  return state.groups.find((group) => group.id === panel.groupId)?.activePanelId === panel.id;
}

function adjacentCandidates(state: VoyageState, invoking: DurablePanel, candidates: DurablePanel[]): DurablePanel[] {
  const invokingIndex = state.groups.findIndex((group) => group.id === invoking.groupId);
  return candidates.filter((candidate) => {
    if (!panelIsVisible(state, candidate)) return false;
    const candidateIndex = state.groups.findIndex((group) => group.id === candidate.groupId);
    return Math.abs(candidateIndex - invokingIndex) === 1;
  });
}

function removePanelFromGroup(state: VoyageState, panel: DurablePanel): void {
  const group = state.groups.find((candidate) => candidate.id === panel.groupId);
  if (!group) throw new Error('panel-group-missing');
  group.panelIds = group.panelIds.filter((id) => id !== panel.id);
  if (group.activePanelId === panel.id) group.activePanelId = group.panelIds[0] ?? '';
  if (group.panelIds.length === 0) state.groups = state.groups.filter((candidate) => candidate.id !== group.id);
}

function stablePanelId(state: VoyageState, resolved: ResolvedPanelTarget): string {
  const stem = resolved.equivalenceKey.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'surface';
  let suffix = 1;
  let id = `${stem}-${suffix}`;
  while (state.panels[id]) id = `${stem}-${++suffix}`;
  return id;
}

/**
 * Isolated Phase 0 model of the per-Voyage serialized mutation boundary.
 * Resolution is delegated to the M1.3 trusted registry boundary through ports.
 */
export class SurfaceOpeningCoordinator {
  readonly #ports: CoordinatorPorts;
  readonly #states: Map<string, VoyageState>;
  #tail: Promise<unknown> = Promise.resolve();

  constructor(states: VoyageState[], ports: CoordinatorPorts) {
    this.#states = new Map(states.map((state) => [state.id, cloneState(state)]));
    this.#ports = ports;
  }

  state(voyageId: string): VoyageState {
    const state = this.#states.get(voyageId);
    if (!state) throw new Error('voyage-unavailable');
    return cloneState(state);
  }

  open(input: OpenSurfaceInput): Promise<OpenSurfaceResult> {
    const operation = this.#tail.then(() => this.#open(input));
    this.#tail = operation.catch(() => undefined);
    return operation;
  }

  async #open(input: OpenSurfaceInput): Promise<OpenSurfaceResult> {
    const current = this.#states.get(input.voyageId);
    if (!current) throw new Error('voyage-unavailable');
    const invoking = current.panels[input.invokingPanelId];
    if (!invoking || invoking.voyageId !== current.id) throw new Error('invoking-panel-unavailable');
    const resolved = this.#ports.resolve(input.target, input.craftId);
    if (!resolved.ok) throw new Error(`target-unavailable:${resolved.reason}`);

    const next = cloneState(current);
    const nextInvoking = next.panels[input.invokingPanelId]!;
    const equivalents = Object.values(next.panels)
      .filter((panel) => panel.voyageId === next.id && panel.equivalenceKey === resolved.equivalenceKey && panel.id !== nextInvoking.id);
    const adjacent = adjacentCandidates(next, nextInvoking, equivalents).sort(byRecencyThenId);
    let selected = (input.intent === 'beside' ? adjacent[0] : undefined) ?? [...equivalents].sort(byRecencyThenId)[0];
    let created = false;
    let moved = false;
    let structural = false;

    if (!selected) {
      const id = stablePanelId(next, resolved);
      selected = {
        id,
        voyageId: next.id,
        craftId: input.craftId,
        target: resolved.target,
        equivalenceKey: resolved.equivalenceKey,
        groupId: nextInvoking.groupId,
        lastActivatedSequence: null,
        runtimeId: `runtime:${next.id}:${id}`,
      };
      next.panels[id] = selected;
      next.groups.find((group) => group.id === nextInvoking.groupId)!.panelIds.push(id);
      created = true;
      structural = true;
    }

    if (input.intent === 'beside') {
      const isAlreadyAdjacent = adjacent.some((panel) => panel.id === selected!.id);
      if (!isAlreadyAdjacent) {
        removePanelFromGroup(next, selected);
        const invokingIndex = next.groups.findIndex((group) => group.id === nextInvoking.groupId);
        if (next.width >= 640) {
          const groupId = `group:${selected.id}`;
          selected.groupId = groupId;
          next.groups.splice(invokingIndex + 1, 0, { id: groupId, panelIds: [selected.id], activePanelId: selected.id, widthRatio: 0.5 });
          next.groups[invokingIndex]!.widthRatio = 0.5;
        } else {
          selected.groupId = nextInvoking.groupId;
          const group = next.groups[invokingIndex]!;
          const invokingPosition = group.panelIds.indexOf(nextInvoking.id);
          group.panelIds.splice(invokingPosition + 1, 0, selected.id);
          group.activePanelId = selected.id;
        }
        moved = !created;
        structural = true;
      }
    } else {
      const group = next.groups.find((candidate) => candidate.id === selected!.groupId)!;
      group.activePanelId = selected.id;
      if (next.maximizedGroupId !== group.id) {
        next.maximizedGroupId = group.id;
        structural = true;
      }
    }

    const selectedGroup = next.groups.find((group) => group.id === selected!.groupId)!;
    selectedGroup.activePanelId = selected.id;
    next.activationSequence += 1;
    selected.lastActivatedSequence = next.activationSequence;
    const before = structuralSnapshot(current);
    const after = structuralSnapshot(next);
    next.revision = current.revision + 1;
    if (structural) next.historyCheckpointCount += 1;

    if (!this.#ports.compareAndSwap(next.id, current.revision, cloneState(next))) throw new Error('revision-conflict');
    if (structural) this.#ports.checkpoint(next.id, before, after);
    this.#states.set(next.id, next);
    return { panelId: selected.id, created, moved, focusedOnly: !structural, revision: next.revision };
  }
}
