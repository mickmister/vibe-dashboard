import type { Kysely } from 'kysely';
import type {
  WorkflowLogEntry,
  WorkflowRecorder,
  WorkflowRunRecord,
} from '@vibe-dashboard/workflow-core';
import type { DB } from '../store/kysely_types';

export const DEFAULT_WORKFLOW_EVENT_CAP = 500;
const REDACTED = '[REDACTED]';
const REDACT_KEY_PATTERN = /(secret|token|signature|password|authorization|cookie|private[_-]?key|access[_-]?key|api[_-]?key|client[_-]?secret)/i;

export interface WorkflowRunRecorderOptions {
  db?: Kysely<DB>;
  getDb?: () => Promise<Kysely<DB>> | Kysely<DB>;
  eventCap?: number;
}

interface WorkflowRunReferences {
  vkWorkspaceId: string | null;
  vkSessionId: string | null;
  vkQueueItemId: string | null;
  vkExecutionProcessId: string | null;
}

interface PersistedWorkflowEvent {
  eventType: 'run_started' | 'step_log' | 'truncated' | 'run_completed';
  stepId: string | null;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
  data: unknown;
}

export class DbWorkflowRunRecorder implements WorkflowRecorder {
  private readonly getDbHandle: () => Promise<Kysely<DB>> | Kysely<DB>;
  private readonly eventCap: number;

  constructor(options: WorkflowRunRecorderOptions) {
    if (!options.db && !options.getDb) {
      throw new Error('DbWorkflowRunRecorder requires db or getDb');
    }
    this.getDbHandle = options.getDb ?? (() => options.db as Kysely<DB>);
    this.eventCap = Math.max(2, Math.floor(options.eventCap ?? DEFAULT_WORKFLOW_EVENT_CAP));
  }

  async onRunStarted(run: WorkflowRunRecord): Promise<void> {
    const db = await this.getDb();
    await db
      .insertInto('WorkflowRun')
      .values({
        runId: run.runId,
        workflowId: run.workflowId,
        trigger: run.trigger,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: null,
        durationMs: null,
        inputJson: stringifyRedacted(run.input),
        outputJson: null,
        errorJson: null,
        vkWorkspaceId: null,
        vkSessionId: null,
        vkQueueItemId: null,
        vkExecutionProcessId: null,
      })
      .onConflict((oc) => oc.column('runId').doUpdateSet({
        workflowId: run.workflowId,
        trigger: run.trigger,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: null,
        durationMs: null,
        inputJson: stringifyRedacted(run.input),
        outputJson: null,
        errorJson: null,
        vkWorkspaceId: null,
        vkSessionId: null,
        vkQueueItemId: null,
        vkExecutionProcessId: null,
        updatedAt: new Date().toISOString(),
      }))
      .execute();

    await this.replaceEvents(run);
  }

  async onRunCompleted(run: WorkflowRunRecord): Promise<void> {
    const refs = extractWorkflowRunReferences(run.output);
    const db = await this.getDb();
    await db
      .updateTable('WorkflowRun')
      .set({
        status: run.status,
        completedAt: run.completedAt ?? null,
        durationMs: run.durationMs ?? null,
        inputJson: stringifyRedacted(run.input),
        outputJson: run.output === undefined ? null : stringifyRedacted(run.output),
        errorJson: run.error === undefined ? null : stringifyRedacted(run.error),
        vkWorkspaceId: refs.vkWorkspaceId,
        vkSessionId: refs.vkSessionId,
        vkQueueItemId: refs.vkQueueItemId,
        vkExecutionProcessId: refs.vkExecutionProcessId,
        updatedAt: new Date().toISOString(),
      })
      .where('runId', '=', run.runId)
      .executeTakeFirst();

    await this.replaceEvents(run);
  }

  private async getDb(): Promise<Kysely<DB>> {
    return this.getDbHandle();
  }

  private async replaceEvents(run: WorkflowRunRecord): Promise<void> {
    const events = buildPersistedEvents(run, this.eventCap);
    const db = await this.getDb();
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('WorkflowRunEvent').where('runId', '=', run.runId).execute();
      if (events.length === 0) return;
      await trx
        .insertInto('WorkflowRunEvent')
        .values(events.map((event, index) => ({
          runId: run.runId,
          eventIndex: index,
          eventType: event.eventType,
          stepId: event.stepId,
          level: event.level,
          message: event.message,
          timestamp: event.timestamp,
          dataJson: event.data === undefined ? null : stringifyRedacted(event.data),
        })))
        .execute();
    });
  }
}

