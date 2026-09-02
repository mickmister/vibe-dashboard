# Test Plan 14: GCW-13 lane worktree provisioning and dependency cache policy

Branch: `vk/8b79-vd-workflows`

Primary bead: `vibe-kanban-vscode-web-3q4q` — GCW-13 Lane worktree provisioning and dependency cache policy

Status: policy + typed helper slice; no physical worktree creation

## Purpose

GCW-7B can manually fan out ready task beads through Gas City only when an
existing clean lane is supplied for each launched bead. This plan defines the
lane/worktree provisioning policy needed before product UI or automatic lane
creation is allowed.

The user clarified that temporary worktrees should eventually merge back into the
feature branch/main VK workspace, and dependency cache/copy behavior such as
`node_modules`, package-manager stores, and build caches should be part of the
formula or lane provisioning process. Auto-merge remains tracked separately in
`vibe-kanban-vscode-web-tmds` and is out of scope here.

## Authority and boundaries

- Gas City/Beads remain authoritative for task/workflow truth.
- VD lane state is a supplemental safety/read-model boundary for workspace and
  worktree isolation.
- `workspaceId` is the existing VK workspace id; no separate VD workspace id.
- First fanout policy requires an existing clean lane. Missing lane returns an
  explicit offer-create model only; it does not create a worktree in this slice.
- No destructive worktree deletion, auto-merge, branch push, scheduler/orders,
  unattended automation, raw shell command exposure, or VD authoritative mirror.

## Clean-lane detection

A lane is launch-ready only when all are true:

1. lane belongs to the selected parent VK workspace;
2. lane is not archived;
3. worktree status is `clean`;
4. write capacity is available;
5. lane is not over workspace/lane quota;
6. lane is explicitly selected or already bound to the source bead.

Blocked statuses:

| Condition | Reason code | Product action |
| --- | --- | --- |
| no lane selected | `lane_missing` | Create or choose a clean lane |
| dirty worktree | `lane_dirty` | Resolve lane changes before launch |
| active writer | `lane_held` | Wait or recover write capacity |
| unknown/pending worktree | `lane_unknown` | Refresh lane status |
| other workspace | `lane_wrong_workspace` | Choose a lane in this workspace |
| archived lane | `lane_archived` | Choose another lane |
| quota full | `quota_reached` | Free/archive lanes or raise quota |

## Missing-lane offer-create path

The offer-create model is deterministic and side-effect free:

- `laneId`: derived from source bead id and stable hash of workspace/bead/formula/target;
- `name`: derived from task bead title;
- `purpose`: `Isolated work for task bead <id>.`;
- `workingBranch`: `lane/<bead-id>-<hash>`;
- `idempotencyKey`: `lane-create:<workspaceId>:<sourceBeadId>:<formula>:<target>`.

A later creation slice must revalidate the bead, workspace, and lane status before
creating anything. Duplicate create with the same key and identity should reuse;
same key with different identity must block.

## Create-vs-reuse policy

Initial product behavior:

1. Reuse only a lane explicitly selected by the user or already bound to the bead.
2. Never silently switch a bead from one active lane to another.
3. Unknown/dirty/held lanes block before launch.
4. Auto-create is deferred until there is a typed, audited create endpoint and UI
   confirmation.

Desired future target:

- Product can offer “Create lane for each selected task” after preview.
- Created lanes are temporary sub-workspaces under the parent VK workspace.
- Creation is idempotent and uses the offer-create identity above.

## Dependency cache/copy policy

Preferred order for lane provisioning:

1. Reuse package-manager stores/caches (`pnpm`, `npm`, `yarn`, `bun`) when present.
2. Copy dependency folders such as `node_modules` only through a typed lane
   provisioner with size/freshness checks.
3. If no cache is available, install dependencies normally in the lane.

Normal UI/read models should show only product-safe status such as:

- `Reuse pnpm store/cache during lane provisioning before installing dependencies.`
- `Dependency folder copy may be used only by the typed lane provisioner with size and freshness checks.`
- `No dependency cache is available; lane provisioning should install dependencies normally.`

Normal UI must not expose raw local paths, shell commands, stdout/stderr, provider
diagnostics, or raw package-manager output.

## Cleanup/quota policy

- Cleanup is explicit and audited only.
- Active/running/held lanes cannot be cleaned up.
- No destructive deletion in this slice.
- Quotas should count active non-archived temporary lanes per parent workspace.
- Quota errors block with product-safe copy and do not launch hidden work.

## Merge-back policy

Out of scope for GCW-13. First behavior: completed work remains in the temporary
lane/sub-workspace and the user manually reviews/merges. Auto-merge-on-green is
tracked separately by `vibe-kanban-vscode-web-tmds`.

## Acceptance cases

### TEST_CASE_GCW13_1A: Clean lane accepted

- Given a lane in the selected workspace with clean worktree and available write capacity
- When fanout provisioning evaluates it
- Then status is `ready`, lane id/label are product-safe, and no create offer is emitted

### TEST_CASE_GCW13_1B: Missing lane offers deterministic create

- Given a ready source bead and no lane
- When provisioning evaluates it
- Then status is `offer_create`, a deterministic lane id/name/branch/key is returned,
  and no worktree is created

### TEST_CASE_GCW13_1C: Dirty/held/unknown/wrong/archived/quota lanes block

- Given lanes in unsafe states
- When provisioning evaluates them
- Then each produces a stable reason code and product-safe next action

### TEST_CASE_GCW13_1D: Dependency cache status is safe

- Given pnpm/npm/yarn/bun cache availability, optional dependency folder copy, or no cache
- When provisioning evaluates cache policy
- Then output is product-safe and no raw paths/stdout/stderr are included

### TEST_CASE_GCW13_1E: No scope leak

- Tests assert no product output contains raw shell/gc/bd/git commands, local paths,
  stdout/stderr, provider diagnostics, or raw XML/JSON.

## Review/tester handoff

For this slice, review should verify:

- policy helper is side-effect free;
- no worktree creation/deletion/merge is implemented;
- missing lane returns offer-create only;
- cache policy is declarative/product-safe;
- GCW-7B existing clean-lane enforcement remains intact.

Validation:

- focused Vitest for lane provisioning policy;
- GCW-7B/GCW-7A provider tests;
- `npm run check-types`;
- `pnpm --filter @vibe-dashboard/workflow-core test` if workflow-core is touched;
- `git diff --check`.
