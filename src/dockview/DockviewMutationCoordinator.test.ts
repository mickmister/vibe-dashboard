import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Orientation, type SerializedDockview } from 'dockview';
import {
  createDockviewMutationCoordinator,
  createSemanticCoordinatorHarness,
  type DockviewMutationRepository,
} from './DockviewMutationCoordinator';
import { productionDockviewSnapshotCodec } from '../store/dockviewSnapshotCodec';
import {
  VoyageConflictError,
  VoyageInvariantError,
  type VoyageAggregate,
  type VoyagePanelRecord,
  type StructuralPanelHistoryRecord,
} from '../store/voyageRepository';

const voyageId = 'voyage-a';

function snapshot(panelIds: string[], activePanelId = panelIds[0]): SerializedDockview {
  return {
    grid: {
      root: {
        type: 'branch',
        data: panelIds.map((id) => ({
          type: 'leaf',
          data: { id: `group-${id}`, views: [id], activeView: id },
        })),
      },
      width: 1000,
      height: 800,
      orientation: Orientation.HORIZONTAL,
    },
    panels: Object.fromEntries(panelIds.map((id) => [id, {
      id,
      contentComponent: 'iframe-panel',
      renderer: 'always',
      params: { panelId: id },
    }])),
    ...(activePanelId ? { activeGroup: `group-${activePanelId}` } : {}),
  };
}

function panel(id: string): VoyagePanelRecord {
  return {
    id,
    craftWorkspaceId: 'workspace-a',
    targetKind: 'craft-overview',
    targetVersion: 1,
    targetPayload: { workspaceId: 'workspace-a' },
    titleMode: 'automatic',
    customTitle: null,
    closePolicy: 'closable',
    lastActivatedSequence: null,
  };
}

