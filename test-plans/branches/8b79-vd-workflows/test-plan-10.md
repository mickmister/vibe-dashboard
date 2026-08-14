# Test Plan 10: Executor/model role settings and workflow roadmap progress UI

Branch: `vk/8b79-vd-workflows`

Spike beads:

- `vibe-kanban-vscode-web-sebl` — Support choosing VK executor and model per workflow role.
- `vibe-kanban-vscode-web-ckov` — Workflow roadmap and multi-bead progress UI.

Related beads:

- `vibe-kanban-vscode-web-z1on` — M118 Bead-driven meta-workflow sequential pause/resume prototype.
- `vibe-kanban-vscode-web-tqhk` — M116 Sub-workspace lane foundation.
- `vibe-kanban-vscode-web-vhx5` — M117 Safe workflow command-step provider.

Earlier plans:

- [`./test-plan-5.md`](./test-plan-5.md) — M113 UX audit and M114-M120 roadmap.
- [`./test-plan-8.md`](./test-plan-8.md) — M115 sub-workspace lane design.
- [`./test-plan-9.md`](./test-plan-9.md) — M116-M118 lane-backed automation spike.

## Purpose

This plan covers two near-term product surfaces that make workflow automation fit
our current project coordination loop:

1. Workflow roles can declare and display desired VK executor/model preferences.
2. Users can see the current workflow spike roadmap, milestone beads, sub-beads,
   and implementation/review/tester progress.

These features should make the future bead-driven meta-workflow feel like it can
latch onto existing sessions and project structure rather than inventing a
separate orchestration universe.

## Coordinator-owned guardrails

- This plan does not implement runtime model invocation changes unless explicitly
  covered by tests.
- Executor/model settings should be preferences validated against available VK
  options, not free-form unsafe provider strings.
- Roadmap UI should read bead/workflow progress through typed APIs/read models,
  not by shelling out to `bd`.
- Progress UI should not mutate beads in the first slice unless a typed mutation
  provider and approval policy exist.
- Branch push UX remains out of scope for this branch.

## Part A — Executor/model per workflow role

### User story

As a workflow author or runner, I can specify which VK executor type and model a
role should use so Dev, Review, Tester, or custom roles can use the right agent
profile without manual session confusion.

### Product questions answered by this plan

- Where is executor/model preference authored?
- How does launch UX show or override it?
- How is it validated against available VK executor/model options?
- How does it interact with create/reuse session binding?
- How is it recorded in run provenance?

### Recommended model

Role config may include an optional execution preference:

```json
{
  "roles": {
    "dev": {
      "label": "Developer",
      "executorPreference": {
        "executorType": "vk-agent",
        "model": "recommended-or-specific-model-id",
        "mode": "preferred"
      }
    }
  }
}
```

Recommended semantics:

- `executorType` must come from VK-supported executor/provider list.
- `model` must come from that executor's advertised model list or a supported
  alias such as `default`/`recommended`.
- `mode` starts as `preferred`, not `hard-required`, unless launch UX clearly
  handles unavailable models.
- Run snapshot records resolved executor/model actually used.
- Presentation shows product-readable executor/model summary when useful and
  diagnostics-only raw ids when necessary.

### Authoring surfaces

At minimum:

- Workflow editor role outline shows executor/model preference per role.
- Launch dialog shows role binding plus executor/model summary.
- Unsupported executor/model shows validation error before publish/launch.

Later:

- Creation wizard role setup can choose defaults.
- Roadmap/meta-workflow UI can show which executor/model each role will use for
  upcoming bead work.

### Acceptance cases

#### TEST_CASE_SEBL_1A — Role config stores executor/model preference

Expected:

- Workflow definition accepts optional executor/model preference per role.
- Unknown executor/model fails validation with stable path/error.
- Omitted preference uses workspace/VK default.
- Duplicate/copy workflow preserves preferences without binding to old sessions.

#### TEST_CASE_SEBL_1B — Launch resolves and snapshots actual executor/model

Expected:

- Launch options include available executor/model choices.
- Launch can use role defaults or explicit override where allowed.
- Run snapshot records resolved executor/model per role.
- Presentation/provenance can show what was used.

#### TEST_CASE_SEBL_1C — Session binding remains clear

Expected:

- Existing session reuse explains whether session executor/model matches role
  preference.
