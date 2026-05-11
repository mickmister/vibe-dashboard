// @platform "node"
import process from 'node:process';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import {
  type ActivityBeaconPayload,
  type IdleStatusResponse,
  INACTIVITY_ACTIVITY_PATH,
  INACTIVITY_STATUS_PATH,
} from '../lib/inactivity';

type WorkspaceSummary = {
  latest_process_status: 'running' | 'completed' | 'failed' | 'killed' | null;
};

type WorkspaceSummaryEnvelope = {
  success: boolean;
  data?: {
    summaries?: WorkspaceSummary[];
  };
};

type InactivityConfig = {
  backendBaseUrl: string;
  serverHost: string;
  serverPort: number;
  idleTimeoutMs: number;
  activityDebounceMs: number;
  agentPollIntervalMs: number;
};

type InactivityState = {
  lastUserActivityAtMs: number;
  lastUserActivityType: ActivityBeaconPayload['type'] | null;
  lastUserActivitySource: ActivityBeaconPayload['source'] | null;
  hasRunningAgent: boolean;
  agentStateKnown: boolean;
  lastAgentPollAtMs: number | null;
  lastSuccessfulAgentPollAtMs: number | null;
};

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_ACTIVITY_DEBOUNCE_MS = 5000;
const DEFAULT_AGENT_POLL_INTERVAL_MS = 15000;
const DEFAULT_INACTIVITY_SERVER_PORT = 3011;
const DEFAULT_BACKEND_PORT = 3007;
const GLOBAL_KEY = '__vkvwInactivityService';

function parseEnvNumber(
  value: string | undefined,
  fallback: number,
  minimum = 1,
) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    return fallback;
  }
  return parsed;
}

function toIsoString(timestampMs: number | null) {
  if (timestampMs == null) return null;
  return new Date(timestampMs).toISOString();
}

function getConfig(): InactivityConfig {
  const backendPort = parseEnvNumber(
    process.env.BACKEND_PORT,
    DEFAULT_BACKEND_PORT,
  );

  return {
    backendBaseUrl:
      process.env.INACTIVITY_VK_BASE_URL?.trim() ||
      `http://127.0.0.1:${backendPort}/api`,
    serverHost: process.env.INACTIVITY_SERVER_HOST?.trim() || '127.0.0.1',
    serverPort: parseEnvNumber(
      process.env.INACTIVITY_PORT,
      DEFAULT_INACTIVITY_SERVER_PORT,
    ),
    idleTimeoutMs: parseEnvNumber(
      process.env.INACTIVITY_IDLE_TIMEOUT_MS,
      DEFAULT_IDLE_TIMEOUT_MS,
    ),
    activityDebounceMs: parseEnvNumber(
      process.env.INACTIVITY_ACTIVITY_DEBOUNCE_MS,
      DEFAULT_ACTIVITY_DEBOUNCE_MS,
    ),
    agentPollIntervalMs: parseEnvNumber(
      process.env.INACTIVITY_AGENT_POLL_INTERVAL_MS,
      DEFAULT_AGENT_POLL_INTERVAL_MS,
    ),
  };
}

class InactivityService {
  private readonly config = getConfig();
  private readonly app = new Hono();
  private readonly state: InactivityState = {
    lastUserActivityAtMs: Date.now(),
    lastUserActivityType: null,
    lastUserActivitySource: null,
    hasRunningAgent: false,
    agentStateKnown: false,
    lastAgentPollAtMs: null,
    lastSuccessfulAgentPollAtMs: null,
  };

