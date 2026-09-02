import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import {
  buildRuntimeInactivityStatus,
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
    });
    expect(status.lastAgentPollAt).toBe('2026-09-02T20:00:00.000Z');
    expect(status.lastSuccessfulAgentPollAt).toBe('2026-09-02T20:00:00.000Z');
  });

  it('treats recent workspace activity as not idle', () => {
    const status = buildRuntimeInactivityStatus({
      now: NOW,
      workspaceSummaries: [summary({ latest_process_completed_at: '2026-09-02T19:55:00.000Z' })],
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
      blockers: ['activity_signal_unknown', 'vk_api_unavailable'],
    });
    expect(JSON.stringify(unavailable)).not.toContain('secret token nope');

    const empty = buildRuntimeInactivityStatus({ now: NOW, workspaceSummaries: [] });
    expect(empty.isIdle).toBe(false);
    expect(empty.blockers).toEqual(['activity_signal_unknown']);
  });

  it('does not echo workspace names, repo URLs, prompts, or unbounded timestamps', () => {
    const status = buildRuntimeInactivityStatus({
      now: NOW,
      workspaceSummaries: [summary({
        workspace_id: 'ws-secret',
        latest_process_completed_at: '2026-09-02T19:00:00.000Z?token=raw-secret-value-that-is-too-long',
        pr_url: 'https://github.com/customer/private-repo/pull/1?token=secret',
      })],
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
    registerRuntimeInactivityStatusRoutes(app, {
      vkClient: { getWorkspaceSummaries },
      now: () => NOW,
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
