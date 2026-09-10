import type { CreateWebhookSubscriptionBody, UpsertWebhookSubscriptionResponse } from './vk-client';
import { DEFAULT_WORKFLOW_WEBHOOK_PROVISIONING_STATE_KEY, type DbWorkflowWebhookProvisioningStore, type WorkflowWebhookProvisioningReadModel } from './workflow-webhook-provisioning-store';

export const DEFAULT_WORKFLOW_WEBHOOK_UPSERT_KEY = 'vd.workflow_wakeups.v1';
export const DEFAULT_WORKFLOW_WEBHOOK_EVENTS = ['execution.completed', 'execution.failed', 'execution.killed'] as const;
export const DEFAULT_WORKFLOW_WEBHOOK_RETRY_MS = 30_000;

export interface WorkflowWebhookProvisionerVkClient {
  createOrUpsertWebhookSubscription(body: CreateWebhookSubscriptionBody): Promise<UpsertWebhookSubscriptionResponse>;
}

export interface WorkflowWebhookProvisionerOptions {
  store: DbWorkflowWebhookProvisioningStore;
  vk: WorkflowWebhookProvisionerVkClient;
  env?: Record<string, string | undefined>;
  now?: () => number;
  upsertKey?: string;
  targetUrl?: string;
  allowExternalUrl?: boolean;
  retryMs?: number;
  logger?: Pick<Console, 'info' | 'warn'>;
}

export interface WorkflowWebhookProvisionResult {
  ok: boolean;
  state: WorkflowWebhookProvisioningReadModel;
  created?: boolean;
  error?: string;
}

export class WorkflowWebhookProvisioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowWebhookProvisioningError';
  }
}

export class WorkflowWebhookProvisioner {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly options: WorkflowWebhookProvisionerOptions) {}

  async runOnce(): Promise<WorkflowWebhookProvisionResult> {
    if (this.running) {
      const existing = await this.options.store.getPublicState();
      if (existing) return { ok: false, state: existing, error: 'workflow_webhook_provisioning_already_running' };
    }
    this.running = true;
    try {
      const targetUrl = this.options.targetUrl ?? deriveWorkflowWebhookUrl(this.options.env);
      const allowExternalUrl = this.options.allowExternalUrl ?? isTruthy(this.options.env?.VD_WORKFLOW_WEBHOOK_ALLOW_EXTERNAL_URL);
      const state = await this.options.store.ensureState({
        stateKey: DEFAULT_WORKFLOW_WEBHOOK_PROVISIONING_STATE_KEY,
        upsertKey: this.options.upsertKey ?? this.options.env?.VD_WORKFLOW_WEBHOOK_UPSERT_KEY ?? DEFAULT_WORKFLOW_WEBHOOK_UPSERT_KEY,
        targetUrl,
      });
      try {
        validateProvisioningTargetUrl(targetUrl, { allowExternalUrl });
        await this.options.store.markAttempt(state.stateKey);
        const request: CreateWebhookSubscriptionBody = {
          id: state.vkSubscriptionId,
          name: 'VD workflow wakeups',
          upsert_key: state.upsertKey,
          url: targetUrl,
          enabled: true,
          event_filters: [...DEFAULT_WORKFLOW_WEBHOOK_EVENTS],
          signing_secret: state.secret,
          allow_external_url: allowExternalUrl,
        };
        const response = await this.options.vk.createOrUpsertWebhookSubscription(request);
        const updated = await this.options.store.markSuccess({
          stateKey: state.stateKey,
          vkSubscriptionId: response.subscription.id,
          targetUrl: response.subscription.url || targetUrl,
        });
        this.options.logger?.info?.('VK workflow webhook provisioned', {
          subscriptionId: response.subscription.id,
          upsertKey: response.subscription.upsert_key,
          targetUrl: response.subscription.url,
          created: response.created,
        });
        return { ok: true, created: response.created, state: toPublic(updated) };
      } catch (error) {
        const failed = await this.options.store.markFailure(error, state.stateKey);
        this.options.logger?.warn?.('VK workflow webhook provisioning failed; will retry', {
          error: error instanceof Error ? error.message : String(error),
          targetUrl,
        });
        return { ok: false, state: toPublic(failed), error: error instanceof Error ? error.message : String(error) };
      }
    } finally {
      this.running = false;
    }
  }

  start(): { stop: () => void } {
    const retryMs = this.options.retryMs ?? DEFAULT_WORKFLOW_WEBHOOK_RETRY_MS;
    void this.runOnce().catch((error) => this.options.logger?.warn?.('VK workflow webhook provisioning crashed before recording state', { error: error instanceof Error ? error.message : String(error) }));
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => this.options.logger?.warn?.('VK workflow webhook provisioning crashed before recording state', { error: error instanceof Error ? error.message : String(error) }));
    }, retryMs);
    this.timer.unref?.();
    return { stop: () => this.stop() };
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export function shouldStartWorkflowWebhookProvisioner(env: Record<string, string | undefined> = process.env): boolean {
  if (env.NODE_ENV === 'test') return false;
  if (isTruthy(env.VD_DISABLE_VK_WORKFLOW_WEBHOOK_PROVISIONING)) return false;
  return true;
}

export function deriveWorkflowWebhookUrl(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.VD_WORKFLOW_WEBHOOK_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const port = env.VD_WORKFLOW_WEBHOOK_PORT || env.PORT || env.DASHBOARD_PORT || env.SERVER_PORT || env.VK_MOCKED_VD_SERVER_PORT || '5173';
  const host = env.VD_WORKFLOW_WEBHOOK_HOST || '127.0.0.1';
  const protocol = env.VD_WORKFLOW_WEBHOOK_PROTOCOL || 'http';
  return `${protocol}://${formatHost(host)}:${port}/dashboard/api/workflow-webhooks/vk`;
}

export function validateProvisioningTargetUrl(targetUrl: string, options: { allowExternalUrl?: boolean } = {}): void {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new WorkflowWebhookProvisioningError(`Invalid VK workflow webhook URL: ${targetUrl}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new WorkflowWebhookProvisioningError(`Invalid VK workflow webhook URL protocol: ${parsed.protocol}. Expected http or https.`);
  }
  if (!parsed.pathname.endsWith('/dashboard/api/workflow-webhooks/vk')) {
    throw new WorkflowWebhookProvisioningError('Invalid VK workflow webhook URL path: expected /dashboard/api/workflow-webhooks/vk');
  }
  if (!options.allowExternalUrl && !isLocalOrPrivateHost(parsed.hostname)) {
    throw new WorkflowWebhookProvisioningError(`External VK workflow webhook URL host ${parsed.hostname} is not allowed by default. Set VD_WORKFLOW_WEBHOOK_ALLOW_EXTERNAL_URL=true only for an explicitly trusted deployment.`);
  }
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === 'localhost' || normalized === '::1' || normalized === '[::1]') return true;
  const parts = normalized.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const a = parts[0]!;
  const b = parts[1]!;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function formatHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function isTruthy(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true' || value?.toLowerCase() === 'yes';
}

function toPublic(state: { secret: string } & WorkflowWebhookProvisioningReadModel): WorkflowWebhookProvisioningReadModel {
  const { secret: _secret, ...publicState } = state;
  return { ...publicState, secretSet: true };
}
