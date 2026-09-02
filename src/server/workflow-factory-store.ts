import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import type {
  DB,
  WorkflowFactoryWorkItemSource,
  WorkflowFactoryWorkItemStatus,
} from '../store/kysely_types';

export type JsonValue = unknown;

export interface WorkflowFactoryWorkItemReadModel {
  itemId: string;
  factoryId: string | null;
  workflowInstanceId: string | null;
  workflowRunId: string | null;
  teamId: string | null;
  laneId: string | null;
  roleId: string | null;
  workspaceId: string;
  status: WorkflowFactoryWorkItemStatus;
  priority: number;
  prompt: string;
  promptHash: string;
  promptLength: number;
  source: WorkflowFactoryWorkItemSource;
  reservedSessionId: string | null;
  reservedBindingId: string | null;
  queueItemId: string | null;
  attemptCount: number;
  lastError: JsonValue | null;
  metadata: JsonValue | null;
  createdAt: number;
  updatedAt: number;
  reservedAt: number | null;
  queuedAt: number | null;
  completedAt: number | null;
  cancelledAt: number | null;
}

export interface CreateWorkflowFactoryWorkItemInput {
  itemId: string;
  factoryId?: string | null;
  workflowInstanceId?: string | null;
  workflowRunId?: string | null;
  teamId?: string | null;
  laneId?: string | null;
  roleId?: string | null;
  workspaceId: string;
  priority?: number;
  prompt: string;
  source?: WorkflowFactoryWorkItemSource;
  metadata?: JsonValue | null;
}

export interface ListFactoryWorkItemsFilters {
  status?: WorkflowFactoryWorkItemStatus;
  workspaceId?: string;
  roleId?: string | null;
  laneId?: string | null;
  limit?: number;
}

export interface ReserveFactoryWorkItemArgs {
  sessionId: string;
  bindingId?: string | null;
}

export interface ReleaseStaleReservationsInput {
  olderThanMs: number;
}

export class WorkflowFactoryStoreTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowFactoryStoreTransitionError';
  }
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export class DbWorkflowFactoryStore {
  private readonly getDbHandle: () => Promise<Kysely<DB>> | Kysely<DB>;
  private readonly now: () => number;

  constructor(options: { db?: Kysely<DB>; getDb?: () => Promise<Kysely<DB>> | Kysely<DB>; now?: () => number }) {
    if (!options.db && !options.getDb) throw new Error('DbWorkflowFactoryStore requires db or getDb');
    this.getDbHandle = options.getDb ?? (() => options.db as Kysely<DB>);
    this.now = options.now ?? Date.now;
  }

  async createWorkItem(input: CreateWorkflowFactoryWorkItemInput): Promise<WorkflowFactoryWorkItemReadModel> {
    const prompt = input.prompt;
    if (!prompt.trim()) throw new Error('Factory work item prompt is required');
    const db = await this.getDb();
    const now = this.now();
    await db
      .insertInto('WorkflowFactoryWorkItem')
      .values({
        itemId: input.itemId,
        factoryId: input.factoryId ?? null,
        workflowInstanceId: input.workflowInstanceId ?? null,
        workflowRunId: input.workflowRunId ?? null,
        teamId: input.teamId ?? null,
        laneId: input.laneId ?? null,
        roleId: input.roleId ?? null,
        workspaceId: input.workspaceId,
        status: 'pending',
        priority: input.priority ?? 0,
        prompt,
        promptHash: sha256(prompt),
        promptLength: prompt.length,
        source: input.source ?? 'workflow',
        reservedSessionId: null,
        reservedBindingId: null,
        queueItemId: null,
        attemptCount: 0,
        lastErrorJson: null,
        metadataJson: input.metadata == null ? null : serializeJson(input.metadata),
        createdAt: now,
        updatedAt: now,
        reservedAt: null,
        queuedAt: null,
        completedAt: null,
        cancelledAt: null,
      })
      .execute();
    return this.getRequiredWorkItem(input.itemId);
  }

  async listWorkItems(filters: ListFactoryWorkItemsFilters = {}): Promise<WorkflowFactoryWorkItemReadModel[]> {
    const db = await this.getDb();
    const limit = clampLimit(filters.limit);
    let query = db.selectFrom('WorkflowFactoryWorkItem').selectAll();
    if (filters.status) query = query.where('status', '=', filters.status);
    if (filters.workspaceId) query = query.where('workspaceId', '=', filters.workspaceId);
    if (filters.roleId !== undefined) query = filters.roleId == null ? query.where('roleId', 'is', null) : query.where('roleId', '=', filters.roleId);
    if (filters.laneId !== undefined) query = filters.laneId == null ? query.where('laneId', 'is', null) : query.where('laneId', '=', filters.laneId);
    const rows = await query
      .orderBy('priority', 'desc')
      .orderBy('createdAt', 'asc')
      .orderBy('itemId', 'asc')
      .limit(limit)
      .execute();
    return rows.map(mapWorkItem);
  }

  async reserveWorkItem(itemId: string, args: ReserveFactoryWorkItemArgs): Promise<WorkflowFactoryWorkItemReadModel> {
    const db = await this.getDb();
    const now = this.now();
    await assertUpdated(
      db
        .updateTable('WorkflowFactoryWorkItem')
        .set({
          status: 'reserved',
          reservedSessionId: args.sessionId,
          reservedBindingId: args.bindingId ?? null,
          reservedAt: now,
          updatedAt: now,
          lastErrorJson: null,
        })
        .where('itemId', '=', itemId)
        .where('status', '=', 'pending')
        .executeTakeFirst(),
      `Cannot reserve factory work item ${itemId} from its current state`,
    );
    return this.getRequiredWorkItem(itemId);
  }

  async markWorkItemQueued(itemId: string, args: { queueItemId: string }): Promise<WorkflowFactoryWorkItemReadModel> {
    const db = await this.getDb();
    const now = this.now();
    await assertUpdated(
      db
        .updateTable('WorkflowFactoryWorkItem')
        .set((eb) => ({
          status: 'queued' as const,
          queueItemId: args.queueItemId,
          attemptCount: eb('attemptCount', '+', 1),
          queuedAt: now,
          updatedAt: now,
          lastErrorJson: null,
        }))
        .where('itemId', '=', itemId)
        .where('status', '=', 'reserved')
        .executeTakeFirst(),
      `Cannot mark factory work item ${itemId} queued from its current state`,
    );
    return this.getRequiredWorkItem(itemId);
  }

  async releaseReservationForRetry(itemId: string, error: JsonValue): Promise<WorkflowFactoryWorkItemReadModel> {
    const db = await this.getDb();
    const now = this.now();
    await assertUpdated(
      db
        .updateTable('WorkflowFactoryWorkItem')
        .set({
          status: 'pending',
          reservedSessionId: null,
          reservedBindingId: null,
          reservedAt: null,
          updatedAt: now,
          lastErrorJson: serializeJson(error),
        })
        .where('itemId', '=', itemId)
        .where('status', '=', 'reserved')
        .executeTakeFirst(),
      `Cannot release factory work item ${itemId} from its current state`,
    );
    return this.getRequiredWorkItem(itemId);
  }

  async releaseStaleReservations(input: ReleaseStaleReservationsInput): Promise<WorkflowFactoryWorkItemReadModel[]> {
    const db = await this.getDb();
    const now = this.now();
    const cutoff = now - Math.max(0, Math.floor(input.olderThanMs));
    const staleRows = await db
      .selectFrom('WorkflowFactoryWorkItem')
      .select(['itemId'])
      .where('status', '=', 'reserved')
      .where('reservedAt', 'is not', null)
      .where('reservedAt', '<=', cutoff)
      .orderBy('reservedAt', 'asc')
      .orderBy('itemId', 'asc')
      .execute();
    if (staleRows.length === 0) return [];

    await db
      .updateTable('WorkflowFactoryWorkItem')
      .set({
        status: 'pending',
        reservedSessionId: null,
        reservedBindingId: null,
        reservedAt: null,
        updatedAt: now,
        lastErrorJson: serializeJson({ reason: 'reservation_expired' }),
      })
      .where('status', '=', 'reserved')
      .where('reservedAt', 'is not', null)
      .where('reservedAt', '<=', cutoff)
      .execute();

    const releasedIds = staleRows.map((row) => row.itemId);
    const rows = await db
      .selectFrom('WorkflowFactoryWorkItem')
      .selectAll()
      .where('itemId', 'in', releasedIds)
      .orderBy('priority', 'desc')
      .orderBy('createdAt', 'asc')
      .orderBy('itemId', 'asc')
      .execute();
    return rows.map(mapWorkItem);
  }

  async completeWorkItem(itemId: string): Promise<WorkflowFactoryWorkItemReadModel> {
    const db = await this.getDb();
    const now = this.now();
    await assertUpdated(
      db.updateTable('WorkflowFactoryWorkItem').set({ status: 'completed', completedAt: now, updatedAt: now }).where('itemId', '=', itemId).where('status', '=', 'queued').executeTakeFirst(),
      `Cannot complete factory work item ${itemId} from its current state`,
    );
    return this.getRequiredWorkItem(itemId);
  }

  async cancelWorkItem(itemId: string): Promise<WorkflowFactoryWorkItemReadModel> {
    const db = await this.getDb();
    const now = this.now();
    await assertUpdated(
      db.updateTable('WorkflowFactoryWorkItem').set({ status: 'cancelled', cancelledAt: now, updatedAt: now }).where('itemId', '=', itemId).where('status', 'in', ['pending', 'reserved']).executeTakeFirst(),
      `Cannot cancel factory work item ${itemId} from its current state`,
    );
    return this.getRequiredWorkItem(itemId);
  }

  async getWorkItem(itemId: string): Promise<WorkflowFactoryWorkItemReadModel | null> {
    const db = await this.getDb();
    const row = await db.selectFrom('WorkflowFactoryWorkItem').selectAll().where('itemId', '=', itemId).executeTakeFirst();
    return row ? mapWorkItem(row) : null;
  }

  async getRequiredWorkItem(itemId: string): Promise<WorkflowFactoryWorkItemReadModel> {
    const item = await this.getWorkItem(itemId);
    if (!item) throw new Error(`Factory work item ${itemId} not found`);
    return item;
  }

  private async getDb(): Promise<Kysely<DB>> {
    return this.getDbHandle();
  }
}

