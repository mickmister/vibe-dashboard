// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  appendBeadsFormResponse,
  buildAgentResultMessage,
  buildPrettySummary,
  getBeadsForms,
  normalizeFormEntries,
  sanitizeBeadsFormHtml,
  validateSubmittedValues,
} from './beadsFormCore';

describe('BeadsForm core', () => {
  it('reads current forms before legacy forms and de-duplicates by id', () => {
    const forms = getBeadsForms({
      beadForms: { forms: [{ id: 'current', title: 'Current', html: '<form></form>' }] },
      beadsWeb: { forms: [
        { id: 'current', title: 'Legacy duplicate', html: '<form></form>' },
        { id: 'legacy', title: 'Legacy', html: '<form></form>' },
      ] },
    });

    expect(forms.map((form) => form.id)).toEqual(['current', 'legacy']);
  });

  it('appends responses under metadata.beadForms while preserving unrelated metadata', () => {
    const next = appendBeadsFormResponse({ untouched: true, beadForms: { forms: [
      { id: 'review', title: 'Review', html: '<form></form>' },
    ] } }, 'review', {
      submittedBy: 'user',
      submittedAt: '2026-06-29T00:00:00Z',
      values: { approved: 'yes' },
    });

    expect(next.untouched).toBe(true);
    expect((next.beadForms as any).forms[0].responses).toHaveLength(1);
  });

  it('normalizes repeated form entries as arrays', () => {
    const values = normalizeFormEntries([
      ['choice', 'a' as FormDataEntryValue],
      ['choice', 'b' as FormDataEntryValue],
      ['choice_a_more_info', 'because' as FormDataEntryValue],
    ]);

    expect(values).toEqual({ choice: ['a', 'b'], choice_a_more_info: 'because' });
  });

  it('strips dangerous html while preserving forms', () => {
    const html = sanitizeBeadsFormHtml('<form><script>alert(1)</script><img src="x"><input onclick="bad()"><a href="javascript:bad()">bad</a></form>');

    expect(html).toContain('<form');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
  });

  it('removes unsafe embeds and urls while preserving normal form controls', () => {
    const html = sanitizeBeadsFormHtml(`
      <form action="https://evil.example/post" method="get">
        <iframe src="https://evil.example"></iframe>
        <object data="bad"></object>
        <embed src="bad">
        <label for="comment">Comment</label>
        <textarea id="comment" name="comment" required rows="5"></textarea>
        <input id="approved" name="decision" type="checkbox" value="approved" checked>
        <select id="priority" name="priority"><option value="p1" selected>P1</option></select>
        <a href="https://evil.example">external</a>
        <a href="/safe">safe</a>
      </form>
    `);

    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<object');
    expect(html).not.toContain('<embed');
    expect(html).not.toContain('https://evil.example');
    expect(html).toContain('method="post"');
    expect(html).toContain('textarea');
    expect(html).toContain('name="decision"');
    expect(html).toContain('select');
    expect(html).toContain('href="/safe"');
  });

  it('builds copyable agent result text', () => {
    expect(buildAgentResultMessage({
      beadId: 'beads-web-biu',
      form: { id: 'mvp', title: 'MVP Questions' },
      values: { render_mvp: ['direct_sanitized_html'] },
    })).toContain('Remove that label after processing');
  });

  it('validates submitted fields against a controls manifest', () => {
    expect(validateSubmittedValues({
      id: 'review',
      title: 'Review',
      html: '<form></form>',
      controls: [{ id: 'comment_id', name: 'comment', type: 'textarea', required: true }],
    }, { extra: 'nope' })).toEqual([
      'Submitted field "extra" is not declared in controls[]',
      'Required field "comment" is missing',
    ]);
  });



  it('validates grouped checkbox and radio submissions by control name', () => {
    const form = {
      id: 'decisions',
      title: 'Decisions',
      html: '<form></form>',
      controls: [
        { id: 'security_strict', name: 'security', type: 'checkbox' as const, required: true },
        { id: 'security_links', name: 'security', type: 'checkbox' as const },
        { id: 'route_query', name: 'route_shape', type: 'radio' as const, required: true },
        { id: 'route_scoped', name: 'route_shape', type: 'radio' as const },
      ],
    };

    expect(validateSubmittedValues(form, {
      security: ['strict', 'links'],
      route_shape: 'dashboard_forms_query',
    })).toEqual([]);

    expect(validateSubmittedValues(form, {
      security_strict: 'strict',
      route_shape: 'dashboard_forms_query',
    })).toEqual([
      'Submitted field "security_strict" is not declared in controls[]',
      'Required field "security" is missing',
    ]);
  });

  it('builds a pretty summary', () => {
    expect(buildPrettySummary({ title: 'Review' }, { decision: ['approve'], notes: 'LGTM' })).toBe([
      'Review response',
      '',
      '- decision: approve',
      '- notes: LGTM',
    ].join('\n'));
  });
});
