# DockView milestone M1 contract-spike test plan

- Milestone: `vkvw-4wf7 — DockView M1 — Prove Dockview and browser contracts`
- Test-plan bead: `vkvw-4wf7.6 — DockView M1 QA — Approve and execute contract-spike test plan`
- Scope: contract spikes only; no production DockView cutover
- Source of truth: `DOCKVIEW_IMPLEMENTATION_PLAN.md`

## User stories

1. As a VD user, I can trust that rearranging a DockView workbench will preserve
   live iframe state wherever the supported contract promises it.
2. As a keyboard user, I can reach and invoke essential layout controls without
   dragging. This is secondary to proving layout, iframe, and recovery
   correctness in M1; advanced keyboard docking is not an M1 priority.
3. As an operator, I can reject incompatible or unsafe serialized layouts before
   Dockview instantiates them.
4. As a developer, I have a complete target and capability registry contract
   grounded in the surfaces VD can construct today.
5. As a Panel user, I can pair the current surface with a compatible surface,
   defaulting to the same Craft—even when the second is not already a Voyage Panel—resize or
   transiently maximize it in foreground Split View, and return to my unchanged
   Voyage when finished.

## Preconditions

- Work from the branch worktree, with dependencies installed from its lockfile.
- Use the exact Dockview version pinned by M1.1.
- Use Chromium for the focused contract harness. Record any additional browser
  coverage rather than implying it ran.
- Use a fresh Playwright CLI session and a unique `/tmp` artifact directory for
  independent browser testing.
- Do not commit `.playwright-cli`, screenshots, traces, or transcript scratch
  artifacts.

## Automated and manual acceptance cases

### TEST_CASE_M1_1A — Dependency and harness reproducibility

Steps:

1. Install with the frozen lockfile.
2. Verify the public Dockview packages and transitive engine resolve to the
   documented exact version.
3. Start the isolated Phase 0 harness using its documented command.
4. Confirm the harness does not import or mutate production workspace state.

Expected:

- Installation is reproducible with no unreviewed version drift.
- The harness loads independently and exposes the documented test controls.
- Failure to load the pinned engine is loud rather than silently substituted.

### TEST_CASE_M1_1B — Core layout and mutation boundaries

Steps:

1. Add two Panels, split them, and move one Panel relative to the other.
2. Maximize the Code group and restore it.
3. Capture mutation-boundary evidence around each completed structural action.

Expected:

- Add, split, move, maximize, and restore match the public API contract.
- Each completed mutation has paired before/after boundaries.
- No unsupported floating or popout path is required.

Error cases:

- Repeat a command while a prior action is settling; no duplicate Panel or
  unpaired boundary is produced.
- Attempt Shift-drag floating; floating remains disabled.

### TEST_CASE_M1_1C — Serialization and fail-closed loading

Steps:

1. Serialize a split, active, maximized layout and restore it.
2. Compare the accepted round trip with the versioned contract.
3. Try malformed JSON, unsupported schema/version, unknown components, floating
   or popout locations, edge groups, and unsupported pinned-tab metadata.

Expected:

- Accepted state round-trips exactly for every promised field.
- Rejected input is quarantined before `fromJSON()` touches the live controller.
- Rejection leaves a safe usable fallback and an actionable reason.

### TEST_CASE_M1_1D — Essential keyboard access (secondary)

Steps:

1. Navigate tabs and groups using the documented keyboard controls.
2. Invoke the essential spike-owned layout commands without pointer drag.
3. Restore from maximized state using the keyboard.

Expected:

- Focus order and active state are visible and deterministic.
- Controls have accessible names and announce meaningful layout changes.
- Essential actions and Restore are not pointer-only. Advanced keyboard docking
  ergonomics may be deferred; they do not block the higher-priority lifecycle
  and recovery proofs unless an essential action is unreachable.

### TEST_CASE_M1_2A — Iframe identity during supported layout changes

Steps:

1. Load the instrumented iframe and record boot ID, heartbeat, scroll position,
   form state, and listener count.
2. Move, split, hide/show, maximize/restore, undo/redo, and switch between the
   active and warm Voyage.
3. Return to each state and compare the instrumentation.

Expected:

- Boot identity and mutable browser state survive every operation promised by
  the approved contract.
- Heartbeat/listener behavior does not multiply after moves or restores.
- Any intentional reload case is named explicitly in the result artifact.

Error cases:

- Force controller eviction and confirm the documented reload boundary.
- Attempt an unsafe imported layout and confirm no iframe is instantiated.

