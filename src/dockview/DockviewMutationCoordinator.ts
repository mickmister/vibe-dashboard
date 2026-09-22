import type { SerializedDockview } from 'dockview';
import { productionDockviewSnapshotCodec } from '../store/dockviewSnapshotCodec';
import {
  VoyageConflictError,
  VoyageInvariantError,
  type CommitLayoutMutationInput,
  type StructuralPanelHistoryRecord,
  type VoyageAggregate,
} from '../store/voyageRepository';

export interface DockviewMutationApi {
  toJSON(): SerializedDockview;
  fromJSON(snapshot: SerializedDockview): void;
}

export interface DockviewMutationRepository {
  commitLayoutMutation(input: CommitLayoutMutationInput): Promise<number>;
  recordActivation(voyageId: string, panelId: string, expectedRevision: number): Promise<boolean>;
  loadVoyage(voyageId: string): Promise<VoyageAggregate>;
}

type CommandOutcome =
  | { status: 'committed'; revision: number }
  | { status: 'replayed'; revision: number }
  | { status: 'conflict'; reason: string; revision: number }
  | { status: 'rejected'; reason: string; revision: number }
  | { status: 'skipped'; reason: string; revision: number };

type ActivationOutcome =
  | { status: 'activated'; revision: number }
  | { status: 'suppressed'; revision: number }
  | { status: 'skipped'; reason: string; revision: number };

export interface DockviewMutationCommand {
  id: string;
  dedupeKey?: string;
  unsafeDuplicate?: boolean;
  replay?: boolean;
  apply(current: VoyageAggregate): { panels: StructuralPanelHistoryRecord[]; snapshot: unknown; activationPanelId?: string };
  validate?(current: VoyageAggregate): void;
  canReplay?(winner: VoyageAggregate): boolean;
}

export interface DockviewMutationCoordinator {
  enqueueCommand(command: DockviewMutationCommand): Promise<CommandOutcome>;
  beginGesture(label: string): symbol;
  captureGestureSnapshot(token: symbol, snapshot: unknown): void;
  completeGesture(token: symbol, options?: { debounceMs?: number }): Promise<CommandOutcome>;
  handleActivePanelChange(panelId: string, event: { origin: 'user' | 'api'; input?: 'pointer' | 'keyboard' }): Promise<ActivationOutcome>;
  focusPanelFromCommand(panelId: string): Promise<ActivationOutcome>;
  restoreFromAggregate(aggregate: VoyageAggregate): void;
  flush(reason: string): Promise<{ status: 'flushed' | 'recovery'; reason?: string; revision: number }>;
  visibleState(): CoordinatorVisibleState;
}

export interface CoordinatorVisibleState {
  revision: number;
  activePanelId: string | null;
  pendingCommand: string | null;
  dirty: boolean;
  lastConflict: string | null;
  topologyAgreement: boolean;
}

interface PendingGesture {
  token: symbol;
  label: string;
  before: VoyageAggregate;
  latestSnapshot: unknown;
  generation: number;
  timer: ReturnType<typeof setTimeout> | null;
  resolve: ((value: CommandOutcome) => void) | null;
  promise: Promise<CommandOutcome> | null;
}

export function createDockviewMutationCoordinator(input: {
  aggregate: VoyageAggregate;
  api: DockviewMutationApi;
  repository: DockviewMutationRepository;
  gestureDebounceMs?: number;
}): DockviewMutationCoordinator {
  return new SerializedDockviewMutationCoordinator(input);
}

class SerializedDockviewMutationCoordinator implements DockviewMutationCoordinator {
  private accepted: VoyageAggregate;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly pendingByDedupe = new Map<string, Promise<CommandOutcome>>();
  private pendingCommand: string | null = null;
  private pendingGesture: PendingGesture | null = null;
  private generation = 0;
  private lastConflict: string | null = null;
  private currentActivePanelId: string | null;
  private suppressedPanelId: string | null = null;
  private suppressActivations = false;

  constructor(private readonly input: {
    aggregate: VoyageAggregate;
    api: DockviewMutationApi;
    repository: DockviewMutationRepository;
    gestureDebounceMs?: number;
  }) {
    this.accepted = input.aggregate;
    this.currentActivePanelId = activePanelId(input.aggregate.layout.snapshot);
  }

