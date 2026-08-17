import { afterEach, describe, expect, it } from 'vitest';
import { initVdDb, type VdDbHandle } from '../../../../server/database';
import { DbWorkspaceLaneStore } from '../../../../server/workspace-lane-store';
import {
  BeadMetaWorkflowError,
  BeadMetaWorkflowRuntime,
  type BeadMetadataProvider,
  type BeadReadModel,
  type BeadResultNoteWriter,
  type MetaWorkflowChildRunner,
  type MetaWorkflowChildRunReader,
} from './beadMetaWorkflowRuntime';

const handles: VdDbHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.db.destroy();
    handle.sqlite.close();
  }
});

describe('BeadMetaWorkflowRuntime M118', () => {
  it('TEST_CASE_M118_1A rejects duplicate, inaccessible, archived, and removed beads before launch', async () => {
    const { runtime, childStarts, noteWrites } = await createRuntime({
      beads: [
        bead('A'),
        bead('B', { accessible: false }),
        bead('C', { status: 'archived' }),
        bead('D', { status: 'removed' }),
      ],
    });

    await expect(runtime.createRun({ metaRunId: 'meta-invalid-duplicate', parentWorkspaceId: 'workspace-a', beadIds: ['A', 'A'] })).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'META_WORKFLOW_DUPLICATE_BEAD', path: 'beadIds.1' })],
    });
    await expect(runtime.createRun({ metaRunId: 'meta-invalid-state', parentWorkspaceId: 'workspace-a', beadIds: ['B', 'C', 'D'] })).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'META_WORKFLOW_BEAD_INACCESSIBLE', path: 'beadIds.0' }),
        expect.objectContaining({ code: 'META_WORKFLOW_BEAD_ARCHIVED', path: 'beadIds.1' }),
        expect.objectContaining({ code: 'META_WORKFLOW_BEAD_REMOVED', path: 'beadIds.2' }),
      ]),
    });
    await expect(runtime.createRun({ metaRunId: 'meta-missing', parentWorkspaceId: 'workspace-a', beadIds: ['missing'] })).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'META_WORKFLOW_BEAD_REMOVED', path: 'beadIds.0' })],
    });
    expect(childStarts).toEqual([]);
    expect(noteWrites).toEqual([]);
  });

  it('TEST_CASE_M118_1B executes ordered beads sequentially with one active child at a time', async () => {
    const { runtime, childStarts } = await createRuntime({ beads: [bead('A'), bead('B'), bead('C')] });

    const launched = await runtime.createRun({ metaRunId: 'meta-sequential', parentWorkspaceId: 'workspace-a', beadIds: ['A', 'B', 'C'], childWorkflowDesignId: 'design.child' });
    expect(launched).toMatchObject({ status: 'running', currentIndex: 0, childWorkflowDesignId: 'design.child', progress: { total: 3, completed: 0, running: 1, pending: 2 } });
    expect(launched.currentItem).toMatchObject({ beadId: 'A', status: 'running', childRunId: 'child-meta-sequential-0' });
    expect(childStarts.map((start) => start.beadId)).toEqual(['A']);
    expect(childStarts[0]).toMatchObject({
      childWorkflowDesignId: 'design.child',
      childRunId: 'child-meta-sequential-0',
      idempotencyKey: 'meta-run:meta-sequential:item:meta-sequential:item:0:child',
    });

    const afterA = await runtime.completeChild({ metaRunId: 'meta-sequential', itemId: launched.currentItem!.itemId, childRunId: 'child-meta-sequential-0', summary: 'A done' });
    expect(afterA).toMatchObject({ status: 'running', currentIndex: 1, progress: { completed: 1, running: 1, pending: 1 } });
    expect(afterA.currentItem).toMatchObject({ beadId: 'B', status: 'running', childRunId: 'child-meta-sequential-1' });
    expect(childStarts.map((start) => start.beadId)).toEqual(['A', 'B']);
  });

  it('TEST_CASE_M118_1B durably claims a child launch before side effects so duplicate resumes do not start duplicates', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    handles.push(handle);
    const childStarts: ChildStartRecord[] = [];
    const childRunner: MetaWorkflowChildRunner = {
      async startChild(input) {
        childStarts.push({
          beadId: input.bead.beadId,
          itemId: input.itemId,
          childRunId: input.childRunId,
          childWorkflowDesignId: input.childWorkflowDesignId ?? null,
          idempotencyKey: input.idempotencyKey,
        });
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { childRunId: input.childRunId };
      },
    };
    const runtime = buildRuntime(handle, { beads: [bead('A'), bead('B')], childRunner });
    await runtime.createRun({ metaRunId: 'meta-race', parentWorkspaceId: 'workspace-a', beadIds: ['A', 'B'], childWorkflowDesignId: 'design.child', autoStart: false });

    const [first, second] = await Promise.all([
      runtime.resumeRun('meta-race'),
      runtime.resumeRun('meta-race'),
    ]);
    const final = await runtime.getRun('meta-race');

    expect(childStarts).toHaveLength(1);
    expect(childStarts[0]).toMatchObject({ beadId: 'A', childRunId: 'child-meta-race-0', childWorkflowDesignId: 'design.child' });
    expect([first, second, final].map((run) => run.progress.running)).toEqual([1, 1, 1]);
    expect(final.items.filter((item) => item.status === 'running')).toHaveLength(1);
    expect(final.items[1]).toMatchObject({ beadId: 'B', status: 'pending', childRunId: null });
  });

  it('TEST_CASE_M119A_1E retries a claimed-but-unlaunched child with the same deterministic identifiers', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    handles.push(handle);
    const childStarts: ChildStartRecord[] = [];
    const launchedChildRuns = new Set<string>();
    const childRunner: MetaWorkflowChildRunner = {
      async startChild(input) {
        childStarts.push({
          beadId: input.bead.beadId,
          itemId: input.itemId,
          childRunId: input.childRunId,
          childWorkflowDesignId: input.childWorkflowDesignId ?? null,
          idempotencyKey: input.idempotencyKey,
        });
        launchedChildRuns.add(input.childRunId);
        return { childRunId: input.childRunId, artifactRefs: [`workflow-run://${input.childRunId}`] };
      },
    };
    const childRunReader: MetaWorkflowChildRunReader = {
      async getRun(runId) {
        return launchedChildRuns.has(runId)
          ? { runId, status: 'running', artifactRefs: [`workflow-run://${runId}`] }
          : null;
      },
    };
    const runtime = buildRuntime(handle, { beads: [bead('A'), bead('B')], childRunner, childRunReader, childStarts });
    await runtime.createRun({ metaRunId: 'meta-crash-window', parentWorkspaceId: 'workspace-a', beadIds: ['A', 'B'], childWorkflowDesignId: 'design.child', childWorkflowDesignVersion: 3, autoStart: false });

    await handle.db.updateTable('WorkflowMetaRunItem').set({ status: 'running', childRunId: 'child-meta-crash-window-0', startedAt: 2_000, updatedAt: 2_000 }).where('itemId', '=', 'meta-crash-window:item:0').execute();
    await handle.db.updateTable('WorkflowMetaRun').set({ status: 'running', currentIndex: 0, startedAt: 2_000, updatedAt: 2_000 }).where('metaRunId', '=', 'meta-crash-window').execute();

    const recovered = await runtime.resumeRun('meta-crash-window');
    expect(recovered).toMatchObject({ status: 'running', currentItem: { beadId: 'A', childRunId: 'child-meta-crash-window-0' } });
    expect(childStarts).toEqual([expect.objectContaining({
      beadId: 'A',
      childRunId: 'child-meta-crash-window-0',
      childWorkflowDesignId: 'design.child',
      idempotencyKey: 'meta-run:meta-crash-window:item:meta-crash-window:item:0:child',
    })]);

    await runtime.resumeRun('meta-crash-window');
    expect(childStarts).toHaveLength(1);
    const events = recovered.events.map((event) => event.kind);
    expect(events).toContain('meta_run_item_launch_recovered');
  });

  it('TEST_CASE_M118_1C pauses durably between beads and resumes at the correct bead', async () => {
    const { runtime, childStarts, handle } = await createRuntime({ beads: [bead('A'), bead('B')] });
    const launched = await runtime.createRun({ metaRunId: 'meta-pause', parentWorkspaceId: 'workspace-a', beadIds: ['A', 'B'] });

    await runtime.requestPause('meta-pause');
    const paused = await runtime.completeChild({ metaRunId: 'meta-pause', itemId: launched.currentItem!.itemId, childRunId: 'child-meta-pause-0', summary: 'A complete, pause before B' });
    expect(paused).toMatchObject({ status: 'paused', currentIndex: 1, progress: { completed: 1, pending: 1, running: 0 } });
    expect(childStarts.map((start) => start.beadId)).toEqual(['A']);

    const resumedRuntime = buildRuntime(handle, { beads: [bead('A'), bead('B')], childStarts });
    const resumed = await resumedRuntime.resumeRun('meta-pause');
    expect(resumed).toMatchObject({ status: 'running', currentIndex: 1 });
    expect(resumed.currentItem).toMatchObject({ beadId: 'B', childRunId: 'child-meta-pause-1' });
    expect(childStarts.map((start) => start.beadId)).toEqual(['A', 'B']);
  });

  it('TEST_CASE_M118_1D appends typed idempotent notes and keeps product-safe provenance', async () => {
    const { runtime, noteWrites } = await createRuntime({ beads: [bead('A')] });
    const launched = await runtime.createRun({ metaRunId: 'meta-note', parentWorkspaceId: 'workspace-a', beadIds: ['A'] });

    const completed = await runtime.completeChild({ metaRunId: 'meta-note', itemId: launched.currentItem!.itemId, childRunId: 'child-meta-note-0', summary: 'Implemented safely.' });

    expect(completed).toMatchObject({ status: 'completed', progress: { completed: 1 } });
    expect(completed.items[0]).toMatchObject({ noteRef: 'note://A/meta-run%3Ameta-note%3Aitem%3Ameta-note%3Aitem%3A0%3Aresult-note', result: { summary: 'Implemented safely.' } });
    expect(noteWrites).toHaveLength(1);
    expect(noteWrites[0]).toMatchObject({ beadId: 'A', idempotencyKey: 'meta-run:meta-note:item:meta-note:item:0:result-note', provenance: { source: 'bead_meta_workflow', parentWorkspaceId: 'workspace-a' } });
    const serialized = JSON.stringify(completed);
    expect(serialized).not.toContain('bd ');
    expect(serialized).not.toContain('git push');
    expect(serialized).not.toContain('/Users/');
  });

  it('TEST_CASE_M118_1E isolates child failure and does not start later beads', async () => {
    const { runtime, childStarts } = await createRuntime({ beads: [bead('A'), bead('B'), bead('C')] });
    const launched = await runtime.createRun({ metaRunId: 'meta-fail', parentWorkspaceId: 'workspace-a', beadIds: ['A', 'B', 'C'] });
    const afterA = await runtime.completeChild({ metaRunId: 'meta-fail', itemId: launched.currentItem!.itemId, childRunId: 'child-meta-fail-0', summary: 'A complete' });

    const blocked = await runtime.failChild({ metaRunId: 'meta-fail', itemId: afterA.currentItem!.itemId, childRunId: 'child-meta-fail-1', message: 'Reviewer blocked; do not run bd update or git push from here.' });

    expect(blocked).toMatchObject({ status: 'blocked', currentIndex: 1, progress: { completed: 1, blocked: 1, pending: 1 } });
    expect(blocked.items.map((item) => [item.beadId, item.status])).toEqual([['A', 'completed'], ['B', 'blocked'], ['C', 'pending']]);
    expect(childStarts.map((start) => start.beadId)).toEqual(['A', 'B']);
    expect(JSON.stringify(blocked)).not.toContain('bd update');
    expect(JSON.stringify(blocked)).not.toContain('git push');
  });

  it('TEST_CASE_M118_1F rejects unsafe lane conflicts for write-scoped meta-runs', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    handles.push(handle);
    const laneStore = new DbWorkspaceLaneStore({ db: handle.db, parentWorkspaceExists: (workspaceId) => workspaceId === 'workspace-a' });
    const lane = await laneStore.createLane({ laneId: 'lane-dirty', parentWorkspaceId: 'workspace-a', name: 'Dirty lane', purpose: 'Meta workflow lane', sourceBranch: 'main', worktreeStatus: 'dirty' });
    const runtime = buildRuntime(handle, { beads: [bead('A')], laneStore });

    await expect(runtime.createRun({ metaRunId: 'meta-lane-conflict', parentWorkspaceId: 'workspace-a', laneId: lane.laneId, accessMode: 'write', beadIds: ['A'] })).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'META_WORKFLOW_LANE_CONFLICT', path: 'laneId' })],
    });
  });
});

