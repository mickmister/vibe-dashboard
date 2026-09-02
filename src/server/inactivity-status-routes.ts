import type { Hono } from 'hono';
import { VibeKanbanServerClient, type WorkspaceSummary } from './vk-client';

export type RuntimeInactivityIdleReason = 'agent_running' | 'recent_user_activity' | 'idle_timeout_elapsed';
export type RuntimeInactivityActivityType = 'workspace_process_completed' | 'browser_editor_activity' | null;
export type RuntimeInactivityActivitySource = 'vibe_kanban_workspace_summary' | 'browser_activity_beacon' | null;
export type RuntimeInactivityBlocker =
  | 'activity_signal_unknown'
  | 'vk_api_unavailable'
  | 'agent_running'
  | 'execution_running'
  | 'pending_approval'
  | 'dev_server_running'
  | 'unseen_agent_turns'
  | 'browser_activity_unknown'
  | 'browser_editor_present';

export interface RuntimeBrowserActivityState {
  signalKnown: boolean;
  lastActivityAt: string | null;
  lastSignalAt: string | null;
  presenceExpiresAt: string | null;
}

export interface RuntimeInactivityStatus {
  schemaVersion: 'runtime-inactivity-status.v1';
  isIdle: boolean;
  idleReason: RuntimeInactivityIdleReason;
  idleTimeoutMs: number;
  activityDebounceMs: number;
  lastUserActivityAt: string | null;
  lastUserActivityType: RuntimeInactivityActivityType;
  lastUserActivitySource: RuntimeInactivityActivitySource;
  hasRunningAgent: boolean;
  agentStateKnown: boolean;
  agentPollIntervalMs: number;
  lastAgentPollAt: string | null;
  lastSuccessfulAgentPollAt: string | null;
  blockers: RuntimeInactivityBlocker[];
  browserActivity: RuntimeBrowserActivityState;
}

export interface RuntimeInactivityStatusOptions {
  now?: Date;
  idleTimeoutMs?: number;
  activityDebounceMs?: number;
  agentPollIntervalMs?: number;
  workspaceSummaries?: WorkspaceSummary[];
  workspaceSummaryError?: unknown;
  browserActivity?: RuntimeBrowserActivityState;
}

export interface RegisterRuntimeInactivityStatusRoutesOptions {
  vkClient?: Pick<VibeKanbanServerClient, 'getWorkspaceSummaries'>;
  now?: () => Date;
  idleTimeoutMs?: number;
  activityDebounceMs?: number;
  agentPollIntervalMs?: number;
  browserActivityStore?: RuntimeBrowserActivityStore;
}

const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_ACTIVITY_DEBOUNCE_MS = 5 * 1000;
const DEFAULT_AGENT_POLL_INTERVAL_MS = 15 * 1000;
const DEFAULT_BROWSER_PRESENCE_TTL_MS = 90 * 1000;
const BROWSER_ACTIVITY_EVENTS = new Set(['load', 'visible', 'focus', 'interaction', 'heartbeat']);

export class RuntimeBrowserActivityStore {
  private signalKnown = false;
  private lastActivityAt: string | null = null;
  private lastSignalAt: string | null = null;

  recordActivity(input: { eventType: unknown; observedAt: Date }): RuntimeBrowserActivityState {
    this.signalKnown = true;
    this.lastSignalAt = input.observedAt.toISOString();
    if (BROWSER_ACTIVITY_EVENTS.has(String(input.eventType))) {
      this.lastActivityAt = input.observedAt.toISOString();
    }
    return this.snapshot(input.observedAt);
  }

  snapshot(now: Date): RuntimeBrowserActivityState {
    const presenceExpiresAt = this.lastActivityAt
      ? new Date(Date.parse(this.lastActivityAt) + DEFAULT_BROWSER_PRESENCE_TTL_MS).toISOString()
      : null;
    return {
      signalKnown: this.signalKnown,
      lastActivityAt: this.lastActivityAt,
      lastSignalAt: this.lastSignalAt,
      presenceExpiresAt: presenceExpiresAt && Date.parse(presenceExpiresAt) >= now.getTime() ? presenceExpiresAt : null,
    };
  }
}