  enqueueCommand(command: DockviewMutationCommand): Promise<CommandOutcome> {
    if (command.dedupeKey && command.unsafeDuplicate) {
      const pending = this.pendingByDedupe.get(command.dedupeKey);
      if (pending) return pending;
    }
    this.generation += 1;
    const promise = this.enqueue(command.id, () => this.runCommand(command));
    if (command.dedupeKey && command.unsafeDuplicate) {
      const dedupeKey = command.dedupeKey;
      this.pendingByDedupe.set(dedupeKey, promise);
      promise.finally(() => this.pendingByDedupe.delete(dedupeKey));
    }
    return promise;
  }

  beginGesture(label: string): symbol {
    const token = Symbol(label);
    this.pendingGesture = {
      token,
      label,
      before: this.accepted,
      latestSnapshot: this.input.api.toJSON(),
      generation: this.generation,
      timer: null,
      resolve: null,
      promise: null,
    };
    return token;
  }

  captureGestureSnapshot(token: symbol, snapshot: unknown): void {
    if (this.pendingGesture?.token === token) {
      this.pendingGesture.latestSnapshot = snapshot;
    }
  }

  completeGesture(token: symbol, options: { debounceMs?: number } = {}): Promise<CommandOutcome> {
    const gesture = this.pendingGesture;
    if (!gesture || gesture.token !== token) return Promise.resolve(this.skipped('missing-gesture'));
    const beforeHash = this.hashOrNull(gesture.before.layout.snapshot);
    const afterHash = this.hashOrNull(gesture.latestSnapshot);
    if (!afterHash) {
      this.pendingGesture = null;
      this.restoreFromAggregate(gesture.before);
      return Promise.resolve(this.rejected('invalid-dockview-snapshot'));
    }
    if (beforeHash === afterHash) {
      this.pendingGesture = null;
      return Promise.resolve(this.skipped('unchanged-layout'));
    }
    const promise = new Promise<CommandOutcome>((resolve) => {
      gesture.resolve = resolve;
      const run = () => {
        if (this.pendingGesture !== gesture) {
          resolve(this.skipped('stale-debounce'));
          return;
        }
        if (gesture.generation !== this.generation) {
          this.pendingGesture = null;
          resolve(this.skipped('stale-debounce'));
          return;
        }
        this.pendingGesture = null;
        this.enqueueCommand({
          id: `gesture:${gesture.label}`,
          apply: (current) => ({ panels: structuralPanels(current), snapshot: gesture.latestSnapshot }),
        }).then(resolve);
      };
      const debounceMs = options.debounceMs ?? this.input.gestureDebounceMs ?? 0;
      if (debounceMs <= 0) run();
      else gesture.timer = setTimeout(run, debounceMs);
    });
    gesture.promise = promise;
    return promise;
  }

  handleActivePanelChange(panelId: string, event: { origin: 'user' | 'api'; input?: 'pointer' | 'keyboard' }): Promise<ActivationOutcome> {
    if (this.suppressActivations || event.origin !== 'user') return Promise.resolve({ status: 'suppressed', revision: this.accepted.revision });
    if (this.suppressedPanelId === panelId) {
      this.suppressedPanelId = null;
      return Promise.resolve({ status: 'suppressed', revision: this.accepted.revision });
    }
    return this.recordActivation(panelId);
  }

  async focusPanelFromCommand(panelId: string): Promise<ActivationOutcome> {
    const result = await this.recordActivation(panelId);
    this.suppressedPanelId = panelId;
    return result;
  }

  restoreFromAggregate(aggregate: VoyageAggregate): void {
    this.suppressActivations = true;
    try {
      this.accepted = aggregate;
      this.currentActivePanelId = activePanelId(aggregate.layout.snapshot);
      this.input.api.fromJSON(aggregate.layout.snapshot as unknown as SerializedDockview);
    } finally {
      this.suppressActivations = false;
    }
  }

  async flush(_reason: string): Promise<{ status: 'flushed' | 'recovery'; reason?: string; revision: number }> {
    const gesture = this.pendingGesture;
    if (gesture?.timer) {
      clearTimeout(gesture.timer);
      gesture.timer = null;
      this.pendingGesture = null;
      this.enqueueCommand({
        id: `flush:${gesture.label}`,
        apply: (current) => ({ panels: structuralPanels(current), snapshot: gesture.latestSnapshot }),
      }).then(gesture.resolve ?? (() => undefined));
    }
    await this.queue.catch(() => undefined);
    if (this.lastConflict) return { status: 'recovery', reason: this.lastConflict, revision: this.accepted.revision };
    return { status: 'flushed', revision: this.accepted.revision };
  }

