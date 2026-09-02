# BeadsForm upcoming milestones detailed test plan

Branch: `vk/8299-beads-web-show-m`

Workspace: `beads-web — Show metadata forms`

This plan expands the remaining BeadsForm milestone queue with user stories,
fixtures, deterministic acceptance steps, review focus, and tester validation
commands. It is intentionally written at a similar level of detail to
`beadsform-milestones.md` so implementers, reviewers, and independent testers
can run each milestone without needing extra conversation context.

## Process for every milestone

1. Implement the smallest coherent slice for the milestone.
2. Keep the previous approved guarantees intact:
   - standard forms never expose all questions during active filling, refresh,
     review, submit, or edit-response mode;
   - submitted values remain visible/copyable after successful submit;
   - local drafts win over background refresh;
   - bead-backed metadata remains DSL-only with split responses;
   - pending queue reads avoid bulk `bd show` and real-`~/repos` scans in tests.
3. Request review2. Fix blockers until review2 approves.
4. Request independent tester. Fix blockers until tester approves.
5. Close the milestone beads and tester bead with explicit close reasons.
6. Move to the next milestone autonomously unless the next action is weekly-dev
   merge, branch deletion, or workspace close.

## Common fixture setup

Use local/sandbox fixtures. Do not mutate real user beads or scan real
`~/repos` in automated tests.

Recommended commands:

```sh
# From vibe-kanban-vscode-web
npm run beads-form:sandbox-repos -- --parent-dir "$PWD/.vk-mocked-sandbox/beads-form-sandbox-repos" --reset

# Use the printed parent dir for pending queue tests.
export BEADS_FORM_PENDING_PARENT_DIR="$PWD/.vk-mocked-sandbox/beads-form-sandbox-repos"
```

For browser-visible work, use the existing preview server if it is already
running on port `55123`, or start it only when needed:

```sh
npm run dev:beads-form-preview -- --folder /tmp/beads-form-preview --host http://localhost:55123 --port 55123 --server-port 55124
```

Prefer URLs with the public tunnel when sharing:

```text
https://port-55123.jamtools.dev/dashboard/forms/preview?folder=<encoded-folder>
```

## M1 — Core readability and top-of-form UX

### Beads in scope

- `beads-web-2ib — Fix BeadsForm header Markdown hierarchy and description readability`
- `beads-web-9k3 — Polish BeadsForm page header and all-forms navigation layout`
- `beads-web-1q3 — Minimize BeadsForm page top chrome with details and add-notes toggle`
- `beads-web-daj — Remove redundant optional textarea from Additional notes section`
- `beads-web-dfe — Improve Forms tab pending list item styling`

### User stories

- As a first-time form respondent, I can understand the form title, goal, and
  context without reading duplicated wall-of-text headers.
- As a mobile respondent, I can reach the first question quickly without
  scrolling past repeated descriptions.
- As a respondent reading Markdown-authored context, I see real hierarchy:
  headings, paragraphs, emphasis, code, and links are styled and readable.
- As a user browsing `/dashboard/forms`, pending entries look like distinct
  items rather than an unstyled blob.

### Fixture requirements

Create or use a form with:

- a long bead title and description;
- a form title similar to the bead title;
- a long form description with Markdown headings, paragraphs, `code`,
  `**bold**`, links, and lists;
- global Additional Notes enabled;
- at least three questions so the first-question scroll position matters.

For pending-list styling, seed at least three pending forms from two repos using
the sandbox harness.

### Test cases

- `TEST_CASE_REMAINING_M1A — Markdown hierarchy`
  - Open the fixture form in folder preview and/or bead-backed mode.
  - Expected:
    - Markdown markers are not visible as raw syntax.
    - Headings are visually distinct from paragraphs.
    - Inline code has code styling.
    - Links are visually recognizable and sanitized.
    - Raw HTML remains escaped/safe.

- `TEST_CASE_REMAINING_M1B — duplicate chrome reduction`
  - Compare the top page chrome and inner form header.
  - Expected:
    - The same long description is not repeated in both outer page chrome and
      the form host.
    - The bead-level context remains available through a compact/details affordance.
    - The form-level title/goal/context remains visible enough to orient the user.

