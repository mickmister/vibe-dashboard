import type { DeclarativeWorkflowRuntime, DeclarativeWorkflowRunOnceResult } from './runtime';

export interface DeclarativeWorkflowWorkerOptions {
  runtime: Pick<DeclarativeWorkflowRuntime, 'runReady'>;
  intervalMs?: number;
  autoStart?: boolean;
  logger?: Pick<Console, 'warn' | 'info'>;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export interface DeclarativeWorkflowWorker {
  triggerOnce(): Promise<DeclarativeWorkflowRunOnceResult | null>;
  stop(): void;
  isRunning(): boolean;
}

const DEFAULT_DECLARATIVE_WORKFLOW_WORKER_INTERVAL_MS = 5_000;

export function createDeclarativeWorkflowWorker(options: DeclarativeWorkflowWorkerOptions): DeclarativeWorkflowWorker {
  const intervalMs = normalizeIntervalMs(options.intervalMs);
  const logger = options.logger ?? console;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  let inFlight = false;
  let stopped = false;
  let interval: ReturnType<typeof setInterval> | null = null;

  const triggerOnce = async (): Promise<DeclarativeWorkflowRunOnceResult | null> => {
    if (stopped || inFlight) return null;
    inFlight = true;
    try {
      return await options.runtime.runReady();
    } catch (error) {
      logger.warn('Declarative workflow worker tick failed', { error });
      return null;
    } finally {
      inFlight = false;
    }
  };

  if (options.autoStart ?? true) {
    interval = setIntervalFn(() => {
      void triggerOnce();
    }, intervalMs);
    if (typeof interval === 'object' && interval && 'unref' in interval && typeof interval.unref === 'function') {
      interval.unref();
    }
  }

  return {
    triggerOnce,
    stop() {
      stopped = true;
      if (interval) {
        clearIntervalFn(interval);
        interval = null;
      }
    },
    isRunning() {
      return inFlight;
    },
  };
}

export function shouldStartDeclarativeWorkflowWorker(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VD_DECLARATIVE_WORKFLOW_WORKER_DISABLED === '1' || env.VD_DECLARATIVE_WORKFLOW_WORKER_DISABLED === 'true') return false;
  if (env.VITEST || env.NODE_ENV === 'test') return env.VD_DECLARATIVE_WORKFLOW_WORKER_ENABLED === '1' || env.VD_DECLARATIVE_WORKFLOW_WORKER_ENABLED === 'true';
  return true;
}

export function getDeclarativeWorkflowWorkerIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.VD_DECLARATIVE_WORKFLOW_WORKER_INTERVAL_MS;
  return normalizeIntervalMs(raw ? Number(raw) : DEFAULT_DECLARATIVE_WORKFLOW_WORKER_INTERVAL_MS);
}

function normalizeIntervalMs(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 250 ? Math.floor(parsed) : DEFAULT_DECLARATIVE_WORKFLOW_WORKER_INTERVAL_MS;
}
