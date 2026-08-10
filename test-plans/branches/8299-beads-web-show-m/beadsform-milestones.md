# BeadsForm M0–M6 implementation and testing map

This plan follows the onboarding guidance from the mocked VK sandbox branch:
write the user story, keep acceptance steps deterministic, prefer focused tests,
and use Playwright/manual sandbox evidence for browser-visible flows.

## M0 — Storage, compatibility, and sandbox harness

User story: as an implementer or tester, I can exercise BeadsForm storage and
discovery against disposable sample repos without scanning or mutating real
`~/repos`.

Acceptance:

- `TEST_CASE_M0A`: selected direct/workspace forms that are standard DSL with
  stale generated fields load without raw-HTML errors.
- `TEST_CASE_M0B`: append/mutation paths compact stored forms to DSL-only.
- `TEST_CASE_M0C`: `npm run beads-form:sandbox-repos -- --parent-dir <tmp>`
  creates first-level sample repos and prints `BEADS_FORM_PENDING_PARENT_DIR`.
- `TEST_CASE_M0D`: pending queue tests point at the disposable parent and do not
  scan real `~/repos`.

## M1 — Critical loading/navigation correctness

User story: as a form respondent, I can open any valid direct/workspace/aggregate
form URL, navigate questions, submit once, and remain in the wizard with my
answers visible.

Acceptance:

- `TEST_CASE_M1A`: direct and workspace URLs load selected forms without broad
  workspace scans.
- `TEST_CASE_M1B`: wizard URL params restore the active question.
- `TEST_CASE_M1C`: submit shows a centered submitting state and returns to the
  same wizard page locked with submitted values.

## M2 — Form-page UX polish

User story: as a form respondent, the page is readable, centered, mobile-safe,
and does not expose clutter while I answer.

Acceptance:

- `TEST_CASE_M2A`: desktop gutters are balanced and content is not too narrow.
- `TEST_CASE_M2B`: Additional Notes and Question X of Y appear above the active
  question.
- `TEST_CASE_M2C`: compact more-info controls preserve and reveal saved context.

## M3 — Pending/forms discovery realtime and polish

User story: as a user, I can quickly see pending forms across repos, even on
cold startup, with stale cached data shown immediately and fresh refresh handled
quietly.

Acceptance:

- `TEST_CASE_M3A`: pending queue uses `BEADS_FORM_PENDING_PARENT_DIR` when set.
- `TEST_CASE_M3B`: disk cache is served immediately when available.
- `TEST_CASE_M3C`: refresh is background/subtle and never bulk `bd show`s.
- `TEST_CASE_M3D`: only repos/forms with pending summary data are shown.

## M4 — Authoring and agent handoff ergonomics

User story: as collaborating agents, we can safely append/update canonical form
questions and hand off source-of-truth questions/answers without duplicating
context in chat.

Acceptance:

- `TEST_CASE_M4A`: append commands reject generated fields in new questions.
- `TEST_CASE_M4B`: show output includes semantic DSL and responses.
- `TEST_CASE_M4C`: collaborative edits preserve existing questions, responses,
  and summaries.

## M5 — DSL evolution

User story: as a form author, I can express richer decision questions, including
pros/cons, checkbox-only semantics, and ordered-list decisions, without raw HTML.

Acceptance:

- `TEST_CASE_M5A`: new DSL fields compile, render, normalize, and show.
- `TEST_CASE_M5B`: validation and local draft/submitted restore work in
  single-question mode.
- `TEST_CASE_M5C`: unsupported raw/custom HTML remains rejected.

## M6 — Visual and theming delight

User story: as a user filling difficult forms, the UI feels encouraging and less
depressing in dark mode.

Acceptance:

- `TEST_CASE_M6A`: forms support non-bland theme/color treatments without
  harming contrast.
- `TEST_CASE_M6B`: optional encouragement/affirmation feature can be toggled.
- `TEST_CASE_M6C`: BeadsForm feature feedback is persisted in the hardcoded
  safe feedback directory.