- `TEST_CASE_REMAINING_M1C — description peek`
  - Open a form with a long description.
  - Expected:
    - Default state shows title, goal, and a concise peek of the description.
    - Show more/Show less is clearly labelled.
    - Expanded state uses readable paragraphs/hierarchy.
    - Collapsed and expanded states are keyboard accessible.

- `TEST_CASE_REMAINING_M1D — first-question reachability`
  - Test desktop and a narrow mobile viewport.
  - Expected:
    - The first question appears near the initial viewport or after a short,
      reasonable scroll.
    - No sticky/header element hides the question legend or first answer.

- `TEST_CASE_REMAINING_M1E — Additional Notes single textarea`
  - Navigate to the global Additional Notes section.
  - Expected:
    - There is one textarea for Additional Notes.
    - There is no nested or redundant “Optional context” textarea below it.
    - Submitted normalized JSON still includes additional notes when filled.

- `TEST_CASE_REMAINING_M1F — pending list readability`
  - Open `/dashboard/forms` against sandbox pending data.
  - Expected:
    - Each pending form is visually separated as a list/card row.
    - Items include at least form title and bead/repo context where available.
    - Empty state remains helpful and uncluttered.

### Suggested automated validation

```sh
npm test -- src/lib/beadsFormSingleQuestion.test.ts src/lib/beadsFormSubmitSuccess.test.ts src/lib/beadsFormSubmissionUi.test.ts src/styles.test.ts src/modules/BeadsFormModule.pending.test.ts
npm run check-types
npm run build
git diff --check
```

### Manual/browser validation

- Use a mobile/narrow viewport.
- Open one long-description form.
- Confirm first question reachability.
- Confirm no all-question mode appears while navigating.
- Capture before/after screenshots if the visual hierarchy changed materially.

## M2 — Wizard and mobile interaction polish

### Beads in scope

- `beads-web-vx9 — Improve BeadsForm wizard keyboard and mobile navigation`
- `beads-web-7wq — Make BeadsForm wizard step sequencer sticky above question count`
- `beads-web-czy — Improve BeadsForm optimistic submit UI`
- `beads-web-tvs — Investigate Agent plus BeadsForms split view`
- `beads-web-5w6 — Test single-question BeadsForm flow before next milestone`

### User stories

- As a keyboard user, I can move between questions with left/right arrows when
  not typing in text fields.
- As a mobile user, previous/next controls are always reachable and never cover
  the active input.
- As a returning respondent, edit-response mode keeps wizard navigation working
  and preserves my submitted values.
- As a split-view user, I can understand whether Agent + Forms can be used
  side-by-side and what blocks it if not.

### Fixture requirements

Use a form with:

- at least four questions;
- checkbox choices;
- text input and textarea questions;
- review-before-submit enabled through standard wizard behavior;
- one previously submitted response for edit-response testing.

### Test cases

- `TEST_CASE_REMAINING_M2A — body-level arrow navigation`
  - Focus non-input page content and press right/left arrows.
  - Expected: navigation moves forward/backward through the wizard.

- `TEST_CASE_REMAINING_M2B — text entry protection`
  - Focus a text input or textarea and press arrow keys.
  - Expected: cursor movement/text editing works normally; question navigation
    does not steal the event.

- `TEST_CASE_REMAINING_M2C — checkbox-focused behavior`
  - Focus a checkbox and use the intended navigation gesture/key.
  - Expected: behavior matches the product decision; choices are not toggled
    unexpectedly and wizard state remains valid.

- `TEST_CASE_REMAINING_M2D — mobile sticky footer`
  - Test a narrow mobile viewport with long choices and notes.
  - Expected:
    - Previous/Next controls are reachable in a single mobile-safe footer.
    - Safe-area padding is respected.
    - Controls do not obscure answer fields.

- `TEST_CASE_REMAINING_M2E — optimistic submit transition`
  - Simulate slow submit action.
  - Expected:
    - A centered submitting state appears.
    - Form does not flash all questions.
    - Success/copy state appears immediately after persistence.
    - Clipboard failure path remains non-blocking and manual-copy remains visible.

- `TEST_CASE_REMAINING_M2F — Agent + Forms split investigation`
  - Try to open a form alongside an agent conversation.
  - Expected: either the split layout works, or a clear blocking issue with
    reproduction steps and follow-up bead is produced.

