import { randomUUID } from 'node:crypto';
import type { Insertable, Kysely, Selectable } from 'kysely';
import type {
  DB,
  WorkflowMetaRun,
  WorkflowMetaRunEvent,
  WorkflowMetaRunItem,
  WorkflowMetaRunItemStatus,
  WorkflowMetaRunStatus,
} from '../../../../store/kysely_types';
import { DbWorkspaceLaneStore, LaneStoreError, type SelectedLaneWorkspaceContext } from '../../../../server/workspace-lane-store';

export type BeadMetaWorkflowIssueCode =
  | 'META_WORKFLOW_INVALID_SELECTION'
  | 'META_WORKFLOW_DUPLICATE_BEAD'
  | 'META_WORKFLOW_BEAD_INACCESSIBLE'
  | 'META_WORKFLOW_BEAD_ARCHIVED'
  | 'META_WORKFLOW_BEAD_REMOVED'
  | 'META_WORKFLOW_LANE_CONFLICT'
  | 'META_WORKFLOW_NOT_FOUND'
  | 'META_WORKFLOW_INVALID_STATE'
  | 'META_WORKFLOW_STALE_CHILD';

export interface BeadMetaWorkflowIssue {
  code: BeadMetaWorkflowIssueCode;
  path: string;
  message: string;
}

export class BeadMetaWorkflowError extends Error {
  readonly code: BeadMetaWorkflowIssueCode;
  readonly issues: BeadMetaWorkflowIssue[];
  readonly status: number;

  constructor(code: BeadMetaWorkflowIssueCode, message: string, options: { issues?: BeadMetaWorkflowIssue[]; status?: number } = {}) {
    super(message);
    this.name = 'BeadMetaWorkflowError';
    this.code = code;
    this.issues = options.issues ?? [{ code, path: 'metaRun', message }];
    this.status = options.status ?? 400;
  }
}

export interface BeadReadModel {
  beadId: string;
  title: string;
  status: 'open' | 'in_progress' | 'review' | 'blocked' | 'closed' | 'archived' | 'removed';
  accessible: boolean;
  labels?: string[];
  url?: string | null;
}

export interface BeadMetadataProvider {
  readBeads(beadIds: string[]): Promise<BeadReadModel[]>;
}

export interface BeadResultNoteWriter {
  appendResultNote(input: {
    beadId: string;
    bodyMarkdown: string;
    idempotencyKey: string;
    provenance: MetaWorkflowProvenance;
  }): Promise<{ noteRef: string }>;
}

export interface MetaWorkflowChildRunner {
  startChild(input: {
    metaRunId: string;
    itemId: string;
    bead: BeadReadModel;
    parentWorkspaceId: string;
    lane: SelectedLaneWorkspaceContext;
    childWorkflowDesignId?: string | null;
    childRunId: string;
    idempotencyKey: string;
  }): Promise<{ childRunId?: string; artifactRefs?: string[] }>;
}

export interface MetaWorkflowProvenance {
  metaRunId: string;
  parentWorkspaceId: string;
  laneId: string | null;
  laneLabel: string;
  source: 'bead_meta_workflow';
}

export interface BeadMetaWorkflowItemReadModel {
  itemId: string;
  beadId: string;
  title: string;
  beadStatus: string;
  index: number;
  status: WorkflowMetaRunItemStatus;
  childRunId: string | null;
  noteRef: string | null;
  result: Record<string, unknown> | null;
  error: ProductSafeError | null;
  provenance: Record<string, unknown>;
  startedAt: number | null;
  completedAt: number | null;
}

