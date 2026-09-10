# Test Plan 11: Remaining workflow productization after M116-M118

Branch: `vk/8b79-vd-workflows`

Status: planning / follow-up scope

## Purpose

This plan documents incomplete workflow productization features after the current
branch completed the lane foundation, executor/model role preferences, roadmap
UI, safe typed provider foundation, and sequential bead meta-workflow runtime
foundation.

The intent is to preserve the user stories, acceptance cases, and validation
expectations for the next spikes without re-opening completed milestone scope.
These follow-ups should be tackled in separate beads/milestones and should keep
the same safety posture: typed providers, product-safe read models, durable
state, and no raw shell/`bd`/`git` exposure unless explicitly re-approved.


## Decisions from `workflow_remaining_productization_decisions`

The human response on `vibe-kanban-vscode-web-qwzp` sets the next tranche as:

1. **M119A → M119B → M119C**. Implement real API/server meta-workflow
   integration first, then live roadmap/progress data, then browser
   meta-workflow UX.
2. **M119A scope:** include create/read/pause/resume APIs, typed bead metadata
   provider, real persisted child workflow launch, and typed idempotent result
   note writer.
3. **Child workflow versioning:** pin exact child workflow design/version at
   meta-run creation.
4. **Child workflow inputs:** pass only minimal ids/context: bead id, meta-run
   id, item id, child run id, pinned child design/version, and optional lane id.
   Do **not** inject extra coordinator notes or side-channel task guidance into
   direct agent messages; task-specific context belongs in the bead itself and
   child workflows may fetch bead content through typed providers when needed.
5. **Bead provider boundary:** typed API/store provider only; no direct `bd` CLI
   shell-out.
6. **Bead result mutation:** allow one product-safe idempotent append/update
   result note with caps, redaction, and provenance.
7. **Crash recovery:** retry child launch with the same deterministic child run id
   and idempotency key; if that child already exists, reuse/observe it rather
   than creating another child.
8. **M119B placement:** implement live roadmap/progress provider after M119A and
   before browser meta-workflow UX.
9. **M119C bead selection:** support live search/select and CKOV roadmap
   selection. Default search/listing is scoped to beads that carry this workspace
   id metadata and should surface parent issues rather than sub-issues by
   default. The UI should also provide filters for beads with no workspace
   metadata and beads from other workspaces.
10. **`olou`:** narrow/rename toward approved typed workflow providers only; do
    not implement generic bash in this branch.
11. **Physical lanes/worktrees:** defer production physical lifecycle until after
    M119A/B/C.
12. **Browser workflow creation E2E:** track `vibe-kanban-vscode-web-4a5a`
    for browser E2E coverage of UI-related branch work soon after M119A.

## Related completed foundations

- `vibe-kanban-vscode-web-tqhk` — M116 Sub-workspace lane foundation.
- `vibe-kanban-vscode-web-sebl` — Support choosing VK executor and model per
  workflow role.
- `vibe-kanban-vscode-web-ckov` — Workflow roadmap and multi-bead progress UI.
- `vibe-kanban-vscode-web-vhx5` — M117 Safe workflow command-step provider.
- `vibe-kanban-vscode-web-z1on` — M118 Bead-driven meta-workflow sequential
  pause/resume prototype.

## Related incomplete / broad tracker beads

- `vibe-kanban-vscode-web-qwzp` — Bead-driven meta-workflow runs.
- `vibe-kanban-vscode-web-olou` — Workflow bash command steps.

## Global guardrails for remaining work

- Do not add arbitrary shell execution by default.
- Do not expose raw `bd`, raw `git`, raw host paths, environment variables, or
  secrets in workflow JSON, APIs, normal UI, or product artifacts.
- Do not add branch push UX in this branch unless the user explicitly re-approves
  that scope.
- Do not add parallel bead fan-out until lane isolation, capacity, and merge
  policies are proven in a dedicated plan.
- Prefer typed bead/workflow/provider interfaces over shelling out to CLIs.
- Preserve durable, idempotent state transitions before side effects.
- Keep user-facing read models product-safe and diagnosable without leaking
  internal transport ids.

---

## M119A — Production bead-driven meta-workflow integration

