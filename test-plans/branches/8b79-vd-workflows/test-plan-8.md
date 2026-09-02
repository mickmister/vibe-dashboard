# Test Plan 8: M115 sub-workspace lane design for isolated workflow milestones

Branch: `vk/8b79-vd-workflows`

Feature bead: `vibe-kanban-vscode-web-cfss` — M115 Sub-workspace lane design for isolated workflow milestones

Related beads:

- `vibe-kanban-vscode-web-z6l3` — VK sub-workspace support for isolated milestone lanes.
- `vibe-kanban-vscode-web-tqhk` — M116 Sub-workspace lane foundation.
- `vibe-kanban-vscode-web-w6qf` — M114 Command-step safety design for workflow automation.
- `vibe-kanban-vscode-web-vhx5` — M117 Safe workflow command-step provider.
- `vibe-kanban-vscode-web-z1on` — M118 Bead-driven meta-workflow sequential pause/resume prototype.
- `vibe-kanban-vscode-web-sebl` — Support choosing VK executor/model per workflow role.
- `vibe-kanban-vscode-web-ckov` — Workflow roadmap and multi-bead progress UI.

Earlier plans:

- [`./test-plan-5.md`](./test-plan-5.md) — M113 workflow UX completeness audit and M114-M120 roadmap.
- [`./test-plan-7.md`](./test-plan-7.md) — M114 command-step safety design.

## Purpose

M115 is **docs/design only**. It defines the sub-workspace/lane model that later
workflow automation can rely on before implementing lane storage, lane UI,
write-capable command steps, or parallel bead-driven workflows.

The product goal is to let workflows work on milestones/beads in isolated lanes
so agents do not step on the same working tree, session set, branch, or capacity
slot. A lane should feel like a first-class workspace context to the user while
remaining associated with its parent workspace and parent goal.

The design decision for M115 is:

> A sub-workspace lane is a normal workspace-like execution context with explicit
> parent association, lane purpose, capacity, branch/worktree ownership, session
> bindings, and cleanup/merge policy. It is not physically nested inside the
> parent workspace directory by default.

## Coordinator-owned review note

This document is the coordinator-owned acceptance plan for M115. It is the
source of truth for what M116 must implement first and for what M117/M118 may
assume about lane isolation.

Key guardrails:

- **M115 does not implement lanes.**
- **M116 may implement only the minimal lane foundation approved here.**
- **Write-capable command steps remain deferred until lane ownership/capacity is
  implemented or a later user decision explicitly narrows the command scope.**
- **Branch push UX is out of scope for this branch.** Lane design may describe
  merge/push handoff constraints, but it must not require branch-push product UI
  in this branch.

## Vocabulary

| Term | Meaning |
| --- | --- |
| Parent workspace | The user's main workspace/repository context where the workflow or bead campaign starts. |
| Sub-workspace | A workspace record marked as derived from a parent workspace. It has normal workspace behavior plus parent/lane metadata. |
| Lane | The product concept for an isolated execution lane. In the first implementation, a lane should be backed by a sub-workspace record. |
| Worktree | The filesystem checkout used by a lane. It should be separate from the parent workspace checkout for write-capable work. |
| Lane capacity | A policy token that limits active write/running turns per lane and optionally across a parent workspace. |
| Lane binding | The association between a workflow run/bead/milestone and the lane chosen to execute it. |
| Session binding | Role-to-VK-session association for a workflow role within a lane. |
| Merge-back | A later handoff step that explains how lane changes return to the parent branch/workspace. |

## Product model recommendation

### Sub-workspace data shape

The first durable lane model should treat sub-workspaces as normal workspace
records plus additional metadata:

- `isSubWorkspace: true`
- `parentWorkspaceId`
- `laneId` or stable lane identifier
- `laneName`
- `lanePurpose`
- `sourceBranch`
- `workingBranch`
- optional `worktreePath` or provider-owned worktree ref
- `status`: `planned`, `ready`, `active`, `paused`, `blocked`, `completed`, `archived`
- `capacity`: read/write concurrency policy
- `createdBy`: user/workflow/run/bead provenance
- `boundRunIds` / `boundBeadIds` summary
- `cleanupPolicy`

This is intentionally **association-based**, not directory-nesting based.
Sub-workspaces should be queryable/listable as normal workspaces while clearly
displaying their parent relationship.

### Lane identity

Lane identity should be product-readable and stable:

- Product label: `M118 / bead meta-workflow lane 1`, `Review loop lane`, or
  `Milestone: LV2K follow-up`.
- Durable id: opaque id suitable for APIs and audit logs.
- Parent breadcrumb: `Parent workspace → Lane name`.

Do not expose raw worktree paths or internal run ids in normal product copy.
Show raw ids only in diagnostics/debug surfaces.

### Minimal M116 implementation target

M116 should implement the smallest useful foundation:

1. Create/list/read/close lane records linked to a parent workspace.
2. Bind a workflow run or bead milestone to a lane.
3. Track lane status and active capacity.
4. Expose a lane read model for workflow presentation/home pages.
5. Provide enough provenance for future command steps to report where they ran.

M116 should **not** need to implement full branch merge, branch push UX, schedule
jobs, or parallel meta-workflow orchestration.

## Lane lifecycle

### 1. Plan

A workflow or user identifies work that may need isolation:

- multi-bead milestone execution,
- parallelizable review/test/fix lanes,
- write-capable command step,
- long-running agent session,
- risky experiment.

The system chooses one of:

- use current workspace only,
- create/reuse a sequential sub-workspace lane,
- create multiple lanes for explicitly parallel work.

Sequential bead workflows may start without lanes. Parallel or write-capable
work should require lanes.

### 2. Create / reserve

Lane creation should:

- validate parent workspace exists,
- choose lane name and purpose,
- choose branch/worktree strategy,
- create or reserve lane capacity,
- record creating user/workflow/run/bead,
- show lane as `planned` or `ready`.

If worktree creation is deferred, the lane record may exist before the physical
checkout exists, but UI should say `worktree pending` rather than implying it is
ready for writes.

### 3. Bind

Workflow runs and bead milestones should bind to a lane before any lane-specific
work starts. The binding should include:

- parent workspace id,
- lane id,
- run id and/or bead id,
- role/session binding summary,
- reason the lane was selected,
- whether the lane allows reads only or writes.

### 4. Execute

During execution:

- reads may run under read capacity,
- writes require a write capacity token,
- only one write turn should run in a lane at a time for the first slice,
- command steps must report lane id/cwd mode in provenance,
- agent turns should show lane context in product copy.

### 5. Pause / block / recover

Lane status should surface:

- blocked by dirty worktree,
- blocked by conflict,
- blocked by missing session/executor,
- blocked by capacity,
- blocked by approval required,
- paused by user/workflow.

Recovery should be product-actionable: resume, inspect lane, reassign session,
clean up, archive, or hand off.

### 6. Complete / hand off

When lane work completes:

- mark lane `completed` only when no active turns remain,
- summarize changed files/status if available,
- link completed workflow runs/beads,
- explain merge-back/push next steps without pushing automatically,
- keep lane inspectable until archived.

### 7. Archive / cleanup

Archiving should:

- preserve audit/provenance,
- keep links from parent workspace/run/beads,
- prevent new work from binding to the lane unless reopened,
- defer destructive worktree deletion until explicitly approved or covered by a
  separate cleanup policy.

## Capacity and isolation rules

First implementation policy:

1. A lane can have many historical runs, but at most one active write turn.
2. Parent workspace may cap total active lanes.
3. A workflow run must not silently switch lanes after launch.
4. A command step may not choose arbitrary cwd; it receives the runtime-selected
   lane/workspace context.
5. Parent workspace writes are blocked while a lane is the selected write target
   for the same milestone unless explicitly approved.
6. Parallel lanes must have separate lane ids and worktree ownership.
7. If lane worktree status is dirty/unknown, new write work should block until
   the user or automation policy resolves it.
8. If a worker crashes or loses ownership while holding a write token, the lane
   must have an explicit stale-token recovery policy before another writer is
   allowed to proceed. The first implementation may require manual recovery, but
   it must not silently leak capacity forever or grant overlapping write tokens.

The first lane foundation can support conservative capacity only. Smarter
scheduling can come later.

## Branch and worktree policy

### Recommended initial branch/worktree model

- Parent workspace keeps the user's current checkout.
- Each write-capable lane uses a separate worktree/checkout.
- Lane working branch should be derived from parent source branch.
- Lane branch naming should be deterministic and product-readable, for example:
  `workflow/<short-run-id>/<bead-or-milestone-slug>`.
- Lane changes should not auto-merge or auto-push in this branch.

### Merge/push handoff

M115 must document constraints but not build branch-push UX:

- show changed-file/status summary,
- show source branch and lane branch,
- show whether parent has moved since lane creation,
- warn about dirty/uncommitted lane changes,
- require later explicit merge/push workflow before writing to remote.

Branch push UX is out of scope for this branch. If a later milestone needs
branch-state data, it should be a typed read-model/API contract, not a command
step running `git push`.

## Role, session, executor/model binding

Lane design should leave room for role-level execution preferences without
implementing them in M115:

- workflow role id,
- selected VK session or create/reuse policy,
- target lane id,
- executor type/provider,
- model preference,
- capacity requirements,
- whether the role may write.

`vibe-kanban-vscode-web-sebl` should decide how executor/model choices appear in
role declarations. M115 should ensure lane/session binding has a place to store
and display those choices later.

## Workflow and bead meta-workflow usage

### Sequential meta-workflows

M118's first sequential bead workflow can run in the parent workspace if it is
read-only or human/agent orchestration only. It should still record `lane: none`
or `workspace: parent` so later results are comparable to lane-backed runs.