function mapWorkItem(row: Record<string, any>): WorkflowFactoryWorkItemReadModel {
  return {
    itemId: row.itemId,
    factoryId: row.factoryId,
    workflowInstanceId: row.workflowInstanceId,
    workflowRunId: row.workflowRunId,
    teamId: row.teamId,
    laneId: row.laneId,
    roleId: row.roleId,
    workspaceId: row.workspaceId,
    status: row.status,
    priority: row.priority,
    prompt: row.prompt,
    promptHash: row.promptHash,
    promptLength: row.promptLength,
    source: row.source,
    reservedSessionId: row.reservedSessionId,
    reservedBindingId: row.reservedBindingId,
    queueItemId: row.queueItemId,
    attemptCount: row.attemptCount,
    lastError: parseJson(row.lastErrorJson),
    metadata: parseJson(row.metadataJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    reservedAt: row.reservedAt,
    queuedAt: row.queuedAt,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
  };
}

function serializeJson(value: JsonValue): string {
  return JSON.stringify(value ?? null);
}

function parseJson(value: string | null | undefined): JsonValue | null {
  if (value == null) return null;
  return JSON.parse(value) as JsonValue;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function clampLimit(limit: number | undefined): number {
  if (limit == null) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

async function assertUpdated(resultPromise: Promise<{ numUpdatedRows?: bigint | number }>, message: string): Promise<void> {
  const result = await resultPromise;
  const count = Number(result.numUpdatedRows ?? 0);
  if (count !== 1) throw new WorkflowFactoryStoreTransitionError(message);
}
