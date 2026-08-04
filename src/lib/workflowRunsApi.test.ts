import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkflowLaunchRequestError, fetchWorkflowRunEvents, fetchWorkflowRuns, runManualAgentTeamWorkflow, runWorkflowById } from './workflowRunsApi';

describe('workflow run API client', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads workflow runs with useful filters', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ runs: [], limit: 20, offset: 0, hasMore: false })));
    await expect(fetchWorkflowRuns({ workflowId: 'manual-agent-team-runner', status: 'completed', limit: 20 })).resolves.toMatchObject({ runs: [] });
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/workflow-runs?workflowId=manual-agent-team-runner&status=completed&limit=20', { headers: { Accept: 'application/json' } });
  });

  it('loads workflow run events', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ events: [], limit: 50, offset: 0, hasMore: false })));
    await fetchWorkflowRunEvents('run/1', { limit: 50 });
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/workflow-runs/run%2F1/events?limit=50', { headers: { Accept: 'application/json' } });
  });

  it('launches manual team workflow with the selected payload', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ run: { runId: 'run_1' } })));
    await expect(runManualAgentTeamWorkflow({ taskPrompt: 'Do it' })).resolves.toMatchObject({ run: { runId: 'run_1' } });
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/workflows/manual-agent-team-runner/run', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskPrompt: 'Do it' }),
    });
  });

  it('returns persisted failed workflow runs for inspection', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ run: { runId: 'run_failed', status: 'failed', error: { message: 'Missing session' } } }), { status: 500 }));
    await expect(runWorkflowById('team-guardrail-nudge', { team: 'bad' })).resolves.toMatchObject({ run: { runId: 'run_failed', status: 'failed' } });
  });

  it('throws validation/request failures that have no persisted run', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'team is required' }), { status: 400 }));
    await expect(runWorkflowById('manual-agent-team-runner', {})).rejects.toMatchObject({ name: 'WorkflowLaunchRequestError', status: 400, persistedRun: null });
    await expect(runWorkflowById('manual-agent-team-runner', {})).rejects.toBeInstanceOf(WorkflowLaunchRequestError);
  });
});
