---
name: beads-form-authoring
description: Author bead-attached forms using the standard @vibe-dashboard/beads-form TypeScript helpers instead of hand-written HTML.
---

# Beads Form Authoring

Use this skill when an agent needs to ask a human structured questions through a bead form.

## Core rule

Use the standard JSON/helper format from `@vibe-dashboard/beads-form`. Do not hand-write raw HTML; bead-backed and preview flows support standard DSL forms only.

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
  goal: 'Decide how to unblock the implementation plan.',
  title: 'Planning Review',
  description: 'Questions to unblock the **implementation plan**.',
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
        {
          id: 'forms_tab',
          label: 'Open in a Forms tab',
          is_recommended_reason: 'This keeps form filling close to the craft context without splitting attention.',
        },
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
- Every standard form needs a concise top-level `goal`: one short sentence describing what the form is trying to get from the human.
- Form `title` and `description` are authored as safe Markdown. Use Markdown for emphasis, `code`, links, and enough context to make the form self-contained; raw HTML is escaped. Long form descriptions are truncated behind a Show more affordance.
- Treat the form as the source of truth for the thinking behind the discussion. If other agents or reviewers already provided pros, cons, risks, recommended fixes, or tradeoffs, include that substance in the form instead of forcing the human to reconstruct it from conversation history.
- When a review agent provides blockers, concerns, or non-blocking suggestions, create a dedicated question for each coherent review item. Do not paste one huge unorganized review blob. Preserve exact wording, pros/cons, suggested fixes, and tradeoffs where practical; explicitly call out when an item is non-blocking.
- There is no automatic review-message extraction tool yet. Use `vibe-agent full_summary` and manually copy the important review/implementation text into dedicated form questions.
- Preserve exact prior wording for pros/cons and recommendation rationales when practical, especially for decision choices. Prefer copying known good phrasing into `description` or `is_recommended_reason` over paraphrasing away nuance.
- Lean toward "explain more" rather than excessive brevity. The form should make the user informed about the in-depth assumptions, forks in the road, and consequences of each option.
- Choice questions are always rendered as checkboxes so humans can select more than one answer. Do not add single-select/radio configuration; single-select semantics need a separate future DSL addition.
- Per-choice textareas and per-question textareas are always included. Do not add note-inclusion flags.
- Standard forms include two submit actions by default: one that sets `allow_code_file_changes` to `true`, and one that sets it to `false`. If the normalized response has this field as `false`, do not edit code or files.
- Use `content: [buildMediaGallery(...)]` for local screenshot/video review blocks. Prefer folder-relative refs like `attachments/candidate-a.png` or attachment-style refs like `attachment://candidate-b.webm`.
- Use stable lowercase ids with letters, numbers, `_`, or `-`; start ids with a letter.
- Choice ids become submitted values.
- Question ids become submitted field names.
- The renderer generates accessible HTML and the validation controls manifest at runtime. Persisted bead metadata stores the standard DSL only; generated `html`, generated `controls`, raw/custom HTML forms, and source-message blobs are not stored.
- Add `is_recommended_reason: "..."` to choices the agent recommends; the UI emphasizes those options and renders the reason. Do not use a reason-less boolean recommendation marker.
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
     "goal": "Decide how to unblock the implementation plan.",
     "title": "Planning Review",
     "description": "Questions to unblock the **implementation plan**.",
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

   `npm run beads-form -- ...` remains supported, but VD Docker/dev runtimes install a stable `beads-form` command on `PATH` next to `vibe-agent`/`vk`. The global wrapper points at the seeded VD checkout with an absolute script path and preserves the caller's current working directory, so default `--dir` behavior still works from arbitrary bead repo directories.

   Use `--dir <repo>` when not running from the bead repo, `--origin <origin>` to print full URLs, `--workspace <workspace-id>` when `VK_WORKSPACE_ID` is unavailable, and `--session <session-id>` when `VK_SESSION_ID` is unavailable. `beads-form attach` stamps non-empty workspace/session values into bead metadata as `VK_WORKSPACE_ID` and `VK_SESSION_ID` so Forms can resolve workspace/session context even if the `bd` wrapper is bypassed. It also maintains `metadata.beadFormsSummary` with `hasForms`, `hasPendingAnswer`, `pendingResponseCount`, `formIds`, and `pendingFormIds` so workspace and pending queue pages can find form-bearing beads without bulk-loading every bead. Explicit `--origin` has highest precedence. To avoid repeatedly passing it, set `BEADS_FORM_ORIGIN`/`VD_BEADS_FORM_ORIGIN`, or seed `${XDG_CONFIG_HOME:-~/.config}/vibe-dashboard/beads-form.json` with:

   ```json
   { "origin": "https://your-vd-origin.example" }
   ```

   Do not hardcode `jamtools.dev`; use the active deployment origin. Duplicate form ids on the bead are errors by default. Local folder-relative media refs are rejected in bead-backed attach; keep local media in folder preview until bead-backed media policy is designed.

3. Give the human the printed `/dashboard/forms?...` URL.

