import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowRegistry, runWorkflow } from '@vibe-dashboard/workflow-core';
import { initVdDb, type VdDbHandle } from '../server/database';
import { DbWorkflowRunRecorder } from '../server/workflow-run-recorder';
import { createAgentTeam, type AgentTeam } from '../teams/agentTeams';
import {
  createTeamGuardrailNudgeWorkflow,
  decideTeamNudges,
  formatNudgePrompt,
  type TeamGuardrailVkClient,
} from './team-guardrail-nudge';

const handles: VdDbHandle[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const handle of handles.splice(0)) {
    await handle.db.destroy();
    handle.sqlite.close();
  }
});

describe('team guardrail nudge workflow', () => {
  it('queues system nudges only for stale eligible agents', async () => {
    const vk = createFakeVkClient();
    const workflow = createTeamGuardrailNudgeWorkflow({ vkClient: vk });
    const result = await runWorkflow(registryFor(workflow), workflow.id, {
      team: teamFixture(),
      workflowRunId: 'run_team_1',
      taskPrompt: 'Finish milestone.',
      now: '2026-07-22T12:00:00.000Z',
      staleAfterMinutes: 20,
      agentActivity: [
        { agentId: 'agent-orch', lastActivityAt: '2026-07-22T11:20:00.000Z', nudgeCount: 0 },
        { agentId: 'agent-impl', lastActivityAt: '2026-07-22T11:50:00.000Z', nudgeCount: 0 },
      ],
    });

    expect(result.status).toBe('completed');
    expect(result.output).toMatchObject({
      outcome: 'nudges_queued',
      teamId: 'team-1',
      workflowRunId: 'run_team_1',
      queueItemId: 'nudge-session-orch',
      nudges: [{ agentId: 'agent-orch', sessionId: 'session-orch', queueItemId: 'nudge-session-orch' }],
      skipped: [{ agentId: 'agent-impl', reason: 'not_stale' }],
    });
    expect(vk.queueFollowUp).toHaveBeenCalledOnce();
    expect(vk.queueFollowUp.mock.calls[0]?.[0]).toBe('session-orch');
    expect(vk.queueFollowUp.mock.calls[0]?.[1]).toContain('Guardrail nudge');
    expect(vk.queueFollowUp.mock.calls[0]?.[2]).toEqual({ source: 'system' });
    expect(vk.sendFollowUp).not.toHaveBeenCalled();
    expect(result.logs.map((entry) => entry.stepId)).toEqual(['check_team_activity', 'queue_guardrail_nudge']);
  });

  it('preflight-validates selected stale targets before queueing', async () => {
    const vk = createFakeVkClient();
    const workflow = createTeamGuardrailNudgeWorkflow({ vkClient: vk });
    const result = await runWorkflow(registryFor(workflow), workflow.id, {
      team: teamFixture({ implementerSessionId: null }),
      now: '2026-07-22T12:00:00.000Z',
      staleAfterMinutes: 20,
      agentActivity: [
        { agentId: 'agent-orch', lastActivityAt: '2026-07-22T11:10:00.000Z', nudgeCount: 0 },
        { agentId: 'agent-impl', lastActivityAt: '2026-07-22T11:10:00.000Z', nudgeCount: 0 },
      ],
    });

    expect(result.status).toBe('failed');
    expect(result.error?.message).toMatch(/Team agent agent-impl \(Implementer\) is missing vkSessionId/);
    expect(vk.queueFollowUp).not.toHaveBeenCalled();
    expect(vk.sendFollowUp).not.toHaveBeenCalled();
  });

  it('enforces nudge caps and records explicit escalation without queueing capped agents', async () => {
    const vk = createFakeVkClient();
    const workflow = createTeamGuardrailNudgeWorkflow({ vkClient: vk });
    const result = await runWorkflow(registryFor(workflow), workflow.id, {
      team: teamFixture({ maxNudgesPerRun: 1 }),
      now: '2026-07-22T12:00:00.000Z',
      staleAfterMinutes: 20,
      agentActivity: [
        { agentId: 'agent-orch', lastActivityAt: '2026-07-22T11:00:00.000Z', nudgeCount: 1 },
      ],
    });

    expect(result.output).toMatchObject({
      outcome: 'no_nudges_needed',
      escalations: [{ agentId: 'agent-orch', reason: 'nudge_cap_reached', nudgeCount: 1 }],
    });
    expect(vk.queueFollowUp).not.toHaveBeenCalled();
    expect(result.logs.map((entry) => entry.stepId)).toEqual(['check_team_activity', 'guardrail_escalation']);
  });


  it('applies maxNudgesPerRun as a total queue budget across stale agents', async () => {
    const vk = createFakeVkClient();
    const workflow = createTeamGuardrailNudgeWorkflow({ vkClient: vk });
    const team = createAgentTeam({
      id: 'team-many',
      name: 'Many Agents',
      orchestratorAgentId: 'agent-1',
      policies: { maxNudgesPerRun: 2 },
      agents: [
        { id: 'agent-1', role: 'orchestrator', displayName: 'One', vkSessionId: 'session-1' },
        { id: 'agent-2', role: 'implementer', displayName: 'Two', vkSessionId: 'session-2' },
        { id: 'agent-3', role: 'reviewer', displayName: 'Three', vkSessionId: 'session-3' },
        { id: 'agent-4', role: 'pm', displayName: 'Four', vkSessionId: 'session-4' },
      ],
    }, { now: '2026-07-22T00:00:00.000Z' });

    const result = await runWorkflow(registryFor(workflow), workflow.id, {
      team,
      now: '2026-07-22T12:00:00.000Z',
      staleAfterMinutes: 20,
      agentActivity: [
        { agentId: 'agent-1', lastActivityAt: '2026-07-22T11:00:00.000Z', nudgeCount: 0 },
        { agentId: 'agent-2', lastActivityAt: '2026-07-22T11:00:00.000Z', nudgeCount: 0 },
        { agentId: 'agent-3', lastActivityAt: '2026-07-22T11:00:00.000Z', nudgeCount: 0 },
        { agentId: 'agent-4', lastActivityAt: '2026-07-22T11:00:00.000Z', nudgeCount: 0 },
      ],
    });

    expect(result.output).toMatchObject({
      outcome: 'nudges_queued',
      nudges: [
        { agentId: 'agent-1', queueItemId: 'nudge-session-1' },
        { agentId: 'agent-2', queueItemId: 'nudge-session-2' },
      ],
      skipped: [
        { agentId: 'agent-3', reason: 'nudge_cap_reached' },
        { agentId: 'agent-4', reason: 'nudge_cap_reached' },
      ],
      escalations: [
        { agentId: 'agent-3', reason: 'nudge_cap_reached' },
        { agentId: 'agent-4', reason: 'nudge_cap_reached' },
      ],
    });
    expect(vk.queueFollowUp).toHaveBeenCalledTimes(2);
    expect(vk.queueFollowUp.mock.calls.map((call) => call[0])).toEqual(['session-1', 'session-2']);
    expect(vk.sendFollowUp).not.toHaveBeenCalled();
    expect(result.logs.map((entry) => entry.stepId)).toEqual([
      'check_team_activity',
      'queue_guardrail_nudge',
      'queue_guardrail_nudge',
      'guardrail_escalation',
      'guardrail_escalation',
    ]);
  });

  it('persists nudge queue references through the workflow recorder', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    handles.push(handle);
    const workflow = createTeamGuardrailNudgeWorkflow({ vkClient: createFakeVkClient() });

    await runWorkflow(registryFor(workflow), workflow.id, {
      team: teamFixture(),
      now: '2026-07-22T12:00:00.000Z',
      staleAfterMinutes: 20,
      agentActivity: [{ agentId: 'agent-orch', lastActivityAt: '2026-07-22T11:00:00.000Z', nudgeCount: 0 }],
    }, {
      createRunId: () => 'run_guardrail',
      recorder: new DbWorkflowRunRecorder({ db: handle.db }),
      now: (() => { let time = 100; return () => time++; })(),
    });

    const run = await handle.db.selectFrom('WorkflowRun').selectAll().where('runId', '=', 'run_guardrail').executeTakeFirstOrThrow();
    expect(run).toMatchObject({
      workflowId: 'team-guardrail-nudge',
      vkWorkspaceId: 'workspace-session-orch',
      vkSessionId: 'session-orch',
      vkQueueItemId: 'nudge-session-orch',
    });
    expect(JSON.parse(run.outputJson ?? '{}')).toMatchObject({ nudges: [{ queueItemId: 'nudge-session-orch' }] });
  });

  it('decides nudges conservatively from explicit activity snapshots', () => {
    const decisions = decideTeamNudges(teamFixture(), [
      { agentId: 'agent-orch', lastActivityAt: 100, nudgeCount: 0 },
      { agentId: 'agent-impl', lastActivityAt: null, nudgeCount: 0 },
      { agentId: 'unknown', lastActivityAt: 100, nudgeCount: 0 },
    ], { nowMs: 1_000, staleAfterMs: 500 });
    expect(decisions.toNudge.map((entry) => entry.agent.id)).toEqual(['agent-orch']);
    expect(decisions.skipped).toEqual(expect.arrayContaining([
      { agentId: 'agent-impl', reason: 'missing_activity', nudgeCount: 0 },
      { agentId: 'unknown', reason: 'not_in_team' },
    ]));
  });

  it('formats concise nudge prompt without transcripts', () => {
    const team = teamFixture();
    const prompt = formatNudgePrompt({
      team,
      agent: team.agents[0]!,
      activity: { agentId: 'agent-orch', lastActivityAt: 0, nudgeCount: 0 },
      staleMs: 3_600_000,
      taskPrompt: 'Ship it.',
      workflowRunId: 'run_1',
    });
    expect(prompt).toContain('Guardrail nudge');
    expect(prompt).toContain('60 minute');
    expect(prompt).toContain('Ship it.');
    expect(prompt).toContain('status, blockers, and the next concrete action');
  });
});

