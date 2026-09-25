import { describe, expect, it, vi } from 'vitest';

import {
  copySubmittedResultHandoffXml,
  submittedBatchResultHandoffXml,
  normalizedSubmittedResultJson,
  pendingSubmittedResultHandoffCopy,
  submittedResultHandoffXml,
} from './beadsFormSubmitSuccess';

describe('BeadsForm submit success helpers', () => {
  it('keeps the normalized submitted response JSON available as a secondary/internal format', () => {
    expect(normalizedSubmittedResultJson({ decision: { approve: true }, notes: 'Ship it' })).toBe(JSON.stringify({
      decision: { approve: true },
      notes: 'Ship it',
    }, null, 2));
  });

  it('formats markdown-friendly XML with metadata, choice booleans, notes, and additional notes', () => {
    const text = submittedResultHandoffXml({
      decision: { approve: true, defer: false },
      plan: '# Heading\n\n- item\n\n```ts\nconst value = a < b && b > c;\n```\n\n[link](https://example.test)',
      decision_approve_more_info: 'Ship because A & B are ready.',
      decision_more_info: 'Question-level note with a ]]> sequence.',
      additional_notes: 'Use <safe> escaping & preserve text.',
      next_instruction: '## Next\n\nImplement the follow-up with `<safe>` XML & report back.',
    }, {
      beadId: 'beads-web-9iu',
      formId: 'markdown_handoff',
      submittedAt: '2026-08-24T00:00:00.000Z',
      submittedBy: 'human & agent',
    });

    expect(text).toContain('<beadsFormSubmission>');
    expect(text).toContain('<beadId>beads-web-9iu</beadId>');
    expect(text).toContain('<formId>markdown_handoff</formId>');
    expect(text).toContain('<submittedAt>2026-08-24T00:00:00.000Z</submittedAt>');
    expect(text).toContain('<submittedBy>human &amp; agent</submittedBy>');
    expect(text).toContain('<choiceGroup id="decision">');
    expect(text).toContain('<choice id="approve" selected="true" />');
    expect(text).toContain('<choice id="defer" selected="false" />');
    expect(text).toContain('<answer id="plan" type="markdown">\n\n# Heading');
    expect(text).toContain('```ts\nconst value = a &lt; b &amp;&amp; b &gt; c;\n```');
    expect(text).toContain('<note id="decision_approve_more_info" type="markdown">\n\nShip because A &amp; B are ready.\n\n    </note>');
    expect(text).toContain('<note id="decision_more_info" type="markdown">\n\nQuestion-level note with a ]]&gt; sequence.\n\n    </note>');
    expect(text).toContain('<additionalNotes id="additional_notes" type="markdown">\n\nUse &lt;safe&gt; escaping &amp; preserve text.\n\n    </additionalNotes>');
    expect(text).toContain('<nextInstruction id="next_instruction" type="markdown">\n\n## Next\n\nImplement the follow-up with `&lt;safe&gt;` XML &amp; report back.\n\n    </nextInstruction>');
    expect(text).not.toContain('type="markdown">Ship because');
  });

  it('copies XML with plain normalized booleans and no choice provenance metadata', () => {
    const text = submittedResultHandoffXml({
      priority: { assumed_baseline: false, storage: true, visual_polish: false },
    });

    expect(text).toContain('<choiceGroup id="priority">');
    expect(text).toContain('<choice id="assumed_baseline" selected="false" />');
    expect(text).toContain('<choice id="storage" selected="true" />');
    expect(text).toContain('<choice id="visual_polish" selected="false" />');
    expect(text).not.toContain('__beadsform_provenance');
    expect(text).not.toContain('source=');
    expect(text).not.toContain('assumedTrue');
  });

  it('formats combined batch XML with source form identifiers and one batch next instruction', () => {
    const text = submittedBatchResultHandoffXml({
      batchId: 'batch-1',
      nextInstruction: '## Next\n\nCarry out the combined handoff once.',
      forms: [{
        dir: '/repo-a',
        beadId: 'beads-web-a',
        formId: 'form_a',
        title: 'Form A',
        submittedAt: '2026-09-25T00:00:00.000Z',
        submittedBy: 'human',
        values: { answer: 'Use <safe> XML & Markdown.' },
      }, {
        dir: '/repo-b',
        beadId: 'beads-web-b',
        formId: 'form_b',
        values: { choices: { yes: true, no: false } },
      }],
    });

    expect(text).toContain('<beadsFormBatchSubmission>');
    expect(text).toContain('<batchId>batch-1</batchId>');
    expect(text).toContain('<formCount>2</formCount>');
    expect(text).toContain('<nextInstruction scope="batch" type="markdown">\n\n## Next');
    expect(text).toContain('<form beadId="beads-web-a" formId="form_a" dir="/repo-a">');
    expect(text).toContain('<title>Form A</title>');
    expect(text).toContain('Use &lt;safe&gt; XML &amp; Markdown.');
    expect(text).toContain('<choiceGroup id="choices">');
    expect(text.match(/<nextInstruction/g)).toHaveLength(1);
  });

  it('copies BeadsForm XML handoff after successful persistence', async () => {
    const writeText = vi.fn<Clipboard['writeText']>(async () => undefined);

    const result = await copySubmittedResultHandoffXml({ writeText }, { answer: 'saved' }, { formId: 'form-1' });

    expect(result.status).toBe('copied');
    expect(result.text).toContain('<formId>form-1</formId>');
    expect(result.text).toContain('<answer id="answer" type="markdown">\n\nsaved\n\n    </answer>');
    expect(writeText).toHaveBeenCalledWith(result.text);
  });

  it('returns manual-copy fallback details when clipboard copy fails', async () => {
    const writeText = vi.fn<Clipboard['writeText']>(async () => {
      throw new Error('denied');
    });

    const result = await copySubmittedResultHandoffXml({ writeText }, { answer: 'saved' });

    expect(result.status).toBe('failed');
    expect(result.text).toContain('<answer id="answer" type="markdown">\n\nsaved\n\n    </answer>');
    expect(result.warning).toContain('Clipboard copy failed: denied');
    expect(result.warning).toContain('manual XML handoff field');
  });

  it('represents pending clipboard copy without a false failure warning', () => {
    expect(pendingSubmittedResultHandoffCopy({ answer: 'saved' })).toEqual({
      status: 'pending',
      text: '<beadsFormSubmission>\n  <answers>\n    <answer id="answer" type="markdown">\n\nsaved\n\n    </answer>\n  </answers>\n</beadsFormSubmission>',
    });
  });
});
