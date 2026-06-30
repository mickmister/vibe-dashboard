---
name: beads-form-authoring
description: Author bead-attached forms using the standard @vibe-dashboard/beads-form TypeScript helpers instead of hand-written HTML.
---

# Beads Form Authoring

Use this skill when an agent needs to ask a human structured questions through a bead form.

## Core rule

Prefer the standard JSON/helper format from `@vibe-dashboard/beads-form`. Do not hand-write raw HTML unless the standard format cannot express the form.

## Import

```ts
import {
  buildBeadsFormMetadata,
  buildChoicesQuestion,
  buildTextQuestion,
  buildTextareaQuestion,
  compileBeadsForm,
  defineBeadsForm,
} from '@vibe-dashboard/beads-form';
```

## Standard pattern

```ts
const form = defineBeadsForm({
  id: 'planning_review',
  title: 'Planning Review',
  description: 'Questions to unblock the implementation plan.',
  questions: [
    buildChoicesQuestion({
      id: 'entry_point',
      title: 'Entry point',
      description: 'Choose how the user should open this feature. Select every acceptable option and explain nuance in the textareas.',
      choices: [
        { id: 'forms_tab', label: 'Open in a Forms tab' },
        { id: 'direct_route', label: 'Support a direct dashboard URL' },
      ],
    }),
    buildTextareaQuestion({
      id: 'overall_notes',
      title: 'Overall notes',
      description: 'Share any context that does not fit the choices above.',
    }),
  ],
});

const metadataPatch = buildBeadsFormMetadata([form]);
```

## Conventions

- Every question needs a `title` and a context-rich `description`.
- Choice questions default to checkboxes so humans can select more than one answer.
- Per-choice textareas and per-question textareas are included by default.
- Use stable lowercase ids with letters, numbers, `_`, or `-`; start ids with a letter.
- Choice ids become submitted values.
- Question ids become submitted field names.
- The renderer generates accessible HTML and the validation `controls[]` manifest.

## Attaching to a bead

1. Read existing bead metadata with `bd show <bead-id> --json --long`.
2. Preserve existing metadata.
3. Merge or append `metadataPatch.beadForms.forms` into `metadata.beadForms.forms`.
4. Update the bead with `bd update <bead-id> --metadata @metadata.json`.
5. Give the user a form URL:

```text
https://jamtools.dev/dashboard/forms?dir=<urlencoded absolute repo dir>&bead=<urlencoded bead id>&form=<urlencoded form id>
```

## Escape hatch

If the standard helpers are not expressive enough, generate raw HTML only as a fallback. Keep the same naming conventions and provide a complete `controls[]` manifest, because submissions are validated by HTML `name`.
