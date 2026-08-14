# Test Plan 9: M116-M118 lane-backed workflow automation spike

Branch: `vk/8b79-vd-workflows`

Spike beads:

- `vibe-kanban-vscode-web-tqhk` — M116 Sub-workspace lane foundation.
- `vibe-kanban-vscode-web-vhx5` — M117 Safe workflow command-step provider.
- `vibe-kanban-vscode-web-z1on` — M118 Bead-driven meta-workflow sequential pause/resume prototype.

Related beads:

- `vibe-kanban-vscode-web-cfss` — M115 Sub-workspace lane design.
- `vibe-kanban-vscode-web-z6l3` — VK sub-workspace support for isolated milestone lanes.
- `vibe-kanban-vscode-web-sebl` — Support choosing VK executor/model per workflow role.
- `vibe-kanban-vscode-web-ckov` — Workflow roadmap and multi-bead progress UI.

Earlier plans:

- [`./test-plan-5.md`](./test-plan-5.md) — M113 UX audit and M114-M120 roadmap.
- [`./test-plan-7.md`](./test-plan-7.md) — M114 command-step safety design.
- [`./test-plan-8.md`](./test-plan-8.md) — M115 sub-workspace lane design.

## Purpose

This plan covers the next implementation spike after M115 design: build the
minimum lane foundation, then add a narrow safe command provider, then prototype
sequential bead-driven meta-workflows.

The core risk is that automation can mutate the same workspace from multiple
places. The plan therefore keeps implementation order conservative:

1. **M116 lane foundation first** — durable lane records, parent associations,
   bindings, capacity, and read models.
2. **M117 safe command provider second** — only provider-mediated, bounded
   commands; no arbitrary shell by default.
3. **M118 sequential bead workflow third** — selected beads run one at a time
   with pause/resume and typed bead updates; parallel/lane fan-out deferred.

## Coordinator-owned guardrails

- Do not implement arbitrary shell execution in this spike.
- Do not implement branch push UX in this branch.
- Do not run parallel bead automation until lane capacity/isolation is proven.
- Do not make workflow JSON choose arbitrary host paths.
- Do not write raw command stdout/stderr, env, secrets, or internal queue ids into
  normal product UI.
- If implementation pressure conflicts with this plan, update the plan before
  merging code.

## M116 — Sub-workspace lane foundation

### User story

As a workflow operator, I can see and select isolated lanes for milestone work so
agent sessions, workflow runs, and future commands do not collide with the parent
workspace or with each other.

### Scope

In scope:

- Durable lane/sub-workspace records linked to a parent workspace.
- Lane status lifecycle: `planned`, `ready`, `active`, `paused`, `blocked`,
  `completed`, `archived`.
- Lane binding for workflow runs and bead/milestone ids.
- Conservative capacity: at most one active write token per lane.
- Parent workspace lane overview read model.
- Workflow presentation lane labels/provenance.
- Store/API/component tests.

Out of scope:

- Full physical worktree creation if not needed for the first foundation slice.
- Automatic merge-back.
- Branch push UX.
- Parallel meta-workflow execution.
- Command execution.

### Data/read-model expectations

Lane record should include enough information to support later M117/M118 work:

- `laneId`
- `parentWorkspaceId`
- `isSubWorkspace` or equivalent parent association
- `name`, `purpose`, `status`
- `sourceBranch`, optional `workingBranch`
- optional worktree/status summary
- `boundRunIds`, `boundBeadIds`
- capacity state
- audit/provenance: creator, created time, last active run

Normal UI should show product labels, not raw paths or internal ids.

### Acceptance cases

#### TEST_CASE_M116_1A — Lane store/API lifecycle

Expected:

- Create a lane under a parent workspace.
- List lanes for a parent workspace.
- Read lane detail.
- Update lane status.
- Close/archive lane.
- Missing parent, duplicate name/id, archived-lane mutation, and wrong-workspace
  access produce stable errors.

