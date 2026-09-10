# Test Plan 13: GCW-7 ready-bead fanout with isolated worktrees

Branch: `vk/8b79-vd-workflows`

Primary bead: `vibe-kanban-vscode-web-9cx7.6` — GCW-7 Ready-bead fanout with isolated worktrees

Status: design/test-plan before implementation

## Purpose

This plan captures the design required before implementing ready-bead fanout for
Gas City-backed VD Workflows. The user called this flow crucial, but also noted
that the current team understanding is incomplete. This document is intentionally
not product implementation. It defines ownership, safe slices, validation gates,
and decision points so code can proceed without VD accidentally becoming a
private Gas City scheduler or an unsafe worktree mutator.

The desired product outcome is:

- select currently ready task beads in a VK workspace;
- preview which beads will launch, skip, or block;
- launch independent ready beads in parallel through released Gas City primitives;
- give each active unit isolated VK worktree/sub-workspace context where mutation
  can happen safely;
- make progress/failures understandable in VD;
- later fan in results to the main workspace through an explicit reviewed merge
  policy.

## Inputs inspected

- `docs/adr/0002-gas-city-backed-vd-workflows.md`
- donor handoff `notes/GAS-CITY-WORKFLOWS-BRANCH-HANDOFF.md` from
  `origin/vk/42a2-vd-gas-city-plug`
- donor `docs/gas-city/workspace-orchestration-flows.md`
- donor `notes/GAS-CITY-CONVOY-FLOW-TEST-PLAN.md`
- donor `src/modules/plugins/gas-city/ready-bead-launcher.ts`
- current GCW-3 provider seam: `src/modules/plugins/workflows/server/gasCityWorkflowProvider.ts`
- current GCW-4 pack generator: `src/modules/plugins/workflows/server/gasCityPackGenerator.ts`
- current GCW-5 launch provider: `src/modules/plugins/workflows/server/gasCityCliWorkflowProvider.ts`
- existing M116 lane/workspace-lane foundation and M117 typed provider safety
  design/implementation background

## Non-negotiable boundaries

1. **Gas City/beads are authoritative.** VD may select candidates, preview, and
   call released Gas City commands, but readiness, source workflow singleton
   state, workflow outcome, and formula progression must remain GC/bead-owned.
2. **`workspaceId` is the VK workspace ID.** Do not introduce `vdWorkspaceId`.
3. **Pinned released GC only.** Current released primitive is repeated single
   launch: `gc sling <target> <source-bead-id> --on <graph.v2 formula>`. The
   donor `gc convoy expand-ready` command is design reference only unless it is
   upstreamed/released and explicitly pinned later.
4. **No hidden worktree writes.** Worktree/sub-workspace creation, reuse, dirty
   handling, cleanup, and merge-back need explicit policy and auditable state.
5. **No normal UI raw internals.** Normal product views must not show raw `gc`,
   `bd`, `git`, shell commands, local paths, stdout/stderr, provider diagnostic
   dumps, queue/webhook/internal IDs, or raw XML/JSON.
6. **VD locks only the selection/launch window.** After a source bead is launched,
   Gas City owns workflow progression. VD must not poll-loop itself into a hidden
   scheduler.

## Current released-GC capability assessment

### Implementation-ready today

Using GCW-5 plus a small launcher/provider extension, VD can safely do a narrow
manual fanout coordinator:

1. list ready beads through a typed bead provider/store boundary;
2. optionally filter by parent bead and/or convoy membership if that membership
   can be read through released GC/typed bead metadata;
3. compute skips for terminal, missing formula, existing live workflow,
   capacity, and limit;
4. hold a short VK-workspace launch lock around select/count/launch;
5. call the existing GCW-5 single source-bead launch once per selected bead;
6. return a product-safe summary and per-bead results.

This is sufficient for a **manual “launch ready task beads now”** slice if it is
kept explicit, limited, and preview-first.

### Not implementation-ready without decisions

The following need product/architecture decisions before code:

- physical worktree/sub-workspace create-vs-reuse behavior;
- whether every launched bead must have a lane before launch or whether lane
  provisioning can be formula/agent-mediated after launch;
- concurrency caps by workspace, by target, by lane, and by source bead group;
- merge/fan-in strategy back to the main workspace;
- cleanup/archive policy for completed worktrees;
- whether automatic wake/watch behavior is allowed in VD before an upstream GC
  expansion primitive exists;
- whether stale/orphan launch locks should auto-recover or require user review;
- how source-bead dependencies and sibling conflict warnings are presented before
  launch.

### Prefer upstream GC primitive later

For unattended expansion, prefer an upstream/pinned GC primitive such as:

```text
gc convoy expand-ready <target> <convoy-id> --on <graph.v2 formula> --limit N --max-active N
```

Until that exists in a released GC version, VD should expose only explicit/manual
fanout over repeated released `gc sling --on` calls.

## Proposed model

### Fanout request

A server-side, typed request shape should be introduced in the workflow/Gas City
provider area, not workflow-core:

```ts
type ReadyBeadFanoutRequest = {
  context: { workspaceId: string; userId?: string | null };
  target: string;
  formula: string;
  source: {
    parentBeadId?: string | null;
    convoyId?: string | null;
    explicitBeadIds?: string[];
  };
  limits: {
    maxLaunches: number;
    maxActiveSourceWorkflows: number;
  };
  lanePolicy: "require_existing_lane" | "create_sub_workspace" | "defer_to_formula";
  nudge: boolean;
  idempotencyKey: string;
  dryRun: boolean;
};
```

This remains internal/server-facing until UI decisions are complete.

### Preview/read model

The preview should be the primary product object. It should be safe to show before
any launch side effect:

```ts
type ReadyBeadFanoutPreview = {
  workspaceId: string;
  formula: { id: string; label: string; contract: "graph.v2" };
  target: { id: string; label: string };
  counts: { ready: number; willLaunch: number; skipped: number; blocked: number; activeBefore: number; capacity: number };
  items: Array<{
    beadId: string;
    title: string;
    status: "will_launch" | "skipped" | "blocked" | "already_running";
    reason?: string;
    lane?: { laneId: string; label: string; status: "ready" | "dirty" | "held" | "missing" } | null;
  }>;
  nextAction: string;
  warnings: string[];
};
```

All strings are scrubbed/capped through the same product-safe policy used by the
Gas City provider/read models.

### Launch result

```ts
type ReadyBeadFanoutResult = ReadyBeadFanoutPreview & {
  launched: Array<{
    beadId: string;
    workflowRef: GasCityProviderWorkflowRef;
    status: "accepted" | "already_running";
    diagnosticsRef?: string;
  }>;
  failed: Array<{ beadId: string; message: string; diagnosticsRef?: string }>;
};
```

`diagnosticsRef` is for advanced diagnostics only. It must not contain raw local
paths or command output.

## Ready bead selection

Candidate inputs, in descending specificity:

1. explicit bead IDs chosen by the user;
2. ready children of a selected parent bead;
3. ready members of a selected convoy/group;
4. ready beads in the current VK workspace.

Selection must be deterministic:

- sort by explicit order if provided;
- otherwise use bead provider's stable ready order, with deterministic tie-break
  by bead ID;
- apply filters before capacity;
- compute every skip reason before launch so the preview is explainable.

Skip/block reasons:

- bead not ready;
- terminal/archived/removed;
- inaccessible or other workspace;
- not in selected parent/convoy;
- already has a live GC source workflow;
- missing graph.v2 recipe/formula;
- unsupported formula contract;
- lane missing/dirty/held when lane policy requires one;
- active source workflow cap reached;
- per-request limit reached;
- provider unavailable/unhealthy/wrong pinned version.

## Isolated worktree/sub-workspace policy

This is the largest unresolved area. The M116 lane store provides a useful VD
concept, but GC fanout needs a product rule for how lanes map to VK workspaces
and source beads.

