import { afterEach, describe, expect, it, vi } from 'vitest';
import { initVdDb, type VdDbHandle } from './database';
import { WorkflowRoleSessionResolver, type RoleSessionVkClient } from './role-session-resolver';
import type { Executor, Session } from './vk-client';
import type { AgentTeam } from '../teams/agentTeams';

const handles: VdDbHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.db.destroy();
    handle.sqlite.close();
  }
});

function team(agentOverrides: Partial<AgentTeam['agents'][number]>[] = []): AgentTeam {
  return {
    id: 'team-1',
    version: 1,
    name: 'Team',
    orchestratorAgentId: 'agent-orchestrator',
    agents: [
      {
        id: 'agent-orchestrator',
        role: 'orchestrator',
        displayName: 'Orchestrator',
        enabled: true,
        vkWorkspaceId: 'ws-1',
        vkSessionId: null,
        executor: 'CODEX',
        instructions: null,
      },
      ...agentOverrides.map((override, index) => ({
        id: override.id ?? `agent-${index}`,
        role: override.role ?? `role-${index}`,
        displayName: override.displayName ?? `Role ${index}`,
        enabled: override.enabled ?? true,
        vkWorkspaceId: override.vkWorkspaceId ?? 'ws-1',
        vkSessionId: override.vkSessionId ?? null,
        executor: override.executor ?? 'CODEX',
        instructions: override.instructions ?? null,
      })),
    ],
    policies: {
      maxConcurrentAgents: 4,
      requireOrchestrator: true,
      allowWorkspaceParallelism: false,
      nudgeAfterMs: null,
      maxNudgesPerRun: 3,
    },
    workflowBindings: [],
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  };
}

async function createHarness(sessions: Session[] = []) {
  const handle = await initVdDb({ path: ':memory:' });
  handles.push(handle);
  const sessionMap = new Map(sessions.map((session) => [session.id, session]));
  let created = 0;
  let now = 1000;
  let binding = 0;
  const vk: RoleSessionVkClient = {
    getSessions: vi.fn(async (workspaceId) => [...sessionMap.values()].filter((session) => session.workspace_id === workspaceId)),
    getSession: vi.fn(async (sessionId) => {
      const session = sessionMap.get(sessionId);
      if (!session) throw new Error(`missing session ${sessionId}`);
      return session;
    }),
    createSession: vi.fn(async (body) => {
      created += 1;
      const session = makeSession({
        id: `created-${created}`,
        workspace_id: body.workspace_id,
        executor: body.executor,
        name: body.name ?? null,
        created_at: `2026-07-31T00:00:0${created}.000Z`,
        updated_at: `2026-07-31T00:00:0${created}.000Z`,
      });
      sessionMap.set(session.id, session);
      return session;
    }),
  };
  const resolver = new WorkflowRoleSessionResolver({
    db: handle.db,
    vk,
    now: () => now++,
    createBindingId: () => `binding-${++binding}`,
  });
  return { handle, resolver, vk, sessionMap };
}

function makeSession(input: Partial<Session> & { id: string; workspace_id?: string; executor?: Executor }): Session {
  return {
    id: input.id,
    workspace_id: input.workspace_id ?? 'ws-1',
    executor: input.executor ?? 'CODEX',
    name: input.name ?? null,
    created_at: input.created_at ?? '2026-07-31T00:00:00.000Z',
    updated_at: input.updated_at ?? '2026-07-31T00:00:00.000Z',
  };
}