export function buildPersistedEvents(run: WorkflowRunRecord, eventCap = DEFAULT_WORKFLOW_EVENT_CAP): PersistedWorkflowEvent[] {
  const cap = Math.max(2, Math.floor(eventCap));
  const startEvent: PersistedWorkflowEvent = {
    eventType: 'run_started',
    stepId: null,
    level: 'info',
    message: `Workflow ${run.workflowId} started`,
    timestamp: run.startedAt,
    data: { workflowId: run.workflowId, trigger: run.trigger, status: 'running' },
  };
  const completeEvent: PersistedWorkflowEvent | null = run.completedAt === undefined ? null : {
    eventType: 'run_completed',
    stepId: null,
    level: run.status === 'failed' ? 'error' : 'info',
    message: `Workflow ${run.workflowId} ${run.status}`,
    timestamp: run.completedAt,
    data: {
      workflowId: run.workflowId,
      trigger: run.trigger,
      status: run.status,
      durationMs: run.durationMs,
      error: run.error,
    },
  };
  const stepEvents = run.logs.map(logToPersistedEvent);
  const lifecycleCount = 1 + (completeEvent ? 1 : 0);

  if (stepEvents.length + lifecycleCount <= cap) {
    return completeEvent ? [startEvent, ...stepEvents, completeEvent] : [startEvent, ...stepEvents];
  }

  const reserved = lifecycleCount + 1;
  const keptStepCount = Math.max(0, cap - reserved);
  const omitted = stepEvents.length - keptStepCount;
  const lastTimestamp = stepEvents[Math.max(0, keptStepCount - 1)]?.timestamp ?? startEvent.timestamp;
  const truncationEvent: PersistedWorkflowEvent = {
    eventType: 'truncated',
    stepId: null,
    level: 'warn',
    message: `Workflow log cap reached; omitted ${omitted} event${omitted === 1 ? '' : 's'}`,
    timestamp: completeEvent?.timestamp ?? lastTimestamp,
    data: { eventCap: cap, omittedEvents: omitted },
  };

  return completeEvent
    ? [startEvent, ...stepEvents.slice(0, keptStepCount), truncationEvent, completeEvent]
    : [startEvent, ...stepEvents.slice(0, Math.max(0, cap - 2)), truncationEvent];
}

export function redactSecrets(value: unknown): unknown {
  return redactValue(value, undefined, new WeakSet(), 0);
}

export function stringifyRedacted(value: unknown): string {
  return JSON.stringify(redactSecrets(value));
}

export function extractWorkflowRunReferences(output: unknown): WorkflowRunReferences {
  const record = asRecord(output);
  return {
    vkWorkspaceId: getString(record, 'workspaceId') ?? getString(record, 'vkWorkspaceId'),
    vkSessionId: getString(record, 'sessionId') ?? getString(record, 'vkSessionId'),
    vkQueueItemId: getString(record, 'queueItemId') ?? getString(record, 'vkQueueItemId'),
    vkExecutionProcessId: getString(record, 'executionProcessId') ?? getString(record, 'vkExecutionProcessId'),
  };
}

function logToPersistedEvent(log: WorkflowLogEntry): PersistedWorkflowEvent {
  return {
    eventType: 'step_log',
    stepId: log.stepId,
    level: log.level,
    message: log.message,
    timestamp: log.timestamp,
    data: log.data,
  };
}

function redactValue(value: unknown, key: string | undefined, seen: WeakSet<object>, depth: number): unknown {
  if (key && REDACT_KEY_PATTERN.test(key)) return REDACTED;
  if (typeof value === 'string') return redactSecretString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  if (depth > 20) return '[MaxDepth]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, undefined, seen, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    output[childKey] = redactValue(childValue, childKey, seen, depth + 1);
  }
  return output;
}

function redactSecretString(value: string): string {
  if (/^(bearer|basic)\s+/i.test(value)) return REDACTED;
  if (/^sha256=[a-f0-9]{16,}$/i.test(value)) return REDACTED;
  if (/^(ghp|github_pat|glpat|sk|xox[baprs])-/.test(value)) return REDACTED;
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function getString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
