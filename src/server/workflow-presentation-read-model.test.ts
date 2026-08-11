import { describe, expect, it } from 'vitest';
import { initVdDb } from './database';
import { DbWorkflowOrchestrationStore } from './workflow-orchestration-store';
import { buildWorkflowPresentationModel, type WorkflowPresentationVkClient } from './workflow-presentation-read-model';
import type { AgentResponse, ExecutionProcessRepoState } from './vk-client';

describe('buildWorkflowPresentationModel', () => {
  it('builds a clean role-based timeline from durable steps and VK read models', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    try {
      const store = new DbWorkflowOrchestrationStore({ db: handle.db, now: clock(1000) });
      await seedCompletedTwoAgentWorkflow(store);
      const vk = fakeVkClient({
        exec_source: agentResponse('exec_source', 'session-source', 'ws-source', 'Implemented the feature.'),
        exec_review: agentResponse('exec_review', 'session-review', 'ws-review', 'Reviewed and approved.'),
      }, {
        exec_source: [repoState('exec_source', 'aaaaaaaaaaaa1111', 'bbbbbbbbbbbb2222', null)],
      });

      const model = await buildWorkflowPresentationModel({ store, vk, instanceId: 'instance_clean' });

      expect(model).toMatchObject({
        instanceId: 'instance_clean',
        workflowId: 'two-agent-review-round',
        workflowName: 'Two agent review round',
        status: 'completed',
        humanStatus: 'not_needed',
        originalTask: 'Build a clean page',
      });
      expect(model?.timeline).toHaveLength(2);
      expect(model?.timeline[0]).toMatchObject({
        role: 'Implementer',
        title: 'Implementation turn',
        status: 'Complete',
        session: { label: 'Implementer session', workspaceId: 'ws-source', sessionId: 'session-source' },
        initialMessage: { text: 'Please implement: Build a clean page', truncated: false },
        finalResponse: { text: 'Implemented the feature.', truncated: false },
        commits: [{ before: 'aaaaaaaaaaaa', after: 'bbbbbbbbbbbb', merge: null }],
      });
      expect(model?.timeline[1]).toMatchObject({
        role: 'Reviewer',
        title: 'Review turn',
        status: 'Complete',
        initialMessage: { text: 'Please review: Implementer response included above.', truncated: false },
        finalResponse: { text: 'Reviewed and approved.', truncated: false },
      });
    } finally {
      await handle.db.destroy();
      handle.sqlite.close();
    }
  });

  it('keeps the page useful when VK response fetching fails', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    try {
      const store = new DbWorkflowOrchestrationStore({ db: handle.db, now: clock(2000) });
      await seedCompletedTwoAgentWorkflow(store);
      const vk: WorkflowPresentationVkClient = {
        getExecutionProcessFinalMessage: async () => { throw new Error('vk unavailable'); },
        getExecutionProcessRepoStates: async () => [],
      };

      const model = await buildWorkflowPresentationModel({ store, vk, instanceId: 'instance_clean' });

      expect(model?.timeline[0]?.finalResponse).toBeNull();
      expect(model?.timeline[0]?.responseUnavailable).toBe('Response unavailable. Open the implementer session to retry or inspect the latest answer.');
      expect(model?.timeline[0]?.initialMessage?.text).toBe('Please implement: Build a clean page');
    } finally {
      await handle.db.destroy();
      handle.sqlite.close();
    }
  });

  it('includes active human attention as a user timeline item', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    try {
      const store = new DbWorkflowOrchestrationStore({ db: handle.db, now: clock(3000) });
      await store.createInstance({ instanceId: 'instance_human', workflowId: 'human-workflow', trigger: 'manual', input: { task: 'Approve plan' } });
      await store.createStepState({ id: 'step_human', instanceId: 'instance_human', stepKey: 'approval' });
      await store.startInstance('instance_human', { currentStepId: 'approval' });
      await store.markStepRunning('step_human');
      await store.createHumanAttention({
        attentionItemId: 'attention_1',
        instanceId: 'instance_human',
        stepStateId: 'step_human',
        stepKey: 'approval',
        stateVisitId: 'visit_1',
        idempotencyKey: 'instance_human:visit_1:approval',
        title: 'Approve implementation plan',
        description: 'Please answer the planning form.',
        formRef: 'beads-form://attention_1',
      });

      const model = await buildWorkflowPresentationModel({ store, instanceId: 'instance_human' });

      expect(model).toMatchObject({ humanStatus: 'waiting_for_user', attention: { title: 'Approve implementation plan', status: 'active' } });
      expect(model?.timeline).toEqual([
        expect.objectContaining({
          role: 'User',
          title: 'Approve implementation plan',
          status: 'Waiting for you',
          initialMessage: { text: 'Please answer the planning form.', truncated: false, maxChars: null },
        }),
      ]);
    } finally {
      await handle.db.destroy();
      handle.sqlite.close();
    }
  });

  it('returns null when the workflow instance does not exist', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    try {
      const store = new DbWorkflowOrchestrationStore({ db: handle.db });
      await expect(buildWorkflowPresentationModel({ store, instanceId: 'missing' })).resolves.toBeNull();
    } finally {
      await handle.db.destroy();
      handle.sqlite.close();
    }
  });
});

