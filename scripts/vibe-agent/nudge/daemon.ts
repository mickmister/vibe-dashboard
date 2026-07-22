#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { client as defaultClient } from "../core/client.js";
import type {
  ConversationEntry,
  ExecutionProcess,
  QueueMessageBody,
  QueueMessageResponse,
  Session,
  Workspace,
} from "../types.js";
import {
  selectNudgeCandidateForSession,
  type NudgeCriteriaOptions,
} from "./criteria.js";

const DEFAULT_STATE_PATH = "/var/lib/vd/nudge-daemon/state.json";
const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_MAX_SESSIONS_PER_WORKSPACE = 20;
const DEFAULT_MAX_PROCESSES_PER_SESSION = 6;
const DEFAULT_CONVERSATION_TIMEOUT_MS = 5_000;
const DEFAULT_NUDGE_PROMPT = "Continue";

export interface NudgeDaemonClient {
  getAllWorkspaces(): Promise<Workspace[]>;
  getSessions(workspaceId: string): Promise<Session[]>;
  getSessionProcesses(sessionId: string): Promise<ExecutionProcess[]>;
  fetchConversation(
    processId: string,
    timeoutMs?: number,
  ): Promise<ConversationEntry[]>;
  queueMessage(
    sessionId: string,
    body: QueueMessageBody,
  ): Promise<QueueMessageResponse>;
}

export interface NudgeDaemonState {
  version: 1;
  nudgedProcessIds: string[];
}

export interface NudgeDaemonOptions {
  statePath: string;
  startedAfter: Date;
  pollIntervalMs: number;
  maxSessionsPerWorkspace: number;
  maxProcessesPerSession: number;
  conversationTimeoutMs: number;
  nudgePrompt: string;
  criteria: NudgeCriteriaOptions;
}

export interface NudgeDaemonCycleResult {
  inspectedWorkspaces: number;
  inspectedSessions: number;
  nudgesSent: number;
  errors: string[];
}

export function parseBoolean(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

export function isNudgeDaemonEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return parseBoolean(env.VD_NUDGE_DAEMON_ENABLED);
}

export function parsePositiveIntegerEnv(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function readNudgeDaemonState(statePath: string): NudgeDaemonState {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(statePath, "utf8"),
    ) as Partial<NudgeDaemonState>;
    if (parsed.version === 1 && Array.isArray(parsed.nudgedProcessIds)) {
      return {
        version: 1,
        nudgedProcessIds: parsed.nudgedProcessIds.filter(
          (id): id is string => typeof id === "string",
        ),
      };
    }
  } catch {
    // Missing or corrupt state should not block startup; the startup cutoff still prevents old-turn storms.
  }
  return { version: 1, nudgedProcessIds: [] };
}

export function writeNudgeDaemonState(
  statePath: string,
  state: NudgeDaemonState,
): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.tmp.${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tempPath, statePath);
}

export function getContainerStartedAt(now = new Date()): Date {
  try {
    const stat = fs.statSync("/proc/1");
    const candidateMs = [stat.birthtimeMs, stat.ctimeMs, stat.mtimeMs]
      .filter(
        (value) =>
          Number.isFinite(value) && value > 0 && value <= now.getTime(),
      )
      .sort((a, b) => b - a)[0];
    if (candidateMs !== undefined) return new Date(candidateMs);
  } catch {
    // Non-Linux local development falls back to daemon process startup time.
  }
  return now;
}

export function processLatestTimestamp(process: ExecutionProcess): Date | null {
  const timestamps = [
    process.updated_at,
    process.completed_at,
    process.started_at,
    process.created_at,
  ]
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    )
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps));
}

export function processIsAfterStartupCutoff(
  process: ExecutionProcess,
  startedAfter: Date,
): boolean {
  const latestTimestamp = processLatestTimestamp(process);
  return (
    latestTimestamp != null &&
    latestTimestamp.getTime() >= startedAfter.getTime()
  );
}

export function createNudgeDaemonOptions(
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): NudgeDaemonOptions {
  return {
    statePath: env.VD_NUDGE_DAEMON_STATE_PATH || DEFAULT_STATE_PATH,
    startedAfter: env.VD_NUDGE_DAEMON_STARTED_AFTER
      ? new Date(env.VD_NUDGE_DAEMON_STARTED_AFTER)
      : getContainerStartedAt(now),
    pollIntervalMs: parsePositiveIntegerEnv(
      env.VD_NUDGE_DAEMON_POLL_MS,
      DEFAULT_POLL_INTERVAL_MS,
    ),
    maxSessionsPerWorkspace: parsePositiveIntegerEnv(
      env.VD_NUDGE_DAEMON_MAX_SESSIONS,
      DEFAULT_MAX_SESSIONS_PER_WORKSPACE,
    ),
    maxProcessesPerSession: parsePositiveIntegerEnv(
      env.VD_NUDGE_DAEMON_MAX_PROCESSES,
      DEFAULT_MAX_PROCESSES_PER_SESSION,
    ),
    conversationTimeoutMs: parsePositiveIntegerEnv(
      env.VD_NUDGE_DAEMON_CONVERSATION_TIMEOUT_MS,
      DEFAULT_CONVERSATION_TIMEOUT_MS,
    ),
    nudgePrompt: env.VD_NUDGE_DAEMON_PROMPT || DEFAULT_NUDGE_PROMPT,
    criteria: {
      enableActiveStaleNudge: parseBoolean(
        env.VD_NUDGE_DAEMON_ACTIVE_STALE_ENABLED,
      ),
      activeStaleAfterMs: parsePositiveIntegerEnv(
        env.VD_NUDGE_DAEMON_ACTIVE_STALE_MS,
        10 * 60 * 1000,
      ),
    },
  };
}

