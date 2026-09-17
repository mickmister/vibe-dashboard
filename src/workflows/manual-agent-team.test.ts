import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowRegistry, runWorkflow } from '@vibe-dashboard/workflow-core';
import { initVdDb, type VdDbHandle } from '../server/database';
import { DbWorkflowRunRecorder } from '../server/workflow-run-recorder';
import { createAgentTeam, type AgentTeam } from '../teams/agentTeams';
import {
  createManualAgentTeamWorkflow,
  formatTeamAgentPrompt,
  selectTargetAgents,
  type ManualAgentTeamVkClient,
} from './manual-agent-team';

const handles: VdDbHandle[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const handle of handles.splice(0)) {
    await handle.db.destroy();
    handle.sqlite.close();
  }
});

describe('manual agent team workflow', () => {
  it('queues orchestrator and member prompts through the guarded queue path', async () => {
    const vk = createFakeVkClient();
    const workflow = createManualAgentTeamWorkflow({ vkClient: vk });
    const team = teamFixture();

    const result = await runWorkflow(registryFor(workflow), workflow.id, {
      team,
      taskPrompt: 'Work through the backlog item safely.',
      context: 'Keep scope tight.',
    }, {
      createRunId: () => 'run_team',
      now: (() => {
        let value = 100;
        return () => value++;
      })(),
    });

    expect(result.status).toBe('completed');
    expect(result.output).toMatchObject({
      outcome: 'team_prompts_queued',
      teamId: 'team-1',
      orchestratorAgentId: 'agent-orch',
      queueItemId: 'queue-session-orch',
      sessionId: 'session-orch',
      queuedAgents: [
        { agentId: 'agent-orch', sessionId: 'session-orch', queueItemId: 'queue-session-orch' },
        { agentId: 'agent-impl', sessionId: 'session-impl', queueItemId: 'queue-session-impl' },
      ],
    });
    expect(vk.queueFollowUp).toHaveBeenCalledTimes(2);
    expect(vk.queueFollowUp.mock.calls.map((call) => call[0])).toEqual(['session-orch', 'session-impl']);
    expect(vk.sendFollowUp).not.toHaveBeenCalled();
    expect(vk.queueFollowUp.mock.calls[0]?.[1]).toContain('As orchestrator');
    expect(vk.queueFollowUp.mock.calls[1]?.[1]).toContain('Coordinate through the orchestrator');
    expect(result.logs.map((entry) => entry.stepId)).toEqual([
      'validate_team',
      'queue_agent_prompt',
      'queue_agent_prompt',
    ]);
  });

  it('validates missing orchestrator session before queueing', async () => {
    const vk = createFakeVkClient();
    const workflow = createManualAgentTeamWorkflow({ vkClient: vk });
    const team = teamFixture({ orchestratorSessionId: null });

    const result = await runWorkflow(registryFor(workflow), workflow.id, {
      team,
      taskPrompt: 'Do the thing.',
    });

    expect(result.status).toBe('failed');
    expect(result.error?.message).toMatch(/Orchestrator agent agent-orch is missing vkSessionId/);
    expect(vk.queueFollowUp).not.toHaveBeenCalled();
    expect(vk.sendFollowUp).not.toHaveBeenCalled();
  });


  it('preflight-validates all selected agents before creating queued work', async () => {
    const vk = createFakeVkClient();
    const workflow = createManualAgentTeamWorkflow({ vkClient: vk });
    const team = teamFixture({ implementerSessionId: null });

    const result = await runWorkflow(registryFor(workflow), workflow.id, {
      team,
      taskPrompt: 'Do the thing without partial queueing.',
    });

    expect(result.status).toBe('failed');
    expect(result.error?.message).toMatch(/Team agent agent-impl \(Implementer\) is missing vkSessionId/);
    expect(vk.queueFollowUp).not.toHaveBeenCalled();
    expect(vk.sendFollowUp).not.toHaveBeenCalled();
  });

  it('persists primary and per-agent queue item references through the workflow recorder', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    handles.push(handle);
    const vk = createFakeVkClient();
    const workflow = createManualAgentTeamWorkflow({ vkClient: vk });

    await runWorkflow(registryFor(workflow), workflow.id, {
      team: teamFixture(),
      taskPrompt: 'Persist this run.',
    }, {
      createRunId: () => 'run_team_persisted',
      now: (() => {
        let value = 200;
        return () => value++;
      })(),
      recorder: new DbWorkflowRunRecorder({ db: handle.db }),
    });

    const run = await handle.db.selectFrom('WorkflowRun').selectAll().where('runId', '=', 'run_team_persisted').executeTakeFirstOrThrow();
    expect(run).toMatchObject({
      workflowId: 'manual-agent-team-runner',
      status: 'completed',
      vkWorkspaceId: 'workspace-session-orch',
      vkSessionId: 'session-orch',
      vkQueueItemId: 'queue-session-orch',
    });
    expect(JSON.parse(run.outputJson ?? '{}')).toMatchObject({
      queuedAgents: [
        { queueItemId: 'queue-session-orch' },
        { queueItemId: 'queue-session-impl' },
      ],
    });

    const queueEvents = await handle.db
      .selectFrom('WorkflowRunEvent')
      .selectAll()
      .where('runId', '=', 'run_team_persisted')
      .where('eventType', '=', 'step_log')
      .where('stepId', '=', 'queue_agent_prompt')
      .orderBy('eventIndex')
      .execute();
    expect(queueEvents.map((event) => JSON.parse(event.dataJson ?? '{}').queueItemId)).toEqual([
      'queue-session-orch',
      'queue-session-impl',
    ]);
  });

  it('selects enabled target agents with orchestrator first and policy cap applied', () => {
    const team = teamFixture({ maxConcurrentAgents: 1 });
    expect(selectTargetAgents(team).map((agent) => agent.id)).toEqual(['agent-orch']);
    expect(selectTargetAgents(team, ['agent-impl']).map((agent) => agent.id)).toEqual(['agent-impl']);
  });

  it('formats bounded role-aware prompts', () => {
    const team = teamFixture();
    const prompt = formatTeamAgentPrompt({
      team,
      agent: team.agents[0]!,
      taskPrompt: 'Plan the work.',
      context: 'Milestone only.',
    });
    expect(prompt).toContain('Team roster:');
    expect(prompt).toContain('Plan the work.');
    expect(prompt).toContain('Milestone only.');
    expect(prompt).toContain('As orchestrator');
  });
});

