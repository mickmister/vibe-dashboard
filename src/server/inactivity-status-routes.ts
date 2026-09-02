import type { Hono } from 'hono';
import { VibeKanbanServerClient, type WorkspaceSummary } from './vk-client';

export type RuntimeInactivityIdleReason = 'agent_running' | 'recent_user_activity' | 'idle_timeout_elapsed';
export type RuntimeInactivityActivityType = 'workspace_process_completed' | 'workspace_updated' | null;
export type RuntimeInactivityActivitySource = 'vibe_kanban_workspace_summary' | null;
export type RuntimeInactivityBlocker =
  | 'activity_signal_unknown'
  | 'vk_api_unavailable'
  | 'agent_running'
  | 'execution_running'
  | 'pending_approval'
  | 'dev_server_running'
  | 'unseen_agent_turns';

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
}

export interface RuntimeInactivityStatusOptions {
  now?: Date;
  idleTimeoutMs?: number;
  activityDebounceMs?: number;
  agentPollIntervalMs?: number;
  workspaceSummaries?: WorkspaceSummary[];
  workspaceSummaryError?: unknown;
}

export interface RegisterRuntimeInactivityStatusRoutesOptions {
  vkClient?: Pick<VibeKanbanServerClient, 'getWorkspaceSummaries'>;
  now?: () => Date;
  idleTimeoutMs?: number;
  activityDebounceMs?: number;
  agentPollIntervalMs?: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_ACTIVITY_DEBOUNCE_MS = 5 * 1000;
const DEFAULT_AGENT_POLL_INTERVAL_MS = 15 * 1000;

export function registerRuntimeInactivityStatusRoutes(
  hono: Hono,
  options: RegisterRuntimeInactivityStatusRoutesOptions = {},
): void {
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
        }
      }
    }

    if (!latestActivityAt && blockers.size === 0) {
      blockers.add('activity_signal_unknown');
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
    lastUserActivitySource: latestActivityAt ? 'vibe_kanban_workspace_summary' : null,
    hasRunningAgent,
    agentStateKnown,
    agentPollIntervalMs,
    lastAgentPollAt: pollAt,
    lastSuccessfulAgentPollAt: summaries ? pollAt : null,
    blockers: [...blockers].sort(),
  };
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
