import type { Kysely } from 'kysely';
import type {
  DB,
  ResponseCollectionMode,
  ResponseCollectionStatus,
  ResponsePipeDeliveryStatus,
} from '../store/kysely_types';

export type JsonValue = unknown;

export interface ResponseCollectionReadModel {
  collectionId: string;
  workflowInstanceId: string | null;
  workflowRunId: string | null;
  triggerId: string | null;
  mode: ResponseCollectionMode;
  status: ResponseCollectionStatus;
  expectedCount: number | null;
  receivedCount: number;
  metadata: JsonValue | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface ResponsePipeDeliveryReadModel {
  deliveryId: string;
  collectionId: string | null;
  workflowInstanceId: string | null;
  workflowRunId: string | null;
  triggerId: string | null;
  sourceWorkspaceId: string;
  sourceSessionId: string;
  sourceExecutionProcessId: string;
  sourceCompletedAt: number | null;
  sourceRoleId: string | null;
  sourceLaneId: string | null;
  targetWorkspaceId: string;
  targetSessionId: string;
  targetRoleId: string | null;
  targetLaneId: string | null;
  templateId: string;
  templateVersion: number | null;
  templateHash: string;
  renderedPromptHash: string | null;
  renderedPromptLength: number | null;
  dedupeKey: string;
  status: ResponsePipeDeliveryStatus;
  attemptCount: number;
  queueItemId: string | null;
  error: JsonValue | null;
  metadata: JsonValue | null;
  createdAt: number;
  updatedAt: number;
  queuedAt: number | null;
  completedAt: number | null;
}

export interface CreateResponseCollectionInput {
  collectionId: string;
  workflowInstanceId?: string | null;
  workflowRunId?: string | null;
  triggerId?: string | null;
  mode?: ResponseCollectionMode;
  expectedCount?: number | null;
  metadata?: JsonValue | null;
}

export interface PlanResponsePipeDeliveryInput {
  deliveryId: string;
  collectionId?: string | null;
  workflowInstanceId?: string | null;
  workflowRunId?: string | null;
  triggerId?: string | null;
  sourceWorkspaceId: string;
  sourceSessionId: string;
  sourceExecutionProcessId: string;
  sourceCompletedAt?: number | null;
  sourceRoleId?: string | null;
  sourceLaneId?: string | null;
  targetWorkspaceId: string;
  targetSessionId: string;
  targetRoleId?: string | null;
  targetLaneId?: string | null;
  templateId: string;
  templateVersion?: number | null;
  templateHash: string;
  dedupeKey: string;
  metadata?: JsonValue | null;
}

export interface PlanResponsePipeDeliveryResult {
  delivery: ResponsePipeDeliveryReadModel;
  created: boolean;
}

export class ResponsePipeStoreTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResponsePipeStoreTransitionError';
  }
}

export class DbResponsePipeStore {
  private readonly getDbHandle: () => Promise<Kysely<DB>> | Kysely<DB>;
  private readonly now: () => number;

  constructor(options: { db?: Kysely<DB>; getDb?: () => Promise<Kysely<DB>> | Kysely<DB>; now?: () => number }) {
    if (!options.db && !options.getDb) {
      throw new Error('DbResponsePipeStore requires db or getDb');
    }
    this.getDbHandle = options.getDb ?? (() => options.db as Kysely<DB>);
    this.now = options.now ?? Date.now;
  }

  async createCollection(input: CreateResponseCollectionInput): Promise<ResponseCollectionReadModel> {
    const db = await this.getDb();
    const now = this.now();
    await db
      .insertInto('ResponseCollection')
      .values({
        collectionId: input.collectionId,
        workflowInstanceId: input.workflowInstanceId ?? null,
        workflowRunId: input.workflowRunId ?? null,
        triggerId: input.triggerId ?? null,
        mode: input.mode ?? 'manual',
        status: 'collecting',
        expectedCount: input.expectedCount ?? null,
        receivedCount: 0,
        metadataJson: input.metadata == null ? null : serializeJson(input.metadata),
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      })
      .execute();
    return this.getRequiredCollection(input.collectionId);
  }

