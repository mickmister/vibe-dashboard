import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import {
  RuntimeBrowserActivityStore,
  buildRuntimeInactivityStatus,
  isAllowedBrowserActivityRequest,
  isLocalOnlyInactivityRequest,
  registerRuntimeInactivityStatusRoutes,
} from './inactivity-status-routes';
import type { WorkspaceSummary } from './vk-client';

const NOW = new Date('2026-09-02T20:00:00.000Z');

function summary(overrides: Partial<WorkspaceSummary>): WorkspaceSummary {
  return {
    workspace_id: 'ws1',
    latest_session_id: 'session1',
    has_pending_approval: false,
    files_changed: null,
    lines_added: null,
    lines_removed: null,
    latest_process_completed_at: null,
    latest_process_status: 'completed',
    has_running_dev_server: false,
    has_unseen_turns: false,
    ...overrides,
  };
}

describe('buildRuntimeInactivityStatus', () => {
  it('returns the MTS reporter-compatible schema with the 15-minute pilot timeout', () => {
    const status = buildRuntimeInactivityStatus({
      now: NOW,
      workspaceSummaries: [summary({ latest_process_completed_at: '2026-09-02T19:44:59.000Z' })],
      browserActivity: {
        signalKnown: true,
        lastActivityAt: '2026-09-02T19:44:59.000Z',
        lastSignalAt: '2026-09-02T19:44:59.000Z',
        presenceExpiresAt: null,
      },
    });

    expect(status).toMatchObject({
      schemaVersion: 'runtime-inactivity-status.v1',
      isIdle: true,
      idleReason: 'idle_timeout_elapsed',
      idleTimeoutMs: 900_000,
      activityDebounceMs: 5_000,
      hasRunningAgent: false,
      agentStateKnown: true,
      agentPollIntervalMs: 15_000,
      lastUserActivityAt: '2026-09-02T19:44:59.000Z',
      lastUserActivityType: 'workspace_process_completed',
      lastUserActivitySource: 'vibe_kanban_workspace_summary',
      blockers: [],
      browserActivity: {
        signalKnown: true,
        lastActivityAt: '2026-09-02T19:44:59.000Z',
        lastSignalAt: '2026-09-02T19:44:59.000Z',
        presenceExpiresAt: null,
      },
    });
    expect(status.lastAgentPollAt).toBe('2026-09-02T20:00:00.000Z');
    expect(status.lastSuccessfulAgentPollAt).toBe('2026-09-02T20:00:00.000Z');
  });

  it('treats recent workspace activity as not idle', () => {
    const status = buildRuntimeInactivityStatus({
      now: NOW,
      workspaceSummaries: [summary({ latest_process_completed_at: '2026-09-02T19:55:00.000Z' })],
      browserActivity: {
        signalKnown: true,
        lastActivityAt: '2026-09-02T19:55:00.000Z',
        lastSignalAt: '2026-09-02T19:55:00.000Z',
        presenceExpiresAt: '2026-09-02T19:56:30.000Z',
      },
    });

    expect(status.isIdle).toBe(false);
    expect(status.idleReason).toBe('recent_user_activity');
  });

  it('treats running agents, executions, dev servers, approvals, and unseen turns as blockers', () => {
    const status = buildRuntimeInactivityStatus({
      now: NOW,
      workspaceSummaries: [summary({
        latest_process_status: 'running',
        latest_process_completed_at: '2026-09-02T19:00:00.000Z',
        has_pending_approval: true,
        has_running_dev_server: true,
        has_unseen_turns: true,
      })],
      browserActivity: { signalKnown: true, lastActivityAt: '2026-09-02T19:00:00.000Z', lastSignalAt: '2026-09-02T19:00:00.000Z', presenceExpiresAt: null },
    });

    expect(status.isIdle).toBe(false);
    expect(status.idleReason).toBe('agent_running');
    expect(status.hasRunningAgent).toBe(true);
    expect(status.blockers).toEqual([
      'agent_running',
      'dev_server_running',
      'execution_running',
      'pending_approval',
      'unseen_agent_turns',
    ]);
  });

  it('fails safe when activity state cannot be loaded or no trusted activity exists', () => {
    const unavailable = buildRuntimeInactivityStatus({ now: NOW, workspaceSummaryError: new Error('secret token nope') });
    expect(unavailable).toMatchObject({
      isIdle: false,
      idleReason: 'recent_user_activity',
      agentStateKnown: false,
      lastSuccessfulAgentPollAt: null,
      blockers: ['activity_signal_unknown', 'browser_activity_unknown', 'vk_api_unavailable'],
    });
    expect(JSON.stringify(unavailable)).not.toContain('secret token nope');

    const empty = buildRuntimeInactivityStatus({ now: NOW, workspaceSummaries: [] });
    expect(empty.isIdle).toBe(false);
    expect(empty.blockers).toEqual(['activity_signal_unknown', 'browser_activity_unknown']);
  });


  it('requires an explicit browser/editor signal before allowing idle', () => {
    const status = buildRuntimeInactivityStatus({
      now: NOW,
      workspaceSummaries: [summary({ latest_process_completed_at: '2026-09-02T19:00:00.000Z' })],
    });

    expect(status.isIdle).toBe(false);
    expect(status.blockers).toContain('browser_activity_unknown');
  });

  it('uses browser/editor activity as a direct human-presence signal', () => {
    const status = buildRuntimeInactivityStatus({
      now: NOW,
      workspaceSummaries: [summary({ latest_process_completed_at: '2026-09-02T19:00:00.000Z' })],
      browserActivity: {
        signalKnown: true,
        lastActivityAt: '2026-09-02T19:59:30.000Z',
        lastSignalAt: '2026-09-02T19:59:30.000Z',
        presenceExpiresAt: '2026-09-02T20:01:00.000Z',
      },
    });

    expect(status.isIdle).toBe(false);
    expect(status.lastUserActivityAt).toBe('2026-09-02T19:59:30.000Z');
    expect(status.lastUserActivityType).toBe('browser_editor_activity');
    expect(status.lastUserActivitySource).toBe('browser_activity_beacon');
    expect(status.blockers).toContain('browser_editor_present');
  });

  it('allows idle only after explicit browser/editor activity has aged past the timeout', () => {
    const status = buildRuntimeInactivityStatus({
      now: NOW,
      workspaceSummaries: [summary({ latest_process_completed_at: '2026-09-02T19:00:00.000Z' })],
      browserActivity: {
        signalKnown: true,
        lastActivityAt: '2026-09-02T19:44:00.000Z',
        lastSignalAt: '2026-09-02T19:44:00.000Z',
        presenceExpiresAt: null,
      },
    });

    expect(status.isIdle).toBe(true);
    expect(status.idleReason).toBe('idle_timeout_elapsed');
    expect(status.blockers).toEqual([]);
  });

  it('does not echo workspace names, repo URLs, prompts, or unbounded timestamps', () => {
    const status = buildRuntimeInactivityStatus({
      now: NOW,
      workspaceSummaries: [summary({
        workspace_id: 'ws-secret',
        latest_process_completed_at: '2026-09-02T19:00:00.000Z?token=raw-secret-value-that-is-too-long',
        pr_url: 'https://github.com/customer/private-repo/pull/1?token=secret',
      })],
      browserActivity: { signalKnown: false, lastActivityAt: null, lastSignalAt: null, presenceExpiresAt: null },
    });

    const encoded = JSON.stringify(status);
    expect(encoded).not.toContain('raw-secret');
    expect(encoded).not.toContain('private-repo');
    expect(status.lastUserActivityAt).toBeNull();
    expect(status.isIdle).toBe(false);
    expect(status.blockers).toContain('activity_signal_unknown');
  });
});