- Create-or-reuse creates/chooses a compatible session when possible.
- Mismatch blocks or warns according to product policy.
- UI avoids raw provider ids as primary labels.

#### TEST_CASE_SEBL_1D — UI is discoverable but not noisy

Expected:

- Role outline/editor shows executor/model affordance.
- Launch summary shows important mismatches.
- Default/recommended choices do not overwhelm simple workflows.

### Validation

Required:

```bash
npm run check-types
git diff --check
```

Plus:

- workflow definition validation tests,
- launch-options/read-model tests,
- run snapshot/provenance tests,
- component tests for editor/launch UI,
- Playwright smoke if browser-visible role selection ships.

## Part B — Workflow roadmap and multi-bead progress UI

### User story

As the project coordinator, I can open a workflow roadmap/progress view and see
which milestones/beads in the current spike are complete, in review, blocked,
in progress, or remaining, including sub-beads and tester/review status.

### Scope

In scope:

- Read-only UI for current workflow spike roadmap.
- Top-level milestone list.
- Expandable sub-beads.
- Status grouping: complete, in progress, blocked, review, tester, remaining.
- Links to bead detail and workflow run detail where supported.
- Progress summaries suitable for M118 meta-workflow runs.
- Storybook fixtures for representative roadmap states.

Out of scope for first slice:

- Mutating bead status.
- Starting workflows from the roadmap unless separately approved.
- Branch push.
- Scheduled jobs.
- Raw `bd` command execution from browser.

### Data/read-model expectations

Roadmap read model should be typed and product-oriented:

- spike id / campaign id,
- milestone beads,
- child/sub-beads,
- status and priority,
- labels/categories,
- review/tester state if represented by beads/labels,
- linked workflow runs,
- blockers/dependencies,
- last updated summary,
- next recommended action.

Normal UI should not require users to understand internal bead database details.

### Acceptance cases

#### TEST_CASE_CKOV_1A — Roadmap shows milestone hierarchy

Expected:

- Top-level spike milestones appear in intended order.
- Sub-beads are expandable/collapsible.
- Completed/in-progress/blocked/remaining states are visually distinct.
- Dependencies/blockers are visible without raw graph internals.

#### TEST_CASE_CKOV_1B — Progress reflects review/tester loop

Expected:

- A milestone can show implementation done, review pending, tester running,
  tester passed, or blocked.
- Closed tester beads roll up into parent milestone status.
- Failed/blocked tester beads surface next action.

#### TEST_CASE_CKOV_1C — Links and labels are product-safe

Expected:

- Bead links open supported bead detail surfaces.
- Workflow run links appear only when supported.
- Raw internal ids are secondary/diagnostic, not primary labels.
- Missing/unknown linked runs degrade gracefully.

#### TEST_CASE_CKOV_1D — Storybook covers roadmap states

Expected stories:

- empty/no spike selected,
- active spike with mixed states,
- blocked milestone with tester failure,
- completed spike,
- dense sub-bead hierarchy,
- dark-mode constrained layout.

#### TEST_CASE_CKOV_1E — M118 can reuse the read model

Expected:

- Sequential meta-workflow can show current bead index and completed beads using
  the same or compatible roadmap/progress model.
- Pause/resume state appears in progress UI.
- Results appended by typed bead provider can be displayed.

### Validation

Required:

```bash
npm run check-types
git diff --check
```

Plus:

- read-model tests for status rollups,
- component tests for hierarchy rendering,
- Storybook build and representative stories,
- Playwright smoke if visible in the Workflows tab or workflow run page.

## Spike sequencing

Recommended order:

1. Implement executor/model role config validation/read models if M118 needs
   reliable role/session selection.
2. Implement roadmap/progress read model and Storybook fixtures.
3. Add UI shell for roadmap/progress view.
4. Connect M118 sequential prototype progress to the same model.
5. Add mutation/start controls only after typed providers and approvals exist.

## Reviewer and tester handoff

Reviewer should verify:

- executor/model preferences are validated and snapshotted,
- session binding behavior is clear,
- roadmap UI is read-only first,
- no raw shell/`bd` execution is introduced,
- progress UI can support M118 without over-promising automation.

Tester should require:

- source checks and `git diff --check`,
- `npm run check-types`,
- focused validation/read-model/component tests,
- Storybook build for roadmap UI,
- Playwright only if browser-visible product routes/surfaces are changed.
