# Test Plan 12: Parallel review branches in workflows

Branch: `vk/8b79-vd-workflows`

Primary bead: `vibe-kanban-vscode-web-89ne` — Support parallel review branches in workflows

Status: design required before implementation

## Purpose

This plan captures the first inspection and proposed design for parallel review
branches. The current workflow system is intentionally sequential: one active
state/step plans one wait, then one observation advances the workflow. Parallel
review requires new core/runtime/read-model semantics rather than a small DRT
template tweak.

The goal is to let multiple review-agent types inspect the same task context at
the same time, each returning normal typed workflow action-result XML, and then
join deterministically before the next workflow stage.

## Current implementation audit

### Workflow core

- `WorkflowRuntimeSnapshot.waitingFor` is a single object, not a list of waits.
  It supports one active wait kind at a time: `agent_turn`, `human_form`,
  `workflow_call`, `github_ci`, or `command`.
- `planNextWorkflowEffect` plans exactly one effect for the current state step.
  Agent turns, human forms, command steps, GitHub CI waits, and workflow calls
  all use the single `waitingFor` slot.
- `advanceWorkflow` requires the single active `waitingFor.turnId` and kind to
  match the incoming observation. Workflow-call completion additionally checks
  the expected `childRunId` before advancing.
- There is no fan-out record, no branch id, no branch completion set, no join
  policy, and no way for one workflow state to wait for multiple agent turns.

### Persisted runtime

- `PersistedWorkflowRuntime.runReady` resumes or starts the one pending effect
  represented by the core snapshot.
- Agent-turn, human-form, workflow-call, GitHub CI, and command completion paths
  all call `advanceWorkflow` against the single current wait.
- Parent/child workflow-call support is blocking and one-child-at-a-time. Parent
  wakeup scans for parents waiting on a matching child run id.
- Crash/idempotency hardening exists around specific single waits, but not around
  parallel branch claims or multiple pending turns.

### Existing orchestration surfaces

- Batch runs can start many independent workflow runs, but they are not one
  workflow instance with a join.
- Bead meta-workflows process child workflow runs sequentially by design.
- Lane/write-token work protects mutations, but parallel read-only review branch
  policy is not yet encoded in workflow-core.
- Dev / Review / Tester currently has one Review state and one Tester state with
  loops back to Dev; it does not express multiple reviewer branches.

## Recommendation

Do **not** implement the full feature directly from the current model. Start with
a design/form decision milestone, then implement in staged slices. The necessary
changes touch workflow-core snapshot shape, persisted runtime idempotency, VK
turn dispatch, launch/session binding, presentation read models, graph/editor
views, and E2E qa-mode coverage.

Recommended first implementation shape after decisions:

1. Add an explicit supported parallel review construct rather than hidden
   special runner behavior.
2. Keep every branch output as normal workflow action-result XML.
3. Store deterministic branch ids and turn ids in durable snapshot state.
4. Join only after all required branches complete in v1.
5. Defer scheduler-based timeouts until scheduled jobs are available, unless the
   user chooses a manual/product-blocked timeout policy.

## Proposed workflow model direction

### New step type option: `parallel_review`

A focused `parallel_review` step is preferred for v1 because it matches the user
story without opening generic arbitrary parallel workflow semantics.

Conceptual authoring shape:

```json
{
  "id": "parallel_review",
  "type": "parallel_review",
  "title": "Parallel review",
  "branches": [
    {
      "id": "product_review",
      "role": "product_review",
      "prompt": { "refs": [{ "kind": "prompt", "id": "prompt.review.product", "versionMode": "latest" }] },
      "response": { "format": "xml" }
    },
    {
      "id": "security_review",
      "role": "security_review",
      "prompt": { "refs": [{ "kind": "prompt", "id": "prompt.review.security", "versionMode": "latest" }] },
      "response": { "format": "xml" }
    }
  ],
  "join": {
    "policy": "all_required",
    "targetState": "review_summary"
  }
}
```

This is illustrative only; exact schema should be decided before implementation.

### Snapshot/runtime state

Introduce a durable parallel wait shape rather than overloading the current
single `waitingFor` turn:

```ts
type ParallelReviewWait = {
  kind: "parallel_review";
  state: WorkflowStateId;
  stepId: WorkflowStepId;
  groupId: string;
  joinPolicy: "all_required";
  branches: Array<{
    branchId: string;
    roleId: WorkflowRoleId;
    turnId: string;
    status: "planned" | "sent" | "completed" | "failed" | "blocked";
    responseRef?: string;
    action?: WorkflowActionId;
    parsed?: Record<string, unknown>;
    issue?: WorkflowRuntimeIssue;
    retryAttempt?: number;
  }>;
};
```