### TEST_CASE_M1_3A — Complete target-factory inventory

Steps:

1. Enumerate built-in, VK Agent, Code, URL, paired, plugin iframe, plugin React,
   and ephemeral surface producers.
2. For each durable family, inspect schema/version, migration, resolver,
   renderer key, equivalence key, sharing key, and missing-target behavior.
3. Verify known temporary and homepage representations are classified rather
   than converted to durable Panels.

Expected:

- Every currently constructible View family has exactly one documented outcome.
- Unknown, removed-plugin, and malformed targets fail closed.
- No durable target treats a stored URL/path or provenance claim as authority.

### TEST_CASE_M1_4A — Capability threat model

Steps:

1. Resolve representative built-in, VK, Code, plugin, and custom URL targets.
2. Inspect effective sandbox, clipboard, fullscreen, download, and messaging
   capabilities.
3. Tamper with persisted target claims and remove/tighten a plugin manifest.

Expected:

- Effective provenance and privileges come only from trusted current resolvers.
- Persisted data cannot self-upgrade.
- Missing or tightened manifests degrade to recovery UI without old privileges.

### TEST_CASE_M1_5A — Agent to Code beside

Steps:

1. Invoke Open beside with no equivalent Code Panel.
2. Invoke it again when the Code Panel is already visibly adjacent.
3. Add another equivalent Panel, activate it more recently elsewhere, then invoke
   Open beside while the older equivalent remains adjacent.
4. Remove adjacency and invoke again.

Expected:

- First invocation creates Code immediately right of Agent at 50/50 when usable.
- Repeated invocation focuses the adjacent Panel without duplication or movement.
- Adjacent-first wins over a newer non-adjacent equivalent.
- Without adjacency, the current-Voyage MRU equivalent moves beside Agent.
- No Panel is moved from another Voyage.

Error cases:

- Rapid repeated invocation creates at most one Panel.
- At constrained width, the target is activated and its Dockview group is
  maximized instead of creating unusably narrow Panels.

### TEST_CASE_M1_5B — Agent to Code maximized and restore

Steps:

1. Invoke Open maximized when Code exists and when it does not.
2. Restore using visible pointer and keyboard controls.
3. Serialize/restore, evict/restore the controller, and exercise undo/redo.

Expected:

- The Code tab is active before its group is maximized.
- Dockview group maximize is used; browser fullscreen is not requested.
- Restore preserves the underlying topology and retained iframe identity where
  promised.
- Each user command produces one coordinator mutation/history checkpoint.

Phase 0 result for `TEST_CASE_M1_5A` and `TEST_CASE_M1_5B`: **GO**. The generic
durable surface-opening model, semantic browser harness, and executable evidence
are recorded in `docs/phase-0/surface-opening-coordinator-results.md`. Agent →
Code remains an acceptance fixture rather than a special target-kind path; the
same contract also proves Agent → Forms. The browser proof derives adjacency
from canonical serialization plus measured bounds of a real nested Dockview
layout, stores validated canonical before/after envelopes in atomic history,
restores those envelopes only through the guarded `fromJSON` boundary, and
exposes the complete tester workflow through labeled semantic controls and
visible status evidence. A shared guarded topology normalizer compares the full
ordered nested grid, branch orientations, leaves/groups, supported sizing,
tabs/active views, and maximized path after every command. Rejected create
transactions restore the prior canonical layout and dispose their newly-created
runtime, release its budget registration exactly once, and leave the surviving
runtime unchanged.

### TEST_CASE_M1_5C — Temporary foreground Split View

Steps:

1. From a Panel inside a populated Voyage, invoke **Open in Split View** and
   choose another compatible registered surface of the same Craft that is not
   currently a durable Voyage Panel. Repeat with a permitted cross-Craft surface.
2. Confirm the foreground presents the invoking and selected surfaces together
   without exposing unrelated Voyage Panels.
3. Change live state in both retained surfaces, then choose Back to Voyage.
4. Resize the sash, maximize and restore either surface, and exit while one side
   is maximized.
5. Repeat with representative Agent + Forms and Forms + Code pairs, after
   switching Voyages, and after a browser reload or controller
   eviction boundary supported by the selected design.

Expected:

- The foreground experience is clearly temporary and provides an obvious Back
  to Voyage action.
- A transient restricted Dockview controller owns only live Split View geometry:
  its resize sash works, but closing, adding, moving, arbitrary docking,
  floating, and popouts are disabled.
