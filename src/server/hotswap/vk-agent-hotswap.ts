import type { ExecutionProcess, Session, Workspace } from '../vk-client';

export const DEFAULT_HOTSWAP_CONTINUE_PROMPT =
  'Please continue. The app was hotswapped and your previous turn was stopped so the updated server could restart.';

const TERMINAL_PROCESS_STATUSES = new Set<ExecutionProcess['status']>([
  'completed',
  'failed',
  'killed',
]);

export interface ActiveCodingAgentTurn {
  workspaceId: string;
  sessionId: string;
  processId: string;
  process: ExecutionProcess;
}

export interface ExistingVkTurnEnumerator {
  getWorkspaces(): Promise<Workspace[]>;
  getSessions(workspaceId: string): Promise<Session[]>;
  getSessionProcesses(sessionId: string): Promise<ExecutionProcess[]>;
}

export interface ListActiveCodingAgentTurnsOptions {
  maxSessionsPerWorkspace?: number;
}

export interface HotswapResumeSessionState {
  workspaceId: string;
  sessionId: string;
  originalProcessId: string;
  resumeStatus: 'pending' | 'sent' | 'failed' | 'skipped';
  resumeProcessId?: string;
  resumedAt?: string;
  error?: string;
}

export interface HotswapState {
  version: 1;
  id: string;
  targetPrograms: string[];
  status:
    | 'captured'
    | 'stopping'
    | 'restarting'
    | 'waiting_ready'
    | 'resuming'
    | 'completed'
    | 'failed';
  createdAt: string;
  updatedAt: string;
  sessions: Record<string, HotswapResumeSessionState>;
  errors: string[];
}

export interface HotswapStateStore {
  read(id: string): Promise<HotswapState | null>;
  write(state: HotswapState): Promise<void>;
}

export interface VkHotswapRuntimeClient {
  listActiveCodingAgentTurns(): Promise<ActiveCodingAgentTurn[]>;
  stopExecutionProcess(processId: string): Promise<void>;
  getExecutionProcess(processId: string): Promise<ExecutionProcess>;
  waitUntilReady(sessionIds: string[]): Promise<void>;
  sendFollowUp(sessionId: string, prompt: string): Promise<ExecutionProcess>;
}

export interface SupervisorRestarter {
  restart(programName: string): Promise<void>;
}

export interface VkReadinessClient {
  checkHealth(): Promise<void>;
  getInfo(): Promise<unknown>;
  getSession(sessionId: string): Promise<Session>;
}

export interface WaitForVkReadinessOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface VkAgentHotswapOptions {
  id: string;
  targetPrograms: string[];
  vkClient: VkHotswapRuntimeClient;
  supervisor: SupervisorRestarter;
  stateStore: HotswapStateStore;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  forceStopFailures?: boolean;
  stopTimeoutMs?: number;
  stopPollIntervalMs?: number;
  stopRetries?: number;
  resumePrompt?: string;
  resumeSpacingMs?: number;
}

export interface VkAgentHotswapResult {
  state: HotswapState;
  capturedTurns: number;
  resumedSessions: number;
}

export function isTerminalProcess(process: Pick<ExecutionProcess, 'status' | 'completed_at'>): boolean {
  return TERMINAL_PROCESS_STATUSES.has(process.status) || process.completed_at != null;
}

export function isActiveCodingAgentProcess(
  process: Pick<ExecutionProcess, 'status' | 'completed_at' | 'dropped' | 'run_reason'>,
): boolean {
  return process.run_reason === 'codingagent'
    && !process.dropped
    && !TERMINAL_PROCESS_STATUSES.has(process.status)
    && process.completed_at == null;
}

export async function listActiveCodingAgentTurnsFromExistingEnumeration(
  client: ExistingVkTurnEnumerator,
  options: ListActiveCodingAgentTurnsOptions = {},
): Promise<ActiveCodingAgentTurn[]> {
  const turns: ActiveCodingAgentTurn[] = [];
  const workspaces = (await client.getWorkspaces()).filter((workspace) => !workspace.archived);

  for (const workspace of workspaces) {
    const sessions = (await client.getSessions(workspace.id))
      .sort((a, b) => parseTimestamp(b.updated_at) - parseTimestamp(a.updated_at))
      .slice(0, options.maxSessionsPerWorkspace ?? 20);

    for (const session of sessions) {
      const processes = await client.getSessionProcesses(session.id);
      for (const process of processes) {
        if (!isActiveCodingAgentProcess(process)) continue;
        turns.push({
          workspaceId: workspace.id,
          sessionId: session.id,
          processId: process.id,
          process,
        });
      }
    }
  }

  return turns.sort((a, b) => parseTimestamp(b.process.created_at) - parseTimestamp(a.process.created_at));
}

