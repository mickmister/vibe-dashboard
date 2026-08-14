import { afterEach, describe, expect, it } from 'vitest';
import { initVdDb, type VdDbHandle } from './database';
import { DbWorkspaceLaneStore, LaneStoreError } from './workspace-lane-store';

const handles: VdDbHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.db.destroy();
    handle.sqlite.close();
  }
});

describe('DbWorkspaceLaneStore', () => {
  it('TEST_CASE_M116_1A creates, lists, reads, updates, archives, and rejects invalid lane lifecycle operations', async () => {
    const { store } = await setupLaneStore();

    const lane = await store.createLane({
      laneId: 'lane-alpha',
      parentWorkspaceId: 'workspace-a',
      name: 'Milestone lane',
      purpose: 'Isolate M116 work',
      sourceBranch: 'vk/8b79-vd-workflows',
      workingBranch: 'vk/8b79-vd-workflows-lane-alpha',
      worktreeStatus: 'clean',
      worktreeSummary: { filesChanged: 0 },
      createdBy: { type: 'workflow', runId: 'run-1' },
    });

    expect(lane).toMatchObject({
      laneId: 'lane-alpha',
      parentWorkspaceId: 'workspace-a',
      isSubWorkspace: true,
      name: 'Milestone lane',
      status: 'planned',
      sourceBranch: 'vk/8b79-vd-workflows',
      workingBranch: 'vk/8b79-vd-workflows-lane-alpha',
      worktree: { status: 'clean', summary: { filesChanged: 0 }, display: 'Worktree clean' },
      capacity: { write: { status: 'available', activeLeaseId: null } },
      breadcrumb: 'Workspace workspace-a → Milestone lane',
      nextAction: 'Ready for lane-backed workflow or bead binding.',
    });

    await expect(store.getLane('workspace-a', 'lane-alpha')).resolves.toMatchObject({ laneId: 'lane-alpha' });
    await expect(store.listLanes('workspace-a')).resolves.toHaveLength(1);
    await expect(store.updateLaneStatus('workspace-a', 'lane-alpha', 'ready')).resolves.toMatchObject({ status: 'ready' });
    await expect(store.archiveLane('workspace-a', 'lane-alpha')).resolves.toMatchObject({ status: 'archived', archivedAt: expect.any(Number) });

    await expectLaneError(
      store.createLane({ laneId: 'lane-missing', parentWorkspaceId: 'missing', name: 'Missing', purpose: 'No parent', sourceBranch: 'main' }),
      'parent_workspace_not_found',
    );
    await expectLaneError(
      store.createLane({ laneId: 'lane-alpha', parentWorkspaceId: 'workspace-a', name: 'Other', purpose: 'Duplicate id', sourceBranch: 'main' }),
      'lane_duplicate',
    );
    await expectLaneError(store.getLane('workspace-b', 'lane-alpha'), 'lane_wrong_workspace');
    await expectLaneError(store.updateLaneStatus('workspace-a', 'lane-alpha', 'active'), 'lane_archived');
  });

  it('TEST_CASE_M116_1B prevents overlapping write capacity and releases idempotently', async () => {
    const { store } = await setupLaneStore();
    await store.createLane({ laneId: 'lane-write', parentWorkspaceId: 'workspace-a', name: 'Write lane', purpose: 'Capacity', sourceBranch: 'main', worktreeStatus: 'clean' });

    const first = await store.acquireWriteToken({ parentWorkspaceId: 'workspace-a', laneId: 'lane-write', leaseId: 'lease-1', ownerId: 'worker-1', leaseDurationMs: 60_000 });
    expect(first).toMatchObject({ leaseId: 'lease-1', status: 'held', activeLeaseId: 'lease-1', ownerId: 'worker-1' });
    await expectLaneError(
      store.acquireWriteToken({ parentWorkspaceId: 'workspace-a', laneId: 'lane-write', leaseId: 'lease-2', ownerId: 'worker-2' }),
      'lane_capacity_conflict',
    );

    await expect(store.releaseWriteToken('workspace-a', 'lane-write', 'lease-1', 'turn complete')).resolves.toMatchObject({ status: 'available', activeLeaseId: null });
    await expect(store.releaseWriteToken('workspace-a', 'lane-write', 'lease-1', 'duplicate wakeup')).resolves.toMatchObject({ status: 'available', activeLeaseId: null });
    await expect(store.acquireWriteToken({ parentWorkspaceId: 'workspace-a', laneId: 'lane-write', leaseId: 'lease-3', ownerId: 'worker-3' })).resolves.toMatchObject({ status: 'held', activeLeaseId: 'lease-3' });
  });

  it('TEST_CASE_M116_1C marks expired write tokens stale and requires explicit recovery before new writes', async () => {
    const clock = { now: 1_000 };
    const { store } = await setupLaneStore(clock);
    await store.createLane({ laneId: 'lane-stale', parentWorkspaceId: 'workspace-a', name: 'Stale lane', purpose: 'Recovery', sourceBranch: 'main', worktreeStatus: 'clean' });
    await store.acquireWriteToken({ parentWorkspaceId: 'workspace-a', laneId: 'lane-stale', leaseId: 'lease-expired', ownerId: 'worker-1', leaseDurationMs: 5 });

    clock.now = 2_000;
    await expectLaneError(
      store.acquireWriteToken({ parentWorkspaceId: 'workspace-a', laneId: 'lane-stale', leaseId: 'lease-new', ownerId: 'worker-2' }),
      'lane_capacity_stale_or_orphan',
    );
    await expect(store.getLane('workspace-a', 'lane-stale')).resolves.toMatchObject({ capacity: { write: { status: 'stale_or_orphan', activeLeaseId: 'lease-expired' } } });
    await expectLaneError(
      store.acquireWriteToken({ parentWorkspaceId: 'workspace-a', laneId: 'lane-stale', leaseId: 'lease-still-blocked', ownerId: 'worker-3' }),
      'lane_capacity_stale_or_orphan',
    );

    await expect(store.recoverStaleWriteToken('workspace-a', 'lane-stale', { leaseId: 'lease-expired', actorId: 'operator', reason: 'worker crashed' })).resolves.toMatchObject({ status: 'available' });
    await expect(store.acquireWriteToken({ parentWorkspaceId: 'workspace-a', laneId: 'lane-stale', leaseId: 'lease-after-recovery', ownerId: 'worker-4' })).resolves.toMatchObject({ status: 'held', activeLeaseId: 'lease-after-recovery' });
  });

  it('TEST_CASE_M116_1D binds workflow runs and beads durably without silent lane switches', async () => {
    const { store } = await setupLaneStore();
    await store.createLane({ laneId: 'lane-a', parentWorkspaceId: 'workspace-a', name: 'Lane A', purpose: 'Binding', sourceBranch: 'main', worktreeStatus: 'clean' });
    await store.createLane({ laneId: 'lane-b', parentWorkspaceId: 'workspace-a', name: 'Lane B', purpose: 'Binding conflict', sourceBranch: 'main', worktreeStatus: 'clean' });

    const workflowBinding = await store.bindLane({ parentWorkspaceId: 'workspace-a', laneId: 'lane-a', bindingType: 'workflow_run', bindingKey: 'run-123', accessMode: 'write', reason: 'Launch selected lane', roleBindings: { dev: { sessionId: 'session-dev' } } });
    expect(workflowBinding).toMatchObject({ laneId: 'lane-a', bindingType: 'workflow_run', bindingKey: 'run-123', accessMode: 'write', roleBindings: { dev: { sessionId: 'session-dev' } } });
    await expect(store.bindLane({ parentWorkspaceId: 'workspace-a', laneId: 'lane-a', bindingType: 'workflow_run', bindingKey: 'run-123' })).resolves.toMatchObject({ bindingId: workflowBinding.bindingId });
    await expectLaneError(store.bindLane({ parentWorkspaceId: 'workspace-a', laneId: 'lane-b', bindingType: 'workflow_run', bindingKey: 'run-123' }), 'lane_binding_conflict');

    const beadBinding = await store.findOrCreateBindingForBead({ parentWorkspaceId: 'workspace-a', laneName: 'Bead lane', beadId: 'bead-42', purpose: 'Sequential milestone work', sourceBranch: 'main' });
    expect(beadBinding).toMatchObject({ bindingType: 'bead', bindingKey: 'bead-42', accessMode: 'write' });
    await expect(store.findOrCreateBindingForBead({ parentWorkspaceId: 'workspace-a', laneName: 'Different bead lane', beadId: 'bead-42', purpose: 'Do not switch', sourceBranch: 'main' })).resolves.toMatchObject({ bindingId: beadBinding.bindingId });
    await expect(store.getLane('workspace-a', 'lane-a')).resolves.toMatchObject({ boundRunIds: ['run-123'], lastActiveRunId: 'run-123' });
  });

  it('TEST_CASE_M116_1E/1F exposes product overview, selected lane context, provenance, and write blockers', async () => {
    const { store } = await setupLaneStore();
    await store.createLane({ laneId: 'lane-active', parentWorkspaceId: 'workspace-a', name: 'Active lane', purpose: 'Overview', sourceBranch: 'main', worktreeStatus: 'clean', status: 'active' });
    await store.createLane({ laneId: 'lane-dirty', parentWorkspaceId: 'workspace-a', name: 'Dirty lane', purpose: 'Needs cleanup', sourceBranch: 'main', worktreeStatus: 'dirty', status: 'blocked' });
    await store.bindLane({ parentWorkspaceId: 'workspace-a', laneId: 'lane-active', bindingType: 'bead', bindingKey: 'bead-1', reason: 'Milestone lane' });
    await store.acquireWriteToken({ parentWorkspaceId: 'workspace-a', laneId: 'lane-active', leaseId: 'lease-active', ownerId: 'workflow-run-1' });

    const overview = await store.buildParentOverview('workspace-a');
    expect(overview).toMatchObject({ parentWorkspaceId: 'workspace-a', activeWriteLanes: 1, counts: { active: 1, blocked: 1 } });
    expect(overview.nextAction).toBe('Inspect blocked lane and choose resume, reassign, or archive.');
    expect(overview.lanes.find((lane) => lane.laneId === 'lane-active')).toMatchObject({ boundBeadIds: ['bead-1'], capacity: { write: { status: 'held' } }, provenance: { cwdMode: 'sub_workspace_lane', selectedWorkspaceId: 'lane-active' } });
    expect(overview.lanes.find((lane) => lane.laneId === 'lane-dirty')).toMatchObject({ worktree: { status: 'dirty', display: 'Needs attention: dirty worktree' }, nextAction: 'Inspect or clean dirty lane worktree before write work.' });

    await expectLaneError(store.acquireWriteToken({ parentWorkspaceId: 'workspace-a', laneId: 'lane-dirty', ownerId: 'writer' }), 'lane_write_blocked');
    await expect(store.getSelectedLaneWorkspaceContext({ parentWorkspaceId: 'workspace-a', laneId: 'lane-active', accessMode: 'write' })).resolves.toMatchObject({ workspaceId: 'lane-active', parentWorkspaceId: 'workspace-a', laneId: 'lane-active', cwdMode: 'sub_workspace_lane', allowsWrites: true, provenance: { laneLabel: 'Active lane' } });
    await expect(store.getSelectedLaneWorkspaceContext({ parentWorkspaceId: 'workspace-a', accessMode: 'read' })).resolves.toMatchObject({ workspaceId: 'workspace-a', laneId: null, cwdMode: 'parent_workspace', allowsWrites: true });
    await expect(store.getSelectedLaneWorkspaceContext({ parentWorkspaceId: 'workspace-a', accessMode: 'write' })).resolves.toMatchObject({ workspaceId: 'workspace-a', laneId: null, cwdMode: 'parent_workspace', allowsWrites: false });
  });
});

async function setupLaneStore(clock: { now: number } = { now: 1_000 }) {
  const handle = await initVdDb({ path: ':memory:' });
  handles.push(handle);
  const existingParents = new Set(['workspace-a', 'workspace-b']);
  const store = new DbWorkspaceLaneStore({
    db: handle.db,
    now: () => clock.now++,
    parentWorkspaceExists: (workspaceId) => existingParents.has(workspaceId),
  });
  return { handle, store, clock };
}

async function expectLaneError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
  await promise.catch((error) => expect(error).toBeInstanceOf(LaneStoreError));
}