Primary bead: `vibe-kanban-vscode-web-qwzp`

### User story

As a project coordinator, I can select an ordered list of real beads and a child
workflow so the system processes each bead one at a time, records progress back
to the right bead/run summaries, and lets me monitor what remains.

### Scope

In scope:

- Product API to create/read/pause/resume a sequential meta-workflow run.
- Real bead metadata read provider using typed API/store interfaces only.
- Real child workflow launch integration for the active bead.
- Exact child workflow design/version pinned at meta-run creation.
- Minimal child input contract: bead id, metaRunId, itemId, childRunId, pinned child design/version, and optional lane id only.
- Product-safe idempotent append/update result-note provider for completed child runs.
- Read model that CKOV or a future meta-run page can consume.
- Idempotent child launch and idempotent result recording.

Out of scope:

- Parallel bead execution.
- Branch push / merge automation.
- Raw `bd` command execution or direct CLI shell-out.
- Arbitrary shell command steps.

### Acceptance cases

#### TEST_CASE_M119A_1A — Create meta-run from real ordered beads

Expected:

- API accepts an ordered bead list and child workflow design/version.
- Exact child workflow design/version is pinned at meta-run creation.
- Missing/unpublished/wrong-workspace child workflow is rejected before launch.
- Duplicate bead ids fail with stable validation issues.
- Missing, inaccessible, removed, or archived beads fail before launch.
- Wrong-workspace and no-workspace beads are allowed only when explicitly
  selected/validated through typed provider filtering; default selection favors
  current-workspace parent beads.
- The created run has durable ordered items and a product-readable read model.

#### TEST_CASE_M119A_1B — Launch one real child workflow at a time

Expected:

- Starting/resuming a meta-run launches only the first pending bead child.
- Child input includes only minimal ids/context: bead id, metaRunId, itemId,
  childRunId, pinned child design/version, and optional lane id.
- No extra coordinator/task notes are injected into direct agent messages; task
  details must live in the bead or be fetched through typed providers by the
  child workflow.
- Exactly one child is active at a time.
- Duplicate wakeups/resumes do not launch duplicate children.

#### TEST_CASE_M119A_1C — Child completion advances and records result

Expected:

- Completed child run records summary, status, artifacts, and provenance on the
  meta-run item.
- Typed bead note/result provider appends or updates one product-safe result
  note idempotently; no broader label/status/dependency mutation occurs.
- Replaying the same completion does not duplicate notes or advance twice.
- Result-note writes use one deterministic note key per `metaRunId:itemId`;
  replay updates or no-ops the same note rather than appending another note.
- If note append/update fails after child completion, the item blocks before
  advancing with a product-safe retry/next-action state, and retry uses the same
  deterministic note key.
- Meta-run advances to the next bead after recording the result.

#### TEST_CASE_M119A_1D — Child failure blocks product-safely

Expected:

- Failed/blocked child run blocks or pauses the meta-run.
- Read model shows the failed bead, child run link, readable reason, and next
  action.
- Previously completed bead results remain intact.
- Resume/retry behavior is explicit and idempotent.

#### TEST_CASE_M119A_1E — Child completion and crash recovery are safe

Expected:

- Parent observes child terminal/blocked state through the persisted workflow
  runtime/store/event/read-model seam, not browser UI or presentation text.
- Parent accepts completion only for the expected `metaRunId + itemId + childRunId`.
- Wrong/stale child completion is a no-op or stable rejection and does not
  advance the run.
- If process restarts after durable child claim but before launch confirmation,
  catch-up retries launch with the same childRunId/idempotencyKey.
- If a child run already exists for that childRunId/idempotencyKey, catch-up
  reuses/observes the existing child instead of creating a second child.
- Duplicate resume/wakeup after restart does not create duplicate children.

#### TEST_CASE_M119A_1F — Meta-run progress read model is CKOV-compatible

Expected:

- M119A exposes a meta-run progress read model with current bead index,
  completed/pending/blocked bead counts, child run links, and latest result
  summaries.
- The read model is compatible with CKOV consumption, but actual CKOV rendering
  of live data belongs to M119B.
- Provider unavailable/partial states are represented in the read model without
  crashing.

### Validation

Required:

```bash
npm run check-types
git diff --check
```

Plus:

- server/runtime tests for create/start/pause/resume/complete/fail flows,
- route tests for create/read/pause/resume endpoints if added,
- idempotency tests for child launch and result note writes,
- read-model tests for CKOV/live progress integration,
- no-scope-leak grep/review for raw shell/`bd`/`git`/branch push.

---

## M119B — Live roadmap/progress provider

Related feature: CKOV follow-up

### User story

As a user, I want the roadmap UI to reflect live bead and workflow state so it
can be trusted as the current project progress source instead of a static spike
snapshot.

### Scope

In scope:

- Typed live bead/progress provider scoped by workspace id metadata.
- Live review/tester bead rollups.
- Live workflow/meta-run links and artifact summaries.
- Stale/error/partial-data handling.
- Clear distinction between planned milestones and completed validated work.
- Freshness timestamp/provider identity and explicit static-fallback labeling.

Out of scope:

- Mutating bead status from roadmap UI.
- Starting workflows from roadmap UI unless separately approved.
- Raw `bd` command execution or direct CLI shell-out.

### Acceptance cases

#### TEST_CASE_M119B_1A — Roadmap uses live bead status

Expected:

- Roadmap read model fetches live bead status through a typed provider.
- Top-level and child bead statuses match provider data.
- Live status wins over static plan when they conflict; static plan remains
  contextual.
- Closed/review/tester/blocked state rolls up predictably.
- Status-count semantics state whether counts are top-level milestones or all
  child beads.

#### TEST_CASE_M119B_1B — Partial and stale data are safe

Expected:

- Provider unavailable state shows product error and retry guidance.
- Partial bead data shows best-effort progress plus stale/freshness indicator
  with provider identity and last-updated timestamp.
- Unknown artifacts or run links degrade gracefully.

#### TEST_CASE_M119B_1C — Live artifact/run links are product-safe

Expected:

- Artifact and workflow run links appear only when supported.
- Raw file paths, internal queue ids, and unsupported URLs are not primary UI.
- Missing linked resources show a clear unavailable state.

#### TEST_CASE_M119B_1D — Static fallback remains useful

Expected:

- If live provider is disabled/unavailable, the current static typed roadmap can
  still render as a fallback or fixture.
- UI labels clearly distinguish fallback/stale data from live data.

### Validation

Required:

```bash
npm run check-types
git diff --check
npm run build-storybook
```

Plus:

- read-model tests for live, partial, stale, error, empty states,
- component tests for status rollups and links,
- Storybook states for live mixed progress, stale provider, provider error, and
  completed spike,
- Playwright smoke if a browser route changes.

---

## M119C — Meta-workflow browser UX

Related beads: `vibe-kanban-vscode-web-qwzp`, CKOV follow-up

### User story

As a user, I can create and monitor bead meta-workflows in the browser so I do
not need low-level APIs or manual coordinator messages to run a sequential bead
workflow.

### Scope

In scope:

- Browser UI to search/select beads and order them, default-scoped to current
  workspace id metadata.
- CKOV roadmap selection entry point for roadmap-scoped bead sets.
- Child workflow picker.
- Start/pause/resume controls using typed meta-run APIs.
- Per-bead progress and child run links.
- Blocked/failure next-action display.

Out of scope:

- Parallel fan-out.
- Branch push controls.
- Raw command provider controls.
- Browser editing of arbitrary shell steps.

### Acceptance cases

#### TEST_CASE_M119C_1A — Create meta-run in browser

Expected:

- User can open a new meta-workflow screen.
- User can search/select beads from the typed provider, default-filtered to
  parent beads with this workspace id metadata.
- User can switch filters to include no-workspace beads or other-workspace beads
  with clear labels/warnings.
- User can also start a selection from CKOV roadmap context.
- User can reorder selected beads and remove duplicates.
- Duplicate/inaccessible/removed/wrong-workspace beads are rejected in UI before
  start.
- User can choose a child workflow.

#### TEST_CASE_M119C_1B — Monitor sequential progress

Expected:

- UI shows active bead, pending beads, completed beads, and blocked beads.
- Active child workflow link is visible when supported.
- Completed item summaries/artifacts are visible.