export interface BeadMetaWorkflowRunReadModel {
  metaRunId: string;
  parentWorkspaceId: string;
  laneId: string | null;
  status: WorkflowMetaRunStatus;
  currentIndex: number;
  childWorkflowDesignId: string | null;
  title: string;
  summary: string | null;
  currentItem: BeadMetaWorkflowItemReadModel | null;
  items: BeadMetaWorkflowItemReadModel[];
  progress: { total: number; completed: number; pending: number; running: number; blocked: number };
  nextAction: string;
  blockedReason: ProductSafeError | null;
  provenance: MetaWorkflowProvenance;
  events: Array<{ eventId: string; kind: string; message: string; itemId: string | null; data: Record<string, unknown>; createdAt: number }>;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface ProductSafeError {
  code: string;
  message: string;
  path?: string;
}

export class BeadMetaWorkflowRuntime {
  private readonly getDb: () => Promise<Kysely<DB>> | Kysely<DB>;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly beads: BeadMetadataProvider;
  private readonly notes: BeadResultNoteWriter;
  private readonly childRunner: MetaWorkflowChildRunner;
  private readonly laneStore?: DbWorkspaceLaneStore;

  constructor(options: {
    db?: Kysely<DB>;
    getDb?: () => Promise<Kysely<DB>> | Kysely<DB>;
    beadProvider: BeadMetadataProvider;
    noteWriter?: BeadResultNoteWriter;
    childRunner?: MetaWorkflowChildRunner;
    laneStore?: DbWorkspaceLaneStore;
    now?: () => number;
    createId?: () => string;
  }) {
    if (!options.db && !options.getDb) throw new Error('BeadMetaWorkflowRuntime requires db or getDb');
    this.getDb = options.getDb ?? (() => options.db!);
    this.beads = options.beadProvider;
    this.notes = options.noteWriter ?? new InMemorySafeNoteWriter();
    this.childRunner = options.childRunner ?? new DeterministicChildRunner();
    this.laneStore = options.laneStore;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
  }

  async createRun(input: {
    metaRunId?: string;
    parentWorkspaceId: string;
    beadIds: string[];
    title?: string;
    summary?: string | null;
    childWorkflowDesignId?: string | null;
    laneId?: string | null;
    accessMode?: 'read' | 'write';
    autoStart?: boolean;
  }): Promise<BeadMetaWorkflowRunReadModel> {
    const parentWorkspaceId = cleanRequired(input.parentWorkspaceId, 'parentWorkspaceId');
    const metaRunId = input.metaRunId?.trim() || this.createId();
    const issues = validateBeadSelection(input.beadIds);
    if (issues.length) throw new BeadMetaWorkflowError('META_WORKFLOW_INVALID_SELECTION', 'Bead selection is invalid.', { issues });

    const beads = await this.readAndValidateBeads(input.beadIds);
    const lane = await this.resolveLane({ parentWorkspaceId, laneId: input.laneId ?? null, accessMode: input.accessMode ?? 'read' });
    const now = this.now();
    const provenance: MetaWorkflowProvenance = { metaRunId, parentWorkspaceId, laneId: lane.provenance.laneId, laneLabel: lane.laneLabel, source: 'bead_meta_workflow' };
    const db = await this.getDb();
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('WorkflowMetaRun').values({
        metaRunId,
        parentWorkspaceId,
        laneId: lane.provenance.laneId,
        status: 'pending',
        currentIndex: 0,
        childWorkflowDesignId: input.childWorkflowDesignId ?? null,
        title: cleanOptional(input.title) ?? `Meta-workflow for ${beads.length} bead${beads.length === 1 ? '' : 's'}`,
        summary: cleanOptional(input.summary) ?? null,
        pauseRequested: 0,
        blockedReasonJson: null,
        resultSummaryJson: '[]',
        provenanceJson: stableJson(provenance),
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        completedAt: null,
      } satisfies Insertable<WorkflowMetaRun>).execute();

      for (const [index, bead] of beads.entries()) {
        await trx.insertInto('WorkflowMetaRunItem').values({
          itemId: `${metaRunId}:item:${index}`,
          metaRunId,
          beadId: bead.beadId,
          itemIndex: index,
          title: bead.title,
          beadStatus: bead.status,
          status: 'pending',
          childRunId: null,
          resultJson: null,
          noteRef: null,
          errorJson: null,
          provenanceJson: stableJson({ beadId: bead.beadId, beadUrl: bead.url ?? null, labels: bead.labels ?? [] }),
          createdAt: now,
          updatedAt: now,
          startedAt: null,
          completedAt: null,
        } satisfies Insertable<WorkflowMetaRunItem>).execute();
      }
      await insertEvent(trx, { eventId: this.createId(), metaRunId, itemId: null, kind: 'meta_run_created', message: `Created ordered run for ${beads.length} beads.`, data: { beadIds: beads.map((bead) => bead.beadId), laneId: lane.provenance.laneId }, now });
    });