describe('registerRuntimeInactivityStatusRoutes', () => {
  it('serves the status route only for loopback hosts', async () => {
    const app = new Hono();
    const getWorkspaceSummaries = vi.fn(async () => [
      summary({ latest_process_completed_at: '2026-09-02T19:44:00.000Z' }),
    ]);
    const browserActivityStore = new RuntimeBrowserActivityStore();
    browserActivityStore.recordActivity({ eventType: 'heartbeat', observedAt: new Date('2026-09-02T19:44:00.000Z') });
    registerRuntimeInactivityStatusRoutes(app, {
      vkClient: { getWorkspaceSummaries },
      now: () => NOW,
      browserActivityStore,
    });

    const local = await app.request('http://127.0.0.1/internal/inactivity/status', {
      headers: { host: '127.0.0.1:3000' },
    });
    expect(local.status).toBe(200);
    await expect(local.json()).resolves.toMatchObject({ isIdle: true });

    const publicHost = await app.request('https://customer.example.com/internal/inactivity/status', {
      headers: { host: 'customer.example.com' },
    });
    expect(publicHost.status).toBe(404);

    const forwarded = await app.request('http://127.0.0.1/internal/inactivity/status', {
      headers: { host: '127.0.0.1:3000', 'x-forwarded-for': '203.0.113.10' },
    });
    expect(forwarded.status).toBe(404);
  });

  it('records browser activity with origin guards and without returning raw payload data', async () => {
    const app = new Hono();
    const browserActivityStore = new RuntimeBrowserActivityStore();
    registerRuntimeInactivityStatusRoutes(app, {
      vkClient: { getWorkspaceSummaries: vi.fn(async () => [summary({ latest_process_completed_at: '2026-09-02T19:00:00.000Z' })]) },
      now: () => NOW,
      browserActivityStore,
    });

    const rejected = await app.request('https://runtime.example.com/internal/inactivity/browser-activity', {
      method: 'POST',
      headers: {
        host: 'runtime.example.com',
        origin: 'https://evil.example.com',
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ eventType: 'heartbeat', href: 'https://runtime.example.com/?token=secret' }),
    });
    expect(rejected.status).toBe(404);

    const accepted = await app.request('https://runtime.example.com/internal/inactivity/browser-activity', {
      method: 'POST',
      headers: {
        host: 'runtime.example.com',
        origin: 'https://runtime.example.com',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ eventType: 'heartbeat', href: 'https://runtime.example.com/?token=secret' }),
    });
    expect(accepted.status).toBe(202);
    await expect(accepted.json()).resolves.toEqual({ ok: true, signalKnown: true });

    const status = buildRuntimeInactivityStatus({
      now: NOW,
      workspaceSummaries: [summary({ latest_process_completed_at: '2026-09-02T19:00:00.000Z' })],
      browserActivity: browserActivityStore.snapshot(NOW),
    });
    expect(status.blockers).toContain('browser_editor_present');
    expect(JSON.stringify(status)).not.toContain('secret');
  });

});

