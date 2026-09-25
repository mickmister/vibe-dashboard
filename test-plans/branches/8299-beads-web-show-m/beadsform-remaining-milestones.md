# BeadsForm remaining milestone test plan

Branch: `vk/8299-beads-web-show-m`

This plan covers the remaining BeadsForm branch work after the approved/tested
core slices: DSL-only/split storage, selected URL scan avoidance, pending queue
cache/sentinel, single-question refresh preservation, submit success/copy,
review-before-submit, choice defaults, grouped checkbox choices, and CLI/show
hardening.

Use this document as the user-story and acceptance source for the remaining
milestones. Each milestone should follow the established branch workflow:

1. Map the selected bead scope to the user stories and test cases below.
2. Implement the smallest mergeable slice.
3. Send to review2 and loop until approved.
4. Send to independent tester and loop until approved.
5. Move to the next milestone without waiting for additional human go-ahead,
   unless the selected work asks for weekly-dev merge, branch deletion,
   workspace close, or other explicitly gated operations.

For queue/discovery tests, use disposable sandbox repos and an env-controlled
parent directory. Do not scan or mutate real `~/repos` during automated tests.

## M0 — Branch cleanup and merge-readiness bookkeeping

### Beads in scope

- `beads-web-6gx — Decide next BeadsForm milestone details`
- `beads-web-89t — Decide next BeadsForm implementation milestone`
- `beads-web-c1l — Decide unaddressed BeadsForm papercuts`
- `beads-web-r28 — Decide BeadsForm next steps after centering feedback`
- `beads-web-nv8 — Decide BeadsForm next polish after example workflow`
- `beads-web-xkp — Decide next BeadsForm milestone and inline CLI ergonomics`
- `beads-web-41z — Decide BeadsForm storage and notification gates`

### User story

As the branch owner, I can understand what is already approved, what remains
open, and which decision beads have been superseded, so the branch can proceed
toward merge without stale planning noise.

### Test and acceptance steps

- `TEST_CASE_REMAINING_M0A — stale decision bead audit`
  - Run `bd list --status open` and inspect the decision beads listed above.
  - Expected: each stale decision bead is either kept with a current reason or
    closed with a reason naming the successor implementation/review/test beads.

- `TEST_CASE_REMAINING_M0B — approval evidence summary`
  - Produce a branch status note/report listing approved and tester-approved
    BeadsForm slices.
  - Expected: the report includes bead ids/titles, commit ids where known, and
    validation evidence for storage, URL fast path, pending sentinel, wizard
    preservation, submit success, review step, defaults, grouped choices, and
    CLI/show hardening.

- `TEST_CASE_REMAINING_M0C — permission gate check`
  - Verify no weekly-dev merge, branch deletion, or workspace close is performed
    without explicit human authorization.
  - Expected: branch cleanup can update/close beads and produce reports, but
    merge/destructive actions remain gated.

- `TEST_CASE_REMAINING_M0D — repo cleanliness check`
  - Run `git status --short --branch` in both `beads-web` and
    `vibe-kanban-vscode-web`.
  - Expected: only intentional doc/bead metadata changes are present; no
    untracked sandbox artifacts are outside ignored generated directories.

## M1 — Core form readability and top-of-form UX

### Beads in scope

- `beads-web-2ib — Fix BeadsForm header Markdown hierarchy and description readability`
- `beads-web-9k3 — Polish BeadsForm page header and all-forms navigation layout`
- `beads-web-1q3 — Minimize BeadsForm page top chrome with details and add-notes toggle`
- `beads-web-daj — Remove redundant optional textarea from Additional notes section`
- `beads-web-dfe — Improve Forms tab pending list item styling`

### User story

As a form respondent, the top of a form is readable and compact: Markdown has a
clear visual hierarchy, duplicated bead/form descriptions are removed, long
context is summarized with a useful peek, and I can reach the first question
quickly.

### Test and acceptance steps

- `TEST_CASE_REMAINING_M1A — Markdown hierarchy`
  - Open a standard form whose title/description contains headings, paragraphs,
    bold text, inline code, links, and multiple paragraphs.
  - Expected: Markdown renders as styled HTML with visible hierarchy; raw
    Markdown markers such as `**bold**` and heading markers are not shown as
    plain text.

- `TEST_CASE_REMAINING_M1B — duplicate header reduction`
  - Open a bead-backed form whose bead title/description and form
    title/description are similar.
  - Expected: the page does not show two large repeated title/description blocks
    before the first question. Outer chrome is minimal and the form context is
    presented once in the most useful location.

- `TEST_CASE_REMAINING_M1C — description peek and show more`
  - Open a form with a long description.
  - Expected: the collapsed state shows a concise peek plus a clearly labeled
    Show more control. Expanding reveals readable paragraphs without making the
    preview text feel duplicated or unlabelled. Collapse/expand is accessible.

