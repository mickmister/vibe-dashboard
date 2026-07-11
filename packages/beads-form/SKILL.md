---
name: beads-form-authoring
description: Author bead-attached forms using the standard @vibe-dashboard/beads-form TypeScript helpers instead of hand-written HTML.
---

# Beads Form Authoring

Use this skill when an agent needs to ask a human structured questions through a bead form.

## Core rule

Prefer the standard JSON/helper format from `@vibe-dashboard/beads-form`. Do not hand-write raw HTML unless the standard format cannot express the form.

## Agent roles

- **Form-making agent:** writes or updates form definitions using the helpers below.
- **Orchestrating agent:** gives the human a preview or bead-backed URL, reads the normalized JSON response, and follows its constraints.

If the response includes `"allow_code_file_changes": false`, agents must keep code/file operations read-only. Discussion, analysis, planning, and non-code metadata operations can continue.

## Import

```ts
import {
  ALLOW_CODE_FILE_CHANGES_FIELD,
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
  // Optional. Shown and checked by default if omitted.
  allowCodeFileChanges: {
    label: 'Allow code/file changes?',
    description: 'Uncheck this if agents should only discuss and inspect code without editing files.',
    defaultChecked: true,
  },
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
- Standard forms include an `allow_code_file_changes` checkbox by default. If the normalized response has this field as `false`, do not edit code or files.
- Use stable lowercase ids with letters, numbers, `_`, or `-`; start ids with a letter.
- Choice ids become submitted values.
- Question ids become submitted field names.
- The renderer generates accessible HTML and the validation `controls[]` manifest.

## Folder preview workflow

Use folder mode for low-friction testing before attaching forms to beads.

1. Create a folder for form JSON files, for example:

   ```sh
   mkdir -p /tmp/beads-form-preview
   ```

2. Write one standard form per `.json` file. You can either generate JSON from a TypeScript script that imports these helpers, or write the standard JSON shape directly:

   ```json
   {
     "format": "standard",
     "id": "planning_review",
     "title": "Planning Review",
     "description": "Questions to unblock the implementation plan.",
     "questions": [
       {
         "type": "textarea",
         "id": "overall_notes",
         "title": "Overall notes",
         "description": "Share any context that does not fit elsewhere."
       }
     ]
   }
   ```

3. Give the human a preview URL:

   ```text
   https://jamtools.dev/dashboard/forms/preview?folder=<urlencoded absolute folder path>
   ```

4. The preview page lists all `.json` forms in the folder. Submitting a form copies normalized JSON only to the clipboard and displays it on screen. It does not update beads.

5. The orchestrating agent should paste/read that JSON exactly. If `allow_code_file_changes` is `false`, keep code/file operations read-only.

## Attaching to a bead

1. Read existing bead metadata with `bd show <bead-id> --json --long`.
2. Preserve existing metadata.
3. Merge or append `metadataPatch.beadForms.forms` into `metadata.beadForms.forms`.
4. Update the bead with `bd update <bead-id> --metadata @metadata.json`.
5. Give the user a form URL:

```text
https://jamtools.dev/dashboard/forms?dir=<urlencoded absolute repo dir>&bead=<urlencoded bead id>&form=<urlencoded form id>
```

Bead-backed storage remains preferred for real workflow state and durable responses. Folder preview is for prototyping and quick review loops.

## Follow-up media galleries

Do not block basic forms on media support. For screenshot/video review workflows, create a follow-up bead for attachable galleries, including best-of-N Storybook screenshot comparison inputs.

## Escape hatch

If the standard helpers are not expressive enough, generate raw HTML only as a fallback. Keep the same naming conventions and provide a complete `controls[]` manifest, because submissions are validated by HTML `name`.
