# Generic durable surface-opening coordinator — Phase 0 result

Result: **GO** for production implementation behind a trusted target registry and a serialized per-Voyage mutation coordinator.

This isolated contract closes `TEST_CASE_M1_5A` and `TEST_CASE_M1_5B`. It models **open a trusted compatible surface relative to an invoking durable Panel**, not an Agent/Code-only feature. Agent → Code is an acceptance fixture; Agent → Forms proves a second target follows the same path.

## Executable findings

- The invoking Panel, trusted action relationship, and every candidate are re-resolved through the current M1.3 boundary and authoritative owner map. Persisted derived equivalence is ignored; malformed data, mismatched Crafts, removed definitions/plugins/factories, and unrelated Craft targets fail closed.
- Selection is confined to the invoking Voyage. Chromium constructs a nested Dockview layout through public APIs, validates its canonical serialization, measures live group bounds, and proves the serialized Panel-record order differs from the measured right neighbor. Adjacent-first uses that measured neighbor. Synthetic geometry remains only for focused algorithm unit cases.
- Identical in-flight requests share one promise and cause one activation, atomic commit, and checkpoint. The key is cleared on success and failure, so later commands re-resolve current authority and state.
- Wide **Open beside** places the selected Panel immediately right at measured equal widths. Below the usable breakpoint it activates the target and maximizes its group, with visible pointer/keyboard Restore and no browser Fullscreen API.
- A single atomic commit carries expected/next revision, structural Panel before/after projections, canonical Dockview before/after envelopes, history cursor metadata, and activation metadata. Every canonical envelope passes the M1.1 parser. Undo/redo validates the stored envelope immediately before guarded `fromJSON(..., { reuseExistingPanels: true })`; create, move, maximize, Restore, activation, undo, and redo all use the serialized authority.
- **Open maximized** activates the resolved target before Dockview group maximize. Existing targets remain in place; absent targets are created and maximized in one coordinated checkpoint. Restore is visible and keyboard operable. Browser fullscreen is never requested.
- Structural undo/redo never rewinds the Voyage activation counter. Surviving Panels keep current recency; structurally recreated Panels start with null recency until meaningful activation. Programmatic projection focus does not advance recency.
- Runtime payloads preserve boot identity through guarded canonical undo/redo and controller eviction. Durable MRU survives warm eviction and reload. One guarded normalizer is applied to both expected and live envelopes and compares the full ordered nested grid, inferred orientation at every branch, leaf/group identity, supported size/visibility fields, Panel membership/tab order and metadata, active group/view, and maximized path after create/move/maximize, Restore, undo, redo, and subsequent commands. Unit and Chromium negatives prove that flattening, orientation/order drift, leaf changes, and maximize-path changes do not compare equal.
- A deliberately corrupt canonical envelope is produced after a real Dockview create mutation; rejection restores the prior envelope with aggregate revision, history cursor, activation state, and surviving Agent runtime identity unchanged. The transaction-created runtime is removed from the registry and DOM, its activity stops, and its single budget registration is released exactly once rather than entering a reusable cache.
- Labeled harness controls expose adjacent/MRU setup, adjacency change, separate equal and missing ties, absent targets, wide/narrow modes, concurrent dedupe, Restore, undo/redo, commit rejection, controller eviction, and persisted reload without tester-side JavaScript. The live status exposes topology evidence, per-Panel recency, canonical-history presence, commit counters, and rollback errors.

## Evidence

- Unit contract: `spikes/dockview-contract/surfaceOpeningCoordinator.test.ts`
- Semantic browser harness: `spikes/dockview-contract/surface-opening.html`
- Chromium contract: `tests/dockview-contract/surface-opening.spec.ts`
- Required cases: `TEST_CASE_M1_5A`, `TEST_CASE_M1_5B`

## Production boundary

This spike is not production persistence. Production must connect the same generic algorithm to the approved per-Voyage save coordinator, aggregate CAS repository, target registry, layout history, runtime registry, and recovery UI. It must not copy fixture registries or privilege Agent → Code.
