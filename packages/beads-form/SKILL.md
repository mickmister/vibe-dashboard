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
  buildMediaGallery,
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
    allowLabel: 'Submit and allow code/file changes',
    avoidLabel: 'Submit and avoid code/file changes',
    description: 'Choose whether agents may edit code/files after receiving this response.',
  },
  content: [
    buildMediaGallery({
      id: 'candidate_screenshots',
      title: 'Candidate screenshots',
      description: 'Compare local screenshots before answering.',
      items: [
        { id: 'candidate_a', type: 'image', src: 'attachments/candidate-a.png', alt: 'Candidate A screenshot', caption: 'Candidate A' },
        { id: 'candidate_b', type: 'video', src: 'attachment://candidate-b.webm', poster: 'attachments/candidate-b.png', caption: 'Candidate B recording' },
      ],
    }),
  ],
  questions: [
    buildChoicesQuestion({
      id: 'entry_point',
      title: 'Entry point',
      description: 'Choose how the user should open this feature. Select every acceptable option and explain nuance in the textareas.',
      choices: [
        { id: 'forms_tab', label: 'Open in a Forms tab', recommended: true },
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
- Standard forms include two submit actions by default: one that sets `allow_code_file_changes` to `true`, and one that sets it to `false`. If the normalized response has this field as `false`, do not edit code or files.
- Use `content: [buildMediaGallery(...)]` for local screenshot/video review blocks. Prefer folder-relative refs like `attachments/candidate-a.png` or attachment-style refs like `attachment://candidate-b.webm`.
- Use stable lowercase ids with letters, numbers, `_`, or `-`; start ids with a letter.
- Choice ids become submitted values.
- Question ids become submitted field names.
- The renderer generates accessible HTML and the validation `controls[]` manifest.
- Add `recommended: true` to choices the agent recommends; the UI emphasizes those options.
- Descriptions support safe Markdown such as `**bold**`, `*emphasis*`, `` `code` ``, and safe links. Raw HTML in descriptions is escaped.
- Standard choice questions normalize as per-option booleans, for example
  `"preview_flow_result": { "loaded_successfully": true, "json_copy_worked": false }`.
- Empty optional text fields, including empty `*_more_info` fields, are omitted from copied JSON.

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

   In this repo, the easiest local way to run the folder preview is:

   ```sh
   npm run dev:beads-form-preview -- --folder /tmp/beads-form-preview
   ```

   The command validates the folder, starts the existing Springboard/Vite dev server, and prints the exact preview URL with the folder path encoded. It sets `BEADS_FORM_DISABLE_HMR=1` by default so Vite does not push HMR/full-reload updates into an open form; manual browser refresh still loads the latest code. Set `BEADS_FORM_DISABLE_HMR=0` only when you want normal dev-server auto-reload behavior.
   To force a port, set `BEADS_FORM_PREVIEW_PORT=<port>`.

4. The preview page lists all `.json` forms in the folder. Submitting a form copies normalized JSON only to the clipboard and displays it on screen. It does not update beads.

5. The orchestrating agent should paste/read that JSON exactly. If `allow_code_file_changes` is `false`, keep code/file operations read-only.

### Media galleries in folder preview

Media galleries render local image/video references through the preview server. Keep media files inside the same preview folder as the JSON, usually under an `attachments/` subfolder.

Allowed preview refs:

- `attachments/screenshot-a.png`
- `./attachments/screenshot-a.png`
- `attachment://screenshot-a.png`
- `attachments/demo.webm`

Avoid arbitrary external embeds. The preview sanitizer/route is intentionally scoped to local/folder-relative media and common image/video extensions.

For a copyable best-of-N Storybook screenshot comparison fixture, see:

```text
packages/beads-form/examples/storybook-best-of-n-gallery.json
```

## Bead-backed attach workflow

Bead-backed storage is the primary workflow for real agent/user handoff. Folder preview is only a prototyping escape hatch.

1. Write or generate standard BeadsForm JSON. The attach command accepts a direct form object, an array of forms, `{ "forms": [...] }`, or `{ "beadForms": { "forms": [...] } }`.
2. Attach it to the bead from the repo that owns the bead:

   ```sh
   beads-form attach --bead <bead-id> --file form.json
   beads-form attach --bead <bead-id> --stdin < form.json
   beads-form attach --bead <bead-id> --json '{"format":"standard",...}'

   npm run beads-form -- attach --bead <bead-id> --file form.json
   npm run beads-form -- attach --bead <bead-id> --stdin < form.json
   npm run beads-form -- attach --bead <bead-id> --json '{"format":"standard",...}'
   ```

   `npm run beads-form -- ...` remains supported, but agent shells in the VD runtime should have the stable `beads-form` command on `PATH` next to `vibe-agent`.

   Use `--dir <repo>` when not running from the bead repo, `--origin <origin>` to print full URLs, and `--workspace <workspace-id>` when `VK_WORKSPACE_ID` is unavailable. Explicit `--origin` has highest precedence. To avoid repeatedly passing it, set `BEADS_FORM_ORIGIN`/`VD_BEADS_FORM_ORIGIN`, or seed `${XDG_CONFIG_HOME:-~/.config}/vibe-dashboard/beads-form.json` with:

   ```json
   { "origin": "https://your-vd-origin.example" }
   ```

   Do not hardcode `jamtools.dev`; use the active deployment origin. Duplicate form ids on the bead are errors by default. Local folder-relative media refs are rejected in bead-backed attach; keep local media in folder preview until bead-backed media policy is designed.

3. Give the human the printed `/dashboard/forms?...` URL.

4. After submission, read handoff output with the read-only show command:

   ```sh
   beads-form show --bead <bead-id>
   beads-form show --bead <bead-id> --form <form-id>
   beads-form show --bead <bead-id> --include-html

   npm run beads-form -- show --bead <bead-id>
   npm run beads-form -- show --bead <bead-id> --form <form-id>
   npm run beads-form -- show --bead <bead-id> --include-html
   ```

   `show` prints JSON by default, includes all responses, auto-selects the form if the bead has exactly one form, includes semantic questions/descriptions and media refs as text, and omits compiled HTML unless `--include-html` is passed. If there are no responses yet, it still prints the questions and `noResponses: true`.

Bead-backed storage remains preferred for real workflow state and durable responses. Folder preview is for prototyping and quick review loops.

## Escape hatch

If the standard helpers are not expressive enough, generate raw HTML only as a fallback. Keep the same naming conventions and provide a complete `controls[]` manifest, because submissions are validated by HTML `name`.
