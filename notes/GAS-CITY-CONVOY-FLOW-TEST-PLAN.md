# Released Gas City Workflow Compatibility Plan

## Current merge target

This branch must be honest about the Gas City version VD can install and run.
VD should depend only on officially released Gas City functionality. The VD
container currently pins Gas City to `v1.4.1`, so the supported runtime story is:

- single-feature workflow launch with `gc sling <target> <feature-bead> --on <graph.v2 formula>`
- convoys as grouping/status/progress objects
- normal Gas City hooks/work queries for agent pickup
- VD-owned VK workspace/session bridge behavior
- a VD ready-bead launcher that repeats the released single-feature
  `gc sling --on` command for multiple currently-ready source beads in one VK
  workspace, plus CLI/watch and UI entry points

This branch should **not** claim support for automatic convoy ready-child
expansion as a Gas City command. The local Gas City `expand-ready` patch is
reference material only and is not available in the pinned VD runtime.

---

## Supported released-GC flow

For one feature bead:

```bash
gc sling <target> <feature-bead-id> \
  --on dev-review-test-feature \
  --var dev_target=<role-binding> \
  --var reviewer_target=<role-binding> \
  --var tester_target=<role-binding>
```

Gas City owns:

- formula compilation
- graph.v2 source-workflow creation
- `workflow_id` linkage from source feature bead to workflow root
- `gc.source_bead_id`, `gc.root_bead_id`, and `gc.workflow_id` metadata
- `gc.run_target` to `gc.routed_to` / assignee routing
- control/check/retry semantics defined by the formula
- agent pickup through `gc hook` / effective work queries

VD owns:

- creating/adopting the VK workspace
- providing the GC↔VK session bridge
- invoking released `gc` commands
- selecting ready source beads inside a workspace/optional convoy filter using
  released `gc convoy status --json` membership
- holding a VD workspace-level lock around selection plus launch, even when a
  convoy filter is provided
- rendering a read model from Gas City/bead state
- storing only supplemental UI/cache metadata when necessary

VD must not become a workflow runtime. Its launcher may coordinate which source
beads receive a released `gc sling --on` call, but Gas City remains responsible
for the workflow graph after each launch.

---

## Convoys in the released runtime

Convoys are still useful with Gas City `v1.4.1`.

Use them for:

- grouping related feature beads into a project/release/wave
- showing progress/status
- recording owner/notify/merge/target metadata
- debugging stranded or incomplete work

Example:

```bash
gc convoy create "Checkout rewrite" <feature-a> <feature-b> <feature-c> \
  --owned \
  --owner pm \
  --notify pm \
  --merge local \
  --target main

gc convoy status <convoy-id>
```

Convoys do **not** automatically launch all ready child features in the released
Gas City runtime. VD may use a convoy filter while launching ready source beads,
but it still does so by issuing one released `gc sling --on` command per bead.

---

## What convoy expansion would mean

Convoy expansion means:

> Scan the children of a convoy, find the ones that are ready and not already
> running, and automatically start a graph.v2 workflow for each selected child,
> optionally respecting a maximum number of active feature workflows.

Example:

```text
Convoy: Checkout rewrite
  A: DB schema      ready
  B: API endpoints  blocked on A
  C: Frontend form  ready
```

Automatic convoy expansion would launch workflows for A and C, skip B, and
possibly enforce a cap such as “only two active feature workflows at once.”

That is useful later for automatic parallel waves of work. For this merge, VD
only implements the narrow source-bead launch coordination needed to support
parallel ready beads inside one VK workspace; it does not implement a new GC
workflow engine.

---

## Future/upstream gap: convoy ready expansion

Released Gas City `v1.4.1` does not provide a command that does all of:

1. inspect a convoy
2. select open children from the store's ready set
3. skip children with live source workflows
4. enforce concurrency/capacity
5. launch one graph.v2 workflow per selected feature through the normal sling path
6. remain idempotent under retries/concurrent automation

If this capability becomes important, it should preferably land upstream in Gas
City rather than as a VD-side scheduler or private fork. A possible upstream
primitive would be shaped like:

```bash
gc convoy expand-ready <target> <convoy-id> \
  --on <graph.v2 formula> \
  --limit <N> \
  --max-active <N>
```

That command is a proposal/gap, not part of the current VD runtime contract.

---

## VD ready-bead launcher

Because a VK workspace commonly contains multiple development beads, VD needs a
small launcher that can start independent ready beads in parallel using official
Gas City `v1.4.1` commands.

The launcher owns only:

- `bd ready --json` discovery in the workspace
- optional parent filtering via `bd ready --parent`
- optional convoy filtering by intersecting `bd ready` with child IDs from
  `gc convoy status <convoy-id> --json`
- per-bead formula override from `vd.gas_city.formula` or `gc.formula`
- formula supplied by an explicit UI/CLI/agent-triggered launch
- a VD workspace lock around `select -> count active -> launch`; the lock has
  stale cleanup so a crashed process does not permanently strand launches
- a best-effort active workflow cap based on unique live source bead IDs from
  source `workflow_id` metadata and workflow-bead `gc.source_bead_id` metadata
- graph.v2 formula validation with released `gc formula show --json` before
  calling `gc sling --on`
- a strict cwd/store contract: `workspacePath` is the bead-store cwd for
  `bd ready`, and `cityPath`/Gas City config must resolve those same source
  bead IDs for `gc sling --on`; if not, released `gc sling` fails closed rather
  than VD manufacturing workflow state
- duplicate-safe handling of GC source-workflow singleton conflicts
- optional `--nudge` on the released `gc sling` command
- UI invocation from the Gas City panel
- CLI invocation via `node scripts/gas-city-ready-beads.mjs launch ...`
- non-polling automatic wake via `node scripts/gas-city-ready-beads.mjs watch ...`,
  which follows released `gc events --follow`, debounces bead.closed/bead.updated
  events, and re-runs the same launcher without busy-looping

The launcher must not:

- create routed workflow beads manually
- inspect or advance dev/review/test steps
- parse agent responses
- decide workflow outcome
- keep agent turns busy-looping while idle
- treat `vd.*` metadata as authoritative workflow state

The product boundary is:

```text
VD: user/workspace/session UX + bridge + read model + source-bead launch coordination
GC: released sling/formula/convoy/hook primitives
```

---

## Validation target for this branch

Merge validation should prove the released-GC path:

1. VD installs an official Gas City release (`v1.4.1` by default).
2. VD-generated/runtime config can use the local `gc` binary.
3. A single feature bead can be launched with `gc sling --on graph.v2`.
4. Multiple ready beads in one workspace can be launched by repeating the same
   released command under a VD workspace lock.
5. Gas City routes workflow steps to configured targets.
6. Hooks/work queries can see routed work.
7. VD does not depend on unreleased `gc convoy expand-ready`.

Standalone full GC-native convoy auto-expansion tests should be treated as
future validation blocked on an upstream Gas City primitive.

---

## Metadata authority

Gas City/beads remain authoritative for workflow state:

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

VD may cache supplemental read-model fields, but they must be rebuildable:

```text
vd.execution.formula=<formula name>
vd.execution.root=<derived/cached workflow root>
vd.execution.status=<derived/cached only>
vd.execution.worktree_path=<path if VD/VK owns it>
```

`vd.execution.*` must not decide whether a feature is expanded, running,
blocked, or complete.

---

## Recommended review resolution

Tell review:

> We pivoted VD back to officially released Gas City functionality. The current
> runtime contract is single-feature `gc sling --on graph.v2`, convoys for
> grouping/status, hooks/work queries for pickup, and a VD ready-bead
> launcher that repeats the released command for multiple ready source beads
> under a workspace lock. We removed current-runtime claims around
> `gc convoy expand-ready` because that command is not available in released Gas
> City `v1.4.1`, and VD will not fork Gas City or implement GC workflow
> semantics. GC-native convoy ready expansion is documented only as a
> future/upstream gap.