### Suggested automated validation

```sh
npm test -- src/lib/beadsFormSingleQuestion.test.ts src/lib/beadsFormRefreshState.test.ts src/lib/beadsFormSubmitSuccess.test.ts src/modules/BeadsFormModule.editResponse.test.ts src/styles.test.ts
npm run check-types
npm run build
git diff --check
```

### Manual/browser validation

- Narrow mobile viewport for sticky footer.
- Keyboard-only navigation pass.
- Edit-response mode from a submitted form URL.

## M3 — Pending forms discovery and inbox polish

### Beads in scope

- `beads-web-xq5 — Sort/filter pending BeadsForms queue`
- `beads-web-nwj — Show branch and VK workspace context on pending BeadsForms`
- `beads-web-p8c — Evaluate BeadsForm repo lookup by bead prefix`
- `beads-web-0xn — Harden BeadsForm direct dir repo detection for worktree/shared .beads layouts`

### User stories

- As a user with many repos, I can open `/dashboard/forms` and see the most
  relevant pending forms first.
- As a user, I can filter or scope pending forms by repo, workspace, or bead
  when there are many results.
- As a user, each pending entry tells me where it came from: repo, branch,
  workspace, bead, and form.
- As a link recipient, selected/direct form URLs work for normal repos and
  worktree/shared `.beads` layouts.

### Fixture requirements

Use sandbox repos with:

- at least three repos;
- at least five pending forms;
- at least one submitted-only repo;
- different bead updated/created timestamps;
- varied repo names, branch names, workspace IDs, bead IDs, and form titles.

### Test cases

- `TEST_CASE_REMAINING_M3A — default most-recent sort`
  - Load pending queue with varied timestamps.
  - Expected: most recently updated/created forms appear first with stable
    tie-breaking.

- `TEST_CASE_REMAINING_M3B — filter by repo`
  - Apply a repo filter.
  - Expected: only matching repo entries appear and the URL/state reflects the
    filter where appropriate.

- `TEST_CASE_REMAINING_M3C — filter by workspace/bead`
  - Apply workspace and bead filters.
  - Expected: queue narrows predictably; invalid filters show a useful empty state.

- `TEST_CASE_REMAINING_M3D — context display`
  - Inspect each queue entry.
  - Expected: repo, branch when known, workspace when known, bead id/title, form
    title, and age/status are visible without opening the form.

- `TEST_CASE_REMAINING_M3E — worktree/shared .beads`
  - Use direct URLs for normal repos and worktrees/shared bead layouts.
  - Expected: direct loading works where valid, rejects invalid dirs clearly, and
    does not introduce broad scans.

- `TEST_CASE_REMAINING_M3F — scan guarantee regression`
  - Mock/instrument queue loading.
  - Expected: `.beads` prefilter, bounded concurrency, `beadFormsSummary` only,
    XDG cache, no recursive scans, and no bulk `bd show`.

### Suggested automated validation

```sh
npm test -- src/lib/beadsClient.node.test.ts src/lib/beadsFormPendingQueueCache.node.test.ts src/lib/beadsFormPendingQueueSentinel.test.ts src/modules/BeadsFormModule.pending.test.ts scripts/beads-form/sandbox-repos.test.ts
npm run check-types
npm run build
git diff --check
```

### Manual/browser validation

- Open `/dashboard/forms` with sandbox parent configured.
- Confirm filters/sort are comprehensible and do not expose skipped repo noise.

## M4 — Notifications and agent handoff

### Beads in scope

- `beads-web-mlk — Add user notification command for BeadsForm links`
- `beads-web-rwu — Notify creating session on BeadsForm submission`
- `beads-web-cfo — Investigate vibe-agent full_summary timeout`
- `beads-web-8fp — Update agent skill guidance for human-readable workspace context`
- `beads-web-akg — Recommend file-plus-pipe workflow in BeadsForm skill`
- `beads-web-1wq — Support stdin piping for vibe-agent send messages`
- `beads-web-cmf.4.7.3 — Document beads-form show handoff workflow`

### User stories

- As an agent, I can notify the user once when a form is ready without spamming
  them for every append/collective update.
- As the creating agent/session, I can receive or discover submitted answers
  after successful persistence.
- As an agent using long prompts/forms, I can pipe content through files/stdin
  instead of fragile shell quoting.