Implementation can either add this as a new `waitingFor.kind` or introduce a
separate `parallelWait` field. A separate field may be less disruptive to the
existing single-wait code, but a new `waitingFor.kind` keeps "what is the
workflow waiting for" in one place. The choice should be explicit.

### Fan-out behavior

- When the parallel review step is reached, runtime claims the group and queues
  one agent turn per branch with deterministic identifiers.
- Each branch receives the same run inputs, latest bead context, prior transition
  context, and generated XSD for that branch's allowed action-result shape.
- Role/session binding uses existing SEBL-compatible role preferences and launch
  binding resolution per branch role.
- Branches are read-only review by default. Any write-capable branch should be
  rejected until lane/write policy for parallel writes is separately approved.

### Fan-in/join behavior

- One branch completion updates only that branch and does not advance the parent
  step unless the join policy is satisfied.
- With `all_required`, every required branch must complete successfully.
- The join transition records a deterministic aggregate payload containing one
  product-safe result per branch: branch id, role label, action id/label, parsed
  fields, response/artifact references for diagnostics only, and summary text.
- The following state can use these results through normal prompt templating and
  preview/read-model data.

### Failure/retry behavior

- Invalid XML retry remains branch-local. One branch retry must not resend all
  other branch prompts.
- Branch retry exhaustion blocks the parallel group with product-safe issue text.
- Unknown branch id, wrong turn id, stale visit id, duplicate response, or wrong
  run id is a stale/no-op observation.
- Scheduler-based timeouts are deferred unless the user chooses to include a
  manual timeout/checkpoint policy now.

### Product/UI behavior

- Run story page should show a single major event such as "3 reviewers are
  reviewing in parallel" with child rows for each reviewer.
- Completed branch rows should use plain labels: "Security Review requested
  changes", "Product Review approved", etc.
- Join summary should say what happens next: "Waiting for all reviewers", "All
  reviewers finished; summarizing review results", or "Security Review needs
  attention".
- Graph/editor should display the parallel review as a grouped step with visible
  branch labels. It should not pretend branches are ordinary sequential edges.
- Diagnostics may include branch ids and refs, but primary UI must not expose raw
  XML/XSD, queue/webhook internals, local paths, provider diagnostics, shell, bd,
  or git command text.

## Proposed milestone sequence

### M121A — Parallel review semantics design and fixtures

- Finalize schema shape, snapshot shape, join policy, failure policy, and UI
  language.
- Add checked-in draft fixtures for product/security review and DRT multi-review.
- No runtime behavior yet.

### M121B — Core fan-out/fan-in runtime semantics

- Add workflow-core normalization/validation for the approved parallel review
  construct.
- Add deterministic branch ids/turn ids and idempotent branch observations.
- Add core tests for fan-out, partial completion, join, duplicate/stale branch
  responses, invalid XML retry exhaustion, and blocked states.

### M121C — Persisted runtime integration

- Persist parallel group waits and branch completions.
- Queue all branch turns through the real VK boundary.
- Preserve retry and crash recovery semantics.
- Add route/runtime tests and a Docker qa-mode API E2E if stable.

### M121D — Product UI/read-model/editor support

- Run presentation shows parallel review groups and branch statuses.
- Editor/graph can author or at least render supported parallel review steps.
- Storybook covers running, partial, all-complete, blocked, and dense branch
  states.
- Browser E2E covers at least one simple two-reviewer flow.

## Acceptance cases for implementation

### TEST_CASE_89NE_1A — Validation rejects unsafe/ambiguous parallel config

Steps:
1. Load a workflow with duplicate branch ids.
2. Load a workflow with a branch role that does not exist.
3. Load a workflow with a write-capable command/action inside a parallel review
   branch.
4. Load a workflow with no branches or no join target.

Expected:
- Normalize/publish rejects each invalid definition with stable product-safe
  paths/messages.
- No unsupported branch-push, shell, or raw command surface appears.

### TEST_CASE_89NE_1B — Fan-out queues every review branch once

Steps:
1. Start a workflow with two or three parallel review branches.
2. Inspect planned effects/persisted queued turns.

Expected:
- One turn is queued for each branch with deterministic branch id and turn id.
- Each prompt contains the same task/bead context and that branch's generated
  XML/XSD contract.
- No branch completes or joins before an actual branch response arrives.

### TEST_CASE_89NE_1C — Join waits for all required branches

Steps:
1. Complete one branch successfully.
2. Inspect the run.
3. Complete all remaining required branches.

Expected:
- After the first completion, run remains running and waiting for the remaining
  branches.
- After all required completions, workflow advances to the join target or next
  step with deterministic aggregate results.

### TEST_CASE_89NE_1D — Stale and duplicate branch responses are safe

Steps:
1. Complete a branch twice with the same turn id.
2. Complete a branch with the wrong branch id.
3. Complete a branch from an old visit/group id.