export async function runVkAgentContinuityHotswap(
  options: VkAgentHotswapOptions,
): Promise<VkAgentHotswapResult> {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? defaultSleep;
  const stopTimeoutMs = options.stopTimeoutMs ?? 30_000;
  const stopPollIntervalMs = options.stopPollIntervalMs ?? 1_000;
  const stopRetries = options.stopRetries ?? 1;
  const resumePrompt = options.resumePrompt ?? DEFAULT_HOTSWAP_CONTINUE_PROMPT;
  const resumeSpacingMs = options.resumeSpacingMs ?? 250;

  let state = await options.stateStore.read(options.id);
  if (!state) {
    const capturedTurns = await options.vkClient.listActiveCodingAgentTurns();
    state = createInitialState({
      id: options.id,
      targetPrograms: options.targetPrograms,
      turns: capturedTurns,
      now,
    });
    await options.stateStore.write(state);
  }

  try {
    if (state.status === 'captured' || state.status === 'stopping') {
      state = touch({ ...state, status: 'stopping' }, now);
      await options.stateStore.write(state);
      const stopErrors = await stopCapturedTurns({
        state,
        vkClient: options.vkClient,
        timeoutMs: stopTimeoutMs,
        pollIntervalMs: stopPollIntervalMs,
        retries: stopRetries,
        sleep,
      });
      if (stopErrors.length > 0) {
        state = touch({ ...state, errors: [...state.errors, ...stopErrors] }, now);
        await options.stateStore.write(state);
        if (!options.forceStopFailures) {
          throw new Error(`Failed to stop ${stopErrors.length} VK execution process(es)`);
        }
      }
    }

    if (state.status === 'stopping' || state.status === 'restarting') {
      state = touch({ ...state, status: 'restarting' }, now);
      await options.stateStore.write(state);
      for (const program of state.targetPrograms) {
        await options.supervisor.restart(program);
      }
    }

    if (state.status === 'restarting' || state.status === 'waiting_ready') {
      state = touch({ ...state, status: 'waiting_ready' }, now);
      await options.stateStore.write(state);
      await options.vkClient.waitUntilReady(Object.keys(state.sessions));
    }

    state = touch({ ...state, status: 'resuming' }, now);
    await options.stateStore.write(state);
    let resumedSessions = 0;
    for (const session of Object.values(state.sessions)) {
      if (session.resumeStatus === 'sent') continue;
      try {
        const resumeProcess = await options.vkClient.sendFollowUp(session.sessionId, resumePrompt);
        session.resumeStatus = 'sent';
        session.resumeProcessId = resumeProcess.id;
        session.resumedAt = now().toISOString();
        delete session.error;
        resumedSessions += 1;
      } catch (error) {
        session.resumeStatus = 'failed';
        session.error = errorMessage(error);
        state.errors.push(`session ${session.sessionId}: ${session.error}`);
      }
      state = touch(state, now);
      await options.stateStore.write(state);
      if (resumeSpacingMs > 0) await sleep(resumeSpacingMs);
    }

    state = touch({ ...state, status: state.errors.length > 0 ? 'failed' : 'completed' }, now);
    await options.stateStore.write(state);
    return { state, capturedTurns: Object.keys(state.sessions).length, resumedSessions };
  } catch (error) {
    state = touch({ ...state, status: 'failed', errors: [...state.errors, errorMessage(error)] }, now);
    await options.stateStore.write(state);
    throw error;
  }
}

export async function waitForVkReadiness(
  client: VkReadinessClient,
  sessionIds: string[],
  options: WaitForVkReadinessOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      await client.checkHealth();
      await client.getInfo();
      for (const sessionId of sessionIds) {
        await client.getSession(sessionId);
      }
      return;
    } catch (error) {
      lastError = error;
      await sleep(pollIntervalMs);
    }
  }

  throw new Error(`Timed out waiting for VK readiness: ${errorMessage(lastError)}`);
}

function createInitialState(input: {
  id: string;
  targetPrograms: string[];
  turns: ActiveCodingAgentTurn[];
  now: () => Date;
}): HotswapState {
  const timestamp = input.now().toISOString();
  const sessions: Record<string, HotswapResumeSessionState> = {};
  for (const turn of input.turns) {
    sessions[turn.sessionId] ??= {
      workspaceId: turn.workspaceId,
      sessionId: turn.sessionId,
      originalProcessId: turn.processId,
      resumeStatus: 'pending',
    };
  }
  return {
    version: 1,
    id: input.id,
    targetPrograms: [...input.targetPrograms],
    status: 'captured',
    createdAt: timestamp,
    updatedAt: timestamp,
    sessions,
    errors: [],
  };
}

async function stopCapturedTurns(input: {
  state: HotswapState;
  vkClient: VkHotswapRuntimeClient;
  timeoutMs: number;
  pollIntervalMs: number;
  retries: number;
  sleep: (ms: number) => Promise<void>;
}): Promise<string[]> {
  const errors: string[] = [];
  for (const session of Object.values(input.state.sessions)) {
    const attempts = Math.max(1, input.retries + 1);
    let lastError: string | null = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await input.vkClient.stopExecutionProcess(session.originalProcessId);
        await waitForTerminalProcess({
          processId: session.originalProcessId,
          vkClient: input.vkClient,
          timeoutMs: input.timeoutMs,
          pollIntervalMs: input.pollIntervalMs,
          sleep: input.sleep,
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = `process ${session.originalProcessId} stop attempt ${attempt}/${attempts}: ${errorMessage(error)}`;
      }
    }
    if (lastError) errors.push(lastError);
  }
  return errors;
}

async function waitForTerminalProcess(input: {
  processId: string;
  vkClient: Pick<VkHotswapRuntimeClient, 'getExecutionProcess'>;
  timeoutMs: number;
  pollIntervalMs: number;
  sleep: (ms: number) => Promise<void>;
}): Promise<ExecutionProcess> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= input.timeoutMs) {
    const process = await input.vkClient.getExecutionProcess(input.processId);
    if (isTerminalProcess(process)) return process;
    await input.sleep(input.pollIntervalMs);
  }
  throw new Error(`Timed out waiting for process ${input.processId} to become terminal`);
}

function touch(state: HotswapState, now: () => Date): HotswapState {
  state.updatedAt = now().toISOString();
  return state;
}

function parseTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
