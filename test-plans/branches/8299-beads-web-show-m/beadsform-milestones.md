# BeadsForm M0–M6 implementation and testing map

This plan follows the onboarding guidance from the mocked VK sandbox branch:
write user stories first, keep acceptance steps deterministic, prefer focused
tests for pure logic, and use Playwright CLI/manual sandbox evidence for
browser-visible flows.

The milestones are intended to run in order. For each milestone:

1. Use this document as the user-story and acceptance source of truth.
2. Implement the milestone.
3. Request review and loop until approved.
4. Run tester validation and loop until approved.
5. Move to the next milestone without waiting for more human confirmation.

For BeadsForm queue/discovery tests, do not scan or mutate real `~/repos`.
Use `beads-web-utl — Add sandboxed BeadsForm test repo harness` to create a
generated gitignored disposable repo parent, export the printed
`BEADS_FORM_PENDING_PARENT_DIR`, and clean up/reset through the harness.

## M0 — Storage, compatibility, and sandbox harness

### Beads in scope

- `beads-web-a3e — Design lean DSL-only BeadsForm metadata storage`
- `beads-web-fb7 — Make BeadsForm storage resilient to metadata limits`
- `beads-web-btv — Design scalable BeadsForm metadata storage layout`
- `beads-web-utl — Add sandboxed BeadsForm test repo harness`
- `beads-web-4fi — Add M0-M6 BeadsForm milestone test plans`

### User story

As an implementer or tester, I can exercise BeadsForm storage and discovery
against disposable sample repos without scanning or mutating real `~/repos`, and
legacy standard DSL forms still work while generated/stale HTML is ignored.

### Acceptance and tests

- `TEST_CASE_M0A — beads-web-a3e legacy read compatibility`
  - Selected direct/workspace forms that are `format: "standard"` with
    `questions[]`, missing `goal`, and stale generated `html` / `controls` load
    without raw-HTML errors.
  - Expected: the runtime compiles from DSL, strips/ignores generated fields, and
    synthesizes a fallback goal from the title.

- `TEST_CASE_M0B — beads-web-a3e append/mutation compatibility`
  - Run `beads-form append-questions` against a stored legacy standard form with
    missing `goal` and stale `html` / `controls`.
  - Expected: appended questions are saved, old responses are preserved,
    generated fields are not persisted, and `beadFormsSummary` is recomputed.

- `TEST_CASE_M0C — beads-web-a3e raw HTML rejection`
  - Attempt to load/attach/mutate a true raw HTML-only form with no standard DSL
    `questions[]`.
  - Expected: it fails with the raw/custom HTML unsupported message and performs
    no mutation.

- `TEST_CASE_M0D — beads-web-utl disposable repo harness`
  - Run `npm run beads-form:sandbox-repos -- --parent-dir <generated-gitignored-dir>`.
  - Expected: it creates deterministic first-level sample repos, initializes
    beads data, seeds lean DSL-only pending and submitted BeadsForms, and prints
    `BEADS_FORM_PENDING_PARENT_DIR=<generated-gitignored-dir>`.

- `TEST_CASE_M0E — beads-web-utl sample-data matrix`
  - Inspect seeded data from the harness.
  - Expected: sample data includes, within practical limits, pending forms,
    submitted forms, multiple repos, at least one repo without pending forms, and
    enough varied bead/form titles/descriptions to exercise list rendering.

- `TEST_CASE_M0F — beads-web-utl cleanup safety error test`
  - Attempt reset/cleanup against an arbitrary directory outside the harness
    ownership marker.
  - Expected: the command refuses to delete it and reports a clear safety error.

- `TEST_CASE_M0G — beads-web-fb7 / beads-web-btv storage design gate`
  - Review the selected storage layout plan.
  - Expected: it documents exact metadata keys, read/write paths for attach,
    submit, show, append-questions, aggregate, and pending queue, and how
    metadata-limit failures preserve user answers.

## M1 — Critical loading/navigation correctness

