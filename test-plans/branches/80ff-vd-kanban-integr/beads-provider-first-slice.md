# VD Kanban Integration — Beads provider first-slice test plan

This plan covers the approved first testing slice for:

- `vkvw-hifa.12 — Add Beads provider configurable workflow Kanban views`
- Branch: `vk/80ff-vd-kanban-integr`
- Workspace: `VD - Kanban Integration`
- Workspace URL: <https://jamtools.dev/workspaces/80ff6694-a5a9-4449-90db-ce594494a29a>

The slice under test is the **read-only Beads Kanban provider foundation**:

- DB foundation:
  - `ExternalKanbanProvider`
  - `ExternalKanbanSavedView`
  - `BeadWorkspaceLink`
- default read-only Beads board
- actual Beads status discovery through `bd statuses --json` with text fallback
- `bd export` adapter/cache
- bounded provider-neutral rule AST
- explicit Bead workspace-link endpoint
- Beads board UI using shared external Kanban shell

Out of scope for this plan:

- saved-view editor polish
- wrapper CLI integration that creates `BeadWorkspaceLink`
- multi-repo aggregation
- drag/writeback
- provider comments/write actions
- weekly-dev merge authorization

## User stories

### Story 1 — Open a Beads Kanban board

As a VD user working in a repo that uses Beads, I can open a Beads Kanban board
from VD and see beads grouped into status columns so I can understand current
workflow state without leaving the dashboard.

### Story 2 — Trust status handling

As a user, I can trust that all current Beads statuses are represented correctly,
including Unicode-icon status output, and completed/closed work is hidden by
default but can be shown intentionally.

### Story 3 — Use a read-only board safely

As a user, I can browse Beads cards, counts, labels, priorities, assignees, and
parent/child signals without accidentally mutating Beads.

### Story 4 — Link to VK workspace context when explicit links exist

As a user, I see workspace affordances only when the app has an explicit
`BeadWorkspaceLink`; board refreshes should not create links silently.

### Story 5 — See recoverable error/stale states

As a user, if `bd export` or `bd statuses` fails or is stale, I should see honest
diagnostics rather than an empty board that looks like success.

## Preconditions

- Run from VD checkout:
  `/var/tmp/vibe-kanban/worktrees/80ff-vd-kanban-integr/vibe-kanban-vscode-web`
- Branch is `vk/80ff-vd-kanban-integr`.
- Use a fresh Playwright CLI session name for manual browser testing.
- Use local app URL from the dev server or mocked sandbox if already running.
  The Beads provider route is:
  `/dashboard/kanban/beads`
- Do not mutate real Beads data except through the explicit workspace-link
  endpoint when a test case says so.
- Keep Playwright CLI artifacts such as `.playwright-cli/` out of commits.

## Recommended setup commands

Record exact commands and output paths on the tester bead.

```bash
git status --short --branch
npm run db:check:external-integrations
pnpm vitest --run src/modules/plugins/kanban --config vitest.server.config.ts
```

For browser testing, use a running VD dev server. If none is running, start one
in a separate terminal/tmux and record the URL:

```bash
npm run dev
```

Then open the route with Playwright CLI:

```bash
PW_SESSION="beads-provider-$(date +%Y%m%d%H%M%S)"
pnpm playwright:cli -s="$PW_SESSION" open "http://localhost:<PORT>/dashboard/kanban/beads"
pnpm playwright:cli -s="$PW_SESSION" resize 1280 720
pnpm playwright:cli -s="$PW_SESSION" snapshot --json
```

If the app uses a different printed URL/port, substitute that URL.

## Manual test cases

### TEST_CASE_1A — Open default Beads board

Steps:

1. Open `/dashboard/kanban/beads`.
2. Wait for the Beads board to finish loading.
3. Capture a Playwright CLI snapshot.

Expected:

- Page renders a Beads workflow/Kanban board, not a generic unsupported-provider
  screen.
- Header identifies the provider as Beads or Beads workflow.
- Status columns are visible for current non-completed Beads statuses.
- No drag handles or mutation affordances are required for V1.
- No unexpected Jira or Linear provider copy appears.

### TEST_CASE_1B — Current Beads statuses are represented

Steps:

1. Run `bd statuses` in the repo and record the output.
2. Run `bd statuses --json` in the repo and record whether it succeeds.
3. Open `/dashboard/kanban/beads`.
4. Compare visible columns with the current status model.
5. Enable the completed/closed visibility toggle.

Expected:

- Current statuses include the actual repo statuses:
  `open`, `in_progress`, `blocked`, `deferred`, `closed`, `pinned`, `hooked`.
- Non-completed statuses do not land in an `Unmapped` column just because their
  status icon is Unicode.
- `closed`/done-category beads are hidden by default.
- When completed/closed visibility is enabled, closed/completed status columns
  and cards can appear.

### TEST_CASE_1C — Bead cards show useful read-only triage data

Steps:

1. Identify at least one visible Bead card.
2. Inspect the card and, if available, open its detail/drawer.
3. Capture a snapshot and optional screenshot.

Expected:

- Card shows bead id/key and title.
- Card or detail view exposes useful V1 signals when present:
  status, labels, priority, assignee/owner, dependency/blocker count, child or
  dependent count, comment count, and updated/age information.
- Missing values render as absent/unknown, not as false zero values.
- No card action mutates Beads.

### TEST_CASE_1D — Completed toggle is local and reversible

Steps:

1. Open `/dashboard/kanban/beads`.
2. Note visible issue count and visible status columns.
3. Toggle completed/closed visibility on.
4. Toggle completed/closed visibility off.

Expected:

- Toggling on shows closed/completed beads or a clear “none available” state.
- Toggling off returns to the original hidden-completed state.
- No Beads data changes are made.
- Page does not hard-refresh into an error state.

### TEST_CASE_1E — Manual refresh uses the Beads refresh path

Steps:

1. Open `/dashboard/kanban/beads`.
2. Note the displayed refreshed/last fetched time if present.
3. Click the refresh control.
4. Capture a snapshot after refresh completes.

Expected:

- Refresh bypasses cached data and updates the last-refreshed/diagnostic state
  when available.
- Board remains visible after refresh.
- A refresh failure, if encountered, is displayed as an actionable/stale warning
  rather than a fake empty-success board.

### TEST_CASE_2A — Board read does not create workspace links

Steps:

1. Before opening the board, inspect/record that no new workspace-link creation
   action is being intentionally performed.
2. Open `/dashboard/kanban/beads` and refresh once.
3. If practical, query the Beads workspace-link API/state or inspect logs to
   confirm no POST was made by the board read path.

Expected:

- `GET` board load/refresh does not create `BeadWorkspaceLink` rows.
- Workspace affordance is hidden for cards without an existing explicit link.
- This test may be recorded as `SKIPPED` only if the tester cannot inspect
  network/API state; include why.

### TEST_CASE_2B — Explicit workspace link endpoint can create a link

Steps:

1. Choose a visible bead id from the board.
2. Use the documented API or a controlled test request to create a
   `BeadWorkspaceLink` for that bead and a known test workspace id.
3. Refresh the Beads board.
4. Inspect the linked card.

Expected:

- The explicit link endpoint succeeds or returns a clear validation error if
  the workspace id is invalid.
- If the link is valid, the card shows a workspace affordance after refresh.
- If a workspace affordance is shown, it targets the existing VD workspace
  wrapper route rather than raw embedded VK internals.
- The board read itself still does not create links.

### TEST_CASE_3A — Rule AST behavior is covered by focused tests

Steps:

1. Run the focused rule/Beads tests:

   ```bash
   pnpm vitest --run \
     src/modules/plugins/kanban/rules/ruleAst.test.ts \
     src/modules/plugins/kanban/beads/server/beadsAdapter.test.ts \
     src/modules/plugins/kanban/beads/server/boardRoutes.test.ts \
     src/modules/plugins/kanban/beads/components/ExternalBeadsBoardView.test.ts \
     --config vitest.server.config.ts
   ```

Expected:

- Tests pass.
- Coverage includes depth/node limits, invalid field/operator rejection,
  metadata key validation, `all`/`any`/`not`, label array behavior, missing
  fields, filters hiding cards, and placement fallbacks.

### TEST_CASE_3B — DB migration/tooling remains stable

Steps:

1. Run:

   ```bash
   npm run db:check:external-integrations
   ```

Expected:

- Command passes.
- Output indicates current external Kanban DB migrations/checks are applied.
- Generated migration/schema files do not become dirty after the command.

### TEST_CASE_4A — Browser error state for unavailable Beads command

Steps:

1. If practical without harming the repo, run the board with a deliberately
   invalid or inaccessible source directory.
2. Open the Beads board URL with that source.
3. Capture snapshot/screenshot.

Expected:

- The UI shows a clear Beads load/export error.
- It does not show “0 beads” as if the command succeeded.
- The error does not expose secret tokens or irrelevant local internals.
- This test may be `SKIPPED` if the current UI does not expose source selection
  yet; include why.

### TEST_CASE_4B — Mobile/constrained viewport smoke

Steps:

1. Open `/dashboard/kanban/beads`.
2. Resize Playwright CLI to a constrained viewport:

   ```bash
   pnpm playwright:cli -s="$PW_SESSION" resize 390 844
   pnpm playwright:cli -s="$PW_SESSION" snapshot --json
   ```

Expected:

- Header and controls remain reachable.
- Columns/board content can be scrolled.
- Completed toggle and refresh controls are not hidden behind overflow.
- No severe blank/white-flash state remains after load.

## Required tester result format

Record results on the tester bead as JSON keyed by test-case ID:

```json
{
  "TEST_CASE_1A": { "status": "PASS", "notes": "..." },
  "TEST_CASE_1B": { "status": "PASS", "notes": "..." },
  "TEST_CASE_1C": { "status": "PASS", "notes": "..." },
  "TEST_CASE_1D": { "status": "PASS", "notes": "..." },
  "TEST_CASE_1E": { "status": "PASS", "notes": "..." },
  "TEST_CASE_2A": { "status": "PASS", "notes": "..." },
  "TEST_CASE_2B": { "status": "PASS", "notes": "..." },
  "TEST_CASE_3A": { "status": "PASS", "notes": "..." },
  "TEST_CASE_3B": { "status": "PASS", "notes": "..." },
  "TEST_CASE_4A": { "status": "PASS", "notes": "..." },
  "TEST_CASE_4B": { "status": "PASS", "notes": "..." }
}
```

Allowed statuses: `PASS`, `FAIL`, `BLOCKED`, `SKIPPED`.

For any `FAIL` or `BLOCKED`, include:

- exact observed behavior
- expected behavior
- commands/URLs
- screenshot or transcript path if available
- smallest actionable fix recommendation

## Browser transcript expectation

For browser-driven tests, create a transcript artifact following
`test-plans/onboarding/playwright-manual-to-e2e.md`.

Record:

- feature/bead id
- this test-plan path
- branch name
- app URL
- data mode
- viewport
- Playwright CLI session name
- server startup/cleanup command
- each meaningful command, snapshot/ref, generated locator hint, expected
  result, and actual result

Do not commit raw transcript, screenshot, trace, or `.playwright-cli` artifacts
unless a later implementation task explicitly converts them into E2E coverage.
