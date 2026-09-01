# Gas City handoff for `vk/8b79-vd-workflows`

This note is for the developer continuing the workflow-system work on
`origin/vk/8b79-vd-workflows`. Use this branch,
`vk/42a2-vd-gas-city-plug`, as the Gas City integration/prototype branch.

## Executive recommendation

Build the next slice from `origin/vk/8b79-vd-workflows`, then selectively port
the GC↔VK bridge and released-Gas-City workflow pieces from this branch.

Do **not** continue growing this branch as the long-term integration base. The
workflows branch is the right foundation because it is where core workflow
primitives are being developed. This branch should be treated as:

- implementation donor,
- behavior/reference branch,
- documentation source,
- and a set of reviewed constraints about where Gas City owns workflow logic.

## Core architecture decision

Keep the split clean:

| Layer | Should own | Should not own |
| --- | --- | --- |
| `Vktest` workflow engine | generic workflow/session primitives, provider seams, parent/child session visibility, auditable result surfaces | Gas City role names, Gas City convoy semantics, formula-specific branching |
| `vibe-kanban-vscode-web` / VD | bridge package, plugin UI, generated runtime config, local `gc` install/supervision, user-facing workflow modes | authoritative workflow state, formula execution, step advancement, scheduler semantics |
| Gas City | beads, formulas, graph.v2 source workflows, sling routing, hooks/work queries, orders, controller/health patrol | VD/VK UI state, VK workspace creation UX |
| beads | durable work truth, dependencies, metadata, ready queries | transient dashboard-only state |

Rule of thumb: Vktest can expose “workflow provider” and “external orchestrator”
seams. It should not know what a Gas City “reviewer”, “convoy”, “formula”, or
“wisp” means unless that data is opaque provider metadata.

## Branches and current state

Observed locally on this workspace:

- `vibe-kanban-vscode-web`: `vk/42a2-vd-gas-city-plug`
  - pushed to `origin/vk/42a2-vd-gas-city-plug`
  - latest relevant commit: `f4cf9623 Make ready bead locks owner-token safe`
- `gascity`: `vk/42a2-vd-gas-city-plug`
  - latest relevant commit: `d3f92b00c Add GC convoy ready expansion command`
  - this is **not** part of the released VD runtime contract unless it is
    upstreamed/released and VD pins a version containing it
- `Vktest`: branch exists as `origin/vk/8b79-vd-workflows`
  - use this as the new base for core workflow integration work

## What to port from this branch

Port in this order. Keep each step small and separately reviewable.

### 1. Port the docs/architecture constraints first

Useful files:

- `docs/gas-city/bridge-migration-sequencing.md`
- `docs/gas-city/workspace-orchestration-flows.md`
- `notes/GAS-CITY-CONVOY-FLOW-TEST-PLAN.md`
- `docs/gas-city/container-runtime.md`
- `docs/gas-city/non-docker-verification.md`

Most important constraints to preserve:

- VD-owned bridge is the target architecture.
- Gas City CLI remains the orchestration engine.
- VD/VK owns user-facing workspace/session UI.
- Generated GC runtime config must not mutate the source-controlled
  `gascity` repo.
- Released runtime must not claim `gc convoy expand-ready` support.
- `vd.execution.*` may be a rebuildable read-model/cache only, never
  authoritative workflow state.

### 2. Port the GC↔VK bridge package

Useful files:

- `packages/gc-session-vibe/`
- especially:
  - `packages/gc-session-vibe/bridge/bridge.go`
  - `packages/gc-session-vibe/bridge/atomic.go`
  - `packages/gc-session-vibe/bridge/bridge_test.go`
  - `packages/gc-session-vibe/scripts/gc-session-vibe`
  - `packages/gc-session-vibe/README.md`

Bridge environment contract to preserve:

- `VIBE_BASE_URL`
- `VIBE_REPO_MATCH`
- `VIBE_TARGET_BRANCH`
- `VIBE_EXECUTOR*`
- `VIBE_ADOPT_WORKSPACE_ID`
- `VIBE_ADOPT_SESSION_ID`
- `VIBE_WORKING_DIR`
- `VIBE_SESSION_LABEL`
- `VIBE_STATE_ROOT` / `GC_EXEC_STATE_DIR`

Recommended workflows-branch target:

- expose this as an external workflow/session provider integration,
- keep Gas City-specific details in the bridge package and VD plugin layer,
- pass opaque IDs/metadata through generic workflow APIs.

