import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendBeadsFormResponse,
  clearBeadsFormDraftInMetadata,
  draftFormProgressInMetadata,
  getBeadsFormDraft,
  type JsonObject,
} from './beadsFormCore';
import { BeadsFormDraftSaveQueue } from './beadsFormDraftSaveQueue';

describe('BeadsFormDraftSaveQueue', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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
  });

  it('leaves submitted metadata without a matching draft when submit cancels a pending timer', async () => {
    vi.useFakeTimers();
    const scopeKey = 'workspace:ws:dir:/repo:bead:beads-web-q4ep:form:review';
    let metadata: JsonObject = {
      beadForms: {
        forms: [{
          format: 'standard',
          id: 'review',
          goal: 'Answer the form.',
          title: 'Review',
          questions: [{ type: 'textarea', id: 'comment', title: 'Comment', description: 'Comment.' }],
        }],
      },
    };
    const save = vi.fn(async (payload: { values: JsonObject }) => {
      metadata = draftFormProgressInMetadata(metadata, scopeKey, {
        values: payload.values,
        updatedAt: 'draft-after-submit',
      });
      return { draft: { updatedAt: 'draft-after-submit' } };
    });
    const queue = new BeadsFormDraftSaveQueue({ debounceMs: 10, save });

    queue.schedule({ values: { comment: 'stale draft' } });
    queue.cancel();
    metadata = clearBeadsFormDraftInMetadata(appendBeadsFormResponse(metadata, 'review', {
      submissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      submittedAt: '2026-09-25T00:00:00.000Z',
      submittedBy: 'user',
      values: { comment: 'submitted' },
    }), scopeKey);
    await vi.advanceTimersByTimeAsync(10);

    expect(save).not.toHaveBeenCalled();
    expect(getBeadsFormDraft(metadata, scopeKey)).toBeUndefined();
  });

  it('does not let a canceled in-flight save block later edit-mode draft saves', async () => {
    vi.useFakeTimers();
    let firstResolve!: (value: { draft: { updatedAt: string } }) => void;
    const firstSaved = new Promise<{ draft: { updatedAt: string } }>((resolve) => {
      firstResolve = resolve;
    });
    const save = vi.fn(async (payload: { values: Record<string, unknown> }) => {
      if (payload.values.comment === 'before submit') return firstSaved;
      return { draft: { updatedAt: 'after-edit' } };
    });
    const queue = new BeadsFormDraftSaveQueue({ debounceMs: 1, save });

    queue.schedule({ values: { comment: 'before submit' } });
    await vi.advanceTimersByTimeAsync(1);
    queue.cancel();
    queue.schedule({ values: { comment: 'after edit' } });
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);

    firstResolve({ draft: { updatedAt: 'ignored' } });
    await vi.runAllTicks();
    for (let index = 0; index < 5; index += 1) await Promise.resolve();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0].values).toEqual({ comment: 'after edit' });
  });
});
