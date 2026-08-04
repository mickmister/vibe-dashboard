import { describe, expect, it, vi } from 'vitest';
import { TWO_AGENT_REVIEW_ROUND_DEFINITION } from './builtins';
import { createDeclarativeWorkflowWorker, getDeclarativeWorkflowWorkerIntervalMs, shouldStartDeclarativeWorkflowWorker } from './worker';

describe('declarative workflow worker', () => {
  it('runs a tick through runtime.runOnce and suppresses overlapping ticks', async () => {
    let release!: (value: unknown) => void;
    const first = new Promise((resolve) => { release = resolve; });
    const runtime = {
      runOnce: vi.fn(async () => {
        await first;
        return { resumed: [], completed: [], skipped: [], errors: [] };
      }),
    };
    const worker = createDeclarativeWorkflowWorker({ runtime, definition: TWO_AGENT_REVIEW_ROUND_DEFINITION, autoStart: false });

    const pending = worker.triggerOnce();
    await Promise.resolve();
    expect(worker.isRunning()).toBe(true);
    await expect(worker.triggerOnce()).resolves.toBeNull();
    expect(runtime.runOnce).toHaveBeenCalledTimes(1);

    release(null);
    await expect(pending).resolves.toEqual({ resumed: [], completed: [], skipped: [], errors: [] });
    expect(worker.isRunning()).toBe(false);
  });

  it('stops future manual and interval ticks', async () => {
    const intervalIds: Array<() => void> = [];
    const runtime = { runOnce: vi.fn(async () => ({ resumed: [], completed: [], skipped: [], errors: [] })) };
    const clearIntervalFn = vi.fn();
    const worker = createDeclarativeWorkflowWorker({
      runtime,
      definition: TWO_AGENT_REVIEW_ROUND_DEFINITION,
      intervalMs: 250,
      setIntervalFn: ((callback: () => void) => {
        intervalIds.push(callback);
        return 123 as never;
      }) as never,
      clearIntervalFn: clearIntervalFn as never,
    });

    expect(intervalIds).toHaveLength(1);
    worker.stop();
    expect(clearIntervalFn).toHaveBeenCalledWith(123);
    await expect(worker.triggerOnce()).resolves.toBeNull();
    intervalIds[0]?.();
    await Promise.resolve();
    expect(runtime.runOnce).not.toHaveBeenCalled();
  });

  it('keeps test environments disabled unless explicitly enabled', () => {
    expect(shouldStartDeclarativeWorkflowWorker({ NODE_ENV: 'test' })).toBe(false);
    expect(shouldStartDeclarativeWorkflowWorker({ VITEST: 'true' })).toBe(false);
    expect(shouldStartDeclarativeWorkflowWorker({ NODE_ENV: 'test', VD_DECLARATIVE_WORKFLOW_WORKER_ENABLED: '1' })).toBe(true);
    expect(shouldStartDeclarativeWorkflowWorker({ VD_DECLARATIVE_WORKFLOW_WORKER_DISABLED: '1' })).toBe(false);
  });

  it('normalizes worker interval config', () => {
    expect(getDeclarativeWorkflowWorkerIntervalMs({ VD_DECLARATIVE_WORKFLOW_WORKER_INTERVAL_MS: '1000' })).toBe(1000);
    expect(getDeclarativeWorkflowWorkerIntervalMs({ VD_DECLARATIVE_WORKFLOW_WORKER_INTERVAL_MS: '10' })).toBe(5000);
    expect(getDeclarativeWorkflowWorkerIntervalMs({ VD_DECLARATIVE_WORKFLOW_WORKER_INTERVAL_MS: 'nope' })).toBe(5000);
  });
});
