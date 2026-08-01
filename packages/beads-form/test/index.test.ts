import { describe, expect, it } from 'vitest';
import {
  ALLOW_CODE_FILE_CHANGES_FIELD,
  buildBeadsFormMetadata,
  buildChoicesQuestion,
  buildMediaGallery,
  buildTextareaQuestion,
  compileBeadsForm,
  defineBeadsForm,
} from '../src/index';

describe('@vibe-dashboard/beads-form', () => {
  it('compiles standard choice questions into accessible form HTML and controls', () => {
    const form = defineBeadsForm({
      id: 'planning_review',
      goal: 'Collect planning feedback from the human.',
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
      goal: 'Verify old note flags still compile safely.',
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
      goal: 'Collect notes without implementation permission controls.',
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
      goal: 'Collect notes with custom permission submit text.',
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

  it('compiles media galleries without adding submission controls', () => {
    const compiled = compileBeadsForm(defineBeadsForm({
      id: 'screenshot_review',
      goal: 'Choose acceptable screenshot candidates.',
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
        goal: 'Confirm unsafe HTML stays escaped.',
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
    expect(form.goal).toBe('Confirm unsafe HTML stays escaped.');
    expect(form.controls.map((control) => control.name)).toEqual([
      ALLOW_CODE_FILE_CHANGES_FIELD,
      'notes',
      'notes_more_info',
    ]);
  });

  it('requires a concise form goal', () => {
    expect(() => compileBeadsForm({
      format: 'standard',
      id: 'missing_goal',
      goal: '',
      title: 'Missing goal',
      questions: [
        buildTextareaQuestion({
          id: 'notes',
          title: 'Notes',
          description: 'Provide notes.',
        }),
      ],
    })).toThrow('form.goal is required');
  });

  it('truncates long Markdown descriptions behind a Show more affordance', () => {
    const longDescription = [
      'This description starts with **important context** that should remain visible.',
      'It then includes a lot of detailed background, tradeoffs, reviewer notes, and implementation nuance so the human can answer without reading the whole conversation.',
      'The compiler should keep the first question high on the page while retaining the full Markdown-rendered context behind an explicit expansion control.',
      'Another sentence adds enough length to cross the truncation threshold and proves this is not merely short-context rendering.',
      'The expanded section still needs to preserve Markdown, escaped HTML, paragraphs, and links safely.',
      'This final sentence should only appear in the expanded full description.',
    ].join(' ');
    const compiled = compileBeadsForm(defineBeadsForm({
      id: 'long_context',
      goal: 'Decide the storage policy.',
      title: 'Long context',
      description: longDescription,
      questions: [
        buildTextareaQuestion({
          id: 'notes',
          title: 'Notes',
          description: 'Share the decision.',
        }),
      ],
    }));

    expect(compiled.html).toContain('beads-form-description--truncated');
    expect(compiled.html).toContain('<summary>Show more</summary>');
    expect(compiled.html).toContain('<strong>important context</strong>');
    expect(compiled.html).toContain('This final sentence should only appear in the expanded full description.');
  });

  it('renders safe Markdown descriptions and recommendation reasons', () => {
    const compiled = compileBeadsForm(defineBeadsForm({
      id: 'markdown_review',
      goal: 'Choose the **lowest-risk** path.',
      title: '**Markdown** review',
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
    expect(compiled.html).toContain('<h2><strong>Markdown</strong> review</h2>');
    expect(compiled.html).toContain('<p class="beads-form-goal"><strong>Goal:</strong> Choose the <strong>lowest-risk</strong> path.</p>');
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
      goal: 'Check stale recommended booleans are ignored.',
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
});
