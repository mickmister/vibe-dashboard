# BeadsForm agent onboarding

Use BeadsForm when you need structured answers from a human before proceeding. Prefer bead-backed forms for real workflow.

## 1. Draft standard form JSON inline

Write standard BeadsForm JSON. Prefer the standard DSL, not raw HTML. The default bead-backed workflow is **inline JSON via stdin** so agents do not need to create a temporary `form.json` file first. Use a file only when the form is large enough that audit/debuggability matters.

Example JSON shape:

```json
{
  "format": "standard",
  "id": "implementation_questions",
  "goal": "Decide the next implementation step.",
  "title": "Implementation questions",
  "description": "Resolve **decisions** before code changes.",
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
- Every standard form must include a concise top-level `goal` field: one short sentence saying what the form is trying to get from the human.
- Treat form `title` and `description` as safe Markdown. Use Markdown for emphasis, lists/context paragraphs, `code`, and safe links; raw HTML is escaped. Long form descriptions are collapsed behind Show more, so include enough context without making the first question unusable.
- Treat the form as the source of truth for the thinking behind the discussion. If other agents or reviewers already gave pros, cons, risks, recommended fixes, or tradeoffs, carry those points into the form instead of summarizing them away.
- If review agents provide concerns, blockers, or non-blocking suggestions, parse each coherent item into its own dedicated question. Do not paste one huge unorganized review blob. Preserve exact wording, pros/cons, suggested fixes, and tradeoffs where practical, and explicitly label non-blocking items as non-blocking in the question description.
- For now, do not rely on automatic extraction tooling for other-agent messages. Use `vibe-agent full_summary` for context, then manually copy the important review/implementation text into dedicated questions so the form is self-contained.
- Please consider pros and cons for each open point, and include the pros/cons in the choice descriptions of the questions. *Be as detailed as possible.*
- Preserve exact wording for prior pros/cons or recommendation rationales when practical, especially when the human is deciding between named options. Add attribution/context in descriptions or choice text when it helps.
- Lean toward "explain more" over excessive brevity. A form should let the human understand the in-depth reasoning, assumptions, and forks in the road without rereading the whole conversation.
- Choice questions are always multi-select checkboxes in the current public DSL; do not add radio/single-select options.
- Choices may include `is_recommended_reason` when the agent recommends an option.
- Use `allowCodeFileChanges`; if the answer returns `allow_code_file_changes=false`, do not edit files—make another form or continue discussion.
- Keep `additional_notes` as the master notes field.

## 2. Attach the form to a bead with inline JSON

Create or choose a bead in the repo where the work belongs, then attach the form with `--stdin`:

```bash
MY_BEADS_DIR=$PWD/vibe-kanban-vscode-web # just an example
cd $MY_BEADS_DIR 
bd create "Decide implementation questions" --type task --priority 2

beads-form attach \
  --bead <bead-id> \
  --dir $MY_BEADS_DIR \
  --origin https://jamtools.dev \
  --stdin <<'JSON'
{
  "format": "standard",
  "id": "implementation_questions",
  "goal": "Decide the next implementation step.",
  "title": "Implementation questions",
  "description": "Resolve **decisions** before code changes.",
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

`beads-form attach` stamps non-empty `VK_WORKSPACE_ID` and `VK_SESSION_ID` values from the environment into bead metadata. Attach also maintains `metadata.beadFormsSummary` (`hasForms`, `hasPendingAnswer`, `pendingResponseCount`, `formIds`, `pendingFormIds`) so Forms can discover pending work efficiently without bulk `bd show` over every bead.

In the VD Docker/dev runtime, `beads-form` should be available on `PATH` globally and should work from any bead repo directory.

The command prints URLs. Provide the remote one to the user, and use explicit markdown link syntax when doing so.

## 3. Share the URL with the human

Send the direct form URL and ask them to submit. After submission:

- Read/process the normalized JSON answer.
- Remove `needs-agent-review` from the bead after processing, if present.
- When messaging another agent about the response, include:
  - the raw DSL JSON,
  - the raw normalized answers JSON,
  - `Please use 'vibe-agent full_summary' to catch up.`

## 4. Inspect attached forms/responses

```bash
beads-form show --bead <bead-id> --dir <repo-dir>
```

`show` outputs JSON by default. Use `--include-html` only when needed.

## 5. Find pending forms across repos

```bash
beads-form pending --parent-dir ~/repos
beads-form pending --parent-dir ~/repos --limit 80 --origin https://your-vd-origin.example
```

`pending` outputs JSON by default for agent use. It scans first-level child directories only, uses read-only `bd` list queries, avoids bulk `bd show`, includes skipped repo reasons, and returns direct `/dashboard/forms?dir=...&bead=...&form=...` links for each pending form.
