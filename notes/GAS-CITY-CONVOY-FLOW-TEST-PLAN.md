# Gas City Convoy Flow Test Plan

## Purpose

Prove, with realistic integration tests, that VD can lean on Gas City-native primitives for feature execution instead of rebuilding a custom workflow runtime.

The tests should use:

- **real `gc` binary**
- **real city/rig configuration**
- **real bead store behavior**
- **real `gc convoy expand-ready ... --on <graph.v2 formula>`**
- **real `gc sling <target> <feature-bead> --on <graph.v2 formula>` semantics**
- **real convoys**
- **real formula/check/control behavior where available**
- **mock agent sessions only**

The mocked layer should stand in for actual Codex/Claude/VK sessions by doing what an agent would mechanically do after receiving work:

1. query for ready routed beads
2. inspect a bead
3. write structured result metadata/files
4. close or update the bead

This keeps the tests deterministic while still validating Gas City as the orchestration substrate.

---

## Architecture Under Test

Target model:

```text
Feature beads      = product work graph
Bead dependencies  = feature ordering
Convoy             = execution batch / project / wave
Graph sling         = per-feature lifecycle expansion
Gas City routing   = step delivery to role targets
Check/control      = mechanical gates and retries
Mock agents        = deterministic bead result writers
VD                 = thin setup/read-model layer, not workflow runtime
```

The tests should answer whether this stack is enough for the workflows we want:

- dependency-aware parallel feature execution
- dev/reviewer/tester workflows
- gates before phase transitions
- structured review/test result validation
- retry/loop-back to dev
- convoy progress and landing semantics

---

## Gas City v2 Concepts to Lean Into

The implementation should bias toward Gas City primitives instead of recreating VD-specific orchestration tables.

### Strongly prefer

- **Beads as authoritative state:** feature status, workflow expansion links, role outputs, check results, and blocking relationships should be queryable from beads.
- **Bead dependencies for ordering:** product feature dependencies should be native blocking edges, not a parallel scheduler graph stored elsewhere.
- **Convoys as batch objects:** use convoys for execution waves/projects/releases, progress, owner/notify metadata, target branch, merge policy, and stranded-work diagnostics.
- **graph.v2 source workflows for user-visible workflows:** prefer `gc sling --on <graph.v2 formula>` for dev/review/test flows where VD needs per-step visibility, routing, retries, and auditability.
- **`gc convoy expand-ready`:** treat ready-child convoy expansion as a GC-native command that filters the bead graph through `Ready()` and delegates every selected feature to the production `gc sling --on` graph-routing/source-workflow path.
- **`gc formula cook --attach` only for primitive assertions:** use it to prove low-level blocking-dependency semantics, not as the production feature-run expansion path.
- **Orders for mechanical automation:** use GC orders to invoke small idempotent controller-side operations such as `gc convoy expand-ready`; do not hide a scheduler in VD shell glue.
- **Pull routing:** route beads with `gc.run_target` / `gc.routed_to` and let agents discover ready work through normal work queries.
- **Packs/city/rig boundaries:** keep reusable workflow behavior in pack assets, local deployment policy in city/rig config, and machine-local paths/state out of portable definitions.
- **Mechanical checks:** model gates as scripts/control checks over bead metadata/artifacts rather than as trusted natural-language agent responses.

### Use carefully

- **Convoys:** they are excellent grouping/progress objects, but they are not sufficient by themselves to expand a feature graph into per-feature runs.
- **Orders:** they should trigger small idempotent operations, not hide a full custom workflow engine in shell.
- **Coordinator agents:** useful for judgment and summarization, but strict scheduling/gating should remain mechanical.
- **Worktrees:** use as isolation for mutating code work; do not make filesystem layout the architecture.
- **Team slots/lanes:** useful as capacity/routing policy, but should not become another authoritative task state machine.

### Avoid

- VD-owned workflow runtime state duplicating bead/formula state
- giant roadmap formulas containing every feature in one molecule
- formulas that hardcode concrete VK session UUIDs
- directory-implied identity
- opaque planner behavior that cannot explain why a bead is ready, blocked, assigned, or retried

---

## Test Harness Design

### `TestGasCity`

Creates an isolated temporary Gas City environment per test or test suite.

Responsibilities:

- create temp city directory
- create temp rig/workspace directory
- write `city.toml`
- write formula TOML files
- write check scripts
- configure bead provider
- expose helper methods for `gc` and `bd`
- clean up temp files/processes

Preferred shape:

```text
tmp/
  city/
    city.toml
    formulas/
      dev-review-test-feature.toml
    scripts/
      check-typecheck.sh
      check-review-approved.sh
      check-test-passed.sh
  workspace/
    repo/
```

The harness should execute the checked-in or locally built `gc` binary, not call Gas City internals directly.

### `MockAgent`

Represents a deterministic session/agent target.

Responsibilities:

- query for ready beads routed to a target
- inspect bead instructions/metadata
- submit expected result metadata or files
- close bead on success
- optionally submit invalid result data for negative tests

Important constraint:

> The mock agent should interact through CLI/store-level primitives, not private Gas City internals.

Example behavior:

```bash
bd ready --metadata-field gc.routed_to=<target> --unassigned --limit=1 --json
bd show <bead-id> --json
bd update <bead-id> --set-metadata vd.result.review.status=approved
bd close <bead-id>
```

### `ConvoyExpander` / `gc convoy expand-ready`

This is now expected to be a GC-native primitive, not a VD-owned scheduler.
VD may invoke it, and GC orders may invoke it, but the filtering and
idempotency rules live in Gas City.

Responsibilities:

1. inspect a convoy
2. find child feature beads that are ready and not already expanded
3. enforce bounded concurrency
4. call `gc sling <target> <feature-bead> --on <graph.v2 formula>` through the same source-workflow launch machinery used by direct sling
5. preserve GC canonical linkage metadata on the feature bead and workflow root
6. leave team/worktree policy as formula variables or pack/city configuration, not hidden VD state

This layer should remain small. If it grows into a custom workflow engine, that is evidence the architecture is wrong or Gas City needs another upstream primitive.

---

## Canonical Formula Under Test

Use a realistic per-feature lifecycle formula rather than toy examples.

Logical workflow:

```text
dev
  ↓
typecheck gate
  ↓
review
  ↓
review approval gate
  ↓
test
  ↓
test pass gate
  ↓
feature complete
```

Rejected/failing paths:

```text
typecheck fails        → dev again
review requests change → dev again
test fails             → dev again
```

The formula should route roles with variables:

```toml
metadata = { "gc.run_target" = "{{dev_target}}" }
metadata = { "gc.run_target" = "{{reviewer_target}}" }
metadata = { "gc.run_target" = "{{tester_target}}" }
```

The tests should use the same formula style we expect VD to generate or ship as a default pack asset.

---

## Test Cases

### 1. Direct graph sling starts a source workflow and routes work

**Goal:** prove `gc sling <target> <feature-bead> --on <graph.v2 formula>` is the canonical per-feature expansion primitive.

Setup:

1. create one feature bead
2. run `gc sling` with the per-feature graph formula

Assertions:

- source feature records `workflow_id`
- workflow root records `gc.source_bead_id`, `gc.root_bead_id`, `gc.workflow_id`, and scope metadata
- formula steps receive `gc.run_target`, `gc.routed_to`, and assignee values from formula variables / role binding
- `gc hook <target>` sees the ready routed work through the target's effective work query
- a duplicate direct sling without cleanup is rejected by source-workflow singleton protection

CLI exercised:

```bash
gc sling <rig>/team-1-dev <feature-bead-id> \
  --on dev-review-test-feature \
  --var dev_target=<rig>/team-1-dev \
  --var reviewer_target=<rig>/team-1-reviewer \
  --var tester_target=<rig>/team-1-tester
gc hook <rig>/team-1-dev
```

### 1b. Primitive formula attachment blocks feature completion

**Goal:** prove `gc formula cook --attach` still supplies the low-level blocking-dependency behavior graph sling builds on.

Setup:

1. create one feature bead
2. attach `dev-review-test-feature`

Assertions:

- formula root exists
- step beads exist if molecule mode materializes them
- feature bead has a blocking dependency on the formula root
- feature bead remains open while formula root is open
- feature metadata records formula/root linkage

CLI exercised:

```bash
gc formula cook dev-review-test-feature \
  --attach <feature-bead-id> \
  --var issue=<feature-bead-id> \
  --var dev_target=<rig>/team-1-dev \
  --var reviewer_target=<rig>/team-1-reviewer \
  --var tester_target=<rig>/team-1-tester
```

This test must not assert production routing from `gc formula cook --attach`.
Routing belongs to the `gc sling --on` graph path.

### 2. Convoy groups feature beads and reports progress

**Goal:** prove convoys are sufficient as the execution batch object.

Setup:

1. create three feature beads
2. create owned convoy with those features

Assertions:

- convoy bead exists
- each feature has the convoy as parent/container
- `gc convoy status` shows all three children
- closing one feature updates progress
- owned convoy does not auto-land unexpectedly

CLI exercised:

```bash
gc convoy create "Checkout rewrite" <A> <B> <C> \
  --owned \
  --owner pm \
  --notify pm \
  --merge local \
  --target main
```

### 3. Feature dependency graph expands in waves

**Goal:** prove bead dependencies can drive high-level feature ordering.

Graph:

```text
A
├── B depends on A
└── C depends on A
D depends on B and C
```

Flow:

1. create A/B/C/D
2. add blocking dependencies
3. create convoy containing A/B/C/D
4. run `gc convoy expand-ready <target> <convoy-id> --on dev-review-test-feature` once
5. complete A's attached formula
6. run `gc convoy expand-ready` again
7. complete B/C
8. run `gc convoy expand-ready` again

Assertions:

- first expansion starts a graph source workflow only for A
- second expansion starts graph source workflows for B and C
- D remains unexpanded until both B and C are complete
- final expansion starts D

### 4. Bounded parallel feature execution

**Goal:** prove concurrency can be bounded without a custom workflow runtime.

Setup:

```text
A, B, C are independent and ready
max_active_features = 2
team slots = team-1, team-2
```

Assertions:

- first `gc convoy expand-ready --max-active 2` invocation starts exactly two features
- third feature remains pending/unexpanded
- completing one active feature frees a slot
- next expansion starts the third feature

Canonical metadata to assert:

```text
workflow_id=<formula-root>
gc.source_bead_id=<feature-bead>
gc.root_bead_id=<formula-root>
gc.workflow_id=<formula-root>
gc.routed_to=<role target>
gc.execution_routed_to=<role target for control/checks>
```

VD may cache `vd.execution.*` fields for UI/read-model convenience, but those
fields must be rebuildable from canonical GC bead/workflow metadata.

### 5. Team/worktree assignment is stable

**Goal:** prove a feature run keeps a consistent team and isolated worktree.

Setup:

1. configure two team slots
2. expand two features

Assertions:

- each feature gets exactly one team slot
- each feature gets a unique worktree path
- dev/reviewer/tester targets are from the same slot
- subsequent formula steps continue using the same route variables
- completed slot can be reused by a later feature

### 6. Dev → Reviewer → Tester happy path

**Goal:** prove the normal lifecycle works with real GC state and mock agents.

Flow:

1. dev mock picks up dev bead and closes it
2. typecheck passes
3. reviewer mock picks up review bead, writes valid approval, closes it
4. review check passes
5. tester mock picks up test bead, writes valid pass, closes it
6. test check passes
7. formula root closes
8. feature bead becomes complete/closable

Assertions:

- reviewer is not ready before dev closes and typecheck passes
- tester is not ready before review approval passes
- feature does not complete before formula success
- final feature metadata includes review/test pass state

### 7. Typecheck failure returns to dev

**Goal:** prove pre-review gates prevent invalid code from reaching review.

Flow:

1. dev closes implementation bead
2. typecheck check returns failure
3. workflow retries/loops to dev
4. dev closes second implementation bead
5. typecheck passes
6. reviewer becomes ready

Assertions:

- reviewer is not ready while typecheck fails
- second dev attempt is routed to the original dev target/team
- attempt count is visible in bead metadata or child bead naming

### 8. Reviewer rejection returns to dev

**Goal:** prove structured review decisions can control workflow direction.

Flow:

1. dev succeeds
2. reviewer writes valid structured result: `changes_requested`
3. review gate fails intentionally
4. workflow returns to dev
5. dev fixes
6. reviewer writes valid structured result: `approved`
7. workflow proceeds to tester

Assertions:

- tester is not ready after rejected review
- next ready role is dev
- rejection reason is preserved on bead metadata/result payload
- second review approval advances workflow

### 9. Tester failure returns to dev

**Goal:** prove late-stage failures restart the full dev/review/test lifecycle.

Flow:

1. dev succeeds
2. reviewer approves
3. tester writes valid structured result: `failed`
4. test gate fails intentionally
5. workflow returns to dev
6. dev fixes
7. reviewer approves again
8. tester passes

Assertions:

- tester failure does not merely retry tester
- next ready role is dev
- reviewer runs again after dev fix
- attempt count is bounded
- max attempts produce deterministic failure/escalation

### 10. Invalid structured result does not advance

**Goal:** prove XML/JSON/result-contract validation can be mechanical without trusting agent prose.

Flow:

1. reviewer mock submits malformed result
2. review validation check runs
3. workflow does not advance
4. reviewer receives another attempt or correction bead
5. reviewer submits valid result
6. workflow advances

Assertions:

- malformed result is persisted for diagnostics
- validation failure is visible
- tester is not ready until valid approval exists
- retry/correction target is the reviewer, not dev, unless policy says otherwise

### 11. Convoy stranded work is meaningful

**Goal:** prove `gc convoy stranded` helps operators debug stuck execution.

Setup:

1. create convoy
2. expand a feature into routed work
3. intentionally omit a matching mock agent/route

Assertions:

- stranded command surfaces ready unassigned/unpicked work
- VD can map stranded bead back to convoy and feature
- adding the missing mock route allows work to proceed

### 12. Order-driven expansion smoke test

**Goal:** prove the scheduler can be a GC order invoking the GC-native expander rather than a VD daemon.

Setup:

1. create `orders/expand-ready-features.toml`
2. create script command for expansion
3. create convoy with ready feature
4. run order manually

Assertions:

- order invocation expands ready feature
- repeated order invocation is idempotent
- already-expanded features are skipped
- completed features do not re-expand

CLI exercised:

```bash
gc order run expand-ready-features
```

The order command should invoke:

```bash
gc convoy expand-ready <target> <convoy-id> \
  --on dev-review-test-feature \
  --max-active <N> \
  --var dev_target=<role-binding> \
  --var reviewer_target=<role-binding> \
  --var tester_target=<role-binding>
```

---

## Idempotency Requirements

The expansion layer must be safe to run repeatedly.

Required guards:

- do not attach a formula if source-workflow metadata (`workflow_id`/`molecule_id` plus an open attached root) already exists
- rely on Gas City's source-workflow singleton/lock semantics for duplicate launch races
- do not exceed `max_active_features`
- do not reuse an occupied team slot
- do not create duplicate worktrees for the same feature run
- handle partial failure after graph sling starts a source workflow but before any supplemental VD read-model metadata is refreshed

Canonical GC metadata:

```text
workflow_id=<formula root bead id on the source feature>
molecule_id=<legacy formula root when applicable>
gc.source_bead_id=<feature bead id on workflow root>
gc.root_bead_id=<workflow root for all workflow beads>
gc.workflow_id=<workflow root for all workflow beads>
gc.workflow_store_ref=<city:...|rig:...>
gc.routed_to=<role target>
gc.execution_routed_to=<role target for control/check execution>
gc.outcome=<pass|fail|skipped...>
```

Supplemental VD read-model metadata, if used:

```text
vd.execution.convoy_id=<convoy bead id>
vd.execution.formula=dev-review-test-feature
vd.execution.status=<derived/cached only>
vd.execution.root=<derived/cached formula root bead id>
vd.execution.team_slot=team-1
vd.execution.worktree_path=<path>
vd.execution.started_at=<timestamp>
vd.execution.completed_at=<timestamp>
```

`vd.execution.*` must not be the authority for whether a feature is expanded,
running, blocked, or complete. It can exist only as rebuildable UI/cache data.

Tests should deliberately rerun expansion after each important state transition.

---

## What Should Be Mocked

Mock only what is expensive or nondeterministic:

- LLM output
- VK session creation
- actual editor/terminal session processes
- human UI interaction

Do not mock:

- `gc sling --on`
- `gc convoy expand-ready`
- `gc formula cook` primitive attachment assertions
- convoy commands
- bead creation/update/close
- dependency blocking/readiness
- check scripts
- routing metadata
- formula control/retry behavior

