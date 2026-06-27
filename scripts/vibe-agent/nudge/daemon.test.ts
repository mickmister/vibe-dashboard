import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConversationEntry, ExecutionProcess, SendMessageBody, Session, Workspace } from '../types.js';
import {
  createNudgeDaemonOptions,
  isNudgeDaemonEnabled,
  parseBoolean,
  processIsAfterStartupCutoff,
  readNudgeDaemonState,
  runNudgeDaemonCycle,
  type NudgeDaemonClient,
} from './daemon.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempStatePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vd-nudge-daemon-'));
  tempDirs.push(dir);
  return join(dir, 'state.json');
}

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'workspace-1',
    task_id: 'task-1',
    container_ref: null,
    branch: 'main',
    agent_working_dir: null,
    setup_completed_at: null,
    archived: false,
    pinned: false,
    name: 'Workspace',
    created_at: '2026-06-26T10:00:00.000Z',
    updated_at: '2026-06-26T10:10:00.000Z',
    ...overrides,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    workspace_id: 'workspace-1',
    executor: 'CODEX',
    name: 'Implementer',
    created_at: '2026-06-26T10:00:00.000Z',
    updated_at: '2026-06-26T10:10:00.000Z',
    ...overrides,
  };
}

function process(overrides: Partial<ExecutionProcess> = {}): ExecutionProcess {
  return {
    id: 'process-1',
    session_id: 'session-1',
    status: 'failed',
    created_at: '2026-06-26T10:10:00.000Z',
    started_at: '2026-06-26T10:10:00.000Z',
    updated_at: '2026-06-26T10:10:30.000Z',
    completed_at: '2026-06-26T10:10:30.000Z',
    exit_code: 1,
    dropped: false,
    run_reason: 'codingagent',
    executor_action: { typ: { prompt: 'Implement the feature' } },
    ...overrides,
  };
}

function entry(type: string, content = ''): ConversationEntry {
  return { content: { entry_type: { type }, content } };
}

function fakeClient(input: {
  workspaces?: Workspace[];
  sessions?: Session[];
  processes?: ExecutionProcess[];
  entries?: Record<string, ConversationEntry[]>;
}) {
  const sent: Array<{ sessionId: string; body: SendMessageBody }> = [];
  const client: NudgeDaemonClient = {
    async getAllWorkspaces() {
      return input.workspaces ?? [workspace()];
    },
    async getSessions() {
      return input.sessions ?? [session()];
    },
    async getSessionProcesses() {
      return input.processes ?? [process()];
    },
    async fetchConversation(processId: string) {
      return input.entries?.[processId] ?? [entry('tool_use', 'git status'), entry('thinking', 'still working')];
    },
    async sendMessage(sessionId: string, body: SendMessageBody): Promise<ExecutionProcess> {
      sent.push({ sessionId, body });
      return process({ id: 'nudge-process', session_id: sessionId, status: 'running', completed_at: null });
    },
  };
  return { client, sent };
}

function options(statePath = tempStatePath()) {
  return createNudgeDaemonOptions(
    {
      VD_NUDGE_DAEMON_STATE_PATH: statePath,
      VD_NUDGE_DAEMON_STARTED_AFTER: '2026-06-26T10:00:00.000Z',
    },
    new Date('2026-06-26T10:00:00.000Z'),
  );
}

describe('nudge daemon', () => {
  it('keeps the daemon disabled by default and allows explicit opt-in', () => {
    expect(parseBoolean(undefined)).toBe(false);
    expect(parseBoolean('0')).toBe(false);
    expect(parseBoolean('true')).toBe(true);
    expect(parseBoolean('1')).toBe(true);
    expect(isNudgeDaemonEnabled({})).toBe(false);
    expect(isNudgeDaemonEnabled({ VD_NUDGE_DAEMON_ENABLED: 'true' })).toBe(true);
    expect(isNudgeDaemonEnabled({ VD_NUDGE_DAEMON_ENABLED: 'false' })).toBe(false);
  });

  it('only considers processes updated after the startup cutoff', () => {
    const cutoff = new Date('2026-06-26T10:00:00.000Z');
    expect(processIsAfterStartupCutoff(process({ created_at: '2026-06-26T09:50:00.000Z', started_at: '2026-06-26T09:50:00.000Z', updated_at: '2026-06-26T09:59:59.000Z', completed_at: '2026-06-26T09:59:59.000Z' }), cutoff)).toBe(false);
    expect(processIsAfterStartupCutoff(process({ updated_at: '2026-06-26T10:00:00.000Z' }), cutoff)).toBe(true);
    expect(processIsAfterStartupCutoff(process({ updated_at: '2026-06-26T10:00:01.000Z' }), cutoff)).toBe(true);
  });

  it('sends a continue nudge for a new failed coding-agent process without a final response', async () => {
    const statePath = tempStatePath();
    const { client, sent } = fakeClient({});
    const state = readNudgeDaemonState(statePath);

    const result = await runNudgeDaemonCycle(client, options(statePath), state, () => {});

    expect(result.nudgesSent).toBe(1);
    expect(sent).toEqual([
      {
        sessionId: 'session-1',
        body: {
          prompt: 'Continue',
          executor_config: { executor: 'CODEX' },
          retry_process_id: null,
          force_when_dirty: null,
          perform_git_reset: null,
        },
      },
    ]);
    expect(readNudgeDaemonState(statePath).nudgedProcessIds).toEqual(['process-1']);
  });

  it('does not send a nudge for pre-startup failures', async () => {
    const { client, sent } = fakeClient({
      sessions: [session({ updated_at: '2026-06-26T10:10:00.000Z' })],
      processes: [process({ created_at: '2026-06-26T09:50:00.000Z', started_at: '2026-06-26T09:50:00.000Z', updated_at: '2026-06-26T09:55:00.000Z', completed_at: '2026-06-26T09:55:00.000Z' })],
    });

    const result = await runNudgeDaemonCycle(client, options(), readNudgeDaemonState(tempStatePath()), () => {});

    expect(result.nudgesSent).toBe(0);
    expect(sent).toEqual([]);
  });

  it('does not nudge the same process twice after state is persisted', async () => {
    const statePath = tempStatePath();
    const { client, sent } = fakeClient({});

    await runNudgeDaemonCycle(client, options(statePath), readNudgeDaemonState(statePath), () => {});
    await runNudgeDaemonCycle(client, options(statePath), readNudgeDaemonState(statePath), () => {});

    expect(sent).toHaveLength(1);
    expect(readNudgeDaemonState(statePath).nudgedProcessIds).toEqual(['process-1']);
  });

  it('skips old sessions even when they contain nudgeable failed turns', async () => {
    const { client, sent } = fakeClient({
      sessions: [session({ updated_at: '2026-06-26T09:59:59.000Z' })],
    });

    const result = await runNudgeDaemonCycle(client, options(), readNudgeDaemonState(tempStatePath()), () => {});

    expect(result.inspectedSessions).toBe(0);
    expect(result.nudgesSent).toBe(0);
    expect(sent).toEqual([]);
  });
});
