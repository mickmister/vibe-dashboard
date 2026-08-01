// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  appendBeadsFormResponse,
  ALLOW_CODE_FILE_CHANGES_FIELD,
  buildBeadsFormsSummary,
  buildAgentResultMessage,
  buildPrettySummary,
  getBeadsForms,
  normalizeFormEntries,
  normalizeSubmittedValues,
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

  it('compiles standard form metadata into renderable html and controls', () => {
    const forms = getBeadsForms({
      beadForms: {
        forms: [{
          format: 'standard',
          id: 'planning_review',
          goal: 'Choose where the form should open.',
          title: 'Planning Review',
          questions: [{
            type: 'choices',
            id: 'entry_point',
            title: 'Entry point',
            description: 'Choose where this should open.',
            choices: [{ id: 'forms_tab', label: 'Forms tab' }],
          }],
        }],
      },
    });

    expect(forms).toHaveLength(1);
    expect(forms[0]!.html).toContain('<form>');
    expect(forms[0]!.html).toContain(`name="${ALLOW_CODE_FILE_CHANGES_FIELD}"`);
    expect(forms[0]!.html).toContain('name="entry_point"');
    expect(forms[0]!.controls?.map((control) => control.name)).toEqual([
      ALLOW_CODE_FILE_CHANGES_FIELD,
      'entry_point',
      'entry_point_forms_tab_more_info',
      'entry_point_more_info',
    ]);
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
    expect(next.beadFormsSummary).toEqual({
      hasForms: true,
      hasPendingAnswer: false,
      pendingResponseCount: 0,
      formIds: ['review'],
      pendingFormIds: [],
    });
  });

  it('builds a lightweight pending-answer summary for BeadsForm metadata', () => {
    expect(buildBeadsFormsSummary([
      { id: 'pending', title: 'Pending', html: '<form></form>' },
      { id: 'answered', title: 'Answered', html: '<form></form>', responses: [{ submittedBy: 'user', submittedAt: 'now', values: {} }] },
    ])).toEqual({
      hasForms: true,
      hasPendingAnswer: true,
      pendingResponseCount: 1,
      formIds: ['pending', 'answered'],
      pendingFormIds: ['pending'],
    });
  });

  it('normalizes repeated form entries as arrays', () => {
    const values = normalizeFormEntries([
      ['choice', 'a' as FormDataEntryValue],
      ['choice', 'b' as FormDataEntryValue],
      ['choice_a_more_info', 'because' as FormDataEntryValue],
    ]);

    expect(values).toEqual({ choice: ['a', 'b'], choice_a_more_info: 'because' });
  });

  it('normalizes allow_code_file_changes to a stable boolean when declared', () => {
    const form = {
      id: 'permission',
      title: 'Permission',
      html: '<form></form>',
      controls: [{ id: ALLOW_CODE_FILE_CHANGES_FIELD, name: ALLOW_CODE_FILE_CHANGES_FIELD, type: 'submit' as const }],
    };

    expect(normalizeSubmittedValues(form, { [ALLOW_CODE_FILE_CHANGES_FIELD]: 'true' })).toEqual({
      [ALLOW_CODE_FILE_CHANGES_FIELD]: true,
    });
    expect(normalizeSubmittedValues(form, { [ALLOW_CODE_FILE_CHANGES_FIELD]: 'false' })).toEqual({
      [ALLOW_CODE_FILE_CHANGES_FIELD]: false,
    });
    expect(normalizeSubmittedValues(form, {})).toEqual({
      [ALLOW_CODE_FILE_CHANGES_FIELD]: false,
    });
  });

  it('normalizes standard choice groups to explicit per-option booleans and omits empty notes', () => {
    const form = {
      id: 'preview',
      title: 'Preview',
      html: '<form></form>',
      controls: [
        { id: ALLOW_CODE_FILE_CHANGES_FIELD, name: ALLOW_CODE_FILE_CHANGES_FIELD, type: 'submit' as const },
        { id: 'preview_loaded_successfully', name: 'preview_flow_result', type: 'checkbox' as const },
        { id: 'preview_form_rendered_correctly', name: 'preview_flow_result', type: 'checkbox' as const },
        { id: 'preview_json_copy_worked', name: 'preview_flow_result', type: 'checkbox' as const },
        { id: 'preview_needs_ux_changes', name: 'preview_flow_result', type: 'checkbox' as const },
        { id: 'preview_flow_result_loaded_successfully_more_info', name: 'preview_flow_result_loaded_successfully_more_info', type: 'textarea' as const },
        { id: 'preview_flow_result_needs_ux_changes_more_info', name: 'preview_flow_result_needs_ux_changes_more_info', type: 'textarea' as const },
        { id: 'preview_flow_result_more_info', name: 'preview_flow_result_more_info', type: 'textarea' as const },
      ],
      questions: [{
        type: 'choices' as const,
        id: 'preview_flow_result',
        title: 'Preview flow result',
        description: 'Select every matching result.',
        choices: [
          { id: 'loaded_successfully', label: 'Loaded successfully' },
          { id: 'form_rendered_correctly', label: 'Form rendered correctly' },
          { id: 'json_copy_worked', label: 'JSON copy worked' },
          { id: 'needs_ux_changes', label: 'Needs UX changes' },
        ],
      }],
    };

    expect(normalizeSubmittedValues(form, {
      [ALLOW_CODE_FILE_CHANGES_FIELD]: 'false',
      preview_flow_result: ['loaded_successfully', 'form_rendered_correctly', 'needs_ux_changes'],
      preview_flow_result_loaded_successfully_more_info: '',
      preview_flow_result_needs_ux_changes_more_info: 'Buttons are clearer now.',
      preview_flow_result_more_info: '',
    })).toEqual({
      [ALLOW_CODE_FILE_CHANGES_FIELD]: false,
      preview_flow_result: {
        loaded_successfully: true,
        form_rendered_correctly: true,
        json_copy_worked: false,
        needs_ux_changes: true,
      },
      preview_flow_result_needs_ux_changes_more_info: 'Buttons are clearer now.',
    });
  });

  it('keeps raw checkbox groups as arrays when no standard questions are available', () => {
    const form = {
      id: 'raw',
      title: 'Raw',
      html: '<form></form>',
      controls: [
        { id: 'a', name: 'raw_choices', type: 'checkbox' as const },
        { id: 'b', name: 'raw_choices', type: 'checkbox' as const },
      ],
    };

    expect(normalizeSubmittedValues(form, { raw_choices: ['a'], raw_notes: '' })).toEqual({
      raw_choices: ['a'],
    });
  });

  it('strips dangerous html while preserving forms', () => {
    const html = sanitizeBeadsFormHtml('<form><script>alert(1)</script><img src="x"><input onclick="bad()"><a href="javascript:bad()">bad</a></form>');

    expect(html).toContain('<form');
    expect(html).not.toContain('<script');
    expect(html).toContain('<img src="x">');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
  });

  it('removes unsafe embeds and urls while preserving normal form controls', () => {
    const html = sanitizeBeadsFormHtml(`
      <form action="https://evil.example/post" method="get">
        <iframe src="https://evil.example"></iframe>
        <object data="bad"></object>
        <embed src="bad">
        <img src="attachments/safe.png" alt="Safe">
        <img src="https://evil.example/track.png" alt="Unsafe">
        <video src="attachment://demo.webm" poster="screenshots/demo.png" controls></video>
        <video src="data:video/webm;base64,bad" poster="javascript:bad()" controls></video>
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
    expect(html).toContain('<img src="attachments/safe.png" alt="Safe">');
    expect(html).toContain('<video src="attachment://demo.webm" poster="screenshots/demo.png" controls=""></video>');
    expect(html).not.toContain('data:video');
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
      security: { strict: false, links: false },
      route_shape: { route_query: true, route_scoped: false },
    })).toEqual([
      'Required field "security" is missing',
    ]);

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
