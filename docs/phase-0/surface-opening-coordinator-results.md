# Generic durable surface-opening coordinator — Phase 0 result

Result: **GO** for production implementation behind a trusted target registry and a serialized per-Voyage mutation coordinator.

This isolated contract closes `TEST_CASE_M1_5A` and `TEST_CASE_M1_5B`. It models **open a trusted compatible surface relative to an invoking durable Panel**, not an Agent/Code-only feature. Agent → Code is an acceptance fixture; Agent → Forms proves a second target follows the same path.

## Executable findings

- The M1.3 `resolvePanelTarget` boundary supplies the authoritative equivalence key. Stored kind, URL, path, or provenance never selects privilege or equivalence by itself.
- Selection is confined to the invoking Voyage. A visibly adjacent equivalent wins; ties use durable activation sequence and then stable Panel ID. Without adjacency, the same-Voyage durable MRU equivalent wins. An equivalent in another Voyage is untouched.
- An absent target creates exactly one Panel. Serialized commands re-evaluate after prior commands, so rapid concurrent calls cannot duplicate it.
- Wide **Open beside** places the selected Panel immediately right of the invoking Panel and browser evidence measures equal group widths. Narrow mode uses one usable tab group.
- An adjacent focus-only command advances revision and activation metadata without a structural history checkpoint. Create, move, and maximize commands each commit one CAS revision and one structural checkpoint. Activation recency is excluded from structural snapshots.
- **Open maximized** activates the resolved target before Dockview group maximize. Existing targets remain in place; absent targets are created and maximized in one coordinated checkpoint. Restore is visible and keyboard operable. Browser fullscreen is never requested.
- Dockview snapshots drive structural undo/redo with `reuseExistingPanels`. Registry-owned runtime payloads preserve boot identity through undo/redo and controller eviction/restoration. Browser reload reconstructs durable topology with an intentionally new DOM runtime identity.
- A failed aggregate CAS leaves authoritative coordinator state unchanged.

## Evidence

- Unit contract: `spikes/dockview-contract/surfaceOpeningCoordinator.test.ts`
- Semantic browser harness: `spikes/dockview-contract/surface-opening.html`
- Chromium contract: `tests/dockview-contract/surface-opening.spec.ts`
- Required cases: `TEST_CASE_M1_5A`, `TEST_CASE_M1_5B`

## Production boundary

This spike is not production persistence. Production must connect the same generic algorithm to the approved per-Voyage save coordinator, aggregate CAS repository, target registry, layout history, runtime registry, and recovery UI. It must not copy fixture registries or privilege Agent → Code.
