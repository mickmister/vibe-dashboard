import { afterEach, describe, expect, it, vi } from 'vitest';
import { initVdDb, type VdDbHandle } from './database';
import { DbWorkflowWebhookProvisioningStore } from './workflow-webhook-provisioning-store';
import {
  DEFAULT_WORKFLOW_WEBHOOK_EVENTS,
  DEFAULT_WORKFLOW_WEBHOOK_UPSERT_KEY,
  WorkflowWebhookProvisioner,
  deriveWorkflowWebhookUrl,
  validateProvisioningTargetUrl,
  type WorkflowWebhookProvisionerVkClient,
} from './workflow-webhook-provisioner';
import type { CreateWebhookSubscriptionBody, UpsertWebhookSubscriptionResponse } from './vk-client';

const handles: VdDbHandle[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const handle of handles.splice(0)) {
    await handle.db.destroy();
    handle.sqlite.close();
  }
});

describe('WorkflowWebhookProvisioner', () => {
  it('derives the same-container localhost webhook URL from listen env', () => {
    expect(deriveWorkflowWebhookUrl({ PORT: '3109' })).toBe('http://127.0.0.1:3109/dashboard/api/workflow-webhooks/vk');
    expect(deriveWorkflowWebhookUrl({ DASHBOARD_PORT: '4200', VD_WORKFLOW_WEBHOOK_HOST: 'localhost' })).toBe('http://localhost:4200/dashboard/api/workflow-webhooks/vk');
    expect(deriveWorkflowWebhookUrl({ VD_WORKFLOW_WEBHOOK_URL: 'http://127.0.0.1:9999/dashboard/api/workflow-webhooks/vk/' })).toBe('http://127.0.0.1:9999/dashboard/api/workflow-webhooks/vk');
  });

  it('rejects invalid or external target URLs with actionable errors by default', () => {
    expect(() => validateProvisioningTargetUrl('not a url')).toThrow(/Invalid VK workflow webhook URL/);
    expect(() => validateProvisioningTargetUrl('https://example.com/dashboard/api/workflow-webhooks/vk')).toThrow(/External VK workflow webhook URL host example.com is not allowed/);
    expect(() => validateProvisioningTargetUrl('https://example.com/dashboard/api/workflow-webhooks/vk', { allowExternalUrl: true })).not.toThrow();
    expect(() => validateProvisioningTargetUrl('http://127.0.0.1:3109/not-the-webhook')).toThrow(/expected \/dashboard\/api\/workflow-webhooks\/vk/);
  });

  it('first startup provisions with generated secret, stable upsert key, and terminal event filters', async () => {
    const { store } = await createStore({ secret: 'generated-secret' });
    const calls: CreateWebhookSubscriptionBody[] = [];
    const vk = fakeVk(calls);
    const provisioner = new WorkflowWebhookProvisioner({ store, vk, env: { PORT: '3109' }, logger: quietLogger });

    const result = await provisioner.runOnce();

    expect(result).toMatchObject({ ok: true, created: true, state: { secretSet: true, status: 'provisioned', targetUrl: 'http://127.0.0.1:3109/dashboard/api/workflow-webhooks/vk' } });
    expect(JSON.stringify(result)).not.toContain('generated-secret');
    expect(calls).toEqual([{ id: null, name: 'VD workflow wakeups', upsert_key: DEFAULT_WORKFLOW_WEBHOOK_UPSERT_KEY, url: 'http://127.0.0.1:3109/dashboard/api/workflow-webhooks/vk', enabled: true, event_filters: [...DEFAULT_WORKFLOW_WEBHOOK_EVENTS], signing_secret: 'generated-secret', allow_external_url: false }]);
  });

  it('second startup reuses the same secret/upsert key and updates the same VK subscription', async () => {
    const { store } = await createStore({ secret: 'stable-secret' });
    const calls: CreateWebhookSubscriptionBody[] = [];
    const vk = fakeVk(calls);
    const provisioner = new WorkflowWebhookProvisioner({ store, vk, env: { PORT: '3109' }, logger: quietLogger });

    await provisioner.runOnce();
    const second = await provisioner.runOnce();

    expect(second).toMatchObject({ ok: true, created: false, state: { vkSubscriptionId: 'vk-sub-vd.workflow_wakeups.v1', secretSet: true } });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ id: 'vk-sub-vd.workflow_wakeups.v1', upsert_key: DEFAULT_WORKFLOW_WEBHOOK_UPSERT_KEY, signing_secret: 'stable-secret' });
  });

  it('records retryable VK unavailable errors and later succeeds without rotating the secret', async () => {
    const { store } = await createStore({ secret: 'retry-secret' });
    const calls: CreateWebhookSubscriptionBody[] = [];
    const vk: WorkflowWebhookProvisionerVkClient = {
      createOrUpsertWebhookSubscription: vi.fn(async (body) => {
        calls.push(body);
        if (calls.length === 1) throw new Error('VK is unreachable at http://localhost:3007/api');
        return upsertResponse(body, calls.length === 1);
      }),
    };
    const provisioner = new WorkflowWebhookProvisioner({ store, vk, env: { PORT: '3109' }, logger: quietLogger });

    const failed = await provisioner.runOnce();
    expect(failed).toMatchObject({ ok: false, state: { status: 'failed', secretSet: true }, error: 'VK is unreachable at http://localhost:3007/api' });
    expect(failed.state.lastError).toMatchObject({ message: 'VK is unreachable at http://localhost:3007/api' });

    const succeeded = await provisioner.runOnce();
    expect(succeeded).toMatchObject({ ok: true, state: { status: 'provisioned', lastError: null } });
    expect(calls.map((call) => call.signing_secret)).toEqual(['retry-secret', 'retry-secret']);
  });


  it('records invalid URL configuration as an actionable failed state without calling VK', async () => {
    const { store } = await createStore({ secret: 'invalid-url-secret' });
    const vk = fakeVk([]);
    const provisioner = new WorkflowWebhookProvisioner({
      store,
      vk,
      targetUrl: 'https://example.com/dashboard/api/workflow-webhooks/vk',
      logger: quietLogger,
    });

    const result = await provisioner.runOnce();

    expect(result).toMatchObject({ ok: false, state: { status: 'failed', targetUrl: 'https://example.com/dashboard/api/workflow-webhooks/vk' } });
    expect(result.error).toContain('External VK workflow webhook URL host example.com is not allowed');
    expect(vk.createOrUpsertWebhookSubscription).not.toHaveBeenCalled();
  });

  it('public provisioning state redacts the secret', async () => {
    const { store } = await createStore({ secret: 'private-secret' });
    await new WorkflowWebhookProvisioner({ store, vk: fakeVk([]), env: { PORT: '3109' }, logger: quietLogger }).runOnce();

    const publicState = await store.getPublicState();
    expect(publicState).toMatchObject({ secretSet: true, status: 'provisioned' });
    expect(JSON.stringify(publicState)).not.toContain('private-secret');
  });
});

async function createStore(options: { secret: string }) {
  const handle = await initVdDb({ path: ':memory:' });
  handles.push(handle);
  const store = new DbWorkflowWebhookProvisioningStore({ db: handle.db, createSecret: () => options.secret, now: (() => { let value = 100; return () => value++; })() });
  return { handle, store };
}

function fakeVk(calls: CreateWebhookSubscriptionBody[]): WorkflowWebhookProvisionerVkClient {
  return {
    createOrUpsertWebhookSubscription: vi.fn(async (body) => {
      calls.push(body);
      return upsertResponse(body, body.id == null);
    }),
  };
}

function upsertResponse(body: CreateWebhookSubscriptionBody, created: boolean): UpsertWebhookSubscriptionResponse {
  return {
    created,
    subscription: {
      id: body.id ?? `vk-sub-${body.upsert_key}`,
      name: body.name,
      upsert_key: body.upsert_key ?? null,
      url: body.url,
      enabled: body.enabled,
      event_filters: body.event_filters,
      signing_secret_set: true,
      created_at: '2026-08-08T00:00:00Z',
      updated_at: '2026-08-08T00:00:00Z',
    },
  };
}

const quietLogger = { info: () => undefined, warn: () => undefined };