    if (input.autoStart !== false) return this.resumeRun(metaRunId);
    return this.getRun(metaRunId);
  }

  async requestPause(metaRunId: string): Promise<BeadMetaWorkflowRunReadModel> {
    const run = await this.getRequiredRun(metaRunId);
    if (isFinal(run.status)) return run;
    const now = this.now();
    const db = await this.getDb();
    await db.updateTable('WorkflowMetaRun').set({ pauseRequested: 1, status: run.currentItem?.status === 'running' ? 'running' : 'paused', updatedAt: now }).where('metaRunId', '=', metaRunId).execute();
    await insertEvent(db, { eventId: this.createId(), metaRunId, itemId: run.currentItem?.itemId ?? null, kind: 'meta_run_pause_requested', message: 'Pause requested. The run will stop before starting another bead.', data: {}, now });
    return this.getRun(metaRunId);
  }

  async resumeRun(metaRunId: string): Promise<BeadMetaWorkflowRunReadModel> {
    const run = await this.getRequiredRun(metaRunId);
    if (run.status === 'blocked' || run.status === 'failed') throw new BeadMetaWorkflowError('META_WORKFLOW_INVALID_STATE', 'Resolve the blocked bead before resuming this meta-workflow.', { status: 409 });
    if (run.status === 'completed' || run.status === 'cancelled') return run;
    const running = run.items.find((item) => item.status === 'running');
    if (running) {
      await (await this.getDb()).updateTable('WorkflowMetaRun').set({ status: 'running', pauseRequested: 0, updatedAt: this.now() }).where('metaRunId', '=', metaRunId).execute();
      return this.getRun(metaRunId);
    }
    const next = run.items.find((item) => item.status === 'pending');
    if (!next) return this.completeRun(metaRunId);
    return this.startItem(metaRunId, next.itemId);
  }

  async completeChild(input: { metaRunId: string; itemId: string; childRunId: string; summary: string; artifactRefs?: string[] }): Promise<BeadMetaWorkflowRunReadModel> {
    const run = await this.getRequiredRun(input.metaRunId);
    const item = run.items.find((candidate) => candidate.itemId === input.itemId);
    if (!item || item.status !== 'running' || item.childRunId !== input.childRunId) {
      throw new BeadMetaWorkflowError('META_WORKFLOW_STALE_CHILD', 'Child completion did not match the active bead.', { status: 409, issues: [{ code: 'META_WORKFLOW_STALE_CHILD', path: 'childRunId', message: 'Child completion did not match the active bead.' }] });
    }

    const provenance = run.provenance;
    const safeSummary = cleanRequired(input.summary, 'summary').slice(0, 4000);
    const note = await this.notes.appendResultNote({
      beadId: item.beadId,
      bodyMarkdown: `Workflow result for ${item.beadId}:\n\n${safeSummary}`,
      idempotencyKey: `meta-run:${run.metaRunId}:item:${item.itemId}:result-note`,
      provenance,
    });
    const now = this.now();
    const result = { summary: safeSummary, artifactRefs: input.artifactRefs ?? [], childRunId: input.childRunId };
    const db = await this.getDb();
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('WorkflowMetaRunItem').set({ status: 'completed', resultJson: stableJson(result), noteRef: note.noteRef, errorJson: null, updatedAt: now, completedAt: now }).where('itemId', '=', item.itemId).execute();
      await insertEvent(trx, { eventId: this.createId(), metaRunId: run.metaRunId, itemId: item.itemId, kind: 'meta_run_item_completed', message: `Completed ${item.beadId}.`, data: { beadId: item.beadId, childRunId: input.childRunId, noteRef: note.noteRef, artifactRefs: input.artifactRefs ?? [] }, now });
    });

    const after = await this.getRequiredRun(run.metaRunId);
    const hasNext = after.items.some((candidate) => candidate.status === 'pending');
    if (!hasNext) return this.completeRun(run.metaRunId);
    if (after.status === 'running' && (await this.getRunPauseRequested(run.metaRunId))) {
      await (await this.getDb()).updateTable('WorkflowMetaRun').set({ status: 'paused', currentIndex: nextPendingIndex(after), updatedAt: this.now() }).where('metaRunId', '=', run.metaRunId).execute();
      return this.getRun(run.metaRunId);
    }
    return this.resumeRun(run.metaRunId);
  }

  async failChild(input: { metaRunId: string; itemId: string; childRunId: string; message: string; code?: string }): Promise<BeadMetaWorkflowRunReadModel> {
    const run = await this.getRequiredRun(input.metaRunId);
    const item = run.items.find((candidate) => candidate.itemId === input.itemId);
    if (!item || item.status !== 'running' || item.childRunId !== input.childRunId) {
      throw new BeadMetaWorkflowError('META_WORKFLOW_STALE_CHILD', 'Child failure did not match the active bead.', { status: 409 });
    }
    const error: ProductSafeError = { code: input.code ?? 'child_workflow_blocked', message: scrubProductText(input.message), path: `items.${item.index}` };
    const now = this.now();
    const db = await this.getDb();
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('WorkflowMetaRunItem').set({ status: 'blocked', errorJson: stableJson(error), updatedAt: now, completedAt: now }).where('itemId', '=', item.itemId).execute();
      await trx.updateTable('WorkflowMetaRun').set({ status: 'blocked', blockedReasonJson: stableJson(error), currentIndex: item.index, updatedAt: now }).where('metaRunId', '=', run.metaRunId).execute();
      await insertEvent(trx, { eventId: this.createId(), metaRunId: run.metaRunId, itemId: item.itemId, kind: 'meta_run_item_blocked', message: `Blocked on ${item.beadId}.`, data: { beadId: item.beadId, error }, now });
    });
    return this.getRun(run.metaRunId);
  }

  async getRun(metaRunId: string): Promise<BeadMetaWorkflowRunReadModel> {
    const db = await this.getDb();
    const run = await db.selectFrom('WorkflowMetaRun').selectAll().where('metaRunId', '=', metaRunId).executeTakeFirst();
    if (!run) throw new BeadMetaWorkflowError('META_WORKFLOW_NOT_FOUND', `Meta-workflow ${metaRunId} was not found.`, { status: 404 });
    const items = await db.selectFrom('WorkflowMetaRunItem').selectAll().where('metaRunId', '=', metaRunId).orderBy('itemIndex', 'asc').execute();
    const events = await db.selectFrom('WorkflowMetaRunEvent').selectAll().where('metaRunId', '=', metaRunId).orderBy('createdAt', 'asc').execute();
    return mapRun(run, items, events);
  }

  private async startItem(metaRunId: string, itemId: string): Promise<BeadMetaWorkflowRunReadModel> {
    const run = await this.getRequiredRun(metaRunId);
    if (run.items.some((item) => item.status === 'running')) return run;
    const item = run.items.find((candidate) => candidate.itemId === itemId && candidate.status === 'pending');
    if (!item) return run;
    const lane = await this.resolveLane({ parentWorkspaceId: run.parentWorkspaceId, laneId: run.laneId, accessMode: 'read' });
    const childRunId = childRunIdFor(run.metaRunId, item.index);
    const idempotencyKey = `meta-run:${run.metaRunId}:item:${item.itemId}:child`;
    const now = this.now();
    const db = await this.getDb();
    const claimed = await db.transaction().execute(async (trx) => {
      const currentItems = await trx.selectFrom('WorkflowMetaRunItem').select(['itemId', 'status']).where('metaRunId', '=', run.metaRunId).execute();
      if (currentItems.some((candidate) => candidate.status === 'running')) return false;
      const target = currentItems.find((candidate) => candidate.itemId === item.itemId);
      if (!target || target.status !== 'pending') return false;
      await trx.updateTable('WorkflowMetaRunItem').set({ status: 'running', childRunId, startedAt: now, updatedAt: now }).where('itemId', '=', item.itemId).where('status', '=', 'pending').execute();
      await trx.updateTable('WorkflowMetaRun').set({ status: 'running', currentIndex: item.index, pauseRequested: 0, startedAt: run.startedAt ?? now, updatedAt: now }).where('metaRunId', '=', run.metaRunId).execute();
      await insertEvent(trx, { eventId: this.createId(), metaRunId: run.metaRunId, itemId: item.itemId, kind: 'meta_run_item_claimed', message: `Claimed ${item.beadId} for child workflow launch.`, data: { beadId: item.beadId, childRunId, idempotencyKey }, now });
      return true;
    });
    if (!claimed) return this.getRun(run.metaRunId);

    try {
      const child = await this.childRunner.startChild({
        metaRunId: run.metaRunId,
        itemId: item.itemId,
        bead: { beadId: item.beadId, title: item.title, status: item.beadStatus as BeadReadModel['status'], accessible: true },
        parentWorkspaceId: run.parentWorkspaceId,
        lane,
        childWorkflowDesignId: run.childWorkflowDesignId,
        childRunId,
        idempotencyKey,
      });
      await insertEvent(db, { eventId: this.createId(), metaRunId: run.metaRunId, itemId: item.itemId, kind: 'meta_run_item_started', message: `Started ${item.beadId}.`, data: { beadId: item.beadId, childRunId: child.childRunId ?? childRunId, artifactRefs: child.artifactRefs ?? [], childWorkflowDesignId: run.childWorkflowDesignId }, now: this.now() });
    } catch (error) {
      const failed = await this.failClaimedItem({ run, item, childRunId, error });
      return failed;
    }
    return this.getRun(run.metaRunId);
  }

  private async failClaimedItem(input: { run: BeadMetaWorkflowRunReadModel; item: BeadMetaWorkflowItemReadModel; childRunId: string; error: unknown }): Promise<BeadMetaWorkflowRunReadModel> {
    const message = input.error instanceof Error ? input.error.message : String(input.error);
    const productError: ProductSafeError = { code: 'child_workflow_launch_failed', message: scrubProductText(message), path: `items.${input.item.index}` };
    const now = this.now();
    const db = await this.getDb();
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('WorkflowMetaRunItem').set({ status: 'blocked', errorJson: stableJson(productError), updatedAt: now, completedAt: now }).where('itemId', '=', input.item.itemId).where('childRunId', '=', input.childRunId).execute();
      await trx.updateTable('WorkflowMetaRun').set({ status: 'blocked', blockedReasonJson: stableJson(productError), currentIndex: input.item.index, updatedAt: now }).where('metaRunId', '=', input.run.metaRunId).execute();
      await insertEvent(trx, { eventId: this.createId(), metaRunId: input.run.metaRunId, itemId: input.item.itemId, kind: 'meta_run_item_blocked', message: `Blocked on ${input.item.beadId}.`, data: { beadId: input.item.beadId, error: productError }, now });
    });
    return this.getRun(input.run.metaRunId);
  }

  private async completeRun(metaRunId: string): Promise<BeadMetaWorkflowRunReadModel> {
    const run = await this.getRequiredRun(metaRunId);
    const now = this.now();
    const summaries = run.items.filter((item) => item.status === 'completed').map((item) => ({ beadId: item.beadId, result: item.result, noteRef: item.noteRef }));
    await (await this.getDb()).updateTable('WorkflowMetaRun').set({ status: 'completed', currentIndex: run.items.length, resultSummaryJson: stableJson(summaries), updatedAt: now, completedAt: now }).where('metaRunId', '=', metaRunId).execute();
    return this.getRun(metaRunId);
  }

  private async getRequiredRun(metaRunId: string): Promise<BeadMetaWorkflowRunReadModel> {
    return this.getRun(metaRunId);
  }

  private async getRunPauseRequested(metaRunId: string): Promise<boolean> {
    const row = await (await this.getDb()).selectFrom('WorkflowMetaRun').select('pauseRequested').where('metaRunId', '=', metaRunId).executeTakeFirst();
    return row?.pauseRequested === 1;
  }

  private async readAndValidateBeads(beadIds: string[]): Promise<BeadReadModel[]> {
    const beads = await this.beads.readBeads(beadIds);
    const byId = new Map(beads.map((bead) => [bead.beadId, bead]));
    const issues: BeadMetaWorkflowIssue[] = [];
    const ordered = beadIds.map((beadId, index) => {
      const bead = byId.get(beadId);
      if (!bead) {
        issues.push({ code: 'META_WORKFLOW_BEAD_REMOVED', path: `beadIds.${index}`, message: `Bead ${beadId} was not found.` });
        return null;
      }
      if (!bead.accessible) issues.push({ code: 'META_WORKFLOW_BEAD_INACCESSIBLE', path: `beadIds.${index}`, message: `Bead ${beadId} is not accessible.` });
      if (bead.status === 'archived') issues.push({ code: 'META_WORKFLOW_BEAD_ARCHIVED', path: `beadIds.${index}`, message: `Bead ${beadId} is archived.` });
      if (bead.status === 'removed') issues.push({ code: 'META_WORKFLOW_BEAD_REMOVED', path: `beadIds.${index}`, message: `Bead ${beadId} was removed.` });
      return bead;
    });
    if (issues.length) throw new BeadMetaWorkflowError('META_WORKFLOW_INVALID_SELECTION', 'Bead selection is invalid.', { issues });
    return ordered.filter(Boolean) as BeadReadModel[];
  }

  private async resolveLane(input: { parentWorkspaceId: string; laneId?: string | null; accessMode: 'read' | 'write' }): Promise<SelectedLaneWorkspaceContext> {
    if (!this.laneStore) {
      if (input.laneId || input.accessMode === 'write') throw new BeadMetaWorkflowError('META_WORKFLOW_LANE_CONFLICT', 'Lane context is required for this meta-workflow.', { status: 409 });
      return {
        workspaceId: input.parentWorkspaceId,
        parentWorkspaceId: input.parentWorkspaceId,
        laneId: null,
        laneLabel: 'Parent workspace',
        cwdMode: 'parent_workspace',
        allowsWrites: false,
        provenance: { laneId: null, laneLabel: 'Parent workspace', parentWorkspaceId: input.parentWorkspaceId, parentBreadcrumb: `Workspace ${input.parentWorkspaceId}`, cwdMode: 'parent_workspace', selectedWorkspaceId: input.parentWorkspaceId },
      };
    }
    try {
      const context = await this.laneStore.getSelectedLaneWorkspaceContext({ parentWorkspaceId: input.parentWorkspaceId, laneId: input.laneId, accessMode: input.accessMode });
      if (input.accessMode === 'write') {
        const lane = input.laneId ? await this.laneStore.getLane(input.parentWorkspaceId, input.laneId) : null;
        if (!lane || lane.worktree.status === 'dirty' || lane.worktree.status === 'unknown' || !context.allowsWrites) {
          throw new BeadMetaWorkflowError('META_WORKFLOW_LANE_CONFLICT', 'Selected lane cannot safely accept write work.', { status: 409, issues: [{ code: 'META_WORKFLOW_LANE_CONFLICT', path: 'laneId', message: 'Selected lane cannot safely accept write work.' }] });
        }
      }
      return context;
    } catch (error) {
      if (error instanceof BeadMetaWorkflowError) throw error;
      if (error instanceof LaneStoreError) throw new BeadMetaWorkflowError('META_WORKFLOW_LANE_CONFLICT', error.message, { status: error.status, issues: [{ code: 'META_WORKFLOW_LANE_CONFLICT', path: 'laneId', message: error.message }] });
      throw error;
    }
  }
}

