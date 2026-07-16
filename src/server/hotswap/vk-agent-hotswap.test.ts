import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_HOTSWAP_CONTINUE_PROMPT,
  isActiveCodingAgentProcess,
  listActiveCodingAgentTurnsFromExistingEnumeration,
  runVkAgentContinuityHotswap,
  waitForVkReadiness,
  type ActiveCodingAgentTurn,
  type HotswapState,
  type HotswapStateStore,
  type VkHotswapRuntimeClient,
} from './vk-agent-hotswap';
import type { ExecutionProcess, Session, Workspace } from '../vk-client';

describe('isActiveCodingAgentProcess', () => {
  it('accepts only active non-dropped coding-agent processes', () => {
    expect(isActiveCodingAgentProcess(process())).toBe(true);
    expect(isActiveCodingAgentProcess(process({ run_reason: 'devserver' }))).toBe(false);
    expect(isActiveCodingAgentProcess(process({ status: 'killed' }))).toBe(false);
    expect(isActiveCodingAgentProcess(process({ completed_at: '2026-07-16T00:00:00Z' }))).toBe(false);
    expect(isActiveCodingAgentProcess(process({ dropped: true }))).toBe(false);
  });
});

describe('listActiveCodingAgentTurnsFromExistingEnumeration', () => {
  it('uses existing workspace/session/process enumeration and filters to active coding-agent turns', async () => {
    const client = {
      getWorkspaces: vi.fn(async () => [workspace('ws-1'), workspace('archived', { archived: true })]),
      getSessions: vi.fn(async (workspaceId: string) => workspaceId === 'ws-1'
        ? [session('s-old', { updated_at: '2026-07-15T00:00:00Z' }), session('s-new')]
        : []),
      getSessionProcesses: vi.fn(async (sessionId: string) => sessionId === 's-new'
        ? [
            process({ id: 'p-active', session_id: sessionId }),
            process({ id: 'p-devserver', session_id: sessionId, run_reason: 'devserver' }),
            process({ id: 'p-killed', session_id: sessionId, status: 'killed' }),
          ]
        : [process({ id: 'p-old-session', session_id: sessionId })]),
    };

    const turns = await listActiveCodingAgentTurnsFromExistingEnumeration(client, { maxSessionsPerWorkspace: 1 });

    expect(turns.map(turn => turn.processId)).toEqual(['p-active']);
    expect(client.getSessions).toHaveBeenCalledWith('ws-1');
    expect(client.getSessionProcesses).toHaveBeenCalledWith('s-new');
  });
});