  async planDelivery(input: PlanResponsePipeDeliveryInput): Promise<PlanResponsePipeDeliveryResult> {
    const db = await this.getDb();
    const existing = await this.getDeliveryByDedupeKey(input.dedupeKey);
    if (existing) return { delivery: existing, created: false };

    const now = this.now();
    await db
      .insertInto('ResponsePipeDelivery')
      .values({
        deliveryId: input.deliveryId,
        collectionId: input.collectionId ?? null,
        workflowInstanceId: input.workflowInstanceId ?? null,
        workflowRunId: input.workflowRunId ?? null,
        triggerId: input.triggerId ?? null,
        sourceWorkspaceId: input.sourceWorkspaceId,
        sourceSessionId: input.sourceSessionId,
        sourceExecutionProcessId: input.sourceExecutionProcessId,
        sourceCompletedAt: input.sourceCompletedAt ?? null,
        sourceRoleId: input.sourceRoleId ?? null,
        sourceLaneId: input.sourceLaneId ?? null,
        targetWorkspaceId: input.targetWorkspaceId,
        targetSessionId: input.targetSessionId,
        targetRoleId: input.targetRoleId ?? null,
        targetLaneId: input.targetLaneId ?? null,
        templateId: input.templateId,
        templateVersion: input.templateVersion ?? null,
        templateHash: input.templateHash,
        renderedPromptHash: null,
        renderedPromptLength: null,
        dedupeKey: input.dedupeKey,
        status: 'planned',
        attemptCount: 0,
        queueItemId: null,
        errorJson: null,
        metadataJson: input.metadata == null ? null : serializeJson(input.metadata),
        createdAt: now,
        updatedAt: now,
        queuedAt: null,
        completedAt: null,
      })
      .onConflict((oc) => oc.column('dedupeKey').doNothing())
      .execute();

    const delivery = await this.getDeliveryByDedupeKey(input.dedupeKey);
    if (!delivery) throw new Error(`Response pipe delivery ${input.deliveryId} was not created`);
    return { delivery, created: delivery.deliveryId === input.deliveryId };
  }

  async markDeliveryRendered(deliveryId: string, args: { promptHash: string; promptLength: number }): Promise<ResponsePipeDeliveryReadModel> {
    const db = await this.getDb();
    const now = this.now();
    await assertUpdated(
      db
        .updateTable('ResponsePipeDelivery')
        .set({
          status: 'rendered',
          renderedPromptHash: args.promptHash,
          renderedPromptLength: args.promptLength,
          updatedAt: now,
        })
        .where('deliveryId', '=', deliveryId)
        .where('status', '=', 'planned')
        .executeTakeFirst(),
      `Cannot mark response pipe delivery ${deliveryId} rendered from its current state`,
    );
    return this.getRequiredDelivery(deliveryId);
  }

  async markDeliveryQueued(deliveryId: string, args: { queueItemId: string }): Promise<ResponsePipeDeliveryReadModel> {
    const db = await this.getDb();
    const now = this.now();
    await assertUpdated(
      db
        .updateTable('ResponsePipeDelivery')
        .set((eb) => ({
          status: 'queued' as const,
          queueItemId: args.queueItemId,
          attemptCount: eb('attemptCount', '+', 1),
          queuedAt: now,
          updatedAt: now,
        }))
        .where('deliveryId', '=', deliveryId)
        .where('status', '=', 'rendered')
        .executeTakeFirst(),
      `Cannot mark response pipe delivery ${deliveryId} queued from its current state`,
    );
    return this.getRequiredDelivery(deliveryId);
  }

  async markDeliveryFailed(deliveryId: string, error: JsonValue): Promise<ResponsePipeDeliveryReadModel> {
    const db = await this.getDb();
    const now = this.now();
    await assertUpdated(
      db
        .updateTable('ResponsePipeDelivery')
        .set({ status: 'failed', errorJson: serializeJson(error), updatedAt: now, completedAt: now })
        .where('deliveryId', '=', deliveryId)
        .where('status', 'in', ['planned', 'rendered'])
        .executeTakeFirst(),
      `Cannot mark response pipe delivery ${deliveryId} failed from its current state`,
    );
    return this.getRequiredDelivery(deliveryId);
  }

