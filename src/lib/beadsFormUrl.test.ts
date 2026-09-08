import { describe, expect, it } from 'vitest';
import { normalizeBeadsFormQueryId } from './beadsFormUrl';

describe('normalizeBeadsFormQueryId', () => {
  it('normalizes Markdown-escaped underscores in copied form query params', () => {
    expect(normalizeBeadsFormQueryId('signoz\\_aws\\_replay\\_review\\_questions')).toBe(
      'signoz_aws_replay_review_questions',
    );
  });

  it('preserves normal form ids', () => {
    expect(normalizeBeadsFormQueryId('review-form_1')).toBe('review-form_1');
  });

  it('returns undefined for missing or empty values', () => {
    expect(normalizeBeadsFormQueryId(null)).toBeUndefined();
    expect(normalizeBeadsFormQueryId(undefined)).toBeUndefined();
    expect(normalizeBeadsFormQueryId('')).toBeUndefined();
  });
});
