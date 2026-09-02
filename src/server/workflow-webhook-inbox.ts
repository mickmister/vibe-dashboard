import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import type { Kysely, Selectable } from 'kysely';
import type { DB, WorkflowWebhookInbox } from '../store/kysely_types';

export const VK_WORKFLOW_WEBHOOK_HEADERS = {
  timestamp: 'X-VK-Webhook-Timestamp',
  algorithm: 'X-VK-Webhook-Algorithm',
  signature: 'X-VK-Webhook-Signature',
} as const;

const DEFAULT_TIMESTAMP_TOLERANCE_MS = 5 * 60_000;
const TERMINAL_EXECUTION_EVENTS = new Set([
  'execution.completed',
  'execution.failed',
  'execution.killed',
  'execution.cancelled',
  'execution.halted',
]);

export interface VerifyVkWebhookSignatureInput {
  secret: string;
  timestamp: string | null;
  algorithm: string | null;
  signature: string | null;
  body: string;
  now?: number;
  toleranceMs?: number;
}

export interface WorkflowWebhookEventRefs {
  source: 'vk';
  deliveryId: string | null;
  dedupeKey: string;
  eventType: string;
  eventStatus: string | null;
  workspaceId: string | null;
  sessionId: string | null;
  executionProcessId: string | null;
  queueItemId: string | null;
  payload: Record<string, unknown>;
  payloadHash: string;
}

export interface WorkflowWebhookInboxReadModel {
  inboxId: string;
  source: string;
  deliveryId: string | null;
  dedupeKey: string;
  eventType: string;
  eventStatus: string | null;
  workspaceId: string | null;
  sessionId: string | null;
  executionProcessId: string | null;
  queueItemId: string | null;
  payload: Record<string, unknown>;
  payloadHash: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
  receivedAt: number;
  duplicateOfInboxId: string | null;
  processedAt: number | null;
  status: WorkflowWebhookInbox['status'];
  error: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface InsertWorkflowWebhookInboxInput {
  event: WorkflowWebhookEventRefs;
  signatureHeader?: string | null;
  timestampHeader?: string | null;
}

export interface InsertWorkflowWebhookInboxResult {
  inbox: WorkflowWebhookInboxReadModel;
  inserted: boolean;
  duplicate: boolean;
}

export class WorkflowWebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowWebhookSignatureError';
  }
}

export class WorkflowWebhookPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowWebhookPayloadError';
  }
}

export class DbWorkflowWebhookInboxStore {
  private readonly getDb: () => Promise<Kysely<DB>>;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(options: { db?: Kysely<DB>; getDb?: () => Promise<Kysely<DB>>; now?: () => number; createId?: () => string }) {
    if (!options.db && !options.getDb) throw new Error('DbWorkflowWebhookInboxStore requires db or getDb');
    this.getDb = options.getDb ?? (async () => options.db!);
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? (() => `workflow_webhook_${randomUUID()}`);
  }