  async getCollection(collectionId: string): Promise<ResponseCollectionReadModel | null> {
    const db = await this.getDb();
    const row = await db.selectFrom('ResponseCollection').selectAll().where('collectionId', '=', collectionId).executeTakeFirst();
    return row ? mapCollection(row) : null;
  }

  async getRequiredCollection(collectionId: string): Promise<ResponseCollectionReadModel> {
    const collection = await this.getCollection(collectionId);
    if (!collection) throw new Error(`Response collection ${collectionId} not found`);
    return collection;
  }

  async getDelivery(deliveryId: string): Promise<ResponsePipeDeliveryReadModel | null> {
    const db = await this.getDb();
    const row = await db.selectFrom('ResponsePipeDelivery').selectAll().where('deliveryId', '=', deliveryId).executeTakeFirst();
    return row ? mapDelivery(row) : null;
  }

  async getRequiredDelivery(deliveryId: string): Promise<ResponsePipeDeliveryReadModel> {
    const delivery = await this.getDelivery(deliveryId);
    if (!delivery) throw new Error(`Response pipe delivery ${deliveryId} not found`);
    return delivery;
  }

  async getDeliveryByDedupeKey(dedupeKey: string): Promise<ResponsePipeDeliveryReadModel | null> {
    const db = await this.getDb();
    const row = await db.selectFrom('ResponsePipeDelivery').selectAll().where('dedupeKey', '=', dedupeKey).executeTakeFirst();
    return row ? mapDelivery(row) : null;
  }

  private async getDb(): Promise<Kysely<DB>> {
    return this.getDbHandle();
  }
}

function mapCollection(row: Record<string, any>): ResponseCollectionReadModel {
  return {
    collectionId: row.collectionId,
    workflowInstanceId: row.workflowInstanceId,
    workflowRunId: row.workflowRunId,
    triggerId: row.triggerId,
    mode: row.mode,
    status: row.status,
    expectedCount: row.expectedCount,
    receivedCount: row.receivedCount,
    metadata: parseJson(row.metadataJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

function mapDelivery(row: Record<string, any>): ResponsePipeDeliveryReadModel {
  return {
    deliveryId: row.deliveryId,
    collectionId: row.collectionId,
    workflowInstanceId: row.workflowInstanceId,
    workflowRunId: row.workflowRunId,
    triggerId: row.triggerId,
    sourceWorkspaceId: row.sourceWorkspaceId,
    sourceSessionId: row.sourceSessionId,
    sourceExecutionProcessId: row.sourceExecutionProcessId,
    sourceCompletedAt: row.sourceCompletedAt,
    sourceRoleId: row.sourceRoleId,
    sourceLaneId: row.sourceLaneId,
    targetWorkspaceId: row.targetWorkspaceId,
    targetSessionId: row.targetSessionId,
    targetRoleId: row.targetRoleId,
    targetLaneId: row.targetLaneId,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    templateHash: row.templateHash,
    renderedPromptHash: row.renderedPromptHash,
    renderedPromptLength: row.renderedPromptLength,
    dedupeKey: row.dedupeKey,
    status: row.status,
    attemptCount: row.attemptCount,
    queueItemId: row.queueItemId,
    error: parseJson(row.errorJson),
    metadata: parseJson(row.metadataJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    queuedAt: row.queuedAt,
    completedAt: row.completedAt,
  };
}

function serializeJson(value: JsonValue): string {
  return JSON.stringify(value ?? null);
}

function parseJson(value: string | null | undefined): JsonValue | null {
  if (value == null) return null;
  return JSON.parse(value) as JsonValue;
}

async function assertUpdated(resultPromise: Promise<{ numUpdatedRows?: bigint | number }>, message: string): Promise<void> {
  const result = await resultPromise;
  const count = Number(result.numUpdatedRows ?? 0);
  if (count !== 1) throw new ResponsePipeStoreTransitionError(message);
}