- As an agent recovering context, I can use `beads-form show` handoff output
  without relying on `full_summary`.

### Fixture requirements

Use a bead-backed standard form with:

- `VK_SESSION_ID` metadata where notification can be tested/mocked;
- at least one response;
- enough question/context text to exercise long handoff output.

### Test cases

- `TEST_CASE_REMAINING_M4A — notify-user single form`
  - Trigger the proposed notify command/flag for one form.
  - Expected: one notification with direct URL, form title/goal, bead id/title,
    and no duplicate sends on rerun unless explicitly forced.

- `TEST_CASE_REMAINING_M4B — collective/append notification policy`
  - Append questions to a canonical form after initial notification.
  - Expected: appends avoid duplicate user pings by default, while still keeping
    the form discoverable through queue/show.

- `TEST_CASE_REMAINING_M4C — submit notifies creating session`
  - Submit a form with creating-session metadata.
  - Expected: notification happens after successful persistence; failure is
    warning-only and does not roll back the saved response.

- `TEST_CASE_REMAINING_M4D — stdin/file workflow`
  - Pipe a long message or JSON payload into the relevant command.
  - Expected: payload is preserved exactly and shell quoting is not required.

- `TEST_CASE_REMAINING_M4E — full_summary timeout mitigation`
  - Reproduce or simulate timeout-prone summary/handoff.
  - Expected: root cause or fallback is documented; `beads-form show` workflow is
    enough for form handoff when summary is unavailable.

- `TEST_CASE_REMAINING_M4F — show handoff docs`
  - Follow the docs from scratch.
  - Expected: docs explain DSL-only show output, split responses, no
    `--include-html`, raw HTML rejection, and exact commands.

### Suggested automated validation

```sh
npm test -- scripts/beads-form/cli.test.ts src/lib/beadsFormCore.test.ts src/lib/beadsClient.node.test.ts
npm run check-types
npm run build
git diff --check
```

Notification transport may require mocks if a real external service is not
available.

## M5 — Rich authoring, attachments, and DSL evolution

### Beads in scope

- `beads-web-qoj — Add pros and cons to BeadsForm choices`
- `beads-web-gd5 — Add optional pros and cons fields for BeadsForm choices`
- `beads-web-8yk — Support BeadsForm attachments for markdown, media, and code snippet permalinks`
- `beads-web-cmf.4.3 — Define bead-backed BeadsForm media reference policy`
- `beads-web-lix — Let users ask an agent to clarify BeadsForm questions in-place`
- `beads-web-qam — Add BeadsForm feature feedback area`

### User stories

- As a form author, I can include pros/cons and tradeoffs directly on choices so
  the form is the source of truth.
- As a form author, I can attach Markdown, images/videos, and code snippets as
  semantic content without storing generated HTML.
- As a respondent, I can ask for clarification in the form and keep my draft
  answers while the agent updates the question.
- As a product owner, I can collect BeadsForm feature feedback separately from
  bead responses.

### Fixture requirements

Use forms with:

- choices containing no pros/cons, pros only, cons only, and both;
- media gallery refs in folder preview;
- proposed bead-backed attachment refs;
- Markdown attachment content with headings/code/links;
- code snippet refs with file path, commit hash, start/end lines.

### Test cases

- `TEST_CASE_REMAINING_M5A — choice pros/cons data model`
  - Author all pros/cons variants.
  - Expected: validation accepts valid arrays, rejects malformed data, and show
    output preserves semantic fields.

- `TEST_CASE_REMAINING_M5B — pros/cons rendering`
  - Open a form with pros/cons-rich choices.
  - Expected: layout is readable, not overwhelming, and distinct from
    Recommended/Default badges.

- `TEST_CASE_REMAINING_M5C — markdown attachment`
  - Add a Markdown content block/ref.
  - Expected: safe Markdown hierarchy renders; raw HTML is escaped/sanitized;
    generated HTML is not persisted.

- `TEST_CASE_REMAINING_M5D — image/video attachment`
  - Use folder-preview media and any implemented bead-backed media policy.
  - Expected: supported refs render, unsafe refs are rejected, and server routes
    prevent path traversal/symlink escape.