### Beads in scope

- `beads-web-zvv — Avoid workspace scans for selected BeadsForm URLs`
- `beads-web-0xn — Harden BeadsForm direct dir repo detection for worktree/shared .beads layouts`
- `beads-web-uov — Ensure BeadsForm submit auto-copies normalized JSON`
- `beads-web-cmf.4.4 — Harden BeadsForm metadata mutation tests`
- `beads-web-cmf.4.4.1 — Delegate BeadsForm metadata mutation test review`
- `beads-web-cmf.4.7.2 — Test read-only beads-form show handoff output`

### User story

As a form respondent, I can open any valid direct/workspace/aggregate form URL,
navigate questions, submit once, get a copied/visible normalized answer summary,
and remain in the wizard with my answers visible.

### Acceptance and tests

- `TEST_CASE_M1A — beads-web-zvv selected workspace URL`
  - Open a workspace URL with `workspace`, `bead`, and `form` query params.
  - Expected: the selected bead/form is loaded through the targeted path and does
    not trigger a broad workspace scan.

- `TEST_CASE_M1B — beads-web-0xn direct dir repo detection`
  - Open direct `dir=<repo>&bead=<id>&form=<id>` URLs for normal repos and
    worktree/shared `.beads` layouts.
  - Expected: valid repos load; invalid dirs fail with a clear non-mutating
    error.

- `TEST_CASE_M1C — wizard URL restore`
  - Navigate to question 2+, reload, and use browser back/forward.
  - Expected: the active question restores correctly and no hidden invalid
    question causes browser validation errors.

- `TEST_CASE_M1D — beads-web-uov submit copy`
  - Submit a bead-backed form.
  - Expected: normalized JSON is copied or an explicit copy fallback is shown;
    the UI does not silently lose the response.

- `TEST_CASE_M1E — submit failure error test`
  - Simulate a backend/`bd update` failure during submit.
  - Expected: answers remain visible, the form stays in wizard mode, and the user
    has a recoverable copy path.

- `TEST_CASE_M1F — beads-web-cmf.4.7.2 show handoff`
  - Run `beads-form show` on a form with DSL, goal, responses, and no generated
    fields.
  - Expected: output includes semantic DSL and responses, omits `html` /
    `controls`, and is suitable for agent handoff.

## M2 — Form-page UX polish

### Beads in scope

- `beads-web-1q3 — Minimize BeadsForm page top chrome with details and add-notes toggle`
- `beads-web-9k3 — Polish BeadsForm page header and all-forms navigation layout`
- `beads-web-dfe — Improve Forms tab pending list item styling`
- `beads-web-daj — Remove redundant optional textarea from Additional notes section`
- `beads-web-byl — Add BeadsForm review-before-submit summary`
- `beads-web-czy — Improve BeadsForm optimistic submit UI`
- `beads-web-vx9 — Improve BeadsForm wizard keyboard and mobile navigation`
- `beads-web-7wq — Make BeadsForm wizard step sequencer sticky above question count`

### User story

As a form respondent, the page is readable, centered, mobile-safe, and does not
expose duplicated or confusing chrome while I answer. Before choosing
`allow_code_file_changes`, I can quickly review what I answered and jump back to
edit.

### Acceptance and tests

- `TEST_CASE_M2A — beads-web-1q3 / beads-web-9k3 header cleanup`
  - Open a form with long bead title, long form title, Markdown description, and
    similar title/description text.
  - Expected: the top of the form is not duplicated, Markdown renders safely, and
    extra detail is behind details/show-more UI.

- `TEST_CASE_M2B — beads-web-daj global Additional Notes`
  - Open a form with global Additional Notes.
  - Expected: the global section has only one notes box and no extra
    `Optional context` textarea below itself.

- `TEST_CASE_M2C — beads-web-byl review-before-submit`
  - Fill multiple questions and reach the submit step.
  - Expected: a compact human-readable answer summary appears before submit, and
    each answer can be edited without losing draft state.