export async function runNudgeDaemonCycle(
  daemonClient: NudgeDaemonClient,
  options: NudgeDaemonOptions,
  state: NudgeDaemonState,
  log: (message: string) => void = console.log,
): Promise<NudgeDaemonCycleResult> {
  const nudgedProcessIds = new Set(state.nudgedProcessIds);
  const result: NudgeDaemonCycleResult = {
    inspectedWorkspaces: 0,
    inspectedSessions: 0,
    nudgesSent: 0,
    errors: [],
  };
  const workspaces = await daemonClient.getAllWorkspaces();

  for (const workspace of workspaces.filter(
    (workspace) => !workspace.archived,
  )) {
    result.inspectedWorkspaces += 1;
    let sessions: Session[];
    try {
      sessions = (await daemonClient.getSessions(workspace.id))
        .filter(
          (session) =>
            new Date(session.updated_at).getTime() >=
            options.startedAfter.getTime(),
        )
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        )
        .slice(0, options.maxSessionsPerWorkspace);
    } catch (err) {
      result.errors.push(
        `workspace ${workspace.id}: ${(err as Error).message}`,
      );
      continue;
    }

    for (const session of sessions) {
      result.inspectedSessions += 1;
      try {
        const processes = (await daemonClient.getSessionProcesses(session.id))
          .filter((process) =>
            processIsAfterStartupCutoff(process, options.startedAfter),
          )
          .filter((process) => !nudgedProcessIds.has(process.id))
          .sort(
            (a, b) =>
              new Date(b.created_at).getTime() -
              new Date(a.created_at).getTime(),
          )
          .slice(0, options.maxProcessesPerSession);
        if (processes.length === 0) continue;

        const entriesByProcessId = new Map<string, ConversationEntry[]>();
        for (const process of processes) {
          entriesByProcessId.set(
            process.id,
            await daemonClient.fetchConversation(
              process.id,
              options.conversationTimeoutMs,
            ),
          );
        }

        const candidate = selectNudgeCandidateForSession(
          processes,
          entriesByProcessId,
          options.criteria,
        );
        if (!candidate) continue;

        await daemonClient.queueMessage(session.id, {
          message: options.nudgePrompt,
          source: "system",
        });
        nudgedProcessIds.add(candidate.process.id);
        state.nudgedProcessIds = [...nudgedProcessIds];
        writeNudgeDaemonState(options.statePath, state);
        result.nudgesSent += 1;
        log(
          `Sent nudge to session ${session.id} for process ${candidate.process.id}: ${candidate.decision.reason}`,
        );
      } catch (err) {
        result.errors.push(`session ${session.id}: ${(err as Error).message}`);
      }
    }
  }

  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runNudgeDaemon(
  daemonClient: NudgeDaemonClient = defaultClient,
  options = createNudgeDaemonOptions(),
): Promise<void> {
  let state = readNudgeDaemonState(options.statePath);
  console.log(
    `vibe-agent nudge daemon started; considering processes updated at or after ${options.startedAfter.toISOString()}`,
  );

  while (true) {
    try {
      const result = await runNudgeDaemonCycle(daemonClient, options, state);
      state = readNudgeDaemonState(options.statePath);
      if (result.nudgesSent > 0 || result.errors.length > 0) {
        console.log(
          JSON.stringify({
            type: "nudge-daemon-cycle",
            ...result,
            at: new Date().toISOString(),
          }),
        );
      }
    } catch (err) {
      console.error(`nudge daemon cycle failed: ${(err as Error).message}`);
    }
    await sleep(options.pollIntervalMs);
  }
}

async function main(): Promise<void> {
  if (!isNudgeDaemonEnabled()) {
    console.log(
      "vibe-agent nudge daemon disabled; set VD_NUDGE_DAEMON_ENABLED=true to enable it",
    );
    return;
  }

  const options = createNudgeDaemonOptions();
  if (Number.isNaN(options.startedAfter.getTime())) {
    console.error(
      "Invalid VD_NUDGE_DAEMON_STARTED_AFTER; expected an ISO timestamp",
    );
    process.exit(1);
  }
  await runNudgeDaemon(defaultClient, options);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((err) => {
    console.error(`nudge daemon failed: ${(err as Error).message}`);
    process.exit(1);
  });
}