function registryFor(workflow: ReturnType<typeof createTeamGuardrailNudgeWorkflow>) {
  const registry = createWorkflowRegistry();
  registry.register(workflow);
  return registry;
}

function teamFixture(options: { implementerSessionId?: string | null; maxNudgesPerRun?: number } = {}): AgentTeam {
  return createAgentTeam({
    id: 'team-1',
    name: 'Delivery Team',
    orchestratorAgentId: 'agent-orch',
    policies: { nudgeAfterMs: 30 * 60_000, maxNudgesPerRun: options.maxNudgesPerRun ?? 3 },
    agents: [
      { id: 'agent-orch', role: 'orchestrator', displayName: 'Orchestrator', vkSessionId: 'session-orch' },
      { id: 'agent-impl', role: 'implementer', displayName: 'Implementer', vkSessionId: options.implementerSessionId === undefined ? 'session-impl' : options.implementerSessionId },
    ],
  }, { now: '2026-07-22T00:00:00.000Z' });
}

function createFakeVkClient() {
  const queueFollowUp = vi.fn<TeamGuardrailVkClient['queueFollowUp']>(async (sessionId) => ({
    queued_item: {
      id: `nudge-${sessionId}`,
      session_id: sessionId,
      workspace_id: `workspace-${sessionId}`,
      status: 'queued',
      source: 'system',
      priority: 25,
      data: { message: 'nudge', session_command: null },
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