class DeterministicChildRunner implements MetaWorkflowChildRunner {
  async startChild(input: { childRunId: string }): Promise<{ childRunId: string }> {
    return { childRunId: input.childRunId };
  }
}

class InMemorySafeNoteWriter implements BeadResultNoteWriter {
  private readonly refs = new Map<string, string>();
  async appendResultNote(input: { beadId: string; idempotencyKey: string }): Promise<{ noteRef: string }> {
    const existing = this.refs.get(input.idempotencyKey);
    if (existing) return { noteRef: existing };
    const noteRef = `bead-note://${encodeURIComponent(input.beadId)}/${encodeURIComponent(input.idempotencyKey)}`;
    this.refs.set(input.idempotencyKey, noteRef);
    return { noteRef };
  }
}

function validateBeadSelection(beadIds: string[]): BeadMetaWorkflowIssue[] {
  const issues: BeadMetaWorkflowIssue[] = [];
  if (!Array.isArray(beadIds) || beadIds.length === 0) {
    issues.push({ code: 'META_WORKFLOW_INVALID_SELECTION', path: 'beadIds', message: 'Select at least one bead.' });
    return issues;
  }
  const seen = new Map<string, number>();
  beadIds.forEach((raw, index) => {
    const beadId = typeof raw === 'string' ? raw.trim() : '';
    if (!beadId) issues.push({ code: 'META_WORKFLOW_INVALID_SELECTION', path: `beadIds.${index}`, message: 'Bead id is required.' });
    const firstIndex = seen.get(beadId);
    if (firstIndex !== undefined) {
      issues.push({ code: 'META_WORKFLOW_DUPLICATE_BEAD', path: `beadIds.${index}`, message: `Duplicate bead ${beadId}; first selected at beadIds.${firstIndex}.` });
    }
    seen.set(beadId, index);
  });
  return issues;
}

