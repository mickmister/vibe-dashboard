import { afterEach, describe, expect, it, vi } from 'vitest';
import { initVdDb, type VdDbHandle } from './database';
import { DbResponsePipeStore } from './response-pipe-store';
import { ResponsePipeService, ResponsePipeValidationError, type ResponsePipeVkClient } from './response-pipe-service';
import type { AgentResponse, QueueFollowUpResponse, Session } from './vk-client';

const handles: VdDbHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.db.destroy();
    handle.sqlite.close();
  }
});

describe('ResponsePipeService', () => {
  it('queues a guarded response pipe and records refs/hashes without durable prompt text', async () => {
    const harness = await createHarness();

    const result = await harness.service.pipeResponse(pipeInput());

    expect(harness.vk.queueFollowUp).toHaveBeenCalledWith(
      'session-b',
      expect.stringContaining('Please review this response:'),
      { source: 'workflow' },
    );
    expect(harness.vk.queueFollowUp).toHaveBeenCalledWith(
      'session-b',
      expect.stringContaining('source final answer'),
      { source: 'workflow' },
    );
    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries.at(0)).toMatchObject({ queued: true, duplicate: false });
    expect(result.deliveries.at(0)?.delivery).toMatchObject({
      status: 'queued',
      sourceExecutionProcessId: 'exec-source',
      sourceSessionId: 'session-a',
      targetSessionId: 'session-b',
      queueItemId: 'queue-1',
      renderedPromptLength: expect.any(Number),
      renderedPromptHash: expect.any(String),
    });
    expect(result.deliveries.at(0)?.delivery).not.toHaveProperty('renderedPrompt');
    expect(result.deliveries.at(0)?.delivery).not.toHaveProperty('prompt');
  });

  it('dedupes repeated deliveries and does not queue twice', async () => {
    const harness = await createHarness();

    const first = await harness.service.pipeResponse(pipeInput());
    const second = await harness.service.pipeResponse(pipeInput());

    expect(first.deliveries.at(0)).toMatchObject({ queued: true, duplicate: false });
    expect(second.deliveries.at(0)).toMatchObject({ queued: false, duplicate: true });
    expect(second.deliveries.at(0)?.delivery.deliveryId).toBe(first.deliveries.at(0)?.delivery.deliveryId);
    expect(harness.vk.queueFollowUp).toHaveBeenCalledTimes(1);
  });

  it('rejects same-session delivery before queueing', async () => {
    const harness = await createHarness();

    await expect(
      harness.service.pipeResponse(
        pipeInput({ targets: [{ workspaceId: 'ws-1', sessionId: 'session-a' }] }),
      ),
    ).rejects.toBeInstanceOf(ResponsePipeValidationError);

    expect(harness.vk.queueFollowUp).not.toHaveBeenCalled();
  });

  it('requires explicit policy for cross-workspace delivery', async () => {
    const harness = await createHarness();

    await expect(
      harness.service.pipeResponse(
        pipeInput({ targets: [{ workspaceId: 'ws-2', sessionId: 'session-c' }] }),
      ),
    ).rejects.toThrow('Cross-workspace response piping requires allowCrossWorkspace');
    expect(harness.vk.queueFollowUp).not.toHaveBeenCalled();

    const allowed = await harness.service.pipeResponse(
      pipeInput({
        allowCrossWorkspace: true,
        targets: [{ workspaceId: 'ws-2', sessionId: 'session-c' }],
      }),
    );
    expect(allowed.deliveries.at(0)).toMatchObject({ queued: true });
    expect(harness.vk.queueFollowUp).toHaveBeenCalledTimes(1);
  });

  it('blocks truncated source responses by default before queueing', async () => {
    const harness = await createHarness({ source: agentResponse({ truncated: true }) });

    await expect(harness.service.pipeResponse(pipeInput())).rejects.toThrow('Source response is truncated');
    expect(harness.vk.queueFollowUp).not.toHaveBeenCalled();
  });

  it('preflights all targets before queueing so validation failures have no partial side effects', async () => {
    const harness = await createHarness();

    await expect(
      harness.service.pipeResponse(
        pipeInput({
          targets: [
            { workspaceId: 'ws-1', sessionId: 'session-b' },
            { workspaceId: 'ws-wrong', sessionId: 'session-c' },
          ],
        }),
      ),
    ).rejects.toThrow('Target session session-c is in workspace ws-2, not ws-wrong');

    expect(harness.vk.queueFollowUp).not.toHaveBeenCalled();
  });
});

async function createHarness(options: { source?: AgentResponse } = {}) {
  const handle = await initVdDb({ path: ':memory:' });
  handles.push(handle);
  let now = 10_000;
  let deliveryId = 0;
  let queueId = 0;
  const store = new DbResponsePipeStore({ db: handle.db, now: () => now++ });
  const vk: ResponsePipeVkClient = {
    getExecutionProcessFinalMessage: vi.fn(async () => options.source ?? agentResponse()),
    getSession: vi.fn(async (sessionId) => session(sessionId)),
    queueFollowUp: vi.fn(async (_sessionId) => queueResponse(`queue-${++queueId}`)),
  };
  const service = new ResponsePipeService({
    store,
    vk,
    createId: () => `delivery-${++deliveryId}`,
  });
  return { handle, store, vk, service };
}

function pipeInput(overrides: Partial<Parameters<ResponsePipeService['pipeResponse']>[0]> = {}): Parameters<ResponsePipeService['pipeResponse']>[0] {
  return {
    sourceExecutionProcessId: 'exec-source',
    workflowInstanceId: 'instance-1',
    triggerId: 'trigger-1',
    template: {
      templateId: 'builtin.review-source-response',
      templateVersion: 1,
      body: 'Please review this response:\n\n{{source_response}}\n\nSource: {{source_session}} / {{source_execution_process_id}}',
    },
    targets: [{ workspaceId: 'ws-1', sessionId: 'session-b' }],
    ...overrides,
  };
}

function agentResponse(overrides: Partial<AgentResponse> = {}): AgentResponse {
  return {
    execution_process_id: overrides.execution_process_id ?? 'exec-source',
    session_id: overrides.session_id ?? 'session-a',
    workspace_id: overrides.workspace_id ?? 'ws-1',
    status: overrides.status ?? 'completed',
    completed_at: overrides.completed_at ?? '2026-08-04T00:00:02.000Z',
    coding_agent_turn_id: overrides.coding_agent_turn_id ?? 'turn-1',
    agent_session_id: overrides.agent_session_id ?? 'agent-session-1',
    agent_message_id: overrides.agent_message_id ?? 'agent-message-1',
    content: overrides.content ?? 'source final answer',
    truncated: overrides.truncated ?? false,
    max_chars: overrides.max_chars ?? 4096,
    source_kind: 'coding_agent_turn_summary',
  };
}

function session(sessionId: string): Session {
  return {
    id: sessionId,
    workspace_id: sessionId === 'session-c' ? 'ws-2' : 'ws-1',
    executor: 'CODEX',
    name: sessionId,
    created_at: '2026-08-04T00:00:00.000Z',
    updated_at: '2026-08-04T00:00:00.000Z',
  };
}

function queueResponse(id: string): QueueFollowUpResponse {
  return {
    queued_item: {
      id,
      session_id: 'session-b',
      workspace_id: 'ws-1',
      status: 'queued',
      source: 'workflow',
      priority: 0,
      data: { message: 'queued prompt' },
    },
    status: { count: 1, message: null, messages: [], status: 'queued' },
  };
}