async function createRuntime(options: { beads: BeadReadModel[] }) {
  const handle = await initVdDb({ path: ':memory:' });
  handles.push(handle);
  const childStarts: ChildStartRecord[] = [];
  const noteWrites: Array<{ beadId: string; idempotencyKey: string; provenance: unknown }> = [];
  const runtime = buildRuntime(handle, { beads: options.beads, childStarts, noteWrites });
  return { handle, runtime, childStarts, noteWrites };
}

function buildRuntime(handle: VdDbHandle, options: { beads: BeadReadModel[]; childStarts?: ChildStartRecord[]; noteWrites?: Array<{ beadId: string; idempotencyKey: string; provenance: unknown }>; laneStore?: DbWorkspaceLaneStore; childRunner?: MetaWorkflowChildRunner; childRunReader?: MetaWorkflowChildRunReader }) {
  const beadProvider: BeadMetadataProvider = {
    async readBeads(beadIds) {
      const byId = new Map(options.beads.map((item) => [item.beadId, item]));
      return beadIds.map((id) => byId.get(id)).filter(Boolean) as BeadReadModel[];
    },
  };
  const childRunner: MetaWorkflowChildRunner = options.childRunner ?? {
    async startChild(input) {
      options.childStarts?.push({
        beadId: input.bead.beadId,
        itemId: input.itemId,
        childRunId: input.childRunId,
        childWorkflowDesignId: input.childWorkflowDesignId ?? null,
        idempotencyKey: input.idempotencyKey,
      });
      return { childRunId: input.childRunId, artifactRefs: [`workflow-run://${input.childRunId}`] };
    },
  };
  const noteWriter: BeadResultNoteWriter = {
    async appendResultNote(input) {
      options.noteWrites?.push({ beadId: input.beadId, idempotencyKey: input.idempotencyKey, provenance: input.provenance });
      return { noteRef: `note://${input.beadId}/${encodeURIComponent(input.idempotencyKey)}` };
    },
  };
  return new BeadMetaWorkflowRuntime({
    db: handle.db,
    beadProvider,
    childRunner,
    childRunReader: options.childRunReader,
    noteWriter,
    laneStore: options.laneStore,
    now: (() => { let value = 1_000; return () => value++; })(),
    createId: (() => { let value = 1; return () => `id-${value++}`; })(),
  });
}

type ChildStartRecord = { beadId: string; itemId: string; childRunId: string; childWorkflowDesignId: string | null; idempotencyKey: string };

function bead(beadId: string, options: Partial<BeadReadModel> = {}): BeadReadModel {
  return {
    beadId,
    title: `${beadId} title`,
    status: 'open',
    accessible: true,
    labels: ['workflow'],
    url: `/beads/project?bead=${encodeURIComponent(beadId)}`,
    ...options,
  };
}