- `TEST_CASE_REMAINING_M1D — first question reachability`
  - Test desktop and mobile viewports.
  - Expected: the first question is reachable quickly without scrolling through
    a full page of context; no sticky/header element covers the active question.

- `TEST_CASE_REMAINING_M1E — Additional Notes single box`
  - Open a form with global Additional Notes.
  - Expected: the Additional Notes section has one textarea only and does not
    render a redundant “Optional context” box below itself.

- `TEST_CASE_REMAINING_M1F — pending list readability`
  - Open `/dashboard/forms` with multiple pending forms from sandbox data.
  - Expected: entries are visually separated as a list/cards with clear
    indicators, not a wall of unstyled text.

## M2 — Wizard and mobile interaction polish

### Beads in scope

- `beads-web-vx9 — Improve BeadsForm wizard keyboard and mobile navigation`
- `beads-web-7wq — Make BeadsForm wizard step sequencer sticky above question count`
- `beads-web-czy — Improve BeadsForm optimistic submit UI`
- `beads-web-tvs — Investigate Agent plus BeadsForms split view`
- `beads-web-5w6 — Test single-question BeadsForm flow before next milestone`

### User story

As a form respondent, I can move through a form comfortably with keyboard or
mobile controls, without losing draft answers, seeing all questions at once, or
getting trapped in awkward scroll positions.

### Test and acceptance steps

- `TEST_CASE_REMAINING_M2A — left/right question navigation`
  - Focus the page body and press right/left arrow keys.
  - Expected: right moves to the next valid question/review step and left moves
    back. The behavior does not trigger while typing inside text inputs or
    textareas.

- `TEST_CASE_REMAINING_M2B — checkbox-focused navigation`
  - Focus a checkbox and use the configured next/previous navigation.
  - Expected: navigation works as designed without toggling unintended choices
    or losing checkbox state.

- `TEST_CASE_REMAINING_M2C — mobile sticky footer`
  - Test a narrow mobile viewport with long choices.
  - Expected: previous/next actions are available in a single sticky footer,
    respect safe-area insets, and do not obscure the active answer controls.

- `TEST_CASE_REMAINING_M2D — optimistic submit state`
  - Simulate slow submit persistence.
  - Expected: a centered submitting/success flow appears immediately where
    appropriate, the active form does not flash all questions, and normalized
    JSON copy/manual fallback remains available.

- `TEST_CASE_REMAINING_M2E — Agent + Forms split view investigation`
  - Try to open Agent and Forms side-by-side through the intended workspace UI.
  - Expected: either the split view works with documented steps, or the
    investigation identifies the blocking route/layout issue and creates a
    follow-up with reproduction steps.

- `TEST_CASE_REMAINING_M2F — no all-question regression`
  - Run focused wizard tests around refresh, review, submit, and aggregate forms.
  - Expected: standard forms never show all questions during active filling,
    refresh, review, or post-submit success.

## M3 — Pending forms discovery and inbox polish

### Beads in scope

- `beads-web-xq5 — Sort/filter pending BeadsForms queue`
- `beads-web-nwj — Show branch and VK workspace context on pending BeadsForms`
- `beads-web-p8c — Evaluate BeadsForm repo lookup by bead prefix`
- `beads-web-0xn — Harden BeadsForm direct dir repo detection for worktree/shared .beads layouts`

### User story

As a user with many workspaces/repos, I can use `/dashboard/forms` as an inbox:
pending forms are fast, sorted usefully, filterable, and clearly labelled by
repo, branch, workspace, bead, and form.

### Test and acceptance steps

- `TEST_CASE_REMAINING_M3A — sort by recency`
  - Seed sandbox repos with pending forms with varied bead updated/created
    timestamps.
  - Expected: default ordering is most-recent first, with stable tie-breaking.

- `TEST_CASE_REMAINING_M3B — filter by repo/workspace/bead`
  - Apply repo, workspace, and bead query/filter controls where implemented.
  - Expected: the queue narrows predictably, deep links preserve filter state,
    and clearing filters restores the full cached result.

- `TEST_CASE_REMAINING_M3C — context labels`
  - Inspect pending entries from multiple sandbox repos/workspaces.
  - Expected: each entry shows enough context to decide whether to open it:
    repo, branch if available, workspace if available, bead id/title, form title,
    and pending/updated status.

- `TEST_CASE_REMAINING_M3D — worktree/shared `.beads` detection`
  - Test normal repos, git worktrees, shared `.beads` layouts, and invalid dirs.
  - Expected: valid forms load through the direct path when possible; invalid
    dirs fail clearly without broad scans or mutation.

- `TEST_CASE_REMAINING_M3E — no slow scan regression`
  - Instrument or mock pending queue loading.
  - Expected: discovery still uses `.beads` prefilter, bounded concurrency,
    `beadFormsSummary` only, durable XDG cache, and no bulk `bd show`.