async function insertEvent(db: Kysely<DB>, input: { eventId: string; metaRunId: string; itemId: string | null; kind: string; message: string; data: Record<string, unknown>; now: number }): Promise<void> {
  await db.insertInto('WorkflowMetaRunEvent').values({
    eventId: `${input.metaRunId}:${input.kind}:${input.itemId ?? 'run'}:${input.now}:${input.eventId}`,
    metaRunId: input.metaRunId,
    itemId: input.itemId,
    kind: input.kind,
    message: input.message,
    dataJson: stableJson(input.data),
    createdAt: input.now,
  } satisfies Insertable<WorkflowMetaRunEvent>).onConflict((oc) => oc.columns(['metaRunId', 'kind', 'itemId', 'dataJson']).doNothing()).execute();
}

function mapRun(run: Selectable<WorkflowMetaRun>, items: Selectable<WorkflowMetaRunItem>[], events: Selectable<WorkflowMetaRunEvent>[]): BeadMetaWorkflowRunReadModel {
  const mappedItems = items.map(mapItem);
  const currentItem = mappedItems.find((item) => item.index === run.currentIndex) ?? mappedItems.find((item) => item.status === 'running') ?? null;
  const progress = {
    total: mappedItems.length,
    completed: mappedItems.filter((item) => item.status === 'completed').length,
    pending: mappedItems.filter((item) => item.status === 'pending').length,
    running: mappedItems.filter((item) => item.status === 'running').length,
    blocked: mappedItems.filter((item) => item.status === 'blocked' || item.status === 'failed').length,
  };
  const blockedReason = parseNullableJson<ProductSafeError>(run.blockedReasonJson);
  return {
    metaRunId: run.metaRunId,
    parentWorkspaceId: run.parentWorkspaceId,
    laneId: run.laneId,
    status: run.status,
    currentIndex: run.currentIndex,
    childWorkflowDesignId: run.childWorkflowDesignId,
    title: run.title,
    summary: run.summary,
    currentItem,
    items: mappedItems,
    progress,
    nextAction: nextAction(run.status, currentItem, progress, blockedReason),
    blockedReason,
    provenance: parseJson<MetaWorkflowProvenance>(run.provenanceJson),
    events: events.map((event) => ({ eventId: event.eventId, kind: event.kind, message: event.message, itemId: event.itemId, data: parseJson<Record<string, unknown>>(event.dataJson), createdAt: event.createdAt })),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

function mapItem(row: Selectable<WorkflowMetaRunItem>): BeadMetaWorkflowItemReadModel {
  return {
    itemId: row.itemId,
    beadId: row.beadId,
    title: row.title,
    beadStatus: row.beadStatus,
    index: row.itemIndex,
    status: row.status,
    childRunId: row.childRunId,
    noteRef: row.noteRef,
    result: parseNullableJson<Record<string, unknown>>(row.resultJson),
    error: parseNullableJson<ProductSafeError>(row.errorJson),
    provenance: parseJson<Record<string, unknown>>(row.provenanceJson),
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

function childRunIdFor(metaRunId: string, itemIndex: number): string {
  return `child-${metaRunId}-${itemIndex}`;
}

function nextAction(status: WorkflowMetaRunStatus, currentItem: BeadMetaWorkflowItemReadModel | null, progress: { pending: number }, blockedReason: ProductSafeError | null): string {
  if (status === 'completed') return 'All selected beads completed.';
  if (status === 'paused') return currentItem ? `Resume when ready to continue with ${currentItem.beadId}.` : 'Resume when ready to start the next bead.';
  if (status === 'blocked') return blockedReason?.message ?? 'Resolve the blocked bead before continuing.';
  if (currentItem?.status === 'running') return `Waiting for ${currentItem.beadId} to complete before starting the next bead.`;
  if (progress.pending > 0) return 'Ready to start the next bead.';
  return 'No further action is required.';
}

function nextPendingIndex(run: BeadMetaWorkflowRunReadModel): number {
  return run.items.find((item) => item.status === 'pending')?.index ?? run.items.length;
}

function isFinal(status: WorkflowMetaRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function cleanRequired(value: string, label: string): string {
  const cleaned = value.trim();
  if (!cleaned) throw new BeadMetaWorkflowError('META_WORKFLOW_INVALID_SELECTION', `${label} is required.`, { issues: [{ code: 'META_WORKFLOW_INVALID_SELECTION', path: label, message: `${label} is required.` }] });
  return cleaned;
}

function cleanOptional(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned || null;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function parseNullableJson<T>(value: string | null): T | null {
  return value ? parseJson<T>(value) : null;
}

function scrubProductText(value: string): string {
  return value
    .replace(/\bbd\s+[^\n]*/giu, 'workflow command')
    .replace(/\bgit\s+[^\n]*/giu, 'version control action')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[redacted-email]')
    .replace(/\/Users\/[^\s]+/gu, '[redacted-home]')
    .slice(0, 2000);
}
