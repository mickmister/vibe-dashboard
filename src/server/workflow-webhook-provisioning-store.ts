import { randomBytes } from 'node:crypto';
import type { Kysely, Selectable } from 'kysely';
import type { DB, WorkflowWebhookProvisioningState, WorkflowWebhookProvisioningStatus } from '../store/kysely_types';

export const DEFAULT_WORKFLOW_WEBHOOK_PROVISIONING_STATE_KEY = 'vk_workflow_webhook';

export interface WorkflowWebhookProvisioningReadModel {
  stateKey: string;
  secretSet: boolean;
  vkSubscriptionId: string | null;
  upsertKey: string;
  targetUrl: string;
  status: WorkflowWebhookProvisioningStatus;
  attemptCount: number;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowWebhookProvisioningPrivateState extends WorkflowWebhookProvisioningReadModel {
  secret: string;
}

export class DbWorkflowWebhookProvisioningStore {
  private readonly getDb: () => Promise<Kysely<DB>>;
  private readonly now: () => number;
  private readonly createSecret: () => string;

  constructor(options: { db?: Kysely<DB>; getDb?: () => Promise<Kysely<DB>>; now?: () => number; createSecret?: () => string }) {
    if (!options.db && !options.getDb) throw new Error('DbWorkflowWebhookProvisioningStore requires db or getDb');
    this.getDb = options.getDb ?? (async () => options.db!);
    this.now = options.now ?? Date.now;
    this.createSecret = options.createSecret ?? (() => randomBytes(32).toString('hex'));
  }

  async getState(stateKey = DEFAULT_WORKFLOW_WEBHOOK_PROVISIONING_STATE_KEY): Promise<WorkflowWebhookProvisioningPrivateState | null> {
    const db = await this.getDb();
    const row = await db.selectFrom('WorkflowWebhookProvisioningState').selectAll().where('stateKey', '=', stateKey).executeTakeFirst();
    return row ? mapPrivateState(row) : null;
  }

  async getPublicState(stateKey = DEFAULT_WORKFLOW_WEBHOOK_PROVISIONING_STATE_KEY): Promise<WorkflowWebhookProvisioningReadModel | null> {
    const state = await this.getState(stateKey);
    return state ? redactState(state) : null;
  }

  async getSecret(stateKey = DEFAULT_WORKFLOW_WEBHOOK_PROVISIONING_STATE_KEY): Promise<string | null> {
    return (await this.getState(stateKey))?.secret ?? null;
  }

  async ensureState(input: { upsertKey: string; targetUrl: string; stateKey?: string }): Promise<WorkflowWebhookProvisioningPrivateState> {
    if (!input.upsertKey.trim()) throw new Error('Workflow webhook provisioning upsert key is required');
    if (!input.targetUrl.trim()) throw new Error('Workflow webhook provisioning target URL is required');
    const db = await this.getDb();
    const stateKey = input.stateKey ?? DEFAULT_WORKFLOW_WEBHOOK_PROVISIONING_STATE_KEY;
    const existing = await this.getState(stateKey);
    const now = this.now();
    if (!existing) {
      await db.insertInto('WorkflowWebhookProvisioningState').values({
        stateKey,
        secret: this.createSecret(),
        vkSubscriptionId: null,
        upsertKey: input.upsertKey,
        targetUrl: input.targetUrl,
        status: 'pending',
        attemptCount: 0,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastErrorJson: null,
        createdAt: now,
        updatedAt: now,
      }).execute();
      return (await this.getState(stateKey))!;
    }

    if (existing.upsertKey !== input.upsertKey || existing.targetUrl !== input.targetUrl) {
      await db.updateTable('WorkflowWebhookProvisioningState')
        .set({
          upsertKey: input.upsertKey,
          targetUrl: input.targetUrl,
          status: existing.status === 'provisioned' ? 'pending' : existing.status,
          updatedAt: now,
        })
        .where('stateKey', '=', stateKey)
        .execute();
    }
    return (await this.getState(stateKey))!;
  }

  async markAttempt(stateKey = DEFAULT_WORKFLOW_WEBHOOK_PROVISIONING_STATE_KEY): Promise<WorkflowWebhookProvisioningPrivateState> {
    const db = await this.getDb();
    const now = this.now();
    await db.updateTable('WorkflowWebhookProvisioningState')
      .set((eb) => ({
        status: 'retrying',
        attemptCount: eb('attemptCount', '+', 1),
        lastAttemptAt: now,
        updatedAt: now,
      }))
      .where('stateKey', '=', stateKey)
      .execute();
    return this.getRequiredState(stateKey);
  }

  async markSuccess(input: { vkSubscriptionId: string; targetUrl: string; stateKey?: string }): Promise<WorkflowWebhookProvisioningPrivateState> {
    const db = await this.getDb();
    const now = this.now();
    const stateKey = input.stateKey ?? DEFAULT_WORKFLOW_WEBHOOK_PROVISIONING_STATE_KEY;
    await db.updateTable('WorkflowWebhookProvisioningState')
      .set({
        vkSubscriptionId: input.vkSubscriptionId,
        targetUrl: input.targetUrl,
        status: 'provisioned',
        lastSuccessAt: now,
        lastErrorJson: null,
        updatedAt: now,
      })
      .where('stateKey', '=', stateKey)
      .execute();
    return this.getRequiredState(stateKey);
  }

  async markFailure(error: unknown, stateKey = DEFAULT_WORKFLOW_WEBHOOK_PROVISIONING_STATE_KEY): Promise<WorkflowWebhookProvisioningPrivateState> {
    const db = await this.getDb();
    const now = this.now();
    await db.updateTable('WorkflowWebhookProvisioningState')
      .set({
        status: 'failed',
        lastErrorJson: JSON.stringify(serializeError(error)),
        updatedAt: now,
      })
      .where('stateKey', '=', stateKey)
      .execute();
    return this.getRequiredState(stateKey);
  }

  private async getRequiredState(stateKey: string): Promise<WorkflowWebhookProvisioningPrivateState> {
    const state = await this.getState(stateKey);
    if (!state) throw new Error(`Workflow webhook provisioning state ${stateKey} not found`);
    return state;
  }
}

export function redactState(state: WorkflowWebhookProvisioningPrivateState): WorkflowWebhookProvisioningReadModel {
  const { secret: _secret, ...rest } = state;
  return { ...rest, secretSet: Boolean(state.secret) };
}

function mapPrivateState(row: Selectable<WorkflowWebhookProvisioningState>): WorkflowWebhookProvisioningPrivateState {
  return {
    stateKey: row.stateKey,
    secret: row.secret,
    secretSet: Boolean(row.secret),
    vkSubscriptionId: row.vkSubscriptionId,
    upsertKey: row.upsertKey,
    targetUrl: row.targetUrl,
    status: row.status,
    attemptCount: row.attemptCount,
    lastAttemptAt: row.lastAttemptAt,
    lastSuccessAt: row.lastSuccessAt,
    lastError: row.lastErrorJson ? JSON.parse(row.lastErrorJson) as unknown : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeError(error: unknown): { message: string; name?: string; code?: string; status?: number } {
  if (error instanceof Error) {
    const details: { message: string; name?: string; code?: string; status?: number } = { message: error.message, name: error.name };
    const maybe = error as Error & { code?: unknown; status?: unknown };
    if (typeof maybe.code === 'string') details.code = maybe.code;
    if (typeof maybe.status === 'number') details.status = maybe.status;
    return details;
  }
  return { message: String(error) };
}
