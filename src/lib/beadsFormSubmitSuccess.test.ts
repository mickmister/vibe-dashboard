import { describe, expect, it, vi } from 'vitest';

import {
  copyNormalizedSubmittedResultJson,
  normalizedSubmittedResultJson,
  pendingNormalizedSubmittedResultCopy,
} from './beadsFormSubmitSuccess';

describe('BeadsForm submit success helpers', () => {
  it('formats the normalized submitted response JSON used for clipboard and manual copy', () => {
    expect(normalizedSubmittedResultJson({ decision: { approve: true }, notes: 'Ship it' })).toBe(JSON.stringify({
      decision: { approve: true },
      notes: 'Ship it',
    }, null, 2));
  });

  it('copies plain normalized booleans without choice provenance metadata', () => {
    const text = normalizedSubmittedResultJson({
      priority: { storage: true, visual_polish: false },
    });

    expect(text).toBe('{\n  "priority": {\n    "storage": true,\n    "visual_polish": false\n  }\n}');
    expect(text).not.toContain('__beadsform_provenance');
    expect(text).not.toContain('"source"');
  });

  it('copies normalized submitted response JSON after successful persistence', async () => {
    const writeText = vi.fn<Clipboard['writeText']>(async () => undefined);

    const result = await copyNormalizedSubmittedResultJson({ writeText }, { answer: 'saved' });

    expect(result).toEqual({
      status: 'copied',
      text: '{\n  "answer": "saved"\n}',
    });
    expect(writeText).toHaveBeenCalledWith('{\n  "answer": "saved"\n}');
  });

  it('returns manual-copy fallback details when clipboard copy fails', async () => {
    const writeText = vi.fn<Clipboard['writeText']>(async () => {
      throw new Error('denied');
    });

    const result = await copyNormalizedSubmittedResultJson({ writeText }, { answer: 'saved' });

    expect(result.status).toBe('failed');
    expect(result.text).toBe('{\n  "answer": "saved"\n}');
    expect(result.warning).toContain('Clipboard copy failed: denied');
  });

  it('represents pending clipboard copy without a false failure warning', () => {
    expect(pendingNormalizedSubmittedResultCopy({ answer: 'saved' })).toEqual({
      status: 'pending',
      text: '{\n  "answer": "saved"\n}',
    });
  });
});
