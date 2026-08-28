// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  appendBeadsFormResponse,
  ALLOW_CODE_FILE_CHANGES_FIELD,
  buildBeadsFormsSummary,
  assertMetadataWithinIssueJsonGuard,
  buildAgentResultMessage,
  buildPrettySummary,
  getBeadsForms,
  getSupportedBeadsForms,
  metadataJsonByteLength,
  normalizeFormEntries,
  normalizeSubmittedValues,
  sanitizeBeadsFormHtml,
  validateSubmittedValues,
} from './beadsFormCore';

const storedForm = (id: string, title = 'Review') => ({
  format: 'standard' as const,
  id,
  goal: `Answer ${title}.`,
  title,
  questions: [{
    type: 'textarea' as const,
    id: 'comment',
    title: 'Comment',
    description: 'Share a comment.',
  }],
});

describe('BeadsForm core', () => {
  it('reads current forms before legacy forms and de-duplicates by id', () => {
    const forms = getBeadsForms({
      beadForms: { forms: [storedForm('current', 'Current')] },
      beadsWeb: { forms: [
        storedForm('current', 'Legacy duplicate'),
        storedForm('legacy', 'Legacy'),
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

  it('ignores stale generated html and controls on valid standard DSL forms', () => {
    const forms = getBeadsForms({
      beadForms: { forms: [{
        ...storedForm('review'),
        html: '<form><input name="stale"></form>',
        controls: [{ id: 'stale', name: 'stale', type: 'textarea' }],
      }] },
    });

    expect(forms).toHaveLength(1);
    expect(forms[0]!.html).toContain('name="comment"');
    expect(forms[0]!.html).not.toContain('name="stale"');
    expect(forms[0]!.controls?.map((control) => control.name)).toContain('comment');
  });

  it('loads legacy standard DSL forms with missing goal while ignoring stale generated fields', () => {
    const forms = getBeadsForms({
      beadForms: { forms: [{
        format: 'standard',
        id: 'legacy_review',
        title: 'Legacy Review',
        questions: [{
          type: 'textarea',
          id: 'comment',
          title: 'Comment',
          description: 'Share a comment.',
        }],
        html: '<form><input name="stale"></form>',
        controls: [{ id: 'stale', name: 'stale', type: 'textarea' }],
      }] },
    });

    expect(forms).toHaveLength(1);
    expect(forms[0]!.goal).toBe('Answer Legacy Review.');
    expect(forms[0]!.html).toContain('name="comment"');
    expect(forms[0]!.html).not.toContain('name="stale"');
    expect(forms[0]!.controls?.map((control) => control.name)).toContain('comment');
  });

  it('appends responses under split metadata while preserving unrelated metadata', () => {
    const next = appendBeadsFormResponse({ untouched: true, beadForms: { forms: [
      { ...storedForm('review'), html: '<form></form>', controls: [{ id: 'stale', name: 'stale', type: 'textarea' }] },
    ] } }, 'review', {
      submittedBy: 'user',
      submittedAt: '2026-06-29T00:00:00Z',
      values: { approved: 'yes' },
    });

    expect(next.untouched).toBe(true);
    expect((next.beadForms as any).forms[0].responses).toBeUndefined();
    expect((next.beadFormResponses as any).responsesByFormId.review).toHaveLength(1);
    expect((next.beadForms as any).forms[0].html).toBeUndefined();
    expect((next.beadForms as any).forms[0].controls).toBeUndefined();
    expect(getBeadsForms(next)[0]?.responses).toHaveLength(1);
    expect(next.beadFormsSummary).toEqual({
      hasForms: true,
      hasPendingAnswer: false,
      pendingResponseCount: 0,
      formIds: ['review'],
      pendingFormIds: [],
    });
  });

  it('seeds split response metadata from legacy inline responses on first write', () => {
    const next = appendBeadsFormResponse({ beadForms: { forms: [
      {
        ...storedForm('review'),
        responses: [
          { submittedBy: 'user', submittedAt: 'old', values: { comment: 'old' } },
        ],
      },
    ] } }, 'review', {
      submittedBy: 'user',
      submittedAt: '2026-06-29T00:00:00Z',
      values: { comment: 'new' },
    });

    expect((next.beadForms as any).forms[0].responses).toBeUndefined();
    expect((next.beadFormResponses as any).responsesByFormId.review).toEqual([
      { submittedBy: 'user', submittedAt: 'old', values: { comment: 'old' } },
      { submittedBy: 'user', submittedAt: '2026-06-29T00:00:00Z', values: { comment: 'new' } },
    ]);
    expect(getBeadsForms(next)[0]?.responses).toHaveLength(2);
  });

  it('persists legacy missing-goal standard forms as DSL-only with a fallback goal on submit', () => {
    const next = appendBeadsFormResponse({ beadForms: { forms: [
      {
        format: 'standard',
        id: 'legacy_review',
        title: 'Legacy Review',
        questions: [{
          type: 'textarea',
          id: 'comment',
          title: 'Comment',
          description: 'Share a comment.',
        }],
        html: '<form><input name="stale"></form>',
        controls: [{ id: 'stale', name: 'stale', type: 'textarea' }],
      },
    ] } }, 'legacy_review', {
      submittedBy: 'user',
      submittedAt: '2026-06-29T00:00:00Z',
      values: { comment: 'LGTM' },
    });

    const stored = (next.beadForms as any).forms[0];
    expect(stored.goal).toBe('Answer Legacy Review.');
    expect(stored.html).toBeUndefined();
    expect(stored.controls).toBeUndefined();
    expect(stored.responses).toBeUndefined();
    expect((next.beadFormResponses as any).responsesByFormId.legacy_review).toHaveLength(1);
    expect(getBeadsForms(next)[0]?.responses).toHaveLength(1);
  });

  it('keeps definitions and responses in separate metadata fields without applying a 64 KiB TEXT limit', () => {
    const forms = Array.from({ length: 8 }, (_, index) => ({
      ...storedForm(`review_${index}`, `Review ${index}`),
      description: 'definition '.repeat(70),
      responses: [{
        submittedBy: 'user',
        submittedAt: `2026-08-10T00:00:0${index}Z`,
        values: { notes: 'response '.repeat(70) },
      }],
    }));
    const inlineMetadata = { beadForms: { forms } };

    let splitMetadata: any = { beadForms: { forms: forms.map(({ responses: _responses, ...form }) => form) } };
    for (const form of forms) {
      splitMetadata = appendBeadsFormResponse(splitMetadata, form.id, form.responses[0]!);
    }

    expect((splitMetadata.beadForms.forms as any[]).every((form) => form.responses === undefined)).toBe(true);
    expect(Object.keys(splitMetadata.beadFormResponses.responsesByFormId)).toHaveLength(8);
    expect(() => assertMetadataWithinIssueJsonGuard(inlineMetadata, 80_000)).not.toThrow();
    expect(() => assertMetadataWithinIssueJsonGuard(splitMetadata, 80_000)).not.toThrow();
  });

  it('allows existing large issue metadata that exceeds the legacy 64 KiB TEXT size', () => {
    const metadata80k = {
      beadForms: {
        forms: [{
          ...storedForm('large_80k', 'Large 80K'),
          description: 'x'.repeat(80 * 1024),
        }],
      },
    };
    const metadata275k = {
      beadForms: {
        forms: [{
          ...storedForm('large_275k', 'Large 275K'),
          description: 'x'.repeat(275 * 1024),
        }],
      },
    };

    expect(metadataJsonByteLength(metadata80k)).toBeGreaterThan(65_535);
    expect(metadataJsonByteLength(metadata275k)).toBeGreaterThan(65_535);
    expect(() => assertMetadataWithinIssueJsonGuard(metadata80k)).not.toThrow();
    expect(() => assertMetadataWithinIssueJsonGuard(metadata275k)).not.toThrow();
  });

  it('builds a lightweight pending-answer summary for BeadsForm metadata', () => {
    expect(buildBeadsFormsSummary([
      { ...storedForm('pending', 'Pending') },
      { ...storedForm('answered', 'Answered'), responses: [{ submittedBy: 'user', submittedAt: 'now', values: {} }] },
    ])).toEqual({
      hasForms: true,
      hasPendingAnswer: true,
      pendingResponseCount: 1,
      formIds: ['pending', 'answered'],
      pendingFormIds: ['pending'],
    });
  });

  it('rejects raw html forms and preflights oversized metadata before mutation', () => {
    expect(() => getBeadsForms({
      beadForms: { forms: [{ id: 'raw', title: 'Raw', html: '<form></form>' }] },
    })).toThrow('Raw HTML BeadsForms are no longer supported');

    expect(() => assertMetadataWithinIssueJsonGuard({ big: 'x'.repeat(100) }, 40)).toThrow('No bead metadata was changed');
    expect(() => assertMetadataWithinIssueJsonGuard({ big: 'x'.repeat(100) }, 40)).toThrow('issues.metadata JSON column');
  });

  it('can skip unsupported raw html-only forms for pending queue discovery', () => {
    const forms = getSupportedBeadsForms({
      beadForms: { forms: [
        { id: 'raw', title: 'Raw', html: '<form></form>' },
        storedForm('standard'),
      ] },
      beadsWeb: { forms: [storedForm('legacy')] },
    });

    expect(forms.map((form) => form.id)).toEqual(['standard']);
  });

  it('accepts standard DSL forms while stripping stale generated html and controls', () => {
    const [form] = getSupportedBeadsForms({
      beadForms: { forms: [
        { ...storedForm('standard'), html: '<form>stale generated html</form>', controls: [] },
      ] },
    });

    expect(form?.id).toBe('standard');
    expect(form?.html).toContain('<form>');
    expect(form?.html).not.toContain('stale generated html');
    expect(form?.controls?.length).toBeGreaterThan(0);
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

  it('keeps choice default provenance out of normalized plain boolean JSON', () => {
    const form = {
      questions: [{
        type: 'choices' as const,
        id: 'priority',
        title: 'Priority',
        description: 'Choose priorities.',
        choices: [
          { id: 'storage', label: 'Storage', defaultValue: true },
          { id: 'visual_polish', label: 'Visual polish', defaultValue: false },
          { id: 'copy_result', label: 'Copy result' },
        ],
      }],
    };

    expect(normalizeSubmittedValues(form, {
      priority: ['storage', 'copy_result'],
    })).toEqual({
      priority: {
        storage: true,
        visual_polish: false,
        copy_result: true,
      },
    });
  });

  it('normalizes grouped checkbox choices as plain booleans while enforcing group constraints', () => {
    const form = {
      questions: [{
        type: 'choices' as const,
        id: 'scope',
        title: 'Scope',
        description: 'Choose scope.',
        choiceGroups: [
          { id: 'timing', mode: 'atMostOne' as const, choiceIds: ['now', 'later'] },
          { id: 'risk', mode: 'exactlyOne' as const, choiceIds: ['low', 'high', 'none'], defaultChoiceId: 'none' },
        ],
        choices: [
          { id: 'now', label: 'Now' },
          { id: 'later', label: 'Later' },
          { id: 'low', label: 'Low' },
          { id: 'high', label: 'High' },
          { id: 'none', label: 'No preference' },
          { id: 'tests', label: 'Tests' },
        ],
      }],
    };

    expect(normalizeSubmittedValues(form, {
      scope: ['now', 'later', 'tests'],
    })).toEqual({
      scope: {
        now: true,
        later: false,
        low: false,
        high: false,
        none: true,
        tests: true,
      },
    });
  });

  it('normalizes global Additional Notes without requiring a nested more-info field', () => {
    const form = getBeadsForms({
      beadForms: {
        forms: [{
          format: 'standard',
          id: 'global_additional_notes',
          goal: 'Collect a decision with one global notes field.',
          title: 'Global additional notes',
          questions: [{
            type: 'textarea',
            id: 'additional_notes',
            title: 'Additional Notes',
            description: 'Optional global context for the whole form.',
          }],
        }],
      },
    })[0]!;

    expect(form.html).toContain('name="additional_notes"');
    expect(form.html).not.toContain('name="additional_notes_more_info"');
    expect(form.controls?.map((control) => control.name)).toEqual([
      ALLOW_CODE_FILE_CHANGES_FIELD,
      'additional_notes',
    ]);
    expect(normalizeSubmittedValues(form, {
      additional_notes: 'Please keep this concise.',
    })).toEqual({
      additional_notes: 'Please keep this concise.',
      [ALLOW_CODE_FILE_CHANGES_FIELD]: false,
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
        <a href="https://docs.example">external</a>
        <a href="/safe">safe</a>
      </form>
    `);

    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<object');
    expect(html).not.toContain('<embed');
    expect(html).not.toContain('https://evil.example');
    expect(html).toContain('href="https://docs.example"');
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
    const text = buildAgentResultMessage({
      beadId: 'beads-web-biu',
      form: { id: 'mvp', title: 'MVP Questions' },
      values: { render_mvp: ['direct_sanitized_html'], decision: { approve: true, defer: false } },
      submittedAt: '2026-06-29T00:00:00.000Z',
      submittedBy: 'reviewer',
    });

    expect(text).toContain('BeadsForm XML handoff:');
    expect(text).toContain('<beadId>beads-web-biu</beadId>');
    expect(text).toContain('<formId>mvp</formId>');
    expect(text).toContain('<submittedAt>2026-06-29T00:00:00.000Z</submittedAt>');
    expect(text).toContain('<submittedBy>reviewer</submittedBy>');
    expect(text).toContain('<choice id="approve" selected="true" />');
    expect(text).toContain('Remove that label after processing');
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