function registryFor(workflow: ReturnType<typeof createManualAgentTeamWorkflow>) {
  const registry = createWorkflowRegistry();
  registry.register(workflow);
  return registry;
}

function teamFixture(options: { orchestratorSessionId?: string | null; implementerSessionId?: string | null; maxConcurrentAgents?: number } = {}): AgentTeam {
  return createAgentTeam({
    id: 'team-1',
    name: 'Delivery Team',
    orchestratorAgentId: 'agent-orch',
    policies: { maxConcurrentAgents: options.maxConcurrentAgents ?? 2 },
    agents: [
      {
        id: 'agent-orch',
        role: 'orchestrator',
        displayName: 'Orchestrator',
        vkSessionId: options.orchestratorSessionId === undefined ? 'session-orch' : options.orchestratorSessionId,
        instructions: 'Coordinate the plan.',
      },
      {
        id: 'agent-impl',
        role: 'implementer',
        displayName: 'Implementer',
        vkSessionId: options.implementerSessionId === undefined ? 'session-impl' : options.implementerSessionId,
      },
      {
        id: 'agent-disabled',
        role: 'reviewer',
        displayName: 'Disabled Reviewer',
        enabled: false,
        vkSessionId: 'session-reviewer',
      },
    ],
  }, { now: '2026-07-22T00:00:00.000Z' });
}

function createFakeVkClient() {
  const queueFollowUp = vi.fn<ManualAgentTeamVkClient['queueFollowUp']>(async (sessionId) => ({
    queued_item: {
      id: `queue-${sessionId}`,
      session_id: sessionId,
      workspace_id: `workspace-${sessionId}`,
      status: 'queued',
      source: 'workflow',
      priority: 60,
      data: { message: 'queued', session_command: null },
    },
    status: { status: 'queued', count: 1, message: null, messages: [] },
  }));
  return {
    queueFollowUp,
    sendFollowUp: vi.fn(async () => {
      throw new Error('direct follow-up must not be used');
    }),
  };
}