- `TEST_CASE_REMAINING_M5E — code snippet permalink`
  - Add a code snippet ref with file path, commit hash, and line range.
  - Expected: UI shows a readable code block with source metadata and show output
    preserves the semantic ref.

- `TEST_CASE_REMAINING_M5F — in-form clarification`
  - Ask an agent to clarify a confusing question.
  - Expected: loading state appears, draft answers remain, updated question is
    applied or shown for review, and no all-question mode appears.

- `TEST_CASE_REMAINING_M5G — feature feedback persistence`
  - Submit BeadsForm-feature feedback.
  - Expected: append-only safe persistence in approved location; symlink/path
    safety tests prevent arbitrary writes.

### Suggested automated validation

```sh
pnpm --filter @vibe-dashboard/beads-form test
npm test -- src/lib/beadsFormCore.test.ts src/lib/beadsFormPreviewMedia.test.ts src/server/beads-form-media-routes.test.ts scripts/beads-form/cli.test.ts
npm run check-types
npm run build
git diff --check
```

Browser validation is required for any new attachment/card/code rendering.

## M6 — Enjoyment, warmth, and visual polish

### Beads in scope

- `beads-web-lcs — Show confetti on BeadsForm submit`
- `beads-web-mag — Add optional BeadsForm encouragement messages`
- `beads-web-w3s — Add warmer BeadsForm theme using HeroUI tokens`
- `beads-web-8my — Use HeroUI throughout BeadsForm UI`
- `beads-web-t84 — Adopt HeroUI components in BeadsForm pages`

### User stories

- As a respondent, successful completion feels rewarding.
- As a respondent with reduced-motion preferences, celebratory effects do not
  cause discomfort.
- As a user in dark mode, BeadsForm surfaces feel warm and polished rather than
  bleak or generic.
- As a reviewer, visual polish does not regress form semantics, keyboard use, or
  submit correctness.

### Fixture requirements

Use one short form and one long form, each with:

- standard choices;
- text/textarea;
- review-before-submit;
- submit success/copy;
- validation failure path.

### Test cases

- `TEST_CASE_REMAINING_M6A — confetti success only`
  - Submit successfully, trigger validation error, and simulate backend failure.
  - Expected: confetti appears only after successful accepted submit.

- `TEST_CASE_REMAINING_M6B — reduced motion`
  - Enable `prefers-reduced-motion`.
  - Expected: confetti/animations are disabled or reduced; success state remains
    clear.

- `TEST_CASE_REMAINING_M6C — encouragement messages`
  - Enable/disable encouragement messages on short and long forms.
  - Expected: messages are optional, non-blocking, screen-reader friendly, and do
    not alter normalized JSON.

- `TEST_CASE_REMAINING_M6D — warm theme contrast`
  - Inspect light/dark states, focus rings, errors, review step, and success.
  - Expected: contrast is acceptable and HeroUI token usage is consistent.

- `TEST_CASE_REMAINING_M6E — component semantics`
  - Replace/adopt HeroUI components where planned.
  - Expected: native form behavior, labels, keyboard navigation, validation, and
    submit values remain intact.

### Suggested automated validation

```sh
npm test -- src/lib/beadsFormSubmitSuccess.test.ts src/lib/beadsFormSingleQuestion.test.ts src/styles.test.ts src/modules/BeadsFormModule.pending.test.ts
npm run check-types
npm run build
git diff --check
```

Manual visual/browser validation should include reduced-motion and mobile.

## M7 — Packaging and standalone tooling

### Beads in scope

- `beads-web-cmf — Package BeadsForm feature as standalone Springboard app`
- `beads-web-biu — Plan standalone bead form UI and helper CLI`
- `beads-web-dle — Try example bead-backed BeadsForm workflow`
- `beads-web-szd — Verify global beads-form attach flow`
- `beads-web-6j0 — Decide shared preview print-only fix`
- `beads-web-d9s — Add vibe-agent worktree helper with copy-on-write includes`

### User stories

- As a developer, I can use the BeadsForm feature through a predictable
  packaged/standalone surface rather than a branch-specific implementation.
- As an agent, I can run the global `beads-form` command from representative
  repos and trust that attach/show/pending behavior matches the branch runtime.
- As a tester, I can run an end-to-end example workflow in a disposable repo.
- As a developer creating worktrees, I can create feature worktrees with copied
  heavy folders such as `node_modules` or `.cache` without corrupting the source
  worktree.