## M4 — Notifications and agent handoff

### Beads in scope

- `beads-web-mlk — Add user notification command for BeadsForm links`
- `beads-web-rwu — Notify creating session on BeadsForm submission`
- `beads-web-cfo — Investigate vibe-agent full_summary timeout`
- `beads-web-8fp — Update agent skill guidance for human-readable workspace context`
- `beads-web-akg — Recommend file-plus-pipe workflow in BeadsForm skill`
- `beads-web-1wq — Support stdin piping for vibe-agent send messages`
- `beads-web-cmf.4.7.3 — Document beads-form show handoff workflow`

### User story

As an agent or orchestrator, I can notify the human about forms without duplicate
pings, and when a form is submitted the creating session can receive or discover
the answer with enough context to continue.

### Test and acceptance steps

- `TEST_CASE_REMAINING_M4A — notify-user single form`
  - Trigger the proposed notification command/flag for one form.
  - Expected: the user receives one clear notification containing a direct form
    URL and concise context. Duplicate notification prevention is documented or
    implemented.

- `TEST_CASE_REMAINING_M4B — collective/append notification policy`
  - Append questions to an existing/canonical form or create aggregate links.
  - Expected: the workflow avoids repeated user pings for every append while
    still ensuring the initial/collective form is noticed.

- `TEST_CASE_REMAINING_M4C — submit notifies creator`
  - Submit a bead-backed form with `VK_SESSION_ID` metadata.
  - Expected: after successful persistence, the creating session is notified or
    a documented fallback (`needs-agent-review`, show handoff, pending queue)
    is used. Notification failures are warning-only and do not undo saved
    responses.

- `TEST_CASE_REMAINING_M4D — full_summary timeout investigation`
  - Reproduce the observed `vibe-agent full_summary` timeout on representative
    sessions.
  - Expected: root cause or bounded mitigation is documented, with tests/logs
    where practical.

- `TEST_CASE_REMAINING_M4E — handoff docs`
  - Read `beads-form show` and skill/onboarding docs.
  - Expected: docs explain JSON-first show output, split responses, no
    `--include-html`, raw HTML rejection, and how agents should use file/pipe
    workflows without losing context.

## M5 — Rich authoring, attachments, and DSL evolution

### Beads in scope

- `beads-web-qoj — Add pros and cons to BeadsForm choices`
- `beads-web-gd5 — Add optional pros and cons fields for BeadsForm choices`
- `beads-web-8yk — Support BeadsForm attachments for markdown, media, and code snippet permalinks`
- `beads-web-cmf.4.3 — Define bead-backed BeadsForm media reference policy`
- `beads-web-lix — Let users ask an agent to clarify BeadsForm questions in-place`
- `beads-web-qam — Add BeadsForm feature feedback area`

### User story

As a form author, I can provide rich context inside the form itself: pros/cons,
markdown/media attachments, code snippets with source metadata, and eventually a
way for users to ask for clarification without leaving the form.

### Test and acceptance steps

- `TEST_CASE_REMAINING_M5A — pros and cons on choices`
  - Author choices with zero, pros-only, cons-only, and pros-and-cons examples.
  - Expected: the DSL validates them, `beads-form show` preserves them, and the
    UI renders them in a readable layout without bloating submitted answers.

- `TEST_CASE_REMAINING_M5B — markdown attachment input`
  - Attach a markdown file or markdown content block according to the selected
    policy.
  - Expected: safe Markdown renders with hierarchy, raw HTML is escaped or
    sanitized, and semantic metadata is preserved without generated HTML.

- `TEST_CASE_REMAINING_M5C — image/video attachment input`
  - Attach image/video refs in folder preview and bead-backed mode.
  - Expected: supported refs render accessibly; unsafe/local refs are rejected
    or routed only through the approved safe media policy.

- `TEST_CASE_REMAINING_M5D — code snippet permalink`
  - Attach a code snippet reference with file path, commit hash, start line, and
    end line.
  - Expected: the UI shows a readable code block with file/commit/line metadata,
    and show output preserves the semantic reference.

- `TEST_CASE_REMAINING_M5E — in-form clarification request`
  - From a confusing question, ask an agent to clarify/flesh out the question.
  - Expected: the form shows a working/loading state, the agent response updates
    the question in place or produces a clear reviewable change, and user draft
    answers are preserved.

- `TEST_CASE_REMAINING_M5F — feature feedback persistence`
  - Submit BeadsForm-feature feedback.
  - Expected: feedback is append-only, stored in the approved server-side
    location, and path/symlink safety tests prevent arbitrary writes.

## M6 — Enjoyment, warmth, and visual polish

### Beads in scope