const defaultBrowserActivityStore = new RuntimeBrowserActivityStore();

export function registerRuntimeInactivityStatusRoutes(
  hono: Hono,
  options: RegisterRuntimeInactivityStatusRoutesOptions = {},
): void {
  const browserActivityStore = options.browserActivityStore ?? defaultBrowserActivityStore;

  hono.post('/internal/inactivity/browser-activity', async (c) => {
    if (!isAllowedBrowserActivityRequest(c.req.raw)) {
      return c.json({ error: 'not found' }, 404);
    }

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      payload = {};
    }
    const body = isRecord(payload) ? payload : {};
    const snapshot = browserActivityStore.recordActivity({
      eventType: body.eventType,
      observedAt: options.now?.() ?? new Date(),
    });
    return c.json({ ok: true, signalKnown: snapshot.signalKnown }, 202);
  });

  hono.get('/internal/inactivity/status', async (c) => {
    if (!isLocalOnlyInactivityRequest(c.req.raw)) {
      return c.json({ error: 'not found' }, 404);
    }

    const vkClient = options.vkClient ?? new VibeKanbanServerClient();
    let workspaceSummaries: WorkspaceSummary[] | undefined;
    let workspaceSummaryError: unknown;
    try {
      workspaceSummaries = await vkClient.getWorkspaceSummaries(false);
    } catch (error) {
      workspaceSummaryError = error;
    }

    return c.json(buildRuntimeInactivityStatus({
      now: options.now?.() ?? new Date(),
      idleTimeoutMs: options.idleTimeoutMs,
      activityDebounceMs: options.activityDebounceMs,
      agentPollIntervalMs: options.agentPollIntervalMs,
      workspaceSummaries,
      workspaceSummaryError,
      browserActivity: browserActivityStore.snapshot(options.now?.() ?? new Date()),
    }));
  });
}

export function buildRuntimeInactivityStatus(options: RuntimeInactivityStatusOptions = {}): RuntimeInactivityStatus {
  const now = options.now ?? new Date();
  const idleTimeoutMs = normalizePositiveInteger(options.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS);
  const activityDebounceMs = normalizePositiveInteger(options.activityDebounceMs, DEFAULT_ACTIVITY_DEBOUNCE_MS);
  const agentPollIntervalMs = normalizePositiveInteger(options.agentPollIntervalMs, DEFAULT_AGENT_POLL_INTERVAL_MS);
  const summaries = options.workspaceSummaries;
  const blockers = new Set<RuntimeInactivityBlocker>();
  let hasRunningAgent = false;
  let agentStateKnown = true;
  let latestActivityAt: string | null = null;
  let latestActivityMs = Number.NEGATIVE_INFINITY;
  let latestActivityType: RuntimeInactivityActivityType = null;
  let latestActivitySource: RuntimeInactivityActivitySource = null;
  const browserActivity = normalizeBrowserActivityState(options.browserActivity, now);

  if (options.workspaceSummaryError || !summaries) {
    blockers.add('vk_api_unavailable');
    blockers.add('activity_signal_unknown');
    agentStateKnown = false;
  } else if (summaries.length === 0) {
    blockers.add('activity_signal_unknown');
  } else {
    for (const summary of summaries) {
      if (summary.latest_process_status === 'running') {
        blockers.add('execution_running');
        hasRunningAgent = true;
        blockers.add('agent_running');
      }
      if (summary.has_pending_approval) blockers.add('pending_approval');
      if (summary.has_running_dev_server) blockers.add('dev_server_running');
      if (summary.has_unseen_turns) blockers.add('unseen_agent_turns');

      const completedAt = normalizeIsoTimestamp(summary.latest_process_completed_at);
      if (completedAt) {
        const completedMs = Date.parse(completedAt);
        if (Number.isFinite(completedMs) && completedMs > latestActivityMs) {
          latestActivityMs = completedMs;
          latestActivityAt = completedAt;
          latestActivityType = 'workspace_process_completed';
          latestActivitySource = 'vibe_kanban_workspace_summary';
        }
      }
    }

    if (!latestActivityAt && blockers.size === 0) {
      blockers.add('activity_signal_unknown');
    }
  }

  if (!browserActivity.signalKnown) {
    blockers.add('browser_activity_unknown');
  } else {
    const browserActivityAt = normalizeIsoTimestamp(browserActivity.lastActivityAt);
    if (browserActivityAt) {
      const browserActivityMs = Date.parse(browserActivityAt);
      if (Number.isFinite(browserActivityMs) && browserActivityMs > latestActivityMs) {
        latestActivityMs = browserActivityMs;
        latestActivityAt = browserActivityAt;
        latestActivityType = 'browser_editor_activity';
        latestActivitySource = 'browser_activity_beacon';
      }
    }
    if (browserActivity.presenceExpiresAt) {
      blockers.add('browser_editor_present');
    }
  }

  const hasStrongBlocker = blockers.size > 0;
  const idleElapsed = latestActivityAt !== null
    && now.getTime() - Date.parse(latestActivityAt) >= idleTimeoutMs;
  const isIdle = !hasStrongBlocker && idleElapsed;
  const idleReason: RuntimeInactivityIdleReason = hasRunningAgent
    ? 'agent_running'
    : isIdle
      ? 'idle_timeout_elapsed'
      : 'recent_user_activity';

  const pollAt = now.toISOString();
  return {
    schemaVersion: 'runtime-inactivity-status.v1',
    isIdle,
    idleReason,
    idleTimeoutMs,
    activityDebounceMs,
    lastUserActivityAt: latestActivityAt,
    lastUserActivityType: latestActivityAt ? latestActivityType : null,
    lastUserActivitySource: latestActivityAt ? latestActivitySource : null,
    hasRunningAgent,
    agentStateKnown,
    agentPollIntervalMs,
    lastAgentPollAt: pollAt,
    lastSuccessfulAgentPollAt: summaries ? pollAt : null,
    blockers: [...blockers].sort(),
    browserActivity,
  };
}

