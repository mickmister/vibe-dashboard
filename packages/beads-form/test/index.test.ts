import { describe, expect, it } from 'vitest';
import {
  ALLOW_CODE_FILE_CHANGES_FIELD,
  buildBeadsFormMetadata,
  buildChoicesQuestion,
  buildMediaGallery,
  buildTextareaQuestion,
  compileBeadsForm,
  createBeadsFormWorkflowArtifactRef,
  defineBeadsForm,
  parseBeadsFormXml,
} from '../src/index';

describe('@vibe-dashboard/beads-form', () => {
  it('compiles standard choice questions into accessible form HTML and controls', () => {
    const form = defineBeadsForm({
      id: 'planning_review',
      title: 'Planning review',
      description: 'Collect planning feedback.',
      questions: [
        buildChoicesQuestion({
          id: 'entry_point',
          title: 'Entry point',
          description: 'Choose how users should open the feature.',
          required: true,
          choices: [
            { id: 'forms_tab', label: 'Forms tab', description: 'Open near the agent tab.' },
            { id: 'direct_route', label: 'Direct route' },
          ],
        }),
      ],
    });

    const compiled = compileBeadsForm(form);

    expect(compiled.html).toContain('<fieldset>');
    expect(compiled.html).toContain(`name="${ALLOW_CODE_FILE_CHANGES_FIELD}" type="submit" value="true"`);
    expect(compiled.html).toContain(`name="${ALLOW_CODE_FILE_CHANGES_FIELD}" type="submit" value="false"`);
    expect(compiled.html).not.toContain(`name="${ALLOW_CODE_FILE_CHANGES_FIELD}" type="checkbox"`);
    expect(compiled.html).toContain('name="entry_point" type="checkbox" value="forms_tab"');
    expect(compiled.html).not.toContain('type="checkbox" value="forms_tab" required');
    expect(compiled.html).toContain('name="entry_point_forms_tab_more_info"');
    expect(compiled.html).toContain('name="entry_point_more_info"');
    expect(compiled.controls).toEqual([
      { id: ALLOW_CODE_FILE_CHANGES_FIELD, name: ALLOW_CODE_FILE_CHANGES_FIELD, type: 'submit' },
      { id: 'entry_point_forms_tab', name: 'entry_point', type: 'checkbox', required: true, multiple: true },
      { id: 'entry_point_forms_tab_more_info', name: 'entry_point_forms_tab_more_info', type: 'textarea' },
      { id: 'entry_point_direct_route', name: 'entry_point', type: 'checkbox', required: true, multiple: true },
      { id: 'entry_point_direct_route_more_info', name: 'entry_point_direct_route_more_info', type: 'textarea' },
      { id: 'entry_point_more_info', name: 'entry_point_more_info', type: 'textarea' },
    ]);
  });

  it('treats stale note and multiple-choice flags as always enabled for compatibility', () => {
    const compiled = compileBeadsForm(defineBeadsForm({
      id: 'legacy_flags',
      title: 'Legacy flags',
      questions: [
        buildChoicesQuestion({
          id: 'decision',
          title: 'Decision',
          description: 'Choose every acceptable option.',
          allowMultiple: false,
          includePerChoiceNotes: false,
          includeQuestionNotes: false,
          choices: [
            { id: 'ship', label: 'Ship' },
            { id: 'wait', label: 'Wait' },
          ],
        } as unknown as Parameters<typeof buildChoicesQuestion>[0]),
        buildTextareaQuestion({
          id: 'notes',
          title: 'Notes',
          description: 'Share extra context.',
          includeQuestionNotes: false,
        } as unknown as Parameters<typeof buildTextareaQuestion>[0]),
      ],
    }));

    expect(compiled.html).toContain('name="decision" type="checkbox" value="ship"');
    expect(compiled.html).not.toContain('type="radio"');
    expect(compiled.html).toContain('name="decision_ship_more_info"');
    expect(compiled.html).toContain('name="decision_more_info"');
    expect(compiled.html).toContain('name="notes_more_info"');
    expect(compiled.controls).toEqual([
      { id: ALLOW_CODE_FILE_CHANGES_FIELD, name: ALLOW_CODE_FILE_CHANGES_FIELD, type: 'submit' },
      { id: 'decision_ship', name: 'decision', type: 'checkbox', required: undefined, multiple: true },
      { id: 'decision_ship_more_info', name: 'decision_ship_more_info', type: 'textarea' },
      { id: 'decision_wait', name: 'decision', type: 'checkbox', required: undefined, multiple: true },
      { id: 'decision_wait_more_info', name: 'decision_wait_more_info', type: 'textarea' },
      { id: 'decision_more_info', name: 'decision_more_info', type: 'textarea' },
      { id: 'notes', name: 'notes', type: 'textarea', required: undefined },
      { id: 'notes_more_info', name: 'notes_more_info', type: 'textarea' },
    ]);
  });

  it('allows hiding or customizing the code/file-change submit actions', () => {
    const hidden = compileBeadsForm(defineBeadsForm({
      id: 'hidden_permission',
      title: 'Hidden permission',
      allowCodeFileChanges: false,
      questions: [
        buildTextareaQuestion({
          id: 'notes',
          title: 'Notes',
          description: 'Provide notes.',
        }),
      ],
    }));
    expect(hidden.html).not.toContain(ALLOW_CODE_FILE_CHANGES_FIELD);
    expect(hidden.controls.map((control) => control.name)).not.toContain(ALLOW_CODE_FILE_CHANGES_FIELD);

    const customized = compileBeadsForm(defineBeadsForm({
      id: 'custom_permission',
      title: 'Custom permission',
      allowCodeFileChanges: {
        allowLabel: 'Submit with edits allowed',
        avoidLabel: 'Submit read-only',
        description: 'Choose whether implementation should proceed.',
      },
      questions: [
        buildTextareaQuestion({
          id: 'notes',
          title: 'Notes',
          description: 'Provide notes.',
        }),
      ],
    }));
    expect(customized.html).toContain('Submit with edits allowed');
    expect(customized.html).toContain('Submit read-only');
    expect(customized.html).toContain('Choose whether implementation should proceed.');
    expect(customized.html).toContain(`name="${ALLOW_CODE_FILE_CHANGES_FIELD}" type="submit" value="true"`);
    expect(customized.html).toContain(`name="${ALLOW_CODE_FILE_CHANGES_FIELD}" type="submit" value="false"`);
  });

  it('creates first-party workflow artifact refs for human form providers', () => {
    expect(createBeadsFormWorkflowArtifactRef({
      idempotencyKey: 'run-1:visit-1:approval',
      title: 'Approve plan',
      formSchema: { fields: { approved: { required: true } } },
      submitLabel: 'Submit approval',
    })).toEqual({
      providerType: 'beads_form',
      artifactKind: 'form',
      artifactId: 'run-1:visit-1:approval',
      durableRef: 'beads-form://workflow/run-1%3Avisit-1%3Aapproval',
      metadata: { title: 'Approve plan', submitLabel: 'Submit approval' },
    });
  });

  it('compiles media galleries without adding submission controls', () => {
    const compiled = compileBeadsForm(defineBeadsForm({
      id: 'screenshot_review',
      title: 'Screenshot review',
      content: [
        buildMediaGallery({
          id: 'storybook_candidates',
          title: 'Storybook candidates',
          description: 'Compare candidate screenshots before selecting an option.',
          items: [
            { id: 'candidate_a', type: 'image', src: 'attachments/candidate-a.png', alt: 'Candidate A', caption: 'Candidate A' },
            { id: 'candidate_b', type: 'video', src: 'attachment://candidate-b.webm', poster: 'attachments/candidate-b.png', caption: 'Candidate B recording' },
          ],
        }),
      ],
      questions: [
        buildChoicesQuestion({
          id: 'preferred_candidate',
          title: 'Preferred candidate',
          description: 'Pick every candidate that is acceptable.',
          choices: [
            { id: 'candidate_a', label: 'Candidate A' },
            { id: 'candidate_b', label: 'Candidate B' },
          ],
        }),
      ],
    }));

    expect(compiled.html).toContain('class="beads-form-media-gallery"');
    expect(compiled.html).toContain('<img src="attachments/candidate-a.png" alt="Candidate A">');
    expect(compiled.html).toContain('<video src="attachment://candidate-b.webm" poster="attachments/candidate-b.png" controls preload="metadata">');
    expect(compiled.controls.map((control) => control.name)).toEqual([
      ALLOW_CODE_FILE_CHANGES_FIELD,
      'preferred_candidate',
      'preferred_candidate_candidate_a_more_info',
      'preferred_candidate',
      'preferred_candidate_candidate_b_more_info',
      'preferred_candidate_more_info',
    ]);
  });

  it('keeps HTML escaped and builds bead metadata payloads', () => {
    const metadata = buildBeadsFormMetadata([
      defineBeadsForm({
        id: 'safe_form',
        title: '<script>bad</script>',
        questions: [
          buildTextareaQuestion({
            id: 'notes',
            title: 'Notes',
            description: 'Provide notes without allowing raw HTML.',
          }),
        ],
      }),
    ]);

    const form = metadata.beadForms.forms[0]!;
    expect(metadata.beadFormsSummary).toEqual({
      hasForms: true,
      hasPendingAnswer: true,
      pendingResponseCount: 1,
      formIds: ['safe_form'],
      pendingFormIds: ['safe_form'],
    });
    expect(form.html).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(form.controls.map((control) => control.name)).toEqual([
      ALLOW_CODE_FILE_CHANGES_FIELD,
      'notes',
      'notes_more_info',
    ]);
  });

  it('renders safe Markdown descriptions and recommendation reasons', () => {
    const compiled = compileBeadsForm(defineBeadsForm({
      id: 'markdown_review',
      title: 'Markdown review',
      description: 'Use **bold** and `code`, but not <script>bad</script>.',
      questions: [
        buildChoicesQuestion({
          id: 'path',
          title: 'Path',
          description: 'Choose the *recommended* path. See [docs](/docs).',
          choices: [
            {
              id: 'recommended',
              label: 'Recommended path',
              description: 'This is **recommended**.',
              is_recommended_reason: 'Fastest path with **lowest risk**.',
            },
            {
              id: 'no_reason',
              label: 'No reason marker',
              description: 'Should not render a reason-less recommendation marker.',
            },
            {
              id: 'unsafe_link',
              label: 'Unsafe link',
              description: 'Do not link [bad](javascript:alert(1)).',
            },
          ],
        }),
      ],
    }));

    expect(compiled.html).toContain('<strong>bold</strong>');
    expect(compiled.html).toContain('<code>code</code>');
    expect(compiled.html).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(compiled.html).toContain('<em>recommended</em>');
    expect(compiled.html).toContain('<a href="/docs" rel="noopener noreferrer">docs</a>');
    expect(compiled.html).toContain('class="beads-form-recommended"');
    expect(compiled.html.match(/class="beads-form-recommended"/g)).toHaveLength(1);
    expect(compiled.html).toContain('class="beads-form-recommended-reason"');
    expect(compiled.html).toContain('Fastest path with <strong>lowest risk</strong>.');
    expect(compiled.html).not.toContain('No reason marker <span class="beads-form-recommended"');
    expect(compiled.html).not.toContain('javascript:alert');
  });

  it('ignores reason-less legacy recommended booleans from raw JSON', () => {
    const compiled = compileBeadsForm(defineBeadsForm({
      id: 'legacy_recommended',
      title: 'Legacy recommended',
      description: 'Raw JSON may still contain a stale boolean recommendation marker.',
      questions: [{
        type: 'choices',
        id: 'path',
        title: 'Path',
        description: 'Choose one.',
        choices: [{
          id: 'legacy',
          label: 'Legacy marker',
          recommended: true,
        } as unknown as { id: string; label: string }],
      }],
    }));

    expect(compiled.html).toContain('Legacy marker');
    expect(compiled.html).not.toContain('class="beads-form-recommended"');
    expect(compiled.html).not.toContain('class="beads-form-recommended-reason"');
  });

  it('parses workflow beads-form XML with markdown choices into standard form schema', () => {
    const form = parseBeadsFormXml(`
      <beadsForm id="planning_review">
        <title>Planning Review</title>
        <description><![CDATA[Markdown **description**]]></description>
        <question id="entry_point" type="choices" required="true">
          <title>Entry point</title>
          <description><![CDATA[Question markdown]]></description>
          <choice id="forms_tab">
            <label>Open in Forms tab</label>
            <pros><![CDATA[Fast and **focused**]]></pros>
            <cons><![CDATA[Needs a visible tab.]]></cons>
          </choice>
        </question>
        <question id="notes" type="textarea" required="false">
          <title>Notes</title>
          <description><![CDATA[Free-form notes]]></description>
        </question>
      </beadsForm>
    `);

    expect(form).toMatchObject({
      format: 'standard',
      id: 'planning_review',
      title: 'Planning Review',
      description: 'Markdown **description**',
      questions: [
        expect.objectContaining({
          id: 'entry_point',
          type: 'choices',
          required: true,
          choices: [expect.objectContaining({
            id: 'forms_tab',
            label: 'Open in Forms tab',
          })],
        }),
        expect.objectContaining({ id: 'notes', type: 'textarea', required: false }),
      ],
    });
    expect((form.questions[0] as any).choices[0].description).toContain('**Pros:**');
    expect((form.questions[0] as any).choices[0].description).toContain('**Cons:**');
    expect((form.questions[0] as any).choices[0].is_recommended_reason).toBeUndefined();
    expect(compileBeadsForm(form).html).toContain('Open in Forms tab');
    expect(compileBeadsForm(form).html).not.toContain('beads-form-recommended');
  });

  it('only maps explicit workflow XML recommendedReason to recommendation metadata', () => {
    const form = parseBeadsFormXml(`
      <beadsForm id="planning_review">
        <title>Planning Review</title>
        <question id="entry_point" type="choices" required="true">
          <title>Entry point</title>
          <choice id="forms_tab">
            <label>Open in Forms tab</label>
            <pros>Good fit for review.</pros>
            <recommendedReason><![CDATA[Best default for the current workflow.]]></recommendedReason>
          </choice>
        </question>
      </beadsForm>
    `);

    expect((form.questions[0] as any).choices[0]).toMatchObject({
      description: '**Pros:**\nGood fit for review.',
      is_recommended_reason: 'Best default for the current workflow.',
    });
    expect(compileBeadsForm(form).html).toContain('beads-form-recommended');
  });

  it('rejects invalid workflow beads-form XML', () => {
    expect(() => parseBeadsFormXml('<beadsForm><title>Missing id</title></beadsForm>')).toThrow('beadsForm.id is required');
    expect(() => parseBeadsFormXml('<beadsForm id="bad"><title>Bad</title><question id="q" type="unsupported"><title>Q</title></question></beadsForm>')).toThrow('must be choices, text, or textarea');
  });

});
