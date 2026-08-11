import { describe, expect, it, vi } from 'vitest';

import {
  copyNormalizedSubmittedResultJson,
  normalizedSubmittedResultJson,
} from './beadsFormSubmitSuccess';

describe('BeadsForm submit success helpers', () => {
  it('formats the normalized submitted response JSON used for clipboard and manual copy', () => {
    expect(normalizedSubmittedResultJson({ decision: { approve: true }, notes: 'Ship it' })).toBe(JSON.stringify({
      decision: { approve: true },
      notes: 'Ship it',
    }, null, 2));
  });

  it('copies normalized submitted response JSON after successful persistence', async () => {
    const writeText = vi.fn<Clipboard['writeText']>(async () => undefined);

    const result = await copyNormalizedSubmittedResultJson({ writeText }, { answer: 'saved' });

    expect(result).toEqual({
      copied: true,
      text: '{\n  "answer": "saved"\n}',
    });
    expect(writeText).toHaveBeenCalledWith('{\n  "answer": "saved"\n}');
  });

  it('returns manual-copy fallback details when clipboard copy fails', async () => {
    const writeText = vi.fn<Clipboard['writeText']>(async () => {
      throw new Error('denied');
    });

    const result = await copyNormalizedSubmittedResultJson({ writeText }, { answer: 'saved' });

    expect(result.copied).toBe(false);
    expect(result.text).toBe('{\n  "answer": "saved"\n}');
    expect(result.warning).toContain('Clipboard copy failed: denied');
  });
});