async function seedCompletedTwoAgentWorkflow(store: DbWorkflowOrchestrationStore) {
  await store.createInstance({
    instanceId: 'instance_clean',
    workflowId: 'two-agent-review-round',
    trigger: 'manual',
    input: { task: 'Build a clean page' },
    state: { definition: { name: 'Two agent review round' } },
  });
  await store.startInstance('instance_clean');
  await store.createStepState({
    id: 'resolve_sessions',
    instanceId: 'instance_clean',
    stepKey: 'resolve_sessions',
    status: 'completed',
    output: {
      roles: {
        source: { roleName: 'Implementer', workspaceId: 'ws-source', sessionId: 'session-source' },
        review: { roleName: 'Reviewer', workspaceId: 'ws-review', sessionId: 'session-review' },
      },
    },
  });
  await store.createStepState({ id: 'ask_source', instanceId: 'instance_clean', stepKey: 'ask_source', status: 'completed', input: { template: 'Please implement: {{inputs.task}}' }, output: { workspaceId: 'ws-source', sessionId: 'session-source' } });
  await store.createStepState({ id: 'wait_source', instanceId: 'instance_clean', stepKey: 'wait_source', status: 'completed', output: { executionProcessId: 'exec_source', workspaceId: 'ws-source', sessionId: 'session-source' } });
  await store.createStepState({ id: 'ask_review', instanceId: 'instance_clean', stepKey: 'ask_review', status: 'completed', input: { template: 'Please review: {{source.response}}' }, output: { workspaceId: 'ws-review', sessionId: 'session-review' } });
  await store.createStepState({ id: 'wait_review', instanceId: 'instance_clean', stepKey: 'wait_review', status: 'completed', output: { executionProcessId: 'exec_review', workspaceId: 'ws-review', sessionId: 'session-review' } });
  await store.completeInstance('instance_clean');
}

function fakeVkClient(responses: Record<string, AgentResponse>, states: Record<string, ExecutionProcessRepoState[]> = {}): WorkflowPresentationVkClient {
  return {
    getExecutionProcessFinalMessage: async (processId) => responses[processId] ?? agentResponse(processId, 'session', 'workspace', null),
    getExecutionProcessRepoStates: async (processId) => states[processId] ?? [],
  };
}

function agentResponse(executionProcessId: string, sessionId: string, workspaceId: string, content: string | null): AgentResponse {
  return {
    execution_process_id: executionProcessId,
    session_id: sessionId,
    workspace_id: workspaceId,
    status: 'completed',
    completed_at: '2026-08-11T00:00:00Z',
    coding_agent_turn_id: null,
    agent_session_id: null,
    agent_message_id: null,
    content,
    truncated: false,
    max_chars: 20_000,
    source_kind: 'coding_agent_turn_summary',
    prompt_preview: null,
    prompt_truncated: false,
    prompt_max_chars: 4096,
    prompt_source_kind: 'coding_agent_turn_prompt',
  };
}

function repoState(executionProcessId: string, before: string | null, after: string | null, merge: string | null): ExecutionProcessRepoState {
  return {
    id: `${executionProcessId}-repo`,
    execution_process_id: executionProcessId,
    repo_id: 'repo',
    before_head_commit: before,
    after_head_commit: after,
    merge_commit: merge,
    created_at: '2026-08-11T00:00:00Z',
    updated_at: '2026-08-11T00:00:00Z',
  };
}

function clock(start: number): () => number {
  let value = start;
  return () => value++;
}