4. If another agent needs to contribute to the same canonical form, append focused standard DSL questions instead of creating an uncoordinated duplicate form:

   ```sh
   beads-form append-questions --bead <bead-id> --form <form-id> --stdin <<'JSON'
   {
     "operation": "append_questions",
     "questions": [
       {
         "type": "choices",
         "id": "review_blocker_resolution",
         "title": "How should we handle the reviewer blocker?",
         "description": "Explain the exact blocker and tradeoffs here so the form stays self-contained.",
         "choices": [
           { "id": "fix_now", "label": "Fix now", "description": "Address before merging." },
           { "id": "split_followup", "label": "Split follow-up", "description": "Only use if the blocker is not merge-critical." }
         ]
       }
     ]
   }
   JSON
   ```

   Accepted append input shapes are a direct question array, `{ "questions": [...] }`, or `{ "operation": "append_questions", "questions": [...] }`. Use `--after-question <question-id>` to insert after a specific existing question and `--base-hash <hash>` when coordinating with another agent to fail fast if the form definition changed. The command rejects full forms, raw/custom HTML, generated `html`/`controls`, duplicate question ids, and unknown operations. It preserves existing responses, but older responses naturally will not contain answers for newly appended questions.

5. After submission, read handoff output with the read-only show command:

   ```sh
   beads-form show --bead <bead-id>
   beads-form show --bead <bead-id> --form <form-id>
   npm run beads-form -- show --bead <bead-id>
   npm run beads-form -- show --bead <bead-id> --form <form-id>
   ```

   `show` prints JSON by default, includes all responses, auto-selects the form if the bead has exactly one form, and includes semantic questions/descriptions and media refs as text. It does not output generated HTML/controls because bead metadata stores standard DSL only. If there are no responses yet, it still prints the questions and `noResponses: true`.

Bead-backed storage remains preferred for real workflow state and durable responses. Folder preview is for prototyping and quick review loops.

## Aggregate review URLs

When several agents create separate bead-backed forms and the human should review them from one artifact, build an aggregate URL with repeated direct refs:

```text
/dashboard/forms/aggregate?dir=/repo-a&bead=repo-a-123&form=review_a&dir=/repo-b&bead=repo-b-456&form=review_b
```

The route loads each direct `dir`/`bead`/`form` ref independently, renders one grouped section per source form, and submits each section back to its original bead/form. This keeps the normal per-form response model and avoids collisions when different forms reuse the same question ids. If one source form fails to load or submit, the aggregate page shows that source-specific error instead of claiming the whole aggregate succeeded. Use each section’s “Open alone” link when a user should focus on one source form.

Aggregate URL params must be ordered as exact repeated `dir`, then `bead`, then `form` triplets. Do not group all `dir` params first or append unrelated query params to the aggregate URL; malformed ordering is rejected so refs cannot be silently misaligned.

## Pending form queue

Open `/dashboard/forms` without query parameters to view the pending Bead-backed form queue. The queue scans a bounded set of first-level repos under `~/repos` using read-only `bd` commands, prefers the `beadFormsSummary` pending-answer index, falls back to legacy `beadForms` metadata when needed, lists forms with no responses, and provides direct fill-out links. Use the Refresh button after attaching forms or after a human submits. See `packages/beads-form/PENDING_QUEUE.md` for realtime/update tradeoffs and safety limits.

Agents can inspect the same pending queue from a shell with JSON output:

```sh
beads-form pending --parent-dir ~/repos
beads-form pending --parent-dir ~/repos --limit 80 --origin https://your-vd-origin.example

npm run beads-form -- pending --parent-dir ~/repos
```

The command scans only first-level child directories, uses read-only `bd list --json --all --limit 0 --has-metadata-key ...` queries, avoids bulk `bd show`, includes skipped repo reasons, and prints direct `/dashboard/forms?dir=...&bead=...&form=...` links. Use `--origin` or `BEADS_FORM_ORIGIN`/`VD_BEADS_FORM_ORIGIN` when a full URL is needed.

## Shared preview server maintenance

The shared BeadsForm preview server must run from a stable checkout, not from an ephemeral review/agent worktree. Review agents frequently delete or recreate paths under `/var/tmp/vibe-kanban/worktrees/...` and may relink `node_modules`; a long-running Vite server in those paths can then fail dynamic imports with errors such as `Cannot find module .../vite/dist/node/chunks/dist.js`.

Use the documented shared-preview command instead:

```sh
npm run dev:beads-form-preview:shared -- --host https://port-55123.jamtools.dev
```

Defaults:

- Stable checkout: `/var/tmp/beadsform-preview-stable/vibe-kanban-vscode-web`
- Branch: `vk/8299-beads-web-show-m`
- tmux session: `beadsform-shared-preview-55123`
- Preview folder: `/tmp/beads-form-preview`
- Parent-dir queue: `/var/tmp/vibe-kanban/worktrees`
- Log: `/tmp/beadsform-shared-preview-55123.log`

The command stops the tmux session, syncs the stable checkout to `origin/<branch>`, runs `pnpm install --frozen-lockfile`, and starts `npm run dev:beads-form-preview` with browser auto-reload disabled. Use `--print-only` to show the planned commands without changing the running server. Do not use or delete the stable checkout for review worktrees.