describe('runVkAgentContinuityHotswap', () => {
  it('captures, persists, stops to terminal, restarts, waits ready, and resumes sessions', async () => {
    const calls: string[] = [];
    const store = new MemoryHotswapStateStore();
    const vk = fakeRuntimeClient({
      calls,
      turns: [turn('ws-1', 's-1', 'p-1'), turn('ws-2', 's-2', 'p-2')],
      getExecutionProcess: async (processId) => process({ id: processId, status: 'killed', completed_at: '2026-07-16T00:00:00Z' }),
    });
    const supervisor = { restart: vi.fn(async (program: string) => { calls.push(`restart:${program}`); }) };

    const result = await runVkAgentContinuityHotswap({
      id: 'hot-1',
      targetPrograms: ['vibe-kanban', 'vibe-dashboard'],
      vkClient: vk,
      supervisor,
      stateStore: store,
      sleep: async () => undefined,
      now: fixedNow(),
    });

    expect(result.state.status).toBe('completed');
    expect(result.resumedSessions).toBe(2);
    expect(calls).toEqual([
      'listActiveCodingAgentTurns',
      'stop:p-1',
      'get:p-1',
      'stop:p-2',
      'get:p-2',
      'restart:vibe-kanban',
      'restart:vibe-dashboard',
      'ready:s-1,s-2',
      `follow-up:s-1:${DEFAULT_HOTSWAP_CONTINUE_PROMPT}`,
      `follow-up:s-2:${DEFAULT_HOTSWAP_CONTINUE_PROMPT}`,
    ]);
    expect(store.writes[0]?.status).toBe('captured');
  });

  it('blocks restart by default when a stopped process is not observed terminal before timeout', async () => {
    const calls: string[] = [];
    const store = new MemoryHotswapStateStore();
    const vk = fakeRuntimeClient({
      calls,
      turns: [turn('ws-1', 's-1', 'p-1')],
      getExecutionProcess: async (processId) => process({ id: processId, status: 'running', completed_at: null }),
    });
    const supervisor = { restart: vi.fn(async (program: string) => { calls.push(`restart:${program}`); }) };

    await expect(runVkAgentContinuityHotswap({
      id: 'hot-timeout',
      targetPrograms: ['vibe-kanban'],
      vkClient: vk,
      supervisor,
      stateStore: store,
      stopTimeoutMs: 1,
      stopPollIntervalMs: 2,
      sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
      now: fixedNow(),
    })).rejects.toThrow('Failed to stop 1 VK execution process');

    expect(supervisor.restart).not.toHaveBeenCalled();
    expect(store.latest('hot-timeout')?.status).toBe('failed');
  });

  it('continues past exhausted stop retries only with explicit force', async () => {
    const calls: string[] = [];
    const store = new MemoryHotswapStateStore();
    const vk = fakeRuntimeClient({
      calls,
      turns: [turn('ws-1', 's-1', 'p-1')],
      stopExecutionProcess: async () => { throw new Error('stop unavailable'); },
    });

    const result = await runVkAgentContinuityHotswap({
      id: 'hot-force',
      targetPrograms: ['vibe-kanban'],
      vkClient: vk,
      supervisor: { restart: vi.fn(async (program: string) => { calls.push(`restart:${program}`); }) },
      stateStore: store,
      forceStopFailures: true,
      stopRetries: 2,
      sleep: async () => undefined,
      now: fixedNow(),
    });

    expect(calls.filter(call => call === 'stop:p-1')).toHaveLength(3);
    expect(calls).toContain('restart:vibe-kanban');
    expect(result.state.status).toBe('failed');
    expect(result.state.errors.some(error => error.includes('stop unavailable'))).toBe(true);
  });

  it('is idempotent and does not send a second continue prompt for already-resumed sessions', async () => {
    const calls: string[] = [];
    const existingState: HotswapState = {
      version: 1,
      id: 'hot-retry',
      targetPrograms: ['vibe-kanban'],
      status: 'resuming',
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
      errors: [],
      sessions: {
        's-sent': {
          workspaceId: 'ws-1',
          sessionId: 's-sent',
          originalProcessId: 'p-sent',
          resumeStatus: 'sent',
          resumeProcessId: 'resume-old',
        },
        's-pending': {
          workspaceId: 'ws-2',
          sessionId: 's-pending',
          originalProcessId: 'p-pending',
          resumeStatus: 'pending',
        },
      },
    };
    const store = new MemoryHotswapStateStore(existingState);
    const vk = fakeRuntimeClient({ calls, turns: [] });

    const result = await runVkAgentContinuityHotswap({
      id: 'hot-retry',
      targetPrograms: ['vibe-kanban'],
      vkClient: vk,
      supervisor: { restart: vi.fn() },
      stateStore: store,
      sleep: async () => undefined,
      now: fixedNow(),
    });

    expect(calls).toEqual([`follow-up:s-pending:${DEFAULT_HOTSWAP_CONTINUE_PROMPT}`]);
    expect(result.state.sessions['s-sent']?.resumeProcessId).toBe('resume-old');
    expect(result.state.sessions['s-pending']?.resumeStatus).toBe('sent');
  });
});