- `TEST_CASE_M2D — beads-web-czy optimistic submit`
  - Submit a form on slow network/backend.
  - Expected: a centered submitting state appears, raw all-question HTML does not
    flash, and submitted values remain visible/locked after success.

- `TEST_CASE_M2E — beads-web-vx9 keyboard/mobile navigation`
  - Use left/right arrows outside textboxes and focused checkbox controls; test
    mobile viewport.
  - Expected: keyboard navigation works without interfering with text entry, and
    mobile has a usable sticky previous/next footer.

- `TEST_CASE_M2F — mobile/header error test`
  - Test a small mobile viewport with long Markdown title/description and long
    choices.
  - Expected: no submit button is cut off, no header overlaps the active
    question, and step navigation remains visible.

## M3 — Pending/forms discovery realtime and polish

### Beads in scope

- `beads-web-3fi — Add realtime pending forms queue sentinel`
- `beads-web-9ow — Design efficient realtime BeadsForm pending queue`
- `beads-web-xq5 — Sort/filter pending BeadsForms queue`
- `beads-web-nwj — Show branch and VK workspace context on pending BeadsForms`

### User story

As a user, I can quickly see pending forms across repos, understand which repo,
branch, workspace, and bead each form belongs to, and see updates appear without
manual refresh.

### Acceptance and tests

- `TEST_CASE_M3A — beads-web-3fi realtime sentinel`
  - Attach or submit a form while the Forms tab is open.
  - Expected: the page observes a sentinel/update signal and refreshes or offers
    an update notice without manual reload.

- `TEST_CASE_M3B — beads-web-xq5 sort/filter`
  - Seed multiple disposable repos/forms with varied timestamps, repo names,
    workspace IDs, and bead IDs.
  - Expected: the list can be sorted/filtered and defaults to a useful
    most-recent view.

- `TEST_CASE_M3C — beads-web-nwj context display`
  - Open pending queue entries from the sandbox harness.
  - Expected: each entry clearly shows repo, branch, workspace context when
    available, bead id/title, and form title.

- `TEST_CASE_M3D — partial repo failure error test`
  - Seed one broken bead repo and one valid repo under the sandbox parent.
  - Expected: valid forms still display; broken repo details are hidden from
    normal users or shown only in a debug/details area.

- `TEST_CASE_M3E — cache miss/stale cache error test`
  - Clear cache, load queue, then load again with stale cache.
  - Expected: no-cache path shows centered loading; cached path renders
    immediately and refreshes quietly.

## M4 — Authoring and agent handoff ergonomics

### Beads in scope

- `beads-web-akg — Recommend file-plus-pipe workflow in BeadsForm skill`
- `beads-web-1wq — Support stdin piping for vibe-agent send messages`
- `beads-web-cmf.4.7.3 — Document beads-form show handoff workflow`
- `beads-web-mlk — Add user notification command for BeadsForm links`
- `beads-web-rwu — Notify creating session on BeadsForm submission`
- `beads-web-tvs — Investigate Agent plus BeadsForms split view`
- `beads-web-lix — Let users ask an agent to clarify BeadsForm questions in-place`

### User story

As collaborating agents and users, we can create, update, hand off, notify about,
and clarify forms without losing context or requiring brittle CLI escaping.

### Acceptance and tests

- `TEST_CASE_M4A — beads-web-akg file-plus-pipe workflow`
  - Follow the skill docs to author JSON in a file and pipe it to
    `beads-form attach` / mutation commands.
  - Expected: the workflow avoids shell escaping hazards and produces the
    expected form URL.

- `TEST_CASE_M4B — beads-web-1wq vibe-agent stdin`
  - Send a long structured message through stdin piping.
  - Expected: message content is preserved exactly and no shell quoting is
    required.

- `TEST_CASE_M4C — beads-web-mlk notify once`
  - Notify a user about a single or aggregate form.
  - Expected: one clear notification is sent with the form URL; append/collective
    workflows avoid duplicate pings.

