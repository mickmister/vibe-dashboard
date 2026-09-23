# DockView milestone M3.3 persisted history test plan

- Milestone task: `vkvw-7t0c.3 — DockView M3.3 — Implement persisted history`
- Test-plan bead: `vkvw-7t0c.6 — DockView M3.3 QA — Approve and execute persisted history test plan`
- Scope: persisted linear layout/Panel history for the M3 coordinator; no M3.4
  iframe budget work and no M4 Voyage navigation/workflow cutover
- Sources of truth:
  - `DOCKVIEW_IMPLEMENTATION_PLAN.md`
  - closed `vkvw-qkqo.2 — DockView M2.2 — Implement serialized Voyage repository transactions`
  - closed `vkvw-7t0c.2 — DockView M3.2 — Implement serialized mutation coordinator`

## User stories

1. As a VD user, I can undo and redo layout/Panel changes after reload without
   losing current activation recency or unrelated VK/backend activity.
2. As a VD user, a new structural action after undo truncates abandoned redo
   history so redo cannot resurrect an obsolete branch.
3. As a VD operator, history stays bounded, validated, and atomic with the
   aggregate revision; failed history writes cannot partially change layout,
   Panels, or cursor state.
4. As a tester, I can run the history workflow through semantic controls and
   visible state evidence, with no private repair calls.

## Assumptions

- M3.3 can extend the M3.2 approved test harness or production-shaped route, as
  long as it uses the real serialized coordinator, normalized repository,
  guarded Dockview snapshot validation, and semantic controls.
- M3.3 does not need final M4 navigation UI. It must prove the durable behavior
  behind that UI.
- Independent tester execution happens after code-review approval.

## Preconditions

- Work from the branch worktree with dependencies installed from the lockfile.
- Start from approved M3.2 coordinator behavior.
- Use normalized M2 repository transactions and canonical Dockview snapshot
  validation.
- Use Chromium for browser evidence involving visible undo/redo controls,
  retained iframe identity, and reload.
- Do not commit `.playwright-cli`, screenshots, traces, or transcript scratch
  artifacts.

## Automated and manual acceptance cases

### TEST_CASE_M3_3A — Checkpoint creation boundaries

Steps:

1. Load a Voyage with multiple Panels and a valid Dockview layout.
2. Perform structural actions: open, close, move/rearrange, maximize, restore,
   and a completed Dockview gesture.
3. Perform non-checkpoint actions: focus-only activation, initial load,
   unchanged autosave, failed command, canceled/unchanged gesture, and safe
   restore.
4. Inspect history count, cursor, aggregate revision, activation sequence, and
   current canonical layout after each action.

Expected:

- Each completed structural action creates exactly one checkpoint and advances
  the aggregate revision once.
- Non-checkpoint actions do not create layout-history entries.
- Focus-only activation may advance the aggregate revision but does not create a
  history checkpoint.
- Failed/canceled actions leave history, cursor, layout, and Panels at the
  accepted before-state.

Error cases:

- Inject invalid post-action layout serialization.
- Inject repository failure during checkpoint write.
- Complete a noisy gesture with multiple layout callbacks; still one
  checkpoint.

### TEST_CASE_M3_3B — Undo/redo restore canonical layout and Panels

Steps:

1. Create a sequence of at least four checkpoints involving Panel create, close,
   move, maximize/restore, and tab activation.
2. Undo step by step to the initial checkpoint.
3. Redo step by step to the latest checkpoint.
4. Reload the Voyage and repeat one undo and one redo.

Expected:

- Undo moves the cursor backward through stored canonical checkpoints.
- Redo moves the cursor forward through stored canonical checkpoints.
- Guarded `fromJSON(..., { reuseExistingPanels: true })` restores layout only
  after the stored snapshot is parsed and validated.
- Domain Panel projection and live Dockview canonical topology match after every
  undo, redo, and reload.
- Retained iframe/runtime identity is preserved for surviving Panels wherever
  the approved M1/M3.1 contract promises it.

Error cases:

- Corrupt a stored checkpoint snapshot; restore fails closed with typed recovery
  and does not mutate the accepted live layout.
- Corrupt a stored Panel projection; restore fails closed before `fromJSON`.

### TEST_CASE_M3_3C — Activation metadata is current, not historical

Steps:

1. Create a structural checkpoint with Panels A, B, and C.
2. Change focus/activation recency several times without creating history.
3. Undo a structural change that keeps some Panels and recreates another Panel.
4. Redo the structural change.
5. Invoke an MRU-dependent selection, such as the approved Open-beside selector,
   using current recency evidence.

Expected:

- History projections exclude Voyage activation counter and Panel recency.
- Undo/redo advances the normal aggregate revision but never decrements or
  restores the Voyage activation counter.
- Surviving Panels retain current `last_activated_sequence`.
- Structurally recreated Panels start with null recency.
- Restore-generated Dockview callbacks do not create activation evidence.
- MRU selection uses current recency after undo/redo, not checkpoint-time
  recency.

Error cases:

- Focus changes after a checkpoint do not mutate that checkpoint projection.
- Equal or missing recency still uses stable Panel-ID tie-break.

### TEST_CASE_M3_3D — Branch truncation and bounded pruning

Steps:

1. Create a history sequence longer than the configured limit using a small
   test-configured bound.
2. Undo into the middle of the sequence.
3. Perform a new structural mutation.
4. Continue adding checkpoints beyond the bound.
5. Attempt redo and inspect retained entries.

Expected:

- A new mutation after undo deletes the abandoned redo branch in the same
  transaction.
- Redo is unavailable after branch truncation.
- Pruning removes oldest entries beyond the bound while preserving the current
  entry and nearest usable predecessors.
- Cursor metadata remains valid after pruning.
- No orphaned history entries or panel projections remain.

Error cases:

- Inject failure during branch truncation or pruning; layout, Panels, history,
  cursor, and revision roll back together.

### TEST_CASE_M3_3E — Atomicity, conflicts, and reload durability

Steps:

1. Create two clients for the same Voyage revision.
2. Commit a checkpointed structural change from client A.
3. Attempt a stale undo/redo or structural checkpoint from client B.
4. Reload the application and inspect history/cursor.
5. Repeat with injected failures across domain, layout, history, cursor, and
   revision writes.

Expected:

- Stale history mutations return typed conflicts and cannot overwrite the
  winner.
- The coordinator restores the winning aggregate or asks the user to retry
  according to the M3.2 conflict contract.
- History and cursor survive reload.
- Domain, layout, history, cursor, activation metadata, and aggregate revision
  commit atomically or not at all.
- Layout JSON is never structurally merged.

Error cases:

- Conflict winner has invalid history; recovery is typed and safe.
- Repository shutdown/flush does not lose an accepted checkpoint.

### TEST_CASE_M3_3F — Semantic browser history workflow

Steps:

1. Open the approved M3 history test surface through the product or approved
   harness route.
2. Use only labeled controls and real Dockview interactions to create
   checkpoints, undo, redo, truncate redo, reload, and verify current recency.
3. Record visible status after each action: revision, history count, cursor,
   active Panel, activation sequence, layout hash, recovery reason, and topology
   agreement.

Expected:

- A tester can run the core persisted-history workflows without private object
  mutation or internal repair calls.
- Visible status updates only after the coordinator publishes an accepted state
  or typed recovery state.
- The manual transcript can be converted into focused Playwright coverage using
  the onboarding workflow.

## Agent-driven browser workflow

Use the Playwright CLI snapshot/ref loop from
`test-plans/onboarding/feature-work-process.md` for independent testing:

```bash
PW_SESSION='dockview-m3-3-<unique>'
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
  "TEST_CASE_M3_3A": { "status": "PASS" },
  "TEST_CASE_M3_3B": { "status": "PASS" },
  "TEST_CASE_M3_3C": { "status": "PASS" },
  "TEST_CASE_M3_3D": { "status": "PASS" },
  "TEST_CASE_M3_3E": { "status": "PASS" },
  "TEST_CASE_M3_3F": { "status": "PASS" }
}
```

Allowed statuses: `PASS`, `FAIL`, `BLOCKED`, `SKIPPED`.

## Overseer self-review notes

- The plan keeps M3.3 focused on persisted history and undo/redo semantics.
- It excludes M3.4 iframe budget/LRU behavior and M4 final navigation UI.
- It explicitly covers the subtle contract: checkpoints exclude activation
  metadata, but undo/redo must merge with current recency.
- It preserves the sequencing rule: implementation, code review, then
  independent tester before M3.4 starts.
