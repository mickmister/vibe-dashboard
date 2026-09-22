# DockView milestone M3.2 serialized mutation coordinator test plan

- Milestone task: `vkvw-7t0c.2 — DockView M3.2 — Implement serialized mutation coordinator`
- Test-plan bead: `vkvw-7t0c.5 — DockView M3.2 QA — Approve and execute serialized mutation coordinator test plan`
- Scope: production coordinator for one live Voyage controller; no M3.3 persisted
  history UI, no M3.4 global iframe budgeting, no M4 navigation/workflow cutover
- Sources of truth:
  - `DOCKVIEW_IMPLEMENTATION_PLAN.md`
  - `docs/phase-0/surface-opening-coordinator-results.md`
  - `docs/phase-0/dockview-core-contract-results.md`
  - closed M2 repository and target-registry beads

## User stories

1. As a VD user, I can move, resize, maximize, restore, open, focus, and close
   Panels without an older command, callback, timer, or failed save overwriting
   the latest accepted Voyage state.
2. As a keyboard or pointer user, a meaningful activation updates Panel recency
   exactly once, while restore/replay/programmatic Dockview callbacks do not
   create fake MRU evidence.
3. As a user with more than one window or delayed backend response, stale CAS
   conflicts recover predictably: deterministic commands may safely replay, and
   non-replayable changes restore the winner with a typed retry state.
4. As a tester, I can exercise the coordinator through semantic controls and
   visible state evidence, not private object mutation.

## Assumptions

- M3.2 may add a focused production test harness or story route when the real
  navigation shell is not yet ready, but the harness must use production
  coordinator, repository, target registry, and Dockview boundaries.
- The independent tester should be involved after implementation review passes.
- Broad end-to-end coverage can stay focused to the coordinator workflows below;
  M4 will cover the final user-facing Voyage navigation shell.

## Preconditions

- Work from the branch worktree with dependencies installed from the lockfile.
- Start from the closed M3.1 workbench boundary.
- Use normalized M2 repository transactions for all durable writes.
- Use Chromium for browser evidence involving Dockview callbacks, gestures, and
  semantic controls.
- Do not commit `.playwright-cli`, screenshots, traces, or transcript scratch
  artifacts.

## Automated and manual acceptance cases

### TEST_CASE_M3_2A — Serialized command queue and exactly-once commits

Steps:

1. Load a Voyage with at least three durable Panels and a valid Dockview layout.
2. Trigger two structural commands rapidly, such as open/focus then close/move.
3. Trigger a duplicate unsafe command while the first matching command is still
   pending.
4. Inspect visible revision, accepted Panel set, active Panel, layout hash, and
   persistence call evidence after the queue drains.

Expected:

- Commands execute in accepted queue order.
- Duplicate unsafe commands coalesce to one mutation when repeating them would
  create duplicate Panels or duplicate history/checkpoint work.
- Each accepted structural command advances the aggregate revision exactly once.
- Failed validation or persistence rolls back to the accepted before-state and
  creates no durable checkpoint or partial domain/layout divergence.

Error cases:

- Inject validation failure after in-memory Dockview mutation.
- Inject repository failure after snapshot capture but before commit.
- Re-run the same command after the first command completes; it should be
  evaluated against the new accepted state rather than incorrectly coalesced.

### TEST_CASE_M3_2B — Native Dockview gesture boundaries and debounce

Steps:

1. Start a resize or drag/move gesture through Dockview/public UI controls.
2. Generate multiple intermediate layout-change callbacks.
3. Complete the gesture.
4. Repeat with a canceled or invalid gesture.
5. While a debounced save is pending, enqueue a structural command.

Expected:

- The coordinator records one before-state at gesture start and one validated
  after-state at gesture completion.
- Intermediate callbacks update only the pending gesture snapshot; they do not
  each create durable writes or history entries.
- A canceled or unchanged gesture produces no durable write.
- The debounce timer cannot overtake or overwrite a later structural command.
- Canonical snapshot hashing skips unchanged writes.

Error cases:

- Inject a stale debounce timer after a newer accepted revision.
- Inject invalid post-gesture serialization; the before-state is restored.

### TEST_CASE_M3_2C — CAS conflict, winner restore, and safe replay

Steps:

1. Create two coordinator clients for the same Voyage revision.
2. Commit a winning mutation from client A.
3. Attempt a stale mutation from client B.
4. Repeat with a known deterministic command whose preconditions still hold.
5. Repeat with a command whose preconditions no longer hold.