  private server: ReturnType<typeof serve> | null = null;
  private agentPollTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.registerRoutes();
  }

  start() {
    if (!this.server) {
      this.server = serve(
        {
          fetch: this.app.fetch,
          hostname: this.config.serverHost,
          port: this.config.serverPort,
        },
        (info) => {
          console.log(
            `[inactivity] status server listening on http://${info.address}:${info.port}`,
          );
        },
      );
    }

    if (!this.agentPollTimer) {
      void this.pollAgentState();
      this.agentPollTimer = setInterval(() => {
        void this.pollAgentState();
      }, this.config.agentPollIntervalMs);
    }
  }

  private registerRoutes() {
    this.app.get('/health', (c) =>
      c.json({ ok: true, statusPath: INACTIVITY_STATUS_PATH }),
    );

    this.app.get(INACTIVITY_STATUS_PATH, (c) => {
      c.header('Cache-Control', 'no-store');
      return c.json(this.getStatus());
    });

    this.app.post(INACTIVITY_ACTIVITY_PATH, async (c) => {
      const payload = (await c.req.json()) as ActivityBeaconPayload;
      this.recordActivity(payload);
      c.header('Cache-Control', 'no-store');
      return c.json({ ok: true, status: this.getStatus() });
    });
  }

  private recordActivity(payload: ActivityBeaconPayload) {
    const occurredAtMs = payload.occurredAt
      ? new Date(payload.occurredAt).getTime()
      : Date.now();
    const now = Number.isFinite(occurredAtMs) ? occurredAtMs : Date.now();

    if (now - this.state.lastUserActivityAtMs < this.config.activityDebounceMs) {
      return;
    }

    this.state.lastUserActivityAtMs = now;
    this.state.lastUserActivityType = payload.type;
    this.state.lastUserActivitySource = payload.source;
  }

  private async pollAgentState() {
    this.state.lastAgentPollAtMs = Date.now();

    try {
      const response = await fetch(
        `${this.config.backendBaseUrl}/workspaces/summaries`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ archived: false }),
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const json = (await response.json()) as WorkspaceSummaryEnvelope;
      const summaries = json.data?.summaries ?? [];
      this.state.hasRunningAgent = summaries.some(
        (summary) => summary.latest_process_status === 'running',
      );
      this.state.agentStateKnown = true;
      this.state.lastSuccessfulAgentPollAtMs = Date.now();
    } catch (error) {
      console.warn('[inactivity] Failed to poll VK workspace summaries', error);
    }
  }

  getStatus(): IdleStatusResponse {
    const now = Date.now();
    const elapsedMs = now - this.state.lastUserActivityAtMs;

    let idleReason: IdleStatusResponse['idleReason'];
    let isIdle: boolean;

    if (this.state.hasRunningAgent) {
      idleReason = 'agent_running';
      isIdle = false;
    } else if (elapsedMs >= this.config.idleTimeoutMs) {
      idleReason = 'idle_timeout_elapsed';
      isIdle = true;
    } else {
      idleReason = 'recent_user_activity';
      isIdle = false;
    }

    return {
      isIdle,
      idleReason,
      idleTimeoutMs: this.config.idleTimeoutMs,
      activityDebounceMs: this.config.activityDebounceMs,
      lastUserActivityAt: toIsoString(this.state.lastUserActivityAtMs),
      lastUserActivityType: this.state.lastUserActivityType,
      lastUserActivitySource: this.state.lastUserActivitySource,
      hasRunningAgent: this.state.hasRunningAgent,
      agentStateKnown: this.state.agentStateKnown,
      agentPollIntervalMs: this.config.agentPollIntervalMs,
      lastAgentPollAt: toIsoString(this.state.lastAgentPollAtMs),
      lastSuccessfulAgentPollAt: toIsoString(
        this.state.lastSuccessfulAgentPollAtMs,
      ),
      backendBaseUrl: this.config.backendBaseUrl,
      computedAt: new Date(now).toISOString(),
    };
  }
}

type InactivityGlobal = typeof globalThis & {
  [GLOBAL_KEY]?: InactivityService;
};

const globalWithService = globalThis as InactivityGlobal;

function getInactivityService() {
  if (!globalWithService[GLOBAL_KEY]) {
    globalWithService[GLOBAL_KEY] = new InactivityService();
  }

  return globalWithService[GLOBAL_KEY]!;
}

getInactivityService().start();
// @platform end
