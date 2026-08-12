import type { Kysely, Selectable } from 'kysely';
import type { DB, WorkflowBatch, WorkflowBatchItem, WorkflowBatchItemStatus, WorkflowBatchStatus } from '../../../../store/kysely_types';
import type { PersistedWorkflowRuntimeService, WorkflowRoleSessionBindingInput } from './persistedWorkflowRuntime';
import { DbWorkflowDesignStore } from './workflowDesignStore';

export interface WorkflowBatchCapacityConfig {
  globalActiveRunLimit: number;
  workspaceActiveRunLimit: number;
}

export const DEFAULT_WORKFLOW_BATCH_CAPACITY: WorkflowBatchCapacityConfig = {
  globalActiveRunLimit: 4,
  workspaceActiveRunLimit: 1,
};

export interface WorkflowBatchItemInput {
  inputs: Record<string, unknown>;
  additionalInstructions?: string | null;
  roleBindings: Record<string, WorkflowRoleSessionBindingInput>;
  error?: { code: string; message: string; fieldErrors?: Record<string, string> } | null;
}

export interface WorkflowBatchReadModel {
  batchId: string;
  designId: string;
  designVersion: number;
  workspaceId: string;
  status: WorkflowBatchStatus;
  counts: Record<WorkflowBatchItemStatus, number> & { total: number };
  items: WorkflowBatchItemReadModel[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowBatchItemReadModel {
  batchItemId: string;
  itemIndex: number;
  status: WorkflowBatchItemStatus;
  runId: string | null;
  input: Record<string, unknown>;
  error: { code: string; message: string; fieldErrors?: Record<string, string> } | null;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export class WorkflowBatchSchedulerService {
  private readonly db: Kysely<DB>;
  private readonly designStore: DbWorkflowDesignStore;
  private readonly runtime: Pick<PersistedWorkflowRuntimeService, 'launch'>;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly capacity: WorkflowBatchCapacityConfig;

  constructor(options: {
    db: Kysely<DB>;
    designStore?: DbWorkflowDesignStore;
    runtime: Pick<PersistedWorkflowRuntimeService, 'launch'>;
    now?: () => number;
    createId?: () => string;
    capacity?: Partial<WorkflowBatchCapacityConfig>;
  }) {
    this.db = options.db;
    this.designStore = options.designStore ?? new DbWorkflowDesignStore({ db: options.db });
    this.runtime = options.runtime;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? (() => `workflow-batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    this.capacity = { ...DEFAULT_WORKFLOW_BATCH_CAPACITY, ...options.capacity };
  }

  async enqueueBatch(input: {
    batchId?: string;
    designId: string;
    version?: number;
    workspaceId: string;
    items: WorkflowBatchItemInput[];
  }): Promise<WorkflowBatchReadModel> {
    const design = await this.designStore.getDesign(input.designId);
    const version = input.version ?? design?.latestPublishedVersion;
    if (version == null) throw new Error(`Workflow design ${input.designId} has no published version`);
    const published = await this.designStore.getVersion(input.designId, version);
    if (!published) throw new Error(`Workflow design ${input.designId} version ${version} not found`);
    const now = this.now();
    const batchId = input.batchId ?? this.createId();
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('WorkflowBatch').values({
        batchId,
        designId: input.designId,
        designVersion: version,
        workspaceId: input.workspaceId,
        status: input.items.some((item) => !item.error) ? 'pending' : 'failed',
        createdAt: now,
        updatedAt: now,
      }).execute();
      for (const [index, item] of input.items.entries()) {
        const failed = item.error ?? null;
        await trx.insertInto('WorkflowBatchItem').values({
          batchItemId: `${batchId}-item-${index}`,
          batchId,
          itemIndex: index,
          status: failed ? 'failed' : 'pending',
          runId: null,
          runSnapshotId: null,
          inputJson: stableJson(item.inputs),
          additionalInstructions: item.additionalInstructions?.trim() || null,
          roleBindingsJson: stableJson(item.roleBindings),
          errorJson: failed ? stableJson(failed) : null,
          createdAt: now,
          updatedAt: now,
          startedAt: null,
          completedAt: failed ? now : null,
        }).execute();
      }
    });
    return this.schedule({ batchId });
  }

  async schedule(input: { batchId?: string } = {}): Promise<WorkflowBatchReadModel | null> {
    await this.syncRunningItems();
    const batch = input.batchId ? await this.getBatch(input.batchId) : null;
    const pending = await this.db.selectFrom('WorkflowBatchItem')
      .innerJoin('WorkflowBatch', 'WorkflowBatch.batchId', 'WorkflowBatchItem.batchId')
      .select([
        'WorkflowBatchItem.batchItemId',
        'WorkflowBatchItem.batchId',
        'WorkflowBatchItem.itemIndex',
        'WorkflowBatchItem.inputJson',
        'WorkflowBatchItem.additionalInstructions',
        'WorkflowBatchItem.roleBindingsJson',
        'WorkflowBatch.designId',
        'WorkflowBatch.designVersion',
        'WorkflowBatch.workspaceId',
      ])
      .where('WorkflowBatchItem.status', '=', 'pending')
      .$if(Boolean(input.batchId), (qb) => qb.where('WorkflowBatchItem.batchId', '=', input.batchId!))
      .orderBy('WorkflowBatchItem.createdAt', 'asc')
      .orderBy('WorkflowBatchItem.itemIndex', 'asc')
      .execute();

    for (const item of pending) {
      const active = await this.countActiveRuns(item.workspaceId);
      if (active.global >= this.capacity.globalActiveRunLimit) break;
      if (active.workspace >= this.capacity.workspaceActiveRunLimit) continue;
      await this.startPendingItem(item);
    }
    await this.updateBatchStatuses();
    return input.batchId ? this.getBatch(input.batchId) : batch;
  }

  async getBatch(batchId: string): Promise<WorkflowBatchReadModel | null> {
    await this.syncRunningItems(batchId);
    await this.updateBatchStatuses(batchId);
    const batch = await this.db.selectFrom('WorkflowBatch').selectAll().where('batchId', '=', batchId).executeTakeFirst();
    if (!batch) return null;
    const items = await this.db.selectFrom('WorkflowBatchItem').selectAll().where('batchId', '=', batchId).orderBy('itemIndex', 'asc').execute();
    return mapBatch(batch, items);
  }

  async listBatches(workspaceId: string, limit = 10): Promise<WorkflowBatchReadModel[]> {
    await this.syncRunningItems();
    await this.updateBatchStatuses();
    const rows = await this.db.selectFrom('WorkflowBatch').selectAll().where('workspaceId', '=', workspaceId).orderBy('updatedAt', 'desc').limit(limit).execute();
    const result: WorkflowBatchReadModel[] = [];
    for (const row of rows) {
      const items = await this.db.selectFrom('WorkflowBatchItem').selectAll().where('batchId', '=', row.batchId).orderBy('itemIndex', 'asc').execute();
      result.push(mapBatch(row, items));
    }
    return result;
  }

  private async startPendingItem(item: {
    batchItemId: string;
    batchId: string;
    itemIndex: number;
    inputJson: string;
    additionalInstructions: string | null;
    roleBindingsJson: string;
    designId: string;
    designVersion: number;
    workspaceId: string;
  }): Promise<void> {
    const now = this.now();
    const runId = `${item.batchItemId}-run`;
    const runSnapshotId = `${item.batchItemId}-snapshot`;
    await this.db.updateTable('WorkflowBatchItem').set({ status: 'running', runId, runSnapshotId, startedAt: now, updatedAt: now }).where('batchItemId', '=', item.batchItemId).where('status', '=', 'pending').execute();
    try {
      await this.runtime.launch({
        runId,
        runSnapshotId,
        designId: item.designId,
        version: item.designVersion,
        workspaceId: item.workspaceId,
        inputs: parseRecord(item.inputJson),
        additionalInstructions: item.additionalInstructions,
        roleBindings: parseRoleBindings(item.roleBindingsJson),
      });
    } catch (error) {
      const failedAt = this.now();
      await this.db.updateTable('WorkflowBatchItem').set({
        status: 'failed',
        errorJson: stableJson(normalizeError(error)),
        completedAt: failedAt,
        updatedAt: failedAt,
      }).where('batchItemId', '=', item.batchItemId).execute();
    }
  }

  private async countActiveRuns(workspaceId: string): Promise<{ global: number; workspace: number }> {
    const rows = await this.db.selectFrom('WorkflowPersistedRun').select(['workspaceId', 'coreSnapshotJson']).where('status', '=', 'running').execute();
    let global = 0;
    let workspace = 0;
    for (const row of rows) {
      if (!hasActiveWaitingTurn(row.coreSnapshotJson)) continue;
      global += 1;
      if (row.workspaceId === workspaceId) workspace += 1;
    }
    return { global, workspace };
  }

  private async syncRunningItems(batchId?: string): Promise<void> {
    const running = await this.db.selectFrom('WorkflowBatchItem')
      .selectAll()
      .where('status', '=', 'running')
      .$if(Boolean(batchId), (qb) => qb.where('batchId', '=', batchId!))
      .execute();
    for (const item of running) {
      if (!item.runId) continue;
      const run = await this.db.selectFrom('WorkflowPersistedRun').select(['status', 'updatedAt']).where('runId', '=', item.runId).executeTakeFirst();
      if (!run || run.status === 'running') continue;
      await this.db.updateTable('WorkflowBatchItem').set({ status: run.status, completedAt: run.updatedAt, updatedAt: this.now() }).where('batchItemId', '=', item.batchItemId).execute();
    }
  }

  private async updateBatchStatuses(batchId?: string): Promise<void> {
    const batches = await this.db.selectFrom('WorkflowBatch').selectAll().$if(Boolean(batchId), (qb) => qb.where('batchId', '=', batchId!)).execute();
    for (const batch of batches) {
      const items = await this.db.selectFrom('WorkflowBatchItem').select(['status']).where('batchId', '=', batch.batchId).execute();
      const nextStatus = computeBatchStatus(items.map((item) => item.status));
      if (nextStatus !== batch.status) {
        await this.db.updateTable('WorkflowBatch').set({ status: nextStatus, updatedAt: this.now() }).where('batchId', '=', batch.batchId).execute();
      }
    }
  }
}

function computeBatchStatus(statuses: WorkflowBatchItemStatus[]): WorkflowBatchStatus {
  if (statuses.some((status) => status === 'pending' || status === 'running')) return 'running';
  if (statuses.some((status) => status === 'failed' || status === 'blocked' || status === 'cancelled')) return 'failed';
  return 'completed';
}

function mapBatch(batch: Selectable<WorkflowBatch>, items: Selectable<WorkflowBatchItem>[]): WorkflowBatchReadModel {
  const counts = { total: items.length, pending: 0, running: 0, completed: 0, blocked: 0, failed: 0, cancelled: 0 } satisfies WorkflowBatchReadModel['counts'];
  for (const item of items) counts[item.status] += 1;
  return {
    batchId: batch.batchId,
    designId: batch.designId,
    designVersion: batch.designVersion,
    workspaceId: batch.workspaceId,
    status: batch.status,
    counts,
    items: items.map((item) => ({
      batchItemId: item.batchItemId,
      itemIndex: item.itemIndex,
      status: item.status,
      runId: item.runId,
      input: parseRecord(item.inputJson),
      error: item.errorJson ? normalizeStoredError(parseRecord(item.errorJson)) : null,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
      updatedAt: item.updatedAt,
    })),
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
}


function hasActiveWaitingTurn(coreSnapshotJson: string): boolean {
  const snapshot = parseRecord(coreSnapshotJson);
  return snapshot.status === 'running' && typeof (snapshot.waitingFor as { kind?: unknown } | undefined)?.kind === 'string';
}

function parseRoleBindings(json: string): Record<string, WorkflowRoleSessionBindingInput> {
  return parseRecord(json) as Record<string, WorkflowRoleSessionBindingInput>;
}

function parseRecord(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeStoredError(record: Record<string, unknown>): { code: string; message: string; fieldErrors?: Record<string, string> } {
  const fieldErrors = record.fieldErrors && typeof record.fieldErrors === 'object' && !Array.isArray(record.fieldErrors) ? record.fieldErrors as Record<string, string> : undefined;
  return { code: typeof record.code === 'string' ? record.code : 'workflow_batch_item_failed', message: typeof record.message === 'string' ? record.message : 'Batch item failed.', ...(fieldErrors ? { fieldErrors } : {}) };
}

function normalizeError(error: unknown): { code: string; message: string } {
  return { code: 'workflow_batch_item_failed', message: error instanceof Error ? error.message : String(error) };
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}