function aggregate(panelIds = ['panel-a', 'panel-b', 'panel-c'], revision = 0, activePanelId = panelIds[0]): VoyageAggregate {
  const layout = productionDockviewSnapshotCodec.validateAndCanonicalize(snapshot(panelIds, activePanelId));
  const panels = panelIds.map(panel);
  return {
    id: voyageId,
    revision,
    activationSequence: 0,
    historyCursorSequence: 0,
    metadata: {
      name: 'Voyage',
      mission: null,
      lifecycleState: 'active',
      lastOpenedAt: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    crafts: [{ craftWorkspaceId: 'workspace-a', sortKey: 'a' }],
    panels,
    layout,
    history: [{ sequence: 0, aggregateRevision: revision, panels: panels.map(structuralPanel), snapshot: layout.snapshot }],
  };
}

function repository(seed = aggregate()) {
  let current = seed;
  const calls: Array<{ expectedRevision: number; panelIds: string[]; activationPanelId?: string }> = [];
  const checkpoint = (sequence: number, aggregateRevision: number, source: VoyageAggregate) => ({
    sequence,
    aggregateRevision,
    panels: source.panels.map(structuralPanel),
    snapshot: source.layout.snapshot,
  });
  const applyCheckpoint = (target: VoyageAggregate) => {
    const recency = new Map(current.panels.map((entry) => [entry.id, entry.lastActivatedSequence]));
    current = {
      ...current,
      revision: current.revision + 1,
      historyCursorSequence: target.historyCursorSequence,
      panels: target.panels.map((entry) => ({ ...entry, lastActivatedSequence: recency.get(entry.id) ?? null })),
      layout: target.layout,
    };
  };
  const repo: DockviewMutationRepository = {
    async commitLayoutMutation(input) {
      calls.push({
        expectedRevision: input.expectedRevision,
        panelIds: input.panels.map(({ id }) => id),
        activationPanelId: input.activationPanelId,
      });
      if (input.expectedRevision !== current.revision) {
        throw new VoyageConflictError(input.voyageId, input.expectedRevision);
      }
      const nextRevision = current.revision + 1;
      const recency = new Map(current.panels.map((entry) => [entry.id, entry.lastActivatedSequence]));
      const retainedHistory = current.history.filter(({ sequence }) => current.historyCursorSequence === null || sequence <= current.historyCursorSequence);
      const nextSequence = Math.max(...retainedHistory.map(({ sequence }) => sequence), 0) + 1;
      const next: VoyageAggregate = {
        ...current,
        revision: nextRevision,
        historyCursorSequence: nextSequence,
        panels: input.panels.map((entry) => ({ ...entry, lastActivatedSequence: recency.get(entry.id) ?? null })),
        layout: productionDockviewSnapshotCodec.validateAndCanonicalize(input.snapshot),
      };
      current = {
        ...next,
        history: [
          ...retainedHistory,
          checkpoint(nextSequence, nextRevision, next),
        ],
      };
      return nextRevision;
    },
    async undo(id, expectedRevision) {
      if (id !== current.id || expectedRevision !== current.revision) {
        throw new VoyageConflictError(id, expectedRevision);
      }
      const cursor = current.historyCursorSequence;
      const previous = cursor === null ? undefined : [...current.history].reverse().find(({ sequence }) => sequence < cursor);
      if (!previous) return false;
      applyCheckpoint({
        ...current,
        historyCursorSequence: previous.sequence,
        panels: previous.panels.map((entry) => ({ ...entry, lastActivatedSequence: null })),
        layout: productionDockviewSnapshotCodec.validateAndCanonicalize(previous.snapshot),
      });
      return true;
    },
    async redo(id, expectedRevision) {
      if (id !== current.id || expectedRevision !== current.revision) {
        throw new VoyageConflictError(id, expectedRevision);
      }
      const cursor = current.historyCursorSequence;
      const next = cursor === null ? undefined : current.history.find(({ sequence }) => sequence > cursor);
      if (!next) return false;
      applyCheckpoint({
        ...current,
        historyCursorSequence: next.sequence,
        panels: next.panels.map((entry) => ({ ...entry, lastActivatedSequence: null })),
        layout: productionDockviewSnapshotCodec.validateAndCanonicalize(next.snapshot),
      });
      return true;
    },
    async recordActivation(id, panelId, expectedRevision) {
      if (id !== current.id || expectedRevision !== current.revision) {
        throw new VoyageConflictError(id, expectedRevision);
      }
      current = {
        ...current,
        revision: current.revision + 1,
        activationSequence: current.activationSequence + 1,
        panels: current.panels.map((entry) => entry.id === panelId
          ? { ...entry, lastActivatedSequence: current.activationSequence + 1 }
          : entry),
      };
      return true;
    },
    async loadVoyage(id) {
      if (id !== current.id) throw new VoyageInvariantError(`Unknown Voyage ${id}`);
      return current;
    },
  };
  return {
    repo,
    calls,
    get current() { return current; },
    set current(value: VoyageAggregate) { current = value; },
  };
}

function structuralPanel(panel: VoyagePanelRecord): StructuralPanelHistoryRecord {
  const {
    id, craftWorkspaceId, targetKind, targetVersion, targetPayload, titleMode, customTitle, closePolicy,
  } = panel;
  return { id, craftWorkspaceId, targetKind, targetVersion, targetPayload, titleMode, customTitle, closePolicy };
}

function api(initial = snapshot(['panel-a', 'panel-b', 'panel-c'])) {
  let value = initial;
  return {
    restored: [] as SerializedDockview[],
    toJSON: vi.fn(() => value),
    fromJSON: vi.fn((next: SerializedDockview) => {
      value = next;
      apiState.restored.push(next);
    }),
  };
}

const apiState = { restored: [] as SerializedDockview[] };

beforeEach(() => {
  apiState.restored = [];
  vi.useRealTimers();
});

describe('DockView M3.2 serialized mutation coordinator', () => {
  it('TEST_CASE_M3_2A serializes commands, dedupes unsafe repeats, and rolls back failed mutations', async () => {
    const store = repository();
    const dockview = api();
    const coordinator = createDockviewMutationCoordinator({ aggregate: store.current, api: dockview, repository: store.repo });
    const order: string[] = [];

    const open = coordinator.enqueueCommand({
      id: 'open-panel-d',
      dedupeKey: 'open:panel-d',
      unsafeDuplicate: true,
      apply: (current) => {
        order.push('open');
        return { panels: [...current.panels, panel('panel-d')], snapshot: snapshot(['panel-a', 'panel-b', 'panel-c', 'panel-d'], 'panel-d') };
      },
    });
    const duplicate = coordinator.enqueueCommand({
      id: 'open-panel-d-again',
      dedupeKey: 'open:panel-d',
      unsafeDuplicate: true,
      apply: () => {
        throw new Error('duplicate should coalesce');
      },
    });
    const close = coordinator.enqueueCommand({
      id: 'close-panel-b',
      apply: (current) => {
        order.push('close');
        return { panels: current.panels.filter(({ id }) => id !== 'panel-b'), snapshot: snapshot(['panel-a', 'panel-c', 'panel-d'], 'panel-d') };
      },
    });

    await expect(Promise.all([open, duplicate, close])).resolves.toEqual([
      expect.objectContaining({ status: 'committed', revision: 1 }),
      expect.objectContaining({ status: 'committed', revision: 1 }),
      expect.objectContaining({ status: 'committed', revision: 2 }),
    ]);
    expect(order).toEqual(['open', 'close']);
    expect(store.calls.map(({ expectedRevision, panelIds }) => [expectedRevision, panelIds])).toEqual([
      [0, ['panel-a', 'panel-b', 'panel-c', 'panel-d']],
      [1, ['panel-a', 'panel-c', 'panel-d']],
    ]);

    await expect(coordinator.enqueueCommand({
      id: 'open-panel-d-after-complete',
      dedupeKey: 'open:panel-d',
      unsafeDuplicate: true,
      apply: (current) => ({ panels: current.panels, snapshot: current.layout.snapshot }),
      validate: () => { throw new VoyageInvariantError('invalid command'); },
    })).resolves.toEqual(expect.objectContaining({ status: 'rejected', reason: 'invalid command' }));
    expect(dockview.fromJSON).toHaveBeenLastCalledWith(snapshot(['panel-a', 'panel-c', 'panel-d'], 'panel-d'));
    expect(store.calls).toHaveLength(2);
  });

  it('TEST_CASE_M3_2B coalesces gestures, skips unchanged snapshots, and prevents stale debounce overwrite', async () => {
    vi.useFakeTimers();
    const store = repository();
    const dockview = api();
    const coordinator = createDockviewMutationCoordinator({ aggregate: store.current, api: dockview, repository: store.repo, gestureDebounceMs: 50 });

    const gesture = coordinator.beginGesture('resize');
    coordinator.captureGestureSnapshot(gesture, snapshot(['panel-a', 'panel-b', 'panel-c'], 'panel-b'));
    coordinator.captureGestureSnapshot(gesture, snapshot(['panel-c', 'panel-a', 'panel-b'], 'panel-c'));
    const pendingGesture = coordinator.completeGesture(gesture);
    expect(coordinator.visibleState().dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(49);
    expect(store.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pendingGesture).resolves.toEqual(expect.objectContaining({ status: 'committed', revision: 1 }));
    expect(store.calls).toHaveLength(1);

    const unchanged = coordinator.beginGesture('unchanged');
    coordinator.captureGestureSnapshot(unchanged, snapshot(['panel-c', 'panel-a', 'panel-b'], 'panel-c'));
    await expect(coordinator.completeGesture(unchanged)).resolves.toEqual(expect.objectContaining({ status: 'skipped' }));
    expect(store.calls).toHaveLength(1);

    const stale = coordinator.beginGesture('stale');
    coordinator.captureGestureSnapshot(stale, snapshot(['panel-a', 'panel-c', 'panel-b'], 'panel-a'));
    const staleFlush = coordinator.completeGesture(stale);
    await coordinator.enqueueCommand({
      id: 'newer-command',
      apply: (current) => ({ panels: current.panels, snapshot: snapshot(current.panels.map(({ id }) => id), 'panel-b') }),
    });
    await vi.advanceTimersByTimeAsync(60);
    await expect(staleFlush).resolves.toEqual(expect.objectContaining({ status: 'committed', revision: 2 }));
    expect(store.calls).toHaveLength(3);

    const invalid = coordinator.beginGesture('invalid');
    coordinator.captureGestureSnapshot(invalid, { invalid: true });
    await expect(coordinator.completeGesture(invalid, { debounceMs: 0 })).resolves.toEqual(expect.objectContaining({ status: 'rejected' }));
    expect(dockview.fromJSON).toHaveBeenLastCalledWith(snapshot(['panel-a', 'panel-b', 'panel-c'], 'panel-b'));
  });

  it('serializes a completed debounced gesture before later structural commands instead of dropping it', async () => {
    vi.useFakeTimers();
    const store = repository();
    const coordinator = createDockviewMutationCoordinator({ aggregate: store.current, api: api(), repository: store.repo, gestureDebounceMs: 50 });

    const gesture = coordinator.beginGesture('drag');
    coordinator.captureGestureSnapshot(gesture, snapshot(['panel-c', 'panel-b', 'panel-a'], 'panel-c'));
    const debounced = coordinator.completeGesture(gesture);
    const structural = coordinator.enqueueCommand({
      id: 'open-panel-d',
      apply: (current) => ({
        panels: [...current.panels, panel('panel-d')],
        snapshot: snapshot(['panel-c', 'panel-b', 'panel-a', 'panel-d'], 'panel-d'),
      }),
    });

    await expect(debounced).resolves.toEqual(expect.objectContaining({ status: 'committed', revision: 1 }));
    await expect(structural).resolves.toEqual(expect.objectContaining({ status: 'committed', revision: 2 }));
    expect(store.calls.map(({ expectedRevision }) => expectedRevision)).toEqual([0, 1]);
    vi.useRealTimers();
  });

  it('TEST_CASE_M3_2C restores CAS winner and replays only deterministic commands with valid preconditions', async () => {
    const store = repository();
    const clientA = createDockviewMutationCoordinator({ aggregate: store.current, api: api(), repository: store.repo });
    const clientBApi = api();
    const clientB = createDockviewMutationCoordinator({ aggregate: store.current, api: clientBApi, repository: store.repo });

    await clientA.enqueueCommand({
      id: 'winner',
      apply: (current) => ({ panels: [...current.panels, panel('panel-d')], snapshot: snapshot(['panel-a', 'panel-b', 'panel-c', 'panel-d'], 'panel-d') }),
    });
    await expect(clientB.enqueueCommand({
      id: 'loser-replayable',
      replay: true,
      canReplay: (winner) => winner.panels.some(({ id }) => id === 'panel-d'),
      apply: (current) => ({ panels: current.panels.filter(({ id }) => id !== 'panel-a'), snapshot: snapshot(['panel-b', 'panel-c', 'panel-d'], 'panel-d') }),
    })).resolves.toEqual(expect.objectContaining({ status: 'replayed', revision: 2 }));
    expect(clientBApi.fromJSON).toHaveBeenCalledWith(snapshot(['panel-a', 'panel-b', 'panel-c', 'panel-d'], 'panel-d'));

    const staleAgain = createDockviewMutationCoordinator({ aggregate: aggregate(['panel-a', 'panel-b', 'panel-c'], 0), api: api(), repository: store.repo });
    await expect(staleAgain.enqueueCommand({
      id: 'non-replayable',
      apply: (current) => ({ panels: current.panels, snapshot: current.layout.snapshot }),
    })).resolves.toEqual(expect.objectContaining({ status: 'conflict', reason: 'stale-revision' }));
    expect(staleAgain.visibleState().lastConflict).toBe('stale-revision');
  });

  it('reloads committed structural state from the repository and preserves survivor activation metadata', async () => {
    const store = repository();
    store.current = {
      ...store.current,
      activationSequence: 5,
      panels: store.current.panels.map((entry) => entry.id === 'panel-b' ? { ...entry, lastActivatedSequence: 5 } : entry),
    };
    const dockview = api();
    const coordinator = createDockviewMutationCoordinator({ aggregate: store.current, api: dockview, repository: store.repo });

    await expect(coordinator.enqueueCommand({
      id: 'close-panel-c',
      apply: (current) => ({
        panels: current.panels.filter(({ id }) => id !== 'panel-c'),
        snapshot: snapshot(['panel-a', 'panel-b'], 'panel-b'),
      }),
    })).resolves.toEqual(expect.objectContaining({ status: 'committed', revision: 1 }));

    expect(coordinator.visibleState()).toMatchObject({ revision: 1, activePanelId: 'panel-b' });
    expect(store.current.panels.find(({ id }) => id === 'panel-b')?.lastActivatedSequence).toBe(5);
    expect(dockview.fromJSON).toHaveBeenLastCalledWith(snapshot(['panel-a', 'panel-b'], 'panel-b'));
  });

  it('surfaces recovery instead of publishing a post-commit load from the wrong revision', async () => {
    const store = repository();
    const originalCommit = store.repo.commitLayoutMutation;
    store.repo.commitLayoutMutation = async (input) => {
      const revision = await originalCommit(input);
      store.current = { ...store.current, revision: revision + 1 };
      return revision;
    };
    const coordinator = createDockviewMutationCoordinator({ aggregate: store.current, api: api(), repository: store.repo });

    await expect(coordinator.enqueueCommand({
      id: 'commit-race',
      apply: (current) => ({
        panels: current.panels,
        snapshot: snapshot(current.panels.map(({ id }) => id), 'panel-b'),
      }),
    })).resolves.toEqual(expect.objectContaining({
      status: 'conflict',
      reason: 'committed-revision-mismatch',
      revision: 2,
    }));
    expect(coordinator.visibleState().lastConflict).toBe('committed-revision-mismatch');
  });

  it('wraps programmatic focus suppression around the actual focus callback', async () => {
    const store = repository();
    const coordinator = createDockviewMutationCoordinator({ aggregate: store.current, api: api(), repository: store.repo });

    await expect(coordinator.focusPanelFromCommand('panel-b', () => {
      void coordinator.handleActivePanelChange('panel-b', { origin: 'user', input: 'pointer' });
    })).resolves.toEqual(expect.objectContaining({ status: 'activated', revision: 1 }));

    expect(store.current.revision).toBe(1);
    expect(store.current.activationSequence).toBe(1);
  });

  it('rejects overlapping gestures and gesture starts while mutation work is pending', async () => {
    const store = repository();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const coordinator = createDockviewMutationCoordinator({ aggregate: store.current, api: api(), repository: store.repo });
    const pending = coordinator.enqueueCommand({
      id: 'blocked',
      apply: (current) => ({ panels: current.panels, snapshot: current.layout.snapshot }),
      async validate() { await blocked; },
    });

    expect(() => coordinator.beginGesture('during-command')).toThrow('gesture-boundary-busy');
    release();
    await pending;
    const first = coordinator.beginGesture('first');
    expect(() => coordinator.beginGesture('second')).toThrow('gesture-already-active');
    await expect(coordinator.completeGesture(first)).resolves.toEqual(expect.objectContaining({ status: 'skipped', reason: 'unchanged-layout' }));
  });

  it('reruns validation against a CAS winner before replay apply/commit', async () => {
    const store = repository();
    const clientA = createDockviewMutationCoordinator({ aggregate: store.current, api: api(), repository: store.repo });
    const clientB = createDockviewMutationCoordinator({ aggregate: store.current, api: api(), repository: store.repo });
    await clientA.enqueueCommand({
      id: 'winner',
      apply: (current) => ({ panels: [...current.panels, panel('panel-d')], snapshot: snapshot(['panel-a', 'panel-b', 'panel-c', 'panel-d'], 'panel-d') }),
    });

    await expect(clientB.enqueueCommand({
      id: 'replay-validate-fails',
      replay: true,
      canReplay: () => true,
      validate: (current) => {
        if (current.panels.some(({ id }) => id === 'panel-d')) throw new VoyageInvariantError('winner changed preconditions');
      },
      apply: (current) => ({ panels: current.panels.filter(({ id }) => id !== 'panel-a'), snapshot: snapshot(['panel-b', 'panel-c', 'panel-d'], 'panel-d') }),
    })).resolves.toEqual(expect.objectContaining({ status: 'conflict', reason: 'replay-failed', revision: 1 }));
    expect(store.current.panels.map(({ id }) => id)).toEqual(['panel-a', 'panel-b', 'panel-c', 'panel-d']);
  });

  it('TEST_CASE_M3_2D records meaningful activation once and suppresses restore/programmatic callbacks', async () => {
    const store = repository();
    const coordinator = createDockviewMutationCoordinator({ aggregate: store.current, api: api(), repository: store.repo });

    await expect(coordinator.handleActivePanelChange('panel-b', { origin: 'user', input: 'pointer' }))
      .resolves.toEqual(expect.objectContaining({ status: 'activated', revision: 1 }));
    await expect(coordinator.focusPanelFromCommand('panel-c'))
      .resolves.toEqual(expect.objectContaining({ status: 'activated', revision: 2 }));
    await expect(coordinator.handleActivePanelChange('panel-c', { origin: 'api' }))
      .resolves.toEqual(expect.objectContaining({ status: 'suppressed' }));
    coordinator.restoreFromAggregate(store.current);
    await expect(coordinator.handleActivePanelChange('panel-a', { origin: 'api' }))
      .resolves.toEqual(expect.objectContaining({ status: 'suppressed' }));
    await Promise.all([
      coordinator.handleActivePanelChange('panel-a', { origin: 'user', input: 'keyboard' }),
      coordinator.handleActivePanelChange('panel-b', { origin: 'user', input: 'keyboard' }),
    ]);
    expect(coordinator.visibleState().activePanelId).toBe('panel-b');
    expect(store.current.revision).toBe(4);
    expect(store.calls).toHaveLength(0);
  });

  it('TEST_CASE_M3_2E flushes pending work before lifecycle boundaries and exposes recovery on flush conflicts', async () => {
    vi.useFakeTimers();
    const store = repository();
    const coordinator = createDockviewMutationCoordinator({ aggregate: store.current, api: api(), repository: store.repo, gestureDebounceMs: 100 });
    const gesture = coordinator.beginGesture('move-before-evict');
    coordinator.captureGestureSnapshot(gesture, snapshot(['panel-c', 'panel-b', 'panel-a'], 'panel-c'));
    const debounced = coordinator.completeGesture(gesture);

    await expect(coordinator.flush('evict')).resolves.toEqual(expect.objectContaining({ status: 'flushed' }));
    await expect(debounced).resolves.toEqual(expect.objectContaining({ status: 'committed', revision: 1 }));
    expect(store.current.layout.snapshot).toEqual(snapshot(['panel-c', 'panel-b', 'panel-a'], 'panel-c'));

    const stale = createDockviewMutationCoordinator({ aggregate: aggregate(), api: api(), repository: store.repo });
    const losingGesture = stale.beginGesture('stale-flush');
    stale.captureGestureSnapshot(losingGesture, snapshot(['panel-b', 'panel-c', 'panel-a'], 'panel-b'));
    stale.completeGesture(losingGesture);
    await expect(stale.flush('shutdown')).resolves.toEqual(expect.objectContaining({ status: 'recovery', reason: 'stale-revision' }));
    expect(stale.visibleState().lastConflict).toBe('stale-revision');
  });

  it('TEST_CASE_M3_2F exposes semantic workflow controls and visible state evidence', async () => {
    const store = repository();
    const harness = createSemanticCoordinatorHarness({ aggregate: store.current, api: api(), repository: store.repo });

    await harness.controls.queueOpenPanel('panel-d');
    harness.controls.startGesture('tester-resize');
    harness.controls.updateGesture(snapshot(['panel-d', 'panel-a', 'panel-b', 'panel-c'], 'panel-d'));
    await harness.controls.completeGesture();
    await harness.controls.activate('panel-d', 'keyboard');
    await harness.controls.flushBeforeEviction();

    expect(harness.visibleStatus()).toMatchObject({
      revision: 3,
      activePanelId: 'panel-d',
      pendingCommand: null,
      dirty: false,
      lastConflict: null,
      topologyAgreement: true,
    });
  });

  it('TEST_CASE_M3_3B restores persisted undo and redo checkpoints through the coordinator', async () => {
    const store = repository();
    const dockview = api();
    const coordinator = createDockviewMutationCoordinator({ aggregate: store.current, api: dockview, repository: store.repo });

    await coordinator.enqueueCommand({
      id: 'open-panel-d',
      apply: (current) => ({ panels: [...current.panels, panel('panel-d')], snapshot: snapshot(['panel-a', 'panel-b', 'panel-c', 'panel-d'], 'panel-d') }),
    });
    await coordinator.enqueueCommand({
      id: 'close-panel-b',
      apply: (current) => ({ panels: current.panels.filter(({ id }) => id !== 'panel-b'), snapshot: snapshot(['panel-a', 'panel-c', 'panel-d'], 'panel-d') }),
    });

    await expect(coordinator.undoHistory()).resolves.toEqual(expect.objectContaining({ status: 'restored', direction: 'undo', revision: 3 }));
    expect(dockview.fromJSON).toHaveBeenLastCalledWith(snapshot(['panel-a', 'panel-b', 'panel-c', 'panel-d'], 'panel-d'));
    await expect(coordinator.redoHistory()).resolves.toEqual(expect.objectContaining({ status: 'restored', direction: 'redo', revision: 4 }));
    expect(dockview.fromJSON).toHaveBeenLastCalledWith(snapshot(['panel-a', 'panel-c', 'panel-d'], 'panel-d'));
    expect(coordinator.visibleState()).toMatchObject({ revision: 4, historyCount: 3, historyCursorSequence: 2, topologyAgreement: true });
  });

  it('TEST_CASE_M3_3C reports current MRU after undo without rewinding activation recency', async () => {
    const store = repository();
    const coordinator = createDockviewMutationCoordinator({ aggregate: store.current, api: api(), repository: store.repo });

    await coordinator.handleActivePanelChange('panel-b', { origin: 'user', input: 'pointer' });
    await coordinator.enqueueCommand({
      id: 'close-panel-c',
      apply: (current) => ({ panels: current.panels.filter(({ id }) => id !== 'panel-c'), snapshot: snapshot(['panel-a', 'panel-b'], 'panel-b') }),
    });
    await coordinator.undoHistory();

    expect(store.current.activationSequence).toBe(1);
    expect(store.current.panels.find(({ id }) => id === 'panel-b')?.lastActivatedSequence).toBe(1);
    expect(store.current.panels.find(({ id }) => id === 'panel-c')?.lastActivatedSequence).toBeNull();
    expect(coordinator.visibleState()).toMatchObject({ computedMruPanelId: 'panel-b', activationSequence: 1 });
  });

  it('TEST_CASE_M3_3E serializes pending gestures before undo and restores the CAS winner on stale history', async () => {
    vi.useFakeTimers();
    const store = repository();
    const coordinator = createDockviewMutationCoordinator({ aggregate: store.current, api: api(), repository: store.repo, gestureDebounceMs: 25 });
    const gesture = coordinator.beginGesture('before-undo');
    coordinator.captureGestureSnapshot(gesture, snapshot(['panel-c', 'panel-b', 'panel-a'], 'panel-c'));
    const pending = coordinator.completeGesture(gesture);
    const undo = coordinator.undoHistory();
    await expect(pending).resolves.toEqual(expect.objectContaining({ status: 'committed', revision: 1 }));
    await expect(undo).resolves.toEqual(expect.objectContaining({ status: 'restored', revision: 2 }));

    const stale = createDockviewMutationCoordinator({ aggregate: aggregate(), api: api(), repository: store.repo });
    await expect(stale.undoHistory()).resolves.toEqual(expect.objectContaining({ status: 'conflict', reason: 'stale-revision', revision: 2 }));
    expect(stale.visibleState().lastConflict).toBe('stale-revision');
    vi.useRealTimers();
  });

  it('TEST_CASE_M3_3F exposes semantic persisted-history controls and visible status', async () => {
    const store = repository();
    const harness = createSemanticCoordinatorHarness({ aggregate: store.current, api: api(), repository: store.repo });

    await harness.controls.queueOpenPanel('panel-d');
    await harness.controls.activate('panel-d', 'keyboard');
    await harness.controls.undoHistory();
    await harness.controls.redoHistory();

    expect(harness.visibleStatus()).toMatchObject({
      revision: 4,
      historyCount: 2,
      historyCursorSequence: 1,
      activePanelId: 'panel-d',
      activationSequence: 1,
      computedMruPanelId: 'panel-a',
      lastConflict: null,
      topologyAgreement: true,
    });
    expect(harness.visibleStatus().layoutHash).toBeTypeOf('string');
  });
});
