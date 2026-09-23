# DockView milestone M4.2 route preservation test plan

- Milestone task: `vkvw-xhd8.2 — DockView M4.2 — Preserve and migrate dashboard routes`
- Test-plan bead: `vkvw-xhd8.6 — DockView M4.2 QA — Approve and execute route preservation test plan`
- Scope: dashboard route resolver, compatibility redirects, canonical query intent,
  browser history behavior, and non-mutating recovery; no sidebar UI (M4.1), no
  Voyage/Craft command implementation (M4.3), no Open Code workflow (M4.4), and
  no mobile single-Panel route (M4.5)
- Sources of truth:
  - `DOCKVIEW_IMPLEMENTATION_PLAN.md`
  - closed M2 migration/target-registry work
  - closed M3 workbench/coordinator/history/runtime work

## User stories

1. As a returning VD user, `/` remains the dashboard landing route and
   `/dashboard` continues to work as a compatible entry point.
2. As a user with old dashboard links, legacy `voyage`, `craft`, and `views`
   query parameters resolve deterministically to canonical Voyage/Craft/Panel
   focus intent where possible.
3. As a user following generated workspace links or plugin links,
   `/dashboard/workspaces/:workspaceId` still opens the existing VD/VK Workspace
   opener without being swallowed by Voyage routing.
4. As an operator, invalid, stale, ambiguous, or homepage legacy tokens never
   mutate normalized layouts or stored preferences while resolving/recovering.

## Assumptions

- M4.2 may use a focused production-shaped route harness when the final sidebar
  and command UI are not yet implemented.
- M4.2 can activate/focus existing Panels and issue deterministic open commands
  only where the trusted registry/repository already supports them. It should not
  implement later M4 workflows.
- Independent tester execution happens after code-review approval.

## Preconditions

- Work from the branch worktree with dependencies installed from the lockfile.
- Start from approved M2/M3 normalized repository and workbench behavior.
- Use current trusted target registry definitions for legacy target resolution.
- Use fresh browser/session state for compatibility and history tests unless a
  case explicitly tests stored `workspace-last-dashboard-url` behavior.
- Do not commit `.playwright-cli`, screenshots, traces, or transcript scratch
  artifacts.

## Automated and manual acceptance cases

### TEST_CASE_M4_2A — Root and dashboard compatibility

Steps:

1. Open `/` with no Voyage query.
2. Open `/dashboard` with no Voyage query.
3. Open both routes with an unrelated query parameter, such as referrer context.
4. Inspect rendered destination, canonical URL, browser history length, and any
   normalized repository writes.

Expected:

- `/` remains the canonical dashboard landing route.
- `/dashboard` redirects or normalizes compatibly to the same landing behavior.
- Unrelated query parameters survive normalization unless explicitly unsafe.
- Route normalization does not create, mutate, or restore Voyage layout state.
- Browser history uses replace versus push deterministically; opening a legacy
  entry should not trap Back in a redirect loop.

Error cases:

- Malformed query strings and duplicate focal parameters fail closed.
- Stored last-dashboard URL pointing to `/dashboard` normalizes without losing
  supported focus intent.

### TEST_CASE_M4_2B — Canonical Voyage, Craft, and Panel query intent

Steps:

1. Open `/?voyage=<valid-voyage-token>`.
2. Open `/?voyage=<valid-voyage-token>&panel=<valid-panel-token>`.
3. Open `/?voyage=<valid-voyage-token>&craft=<valid-craft-token>` where the
   Craft has an existing most-recent Panel.
4. Open a Craft route where no Panel exists but a deterministic default Panel can
   be opened by the current registry.
5. Open with both `panel` and `craft`.

Expected:

- Voyage loads and validates before focus intent is applied.
- Valid `panel` activates/focuses that Panel.
- Without valid `panel`, valid `craft` focuses the Craft's most-recent Panel or
  opens its default Panel only through trusted deterministic resolution.
- If both `panel` and `craft` are present, the documented single focal target
  precedence is deterministic and visible.
- Invalid focus intent never mutates layout or creates fallback Panels.

Error cases:

- Tokens for a different Voyage are rejected or recovered without cross-Voyage
  focus/mutation.
- Missing Voyage, stale Panel, stale Craft, or removed target definition produces
  typed recovery with a safe Back/dashboard path.

### TEST_CASE_M4_2C — Legacy `views` and stored URL compatibility

Steps:

1. Open legacy URLs containing comma-separated `views` tokens that map to
   migrated Panels.
2. Open legacy URLs whose `views` tokens require deterministic open commands.
3. Open a stored `workspace-last-dashboard-url` using `/` and `/dashboard` forms
   with supported focus intent.
4. Verify resulting canonical URL and repository state.

Expected:

- Legacy `views` tokens resolve through migration/target registry authority, not
  stored URL/path privilege claims.
- Where a matching migrated Panel exists, the URL canonicalizes to `panel` where
  possible.
- Where deterministic open is allowed, exactly one trusted command runs and then
  canonicalizes to the resulting Panel focus.
- Supported focus intent is preserved across stored URL normalization.
- Unrelated query parameters survive normalization.

Error cases:

- Ambiguous, removed-plugin, malformed, unauthorized, or cross-Voyage `views`
  tokens show non-destructive recovery and do not mutate layouts.
- Duplicate legacy view tokens do not duplicate Panels or commands.

### TEST_CASE_M4_2D — Homepage legacy tokens are non-mutating

Steps:

1. Open legacy focus for `tg_home`.
2. Open legacy focus for `tab_overview`.
3. Open legacy focus for `internal://spaces-overview`.
4. Repeat when a valid Voyage and unrelated query parameters are present.

Expected:

- Each homepage representation canonicalizes to `/` with no Voyage, Craft, view,
  or Panel focus.
- No normalized homepage state, Panel row, recency row, layout mutation, or stored
  last-dashboard preference overwrite is created.
- Unrelated safe query parameters survive as specified by the resolver.
- Browser Back remains usable and idempotent.

Error cases:

- Homepage token mixed with invalid Panel/Craft token still remains
  non-mutating and surfaces deterministic recovery if needed.

### TEST_CASE_M4_2E — Workspace opener preservation

Steps:

1. Open `/dashboard/workspaces/:workspaceId` for an available workspace.
2. Open the same path with unrelated query parameters used by generated links or
   plugins.
3. Open unavailable, malformed, or unauthorized workspace IDs.
4. Navigate back to a canonical dashboard/Voyage URL.

Expected:

- The workspace opener route remains owned by the existing VD/VK workspace
  opener and is not reinterpreted as a Voyage or Panel token.
- Supported generated/plugin link parameters survive or are consumed only by the
  workspace opener contract.
- Invalid workspace open attempts fail through existing safe workspace recovery,
  not through layout mutation.
- Returning to dashboard/Voyage routes does not leak workspace-opener state into
  Voyage focus.

### TEST_CASE_M4_2F — Browser history, refresh, and recovery semantics

Steps:

1. Navigate through a sequence of legacy URL, canonical Voyage URL, canonical
   Panel URL, invalid token URL, and workspace opener URL.
2. Use browser Back/Forward after each normalization/recovery.
3. Refresh on canonical, legacy-normalized, and recovery states.
4. Inspect repository revision/history and visible recovery state.

Expected:

- Canonicalization uses push/replace consistently and does not create redirect
  loops.
- Refresh reconstructs route intent from current trusted repository/registry
  state.
- Invalid tokens never call `fromJSON`, mutate layout, create Panels, advance
  Voyage revision/history, or overwrite stored preferences.
- Recovery UI provides a safe dashboard/back path and actionable reason.
- Browser history behavior is deterministic and tester-visible.

## Agent-driven browser workflow

Use the Playwright CLI snapshot/ref loop from
`test-plans/onboarding/feature-work-process.md` for independent testing:

```bash
PW_SESSION='dockview-m4-2-<unique>'
pnpm playwright:cli -s="$PW_SESSION" open "$URL"
pnpm playwright:cli -s="$PW_SESSION" snapshot --json
pnpm playwright:cli -s="$PW_SESSION" generate-locator e<N> --json
pnpm playwright:cli -s="$PW_SESSION" click e<N> --json
```

Record exact commands, URLs, locator hints, screenshots if captured, and results
on the tester bead. Do not commit raw Playwright CLI artifacts.

## Required result schema

Implementation, review, and independent tester evidence should report:

```json
{
  "TEST_CASE_M4_2A": { "status": "PASS" },
  "TEST_CASE_M4_2B": { "status": "PASS" },
  "TEST_CASE_M4_2C": { "status": "PASS" },
  "TEST_CASE_M4_2D": { "status": "PASS" },
  "TEST_CASE_M4_2E": { "status": "PASS" },
  "TEST_CASE_M4_2F": { "status": "PASS" }
}
```

Allowed statuses: `PASS`, `FAIL`, `BLOCKED`, `SKIPPED`.

## Overseer self-review notes

- The plan focuses on route compatibility, canonicalization, recovery, and
  history semantics.
- It does not require the M4.1 sidebar, M4.3 commands, M4.4 Open Code workflow,
  or M4.5 mobile single-Panel experience.
- It explicitly protects against non-route side effects: layout mutation,
  preference overwrite, `fromJSON`, Panel creation, revision/history writes, and
  target-authority bypass.
- It preserves the sequencing rule: implementation, code review, then
  independent tester before the next M4 task starts.
