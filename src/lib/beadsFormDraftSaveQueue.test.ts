import { describe, expect, it, vi } from 'vitest';
import { BeadsFormDraftSaveQueue } from './beadsFormDraftSaveQueue';

describe('BeadsFormDraftSaveQueue', () => {
  it('serializes and coalesces rapid draft saves using the updated server revision', async () => {
    vi.useFakeTimers();
    const saved: Array<{ value: string; baseUpdatedAt?: string }> = [];
    let firstResolve!: (value: { draft: { updatedAt: string } }) => void;
    const firstSaved = new Promise<{ draft: { updatedAt: string } }>((resolve) => {
      firstResolve = resolve;
    });
    const save = vi.fn(async (payload: { values: Record<string, unknown> }, baseUpdatedAt: string | undefined) => {
      saved.push({ value: String(payload.values.comment), baseUpdatedAt });
      if (payload.values.comment === 'first') return firstSaved;
      return { draft: { updatedAt: 'server-2' } };
    });
    const queue = new BeadsFormDraftSaveQueue({
      debounceMs: 1,
      initialBaseUpdatedAt: 'server-0',
      save,
    });

    queue.schedule({ values: { comment: 'first' } });
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);

    queue.schedule({ values: { comment: 'second' } });
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);

    firstResolve({ draft: { updatedAt: 'server-1' } });
    await vi.runAllTicks();
    for (let index = 0; index < 5; index += 1) await Promise.resolve();

    expect(save).toHaveBeenCalledTimes(2);
    expect(saved).toEqual([
      { value: 'first', baseUpdatedAt: 'server-0' },
      { value: 'second', baseUpdatedAt: 'server-1' },
    ]);
    vi.useRealTimers();
  });

  it('cancels pending debounced saves at submit start so stale drafts are not recreated', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => ({ draft: { updatedAt: 'server-1' } }));
    const queue = new BeadsFormDraftSaveQueue({
      debounceMs: 10,
      save,
    });

    queue.schedule({ values: { comment: 'stale draft' } });
    queue.cancel();
    await vi.advanceTimersByTimeAsync(10);

    expect(save).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
