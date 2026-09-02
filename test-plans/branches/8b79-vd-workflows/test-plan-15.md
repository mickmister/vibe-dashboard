# Test Plan 15: GCW-12 auto-merge fan-in formula step after checks pass

Branch: `vk/8b79-vd-workflows`

Primary bead: `vibe-kanban-vscode-web-tmds` — GCW-12 Auto-merge fan-in formula step after checks pass

Status: design + side-effect-free typed policy helper; no real merge

## Purpose

The user selected `auto_merge_on_green`: after parallel/ready-bead lane work is
finished and required checks pass, the Gas City formula should contain an explicit
automatic merge step. Temporary worktrees/lane sub-workspaces merge back into the
feature branch/main VK workspace. Dependency copying/caching belongs to formula
or lane provisioning, which GCW-13 documents separately.

This slice defines the semantics and product-safe policy shape only. It does not
perform a git merge, delete worktrees, push branches, schedule background work,
or make VD authoritative for Gas City state.

## Authority and boundaries

- Gas City formula state owns when the fan-in merge step is reached.
- Beads/Gas City own authoritative task/workflow status and result notes.
- VD may generate formula step metadata, preview policy decisions, and product-safe
  read models.
- VK workspace/lane state provides worktree cleanliness and write-capacity safety.
- Normal product output must not show raw shell/git/gc/bd commands, local paths,
  stdout/stderr, provider diagnostics, raw XML/JSON, or generated file paths.

## Merge step semantics

The generated formula should contain an explicit fan-in step with these properties:

- contract: `graph.v2`;
- effect: typed auto-merge provider, not arbitrary shell;
- runs only after all required checks pass;
- reads lane/sub-workspace refs and source bead refs from typed metadata;
- merges completed clean temporary lanes into the parent VK workspace feature branch;
- records an audit/result note through Gas City/Beads;
- blocks and preserves lanes on conflict or unsafe state.

The merge provider must be typed and allowlisted in a later implementation. It
must not expose a raw git command surface to workflow JSON or UI.

## Required checks

Minimum required checks before merge:

1. all selected source-bead workflows are terminal successful;
2. each lane is completed and worktree-clean;
3. Review/Test or equivalent formula checks passed;
4. CI/check-run wait steps passed where configured;
5. no active write token remains in any merge candidate lane;
6. target parent workspace branch is available and not already merging.

Pending required checks produce `waiting_for_checks`. Failed checks produce
`checks_failed` and block without deleting lanes.

## Conflict/block behavior

- Merge conflict: block, preserve lane, record product-safe reason and next action.
- Dirty lane: block before merge.
- Missing/unknown lane: block before merge.
- Target unavailable: block before merge.
- Duplicate/replayed merge: use deterministic merge idempotency key and reconcile
  from Gas City/Beads metadata; never perform duplicate merge side effects.
- Rollback: first implementation should block and preserve lanes. Do not attempt
  destructive rollback until typed merge-provider behavior is reviewed.

## Temporary worktree to feature branch policy

- Temporary lane/sub-workspace work merges into the parent VK workspace feature
  branch.
- No branch push is implied by merge. Remote push/MR remains separate.
- Successful merge marks lane ready for explicit audited cleanup later.
- Failed merge leaves lane intact for inspection.

## Product language

Normal UI/read models should say:

- `Waiting for required checks before merge.`
- `All required checks passed; the formula merge step may run.`
- `Required checks failed; preserve lanes and block merge for review.`
- `All temporary lanes must be completed and clean before merge.`

Avoid: raw command lines, local paths, stdout/stderr, provider diagnostics, raw
formula TOML, raw XML/JSON, queue/webhook/internal IDs.

## Acceptance cases

### TEST_CASE_GCW12_1A: Ready after checks pass

Given completed clean lanes and all required checks passed, the policy returns
`ready`, reason `checks_passed`, and a deterministic graph.v2 formula step plan.

### TEST_CASE_GCW12_1B: Pending/failed checks do not merge

Pending required checks return `waiting_for_checks`; failed required checks return
`blocked/checks_failed`. No lane cleanup or merge side effect occurs.

### TEST_CASE_GCW12_1C: Unsafe lanes block

Missing, active, dirty, unknown, or failed lanes block the merge step with stable
reason codes and product-safe next action.

### TEST_CASE_GCW12_1D: Formula step metadata is deterministic

The generated merge step id is stable for the same formula/check set regardless
of check input order and does not contain raw paths or commands.

### TEST_CASE_GCW12_1E: Product safety

Policy/read-model output contains no raw shell/git/gc/bd commands, local paths,
stdout/stderr, provider diagnostics, webhooks, or raw XML/JSON.

## Implementation ladder

1. Current slice: docs + side-effect-free typed policy helper/tests.
2. Next: generated formula integration that includes typed merge step metadata.
3. Later: typed merge provider with dry-run, conflict detection, write token, and
   idempotency tests.
4. Later: product UI/read model for fan-in status.
5. Later: Docker E2E with temporary lane merge after checks pass.

## Review/tester handoff

Review should confirm:

- no actual git merge/push/delete is implemented;
- merge is represented as formula/provider intent only;
- blocked states preserve lanes;
- output is product-safe;
- GC/Beads remain authoritative.

Validation:

- focused Vitest for merge fan-in policy;
- existing Gas City provider/pack/fanout tests;
- `npm run check-types`;
- `git diff --check`;
- workflow-core tests if touched.