### Fixture requirements

Use:

- one disposable bead-enabled repo with at least one pending form;
- one form JSON with choices, text, review step, submit success, and show output;
- one generated worktree target directory outside the source repo;
- a global `beads-form` binary if available in the test environment.

### Test cases

- `TEST_CASE_REMAINING_M7A — standalone package boundary`
  - Review or implement the standalone app/helper design.
  - Expected: the plan states what is VD-specific, what is package-owned, how
    runtime assets are found, and what commands are supported.

- `TEST_CASE_REMAINING_M7B — example bead-backed workflow`
  - In a disposable repo, attach a form, open/fill/submit it, then run
    `beads-form show`.
  - Expected: attach prints a usable URL, submit persists a split response, and
    show returns DSL-only semantic output with responses.

- `TEST_CASE_REMAINING_M7C — global beads-form attach/show`
  - Run global `beads-form attach` and `beads-form show` from a representative
    repo.
  - Expected: global command resolves correctly, does not require repo-local
    `dist`, and preserves DSL-only/split-response behavior.

- `TEST_CASE_REMAINING_M7D — shared preview print-only`
  - Run shared preview helper in print-only mode.
  - Expected: it prints correct preview URL/instructions and does not start or
    kill unrelated servers.

- `TEST_CASE_REMAINING_M7E — worktree helper copy-on-write includes`
  - Run the proposed worktree helper with includes such as `node_modules,.cache`
    against disposable or safe fixtures.
  - Expected: target worktree path is `../<repo>-<feature-name>`, requested
    folders are copied or copy-on-write copied safely, and cleanup guidance is
    documented.

### Suggested automated validation

```sh
npm test -- scripts/beads-form/cli.test.ts scripts/beads-form/shared-preview.test.ts scripts/beads-form/sandbox-repos.test.ts
npm run check-types
npm run build
git diff --check
```

Worktree helper tests should avoid destructive operations and must not run
against non-disposable target directories.

## M8 — Performance profiling and optional follow-ups

### Beads in scope

- `beads-web-051 — Profile BeadsForm submit bd update latency`

### User stories

- As a respondent, BeadsForm submit latency is understandable and, where safe,
  reduced.
- As an implementer, I can identify whether latency comes from reads, metadata
  writes, label updates, notifications, or UI transitions.
- As a reviewer, I can see that any performance optimization preserves the
  no-partial-write and no-all-questions guarantees.

### Fixture requirements

Use disposable or explicitly safe representative repos only. Do not mutate real
user/production beads during profiling.

Seed:

- one small form;
- one large but valid DSL-only form;
- one form with existing split responses;
- one failure/mocked-update path.

### Test cases

- `TEST_CASE_REMAINING_M8A — latency measurement`
  - Measure targeted bead read, metadata update, add-label/update-label, queue
    invalidation, and optional notification timings.
  - Expected: timings are recorded with enough detail to identify the dominant
    operation.

- `TEST_CASE_REMAINING_M8B — safe optimization proposal`
  - Evaluate candidate optimizations such as combining writes, changing bd APIs,
    adding timing telemetry, or deferring non-critical operations.
  - Expected: recommendation includes correctness risks, rollback plan, and
    whether the change belongs on this branch or a follow-up.

- `TEST_CASE_REMAINING_M8C — no partial failure regression`
  - Simulate failures after response persistence and before optional metadata or
    notification writes.
  - Expected: saved responses remain saved, the UI does not report a hard
    failure after persistence unless it is explicitly warning-only, and copied
    normalized JSON remains available.

- `TEST_CASE_REMAINING_M8D — no UI regression under latency`
  - Inject slow submit/read actions in tests or manual smoke.
  - Expected: centered submitting/success states remain clear, no all-question
    flash appears, and edit-response mode still works after submit.

### Suggested automated validation

```sh
npm test -- src/lib/beadsClient.node.test.ts src/lib/beadsFormCore.test.ts src/lib/beadsFormSubmitSuccess.test.ts src/lib/beadsFormRefreshState.test.ts
npm run check-types
npm run build
git diff --check
```

Manual profiling notes should include command versions, repo fixture names,
sample counts, and whether commands were read-only or mutating.