describe('WorkflowRoleSessionResolver', () => {
  it('reuses an existing binding for the same workspace lane and role', async () => {
    const { resolver, vk } = await createHarness([makeSession({ id: 'bound-session', name: 'orchestrator' })]);
    await resolver.resolve({ team: team(), workspaceId: 'ws-1', laneId: 'lane-a', roleIds: ['agent-orchestrator'] });

    const second = await resolver.resolve({ team: team(), workspaceId: 'ws-1', laneId: 'lane-a', roleIds: ['agent-orchestrator'] });

    expect(second).toMatchObject({ ok: true, results: [{ sessionId: 'bound-session', source: 'auto_reused' }] });
    expect(vk.createSession).not.toHaveBeenCalled();
  });

  it('explicit override wins and persists as user_selected with mismatch warning', async () => {
    const { resolver } = await createHarness([makeSession({ id: 'override-session', executor: 'CLAUDE_CODE', name: 'manual' })]);

    const result = await resolver.resolve({
      team: team(),
      workspaceId: 'ws-1',
      roleIds: ['agent-orchestrator'],
      overrides: { 'agent-orchestrator': 'override-session' },
    });

    expect(result).toMatchObject({
      ok: true,
      results: [{ sessionId: 'override-session', source: 'user_selected', executor: 'CLAUDE_CODE' }],
    });
    expect(result.warnings[0]).toContain('differs from expected CODEX');
  });

  it('reuses valid AgentTeam vkSessionId before role-name reuse', async () => {
    const { resolver, vk } = await createHarness([
      makeSession({ id: 'team-session', name: 'different' }),
      makeSession({ id: 'named-session', name: 'orchestrator' }),
    ]);
    const configured = team([{ id: 'agent-extra', role: 'reviewer' }]);
    configured.agents[0] = { ...configured.agents[0]!, vkSessionId: 'team-session' };

    const result = await resolver.resolve({ team: configured, workspaceId: 'ws-1', roleIds: ['agent-orchestrator'] });

    expect(result).toMatchObject({ ok: true, results: [{ sessionId: 'team-session', source: 'team_config' }] });
    expect(vk.createSession).not.toHaveBeenCalled();
  });

  it('reuses matching role-name session when no binding or team session exists', async () => {
    const { resolver, vk } = await createHarness([
      makeSession({ id: 'old-reviewer', name: 'reviewer', updated_at: '2026-07-31T00:00:00.000Z' }),
      makeSession({ id: 'new-reviewer', name: 'reviewer', updated_at: '2026-07-31T00:01:00.000Z' }),
    ]);
    const configured = team([{ id: 'agent-reviewer', role: 'reviewer', displayName: 'Reviewer' }]);

    const result = await resolver.resolve({ team: configured, workspaceId: 'ws-1', roleIds: ['agent-reviewer'] });

    expect(result).toMatchObject({ ok: true, results: [{ sessionId: 'new-reviewer', source: 'auto_reused' }] });
    expect(vk.createSession).not.toHaveBeenCalled();
  });

  it('auto-creates missing sessions by role name when allowed', async () => {
    const { resolver, vk } = await createHarness([]);

    const result = await resolver.resolve({ team: team(), workspaceId: 'ws-1', roleIds: ['agent-orchestrator'] });

    expect(result).toMatchObject({ ok: true, results: [{ sessionId: 'created-1', source: 'auto_created' }] });
    expect(vk.createSession).toHaveBeenCalledWith({ workspace_id: 'ws-1', executor: 'CODEX', name: 'orchestrator' });
  });

  it('keeps lane namespaces isolated for role bindings', async () => {
    const { resolver } = await createHarness([makeSession({ id: 'lane-a-session', name: 'orchestrator' })]);
    await resolver.resolve({ team: team(), workspaceId: 'ws-1', laneId: 'lane-a', roleIds: ['agent-orchestrator'] });

    const laneB = await resolver.resolve({ team: team(), workspaceId: 'ws-1', laneId: 'lane-b', roleIds: ['agent-orchestrator'], allowRoleNameReuse: false });

    expect(laneB).toMatchObject({ ok: true, results: [{ sessionId: 'created-1', source: 'auto_created', laneId: 'lane-b' }] });
  });

  it('does not persist partial bindings when validation fails', async () => {
    const { resolver, vk } = await createHarness([makeSession({ id: 'override-session', workspace_id: 'other-ws', name: 'orchestrator' })]);

    const result = await resolver.resolve({
      team: team([{ id: 'agent-reviewer', role: 'reviewer', displayName: 'Reviewer' }]),
      workspaceId: 'ws-1',
      roleIds: ['agent-orchestrator', 'agent-reviewer'],
      overrides: { 'agent-orchestrator': 'override-session' },
    });

    expect(result.ok).toBe(false);
    expect(vk.createSession).not.toHaveBeenCalled();
    await expect(resolver.listBindings()).resolves.toEqual([]);
  });

  it('returns an error rather than silently replacing when auto-create is disabled and executor mismatches', async () => {
    const { resolver, vk } = await createHarness([makeSession({ id: 'wrong-executor', executor: 'CLAUDE_CODE', name: 'orchestrator' })]);
    const configured = team();
    configured.agents[0] = { ...configured.agents[0]!, vkSessionId: 'wrong-executor', executor: 'CODEX' };

    const result = await resolver.resolve({ team: configured, workspaceId: 'ws-1', roleIds: ['agent-orchestrator'], allowAutoCreate: false });

    expect(result).toMatchObject({ ok: false, errors: [{ roleId: 'agent-orchestrator' }] });
    expect(result.errors[0]?.error).toContain('No reusable VK session found');
    expect(vk.createSession).not.toHaveBeenCalled();
    await expect(resolver.listBindings()).resolves.toEqual([]);
  });
});
