import type { QueueFollowUpResponse, QueueFollowUpSource } from './vk-client';
import type { DbWorkflowFactoryStore, WorkflowFactoryWorkItemReadModel } from './workflow-factory-store';
import type {
  WorkflowActivityScanResult,
  WorkflowActivityScanner,
  WorkflowSchedulerBudgetPolicy,
  WorkflowSessionScanItem,
} from './workflow-session-scanner';

export interface FactorySchedulerVkClient {
  queueFollowUp(sessionId: string, prompt: string, options?: { source?: QueueFollowUpSource }): Promise<QueueFollowUpResponse>;
}

export interface FactoryAssignmentResult {
  item: WorkflowFactoryWorkItemReadModel;
  session: WorkflowSessionScanItem;
  queued: boolean;
  queueItemId: string | null;
  error: string | null;
}

export interface FactorySchedulerRunResult {
  scan: WorkflowActivityScanResult;
  capacity: number;
  assigned: FactoryAssignmentResult[];
  failed: FactoryAssignmentResult[];
  skipped: WorkflowFactoryWorkItemReadModel[];
}

/**
 * Run-once factory scheduler foundation.
 *
 * VD owns capacity decisions here by consuming the M02 scanner read model. VK is
 * still used only through guarded queueFollowUp as the execution safety valve.
 * This service intentionally does not create sessions, fan-in responses, or run
 * lane/worktree policies; it assigns pending durable work only to already idle,
 * eligible role/lane sessions.
 */
export class WorkflowFactoryScheduler {
  constructor(
    private readonly options: {
      scanner: Pick<WorkflowActivityScanner, 'scanOnce'>;
      store: DbWorkflowFactoryStore;
      vk: FactorySchedulerVkClient;
      policy: WorkflowSchedulerBudgetPolicy;
      pendingLimit?: number;
    },
  ) {}

  async runOnce(): Promise<FactorySchedulerRunResult> {
    const scan = await this.options.scanner.scanOnce(this.options.policy);
    const capacity = computeAssignmentCapacity(scan);
    const assigned: FactoryAssignmentResult[] = [];
    const failed: FactoryAssignmentResult[] = [];
    const skipped: WorkflowFactoryWorkItemReadModel[] = [];
    if (capacity <= 0) return { scan, capacity, assigned, failed, skipped };

    const pending = await this.options.store.listWorkItems({
      status: 'pending',
      limit: this.options.pendingLimit ?? 200,
    });
    const availableSessions = scan.sessions.filter(isFactoryEligibleSession);
    const usedSessionKeys = new Set<string>();
    let remainingCapacity = capacity;

    for (const item of pending) {
      if (remainingCapacity <= 0) {
        skipped.push(item);
        continue;
      }
      const session = availableSessions.find((candidate) => {
        const key = sessionKey(candidate.workspaceId, candidate.sessionId);
        return !usedSessionKeys.has(key) && matchesWorkItem(item, candidate);
      });
      if (!session) {
        skipped.push(item);
        continue;
      }

      let reserved: WorkflowFactoryWorkItemReadModel;
      try {
        reserved = await this.options.store.reserveWorkItem(item.itemId, {
          sessionId: session.sessionId,
          bindingId: session.bindingId,
        });
      } catch {
        skipped.push(item);
        continue;
      }

      try {
        const queue = await this.options.vk.queueFollowUp(session.sessionId, reserved.prompt, {
          source: reserved.source,
        });
        const queued = await this.options.store.markWorkItemQueued(reserved.itemId, {
          queueItemId: queue.queued_item.id,
        });
        // If VK accepts the queue but markWorkItemQueued fails, this first
        // foundation can duplicate on a later retry. VK queue idempotency is a
        // later delivery/scheduler hardening slice; queue failures before VK
        // acceptance are safely released below.
        assigned.push({ item: queued, session, queued: true, queueItemId: queue.queued_item.id, error: null });
        usedSessionKeys.add(sessionKey(session.workspaceId, session.sessionId));
        remainingCapacity -= 1;
      } catch (error) {
        const released = await this.options.store.releaseReservationForRetry(reserved.itemId, {
          message: error instanceof Error ? error.message : String(error),
        });
        failed.push({ item: released, session, queued: false, queueItemId: null, error: error instanceof Error ? error.message : String(error) });
      }
    }

    return { scan, capacity, assigned, failed, skipped };
  }
}

function computeAssignmentCapacity(scan: WorkflowActivityScanResult): number {
  const executionSlots = scan.budget.availableExecutionSlots;
  const sessionSlots = scan.budget.availableWorkflowOwnedSessionSlots;
  const budget = sessionSlots == null ? executionSlots : Math.min(executionSlots, sessionSlots);
  return Math.max(0, Math.min(budget, scan.budget.eligibleSessionCount));
}

function isFactoryEligibleSession(session: WorkflowSessionScanItem): boolean {
  return session.classification === 'idle' && session.eligibleForUnrelatedWork && !session.ownsWorkflowSession && !session.consumesExecutionBudget;
}

function matchesWorkItem(item: WorkflowFactoryWorkItemReadModel, session: WorkflowSessionScanItem): boolean {
  if (item.workspaceId !== session.workspaceId) return false;
  if (item.roleId != null && item.roleId !== session.roleId) return false;
  if (item.laneId !== session.laneId) return false;
  return true;
}

function sessionKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}\0${sessionId}`;
}