Expected:

- Stale revisions return a typed conflict and never overwrite the winner.
- The stale coordinator loads and validates the winning aggregate before any
  replay decision.
- Only known deterministic commands replay, and only when preconditions still
  hold on the winner.
- Non-replayable conflicts restore the winner and expose visible retry/recovery
  state.
- Raw Dockview callbacks and raw serialized JSON are never merged or replayed.

Error cases:

- Winner snapshot fails validation; show typed recovery without mutating the
  stale accepted state.
- Replay attempt fails persistence; restore the winning accepted state.

### TEST_CASE_M3_2D — Restore suppression and meaningful activation

Steps:

1. Activate a Panel by pointer and by keyboard.
2. Programmatically focus a Panel as part of a user command.
3. Restore a valid layout through guarded `fromJSON(..., { reuseExistingPanels:
   true })`.
4. Trigger Dockview active-panel callbacks during safe-layout construction and
   conflict winner restore.
5. Rapidly switch focus between Panels.

Expected:

- Meaningful user activation assigns exactly one next Voyage-monotonic
  activation sequence and advances the CAS revision without creating a layout
  history checkpoint.
- Programmatic focus inside a user command records exactly one activation and
  suppresses the resulting Dockview callback.
- `fromJSON`, safe-layout construction, replay restore, route reconciliation,
  and other synthetic callbacks do not update MRU.
- Rapid focus noise cannot let an older delayed activation overwrite the final
  visible active Panel or a newer revision.

Error cases:

- Restore a layout with active Panel metadata; restoration reads it but does not
  manufacture recency.
- Duplicate callbacks for the same Panel coalesce safely.

### TEST_CASE_M3_2E — Flush before lifecycle boundaries

Steps:

1. Create pending dirty coordinator state from a completed gesture or command.
2. Switch away from the Voyage, evict the controller, and trigger repository
   shutdown/page-teardown hooks where available.
3. Reopen the Voyage from normalized storage.

Expected:

- Flush runs through the same serialized queue before controller eviction or
  repository shutdown.
- Accepted state survives reload/warm-controller eviction.
- Best-effort page-teardown handling is present but is not the only durability
  mechanism.
- Flush failure exposes typed recovery and does not mark a rejected state
  accepted.

Error cases:

- Flush races a new command; final durable state is the queue winner.
- Flush receives stale revision; conflict handling follows `TEST_CASE_M3_2C`.

### TEST_CASE_M3_2F — Semantic browser workflow and tester evidence

Steps:

1. Open the M3.2 test surface through the product or approved harness route.
2. Use only labeled controls and real Dockview interactions to exercise:
   command queueing, gesture completion, CAS conflict, retry/recovery,
   activation suppression, and flush-before-eviction.
3. Record visible status after each action: revision, active Panel, pending
   command, dirty state, last conflict/recovery reason, and topology agreement.

Expected:

- A tester can run the core coordinator workflows without internal JavaScript
  repair calls.
- Visible status is updated only after the coordinator publishes an accepted
  state or a typed recovery state.
- The manual transcript can be converted into focused Playwright coverage using
  the onboarding workflow.

## Agent-driven browser workflow

Use the Playwright CLI snapshot/ref loop from
`test-plans/onboarding/feature-work-process.md` for independent testing:

```bash
PW_SESSION='dockview-m3-2-<unique>'
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
  "TEST_CASE_M3_2A": { "status": "PASS" },
  "TEST_CASE_M3_2B": { "status": "PASS" },
  "TEST_CASE_M3_2C": { "status": "PASS" },
  "TEST_CASE_M3_2D": { "status": "PASS" },
  "TEST_CASE_M3_2E": { "status": "PASS" },
  "TEST_CASE_M3_2F": { "status": "PASS" }
}
```

Allowed statuses: `PASS`, `FAIL`, `BLOCKED`, `SKIPPED`.

## Overseer self-review notes

- The plan keeps M3.2 focused on coordination, conflicts, activation, gestures,
  debounce, and lifecycle flushes.
- It does not require M3.3 persisted history UI or M3.4 iframe-budget behavior.
- It requires browser evidence only where Dockview callbacks, focus, and visible
  controls matter; pure conflict and replay cases may use focused production
  tests when browser execution would add no material evidence.
- It preserves the tester path: implementer evidence first, independent review,
  then independent tester execution before moving to M3.3.