---

## Implementation Phases

### Phase 1: Harness and primitives

Deliverables:

- temp Gas City test harness
- CLI wrapper for `gc`
- CLI wrapper for `bd`
- helper to create feature beads
- helper to create blocking dependencies
- helper to create convoys
- helper to run direct `gc sling --on`
- helper to run primitive `gc formula cook --attach` assertions
- snapshot/assert helpers for bead metadata and dependencies

Tests:

- direct graph sling starts a source workflow and routes work
- primitive formula attachment blocks feature completion
- convoy groups feature beads and reports progress

### Phase 2: Convoy expansion

Deliverables:

- GC-native `gc convoy expand-ready` command
- canonical GC metadata contract for expanded features
- source-workflow singleton/idempotency safeguards

Tests:

- feature dependency graph expands in waves
- bounded parallel feature execution
- team/worktree assignment is stable

### Phase 3: Workflow lifecycle

Deliverables:

- canonical `dev-review-test-feature` formula fixture
- mock dev/reviewer/tester agents
- check script fixtures
- structured result fixture format

Tests:

- happy path
- typecheck failure returns to dev
- reviewer rejection returns to dev
- tester failure returns to dev
- invalid structured result does not advance

### Phase 4: GC-native operations

Deliverables:

- order fixture for `gc convoy expand-ready`
- stranded-work fixture
- convoy landing/completion assertions

Tests:

- convoy stranded work is meaningful
- order-driven expansion smoke test
- owned convoy landing behavior

### Phase 5: VD integration boundary

Deliverables:

- document production API boundary
- define which code lives in VD vs pack/order/script
- define read model for UI

Questions to answer:

- Does VD invoke `gc order run`, or does the GC controller own the order loop?
- Does VD create convoys directly, or ask GC to create them through a module action?
- Where do team slot policies live: city config, VD state, formula vars, or bead metadata?
- Does worktree creation belong to VD/VK or formula setup scripts?

---

## Success Criteria

This architecture is viable if the tests prove:

1. feature beads can remain the source of truth
2. convoys can represent execution batches
3. `gc sling --on` / `gc convoy expand-ready --on` cleanly expands feature beads into source workflows
4. bead dependencies drive feature ordering
5. multiple ready features can run concurrently with bounded capacity
6. checks can enforce strict phase gates
7. failed gates can route back to the intended phase
8. structured results can be validated mechanically
9. repeated expansion is idempotent
10. VD does not need to persist or drive every workflow step itself

If these tests require a large custom scheduler, custom state machine, or custom retry system, then Gas City is not carrying enough of the runtime burden and we should either:

- add a missing primitive upstream to Gas City, or
- reconsider whether replacing the workflow engine with Gas City is worth it.

---

## Open Design Questions

1. **Wisp vs molecule:** should production use lightweight wisps for short workflows or cooked molecules for full per-step visibility?
2. **Formula finalization:** what exact event/metadata should mark the attached feature bead succeeded or failed?
3. **Check semantics:** should failed structured validation retry the same role or route to a separate correction role?
4. **Team slots:** should team capacity be represented as configured GC agents, convoy metadata, or VD state?
5. **Worktrees:** should each active feature always receive its own worktree, or should pure-doc/test-only features be allowed to share?
6. **Order lifecycle:** should expansion be periodic, event-driven, manual, or all three?
7. **Atomic claims:** do `gc convoy expand-ready` plus source-workflow singleton locks cover all concurrent order-run races, or do we need a stronger bead-level claim primitive?
8. **UI read model:** should VD render directly from beads/convoys, or maintain a denormalized projection for speed?

---

## Recommended First PR

Do not start by wiring this into the VD UI.

This branch should add a standalone integration test suite and fixtures that prove the data model:

```text
real gc + real beads + real convoys + real graph.v2 source-workflow expansion + mock agents
```

Recommended initial tests:

1. `direct graph sling starts a source workflow and routes work`
2. `convoy groups feature beads and reports progress`
3. `feature dependency graph expands in waves`
4. `bounded parallel feature execution`
5. `dev reviewer tester happy path`

After those pass, implement negative gate/retry cases using graph.v2/control-dispatch semantics, not VD hand-rolled loopbacks.
