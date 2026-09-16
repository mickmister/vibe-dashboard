import type { PanelTarget, ResolvedPanelTarget } from './targetRegistry';

export type OpenIntent = 'beside' | 'maximized';
export type Rect = { x: number; y: number; width: number; height: number };
export type DurablePanel = { id: string; voyageId: string; craftId: string; target: PanelTarget; groupId: string; lastActivatedSequence: number | null; runtimeId: string };
export type DurableGroup = { id: string; panelIds: string[]; activePanelId: string; rect: Rect };
export type StructuralSnapshot = { groups: DurableGroup[]; panels: Record<string, Omit<DurablePanel, 'lastActivatedSequence'>>; maximizedGroupId: string | null };
export type HistorySide = { panels: StructuralSnapshot; layout: unknown };
export type HistoryEntry = { before: HistorySide; after: HistorySide; cursorBefore: number; cursorAfter: number };
export type VoyageState = { id: string; width: number; revision: number; activationSequence: number; groups: DurableGroup[]; panels: Record<string, DurablePanel>; maximizedGroupId: string | null; history: HistoryEntry[]; historyCursor: number };
export type TrustedPanelResolution = { craftId: string; resolved: ResolvedPanelTarget };
export type TrustedActionResolution = TrustedPanelResolution & { actionIdentity: string };
export type AtomicCommit = { expectedRevision: number; next: VoyageState; layoutSnapshot: unknown; historyCursor: number; historyCheckpoint: HistoryEntry | null };
export type CoordinatorPorts = {
  resolvePanel(panel: DurablePanel): TrustedPanelResolution | { reason: string };
  resolveAction(invoking: TrustedPanelResolution, actionId: string): TrustedActionResolution | { reason: string };
  captureValidatedLayout(): unknown;
  applyValidatedLayout(state: VoyageState): unknown;
  restoreValidatedLayout(layout: unknown): void;
  atomicCommit(commit: AtomicCommit): Promise<boolean> | boolean;
};
export type OpenSurfaceInput = { voyageId: string; invokingPanelId: string; actionId: string; intent: OpenIntent };
export type OpenSurfaceResult = { panelId: string; created: boolean; moved: boolean; focusedOnly: boolean; revision: number };

const clone = <T>(value: T): T => structuredClone(value);
const isResolved = (value: TrustedPanelResolution | { reason: string }): value is TrustedPanelResolution => 'resolved' in value;
const isAction = (value: TrustedActionResolution | { reason: string }): value is TrustedActionResolution => 'actionIdentity' in value;
export function structuralSnapshot(state: VoyageState): StructuralSnapshot {
  return { groups: clone(state.groups), maximizedGroupId: state.maximizedGroupId, panels: Object.fromEntries(Object.entries(state.panels).map(([id, panel]) => {
    const { lastActivatedSequence: _ignored, ...structural } = panel; return [id, clone(structural)];
  })) };
}
function overlap(a: number, as: number, b: number, bs: number): boolean { return Math.min(a + as, b + bs) - Math.max(a, b) > 0; }
export function areVisiblyAdjacent(a: Rect, b: Rect): boolean {
  const e = 1;
  return overlap(a.y, a.height, b.y, b.height) && (Math.abs(a.x + a.width - b.x) <= e || Math.abs(b.x + b.width - a.x) <= e);
}
export function validateTopology(state: VoyageState): void {
  const groupIds = new Set<string>(); const placed = new Set<string>();
  for (const group of state.groups) {
    if (groupIds.has(group.id) || !group.panelIds.length || !group.panelIds.includes(group.activePanelId)) throw new Error('invalid-layout-topology');
    groupIds.add(group.id);
    if (![group.rect.x, group.rect.y, group.rect.width, group.rect.height].every(Number.isFinite) || group.rect.width <= 0 || group.rect.height <= 0) throw new Error('invalid-layout-topology');
    for (const panelId of group.panelIds) { if (placed.has(panelId) || state.panels[panelId]?.groupId !== group.id) throw new Error('invalid-layout-topology'); placed.add(panelId); }
  }
  if (placed.size !== Object.keys(state.panels).length) throw new Error('invalid-layout-topology');
}
function byRecencyThenId(a: DurablePanel, b: DurablePanel): number { return (b.lastActivatedSequence ?? -1) - (a.lastActivatedSequence ?? -1) || a.id.localeCompare(b.id); }
function visible(state: VoyageState, panel: DurablePanel): boolean { return state.groups.find(({ id }) => id === panel.groupId)?.activePanelId === panel.id; }
function removeFromGroup(state: VoyageState, panel: DurablePanel): void {
  const group = state.groups.find(({ id }) => id === panel.groupId); if (!group) throw new Error('panel-group-missing');
  group.panelIds = group.panelIds.filter((id) => id !== panel.id); if (group.activePanelId === panel.id) group.activePanelId = group.panelIds[0] ?? '';
  if (!group.panelIds.length) state.groups = state.groups.filter(({ id }) => id !== group.id);
}
function stableId(state: VoyageState, resolved: ResolvedPanelTarget): string {
  const stem = resolved.equivalenceKey.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'surface'; let n = 1; let id = `${stem}-${n}`;
  while (state.panels[id]) id = `${stem}-${++n}`; return id;
}
function applySnapshot(current: VoyageState, snapshot: StructuralSnapshot): VoyageState {
  const next = clone(current); next.groups = clone(snapshot.groups); next.maximizedGroupId = snapshot.maximizedGroupId;
  next.panels = Object.fromEntries(Object.entries(snapshot.panels).map(([id, structural]) => [id, { ...clone(structural), lastActivatedSequence: current.panels[id]?.lastActivatedSequence ?? null }]));
  return next;
}

