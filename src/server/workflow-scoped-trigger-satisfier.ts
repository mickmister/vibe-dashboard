import type { AgentResponse } from './vk-client';
import type { DbWorkflowOrchestrationStore, WorkflowTriggerResumeResult } from './workflow-orchestration-store';
import type {
  WorkflowActivityScanResult,
  WorkflowActivityScanner,
  WorkflowSchedulerBudgetPolicy,
  WorkflowSessionScanItem,
} from './workflow-session-scanner';

export type ScopedTriggerSatisfierAttentionKind =
  | 'failed_or_killed'
  | 'stalled_needs_attention'
  | 'truncated_response'
  | 'unknown_unreachable'
  | 'resume_skipped';

export interface ScopedTriggerSatisfierAttention {
  kind: ScopedTriggerSatisfierAttentionKind;
  triggerId: string | null;
  instanceId: string | null;
  stepStateId: string | null;
  workspaceId: string;
  sessionId: string;
  executionProcessId: string | null;
  reason: string;
}

export interface ScopedTriggerSatisfaction {
  triggerId: string;
  instanceId: string;
  stepStateId: string | null;
  executionProcessId: string;
  response: AgentResponse;
  resume: WorkflowTriggerResumeResult;
}

export interface ScopedTriggerSatisfierRunResult {
  scan: WorkflowActivityScanResult;
  satisfied: ScopedTriggerSatisfaction[];
  attention: ScopedTriggerSatisfierAttention[];
  skipped: ScopedTriggerSatisfierAttention[];
}

/**
 * Run-once durable scoped-trigger satisfier.
 *
 * This is intentionally not a background scheduler yet. It consumes the M02
 * scanner read model, satisfies only workflow-owned active session-response
 * triggers with a completed non-truncated VK response, and atomically resumes
 * the waiting WorkflowInstance/WorkflowStepState through guarded store
 * transitions. Response delivery, fanout/fan-in, factory assignment, and CLI
 * send --respond migration remain separate milestones.
 */
export class WorkflowScopedTriggerSatisfier {
  constructor(
    private readonly options: {
      scanner: WorkflowActivityScanner;
      orchestrationStore: DbWorkflowOrchestrationStore;
      policy: WorkflowSchedulerBudgetPolicy;
    },
  ) {}

  async runOnce(): Promise<ScopedTriggerSatisfierRunResult> {
    const scan = await this.options.scanner.scanOnce(this.options.policy);
    const satisfied: ScopedTriggerSatisfaction[] = [];
    const attention: ScopedTriggerSatisfierAttention[] = [];
    const skipped: ScopedTriggerSatisfierAttention[] = [];

    for (const session of scan.sessions) {
      if (!session.triggerId) continue;
      if (session.classification === 'completed_since_cursor' && session.completedResponse) {
        if (session.completedResponse.truncated) {
          attention.push(makeAttention(session, 'truncated_response', 'completed response is truncated and must not be silently consumed'));
          continue;
        }
        const resume = await this.options.orchestrationStore.satisfyScopedTriggerAndResumeWaitingStep(session.triggerId, {
          executionProcessId: session.completedResponse.execution_process_id,
          response: normalizeResponseRef(session.completedResponse),
        });
        if (resume.applied) {
          satisfied.push({
            triggerId: session.triggerId,
            instanceId: session.instanceId ?? resume.trigger.instanceId,
            stepStateId: session.stepStateId,
            executionProcessId: session.completedResponse.execution_process_id,
            response: session.completedResponse,
            resume,
          });
        } else {
          skipped.push(makeAttention(session, 'resume_skipped', resume.reason));
        }
        continue;
      }

      if (session.classification === 'failed_or_killed') {
        attention.push(makeAttention(session, 'failed_or_killed', session.reason));
      } else if (session.classification === 'stalled_needs_attention') {
        attention.push(makeAttention(session, 'stalled_needs_attention', session.reason));
      } else if (session.classification === 'unknown_unreachable') {
        attention.push(makeAttention(session, 'unknown_unreachable', session.reason));
      }
    }

    return { scan, satisfied, attention, skipped };
  }
}

function normalizeResponseRef(response: AgentResponse): Record<string, unknown> {
  return {
    executionProcessId: response.execution_process_id,
    sessionId: response.session_id,
    workspaceId: response.workspace_id,
    completedAt: response.completed_at,
    codingAgentTurnId: response.coding_agent_turn_id,
    agentSessionId: response.agent_session_id,
    agentMessageId: response.agent_message_id,
    truncated: response.truncated,
    maxChars: response.max_chars,
    sourceKind: response.source_kind,
  };
}

function makeAttention(
  session: WorkflowSessionScanItem,
  kind: ScopedTriggerSatisfierAttentionKind,
  reason: string,
): ScopedTriggerSatisfierAttention {
  return {
    kind,
    triggerId: session.triggerId,
    instanceId: session.instanceId,
    stepStateId: session.stepStateId,
    workspaceId: session.workspaceId,
    sessionId: session.sessionId,
    executionProcessId: session.completedResponse?.execution_process_id ?? session.executionProcess?.id ?? null,
    reason,
  };
}
