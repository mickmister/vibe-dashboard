# Generic durable surface-opening coordinator — Phase 0 result

Result: **GO** for production implementation behind a trusted target registry and a serialized per-Voyage mutation coordinator.

This isolated contract closes `TEST_CASE_M1_5A` and `TEST_CASE_M1_5B`. It models **open a trusted compatible surface relative to an invoking durable Panel**, not an Agent/Code-only feature. Agent → Code is an acceptance fixture; Agent → Forms proves a second target follows the same path.

## Executable findings

- The invoking Panel, trusted action relationship, and every candidate are re-resolved through the current M1.3 boundary and authoritative owner map. Persisted derived equivalence is ignored; malformed data, mismatched Crafts, removed definitions/plugins/factories, and unrelated Craft targets fail closed.
- Selection is confined to the invoking Voyage. Visible adjacency comes from validated two-dimensional group geometry rather than flat array order. Ties use durable activation sequence and then stable Panel ID; otherwise the current same-Voyage MRU wins.
- Identical in-flight requests share one promise and cause one activation, atomic commit, and checkpoint. The key is cleared on success and failure, so later commands re-resolve current authority and state.
- Wide **Open beside** places the selected Panel immediately right at measured equal widths. Below the usable breakpoint it activates the target and maximizes its group, with visible pointer/keyboard Restore and no browser Fullscreen API.
- A single atomic commit carries expected/next revision, structural Panel projection, validated layout projection, history cursor/checkpoint, and activation metadata. Focus-only activation has no structural checkpoint. Create, move, maximize, Restore, undo, and redo all pass through that coordinator authority.
- **Open maximized** activates the resolved target before Dockview group maximize. Existing targets remain in place; absent targets are created and maximized in one coordinated checkpoint. Restore is visible and keyboard operable. Browser fullscreen is never requested.
- Structural undo/redo never rewinds the Voyage activation counter. Surviving Panels keep current recency; structurally recreated Panels start with null recency until meaningful activation. Programmatic projection focus does not advance recency.
- Runtime payloads preserve boot identity through coordinator projection and controller eviction. Durable MRU survives warm eviction and reload. Every browser command asserts authoritative projection and Dockview topology agree, including commands after Restore/undo/redo.
- A rejected atomic commit leaves aggregate, layout, history cursor, and activation state unchanged.

## Evidence

- Unit contract: `spikes/dockview-contract/surfaceOpeningCoordinator.test.ts`
- Semantic browser harness: `spikes/dockview-contract/surface-opening.html`
- Chromium contract: `tests/dockview-contract/surface-opening.spec.ts`
- Required cases: `TEST_CASE_M1_5A`, `TEST_CASE_M1_5B`

## Production boundary

This spike is not production persistence. Production must connect the same generic algorithm to the approved per-Voyage save coordinator, aggregate CAS repository, target registry, layout history, runtime registry, and recovery UI. It must not copy fixture registries or privilege Agent → Code.