- `beads-web-lcs — Show confetti on BeadsForm submit`
- `beads-web-mag — Add optional BeadsForm encouragement messages`
- `beads-web-w3s — Add warmer BeadsForm theme using HeroUI tokens`
- `beads-web-8my — Use HeroUI throughout BeadsForm UI`
- `beads-web-t84 — Adopt HeroUI components in BeadsForm pages`

### User story

As a respondent, completing forms feels rewarding and humane rather than bleak:
success is celebrated, encouragement is optional/non-intrusive, and the visual
system feels consistent with the rest of VD.

### Test and acceptance steps

- `TEST_CASE_REMAINING_M6A — confetti success only`
  - Submit successfully, then trigger validation and backend failure scenarios.
  - Expected: confetti appears only after successful persistence/accepted preview
    submit, never on errors, and never blocks clipboard/manual copy or return
    flow.

- `TEST_CASE_REMAINING_M6B — reduced motion`
  - Enable `prefers-reduced-motion`.
  - Expected: confetti/animations are disabled or reduced, with no layout or
    submit behavior regression.

- `TEST_CASE_REMAINING_M6C — encouragement messages`
  - Enable/disable optional encouragement messages on short and long forms.
  - Expected: messages are positive but not distracting, accessible to screen
    readers, and do not affect normalized response JSON.

- `TEST_CASE_REMAINING_M6D — warm theme contrast`
  - Inspect light/dark themes with long forms, errors, review step, and success.
  - Expected: warmer HeroUI-token-based surfaces meet contrast expectations and
    preserve focus states.

- `TEST_CASE_REMAINING_M6E — HeroUI component regression`
  - Replace/adopt HeroUI components in targeted areas.
  - Expected: semantics, keyboard behavior, form submission, and generated
    standard-form HTML interactions remain intact.

## M7 — Packaging and standalone tooling

### Beads in scope

- `beads-web-cmf — Package BeadsForm feature as standalone Springboard app`
- `beads-web-biu — Plan standalone bead form UI and helper CLI`
- `beads-web-dle — Try example bead-backed BeadsForm workflow`
- `beads-web-szd — Verify global beads-form attach flow`
- `beads-web-6j0 — Decide shared preview print-only fix`
- `beads-web-d9s — Add vibe-agent worktree helper with copy-on-write includes`

### User story

As a developer or agent, I can use BeadsForm reliably outside this one branch:
through global CLI workflows, standalone UI packaging, repeatable examples, and
test-friendly worktree tooling.

### Test and acceptance steps

- `TEST_CASE_REMAINING_M7A — standalone package plan`
  - Review standalone app/helper CLI design.
  - Expected: boundaries are clear: what remains VD-specific, what is packaged,
    and what dependencies/runtime paths are required.

- `TEST_CASE_REMAINING_M7B — global CLI attach flow`
  - Run the globally installed `beads-form` attach/show/pending commands from a
    representative repo.
  - Expected: commands resolve dependencies, produce correct URLs, and preserve
    DSL-only/split-response behavior.

- `TEST_CASE_REMAINING_M7C — example workflow`
  - Execute the documented example bead-backed form workflow end-to-end in a
    disposable repo.
  - Expected: attach, open, fill, submit, show, and agent handoff all work with
    no hidden manual steps.

- `TEST_CASE_REMAINING_M7D — shared preview print-only`
  - Exercise shared preview printing/output mode.
  - Expected: it prints correct URLs/instructions without unwanted side effects.

- `TEST_CASE_REMAINING_M7E — worktree helper`
  - Run the proposed worktree helper with copy-on-write includes such as
    `node_modules,.cache`.
  - Expected: it creates `../<repo>-<feature-name>` safely, copies requested
    folders without corrupting the source worktree, and documents cleanup.

## M8 — Performance profiling and optional follow-ups

### Beads in scope

- `beads-web-051 — Profile BeadsForm submit bd update latency`

### User story

As a user, form submission latency is understandable and, where practical,
reduced without risking metadata correctness or partial writes.

### Test and acceptance steps

- `TEST_CASE_REMAINING_M8A — latency instrumentation`
  - Measure read, metadata update, label update, and notification timings in
    disposable or safe representative repos.
  - Expected: results identify which operations dominate submit latency without
    mutating production/user beads.

- `TEST_CASE_REMAINING_M8B — safe optimization decision`
  - Evaluate combining writes, changing bd APIs, or adding telemetry.
  - Expected: recommendation includes correctness risks, rollback strategy, and
    whether the improvement belongs on this branch or a follow-up.

- `TEST_CASE_REMAINING_M8C — no partial-write regression`
  - Simulate failures during submit/update operations.
  - Expected: user answers remain visible/copyable, persisted responses are not
    lost, and the UI never reports a hard failure after a response was already
    saved unless the message is explicitly warning-only.
