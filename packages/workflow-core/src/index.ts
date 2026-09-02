export type WorkflowRunStatus = 'running' | 'completed' | 'failed';
export type WorkflowLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface WorkflowLogEntry {
  stepId: string;
  level: WorkflowLogLevel;
  message: string;
  timestamp: number;
  data?: unknown;
}

export interface NormalizedWorkflowError {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
}

export interface WorkflowRunRecord<TInput = unknown, TOutput = unknown> {
  runId: string;
  workflowId: string;
  trigger: string;
  status: WorkflowRunStatus;
  input: TInput;
  output?: TOutput;
  error?: NormalizedWorkflowError;
  logs: WorkflowLogEntry[];
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
}

export interface WorkflowContext {
  readonly runId: string;
  readonly workflowId: string;
  readonly trigger: string;
  log: (
    stepId: string,
    message: string,
    level?: WorkflowLogLevel,
    data?: unknown,
  ) => void;
}

export interface WorkflowDefinition<TInput = unknown, TOutput = unknown> {
  id: string;
  trigger: string;
  run: (ctx: WorkflowContext, input: TInput) => Promise<TOutput> | TOutput;
}

export interface WorkflowRegistry {
  register: <TInput, TOutput>(
    workflow: WorkflowDefinition<TInput, TOutput>,
  ) => void;
  get: <TInput = unknown, TOutput = unknown>(
    workflowId: string,
  ) => WorkflowDefinition<TInput, TOutput> | undefined;
  list: () => WorkflowDefinition[];
}

export interface WorkflowRecorder {
  onRunStarted?: (run: WorkflowRunRecord) => Promise<void> | void;
  onRunCompleted?: (run: WorkflowRunRecord) => Promise<void> | void;
}

export interface RunWorkflowOptions {
  now?: () => number;
  createRunId?: () => string;
  recorder?: WorkflowRecorder;
}

export class WorkflowNotFoundError extends Error {
  constructor(readonly workflowId: string) {
    super(`Workflow not found: ${workflowId}`);
    this.name = 'WorkflowNotFoundError';
  }
}

export class DuplicateWorkflowError extends Error {
  constructor(readonly workflowId: string) {
    super(`Workflow is already registered: ${workflowId}`);
    this.name = 'DuplicateWorkflowError';
  }
}

export function createWorkflowRegistry(): WorkflowRegistry {
  const workflows = new Map<string, WorkflowDefinition>();

  return {
    register: <TInput, TOutput>(
      workflow: WorkflowDefinition<TInput, TOutput>,
    ) => {
      if (workflows.has(workflow.id)) {
        throw new DuplicateWorkflowError(workflow.id);
      }
      workflows.set(workflow.id, workflow as WorkflowDefinition);
    },
    get: <TInput = unknown, TOutput = unknown>(workflowId: string) => {
      return workflows.get(workflowId) as
        | WorkflowDefinition<TInput, TOutput>
        | undefined;
    },
    list: () => [...workflows.values()],
  };
}

export async function runWorkflow<TInput, TOutput>(
  registry: WorkflowRegistry,
  workflowId: string,
  input: TInput,
  options: RunWorkflowOptions = {},
): Promise<WorkflowRunRecord<TInput, TOutput>> {
  const workflow = registry.get<TInput, TOutput>(workflowId);
  if (!workflow) {
    throw new WorkflowNotFoundError(workflowId);
  }

  const now = options.now ?? Date.now;
  const runId = options.createRunId?.() ?? createDefaultRunId();
  const logs: WorkflowLogEntry[] = [];
  const startedAt = now();
  const runBase: WorkflowRunRecord<TInput, TOutput> = {
    runId,
    workflowId: workflow.id,
    trigger: workflow.trigger,
    status: 'running',
    input,
    logs,
    startedAt,
  };

  await options.recorder?.onRunStarted?.(runBase);

  const ctx: WorkflowContext = {
    runId,
    workflowId: workflow.id,
    trigger: workflow.trigger,
    log: (stepId, message, level = 'info', data) => {
      const entry: WorkflowLogEntry = {
        stepId,
        level,
        message,
        timestamp: now(),
      };
      if (data !== undefined) {
        entry.data = data;
      }
      logs.push(entry);
    },
  };

  try {
    const output = await workflow.run(ctx, input);
    const completedAt = now();
    const completedRun: WorkflowRunRecord<TInput, TOutput> = {
      ...runBase,
      status: 'completed',
      output,
      completedAt,
      durationMs: completedAt - startedAt,
    };
    await options.recorder?.onRunCompleted?.(completedRun);
    return completedRun;
  } catch (error) {
    const completedAt = now();
    const failedRun: WorkflowRunRecord<TInput, TOutput> = {
      ...runBase,
      status: 'failed',
      error: normalizeWorkflowError(error),
      completedAt,
      durationMs: completedAt - startedAt,
    };
    await options.recorder?.onRunCompleted?.(failedRun);
    return failedRun;
  }
}

export function normalizeWorkflowError(error: unknown): NormalizedWorkflowError {
  if (error instanceof Error) {
    const normalized: NormalizedWorkflowError = {
      name: error.name || 'Error',
      message: error.message,
    };
    if (error.stack) {
      normalized.stack = error.stack;
    }
    if ('cause' in error && error.cause !== undefined) {
      normalized.cause = error.cause;
    }
    return normalized;
  }

  return {
    name: 'NonErrorThrown',
    message: typeof error === 'string' ? error : JSON.stringify(error),
  };
}

function createDefaultRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}
export * from './agent-workflow/index';
