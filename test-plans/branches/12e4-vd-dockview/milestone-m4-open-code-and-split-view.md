# DockView milestone M4.4 Open Code and Split View test plan

- Milestone task: `vkvw-xhd8.4 — DockView M4.4 — Implement Agent Open Code workflow`
- Scope: Agent Open Code beside/maximized workflows, generic Split View route
  intent, transient runtime leasing/disposal, accessibility, and non-mutation of
  the underlying Voyage layout during transient Split View.
- Out of scope: mobile single-Panel UX (`vkvw-xhd8.5`), agent-driven arbitrary
  pane manipulation (`vkvw-xhd8.7`), Spaces UI revival, and unrelated M5 cutover.
- Sources of truth:
  - `DOCKVIEW_IMPLEMENTATION_PLAN.md`
  - approved M1.5/M1.7 Open Code and surface-opening contract evidence
  - approved M3 coordinator/runtime budget work
  - approved M4.3 command-layer work

## User stories

1. As an Agent user, **Open Code beside** reuses the best same-Voyage Code Panel
   without duplicating work, preferring the visible right-adjacent Code Panel
   over MRU non-adjacent Panels.
2. As an Agent user, repeated pending **Open Code beside** requests behave like
   one request rather than racing, duplicating, or surfacing avoidable conflicts.
3. As an Agent user, **Open Code maximized** focuses/reuses or creates Code and
   maximizes it without unintended relocation.
4. As a user, **Open in Split View** creates a transient, resizable pair with
   trusted targets, correct split-only disposal, route reconstruction, and no
   underlying Voyage persistence mutation.

## Preconditions

- Work from `vk/12e4-vd-dockview` after review-approved M4.4 commit
  `332f45dc` or later.
- Start with fresh browser/session state and an isolated test database unless a
  case explicitly needs persisted state.
- Use real product/harness UI controls and routes where available. Use focused
  contract harnesses only where the approved plan requires semantic controls not
  yet exposed by final app chrome.
- Do not commit `.playwright-cli`, screenshots, traces, or transcript scratch
  artifacts.

## Acceptance cases

### TEST_CASE_M4_4A — Open Code adjacent-first and MRU fallback

Steps:

1. Create/load a Voyage containing an Agent Panel and multiple equivalent Code
   Panels in the same Voyage.
2. Arrange the layout so serialized/flattened order differs from visual
   right-adjacency.
3. Invoke **Open Code beside** from the Agent.
4. Repeat with no visible right-adjacent equivalent but with MRU evidence.

Expected:

- Visible right-adjacent equivalent Code wins over flattened order and MRU.
- When no adjacent equivalent exists, same-Voyage MRU Code wins.
- Code Panels in other Voyages are ignored.
- No duplicate Code Panel is created when an equivalent same-Voyage Panel exists.
- Exactly one command/checkpoint is produced per accepted invocation.

### TEST_CASE_M4_4B — Open Code creation, movement, maximize, and narrow fallback

Steps:

1. Invoke **Open Code beside** when no equivalent Code Panel exists.
2. Invoke **Open Code beside** when an equivalent Code Panel exists but is not
   adjacent.
3. Invoke **Open Code maximized** for existing and absent Code.
4. Repeat beside flow below the tested minimum split width.

Expected:

- Absent Code creates exactly one Code Panel in the invoking Voyage.
- Existing non-adjacent Code is moved/focused beside the Agent without creating a
  duplicate.
- Maximized flow focuses/reuses or creates Code and maximizes without unintended
  relocation.
- Narrow-width fallback activates/maximizes rather than creating an unusable
  split.
- Focus and accessible announcement behavior remain deterministic.

### TEST_CASE_M4_4C — Pending Open Code dedupe

Steps:

1. Trigger two identical **Open Code beside** requests while the first is still
   pending.
2. Observe command calls, resulting layout, and final result returned to each
   invocation.
3. Force a first-request failure, then retry the same request.

Expected:

- Identical pending requests share one in-flight result/command.
- No duplicate Panel, double move, double activation, or avoidable CAS conflict
  occurs.
- In-flight tracking is cleared in `finally`.
- Retry after failure can run a fresh command.

### TEST_CASE_M4_4D — Split View trusted route intent and target selection

Steps:

1. Enter Split View with `?voyage=&split=&withCraft=&withSurface=` for same-Craft
   default target selection.
2. Enter Split View with a permitted cross-Craft target.
3. Attempt malformed, unknown, duplicate, or unauthorized query parameters.
4. Test equivalent target presence only in another Voyage while absent in the
   current Voyage.

Expected:

- Trusted same-Craft and permitted cross-Craft targets resolve deterministically.
- Invalid or unauthorized route intent fails closed with recovery UI and no
  Voyage layout mutation.
- Existing-panel lookup is scoped to the current Voyage; an equivalent Panel in a
  different Voyage still yields split-only behavior for the current Voyage.

### TEST_CASE_M4_4E — Split View runtime lifecycle and non-mutation

Steps:

1. Enter Split View and verify two transient runtime hosts attach.
2. Resize, maximize/restore, and change responsive width across the tested
   breakpoint.
3. Exit Split View and return to the underlying Voyage.
4. Repeat after Back/Forward and refresh reconstruction.

Expected:

- Split View uses transient hosts and runtime leases; it does not transfer
  Dockview renderer roots/private DOM.
- Resize ratio and transient maximize behavior match approved contract.
- Split-only absent target is disposed exactly once on exit.
- Underlying Voyage `layout_json`, revision, and history do not change due to
  transient Split View.
- Back/Forward/refresh reconstruct or recover safely without stale mutation.

## Required validation

Tester should record exact commands and artifacts and, at minimum, run:

```bash
pnpm install --frozen-lockfile
pnpm run check-types
pnpm exec vitest run --config vitest.server.config.ts \
  src/dockview/DockviewOpenSurfaceWorkflow.test.ts \
  src/dockview/DockviewSplitViewWorkflow.test.ts \
  src/store/voyageCommands.test.ts \
  src/store/voyageRepository.test.ts \
  src/store/dockviewSnapshotCodec.test.ts
pnpm test:contract:dockview
git diff --check
git status --short --branch
```

Use the Playwright CLI snapshot/ref loop from
`test-plans/onboarding/feature-work-process.md` for browser-driven portions and
capture an E2E-conversion transcript per
`test-plans/onboarding/playwright-manual-to-e2e.md`.