export function isAllowedBrowserActivityRequest(request: Request): boolean {
  const secFetchSite = request.headers.get('sec-fetch-site');
  if (secFetchSite && !['same-origin', 'none'].includes(secFetchSite.toLowerCase())) return false;

  const origin = request.headers.get('origin');
  if (origin) {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      const host = request.headers.get('host')?.toLowerCase();
      if (host && originHost !== host) return false;
    } catch {
      return false;
    }
  }

  return true;
}

export function isLocalOnlyInactivityRequest(request: Request): boolean {
  const host = request.headers.get('host');
  if (!isLoopbackHost(host)) return false;

  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor && forwardedFor.split(',').some((part) => !isLoopbackAddress(part.trim()))) {
    return false;
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp && !isLoopbackAddress(realIp.trim())) return false;

  return true;
}

function normalizeBrowserActivityState(value: RuntimeBrowserActivityState | undefined, now: Date): RuntimeBrowserActivityState {
  if (!value?.signalKnown) {
    return { signalKnown: false, lastActivityAt: null, lastSignalAt: null, presenceExpiresAt: null };
  }
  const lastActivityAt = normalizeIsoTimestamp(value.lastActivityAt);
  const lastSignalAt = normalizeIsoTimestamp(value.lastSignalAt);
  const presenceExpiresAt = normalizeIsoTimestamp(value.presenceExpiresAt);
  return {
    signalKnown: true,
    lastActivityAt,
    lastSignalAt,
    presenceExpiresAt: presenceExpiresAt && Date.parse(presenceExpiresAt) >= now.getTime() ? presenceExpiresAt : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  return fallback;
}

function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString();
}

function isLoopbackHost(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  const normalized = hostHeader.trim().toLowerCase();
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
  if (normalized === '[::1]' || normalized.startsWith('[::1]:')) return true;
  const withoutPort = normalized.replace(/:\d+$/, '');
  return isLoopbackAddress(withoutPort);
}

function isLoopbackAddress(value: string): boolean {
  if (value === 'localhost' || value.endsWith('.localhost')) return true;
  if (value === '::1' || value === '[::1]') return true;
  return /^127(?:\.\d{1,3}){3}$/.test(value);
}
