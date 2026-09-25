import { describe, expect, it } from 'vitest';
import {
  aggregateFormDomPrefix,
  buildAggregateBeadsFormUrl,
  namespaceAggregateFormHtml,
  parseAggregateBeadsFormRefs,
} from './beadsFormAggregate';

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
      'repeated dir, bead, form parameter triplets',
    );
    expect(() => parseAggregateBeadsFormRefs(new URLSearchParams(
      'dir=/repos/a&bead=a-1&dir=/repos/b&bead=b-2&form=review&form=followup',
    ))).toThrow('parameters ordered as dir, bead, form triplets');
    expect(() => parseAggregateBeadsFormRefs(new URLSearchParams(
      'bead=a-1&dir=/repos/a&form=review',
    ))).toThrow('parameters ordered as dir, bead, form triplets');
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

  it('scopes aggregate form DOM ids and matching label/aria references without changing names', () => {
    const prefix = aggregateFormDomPrefix({ dir: '/repos/a', beadId: 'a-1', formId: 'review' });
    const html = namespaceAggregateFormHtml(`
      <form aria-labelledby="title decision_label external_id">
        <h2 id="title">Title</h2>
        <label id="decision_label" for="decision">Decision</label>
        <p id="decision_help">Help</p>
        <input id="decision" name="decision" aria-describedby="decision_help missing_id">
        <button id="toggle" aria-controls="decision_more_info">More</button>
        <textarea id="decision_more_info" name="decision_more_info"></textarea>
        <a href="#decision_more_info">Jump</a>
      </form>
    `, prefix);

    expect(html).toContain(`id="${prefix}__decision"`);
    expect(html).toContain('name="decision"');
    expect(html).toContain(`for="${prefix}__decision"`);
    expect(html).toContain(`aria-describedby="${prefix}__decision_help missing_id"`);
    expect(html).toContain(`aria-labelledby="${prefix}__title ${prefix}__decision_label external_id"`);
    expect(html).toContain(`aria-controls="${prefix}__decision_more_info"`);
    expect(html).toContain(`href="#${prefix}__decision_more_info"`);
  });
});