  async insertEvent(input: InsertWorkflowWebhookInboxInput): Promise<InsertWorkflowWebhookInboxResult> {
    const db = await this.getDb();
    const now = this.now();
    const inboxId = this.createId();
    const payloadJson = JSON.stringify(input.event.payload);
    await db
      .insertInto('WorkflowWebhookInbox')
      .values({
        inboxId,
        source: input.event.source,
        deliveryId: input.event.deliveryId,
        dedupeKey: input.event.dedupeKey,
        eventType: input.event.eventType,
        eventStatus: input.event.eventStatus,
        workspaceId: input.event.workspaceId,
        sessionId: input.event.sessionId,
        executionProcessId: input.event.executionProcessId,
        queueItemId: input.event.queueItemId,
        payloadJson,
        payloadHash: input.event.payloadHash,
        signatureHeader: input.signatureHeader ?? null,
        timestampHeader: input.timestampHeader ?? null,
        receivedAt: now,
        duplicateOfInboxId: null,
        processedAt: null,
        status: 'received',
        errorJson: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflict((oc) => oc.columns(['source', 'dedupeKey']).doNothing())
      .execute();

    const row = await db
      .selectFrom('WorkflowWebhookInbox')
      .selectAll()
      .where('source', '=', input.event.source)
      .where('dedupeKey', '=', input.event.dedupeKey)
      .executeTakeFirstOrThrow();
    const inserted = row.inboxId === inboxId;
    return { inbox: mapInbox(row), inserted, duplicate: !inserted };
  }

  async markProcessed(inboxId: string): Promise<WorkflowWebhookInboxReadModel> {
    const db = await this.getDb();
    const now = this.now();
    await db
      .updateTable('WorkflowWebhookInbox')
      .set({ status: 'processed', processedAt: now, updatedAt: now })
      .where('inboxId', '=', inboxId)
      .where('status', '=', 'received')
      .execute();
    return this.getRequiredInbox(inboxId);
  }

  async markFailed(inboxId: string, error: unknown): Promise<WorkflowWebhookInboxReadModel> {
    const db = await this.getDb();
    const now = this.now();
    await db
      .updateTable('WorkflowWebhookInbox')
      .set({ status: 'failed', errorJson: JSON.stringify(serializeError(error)), updatedAt: now })
      .where('inboxId', '=', inboxId)
      .where('status', '=', 'received')
      .execute();
    return this.getRequiredInbox(inboxId);
  }

  async listEvents(filters: { limit?: number; offset?: number } = {}): Promise<{ events: WorkflowWebhookInboxReadModel[]; limit: number; offset: number; hasMore: boolean }> {
    const db = await this.getDb();
    const limit = clampLimit(filters.limit, 50, 200);
    const offset = Math.max(0, Math.floor(filters.offset ?? 0));
    const rows = await db
      .selectFrom('WorkflowWebhookInbox')
      .selectAll()
      .orderBy('receivedAt', 'desc')
      .orderBy('inboxId', 'desc')
      .limit(limit + 1)
      .offset(offset)
      .execute();
    return { events: rows.slice(0, limit).map(mapInbox), limit, offset, hasMore: rows.length > limit };
  }

  async getEvent(inboxId: string): Promise<WorkflowWebhookInboxReadModel | null> {
    const db = await this.getDb();
    const row = await db.selectFrom('WorkflowWebhookInbox').selectAll().where('inboxId', '=', inboxId).executeTakeFirst();
    return row ? mapInbox(row) : null;
  }

  private async getRequiredInbox(inboxId: string): Promise<WorkflowWebhookInboxReadModel> {
    const event = await this.getEvent(inboxId);
    if (!event) throw new Error(`Workflow webhook inbox event ${inboxId} not found`);
    return event;
  }
}

export class WorkflowWebhookWakeup {
  private inFlight = false;
  private pending = false;

  constructor(private readonly runReady: () => Promise<unknown>) {}

  async trigger(): Promise<{ started: boolean; queued: boolean; passes?: number; result?: unknown }> {
    if (this.inFlight) {
      this.pending = true;
      return { started: false, queued: true };
    }
    this.inFlight = true;
    let passes = 0;
    let result: unknown;
    try {
      do {
        this.pending = false;
        passes += 1;
        result = await this.runReady();
      } while (this.pending);
      return { started: true, queued: false, passes, result };
    } finally {
      this.inFlight = false;
    }
  }

  isRunning(): boolean {
    return this.inFlight;
  }
}

export function verifyVkWebhookSignature(input: VerifyVkWebhookSignatureInput): void {
  if (!input.secret.trim()) throw new WorkflowWebhookSignatureError('VK webhook secret is not configured');
  if (input.algorithm !== 'hmac-sha256') throw new WorkflowWebhookSignatureError('Unsupported VK webhook algorithm; expected hmac-sha256');
  if (!input.timestamp) throw new WorkflowWebhookSignatureError('Missing X-VK-Webhook-Timestamp');
  if (!input.signature) throw new WorkflowWebhookSignatureError('Missing X-VK-Webhook-Signature');
  const timestampSeconds = Number(input.timestamp);
  if (!Number.isFinite(timestampSeconds)) throw new WorkflowWebhookSignatureError('Invalid VK webhook timestamp');
  const now = input.now ?? Date.now();
  const toleranceMs = input.toleranceMs ?? DEFAULT_TIMESTAMP_TOLERANCE_MS;
  if (Math.abs(now - timestampSeconds * 1000) > toleranceMs) {
    throw new WorkflowWebhookSignatureError('VK webhook timestamp is outside replay tolerance');
  }
  const expected = signVkWebhookPayload(input.secret, input.timestamp, input.body);
  if (!constantTimeEqual(input.signature, expected)) throw new WorkflowWebhookSignatureError('Invalid VK webhook signature');
}

export function signVkWebhookPayload(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export function parseVkWorkflowWebhookPayload(rawPayload: unknown): WorkflowWebhookEventRefs {
  const record = asRecord(rawPayload, 'VK webhook payload');
  const eventType = readString(record.event_type ?? record.eventType, 'event_type');
  if (!TERMINAL_EXECUTION_EVENTS.has(eventType)) {
    throw new WorkflowWebhookPayloadError(`Unsupported VK workflow webhook event_type: ${eventType}`);
  }
  const deliveryId = optionalString(record.delivery_id ?? record.deliveryId);
  const workspaceId = optionalString(record.workspace_id ?? record.workspaceId);
  const sessionId = optionalString(record.session_id ?? record.sessionId);
  const executionProcessId = optionalString(record.execution_id ?? record.executionProcessId ?? record.execution_process_id);
  const queueItemId = optionalString(record.queue_item_id ?? record.queueItemId);
  if (!executionProcessId) throw new WorkflowWebhookPayloadError('VK workflow webhook execution id is required');
  const eventStatus = eventStatusFromType(eventType);
  const sanitizedPayload: Record<string, unknown> = {
    event_type: eventType,
    delivery_id: deliveryId,
    timestamp: optionalString(record.timestamp),
    workspace_id: workspaceId,
    session_id: sessionId,
    execution_id: executionProcessId,
    queue_item_id: queueItemId,
    exit_code: typeof record.exit_code === 'number' ? record.exit_code : null,
    event_status: eventStatus,
  };
  const payloadJson = JSON.stringify(sanitizedPayload);
  const payloadHash = sha256(payloadJson);
  return {
    source: 'vk',
    deliveryId,
    dedupeKey: deliveryId ? `delivery:${deliveryId}` : `payload:${payloadHash}`,
    eventType,
    eventStatus,
    workspaceId,
    sessionId,
    executionProcessId,
    queueItemId,
    payload: sanitizedPayload,
    payloadHash,
  };
}

function eventStatusFromType(eventType: string): string | null {
  if (eventType === 'execution.completed') return 'completed';
  if (eventType === 'execution.failed') return 'failed';
  if (eventType === 'execution.killed') return 'killed';
  if (eventType === 'execution.cancelled') return 'cancelled';
  if (eventType === 'execution.halted') return 'halted';
  return null;
}

function mapInbox(row: Selectable<WorkflowWebhookInbox>): WorkflowWebhookInboxReadModel {
  return {
    inboxId: row.inboxId,
    source: row.source,
    deliveryId: row.deliveryId,
    dedupeKey: row.dedupeKey,
    eventType: row.eventType,
    eventStatus: row.eventStatus,
    workspaceId: row.workspaceId,
    sessionId: row.sessionId,
    executionProcessId: row.executionProcessId,
    queueItemId: row.queueItemId,
    payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
    payloadHash: row.payloadHash,
    signatureHeader: row.signatureHeader,
    timestampHeader: row.timestampHeader,
    receivedAt: row.receivedAt,
    duplicateOfInboxId: row.duplicateOfInboxId,
    processedAt: row.processedAt,
    status: row.status,
    error: row.errorJson ? JSON.parse(row.errorJson) as unknown : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WorkflowWebhookPayloadError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new WorkflowWebhookPayloadError(`${label} must be a non-empty string`);
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function serializeError(error: unknown): { message: string; name?: string } {
  if (error instanceof Error) return { message: error.message, name: error.name };
  return { message: String(error) };
}

function clampLimit(value: unknown, defaultValue: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return defaultValue;
  return Math.min(parsed, max);
}