describe('isLocalOnlyInactivityRequest', () => {
  it('accepts loopback hosts and rejects public-looking hosts', () => {
    expect(isLocalOnlyInactivityRequest(new Request('http://localhost/internal/inactivity/status', {
      headers: { host: 'localhost:3000' },
    }))).toBe(true);
    expect(isLocalOnlyInactivityRequest(new Request('http://127.0.0.1/internal/inactivity/status', {
      headers: { host: '127.0.0.1:3000' },
    }))).toBe(true);
    expect(isLocalOnlyInactivityRequest(new Request('https://runtime.example.com/internal/inactivity/status', {
      headers: { host: 'runtime.example.com' },
    }))).toBe(false);
  });
});


describe('isAllowedBrowserActivityRequest', () => {
  it('allows same-origin browser beacons and rejects cross-site beacons', () => {
    expect(isAllowedBrowserActivityRequest(new Request('https://runtime.example.com/internal/inactivity/browser-activity', {
      method: 'POST',
      headers: { host: 'runtime.example.com', origin: 'https://runtime.example.com', 'sec-fetch-site': 'same-origin' },
    }))).toBe(true);
    expect(isAllowedBrowserActivityRequest(new Request('https://runtime.example.com/internal/inactivity/browser-activity', {
      method: 'POST',
      headers: { host: 'runtime.example.com', origin: 'https://evil.example.com', 'sec-fetch-site': 'cross-site' },
    }))).toBe(false);
  });
});
