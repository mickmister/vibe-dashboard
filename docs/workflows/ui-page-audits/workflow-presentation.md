# `/dashboard/workflows/:instanceId` — workflow run presentation

## Current role

Clean read-only story page for a workflow instance. Shows status, human status, provenance, at-a-glance summary, task/bead context, original task, attention state, child workflow call tree, outputs/artifacts, and a timeline of what was sent/received by each role.

## UX issues

- **It is a strong “what happened” page, but weaker as a “what do I do now?” page.** Attention states show the need but rarely include a direct action button.
- **Timeline text can dominate the page.** Large raw prompts/responses in cards can bury outcomes and decisions.
- **“What was sent / What came back” is helpful but not enough for review.** Users often need diffs, verdicts, unresolved questions, and artifacts before raw text.
- **Truncated content only says how many chars are shown.** It needs a way to open the source session, fetch full content if allowed, or explain refs-only constraints.
- **Child workflow call tree is presented as another section, not integrated into narrative.** Parent/child relationships need clearer nesting and breadcrumbs.
- **Refresh is manual.** A workflow story page should auto-update while active and show freshness.
- **Status terminology may be mismatched.** Workflow status and human status pills can conflict or require interpretation.

## Potential improvements

- Add a prominent next-action banner with CTA: open form, open waiting session, retry, acknowledge completion, or copy summary.
- Summarize each turn first: role, decision, result, artifacts, then allow expanding raw prompt/response.
- Add “review mode” with only important changes, blockers, outputs, and linked commits.
- Add auto-refresh while running/waiting, with “Live / paused” controls.
- Add breadcrumbs back to Workflows, batch/meta-run parent, and source workspace.
- Provide full-content handling: open source session, copy ref, or request expansion when safe.