  visibleState(): CoordinatorVisibleState {
    return {
      revision: this.accepted.revision,
      activePanelId: this.currentActivePanelId,
      pendingCommand: this.pendingCommand,
      dirty: Boolean(this.pendingGesture),
      lastConflict: this.lastConflict,
      topologyAgreement: topologyAgreement(this.accepted),
    };
  }

  private enqueue<T>(label: string, task: () => Promise<T>): Promise<T> {
    const run = async () => {
      this.pendingCommand = label;
      try {
        return await task();
      } finally {
        this.pendingCommand = null;
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async runCommand(command: DockviewMutationCommand): Promise<CommandOutcome> {
    const before = this.accepted;
    try {
      command.validate?.(before);
      const applied = command.apply(before);
      productionDockviewSnapshotCodec.validateAndCanonicalize(applied.snapshot);
      const revision = await this.input.repository.commitLayoutMutation({
        voyageId: before.id,
        expectedRevision: before.revision,
        panels: applied.panels,
        snapshot: applied.snapshot,
        ...(applied.activationPanelId ? { activationPanelId: applied.activationPanelId } : {}),
      });
      this.accepted = {
        ...before,
        revision,
        panels: applied.panels.map((entry) => ({ ...entry, lastActivatedSequence: null })),
        layout: productionDockviewSnapshotCodec.validateAndCanonicalize(applied.snapshot),
      };
      this.currentActivePanelId = activePanelId(applied.snapshot);
      this.lastConflict = null;
      return { status: 'committed', revision };
    } catch (error) {
      if (error instanceof VoyageConflictError) return this.handleConflict(command, before);
      this.restoreFromAggregate(before);
      return this.rejected(error instanceof Error ? error.message : 'mutation-rejected');
    }
  }

  private async handleConflict(command: DockviewMutationCommand, before: VoyageAggregate): Promise<CommandOutcome> {
    let winner: VoyageAggregate;
    try {
      winner = await this.input.repository.loadVoyage(before.id);
      productionDockviewSnapshotCodec.validateAndCanonicalize(winner.layout.snapshot);
    } catch {
      this.lastConflict = 'winner-invalid';
      this.restoreFromAggregate(before);
      return { status: 'conflict', reason: 'winner-invalid', revision: this.accepted.revision };
    }
    this.restoreFromAggregate(winner);
    if (command.replay && (command.canReplay?.(winner) ?? false)) {
      try {
        const applied = command.apply(winner);
        const revision = await this.input.repository.commitLayoutMutation({
          voyageId: winner.id,
          expectedRevision: winner.revision,
          panels: applied.panels,
          snapshot: applied.snapshot,
          ...(applied.activationPanelId ? { activationPanelId: applied.activationPanelId } : {}),
        });
        this.accepted = {
          ...winner,
          revision,
          panels: applied.panels.map((entry) => ({ ...entry, lastActivatedSequence: null })),
          layout: productionDockviewSnapshotCodec.validateAndCanonicalize(applied.snapshot),
        };
        this.currentActivePanelId = activePanelId(applied.snapshot);
        this.lastConflict = null;
        return { status: 'replayed', revision };
      } catch {
        this.restoreFromAggregate(winner);
        this.lastConflict = 'replay-failed';
        return { status: 'conflict', reason: 'replay-failed', revision: winner.revision };
      }
    }
    this.lastConflict = 'stale-revision';
    return { status: 'conflict', reason: 'stale-revision', revision: winner.revision };
  }

  private async recordActivation(panelId: string): Promise<ActivationOutcome> {
    return this.enqueue(`activate:${panelId}`, async () => {
      try {
        const changed = await this.input.repository.recordActivation(this.accepted.id, panelId, this.accepted.revision);
        if (!changed) return { status: 'skipped', reason: 'already-active', revision: this.accepted.revision };
        const winner = await this.input.repository.loadVoyage(this.accepted.id);
        this.accepted = winner;
        this.currentActivePanelId = panelId;
        this.lastConflict = null;
        return { status: 'activated', revision: winner.revision };
      } catch (error) {
        if (error instanceof VoyageConflictError) {
          const winner = await this.input.repository.loadVoyage(this.accepted.id);
          this.restoreFromAggregate(winner);
          this.lastConflict = 'stale-revision';
          return { status: 'skipped', reason: 'stale-revision', revision: winner.revision };
        }
        return { status: 'skipped', reason: error instanceof Error ? error.message : 'activation-failed', revision: this.accepted.revision };
      }
    });
  }

  private hashOrNull(snapshot: unknown): string | null {
    try {
      return productionDockviewSnapshotCodec.validateAndCanonicalize(snapshot).hash;
    } catch {
      return null;
    }
  }

  private skipped(reason: string): CommandOutcome {
    return { status: 'skipped', reason, revision: this.accepted.revision };
  }

  private rejected(reason: string): CommandOutcome {
    return { status: 'rejected', reason, revision: this.accepted.revision };
  }
}

function structuralPanels(aggregate: VoyageAggregate): StructuralPanelHistoryRecord[] {
  return aggregate.panels.map(({
    id, craftWorkspaceId, targetKind, targetVersion, targetPayload, titleMode, customTitle, closePolicy,
  }) => ({ id, craftWorkspaceId, targetKind, targetVersion, targetPayload, titleMode, customTitle, closePolicy }));
}

function activePanelId(snapshot: unknown): string | null {
  try {
    const canonical = productionDockviewSnapshotCodec.validateAndCanonicalize(snapshot);
    const activeGroup = canonical.snapshot.activeGroup;
    if (typeof activeGroup !== 'string') return canonical.panelIds[0] ?? null;
    const suffix = activeGroup.startsWith('group-') ? activeGroup.slice('group-'.length) : null;
    return suffix && canonical.panelIds.includes(suffix) ? suffix : (canonical.panelIds[0] ?? null);
  } catch {
    return null;
  }
}

function topologyAgreement(aggregate: VoyageAggregate): boolean {
  try {
    const canonical = productionDockviewSnapshotCodec.validateAndCanonicalize(aggregate.layout.snapshot);
    const panels = new Set(aggregate.panels.map(({ id }) => id));
    return canonical.panelIds.length === panels.size && canonical.panelIds.every((id) => panels.has(id));
  } catch {
    return false;
  }
}

export function createSemanticCoordinatorHarness(input: {
  aggregate: VoyageAggregate;
  api: DockviewMutationApi;
  repository: DockviewMutationRepository;
}) {
  const coordinator = createDockviewMutationCoordinator(input);
  let gesture: symbol | null = null;
  return {
    controls: {
      queueOpenPanel(panelId: string) {
        return coordinator.enqueueCommand({
          id: `open:${panelId}`,
          dedupeKey: `open:${panelId}`,
          unsafeDuplicate: true,
          apply: (current) => ({
            panels: [...structuralPanels(current), {
              id: panelId,
              craftWorkspaceId: 'workspace-a',
              targetKind: 'craft-overview',
              targetVersion: 1,
              targetPayload: { workspaceId: 'workspace-a' },
              titleMode: 'automatic',
              customTitle: null,
              closePolicy: 'closable',
            }],
            snapshot: appendPanelSnapshot(current.layout.snapshot, panelId),
          }),
        });
      },
      startGesture(label: string) {
        gesture = coordinator.beginGesture(label);
      },
      updateGesture(snapshot: unknown) {
        if (!gesture) throw new Error('No active gesture');
        coordinator.captureGestureSnapshot(gesture, snapshot);
      },
      async completeGesture() {
        if (!gesture) throw new Error('No active gesture');
        const token = gesture;
        gesture = null;
        return coordinator.completeGesture(token);
      },
      activate(panelId: string, inputKind: 'pointer' | 'keyboard') {
        return coordinator.handleActivePanelChange(panelId, { origin: 'user', input: inputKind });
      },
      flushBeforeEviction() {
        return coordinator.flush('evict');
      },
    },
    visibleStatus: () => coordinator.visibleState(),
  };
}

function appendPanelSnapshot(raw: unknown, panelId: string): SerializedDockview {
  const canonical = productionDockviewSnapshotCodec.validateAndCanonicalize(raw).snapshot as unknown as SerializedDockview;
  return {
    ...canonical,
    grid: {
      ...canonical.grid,
      root: {
        ...canonical.grid.root,
        data: [
          ...((canonical.grid.root as { data: unknown[] }).data),
          { type: 'leaf', data: { id: `group-${panelId}`, views: [panelId], activeView: panelId } },
        ],
      },
    },
    panels: {
      ...canonical.panels,
      [panelId]: { id: panelId, contentComponent: 'iframe-panel', renderer: 'always', params: { panelId } },
    },
    activeGroup: `group-${panelId}`,
  } as SerializedDockview;
}