Expected:
- Duplicate completion is idempotent/no-op.
- Wrong/stale completion is ignored through the existing stale-observation style
  path.
- Join is not double-applied.

### TEST_CASE_89NE_1E — Branch invalid XML retries then blocks product-safely

Steps:
1. Return malformed XML for one branch.
2. Verify only that branch receives retry guidance and XSD again.
3. Exhaust retries for that branch.

Expected:
- Other completed/pending branches are not restarted.
- Parallel group blocks with a safe reason tied to the failed branch.
- Primary UI does not show raw XML/XSD or internal response refs.

### TEST_CASE_89NE_1F — Failure/timeout policy is explicit

Steps:
1. Simulate one branch failing or timing out under the approved policy.
2. Inspect run presentation and API read model.

Expected:
- If v1 chooses fail-fast, the whole group blocks.
- If v1 chooses collect-and-join, the failure is included in aggregate results.
- If scheduler timeouts are deferred, timeout controls are hidden and tests assert
  no unsupported timeout UI/config is exposed.

### TEST_CASE_89NE_1G — Run presentation explains parallel review plainly

Steps:
1. Render running, partial-complete, blocked, and completed parallel review runs.
2. Inspect timeline and summary.

Expected:
- UI explains who is reviewing, what is complete, what remains, and what happens
  next.
- Product labels avoid queue/webhook/internal/debug/raw XML vocabulary.

### TEST_CASE_89NE_1H — Docker qa-mode covers a representative path

Steps:
1. Load a two-reviewer workflow via API or create it through browser UI once
   editor support exists.
2. Use qa-mode scripted responses for both reviewers.
3. Verify join and completion via HTTP and browser run page.

Expected:
- Both branch turns go through normal VK/VD message and webhook boundaries.
- Final presentation shows branch results and final status.
- Trace/video/log artifacts are captured.

## Review/tester handoff guidance

Before implementation review:

- Identify exactly which schema/snapshot shape was selected by the user.
- Confirm unsupported controls are hidden.
- Confirm no scheduler/generic shell/branch-push behavior was added.
- Run workflow-core tests, persisted runtime tests, presentation/component tests,
  check-types, Storybook build if UI touched, Playwright listing, and relevant
  Docker qa-mode E2E when runtime behavior is introduced.

Tester should focus on:

- Partial completion not advancing early.
- Duplicate/stale branch responses not changing results.
- Invalid XML retry being branch-local.
- UI clarity for "who has the ball" across multiple reviewers.
- Product-safety scans for raw XML/XSD, queue/webhook/internal ids, local paths,
  shell, bd, or git text in normal UI.

## Decision form questions

1. **Parallel workflow shape**
   - **Explicit parallel review step (recommended):** fastest safe path for
     multiple reviewer roles without opening generic parallel semantics.
   - Generic parallel group: more flexible, but much larger validation/runtime/UI
     surface.
   - Parallel child workflow calls: reuses workflow-call concepts, but adds
     parent/child fan-out complexity and may feel indirect for simple reviewers.

2. **Join policy for v1**
   - **All required reviewers must finish (recommended):** deterministic and easy
     to explain.
   - Any approval can continue: faster but risks ignoring important reviewer
     findings.
   - Quorum/threshold: powerful but needs more product design.

3. **Reviewer selection source**
   - **Workflow config defines reviewer roles/branches (recommended):** stable,
     testable, and publishable.
   - Launch-time user picks reviewers: flexible, but requires more launch UI and
     validation.
   - Hybrid: workflow defines defaults and launch can disable optional branches.

4. **Branch failure policy**
   - **Any required branch failure blocks the group (recommended):** safest v1.
   - Collect failures and still join: useful for reporting, but downstream states
     must handle mixed success/failure.

5. **Timeout policy**
   - **Defer scheduler-based timeouts (recommended):** avoids coupling this bead
     to scheduled jobs.
   - Manual timeout/mark blocked action: possible but needs explicit operator UI.
   - Implement timed polling now: larger scope and depends on scheduler design.

6. **Workspace/lane isolation for parallel reviewers**
   - **Review-only branches can share the current workspace/session context
     (recommended):** OK if branches do not mutate files.
   - Require one lane per reviewer: safer for future write-capable branches but
     too heavy for review-only v1.

7. **Join result shape**
   - **Generic `reviewResults[]` aggregate with branch labels (recommended):**
     keeps action-result XML normal and supports arbitrary reviewer types.
   - Fixed fields per reviewer role: easier to template but brittle as reviewers
     change.

8. **First implementation proof**
   - **Core + persisted runtime + HTTP E2E first (recommended):** proves the hard
     orchestration semantics before editor polish.
   - Editor/Storybook first: helps design visuals but risks building UI for
     unsettled semantics.