- `TEST_CASE_M4D — beads-web-rwu submit-to-creator`
  - Submit a form with creating session metadata.
  - Expected: response details are sent best-effort to the creating session after
    persistence; failure does not lose the submitted response.

- `TEST_CASE_M4E — beads-web-tvs Agent + Forms split view`
  - Open agent chat and a BeadsForm side by side.
  - Expected: both remain usable and form drafts are preserved.

- `TEST_CASE_M4F — beads-web-lix clarify question in-place`
  - Click a per-question “ask agent to clarify” affordance.
  - Expected: the question shows a working state, the agent receives DSL/context,
    and the updated question can be applied without losing current answers.

## M5 — DSL evolution

### Beads in scope

- `beads-web-qoj — Add pros and cons to BeadsForm choices`
- `beads-web-gd5 — Add optional pros and cons fields for BeadsForm choices`
- `beads-web-ra9 — Add checkbox-only grouped choice semantics to BeadsForm DSL`
- ordered-list question type bead, if present in the current bead DB

### User story

As a form author, I can express richer decision questions, including pros/cons,
checkbox-only supplemental either/or groups, and ordered-list decisions, without
raw HTML.

### Acceptance and tests

- `TEST_CASE_M5A — beads-web-qoj / beads-web-gd5 pros and cons`
  - Author choices with `prosAndCons` containing zero or more pros and zero or
    more cons.
  - Expected: rendering is elegant, normalization/show output preserve semantic
    DSL, and empty pros/cons do not create awkward UI.

- `TEST_CASE_M5B — beads-web-ra9 checkbox-only grouped semantics`
  - Author a question with supplemental either/or group semantics while still
    using checkboxes through and through.
  - Expected: the UI communicates exclusivity/default-none semantics clearly
    without switching to radio controls unless explicitly designed.

- `TEST_CASE_M5C — ordered-list question`
  - Author an ordered-list/ranked decision question.
  - Expected: users can select and order items accessibly; submitted JSON
    preserves selected order.

- `TEST_CASE_M5D — DSL validation error tests`
  - Try duplicate ids, unknown fields that would persist generated HTML, empty
    item lists, and invalid answer shapes.
  - Expected: invalid inputs fail clearly with no mutation.

## M6 — Visual and theming delight

### Beads in scope

- `beads-web-8my — Use HeroUI throughout BeadsForm UI`
- `beads-web-t84 — Adopt HeroUI components in BeadsForm pages`
- `beads-web-w3s — Add warmer BeadsForm theme using HeroUI tokens`
- `beads-web-mag — Add optional BeadsForm encouragement messages`
- `beads-web-qam — Add BeadsForm feature feedback area`
- `beads-web-lcs — Show confetti on BeadsForm submit`

### User story

As a user filling difficult forms, the UI feels polished, legible, encouraging,
and consistent with the rest of the app without hurting accessibility.

### Acceptance and tests

- `TEST_CASE_M6A — beads-web-8my / beads-web-t84 HeroUI adoption`
  - Inspect major BeadsForm routes.
  - Expected: cards, buttons, loading states, toasts, and list items use
    consistent HeroUI/project styling.

- `TEST_CASE_M6B — beads-web-w3s theme contrast`
  - Test light/dark mode and mobile/desktop.
  - Expected: warmer theme treatment maintains contrast and readability.

- `TEST_CASE_M6C — beads-web-mag encouragement`
  - Enable optional encouragement messages.
  - Expected: messages are helpful, unobtrusive, and can be omitted/disabled.

- `TEST_CASE_M6D — beads-web-qam feedback area`
  - Submit BeadsForm feature feedback.
  - Expected: feedback writes to the designated safe location and surfaces a
    success/failure state.

- `TEST_CASE_M6E — beads-web-lcs confetti`
  - Submit a form successfully.
  - Expected: confetti appears only on success, respects reduced-motion, and does
    not interfere with locked submitted-state review.