### Option A — require existing ready lane per bead

Before fanout, each selected bead must be mapped to an existing ready lane.

Pros:

- safest first implementation;
- no hidden workspace/worktree creation;
- uses existing lane dirty/write-token checks;
- easy to explain blocked preview rows.

Cons:

- more setup friction;
- not a great default for many ready beads;
- user must create/choose lanes before seeing value.

### Option B — create sub-workspace per launched bead

Fanout creates or reuses one sub-workspace/worktree per source bead under the
current VK workspace.

Pros:

- matches product desire for parallel isolated work;
- can become the default “launch ready work safely” flow;
- gives each agent a concrete isolated workspace.

Cons:

- requires a reliable VK sub-workspace/worktree creation API and cleanup model;
- must solve branch naming, dirty recovery, and parent/child workspace links;
- substantially larger review/test surface.

### Option C — defer lane/worktree creation to the generated GC formula

VD launches ready beads, and the formula/agent workflow provisions isolation as
part of the work.

Pros:

- keeps VD fanout thin;
- lets Gas City own more orchestration details;
- can work before VD has full physical lane lifecycle.

Cons:

- harder to preview safety before launch;
- risks agents doing setup in prompts unless typed providers are available;
- less reassuring for the user's concern about understanding isolation.

### Recommendation

Use **Option A for the first code slice** if the user wants minimal safety now,
or **Option B as the desired product target** after a dedicated sub-workspace API
slice. Do not use Option C as the default unless the user explicitly accepts that
isolation is formula-mediated and less previewable.

## Create-vs-reuse policy

- Reuse only lanes/sub-workspaces explicitly bound to the source bead or selected
  by the user.
- Auto-create lanes/sub-workspaces only with a deterministic idempotency key:
  `workspaceId:sourceBeadId:formula:target`.
- Never silently switch a bead from one active lane to another.
- Dirty/unknown lanes block launch until refreshed or explicitly recovered.
- A stale launch lock may be recovered after a bounded TTL, but stale write tokens
  require explicit recovery/audit per M120A/M116 policy.

## VK workspace/session mapping

- Parent VK workspace remains the user's command center and source-of-truth UI
  entry point.
- Each fanout item may bind to a lane/sub-workspace with its own VK sessions.
- Role/session bindings should use existing SEBL semantics: workflow role default
  unless explicit session/target is selected.
- The GC bridge should pass `VIBE_ADOPT_WORKSPACE_ID`/`VIBE_ADOPT_SESSION_ID` for
  adopted VK sessions; no separate VD workspace identity should be introduced.
- Read models should show “Task bead”, “Workspace”, “Lane”, “Workflow recipe”, and
  “Current reviewer/worker” product labels, not raw GC command labels.

## Idempotency and locking

### Locks

- Lock key: `gas-city-ready-fanout:${workspaceId}`.
- Scope: short select → count active → launch attempt window only.
- Expiry: short bounded TTL with product-visible stale recovery.
- Lock does not authorize worktree mutation. Worktree mutation still requires
  lane/write-token policy.

### Idempotency

- Fanout request idempotency key should be stable for the same user action.
- Per-bead launch key should derive from fanout key + source bead ID.
- Same key + same identity replays as already accepted/already running.
- Same key + different source/formula/target/workspace blocks with conflict.
- Source workflow singleton conflicts from GC are duplicate-safe skips only when
  metadata proves the existing live workflow matches the selected source/formula.
  Otherwise block as “already running with different recipe”.

## Fan-in / merge-back

Fan-in is not implementation-ready in this slice. The decision needs to separate
three ideas:

1. **Workflow fan-in:** Gas City knows whether each source-bead workflow
   completed/failed/blocked.
2. **Code fan-in:** changes from isolated worktrees need to be merged to the main
   workspace branch.
3. **Product fan-in:** VD tells the user which task beads are complete and what
   review/merge action remains.

First acceptable product behavior can be:

- each completed source-bead workflow leaves a product-safe result summary;
- code remains in the lane/sub-workspace;
- main workspace merge is a separate explicit action/follow-up bead;
- no automatic merge/push in GCW-7.

Possible future merge policies:

| Policy | Description | Recommendation |
| --- | --- | --- |
| Manual inspect/merge | User opens each lane and merges manually | safest first |
| Typed merge provider | A bounded provider attempts merge and reports conflicts | later after M117/M120A hardening |
| Auto merge on green | Merge after tests/review pass | defer; high risk |
| Branch/MR push | Push each lane to remote branch/MR | separate branch-push UX, out of scope |

## Failure/retry/blocking semantics

- Provider unavailable/wrong GC version: block before preview launch.
- Formula unsupported: block before preview launch.
- Bead no longer ready after preview: skip during launch and refresh preview.
- Lock conflict: product-safe “another fanout launch is preparing work”.
- Lane dirty/held/unknown: block that item; do not block unrelated ready items
  unless policy requires all-or-nothing.
- GC launch failure for one bead: record item failure; continue other selected
  beads only if user chose partial launch. Default should be partial-safe with a
  clear result table.
- Crash after some launches: replay with same fanout/per-bead keys and reconcile
  launched/already-running from GC/bead metadata.
- Retry should never launch duplicate workflows for the same source bead/formula
  tuple.

## Product-safe status/read models

Normal UI should show:

- parent workspace;
- selected recipe;
- target role/session label;
- source bead ID + title;
- lane/sub-workspace label;
- status: Will launch, Waiting, In progress, Already running, Skipped, Blocked,
  Completed, Failed;
- next action in plain English;
- supported links: workflow story page, task bead, workspace/lane where available.

Normal UI must not show:

- raw `gc`, `bd`, `git`, shell command strings;
- host paths;
- stdout/stderr;
- provider diagnostics dumps;
- queue/webhook/internal delivery IDs;
- raw formula TOML, XML, JSON, or generated pack paths.

Advanced diagnostics may show a stable `diagnosticsRef` and safe summary only.

## Proposed implementation milestones

### GCW-7A — Ready-bead fanout provider contract and preview

Docs/tests/code scope:

- add typed server-side preview/read-model interfaces;
- fake provider tests for ready selection, skip reasons, caps, product safety;
- no real launch side effects;
- no physical worktree lifecycle.

Acceptance:

- `TEST_CASE_GCW7A_1A`: preview explicit beads in deterministic order.
- `TEST_CASE_GCW7A_1B`: preview parent/convoy filtered ready beads and skip
  mismatches.
- `TEST_CASE_GCW7A_1C`: active workflow cap and per-request limit produce stable
  skip reasons.
- `TEST_CASE_GCW7A_1D`: product-safe read model scrubs raw command/path/output
  terms.
- `TEST_CASE_GCW7A_1E`: provider unavailable/wrong pinned GC version blocks
  before launch.

### GCW-7B — Manual repeated single-bead launch under workspace lock

Code scope:

- implement explicit/manual fanout action using GCW-5 `launchSourceWorkflow`;
- workspace lock around select/count/launch;
- per-bead idempotency and duplicate conflict handling;
- no auto watcher/scheduler.

Acceptance:

- `TEST_CASE_GCW7B_1A`: launches N ready beads by calling single-bead launch once
  per selected bead.
- `TEST_CASE_GCW7B_1B`: duplicate replay does not launch duplicates.
- `TEST_CASE_GCW7B_1C`: same key/different identity blocks.
- `TEST_CASE_GCW7B_1D`: source workflow singleton conflict is a skip only when
  matching metadata is present.
- `TEST_CASE_GCW7B_1E`: one item failure is product-safe and does not expose
  stdout/stderr/commands.

### GCW-7C — Lane/sub-workspace binding policy

Design+code depending on user decision:

- require existing lane, or create sub-workspace, or formula-mediated isolation;
- integrate M116 lane status/read models;
- block dirty/held/unknown lanes;
- audit recovery.

Acceptance:

- `TEST_CASE_GCW7C_1A`: lane required/selected per launched bead.
- `TEST_CASE_GCW7C_1B`: dirty/held/unknown lane blocks launch.
- `TEST_CASE_GCW7C_1C`: create/reuse is idempotent and never silently switches
  lanes.
- `TEST_CASE_GCW7C_1D`: product UI/read model hides host paths.

### GCW-7D — Product UI for preview and manual launch

Code scope:

- Workflows Home/roadmap entry for “Launch ready task beads”;
- preview table with skip reasons and capacity;
- confirmation summary;
- progress links to launched workflow story pages or GC-backed read model;
- no automatic fanout.

Acceptance:

- `TEST_CASE_GCW7D_1A`: user can preview ready beads without side effects.
- `TEST_CASE_GCW7D_1B`: user confirms launch and sees per-bead results.
- `TEST_CASE_GCW7D_1C`: unavailable engine/setup state is clear.
- `TEST_CASE_GCW7D_1D`: no unsupported branch push/merge/shell controls appear.

### GCW-7E — Fan-in/merge design and explicit merge action

Design first; code later.

Acceptance should be written after decisions on manual vs typed merge provider.
No automatic merge should be included in GCW-7A-D.

## Validation ladder

### Required for GCW-7A/B

- focused Vitest for selection/preview/launch coordinator;
- GCW-5 provider tests;
- `npm run check-types`;
- `git diff --check`;
- product-safety forbidden-term tests.

### Required before real launch route/UI

- local pinned `gc` binary smoke if available:
  - `gc version --json` equals pinned release;
  - generated formula validates as graph.v2;
  - one source bead launches through `gc sling --on`;
  - duplicate replay is safe.

### Required before sub-workspace default

- VK workspace/sub-workspace creation API tests;
- lane dirty/write-token tests;
- recovery/audit tests;
- Storybook for preview states;
- browser smoke for disabled/unavailable and preview result states.

### Required before unattended/automatic fanout

- upstream released GC expansion primitive or explicit approval for VD watcher;
- no-busy-loop/reconnect tests;
- crash recovery and stale-lock tests;
- capacity tests under concurrent requests.

## Decision questions before implementation

1. **First lane policy for GCW-7C:** should the first code slice require an
   existing ready lane per source bead, auto-create sub-workspaces per source
   bead, or launch without lane enforcement and let the formula/agent handle it?
2. **Manual vs automatic fanout:** should GCW-7B be manual preview+confirm only,
   or is a non-polling event watcher allowed before an upstream released GC
   expansion command exists?
3. **Partial failure behavior:** if one selected bead fails launch validation,
   should other selected ready beads still launch, or should the entire fanout be
   all-or-nothing?
4. **Capacity default:** what should the default max active source workflows per
   VK workspace be: 1, 2, 3, or configurable per workspace?
5. **Fan-in/merge default:** should completed isolated work initially require
   manual merge from the lane/sub-workspace, or should we design a typed merge
   provider before any fanout UI ships?
6. **Convoy/group filtering:** should convoy membership be in the first launch
   slice, or should GCW-7B start with explicit selected bead IDs and parent-ready
   filtering only?
7. **Sub-workspace naming:** should generated lane/sub-workspace names derive
   from bead ID/title, formula, target role, or an explicit user-provided prefix?
8. **Review gate:** should GCW-7A/B stop at provider tests plus local `gc` smoke,
   or require Docker/browser E2E before product UI begins?

## Recommendation

Proceed in this order:

1. GCW-7A preview/provider contract.
2. GCW-7B manual repeated single-bead launch under workspace lock.
3. Dedicated decision/form for GCW-7C lane/sub-workspace policy.
4. GCW-7D product UI after preview/launch contracts are stable.
5. Separate fan-in/merge design before any automatic merge/push behavior.

This sequence provides user-visible progress while preserving the architecture
boundary: VD coordinates explicit launch of ready source beads, Gas City/Beads
remain authoritative, and unsafe worktree/merge behavior does not sneak in under
fanout.
