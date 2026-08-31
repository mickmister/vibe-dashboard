# BeadsForm agent onboarding

Use BeadsForm when you need structured answers from a human before proceeding. Prefer bead-backed forms for real workflow.

## 1. Draft standard form JSON inline

Write standard BeadsForm JSON. Use the standard DSL, not raw HTML. The default bead-backed workflow is **inline JSON via stdin** so agents do not need to create a temporary `form.json` file first. Use a file only when the form is large enough that audit/debuggability matters.

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
Persisted bead metadata stores standard DSL-only form definitions in `metadata.beadForms.forms[]`; responses are stored separately in `metadata.beadFormResponses.responsesByFormId[formId]` so multi-form beads have more room under the Dolt TEXT-column limit. The tool strips stale generated `html`/`controls` from valid standard forms, rejects raw/custom HTML forms, joins definitions/responses at runtime for show/render, compacts older inline responses during mutations, and preflights metadata size before updating a bead.

In the VD Docker/dev runtime, `beads-form` should be available on `PATH` globally and should work from any bead repo directory.

The command prints URLs. Provide the remote one to the user, and use explicit markdown link syntax when doing so.

## 3. Collaborate on one canonical form

Prefer one canonical form when several agents need the same human decision. The
orchestrator or first form author creates the bead and attaches the initial
form, then other agents append focused questions to that same form. This keeps
the human in one flow and usually avoids needing a separate aggregate URL.

### Form creator / orchestrator flow

1. Create or choose the bead that owns the decision.
2. Attach a standard form with a stable, memorable `id`.
3. Share the form id, bead id, and repo dir with teammates who should add
   questions.
4. Tell question adders to append dedicated questions instead of creating
   separate forms unless there is a specific reason to keep responses separate.

Example creator handoff:

```text
Canonical form:
- repo dir: /path/to/repo
- bead: beads-web-123
- form: release_readiness
- URL: https://jamtools.dev/dashboard/forms?dir=...&bead=beads-web-123&form=release_readiness

Please append any review concerns as focused questions with:
beads-form append-questions --dir /path/to/repo --bead beads-web-123 --form release_readiness --stdin
```

The creator should make the starter form self-contained: include the goal,
known decisions, enough context for later agents, and an `additional_notes`
textarea. Do not leave important review context only in the conversation.

### Question-adder / reviewer flow

When another agent, reviewer, or UX specialist has more concerns, mutate the
same canonical bead-backed form with focused new questions instead of creating a
pile of disconnected forms:

```bash
beads-form append-questions \
  --dir <repo-dir> \
  --bead <bead-id> \
  --form <form-id> \
  --stdin <<'JSON'
{
  "operation": "append_questions",
  "questions": [
    {
      "type": "textarea",
      "id": "review_blocker_context",
      "title": "What should we do about the review blocker?",
      "description": "Include the exact reviewer concern, why it matters, and the options/tradeoffs the user should decide."
    }
  ]
}
JSON
```

Accepted append input shapes are a direct question array, `{ "questions": [...] }`, or `{ "operation": "append_questions", "questions": [...] }`. Use `--after-question <question-id>` when the new question belongs after a specific existing question. Use `--base-hash <hash>` only when coordinating with another agent and you want the update to fail if the form definition changed first. The command rejects full forms, raw/custom HTML, generated `html`/`controls`, duplicate question ids, unknown operations, and empty question arrays. Existing responses are preserved; if responses already exist, remember that older responses will not answer the newly appended questions.

Question adders should:

- Read the current form first when possible:

  ```bash
  beads-form show --bead <bead-id> --form <form-id> --dir <repo-dir>
  ```

- Add one coherent review concern per question. Do not append a large
  unstructured review blob.
- Include attribution in the question description, for example
  `Source: review2 blocker on 2026-08-31`.
- Preserve concrete pros, cons, risks, suggested fixes, and non-blocking notes
  in the question or choice descriptions.
- Use stable question ids that include the topic, not the agent name alone.
- Prefer appending to the canonical form over making a new form. Create a
  separate form only when the response must remain separate or the creator asks
  for separate source forms.

### When to use aggregate forms instead

If teammates already created separate forms, or separate responses must remain
separate, build an aggregate URL instead of copying questions by hand. Aggregate
forms are useful for collecting existing independent forms into one view, while
canonical `append-questions` is better for building one shared decision form
before the human answers.

## 4. Share the URL with the human

Send the direct form URL and ask them to submit. After submission:

- Read/process the copied BeadsForm XML handoff. It is the default human/agent handoff format so Markdown-heavy answers stay readable; internal bead storage still preserves structured normalized JSON.
- Remove `needs-agent-review` from the bead after processing, if present.
- When messaging another agent about the response, include:
  - the raw DSL JSON,
  - the raw BeadsForm XML handoff,
  - `Please use 'vibe-agent full_summary' to catch up.`

If multiple agents created separate forms and the user should answer them from one page, use the aggregate route with repeated direct refs:

```text
/dashboard/forms/aggregate?dir=/repo-a&bead=repo-a-123&form=review_a&dir=/repo-b&bead=repo-b-456&form=review_b
```

Each grouped section submits independently back to its source bead/form. This is safer than combining responses into a new schema and avoids question-id collisions between forms.

Aggregate URL params must be ordered as exact repeated `dir`, then `bead`, then `form` triplets. Do not group all `dir` params first or add unrelated query params to aggregate URLs; malformed ordering is rejected so refs cannot be silently misaligned.

## 5. Inspect attached forms/responses

```bash
beads-form show --bead <bead-id> --dir <repo-dir>
```

`show` outputs JSON by default with semantic questions/descriptions, media refs as text, and all responses. It does not support `--include-html` because generated HTML/controls are no longer persisted.

## 6. Find pending forms across repos

```bash
beads-form pending --parent-dir ~/repos
beads-form pending --parent-dir ~/repos --limit 80 --origin https://your-vd-origin.example
```

`pending` outputs JSON by default for agent use. It scans first-level child directories only, prefilters to repos with a local `.beads` folder, uses read-only `bd list --has-metadata-key beadFormsSummary` queries, avoids bulk `bd show`, and returns direct `/dashboard/forms?dir=...&bead=...&form=...` links for each pending form.

The VD pending Forms page defaults to `~/repos`; server operators can set `BEADS_FORM_PENDING_PARENT_DIR` to point at a different parent directory. Pending queue results are also persisted to a local server cache so stale data can render immediately after stable-server restarts while the server refreshes in the background.

VD also has an in-process Springboard pending queue sentinel for realtime-ish updates. Successful bead-backed form submits handled by VD invalidate the BeadsForm read cache and touch the sentinel; `/dashboard/forms` keeps the current/cached list visible and refreshes fresh pending data in the background when the sentinel changes. External CLI attach/update commands run outside the VD server process and cannot reliably touch that in-memory sentinel, so those changes are repaired by the XDG disk cache plus the pending page's background fresh refresh when opened or reloaded.