export class SurfaceOpeningCoordinator {
  readonly #states: Map<string, VoyageState>; readonly #inFlight = new Map<string, Promise<OpenSurfaceResult>>(); #tail: Promise<unknown> = Promise.resolve();
  constructor(states: VoyageState[], readonly ports: CoordinatorPorts) { this.#states = new Map(states.map((state) => [state.id, clone(state)])); }
  state(voyageId: string): VoyageState { const state = this.#states.get(voyageId); if (!state) throw new Error('voyage-unavailable'); return clone(state); }
  open(input: OpenSurfaceInput): Promise<OpenSurfaceResult> {
    const current = this.#states.get(input.voyageId); const invoking = current?.panels[input.invokingPanelId];
    if (!current || !invoking) return Promise.reject(new Error('invoking-panel-unavailable'));
    const invokingResolution = this.ports.resolvePanel(invoking); if (!isResolved(invokingResolution)) return Promise.reject(new Error(`invoking-target-unavailable:${invokingResolution.reason}`));
    const action = this.ports.resolveAction(invokingResolution, input.actionId); if (!isAction(action)) return Promise.reject(new Error(`action-unavailable:${action.reason}`));
    const key = [input.voyageId, input.invokingPanelId, action.actionIdentity, action.resolved.equivalenceKey, input.intent].join('\0');
    const existing = this.#inFlight.get(key); if (existing) return existing;
    const operation = this.#tail.then(() => this.#executeOpen(input, action)); this.#tail = operation.catch(() => undefined); this.#inFlight.set(key, operation);
    void operation.finally(() => { if (this.#inFlight.get(key) === operation) this.#inFlight.delete(key); }).catch(() => undefined); return operation;
  }
  async restore(voyageId: string): Promise<void> { return this.#structural(voyageId, (state) => { state.maximizedGroupId = null; }); }
  async activate(voyageId: string, panelId: string): Promise<void> { return this.#serialized(voyageId, async (current) => {
    const panel = current.panels[panelId]; if (!panel || !isResolved(this.ports.resolvePanel(panel))) throw new Error('panel-unavailable');
    const next = clone(current); next.activationSequence += 1; next.panels[panelId]!.lastActivatedSequence = next.activationSequence; next.groups.find(({ id }) => id === next.panels[panelId]!.groupId)!.activePanelId = panelId; next.revision += 1; await this.#commit(current, next, null); return next;
  }); }
  async undo(voyageId: string): Promise<void> { return this.#serialized(voyageId, async (current) => {
    if (!current.historyCursor) return current; const entry = current.history[current.historyCursor - 1]!; const next = applySnapshot(current, entry.before.panels); next.historyCursor -= 1; next.revision += 1; await this.#commit(current, next, null, entry.before.layout, undefined, true); return next;
  }); }
  async redo(voyageId: string): Promise<void> { return this.#serialized(voyageId, async (current) => {
    if (current.historyCursor >= current.history.length) return current; const entry = current.history[current.historyCursor]!; const next = applySnapshot(current, entry.after.panels); next.historyCursor += 1; next.revision += 1; await this.#commit(current, next, null, entry.after.layout, undefined, true); return next;
  }); }
  async #executeOpen(input: OpenSurfaceInput, initialAction: TrustedActionResolution): Promise<OpenSurfaceResult> {
    const current = this.#states.get(input.voyageId)!; const beforeLayout = this.ports.captureValidatedLayout(); const invoking = current.panels[input.invokingPanelId]; if (!invoking) throw new Error('invoking-panel-unavailable');
    const invokingResolution = this.ports.resolvePanel(invoking); if (!isResolved(invokingResolution)) throw new Error('invoking-target-unavailable');
    const action = this.ports.resolveAction(invokingResolution, input.actionId);
    if (!isAction(action) || action.actionIdentity !== initialAction.actionIdentity || action.resolved.equivalenceKey !== initialAction.resolved.equivalenceKey) throw new Error('action-changed');
    validateTopology(current); const next = clone(current); const nextInvoking = next.panels[input.invokingPanelId]!; const invokingGroup = next.groups.find(({ id }) => id === nextInvoking.groupId)!;
    const candidates = Object.values(next.panels).filter(({ id }) => id !== nextInvoking.id).flatMap((panel) => {
      const resolution = this.ports.resolvePanel(panel); return isResolved(resolution) && resolution.resolved.equivalenceKey === action.resolved.equivalenceKey ? [panel] : [];
    });
    const adjacent = candidates.filter((panel) => { const group = next.groups.find(({ id }) => id === panel.groupId); return group && visible(next, panel) && areVisiblyAdjacent(invokingGroup.rect, group.rect); }).sort(byRecencyThenId);
    let selected = (input.intent === 'beside' ? adjacent[0] : undefined) ?? [...candidates].sort(byRecencyThenId)[0]; let created = false; let moved = false; let structural = false;
    if (!selected) { const id = stableId(next, action.resolved); selected = { id, voyageId: next.id, craftId: action.craftId, target: action.resolved.target, groupId: nextInvoking.groupId, lastActivatedSequence: null, runtimeId: `runtime:${next.id}:${id}` }; next.panels[id] = selected; invokingGroup.panelIds.push(id); created = true; structural = true; }
    if (input.intent === 'beside') {
      const isAdjacent = adjacent.some(({ id }) => id === selected!.id);
      if (!isAdjacent && next.width >= 640) { removeFromGroup(next, selected); const index = next.groups.findIndex(({ id }) => id === nextInvoking.groupId); invokingGroup.rect.width /= 2; selected.groupId = `group:${selected.id}`; next.groups.splice(index + 1, 0, { id: selected.groupId, panelIds: [selected.id], activePanelId: selected.id, rect: { ...invokingGroup.rect, x: invokingGroup.rect.x + invokingGroup.rect.width } }); moved = !created; structural = true; }
      else if (!isAdjacent) { const group = next.groups.find(({ id }) => id === selected!.groupId)!; group.activePanelId = selected.id; next.maximizedGroupId = group.id; structural = true; }
    } else { const group = next.groups.find(({ id }) => id === selected!.groupId)!; group.activePanelId = selected.id; if (next.maximizedGroupId !== group.id) { next.maximizedGroupId = group.id; structural = true; } }
    next.groups.find(({ id }) => id === selected!.groupId)!.activePanelId = selected.id; next.activationSequence += 1; selected.lastActivatedSequence = next.activationSequence; next.revision += 1;
    const afterLayout = this.ports.applyValidatedLayout(next);
    const checkpoint = structural ? { before: { panels: structuralSnapshot(current), layout: beforeLayout }, after: { panels: structuralSnapshot(next), layout: afterLayout }, cursorBefore: current.historyCursor, cursorAfter: current.historyCursor + 1 } : null;
    if (checkpoint) { next.history = next.history.slice(0, next.historyCursor); next.history.push(checkpoint); next.historyCursor = next.history.length; }
    await this.#commit(current, next, checkpoint, afterLayout, beforeLayout); this.#states.set(next.id, next); return { panelId: selected.id, created, moved, focusedOnly: !structural, revision: next.revision };
  }
  async #structural(voyageId: string, mutate: (state: VoyageState) => void): Promise<void> { return this.#serialized(voyageId, async (current) => {
    const beforeLayout = this.ports.captureValidatedLayout(); const next = clone(current); mutate(next); const afterLayout = this.ports.applyValidatedLayout(next); const checkpoint = { before: { panels: structuralSnapshot(current), layout: beforeLayout }, after: { panels: structuralSnapshot(next), layout: afterLayout }, cursorBefore: current.historyCursor, cursorAfter: current.historyCursor + 1 }; next.history = next.history.slice(0, next.historyCursor); next.history.push(checkpoint); next.historyCursor = next.history.length; next.revision += 1; await this.#commit(current, next, checkpoint, afterLayout, beforeLayout); return next;
  }); }
  async #serialized(voyageId: string, work: (state: VoyageState) => Promise<VoyageState>): Promise<void> { const operation = this.#tail.then(async () => { const current = this.#states.get(voyageId); if (!current) throw new Error('voyage-unavailable'); this.#states.set(voyageId, await work(current)); }); this.#tail = operation.catch(() => undefined); return operation; }
  async #commit(current: VoyageState, next: VoyageState, checkpoint: HistoryEntry | null, appliedLayout?: unknown, rollbackLayout?: unknown, restoreFirst = false): Promise<void> { const before = rollbackLayout ?? this.ports.captureValidatedLayout(); try { if (restoreFirst) this.ports.restoreValidatedLayout(appliedLayout); const layout = appliedLayout ?? this.ports.applyValidatedLayout(next); if (!await this.ports.atomicCommit({ expectedRevision: current.revision, next: clone(next), layoutSnapshot: layout, historyCursor: next.historyCursor, historyCheckpoint: checkpoint ? clone(checkpoint) : null })) throw new Error('revision-conflict'); } catch (error) { this.ports.restoreValidatedLayout(before); throw error; } }
}
