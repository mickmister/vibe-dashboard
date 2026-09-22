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
    panels: panelIds.map(panel),
    layout,
    history: [],
  };
}

function repository(seed = aggregate()) {
  let current = seed;
  const calls: Array<{ expectedRevision: number; panelIds: string[]; activationPanelId?: string }> = [];
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
      current = {
        ...current,
        revision: nextRevision,
        panels: input.panels.map((entry) => ({ ...entry, lastActivatedSequence: null })),
        layout: productionDockviewSnapshotCodec.validateAndCanonicalize(input.snapshot),
      };
      return nextRevision;
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
    await expect(staleFlush).resolves.toEqual(expect.objectContaining({ status: 'skipped', reason: 'stale-debounce' }));
    expect(store.calls).toHaveLength(2);

    const invalid = coordinator.beginGesture('invalid');
    coordinator.captureGestureSnapshot(invalid, { invalid: true });
    await expect(coordinator.completeGesture(invalid, { debounceMs: 0 })).resolves.toEqual(expect.objectContaining({ status: 'rejected' }));
    expect(dockview.fromJSON).toHaveBeenLastCalledWith(snapshot(['panel-a', 'panel-b', 'panel-c'], 'panel-b'));
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
});
