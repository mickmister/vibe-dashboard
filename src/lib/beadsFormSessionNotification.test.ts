import { describe, expect, it } from 'vitest';
import { buildBeadsFormSessionNotification, isValidBeadsFormSessionId } from './beadsFormSessionNotification';

describe('BeadsForm creating-session notifications', () => {
  it('accepts UUID session ids and rejects unsafe or malformed metadata', () => {
    expect(isValidBeadsFormSessionId('2e56418d-2829-4e2f-aab7-105c5aab41dc')).toBe(true);
    expect(isValidBeadsFormSessionId('session-1')).toBe(false);
    expect(isValidBeadsFormSessionId('2e56418d-2829-4e2f-aab7-105c5aab41dc; rm -rf /')).toBe(false);
    expect(isValidBeadsFormSessionId('')).toBe(false);
  });

  it('builds a bounded handoff with lean DSL, structured values, XML, and catch-up guidance', () => {
    const message = buildBeadsFormSessionNotification({
      beadId: 'beads-web-rwu',
      form: {
        format: 'standard',
        id: 'review',
        goal: 'Review the plan.',
        title: 'Review',
        questions: [{
          type: 'textarea',
          id: 'comment',
          title: 'Comment',
          description: 'Share feedback.',
        }],
        html: '<form>generated</form>',
        controls: [{ id: 'comment', name: 'comment', type: 'textarea' }],
        responses: [{ submittedBy: 'old', submittedAt: '2026-01-01T00:00:00Z', values: { comment: 'old' } }],
      } as never,
      values: { comment: '# Approved', allow_code_file_changes: false },
      submittedAt: '2026-09-15T00:00:00.000Z',
      submittedBy: 'human',
    });

    expect(message).toContain('beads-web-rwu');
    expect(message).toContain('"questions"');
    expect(message).toContain('"comment": "# Approved"');
    expect(message).toContain('<beadsFormSubmission>');
    expect(message).toContain('vibe-agent full_summary');
    expect(message).not.toContain('generated');
    expect(message).not.toContain('"controls"');
    expect(message).not.toContain('"responses"');
  });

  it('rejects an oversized handoff before calling a messaging transport', () => {
    expect(() => buildBeadsFormSessionNotification({
      beadId: 'beads-web-rwu',
      form: {
        format: 'standard',
        id: 'review',
        goal: 'Review the plan.',
        title: 'Review',
        questions: [{ type: 'textarea', id: 'comment', title: 'Comment' }],
      } as never,
      values: { comment: 'large response' },
      submittedAt: '2026-09-15T00:00:00.000Z',
      submittedBy: 'human',
      maxBytes: 32,
    })).toThrow('notification exceeds the 32-byte safety limit');
  });
});
