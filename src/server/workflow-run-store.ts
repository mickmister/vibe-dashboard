import type { Selectable, Kysely } from 'kysely';
import type { DB, WorkflowRun, WorkflowRunEvent } from '../store/kysely_types';

export type WorkflowRunStatus = WorkflowRun['status'];

export interface WorkflowRunListFilters {
  workflowId?: string;
  status?: WorkflowRunStatus;
  vkWorkspaceId?: string;
  vkSessionId?: string;
  vkQueueItemId?: string;
  limit?: number;
  offset?: number;
}

export interface WorkflowRunEventListOptions {
  limit?: number;
  offset?: number;
}

export interface WorkflowRunReadModel {
  runId: string;
  workflowId: string;
  trigger: string;
  status: WorkflowRunStatus;
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  input: unknown;
  output: unknown | null;
  error: unknown | null;
  vkWorkspaceId: string | null;
  vkSessionId: string | null;
  vkQueueItemId: string | null;
  vkExecutionProcessId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunEventReadModel {
  id: number;
  runId: string;
  eventIndex: number;
  eventType: WorkflowRunEvent['eventType'];
  stepId: string | null;
  level: WorkflowRunEvent['level'];
  message: string;
  timestamp: number;
  data: unknown | null;
  createdAt: string;
}

export interface WorkflowRunListResult {
  runs: WorkflowRunReadModel[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface WorkflowRunEventListResult {
  events: WorkflowRunEventReadModel[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface WorkflowRunReader {
  listRuns(filters?: WorkflowRunListFilters): Promise<WorkflowRunListResult>;
  getRun(runId: string): Promise<WorkflowRunReadModel | null>;
  listRunEvents(runId: string, options?: WorkflowRunEventListOptions): Promise<WorkflowRunEventListResult | null>;
}

const DEFAULT_RUN_LIMIT = 50;
const MAX_RUN_LIMIT = 100;
const DEFAULT_EVENT_LIMIT = 500;
const MAX_EVENT_LIMIT = 500;

export class DbWorkflowRunReader implements WorkflowRunReader {
  private readonly getDbHandle: () => Promise<Kysely<DB>> | Kysely<DB>;

  constructor(options: { db?: Kysely<DB>; getDb?: () => Promise<Kysely<DB>> | Kysely<DB> }) {
    if (!options.db && !options.getDb) {
      throw new Error('DbWorkflowRunReader requires db or getDb');
    }
    this.getDbHandle = options.getDb ?? (() => options.db as Kysely<DB>);
  }

  async listRuns(filters: WorkflowRunListFilters = {}): Promise<WorkflowRunListResult> {
    const limit = clampLimit(filters.limit, DEFAULT_RUN_LIMIT, MAX_RUN_LIMIT);
    const offset = normalizeOffset(filters.offset);
    const db = await this.getDb();
    let query = db.selectFrom('WorkflowRun').selectAll();

    if (filters.workflowId) query = query.where('workflowId', '=', filters.workflowId);
    if (filters.status) query = query.where('status', '=', filters.status);
    if (filters.vkWorkspaceId) query = query.where('vkWorkspaceId', '=', filters.vkWorkspaceId);
    if (filters.vkSessionId) query = query.where('vkSessionId', '=', filters.vkSessionId);
    if (filters.vkQueueItemId) query = query.where('vkQueueItemId', '=', filters.vkQueueItemId);

    const rows = await query
      .orderBy('startedAt', 'desc')
      .orderBy('runId', 'desc')
      .limit(limit + 1)
      .offset(offset)
      .execute();

    return {
      runs: rows.slice(0, limit).map(mapRun),
      limit,
      offset,
      hasMore: rows.length > limit,
    };
  }

  async getRun(runId: string): Promise<WorkflowRunReadModel | null> {
    const db = await this.getDb();
    const row = await db.selectFrom('WorkflowRun').selectAll().where('runId', '=', runId).executeTakeFirst();
    return row ? mapRun(row) : null;
  }

  async listRunEvents(runId: string, options: WorkflowRunEventListOptions = {}): Promise<WorkflowRunEventListResult | null> {
    const db = await this.getDb();
    const exists = await db.selectFrom('WorkflowRun').select('runId').where('runId', '=', runId).executeTakeFirst();
    if (!exists) return null;

    const limit = clampLimit(options.limit, DEFAULT_EVENT_LIMIT, MAX_EVENT_LIMIT);
    const offset = normalizeOffset(options.offset);
    const rows = await db
      .selectFrom('WorkflowRunEvent')
      .selectAll()
      .where('runId', '=', runId)
      .orderBy('eventIndex', 'asc')
      .limit(limit + 1)
      .offset(offset)
      .execute();

    return {
      events: rows.slice(0, limit).map(mapEvent),
      limit,
      offset,
      hasMore: rows.length > limit,
    };
  }

  private async getDb(): Promise<Kysely<DB>> {
    return this.getDbHandle();
  }
}

export function parseWorkflowRunStatus(value: string | null): WorkflowRunStatus | undefined {
  return value === 'running' || value === 'completed' || value === 'failed' ? value : undefined;
}

export function parsePositiveInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function clampLimit(value: number | undefined, defaultLimit: number, maxLimit: number): number {
  if (!Number.isSafeInteger(value) || value == null || value <= 0) return defaultLimit;
  return Math.min(value, maxLimit);
}

function normalizeOffset(value: number | undefined): number {
  return Number.isSafeInteger(value) && value != null && value > 0 ? value : 0;
}

function mapRun(row: Selectable<WorkflowRun>): WorkflowRunReadModel {
  return {
    runId: row.runId,
    workflowId: row.workflowId,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    durationMs: row.durationMs,
    input: parseStoredJson(row.inputJson),
    output: row.outputJson == null ? null : parseStoredJson(row.outputJson),
    error: row.errorJson == null ? null : parseStoredJson(row.errorJson),
    vkWorkspaceId: row.vkWorkspaceId,
    vkSessionId: row.vkSessionId,
    vkQueueItemId: row.vkQueueItemId,
    vkExecutionProcessId: row.vkExecutionProcessId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapEvent(row: Selectable<WorkflowRunEvent>): WorkflowRunEventReadModel {
  return {
    id: row.id,
    runId: row.runId,
    eventIndex: row.eventIndex,
    eventType: row.eventType,
    stepId: row.stepId,
    level: row.level,
    message: row.message,
    timestamp: row.timestamp,
    data: row.dataJson == null ? null : parseStoredJson(row.dataJson),
    createdAt: row.createdAt,
  };
}

function parseStoredJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