### 3. Port runtime packaging/supervision if still needed

Useful commits/files:

- `d7441e96 Install Gas City in VD images`
- `d527f388 Supervise Gas City control plane in VD`
- `Dockerfile`
- `Dockerfile.vkvd`
- `supervisord.conf`
- `supervisord.vkvd.conf`
- `docs/gas-city/container-runtime.md`

Current desired container story:

- install official `gc` release directly in the VD image,
- run `gc supervisor run` under supervisor,
- default runtime paths:
  - `GC_HOME=/home/vkuser/.gc`
  - `XDG_RUNTIME_DIR=/var/tmp/vibe-kanban/gc-runtime`
- allow disabling with `ENABLE_GAS_CITY_SUPERVISOR=false`.

### 4. Port the Gas City Springboard/plugin UI only after the workflow seams fit

Useful files:

- `src/modules/plugins/gas-city/module.ts`
- `src/modules/plugins/gas-city/GasCityPanel.tsx`
- `src/modules/plugins/gas-city/types.ts`
- `src/modules/plugins/gas-city/city-config-renderer.ts`
- `src/modules/plugins/gas-city/local-pack-scanner.ts`
- `src/modules/plugins/gas-city/workspace-workflow.ts`
- `src/modules/plugins/gas-city/sling-command.ts`
- related tests in `src/modules/plugins/gas-city/*.test.ts`

Be careful: this area is UI-heavy and may have drifted from the workflows
branch/plugin system. Port behavior and tests, not blindly every component
shape.

### 5. Port the released ready-bead launcher only if it still fits

Useful files:

- `src/modules/plugins/gas-city/ready-bead-launcher.ts`
- `src/modules/plugins/gas-city/ready-bead-launcher.test.ts`
- `scripts/gas-city-ready-beads.mjs`

This launcher is intentionally a thin coordinator over released Gas City:

```bash
gc sling <target> <feature-bead-id> --on <graph.v2 formula>
```

It may:

- call `bd ready --json`,
- optionally filter by parent/convoy membership,
- validate the formula is `graph.v2`,
- hold a VD workspace-level lock,
- call released `gc sling --on` once per selected source bead,
- treat source-workflow singleton conflicts as duplicate-safe skips.

It must not:

- create workflow beads manually,
- route steps itself,
- parse agent responses,
- decide workflow outcomes,
- implement convoy expansion semantics,
- use `vd.execution.*` as authoritative workflow state.

If the workflows branch has a better generic “launch ready work” primitive,
adapt this code to that seam instead of preserving its exact API.

## What not to port as a current dependency

Do **not** make workflows-branch VD depend on this Gas City command unless it is
officially upstreamed/released and the container pin is updated:

```bash
gc convoy expand-ready <target> <convoy-id> --on <graph.v2 formula>
```

The local Gas City commit is useful design reference:

- `gascity` commit `d3f92b00c Add GC convoy ready expansion command`
- files:
  - `cmd/gc/cmd_convoy_expand_ready.go`
  - `cmd/gc/cmd_convoy_expand_ready_test.go`
  - `internal/sling/convoy_expand_ready.go`

But current VD runtime contract is released `gc v1.4.1` behavior:

- `gc sling <target> <bead> --on <graph.v2 formula>`
- convoys for grouping/status/filtering
- hooks/work queries for pickup
- no GC-native convoy ready-child auto-expansion command

If automatic convoy expansion becomes required, prefer upstream Gas City work
over a VD-side scheduler.

## Suggested next implementation plan

### Step 0 — create the integration branch

Start from workflows:

```bash
git fetch origin
git checkout -b vk/<new-id>-gc-workflows origin/vk/8b79-vd-workflows
```

Then port one slice at a time from:

```bash
origin/vk/42a2-vd-gas-city-plug
```

### Step 1 — define the generic workflow-provider seam

In the workflows branch, decide the smallest generic interface needed for an
external orchestrator:

- launch/adopt a workspace session,
- attach opaque provider metadata,
- report child session/workflow status,
- provide auditable result summaries,
- expose a provider read model without owning provider semantics.

Keep Gas City concepts out of the core type names where possible. Use
provider-specific metadata for:

- formula names,
- role targets,
- source bead IDs,
- workflow root IDs,
- convoy IDs.

### Step 2 — bring up bridge package tests

Port `packages/gc-session-vibe` and make its tests pass before wiring UI.

Minimum validation:

```bash
cd packages/gc-session-vibe
go test ./...
```

### Step 3 — wire VD runtime config and plugin state

Port enough of the Gas City module to:

- store `gcBinary` and `cityPath`,
- run `gc session list`,
- adopt a VK workspace/session into GC,
- render/preview generated city config.

Avoid bringing in all panel affordances until the workflows branch has stable
navigation/workflow surfaces.

### Step 4 — wire explicit source-workflow launch

Support explicit launch:

```bash
gc sling <target> <source-bead-id> --on <graph.v2 formula>
```

The first end-to-end success criterion should be:

1. create/open VK workspace,
2. create or select a source feature bead,
3. launch graph.v2 formula through released `gc sling --on`,
4. confirm source bead has `workflow_id`,
5. confirm workflow/step beads have `gc.source_bead_id`, `gc.root_bead_id`,
   `gc.workflow_id`, and `gc.routed_to`,
6. confirm a configured Gas City hook/work query can see routed work.

### Step 5 — only then reintroduce ready-bead fanout

If needed, port the ready-bead launcher after single-feature launch is solid.
Keep it explicit and user/workspace-triggered at first. Do not turn it into an
ambient scheduler unless the workflows branch has a generic automation story or
Gas City orders are intentionally selected.

## Orders guidance for the workflows branch

Use Gas City orders for recurring or event-driven automation, not as the first
primitive for manual workspace workflow launch.

Good uses:

- nightly/weekly maintenance,
- “when bead.closed, trigger review/check” flows,
- manual named workflows via `gc order run`,
- deterministic exec checks that should run in the controller.

Avoid initially:

- replacing explicit user launch with hidden background automation,
- implementing convoy expansion via a dashboard loop,
- tying core Vktest workflow semantics to Gas City order internals.

## Formula design guidance

Prefer one parameterized graph.v2 formula when the workflow shape is mostly the
same. For example, optional UI work can be modeled with a variable:

```toml
[vars.ui_work]
default = "false"

[[steps]]
id = "implement"
title = "Implement"

[[steps]]
id = "ui-check"
title = "Do UI/visual validation"
condition = "{{ui_work}} == true"
needs = ["implement"]

[[steps]]
id = "review"
title = "Review"
needs = ["implement", "ui-check"]
```

When `ui_work=false`, Gas City filters out `ui-check`; the dependency edge to
the excluded step is ignored by graph application, so review only waits on
included dependencies.

Use a separate formula when the UI workflow materially changes the graph,
ownership, or defaults.

## Validation checklist before asking for review

For `vibe-kanban-vscode-web`:

```bash
npm run check-types
npm run test:server -- --run src/modules/plugins/gas-city
git diff --check
```

For `packages/gc-session-vibe`:

```bash
cd packages/gc-session-vibe
go test ./...
```

For Docker/supervisor changes:

```bash
docker buildx build --check -f Dockerfile .
docker buildx build --check -f Dockerfile.vkvd --build-arg VK_COMMIT=check .
```

For a real smoke, prefer installed local `gc` plus supervised
`gc supervisor run`; avoid Docker-in-Docker-only harnesses as the sole proof.

## Review prompts to give the next reviewer

Ask review to check:

- no Gas City-specific concepts leaked into generic Vktest workflow primitives,
- VD bridge state is supplemental and rebuildable,
- released `gc` commands only unless version pin contains newer GC behavior,
- `gc sling --on graph.v2` path is used for source-workflow launch,
- workflow state authority remains in Gas City/beads metadata,
- ready-bead fanout is not a hidden scheduler,
- bridge failure keeps the VK workspace usable,
- tests cover duplicate/conflict/retry and failure-boundary behavior.

## Related beads

- `vkvw-jqzs` — **Plan Gas City plugin integration on service-orchestrator branch**
  - Still open and directly relevant. Use this handoff as input, then update
    or close the bead when the workflows-branch integration plan is captured.
- `vkvw-mdms` — **Write Gas City workflows branch handoff**
  - Created for this document.

## Source/reference files on this branch

Primary:

- `packages/gc-session-vibe/`
- `src/modules/plugins/gas-city/`
- `scripts/gas-city-ready-beads.mjs`
- `docs/gas-city/`
- `notes/GAS-CITY-CONVOY-FLOW-TEST-PLAN.md`

Reference only unless released:

- `../gascity/cmd/gc/cmd_convoy_expand_ready.go`
- `../gascity/internal/sling/convoy_expand_ready.go`