- The trusted target definitions classify each surface as leaseable,
  recreatable-transient with explicit state semantics, or unsupported. The picker
  defaults to the invoking Craft, permits compatible cross-Craft choices, and
  disables unsupported combinations with a deterministic reason.
- Wide mode uses two resizable groups; narrow mode uses one group with two tabs
  and initially shows the invoking surface. Returning wide preserves the prior
  ratio during that invocation; exit or refresh resets it to 50/50.
- Either transient surface can maximize and visibly restore to the split; exiting
  while maximized cleans up identically. Maximizing a single durable Panel remains
  available without creating Split View.
- Entering, resizing, maximizing, switching, or leaving causes no underlying
  Voyage Dockview mutation event, `fromJSON` call, layout write, revision change,
  or history checkpoint.
- Existing-runtime equivalence selection prevents accidental duplicate runtimes, but
  the durable Panel is never moved. An absent second surface uses a namespaced
  Split-only target/runtime without creating a Panel or recency row.
- Each retained runtime has exactly one attachment lease/host; its identity is
  preserved after return. When the selected second surface was absent, one
  collision-safe Split-only runtime is created without a Panel row and disposed
  exactly once on exit.
- The invoking Voyage controller cannot be evicted while leases are active, and
  its pin is released only after runtimes return to their original hosts.
- Returning restores the exact prior Voyage topology, active location, and
  retained iframe identities promised by the lifecycle contract.
- Browser Back and visible Back are idempotent. Direct links resolve durable
  targets without layout mutation. Refresh reconstructs Split View and explicitly
  does not promise pre-refresh DOM identity. No hidden durable layout authority
  is introduced.

Error cases:

- If either invoking or selected surface cannot resolve, show recovery UI and leave the Voyage layout
  untouched.
- Repeated entry/exit and rapid Back actions do not leak controllers, duplicate
  Panels, or lose the return location.
- Partial attachment/target failure rolls back runtime leases without snapshot
  restoration; subscriptions, focus containment, controller pins, and transient
  runtimes clean up exactly once.
- Removing either durable Panel, replacing its generation-bearing renderer host,
  deleting/replacing the Voyage, or removing the target/plugin during an active
  lease never resurrects stale state. Reattach only to the exact current host;
  otherwise dispose/release once and return to the authoritative Voyage.
- Renderer init/dispose and runtime attach/detach/dispose counts prove one physical
  payload and host throughout. Hidden original-controller relayout cannot reclaim
  it, and no private Dockview DOM is queried or moved.
- At constrained widths, use the tested single-surface/focus fallback rather
  than an unusably narrow split.

Phase 0 result: **GO**. The isolated state-machine and Chromium evidence is
recorded in `docs/phase-0/split-view-contract-results.md`. The executable suite
proves the restricted transient-controller, public renderer-root, runtime-lease,
responsive geometry, native sash/maximize, route, durability, and teardown
contracts above; it does not constitute production workbench integration.

## Required validation commands

The implementer and independent tester must record the exact commands actually
available on the branch. At minimum, evidence must include:

```bash
pnpm check-types
pnpm exec eslint spikes/dockview-contract tests/dockview-contract \
  playwright.dockview-contract.config.ts vite.dockview-contract.config.ts
pnpm exec vitest run --config vitest.dockview-contract.config.ts
pnpm exec playwright test --config playwright.dockview-contract.config.ts
git diff --check
```

For a long focused browser run, use:

```bash
vibe-agent callback \
  "pnpm exec playwright test --config playwright.dockview-contract.config.ts"
```

## Independent tester workflow

1. Create a fresh tester bead referencing `vkvw-4wf7.6` and this document.
2. Use the Playwright CLI snapshot/ref loop for browser cases and record a
   transcript under `/tmp` with generated semantic locator hints.
3. Run the focused committed unit/browser checks independently.
4. Add a bead comment containing JSON keyed by every `TEST_CASE_M1_*` ID with
   `PASS`, `FAIL`, `BLOCKED`, or `SKIPPED`, plus commands, URLs, and artifacts.
5. Clean up browser/server processes and untracked transient artifacts.

## Milestone exit criteria

- M1.1 through M1.5 are implemented and individually reviewed.
- Every test case above has implementer evidence and independent tester evidence.
- All failures complete the implementation → review → tester loop.
- The Phase 0 artifact gives a justified GO/NO-GO decision and names intentional
  reload or unsupported behavior precisely.
- `vkvw-4wf7.6` and the M1 epic close only after independent tester approval.