#### TEST_CASE_M116_1B — Capacity prevents write conflicts

Expected:

- Acquiring one write token for a lane succeeds.
- Acquiring a second concurrent write token for the same lane fails with a
  product-visible capacity/conflict reason.
- Releasing or completing the first token allows another write token.
- Capacity release is idempotent on duplicate completion/wakeup.

#### TEST_CASE_M116_1C — Workflow/bead binding is durable

Expected:

- Workflow run can bind to a lane at launch or before its first lane-backed step.
- Bead/milestone id can bind to a lane.
- Binding cannot silently switch during a run.
- Presentation/read model shows the lane label and parent workspace breadcrumb.

#### TEST_CASE_M116_1D — Parent overview is product-readable

Expected:

- Parent workspace read model shows lane name, status, purpose, bound work,
  capacity, and next action.
- It does not expose raw worktree paths/internal queue ids in normal view.
- Blocked/dirty/unknown lane states have actionable text.

#### TEST_CASE_M116_1E — M117/M118 dependency contract is usable

Expected:

- Command provider code can ask for the selected lane/workspace context.
- Meta-workflow code can find or create a lane binding for a bead/milestone.
- Provenance has stable fields for future command results and bead updates.

### Validation

Required:

```bash
npm run check-types
git diff --check
```

Plus focused tests depending on implementation location:

- store/API tests for lane lifecycle and capacity,
- read-model tests for parent overview and workflow presentation lane labels,
- component tests if lane UI is added,
- Playwright smoke only if browser-visible lane selection/overview lands.

## M117 — Safe workflow command-step provider

### User story

As a workflow author, I can add a narrowly supported command-like step that runs
through a typed provider, uses the selected lane/workspace policy, and returns
safe, bounded result fields for later workflow decisions.

### Scope

Start with one low-risk provider. Recommended first provider options:

1. `workspace_status` — read-only git/worktree status summary for selected lane.
2. `beads_read_status` — read-only bead/status lookup for meta-workflows.

If a write-capable provider is proposed, it must require M116 write capacity and
explicit approval in tests.

Out of scope:

- Generic `bash: "..."` or arbitrary shell strings.
- Direct `git push`.
- Unbounded output.
- Implicit env/secrets inheritance.
- Commands that mutate workflow state outside runtime-controlled advancement.

### Acceptance cases

#### TEST_CASE_M117_1A — Supported command validates and runs through provider

Expected:

- Workflow-core accepts a known command provider/config.
- Provider validation normalizes args, timeout, cwd mode, and output caps.
- Runtime creates a durable command attempt before execution.
- Command result exposes typed fields to later workflow decisions.

#### TEST_CASE_M117_1B — Unsafe/unsupported commands are denied before execution

Expected:

- Unknown provider, unknown command id, unsafe cwd, env escape, shell-string mode,
  and over-limit timeout/output config fail with stable errors.
- Denials do not spawn a process.
- Product presentation shows blocked/needs-attention reason when denial occurs at
  runtime.

#### TEST_CASE_M117_1C — Output is capped, redacted, and product-readable

Expected:

- stdout/stderr preview is capped.
- Redaction happens before persistence of product-visible output.
- Raw env/secrets/host paths do not appear in events, artifacts, read models, or
  UI.
- Presentation shows summary/result fields, not a raw terminal transcript.

#### TEST_CASE_M117_1D — Attempts are idempotent and recoverable

Expected:

- Duplicate wakeups do not start duplicate command attempts.
- Retry uses provider idempotency key.
- Worker restart/catch-up can resolve an in-flight command attempt.
- Stale/unknown command completion observations are no-ops.

#### TEST_CASE_M117_1E — Lane policy gates write-capable commands

Expected if any write provider is added:

- Command requires selected lane/workspace context.
- Command requires lane write token.
- Capacity conflict blocks execution.
- Provenance records lane label/cwd mode without exposing raw host path.

### Validation

Required:

```bash
npm run check-types
git diff --check
```

Plus:

- workflow-core normalization tests,
- provider validation tests,
- runtime/store/idempotency tests,
- security/redaction tests,
- presentation/read-model tests,
- Playwright only if command status/result is browser-visible.

## M118 — Bead-driven meta-workflow sequential pause/resume prototype

### User story

As a project operator, I can select an ordered set of beads and run a
meta-workflow that processes them one at a time, pauses for review/tester/human
approval, resumes safely, and records product-readable results back to beads.

### Scope

In scope for first prototype:

- Select ordered bead ids.
- Read bead title/status/labels through a typed provider/API.
- Launch one child workflow or workflow step per bead sequentially.
- Wait for child completion or human approval.
- Pause/resume the parent meta-workflow.
- Append notes/results to beads through typed mutation only.
- Show meta-workflow status on run page and roadmap/progress UI if available.

Out of scope for first prototype:

- Parallel lane fan-out.
- Arbitrary shell/`bd` command mutation.
- Automatic close/label/status mutation unless explicitly approved.
- Branch push.
- Scheduled jobs.

### Acceptance cases

#### TEST_CASE_M118_1A — Ordered beads execute sequentially

Expected:

- User/API selects beads `[A, B, C]`.
- Workflow starts bead A only.
- Bead B does not start until A reaches terminal/approved state.
- Bead C does not start until B reaches terminal/approved state.
- Progress read model shows current bead and completed prior beads.

#### TEST_CASE_M118_1B — Pause/resume is durable and product-visible

Expected:

- User can pause between beads or at a review gate.
- Resume continues from the same bead without duplicating completed work.
- Restart/catch-up preserves current index and completed bead results.
- Run page explains why it is paused or waiting.

#### TEST_CASE_M118_1C — Result notes are typed and safe

Expected:

- Workflow appends a note/result to the current bead via typed provider/API.
- It does not run raw `bd`/shell.
- Duplicate wakeup does not append duplicate notes.
- Note provenance identifies workflow run and lane/workspace context.

#### TEST_CASE_M118_1D — Failure does not corrupt prior beads

Expected:

- If bead B fails/blocks, bead A remains completed with its recorded result.
- Bead C is not started.
- Presentation and roadmap/progress UI show blocked bead and next action.

#### TEST_CASE_M118_1E — Workspace/lane conflicts are avoided

Expected:

- Sequential prototype can run in parent workspace for non-write orchestration.
- If any write-capable command/child workflow is used, it requires lane binding
  and capacity from M116.
- The workflow does not create conflicting agents in the same workspace/lane.

### Validation

Required:

```bash
npm run check-types
git diff --check
```

Recommended before tester closure:

- provider/API tests for bead read and append-note operations,
- runtime tests for current-index/pause/resume/idempotency,
- read-model tests for progress and blocked states,
- Docker qa-mode E2E if child workflows use real VK agent turns,
- browser/Playwright if progress UI is visible.

## Spike sequencing and stop points

1. Complete/review M115 design (`test-plan-8.md`).
2. Implement and test M116 lane foundation.
3. Reassess whether M117 first provider should be read-only only.
4. Implement and test M117 provider.
5. Implement M118 sequential prototype using typed bead APIs and no raw shell.
6. Add/validate roadmap/progress UI integration if `ckov` is included in this
   spike.

Stop and update this plan before proceeding if:

- implementation wants arbitrary shell,
- implementation wants parallel bead fan-out,
- implementation wants branch push,
- lane capacity cannot be represented durably,
- bead mutations need more than append notes/results.

## Reviewer and tester handoff

Reviewer should confirm:

- M116 comes before write-capable M117 work,
- M117 remains provider-mediated and bounded,
- M118 is sequential and pause/resume-first,
- branch push and scheduled jobs remain out of this spike,
- validation expectations are specific enough for implementation.

Tester should require:

- source checks and `git diff --check`,
- `npm run check-types`,
- focused tests per implemented area,
- Docker/browser evidence only when runtime/browser behavior is included.
