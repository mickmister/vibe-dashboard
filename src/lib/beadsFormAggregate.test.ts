import { describe, expect, it } from 'vitest';
import { buildAggregateBeadsFormUrl, parseAggregateBeadsFormRefs } from './beadsFormAggregate';

describe('BeadsForm aggregate URL helpers', () => {
  it('parses repeated direct refs in stable order', () => {
    const params = new URLSearchParams();
    params.append('dir', '/repos/a');
    params.append('bead', 'a-1');
    params.append('form', 'review');
    params.append('dir', '/repos/b');
    params.append('bead', 'b-2');
    params.append('form', 'followup');

    expect(parseAggregateBeadsFormRefs(params)).toEqual([
      { dir: '/repos/a', beadId: 'a-1', formId: 'review' },
      { dir: '/repos/b', beadId: 'b-2', formId: 'followup' },
    ]);
  });

  it('rejects malformed aggregate refs instead of guessing alignment', () => {
    expect(() => parseAggregateBeadsFormRefs(new URLSearchParams('dir=/repos/a&bead=a-1'))).toThrow(
      'matching repeated dir, bead, and form parameters',
    );
    expect(() => parseAggregateBeadsFormRefs(new URLSearchParams('dir=&bead=a-1&form=review'))).toThrow(
      'missing dir',
    );
    expect(() => parseAggregateBeadsFormRefs(new URLSearchParams('dir=/repos/a&bead=&form=review'))).toThrow(
      'missing bead',
    );
    expect(() => parseAggregateBeadsFormRefs(new URLSearchParams('dir=/repos/a&bead=a-1&form='))).toThrow(
      'missing form',
    );
    expect(() => parseAggregateBeadsFormRefs(new URLSearchParams(
      'dir=/repos/a&bead=a-1&form=review&dir=/repos/a&bead=a-1&form=review',
    ))).toThrow('Duplicate aggregate BeadsForm ref');
  });

  it('builds aggregate URLs with repeated direct refs', () => {
    expect(buildAggregateBeadsFormUrl([
      { dir: '/repos/a', beadId: 'a-1', formId: 'review' },
      { dir: '/repos/b', beadId: 'b-2', formId: 'followup' },
    ])).toBe('/dashboard/forms/aggregate?dir=%2Frepos%2Fa&bead=a-1&form=review&dir=%2Frepos%2Fb&bead=b-2&form=followup');
  });
});