### Parallel meta-workflows

Parallel bead workflows should require lanes:

- one lane per concurrently active bead/milestone,
- one write token per lane,
- parent overview shows all lane statuses,
- failures in one lane do not corrupt or block unrelated lanes except through
  parent capacity policy.

### Bead status mutations

Initial bead automation should remain typed-provider based. Lane design should
support provenance such as:

> Workflow updated bead `abc123` from lane `M118 prototype lane 1`.

No raw shell or unbounded `bd` command execution is implied by M115.

## UI/read-model expectations

### Parent workspace overview

Show:

- active lanes,
- lane purpose,
- bound beads/runs,
- status,
- active role/session,
- changed files summary if known,
- next action.

Avoid:

- raw paths,
- internal queue ids,
- child run ids as primary labels,
- treating lanes as hidden debug objects.

### Lane detail

Show:

- parent breadcrumb,
- lane branch/worktree summary,
- active workflow runs and beads,
- role/session bindings,
- capacity state,
- recent results,
- cleanup/archive actions.

### Workflow presentation

Workflow run pages should show lane context near each lane-backed turn/action:

- `Ran in lane: M118 review lane`
- `Write capacity: acquired/released`
- `Workspace: parent` for non-lane runs

Command output/provenance from M117 should use the same lane labels.

## Explicit non-goals for M115

- No code implementation.
- No database migration.
- No branch push UX.
- No automatic merge-back.
- No command execution.
- No persistent manual graph layout.
- No scheduled jobs.
- No browser creation E2E.
- No full parallel meta-workflow implementation.
- No requirement that sub-workspaces be physically nested directories.

## Acceptance cases

### TEST_CASE_M115_1A — Lane model and lifecycle are specified

Expected:

- Plan defines parent workspace, sub-workspace, lane, worktree, capacity, and
  session binding terms.
- Plan describes create, bind, execute, pause/block/recover, complete, and
  archive lifecycle.
- Plan decides that sub-workspaces are association-based workspace records, not
  physical nested directories by default.

### TEST_CASE_M115_1B — Capacity and isolation rules are testable

Expected:

- Plan defines first-slice write capacity rules.
- Plan explains how a workflow run chooses or binds a lane.
- Plan explains why parallel write work requires separate lanes.
- Plan defines blocked/dirty/conflict recovery expectations.
- Plan requires a stale/orphan write-token recovery policy for crashed workers.

### TEST_CASE_M115_1C — Branch/worktree/session model is specified

Expected:

- Plan distinguishes parent checkout from lane worktree.
- Plan documents branch naming, dirty-worktree attribution, merge-back, and push
  deferrals.
- Plan leaves a clear slot for role session, executor, and model preferences.

### TEST_CASE_M115_1D — UI/read-model language is product-oriented

Expected:

- Plan describes parent overview, lane detail, and workflow presentation lane
  labels.
- Plan avoids raw internal ids/paths in normal UI.
- Plan says direct diagnostic identifiers remain diagnostics-only.

### TEST_CASE_M115_1E — M116/M117/M118 dependencies are explicit

Expected:

- M116 foundation scope is minimal and concrete.
- M117 write-capable commands remain gated on lane ownership/capacity.
- M118 sequential workflows can proceed without lanes only if narrowed to safe
  non-write orchestration; parallel/write workflows require lanes.

## M116 implementation test matrix

M116 should use this design to add implementation tests. Recommended matrix:

| Area | Test expectation |
| --- | --- |
| Store/API | Create, list, read, update status, close/archive lane linked to parent workspace. |
| Parent relation | Sub-workspace has parent reference and appears in parent lane read model. |
| Capacity | Cannot acquire two write tokens for same lane; read-only capacity policy is explicit. |
| Capacity recovery | Stale/orphan write token after crash is visible and recoverable without granting overlapping writes. |
| Binding | Workflow run/bead can bind to lane; binding cannot silently change during run. |
| UI/read model | Parent workspace shows active lane status/product labels. |
| Session binding | Role-to-session binding records lane context. |
| Worktree status | Dirty/unknown status blocks new write work or reports needs attention. |
| Provenance | Lane labels appear in workflow presentation and future command provenance. |
| Negative cases | Missing parent, archived lane, capacity conflict, wrong workspace, stale binding. |

If M116 adds browser-visible UI, add Playwright coverage for the parent overview
and lane detail. Otherwise store/API/component tests plus `npm run check-types`
and `git diff --check` are sufficient.

## Review and tester handoff

M115 validation is docs-only:

```bash
git diff --check
```

Reviewer should verify:

- no code/runtime scope is included,
- lane/sub-workspace association model is clear,
- branch push is not required for this branch,
- write-capable command steps remain gated by M116,
- M116 implementation scope is testable.

Tester handoff is optional for M115. If requested, tester should inspect this
document against bead `vibe-kanban-vscode-web-cfss` and run `git diff --check`.