#### TEST_CASE_M119C_1C — Pause/resume controls are safe

Expected:

- Pause persists and prevents launching the next child.
- Resume continues from the correct bead.
- Duplicate clicks do not launch duplicate children.
- Controls are disabled or explained when lane/status prevents action.

#### TEST_CASE_M119C_1D — Blocked state is actionable

Expected:

- Child failure shows reason, affected bead, child run link, and next action.
- UI does not expose internal queue/webhook ids as primary text.
- User can retry/continue only through explicitly supported actions.

### Validation

Required:

```bash
npm run check-types
git diff --check
npm run build-storybook
```

Plus:

- component tests for selection, ordering, duplicate validation, progress states,
- route/API tests for start/pause/resume if endpoints are added,
- Storybook states for empty, active, paused, blocked, completed, dense bead
  lists,
- Playwright smoke for browser-visible creation/monitoring route.

---

## M120A — Production lane/worktree integration

Related beads: `vibe-kanban-vscode-web-tqhk`, `vibe-kanban-vscode-web-z6l3`

### User story

As a workflow operator, I want workflow automation to use safe isolated lanes so
multiple agents or workflows do not mutate the same working tree at the same
time.

### Scope

In scope:

- Explicit lane creation/selection UI or typed API.
- Physical worktree/sub-workspace creation if approved by design.
- Lane cleanup/recovery surfaces.
- Real write-token acquisition/release by mutating typed providers.
- Dirty/stale/unknown worktree state blocking.

Out of scope:

- Automatic branch push/merge.
- Parallel fan-out until lane merge policies are approved.
- Raw path selection by workflow JSON.

### Acceptance cases

#### TEST_CASE_M120A_1A — Create/select lane safely

Expected:

- User can create or select a lane for a workflow/bead.
- Lane belongs to the correct parent workspace.
- UI shows lane purpose, status, owner, and capacity.
- Raw host paths are hidden from normal UI.

#### TEST_CASE_M120A_1B — Write token gates mutation

Expected:

- Mutating typed provider cannot run without a selected lane and active write
  token.
- Concurrent write attempt for the same lane fails with product-safe conflict.
- Release is idempotent.

#### TEST_CASE_M120A_1C — Dirty/stale/crash recovery is safe

Expected:

- Dirty/unknown lane blocks new mutating work.
- Stale/orphan write token requires explicit recovery.
- Recovery is audited and idempotent.
- A crash during write does not silently allow overlapping writes.

#### TEST_CASE_M120A_1D — Cleanup is explicit and auditable

Expected:

- Completed/archived lane can be cleaned up only through explicit supported
  action.
- Cleanup refuses active/running lanes.
- Cleanup records provenance and preserves product summary.

### Validation

Required:

```bash
npm run check-types
git diff --check
```

Plus:

- server/store tests for physical lifecycle if implemented,
- provider tests for write-token enforcement,
- component tests for lane selection/overview/cleanup UI,
- crash/stale recovery tests,
- no-scope-leak review for branch push/merge.

---

## M120B — Typed command provider expansion / `olou` narrowing

Primary bead: `vibe-kanban-vscode-web-olou`

### User story

As a workflow author, I can add approved typed workspace operations to workflows
without exposing arbitrary bash or unsafe host access.

### Product decision needed

`olou` currently says "Workflow bash command steps," but M117 intentionally
implemented a typed provider foundation and did **not** authorize arbitrary bash.
Before implementation, decide whether to:

1. Rename/narrow `olou` to approved typed command providers only; or
2. Create a separate, explicitly approved shell-provider design with stronger
   sandbox/security review.

Decision: **typed providers only** for this branch. `olou` should be renamed or narrowed away from generic bash before implementation. Any shell-like provider requires a separate future threat model, sandbox design, permission model, and negative E2E plan.

### Scope if narrowed to typed providers

In scope:

- Additional first-party providers such as read-only bead status, workflow status,
  or lane diagnostics.
- Optional mutating provider only if lane/write-token gated and explicitly
  approved.
- Output caps/redaction/result-field limits.
- Audit/provenance in presentation/read models.

Out of scope unless re-approved:

- Generic bash strings.
- Shell interpolation.
- Raw git push.
- Host path cwd selection.
- Environment inheritance/secrets access.

### Acceptance cases

#### TEST_CASE_M120B_1A — Provider allowlist controls available actions

Expected:

- Only registered provider/action pairs validate.
- Unknown provider/action fails before publish.
- UI/API labels are product-readable and do not imply arbitrary shell.

#### TEST_CASE_M120B_1B — Read-only provider is safe and bounded

Expected:

- Provider returns typed fields, summary, and capped previews.
- Secret/path-like data is redacted before persistence.
- Result appears in workflow presentation without raw terminal transcript.

#### TEST_CASE_M120B_1C — Mutating provider requires lane policy

Expected if mutating provider is added:

- Requires selected lane and active write token.
- Dirty/stale/no-capacity blocks execution.
- Duplicate wakeups do not duplicate mutation.
- Audit records lane/provenance without raw host path.

#### TEST_CASE_M120B_1D — Shell-like provider remains unavailable

Expected:

- Workflow JSON containing generic shell/bash command is rejected.
- Browser UI does not offer arbitrary bash step.
- Tests prove no process-spawn path is reachable from untrusted workflow config.

### Validation

Required:

```bash
pnpm --filter @vibe-dashboard/workflow-core test
npm run check-types
git diff --check
```

Plus:

- provider registry tests,
- workflow design publish rejection tests,
- runtime execution/idempotency tests,
- presentation/read-model redaction tests,
- no-scope-leak grep/review for `spawn`, `execFile`, `child_process`, raw `bd`,
  raw `git`, and branch push.

---

## M120C — Browser workflow creation E2E

Related feature: LV2K follow-up

Primary bead: `vibe-kanban-vscode-web-4a5a` — Browser E2E coverage for workflow UI branch

### User story

As a developer/tester, I want browser E2E coverage proving that a workflow can be
created in the UI, published, launched, run through VK qa-mode, and verified in
the browser result page.

### Scope

In scope:

- Browser workflow creation through wizard/editor.
- Publish through UI.
- Launch through UI.
- VK qa-mode scripted completion.
- HTTP and browser verification of final result.

Out of scope for first slice:

- Exhaustive editor controls.
- Every workflow fixture shape.
- Parallel/batch workflows.
- Branch push.

### Acceptance cases

#### TEST_CASE_M120C_1A — Browser creates and publishes simple workflow

Expected:

- User creates a minimal role/state/action workflow in the browser.
- User publishes it.
- Published workflow appears in Workflows home.
- No DB seeding is used for the workflow definition.

#### TEST_CASE_M120C_1B — Browser launches and observes completion

Expected:

- User launches the browser-created workflow.
- VK qa-mode completes the agent turn through normal message/webhook path.
- Run presentation reaches completed state.
- Browser page shows final summary/output.

#### TEST_CASE_M120C_1C — Failure artifacts are useful

Expected:

- On timeout/failure, Playwright artifacts include trace/video/logs.
- Presentation polling logs last status and timeline summary.
- Test does not pass on a fake/direct runtime completion path.

#### TEST_CASE_M120C_1D — Creation UI respects role executor/model defaults

Expected if SEBL controls are visible:

- Default executor/model choices do not force explicit preferences unless user
  chooses them.
- Explicit preference survives publish and launch.
- Existing-session mismatch is visible or rejected according to policy.

### Validation

Required:

```bash
npm run check-types
git diff --check
```

Plus:

- focused Playwright Docker/VK qa-mode browser E2E,
- reuse existing LV2K API fixtures where helpful for expected outcomes,
- no direct runtime completion or DB workflow-definition seeding,
- artifact capture on failure.

---

## M120D — SEBL polish and live VK capabilities

Related bead: `vibe-kanban-vscode-web-sebl`

### User story

As a workflow runner, I want executor/model choices to be clear in every launch
surface and backed by live VK capabilities so role/session binding is predictable.

### Scope

In scope:

- Batch-run executor/model selection or clear batch default behavior.
- Clear labels distinguishing role default, workspace default, and explicit
  override.
- Live VK executor/model capability endpoint integration when available.
- Better mismatch messaging for existing sessions.

Out of scope:

- New executor implementation in VK.
- Arbitrary provider strings.
- Breaking existing no-preference workflows.

### Acceptance cases

#### TEST_CASE_M120D_1A — Batch launch behavior is explicit

Expected:

- Batch launch either exposes per-role executor/model choices or clearly states
  it uses authored/workspace defaults.
- Server validation still rejects incompatible existing sessions.
- No-preference workflows do not force CODEX/recommended.

#### TEST_CASE_M120D_1B — Default labels are unambiguous

Expected:

- UI distinguishes "Use role default" from "Workspace default" when a role has
  an authored preference.
- User can tell whether an explicit override will be sent in launch payload.
- Component tests cover preference/no-preference label variants.

#### TEST_CASE_M120D_1C — Live model catalog replaces static options

Expected when VK capability endpoint exists:

- Launch/editor options come from typed VK capability read model.
- Unsupported/stale catalog states degrade gracefully.
- Static options remain test fallback only.

### Validation

Required:

```bash
npm run check-types
git diff --check
```

Plus:

- launch/batch route tests,
- component tests for default labels and mismatch copy,
- VK capability client/read-model tests when endpoint exists,
- Playwright smoke if browser-visible batch launch changes.

---

## M120E — Graph/layout hardening for large workflows

Related graph/editor follow-up

### User story

As a workflow author, I want large workflow graphs to stay readable so I can
understand role/state/transition flow without labels hiding behind nodes or
manual rework every session.

### Scope

In scope:

- Stronger automatic layout for dense graphs.
- Optional persisted editor-only layout metadata if approved.
- Manual repositioning persistence and reset layout.
- Dense graph visual QA/Storybook fixtures.

Out of scope:

- Changing runtime semantics or canonical workflow execution order.
- Persisting layout inside runtime-critical workflow JSON unless explicitly
  separated as editor metadata.

### Acceptance cases

#### TEST_CASE_M120E_1A — Dense graph avoids common overlap

Expected:

- Large role/state/transition graph renders with readable node and edge labels.
- Reverse edges/self-loops remain distinguishable.
- Selected transition details remain visible.

#### TEST_CASE_M120E_1B — Manual layout persists safely

Expected if persistence is added:

- User can drag nodes and save editor layout.
- Saved layout reloads without affecting workflow runtime semantics.
- Reset layout restores a useful automatic layout.

#### TEST_CASE_M120E_1C — Storybook visual QA covers large graphs

Expected:

- Storybook has dense/large workflow stories.
- Walkthrough captures top/selected/bottom or targeted regions.
- Dark-mode readability remains acceptable.

### Validation

Required:

```bash
npm run check-types
git diff --check
npm run build-storybook
```

Plus:

- graph model/layout tests,
- component tests for selected transition/state details,
- Storybook walkthrough screenshots/video for dense graphs,
- no workflow-core/runtime semantic diffs unless intentionally planned.

## Recommended sequencing

1. M119A production meta-workflow integration over real bead metadata and child
   workflows.
2. M119B live roadmap/progress provider so CKOV reflects real work.
3. M119C browser UX for meta-workflow create/monitor.
4. M120C browser workflow creation E2E for UI-related branch work soon after
   M119A/B contracts are stable.
5. M120A production lane/worktree integration for mutating providers after
   M119A/B/C.
6. M120B typed provider expansion / `olou` narrowing; generic bash remains out
   of scope unless separately re-approved.
7. M120D SEBL polish/live VK capabilities.
8. M120E graph/layout hardening as complexity demands.

## Reviewer and tester handoff expectations

Reviewer should verify for each follow-up:

- The milestone maps to the user story and acceptance cases in this plan.
- Safety guardrails are preserved or explicitly re-approved.
- Test coverage includes negative/blocked/error states, not only happy paths.
- Product UI/read models do not expose raw internal ids, host paths, env, queue
  ids, or transport details as primary text.

Tester should require:

- source/diff hygiene,
- `npm run check-types`,
- focused unit/server/component tests for the changed layer,
- Storybook build for browser-visible UI,
- Playwright/Docker E2E only when browser/product execution paths change,
- explicit PASS/FAIL/BLOCKED artifact summary tied to the relevant test cases.