describe('waitForVkReadiness', () => {
  it('requires health, info, and captured sessions to be readable', async () => {
    const calls: string[] = [];
    let healthAttempts = 0;
    const client = {
      checkHealth: vi.fn(async () => {
        calls.push('health');
        healthAttempts += 1;
        if (healthAttempts === 1) throw new Error('starting');
      }),
      getInfo: vi.fn(async () => {
        calls.push('info');
        return { version: 'test' };
      }),
      getSession: vi.fn(async (sessionId: string) => {
        calls.push(`session:${sessionId}`);
        return session(sessionId);
      }),
    };

    await waitForVkReadiness(client, ['s-1', 's-2'], { sleep: async () => undefined });

    expect(calls).toEqual(['health', 'health', 'info', 'session:s-1', 'session:s-2']);
  });

  it('times out when the readiness contract never succeeds', async () => {
    const client = {
      checkHealth: vi.fn(async () => { throw new Error('not ready'); }),
      getInfo: vi.fn(async () => ({ version: 'test' })),
      getSession: vi.fn(async (sessionId: string) => session(sessionId)),
    };

    await expect(waitForVkReadiness(client, ['s-1'], {
      timeoutMs: 1,
      pollIntervalMs: 2,
      sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    })).rejects.toThrow('Timed out waiting for VK readiness');
  });
});

class MemoryHotswapStateStore implements HotswapStateStore {
  readonly states = new Map<string, HotswapState>();
  readonly writes: HotswapState[] = [];

  constructor(initialState?: HotswapState) {
    if (initialState) this.states.set(initialState.id, structuredClone(initialState));
  }

  async read(id: string): Promise<HotswapState | null> {
    const state = this.states.get(id);
    return state ? structuredClone(state) : null;
  }

  async write(state: HotswapState): Promise<void> {
    const clone = structuredClone(state);
    this.states.set(state.id, clone);
    this.writes.push(clone);
  }

  latest(id: string): HotswapState | undefined {
    return this.states.get(id);
  }
}

function fakeRuntimeClient(options: {
  calls: string[];
  turns: ActiveCodingAgentTurn[];
  stopExecutionProcess?: (processId: string) => Promise<void>;
  getExecutionProcess?: (processId: string) => Promise<ExecutionProcess>;
}): VkHotswapRuntimeClient {
  return {
    listActiveCodingAgentTurns: vi.fn(async () => {
      options.calls.push('listActiveCodingAgentTurns');
      return options.turns;
    }),
    stopExecutionProcess: vi.fn(async (processId: string) => {
      options.calls.push(`stop:${processId}`);
      if (options.stopExecutionProcess) await options.stopExecutionProcess(processId);
    }),
    getExecutionProcess: vi.fn(async (processId: string) => {
      options.calls.push(`get:${processId}`);
      return options.getExecutionProcess ? options.getExecutionProcess(processId) : process({ id: processId, status: 'killed', completed_at: '2026-07-16T00:00:00Z' });
    }),
    waitUntilReady: vi.fn(async (sessionIds: string[]) => {
      options.calls.push(`ready:${sessionIds.join(',')}`);
    }),
    sendFollowUp: vi.fn(async (sessionId: string, prompt: string) => {
      options.calls.push(`follow-up:${sessionId}:${prompt}`);
      return process({ id: `resume-${sessionId}`, session_id: sessionId });
    }),
  };
}

function turn(workspaceId: string, sessionId: string, processId: string): ActiveCodingAgentTurn {
  return { workspaceId, sessionId, processId, process: process({ id: processId, session_id: sessionId }) };
}

function workspace(id: string, overrides: Partial<Workspace> = {}): Workspace {
  return {
    id,
    task_id: `task-${id}`,
    container_ref: null,
    branch: 'feature/test',
    agent_working_dir: null,
    created_at: '2026-07-16T00:00:00Z',
    updated_at: '2026-07-16T00:00:00Z',
    archived: false,
    pinned: false,
    name: id,
    ...overrides,
  };
}

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    workspace_id: 'ws-1',
    executor: 'CODEX',
    created_at: '2026-07-16T00:00:00Z',
    updated_at: '2026-07-16T00:00:00Z',
    ...overrides,
  };
}

function process(overrides: Partial<ExecutionProcess> = {}): ExecutionProcess {
  return {
    id: 'p-1',
    session_id: 's-1',
    status: 'running',
    created_at: '2026-07-16T00:00:00Z',
    started_at: '2026-07-16T00:00:00Z',
    completed_at: null,
    updated_at: '2026-07-16T00:00:00Z',
    exit_code: null,
    dropped: false,
    run_reason: 'codingagent',
    ...overrides,
  };
}

function fixedNow(): () => Date {
  return () => new Date('2026-07-16T00:00:00.000Z');
}
