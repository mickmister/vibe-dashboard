import { describe, expect, it } from 'vitest';
import {
  buildBeadsFormMetadata,
  buildChoicesQuestion,
  buildTextareaQuestion,
  compileBeadsForm,
  defineBeadsForm,
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
    expect(compiled.html).toContain('name="entry_point" type="checkbox" value="forms_tab"');
    expect(compiled.html).not.toContain('type="checkbox" value="forms_tab" required');
    expect(compiled.html).toContain('name="entry_point_forms_tab_more_info"');
    expect(compiled.html).toContain('name="entry_point_more_info"');
    expect(compiled.controls).toEqual([
      { id: 'entry_point_forms_tab', name: 'entry_point', type: 'checkbox', required: true, multiple: true },
      { id: 'entry_point_forms_tab_more_info', name: 'entry_point_forms_tab_more_info', type: 'textarea' },
      { id: 'entry_point_direct_route', name: 'entry_point', type: 'checkbox', required: true, multiple: true },
      { id: 'entry_point_direct_route_more_info', name: 'entry_point_direct_route_more_info', type: 'textarea' },
      { id: 'entry_point_more_info', name: 'entry_point_more_info', type: 'textarea' },
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
    expect(form.html).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(form.controls.map((control) => control.name)).toEqual(['notes', 'notes_more_info']);
  });
});
