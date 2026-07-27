# BeadsForm agent onboarding (branch `vk/8299-beads-web-show-m`)

Use BeadsForm when you need structured answers from a human before proceeding. Prefer bead-backed forms for real workflow; use folder preview only for quick local prototyping.

## 1. Start the preview/dev server

Run the preview/dev server inside `tmux` so it stays alive after your shell command exits. Use one shared server per workspace; do not start a separate preview server per agent.

From the VD worktree for this branch:

```bash
cd /var/tmp/vibe-kanban/worktrees/beadsform-next/vibe-kanban-vscode-web
pnpm install --frozen-lockfile   # only if node_modules is missing
mkdir -p /tmp/beads-form-preview
tmux new-session -d -s beadsform-shared-preview-55123 \
  'npm run dev:beads-form-preview -- --folder /tmp/beads-form-preview --port 55123 --server-port 55124 --host https://port-55123.jamtools.dev 2>&1 | tee /tmp/beadsform-shared-preview-55123.log'
```

The preview command disables browser auto-reload by default (`BEADS_FORM_DISABLE_HMR=1`) so code changes do not wipe active answers. Manual browser refresh still loads the latest code.

Shared URL base:

```txt
https://port-55123.jamtools.dev
```

Useful tmux/log commands:

```bash
tmux ls
tmux capture-pane -t beadsform-shared-preview-55123 -p -S -120
tail -80 /tmp/beadsform-shared-preview-55123.log
```

To restart the shared preview server after intentional server-side changes:

```bash
tmux kill-session -t beadsform-shared-preview-55123
cd /var/tmp/vibe-kanban/worktrees/beadsform-next/vibe-kanban-vscode-web
tmux new-session -d -s beadsform-shared-preview-55123 \
  'npm run dev:beads-form-preview -- --folder /tmp/beads-form-preview --port 55123 --server-port 55124 --host https://port-55123.jamtools.dev 2>&1 | tee /tmp/beadsform-shared-preview-55123.log'
```

## 2. Draft standard form JSON inline

Write standard BeadsForm JSON. Prefer the standard DSL, not raw HTML. The default bead-backed workflow is **inline JSON via stdin** so agents do not need to create a temporary `form.json` file first. Use a file only when the form is large enough that audit/debuggability matters.

Example JSON shape:

```json
{
  "format": "standard",
  "id": "implementation_questions",
  "title": "Implementation questions",
  "description": "Resolve decisions before code changes.",
  "allowCodeFileChanges": {
    "label": "Allow implementation after this response",
    "description": "Use allow-code only if the next agent may edit code/files.",
    "defaultChecked": false
  },
  "questions": [
    {
      "type": "choices",
      "id": "next_step",
      "title": "Next step",
      "description": "Choose the safest next step.",
      "choices": [
        {
          "id": "implement",
          "label": "Implement now",
          "description": "Proceed with code changes.",
          "is_recommended_reason": "This is the smallest merge-safe slice."
        },
        {
          "id": "ask_more",
          "label": "Ask more questions",
          "description": "Make another form before editing code."
        }
      ]
    },
    {
      "type": "textarea",
      "id": "additional_notes",
      "title": "Additional notes",
      "description": "Anything else the next agent should know?"
    }
  ]
}
```

Guidelines:
- Every question should have a clear title and description.
- Choices may include `is_recommended_reason` when the agent recommends an option. Do not use `recommended: true`; recommendations should always include the reason text.
- Use `allowCodeFileChanges`; if the answer returns `allow_code_file_changes=false`, do not edit files—make another form or continue discussion.
- Keep `additional_notes` as the master notes field.

## 3. Attach the form to a bead with inline JSON

Create or choose a bead in the repo where the work belongs, then attach the form with `--stdin`:

```bash
cd /var/tmp/vibe-kanban/worktrees/8299-beads-web-show-m/beads-web
bd create "Decide implementation questions" --type task --priority 2

cd /var/tmp/vibe-kanban/worktrees/beadsform-next/vibe-kanban-vscode-web
beads-form attach \
  --bead <bead-id> \
  --dir /var/tmp/vibe-kanban/worktrees/8299-beads-web-show-m/beads-web \
  --origin https://port-55123.jamtools.dev \
  --stdin <<'JSON'
{
  "format": "standard",
  "id": "implementation_questions",
  "title": "Implementation questions",
  "description": "Resolve decisions before code changes.",
  "allowCodeFileChanges": {
    "label": "Allow implementation after this response",
    "description": "Use allow-code only if the next agent may edit code/files.",
    "defaultChecked": false
  },
  "questions": [
    {
      "type": "textarea",
      "id": "additional_notes",
      "title": "Additional notes",
      "description": "Anything else the next agent should know?"
    }
  ]
}
JSON
```

For very small forms, `--json '<raw-json>'` also works. For large forms, `--file form.json` is still supported and can be easier to review/debug.

`beads-form attach` stamps non-empty `VK_WORKSPACE_ID` and `VK_SESSION_ID` values from the environment into bead metadata. If either environment variable is unavailable, pass `--workspace <workspace-id>` and/or `--session <session-id>` explicitly. This is defense in depth; the `bd` wrapper may also stamp the same metadata, but the form attach command should not rely on wrapper PATH ordering.

If `beads-form` is not on PATH yet, use the same inline flow through npm:

```bash
npm run beads-form -- attach -- --bead <bead-id> --dir <repo-dir> --origin https://port-55123.jamtools.dev --stdin <<'JSON'
{ "format": "standard", "id": "quick_question", "title": "Quick question", "questions": [] }
JSON
```

The command prints URLs. Prefer the direct `dir=` URL if the workspace URL does not resolve:

```txt
https://port-55123.jamtools.dev/dashboard/forms?dir=<encoded-repo-dir>&bead=<bead-id>&form=<form-id>
```

## 4. Share the URL with the human

Send the direct form URL and ask them to submit. After submission:

- Read/process the normalized JSON answer.
- Remove `needs-agent-review` from the bead after processing, if present.
- When messaging another agent about the response, include:
  - the raw DSL JSON,
  - the raw normalized answers JSON,
  - `Please use /home/vkuser/repos/project-manager/bin/vibe-agent full_summary to catch up.`

Do **not** tell agents to use `full_summary --all` unless there is a specific reason.

## 5. Inspect attached forms/responses

```bash
beads-form show --bead <bead-id> --dir <repo-dir>
```

Or with npm:

```bash
npm run beads-form -- show -- --bead <bead-id> --dir <repo-dir>
```

`show` outputs JSON by default. Use `--include-html` only when needed.

## 6. Folder preview escape hatch

For quick local-only testing without beads:

```bash
mkdir -p /tmp/beads-form-preview/my-form
cp form.json /tmp/beads-form-preview/my-form/form.json
```

Open:

```txt
https://port-55123.jamtools.dev/dashboard/forms/preview?folder=%2Ftmp%2Fbeads-form-preview%2Fmy-form&form=<form-id>
```

Folder preview is for prototyping. Bead-backed attach is the real workflow.
