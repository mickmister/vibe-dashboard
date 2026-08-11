# Test Plan 3: Workflow builder, global workflow library, generic runtime, and extension registry

Branch: `vk/8b79-vd-workflows`

Planning bead: `vibe-kanban-vscode-web-qx3` — Confirm M90 roadmap implementation details

Related decision beads:

- `vibe-kanban-vscode-web-2ph` — Workspace Workflows tab UX direction
- `vibe-kanban-vscode-web-au8` — Final FSM workflow editor direction
- `vibe-kanban-vscode-web-29r` — Workflow builder next milestones
- `vibe-kanban-vscode-web-pdx` — M90 workflow roadmap open decisions
- `vibe-kanban-vscode-web-vq3` — Engine workflow roadmap details
- `vibe-kanban-vscode-web-qx3` — Confirm M90 roadmap implementation details

Earlier branch acceptance plans:

- [`./test-plan-1.md`](./test-plan-1.md) — Durable workflow UI and webhook-driven qa-mode execution
- [`./test-plan-2.md`](./test-plan-2.md) — Workflow engine, presentation, human attention, and qa-mode acceptance roadmap

Related onboarding docs:

- [`../../onboarding/feature-work-process.md`](../../onboarding/feature-work-process.md)
- [`../../onboarding/implementer-testing-process.md`](../../onboarding/implementer-testing-process.md)
- [`../../onboarding/independent-tester-prompt.md`](../../onboarding/independent-tester-prompt.md)
- [`../../onboarding/playwright-manual-to-e2e.md`](../../onboarding/playwright-manual-to-e2e.md)
- [`../../onboarding/vk-mocked-sandbox.md`](../../onboarding/vk-mocked-sandbox.md)

## Purpose

M82-M89 proved the first durable workflow foundation: generic workflow-core
semantics, the existing VD durable bridge, refs-oriented VK/VD read models,
backend attention items, a clean run presentation page, design-only future calls,
and Docker qa-mode E2E acceptance.

This plan defines the next product sequence. The goal is to turn workflows from a
debug-heavy Agent Teams surface into a workspace-discoverable, reusable workflow
builder and runner:

- Workflows are global reusable designs/templates.
- Workflow runs are workspace-specific.
- Sessions are chosen or created when a run is launched.
- Prompts and skills are centralized reusable assets, not giant hardcoded strings
  inside workflow configs.
- The Workflows tab becomes the normal product entry point.
- The graph editor is finite-state-machine-looking, using React Flow/xyflow while
  preserving our workflow domain JSON as the canonical model.
- Dev / Review / Tester becomes a real, generic, duplicatable, editable workflow
  config, not another special bridge.
- Small workflows, such as “create a form from an agent,” are first-class too.
- Human turns integrate with beads-form through a narrow typed provider seam.
- Workflow calls and batch/capacity stay hidden until executable.

## Locked product decisions

These decisions come from the listed planning beads and should be treated as the
source of truth for M90+ implementation unless a later bead explicitly changes
them.

1. **Workflows are global. Runs are workspace-specific.**
   A workflow design/template is reusable. A run belongs to one workspace/craft.
2. **Sessions are run-scoped.**
   Workflow designs define roles such as Dev, Reviewer, and Tester. Launch binds
   those roles to existing sessions or newly-created/reused sessions.
3. **The Agent Teams page is diagnostics/manual URL.**
   Do not keep piling product UX onto the current debug-heavy page.
4. **The Workflows tab is default visible.**
   It is the workspace-scoped product home for available workflows, recent runs,
   and items needing input.
5. **Unsupported backend features are hidden.**
   Do not show workflow-call controls, unsupported step types, or fake draft-only
   affordances in the normal product UI.
6. **React Flow/xyflow is the graph layer.**
   The canonical workflow model remains our domain JSON; XState/Stately is design
   inspiration only.
7. **Graph model:** states/stages are nodes; actions/decisions are edges.
   Graph editing may edit transitions/actions, but only with validation.
8. **Workflow versioning:** mutable drafts and immutable published versions.
   Runs use published versions and snapshot the exact resolved workflow/prompt
   content needed for reproducibility.
9. **Storage model:** runtime/product workflow designs and prompt assets are DB
   records. Checked-in built-in templates may exist as source/catalog templates,
   but they are not automatically seeded into the DB as real workflow designs.
   They become real DB designs/versions only when a user uses, duplicates, or
   publishes them. This keeps built-ins easy to iterate while making user-visible
   workflows and runs DB-backed.
10. **Prompt refs and skill refs are centralized markdown/instruction assets.**
    Skill refs are not executable tool/plugin calls in this plan.
11. **Extension providers are executable handlers.**
    They are separate from markdown skill refs. M92 implements a narrow typed
    in-process registry for step and artifact providers and designs future
    notification/prompt provider seams.
12. **Beads-form is first-party but plugin-style.**
    It remains a first-party VD module/package for now, but implements the same
    typed provider interface future plugin extensions would use.
13. **Workflow runtime owns state/resume.**
    Beads-form owns form artifact/render/submission payload behavior; workflow
    owns attention items, waiting state, idempotency, stale submission checks, and
    resume semantics.
14. **Discord is notification-only.**
    Discord may link users to durable VD/beads-form attention items. It does not
    own workflow state.
15. **Run-level ad hoc remarks are supported.**
    Launch may include one “Additional instructions for this run” field. It is
    appended/composed into the resolved prompt set for this run, preserved on the
    run snapshot, and never mutates workflow designs or prompt assets. A workflow
    step/state may combine multiple saved prompt refs plus this extra run prompt.
16. **Dev self-review is required in the 3-agent workflow.**
    It is a second step inside the Dev state, not a separate graph node.
17. **JSON is diagnostics/view-only.**
    The normal builder is wizard/graph/side-panel based. Raw JSON is not editable
    in the default editor.
18. **Workflow-related functionality should move toward a plugin-module folder.**
    New or touched workflow product/runtime code should be organized toward
    `src/modules/plugins/workflows` rather than further scattering workflow code.
    Existing files can be migrated incrementally and safely as milestones touch
    them.

## Current declarative definitions vs the new workflow design store

The current branch already has internal machinery for the earlier durable
workflow path: code can load/register definitions, merge built-in fallbacks, and
store runtime/orchestration state for the existing debug and two-agent paths.
That machinery is an implementation ancestor, not the final product library.

The new product concept is a workflow design store with explicit design
lifecycle semantics:

- DB-backed workflow designs.
- Mutable drafts.
- Immutable published versions.
- DB-backed prompt/skill assets.
- Built-in template catalog entries that are not real DB designs until used.
- Duplicate/copy operations that copy design, prompts, roles, and graph shape but
  never sessions or run history.
- Launch-time session binding.
- Run snapshots that pin resolved workflow and prompt content.

Implementation may reuse safe internal code from the existing declarative
storage path, but the Workflows tab, editor, and runtime APIs should speak in
product terms: designs, drafts, published versions, prompts, roles, runs,
attention items, and session bindings.

## Target module organization

Workflow code is currently spread across server routes, stores, components,
runtime files, packages, and modules. M90+ should move toward a coherent module
boundary without forcing a risky big-bang refactor.

Target product module path:

```text
src/modules/plugins/workflows/
```

Recommended gradual organization:

- `src/modules/plugins/workflows/WorkflowPluginModule.ts` — top-level Springboard
  module / registration boundary.
- `src/modules/plugins/workflows/server/` — workflow design store, launch APIs,
  read models, extension registry adapters, and runtime integration facades.
- `src/modules/plugins/workflows/client/` — client APIs/hooks for Workflows tab,
  launch flow, graph editor, and run summaries.
- `src/modules/plugins/workflows/components/` — Workflows tab, launch modal,
  graph viewer/editor, attention widgets.
- `src/modules/plugins/workflows/extensions/` — first-party provider adapters
  such as beads-form human input.
- `src/modules/plugins/workflows/templates/` — checked-in template catalog data
  or loaders for built-in workflow templates, if a file-backed catalog is used.

Refactor rule:

- New M90+ workflow features should be added in or routed through this module
  when practical.
- Existing working workflow runtime/store files should be migrated only when a
  milestone touches them and includes focused regression tests.
- Avoid broad path-only moves that obscure product/runtime changes.

## User stories

### USER_STORY_9 — User opens a workspace Workflows tab

As a user in a VD workspace/craft, I want a default-visible Workflows tab so I
can find available workflows, recent runs, and any items needing my input without
manually navigating to a debug URL.

Success means:

- The tab is discoverable from the workspace/craft UI by default.
- It shows available global workflow designs/templates relevant to the workspace.
- It shows recent runs scoped to the current workspace.
- It shows active human attention items scoped to the current workspace.
- It links to the clean run presentation page for details.
- It hides webhook, HMAC, queue, trigger, delivery, raw IDs, raw JSON, raw XML,
  `runReady`, and other debug/transport terms by default.
- Agent Teams remains available only as diagnostics/manual URL, not as the normal
  product path.

Primary milestone: M94.

### USER_STORY_10 — Workflow author uses a global workflow library

As a workflow author, I want reusable workflow designs to be global and
versioned so I can create, duplicate, publish, and run workflows across many
workspaces without copying run/session-specific state.

Success means:

- Workflow designs live as DB-backed product records once used or created.
- Drafts are mutable.
- Published versions are immutable.
- Editing a published design creates or updates a draft, not the published
  version.
- Runs reference a published version and snapshot resolved content.
- Duplicating a workflow copies design data only, not sessions, runs, attention
  items, or debug refs.
- Checked-in built-in templates can appear in the catalog and be iterated by
  developers without being automatically seeded into the DB as real user-visible
  workflow designs.

Primary milestone: M91.

### USER_STORY_11 — Workflow author reuses prompt and skill assets

As a workflow author, I want workflows to reference centralized prompt and skill
assets so prompt improvements and shared instructions can be reused safely across
workflow designs without hardcoding large prompt strings into every step.

Success means:

- Prompt assets are DB-backed once created or used.
- Skill refs are centralized markdown/instruction snippets, not executable tools.
- Workflow steps can reference one or more saved prompt/skill assets.
- Prompt composition is deterministic and testable.
- Missing prompt/skill refs block publish/run with specific validation errors.
- Runs snapshot the resolved prompt/skill content or exact versions used.
- Launch can include one run-level additional-instructions remark that is
  appended/composed into the saved prompt sequence without mutating assets.

Primary milestone: M91.

### USER_STORY_12 — Platform provides a narrow workflow extension registry

As a platform developer, I want workflow capabilities such as human form steps
and artifacts to register through a typed in-process extension registry so
first-party modules and future plugins can participate without hardcoded
runtime branches or broad plugin-platform scope creep.

Success means:

- M92 implements step-type provider and artifact-provider registries.
- M92 designs but does not fully implement notification adapters, prompt
  providers, external/marketplace plugin packaging, or plugin permissioning.
- Unknown provider types are rejected with stable validation errors.
- Extensions cannot directly mutate workflow state.
- Resume/idempotency/stale checks remain owned by the workflow runtime.
- Skill refs remain markdown snippets and are not confused with executable
  providers.

Primary milestone: M92.

### USER_STORY_13 — Generic runtime executes persisted workflow designs

As a workflow author, I want published workflow designs to execute through the
same generic durable runtime so the builder creates real workflows rather than
another hardcoded demo path.

Success means:

- The runtime loads a DB-backed published workflow design/version.
- The run belongs to a workspace.
- Role-to-session bindings are supplied at run creation.
- Agent turns queue through VK using existing refs-oriented integration.
- Decision XML validation, retries, blocked state, loops, same-state visits, and
  duplicate wakeups work for arbitrary supported V1 configs.
- No hardcoded two-agent state IDs are required.
- `workflow_call` remains hidden/unsupported until M99.
- Human form steps remain hidden/unsupported until M96 unless M93 explicitly
  implements the needed execution support earlier.

Primary milestone: M93.

### USER_STORY_14 — User launches a workflow with run-scoped session binding

As a user, I want to run a workflow in the current workspace and bind each role
to an existing or newly-created/reused session at launch so global workflow
designs stay reusable.

Success means:

- Launch asks for workflow inputs and one run-level additional-instructions
  remark.
- Launch asks for role bindings for each role required by the workflow.
- The user can select existing sessions.
- The user can create/reuse sessions by role/name.
- Session bindings are stored on the run/snapshot, not in the workflow design.
- Optional remembered workspace defaults are deferred.
- The new run appears in the workspace Workflows tab and links to the clean run
  page.

Primary milestone: M95.

### USER_STORY_15 — User understands workflows as FSM graphs

As a workflow author, I want workflows shown as states and action edges so I can
understand and edit loops such as Dev → Review → Tester → Dev without reading
raw JSON.

Success means:

- React Flow/xyflow renders states/stages as nodes.
- Actions/decisions render as labeled edges.
- Steps are summarized/details in node side panels rather than every step being a
  graph node.
- The graph can edit transitions/actions with validation.
- Invalid graph edits cannot publish or run.
- Raw JSON is diagnostics/view-only only.
- Unsupported workflow-call controls are not shown.

Primary milestone: M97.

### USER_STORY_16 — User creates, duplicates, edits, and runs Dev / Review / Tester

As a user, I want a Dev / Review / Tester workflow config that I can duplicate,
edit, and run so feature work can be implemented, self-reviewed, reviewed,
tested, looped back for fixes, and completed through real workflow execution.

Success means:

- Dev / Review / Tester is an available workflow config/template.
- When used, it becomes a DB-backed workflow design/version.
- It is duplicatable and editable.
- It runs through the generic runtime, not a fixed 3-agent bridge.
- The graph has Dev, Review, Tester, and Done states.
- Dev state includes two required steps: implementation and self-review.
- Review can approve to Tester or request changes back to Dev.
- Tester can approve to Done or return failures/not-testable/bugs to Dev.
- Launch binds Dev, Reviewer, and Tester sessions at run time.
- The clean run page shows all three roles and loop visits without debug terms.

Primary milestone: M98.

### USER_STORY_17 — User can run small workflow templates

As a user, I want small reusable workflow templates too, such as asking an agent
to create a form, so workflows are useful for focused automations and not only
large multi-agent pipelines.

Success means:

- “Create form from agent” is available by M98.
- It uses prompt/skill refs and the artifact/provider model rather than hardcoded
  prompt text.
- It produces a form schema/artifact/ref according to what beads-form supports at
  that time.
- Aggregate-forms workflows remain deferred because that beads-form capability is
  still WIP.

Primary milestone: M98.

### USER_STORY_18 — Human form turns pause and resume workflows

As a workflow author, I want workflows to ask a person for structured form input
so the workflow can pause, show “Needs your input,” and resume idempotently after
submission.

Success means:

- Human form turns are executable and authorable in the same milestone.
- Beads-form implements the plugin-style typed provider interface.
- Runtime creates a durable attention item and waits.
- Workflows tab shows the item in “Needs your input.”
- The clean run page shows the waiting human step and submitted answer summary.
- Beads-form submission completes the workflow attention item through workflow
  APIs and the workflow runtime resumes exactly once.
- Duplicate and stale submissions are rejected or no-op according to stable
  semantics.
- Discord remains notification-only.

Primary milestone: M96.

### USER_STORY_19 — Workflows can call workflows once executable

As a workflow author, I want workflows to start child workflows and optionally
wait for them so larger processes can be composed from smaller workflow designs
without exposing unsupported controls early.

Success means:

- Workflow calls remain hidden until M99 implements executable semantics.
- Blocking child calls are implemented first.
- Parent/child run refs are durable.
- Parent waits and resumes with child status/output refs.
- Later fire-and-forget and terminal/handoff calls can build on the same model.

Primary milestone: M99.

### USER_STORY_20 — Batch queue and capacity manage many workflow runs

As a workflow user, I want to run workflows for many items while the scheduler
limits active work so agent turns do not overwhelm a workspace or step on each
other.

Success means:

- Batch/capacity is split from workflow calls.
- Batch enqueue creates durable pending runs.
- Scheduler respects global active-turn and workspace write-turn capacity.
- UI shows pending/running/complete/failed counts and per-item errors.
- Batch controls stay hidden until executable.

Primary milestone: M100.

## Milestone roadmap

### M90 — Roadmap/test-plan and architecture decisions

Scope: documentation/planning only.

Deliverables:

- This `test-plan-3.md` document.
- User stories and acceptance matrix for M90-M100.
- Architecture decisions for workflow library, prompts/skills, extension
  registry, generic runtime, Workflows tab, launch/session binding, React Flow
  graph, human turns, workflow calls, and batch/capacity.
- Explicit mapping from planning beads to decisions.
- Explicit “unsupported UI hidden” policy.
- Target module organization toward `src/modules/plugins/workflows`.

Out of scope:

- Product code.
- DB migrations.
- Runtime implementation.
- UI implementation.

### M91 — Workflow design store + prompt/skill library

Scope: product-level library foundation.

Deliverables:

- DB-backed workflow design records.
- Mutable workflow drafts.
- Immutable published workflow versions.
- DB-backed prompt assets.
- DB-backed skill assets as markdown/instruction snippets.
- Optional checked-in built-in template catalog that is not automatically seeded
  into the DB.
- “Use template” / “duplicate template” service semantics that create real DB
  workflow designs only when the user chooses to use a template.
- Publish validation.
- Run snapshot model that pins published workflow and resolved prompt/skill
  content.
- Duplicate operation that copies design and prompt refs but not sessions/runs.

Out of scope:

- Full Workflows tab UI.
- React Flow graph editing.
- Workflow calls.
- Full plugin packaging.

### M92 — Narrow extension registry foundation

Scope: typed in-process extension primitives.

Deliverables:

- Step provider registry.
- Artifact provider registry.
- Validation path for unknown/unsupported step/artifact providers.
- Interfaces for future notification adapters and prompt/skill providers in docs
  or type stubs if useful.
- Beads-form-compatible provider contract shape.
- Tests proving extensions cannot directly mutate workflow state.

Out of scope:

- Marketplace/external plugin packaging.
- Plugin permission system.
- Discord implementation.
- Executable workflow calls.

### M93 — Generic workflow-core runtime for persisted workflow configs

Scope: durable execution of DB-backed published workflow designs.

Deliverables:

- Launch/run service shape that accepts workspace, published workflow version,
  run inputs, run-level additional instructions, and role/session bindings.
- Runtime loads persisted published workflow designs, not hardcoded state IDs.
- Prompt/skill ref resolution and run snapshot persistence.
- Agent-turn execution through VK refs.
- Decision XML validation and retry/blocked behavior.
- Loops and same-state visits.
- Duplicate wakeup/idempotence behavior.
- Generic history/events sufficient for presentation read models.

Out of scope:

- Human form execution unless deliberately pulled forward.
- Workflow calls.
- Batch queue.
- Full graph editor.

### M94 — Workspace Workflows tab shell + workspace run read model

Scope: discoverability and workspace-scoped dashboard.

Deliverables:

- Default-visible Workflows tab in workspace/craft UI.
- Workspace Workflows home read model:
  - available global workflows/templates
  - recent runs in this workspace
  - active attention items in this workspace
- Product empty states.
- Links to clean run presentation pages.
- No debug/transport/raw internals in default UI.
- Agent Teams remains diagnostics/manual URL.

Out of scope:

- Full graph editor.
- Unsupported workflow-call controls.
- Batch queue controls.

### M95 — Clean launch flow with run-time session binding

Scope: run a supported workflow from the Workflows tab.

Deliverables:

- Run workflow modal/drawer.
- Required workflow input validation.
- Single run-level “Additional instructions for this run” field.
- Role/session binding UI:
  - choose existing session
  - create/reuse session by role/name
- Launch creates workspace-specific run.
- Launch never mutates global workflow design.
- Run appears in recent runs and links to clean run page.

Out of scope:

- Remembered workspace launch defaults.
- Per-role ad hoc remarks.
- Unsupported step types.

### M96 — Beads-form human turn extension + authoring

Scope: human form steps are executable and authorable.

Deliverables:

- `human_form` or equivalent executable step provider through the extension
  registry.
- Beads-form first-party module/package implements plugin-style provider
  interfaces.
- Workflow runtime owns attention item, waiting state, idempotence, stale checks,
  and resume.
- Beads-form owns form artifact/render/submission payload behavior.
- Authoring UI for human form steps in the builder/wizard surfaces only supported
  provider behavior.
- Workflows tab attention section shows active items.
- Clean run page shows waiting/submitted human form state.

Out of scope:

- Discord beyond optional notification seam design.
- Full marketplace plugin packaging.
- Workflow calls.

### M97 — React Flow graph viewer/editor foundation

Scope: finite-state-machine graph UI for supported workflow configs.

Deliverables:

- React Flow/xyflow dependency and component foundation.
- Domain workflow JSON → graph transform.
- States/stages as nodes.
- Actions/decisions as labeled edges.
- Node detail side panel for steps, prompt refs, human form steps, and role owner.
- Validated editing for transitions/actions.
- Diagnostics/view-only JSON only.
- Unsupported step/control palette entries hidden.

Out of scope:

- Full freeform visual programming canvas.
- Workflow calls.
- Batch/capacity UI.

### M98 — Dev / Review / Tester and create-form-from-agent templates

Scope: real flagship and small workflow configs.

Deliverables:

- Dev / Review / Tester available template/config.
- Create-form-from-agent available template/config.
- Templates become real DB workflow designs/versions when used/duplicated.
- Dev / Review / Tester is duplicatable, editable, and runnable through the
  generic runtime.
- Dev state includes implementation step and required self-review step.
- Review/tester loops are editable with validation.
- Create-form-from-agent produces the supported form schema/artifact/ref.
- Docker qa-mode E2E coverage for 3-agent happy path and representative loops.

Out of scope:

- Aggregate-forms workflow until beads-form capability ships.
- Fixed 3-agent bridge.
- Workflow calls.

### M99 — Workflow-to-workflow calls

Scope: composition semantics, split from batch/capacity.

Deliverables:

- Executable blocking child workflow call first.
- Durable parent/child refs.
- Parent waits and resumes with child status/output refs.
- UI/editor exposes calls only once executable.
- Design notes or follow-up milestones for fire-and-forget and terminal/handoff
  calls if not completed here.

Out of scope:

- Batch queue/capacity.
- Unsupported call modes in UI.

### M100 — Batch queue and capacity

Scope: bulk run enqueueing and scheduling limits.

Deliverables:

- Batch enqueue API.
- Durable pending run queue.
- Global active-turn limit.
- Per-workspace write-turn capacity.
- Batch status UI with pending/running/complete/failed counts and per-item
  errors.
- Future read-only/worktree-lane constraints documented if not executable.

Out of scope:

- Workflow-call semantics not completed in M99.
- Full capacity tuning/admin console unless explicitly approved.

## Product test cases

### TEST_CASE_M90_1A — Roadmap captures final workflow-builder decisions

Milestone: M90

User story coverage: `USER_STORY_9` through `USER_STORY_20`

Steps:

1. Open this document.
2. Confirm it lists the planning beads `2ph`, `au8`, `29r`, `pdx`, `vq3`, and
   `qx3`.
3. Confirm it states:
   - workflows are global
   - runs are workspace-specific
   - sessions bind at launch
   - Agent Teams is diagnostics/manual URL
   - Workflows tab is default visible
   - unsupported UI is hidden
   - React Flow/xyflow is the graph layer
   - domain JSON remains canonical
   - workflow calls and batch are split
4. Confirm it includes a detailed user-story section and test cases for each
   milestone M90-M100.

Expected:

- Reviewers can use this document as the source of truth for the next milestone
  sequence.
- No product/runtime code changes are required for M90.

### TEST_CASE_M90_1B — Storage and module-organization decisions are explicit

Milestone: M90

User story coverage: `USER_STORY_10`, `USER_STORY_11`, `USER_STORY_12`

Steps:

1. Open the “Locked product decisions” and “Current declarative definitions vs
   the new workflow design store” sections.
2. Confirm the DB/source-of-truth model is clear:
   - real workflow designs and prompt assets are DB-backed once used/created
   - checked-in built-ins may be catalog templates
   - checked-in built-ins are not automatically seeded into DB as real workflow
     designs
   - built-ins become real DB designs only when used, duplicated, or published
3. Confirm target module organization points toward
   `src/modules/plugins/workflows` with incremental migration guidance.
4. Confirm skill refs are markdown snippets and extension providers are executable
   handlers.

Expected:

- Implementers do not have to re-ask what “current declarative storage” means.
- Implementers do not accidentally build a files-only runtime source of truth or
  auto-seed all built-ins as user-visible designs.

### TEST_CASE_M91_1A — Workflow design store supports drafts and published versions

Milestone: M91

User story coverage: `USER_STORY_10`

Steps:

1. Create a DB-backed workflow design.
2. Create or update its mutable draft.
3. Publish the draft.
4. Attempt to mutate the published version directly.
5. Edit the workflow again.
6. Inspect the design, draft, and published version records.

Product-level error cases:

- Publishing an invalid draft should fail with stable validation issues and leave
  the draft editable.
- Directly mutating an immutable published version should be rejected.
- Editing after publish should create/update a draft derived from the published
  version, not alter historical published data.

Expected:

- Drafts are mutable.
- Published versions are immutable.
- The latest published version is clearly identifiable for launch.
- Existing runs can continue referencing older published versions.

### TEST_CASE_M91_1B — Built-in templates become DB designs only when used

Milestone: M91

User story coverage: `USER_STORY_10`, `USER_STORY_16`, `USER_STORY_17`

Steps:

1. Load available built-in template catalog entries.
2. Confirm catalog entries are visible as templates but are not automatically
   inserted as real DB workflow design records merely by application startup.
3. Choose “Use template” or “Duplicate template” for one built-in entry.
4. Inspect the DB workflow design store.
5. Publish the resulting user/workflow design.

Product-level error cases:

- If the checked-in template is invalid, the catalog should show it as
  unavailable/invalid with a stable reason and should not create a DB design.
- If two users use the same built-in template, each user action should create the
  intended DB design/copy without sharing mutable draft state accidentally.
- If a built-in template changes in a later app build, existing DB copies and
  runs should remain reproducible.

Expected:

- Built-ins can be iterated in checked-in source without automatic DB churn.
- User-visible workflow designs are DB-backed after the user chooses to use them.
- DB copies do not include session bindings or run history.

### TEST_CASE_M91_2A — Prompt and skill refs resolve and snapshot

Milestone: M91

User story coverage: `USER_STORY_11`

Steps:

1. Create DB-backed prompt assets and skill assets.
2. Create a workflow draft that references those assets from a step.
3. Validate and publish the workflow.
4. Launch or simulate run creation.
5. Inspect the run snapshot.

Product-level error cases:

- Missing prompt ref should block publish/run with a stable validation error.
- Missing skill ref should block publish/run with a stable validation error.
- Circular prompt composition or unsupported interpolation should fail with a
  specific validation error.
- Oversized prompt assets should be rejected or marked/truncated according to the
  configured policy before presentation read models expose them.

Expected:

- Prompt refs and markdown skill refs resolve deterministically.
- The run snapshot records exact resolved content or exact asset versions.
- Later editing a prompt/skill asset does not silently alter prior runs.

### TEST_CASE_M91_2B — Duplicate copies design, not sessions

Milestone: M91

User story coverage: `USER_STORY_10`, `USER_STORY_14`

Steps:

1. Create or use a workflow design with roles and prompt/skill refs.
2. Launch a run with concrete session bindings.
3. Duplicate the workflow design.
4. Inspect the duplicate.

Expected:

- The duplicate copies workflow design metadata, roles, graph shape, and
  prompt/skill refs.
- The duplicate does not copy concrete session IDs, workspace run bindings,
  attention items, queue refs, execution refs, or run history.

### TEST_CASE_M92_1A — Extension registry validates step providers

Milestone: M92

User story coverage: `USER_STORY_12`

Steps:

1. Register a known step provider in the typed in-process registry.
2. Attempt to register a duplicate provider type.
3. Validate a workflow config that references the known provider.
4. Validate a workflow config that references an unknown provider.

Expected:

- Known provider registers successfully.
- Duplicate provider type is rejected.
- Unknown executable step provider is rejected with a stable validation error.
- Registry behavior is deterministic and testable without external marketplace
  plugin infrastructure.

### TEST_CASE_M92_1B — Artifact provider returns durable refs without owning workflow state

Milestone: M92

User story coverage: `USER_STORY_12`, `USER_STORY_17`, `USER_STORY_18`

Steps:

1. Register an artifact provider.
2. Ask the provider to create a test artifact through the registry/service layer.
3. Store or return the artifact ref.
4. Attempt to have the provider mutate workflow runtime state directly.

Product-level error cases:

- Unknown artifact provider should return a stable provider-not-found error.
- Artifact creation failure should surface a provider error with retryability
  metadata when available.
- Provider results should be refs/metadata, not unbounded raw payloads in default
  workflow state.

Expected:

- Artifact providers create or expose artifacts through durable refs.
- Workflow runtime remains the owner of workflow state transitions.

### TEST_CASE_M92_1C — Skill refs remain separate from executable providers

Milestone: M92

User story coverage: `USER_STORY_11`, `USER_STORY_12`

Steps:

1. Create a markdown skill asset.
2. Reference it from a prompt composition path.
3. Attempt to use a skill ref as an executable provider type.

Expected:

- Skill assets are rendered/concatenated as markdown instruction snippets.
- Skill refs do not invoke executable provider/plugin behavior.
- Executable steps require registered step providers.

### TEST_CASE_M93_1A — Generic persisted workflow runs through agent turns

Milestone: M93

User story coverage: `USER_STORY_13`

Steps:

1. Publish a DB-backed workflow version that uses only supported `agent_turn`
   steps.
2. Launch a workspace-specific run with role/session bindings.
3. Let the runtime queue the first agent turn through VK.
4. Observe the terminal VK execution event or polling result.
5. Let the generic runtime advance to the next step/state.
6. Continue until terminal completion.

Product-level error cases:

- Missing role binding should block launch with a product-level validation error.
- VK queue failure should leave the run retryable/failed with a specific reason.
- Duplicate wakeups should not duplicate queued turns or transitions.
- Runtime should not depend on hardcoded two-agent state IDs.

Expected:

- A DB-backed published workflow version runs through the generic runtime.
- Run state is workspace-specific and refs-oriented.
- Workflow design records remain free of concrete session IDs.

### TEST_CASE_M93_1B — Generic runtime handles XML retry, blocked, and loops

Milestone: M93

User story coverage: `USER_STORY_13`, `USER_STORY_16`

Steps:

1. Publish a workflow with a decision XML step and loop action.
2. Complete the decision turn with malformed XML.
3. Confirm the retry path asks for a corrected response.
4. Complete retry with valid XML choosing a same-state or prior-state action.
5. Repeat invalid XML until retry exhaustion in a separate case.
6. Inspect run history and state visits.

Expected:

- Invalid XML retries without transitioning.
- Retry exhaustion becomes blocked/needs attention according to stable semantics.
- Loops create new state visits rather than overwriting history.
- Same-state loops queue exactly one next turn and do not spin.

### TEST_CASE_M93_1C — Run snapshot preserves prompt composition and additional remark

Milestone: M93

User story coverage: `USER_STORY_11`, `USER_STORY_13`, `USER_STORY_14`

Steps:

1. Publish a workflow step that composes two saved prompt refs.
2. Launch a run with one run-level additional-instructions remark.
3. Inspect the planned queued prompt/prompt preview.
4. Inspect the run snapshot and presentation read model.

Product-level error cases:

- Additional instructions should not mutate prompt assets or workflow designs.
- Additional instructions should be bounded/truncated in presentation read models
  according to prompt-preview policy.
- Empty additional instructions should be omitted cleanly.

Expected:

- Saved prompt refs and the run-level remark compose in deterministic order.
- The run snapshot preserves what was used for reproducibility.

### TEST_CASE_M94_1A — Workflows tab is visible and non-debuggy

Milestone: M94

User story coverage: `USER_STORY_9`

Steps:

1. Open a workspace/craft in VD.
2. Locate the Workflows tab without manually typing a debug URL.
3. Open the tab.
4. Inspect the initial or seeded page state.

Expected:

- Workflows tab is visible by default.
- Page shows workspace context.
- Page shows available workflows/templates, recent runs, and needs-input section
  or calm empty states.
- Page does not show forbidden debug terms by default.

Forbidden default terms/examples:

- webhook
- HMAC
- queue item
- trigger
- delivery ID
- execution process ID
- `runReady`
- raw JSON
- raw XML
- `WorkflowStepState`

### TEST_CASE_M94_1B — Workflows tab data is workspace-scoped

Milestone: M94

User story coverage: `USER_STORY_9`, `USER_STORY_14`, `USER_STORY_18`

Steps:

1. Seed or create runs in two workspaces.
2. Open the Workflows tab in workspace A.
3. Open the Workflows tab in workspace B.
4. Seed or create attention items in one workspace.
5. Inspect available workflows, recent runs, and attention sections.

Expected:

- Available global workflows may appear in both workspaces.
- Recent runs are scoped to the selected workspace.
- Attention items are scoped to the selected workspace.
- Clean run links open the correct run pages.

### TEST_CASE_M95_1A — Launch validates inputs and binds existing sessions

Milestone: M95

User story coverage: `USER_STORY_14`

Steps:

1. Open Workflows tab.
2. Choose a supported runnable workflow.
3. Click Run.
4. Submit with missing required inputs.
5. Fill required inputs.
6. Enter a run-level additional-instructions remark.
7. Bind each role to an existing session.
8. Launch.

Expected:

- Missing inputs show inline product errors.
- Existing sessions can be selected for roles.
- Run starts in the current workspace.
- Role/session bindings are stored on the run, not the workflow design.
- The run appears in recent runs and links to clean run page.

### TEST_CASE_M95_1B — Launch creates or reuses sessions by role/name

Milestone: M95

User story coverage: `USER_STORY_14`

Steps:

1. Open launch modal for a supported workflow.
2. For one or more roles, choose create/reuse session by role/name.
3. Launch the workflow.
4. Inspect sessions and run bindings.

Product-level error cases:

- Session creation failure should show a role-specific error and keep launch
  inputs intact.
- Reusing an incompatible/unavailable session should be blocked with a specific
  reason.
- Workspace mismatch should be rejected before launch.

Expected:

- Missing sessions can be created or reused at launch.
- Concrete sessions remain run/workspace concerns.
- Workflow design remains global and session-free.

### TEST_CASE_M96_1A — Authorable human form turn creates attention item

Milestone: M96

User story coverage: `USER_STORY_18`

Steps:

1. Create or edit a workflow using the supported human form step provider.
2. Configure title, description, form ref/schema, required fields, and target
   responder semantics supported by M96.
3. Publish and launch the workflow.
4. Let runtime reach the human form step.
5. Open Workflows tab and clean run page.

Expected:

- Human form step is authorable only because it is executable.
- Runtime creates a durable attention item.
- Workflows tab shows “Needs your input.”
- Clean run page shows the workflow waiting for human input.
- No Discord implementation is required.

### TEST_CASE_M96_1B — Beads-form submission resumes exactly once

Milestone: M96

User story coverage: `USER_STORY_18`

Steps:

1. Start a run waiting on a beads-form-backed human form step.
2. Submit valid form data.
3. Submit the same form again.
4. Attempt a stale submission from an older state visit.
5. Inspect workflow run state, attention item state, and timeline.

Product-level error cases:

- Missing required fields should block resume with field-level errors.
- Duplicate submission should be no-op or return stable attention-not-active.
- Stale state visit should be rejected.
- Provider failure should not advance the workflow state.

Expected:

- Valid submission completes the attention item and resumes workflow once.
- Submitted data is available to later prompt composition/transitions.
- Attention clears from the Workflows tab.
- Clean run page shows a safe answer summary.

### TEST_CASE_M97_1A — React Flow graph renders states, actions, and loops

Milestone: M97

User story coverage: `USER_STORY_15`, `USER_STORY_16`

Steps:

1. Open a supported workflow in the builder/graph view.
2. Inspect graph nodes and edges.
3. Select nodes and edges.
4. Inspect side-panel details.

Expected:

- States/stages render as nodes.
- Actions/decisions render as labeled edges.
- Loops render clearly.
- Node detail panel shows owner role, step summaries, prompt refs, and human form
  summaries where supported.
- Workflow calls are not visible before M99.
- Raw JSON is not editable in the normal editor.

### TEST_CASE_M97_1B — Graph transition/action editing validates before save/run

Milestone: M97

User story coverage: `USER_STORY_15`

Steps:

1. Duplicate or edit a supported workflow design.
2. Change an action label or target through graph/side-panel UI.
3. Save/publish the valid edit.
4. Attempt invalid graph changes:
   - action target missing
   - unreachable required state
   - no terminal path
   - decision without actions
   - unsupported step type
5. Try to publish or run.

Expected:

- Valid edits update canonical domain JSON through the product model.
- Invalid edits show product-level validation errors.
- Invalid workflow cannot publish or run.
- Unsupported UI controls remain hidden.

### TEST_CASE_M98_1A — Dev / Review / Tester template is available, duplicatable, editable

Milestone: M98

User story coverage: `USER_STORY_16`

Steps:

1. Open Workflows tab.
2. Locate Dev / Review / Tester template/config.
3. Use or duplicate it into a DB-backed workflow design.
4. Open it in graph/editor.
5. Edit name, description, roles, prompt refs, and supported transitions/actions.
6. Publish.

Expected:

- Template appears as available workflow config/template.
- Using/duplicating creates a real DB-backed design/version.
- Sessions are not copied into the design.
- Dev node contains required implementation and self-review steps.
- Review and Tester loop actions can be inspected and edited with validation.

### TEST_CASE_M98_1B — Dev / Review / Tester runs through qa-mode with loops

Milestone: M98

User story coverage: `USER_STORY_16`

Steps:

1. Launch Dev / Review / Tester from Workflows tab.
2. Bind Dev, Reviewer, and Tester sessions at launch.
3. Run a qa-mode happy path:
   - Dev implements
   - Dev self-reviews
   - Review approves
   - Tester approves
   - workflow completes
4. Run representative loop paths:
   - Review requests changes → Dev
   - Tester finds bug/not testable → Dev
5. Open clean run page.

Expected:

- Workflow runs through generic runtime.
- No fixed 3-agent bridge is required.
- Loop visits are visible and understandable.
- Clean run page shows Dev, Reviewer, Tester, and Done states without debug
  terms.
- Docker qa-mode E2E records video/trace artifacts for final accepted paths.

### TEST_CASE_M98_2A — Create-form-from-agent workflow produces form artifact/ref

Milestone: M98

User story coverage: `USER_STORY_17`

Steps:

1. Open Workflows tab.
2. Locate Create form from agent template/config.
3. Use or duplicate it into a DB-backed design.
4. Launch it with a form request/task.
5. Let the agent complete under qa-mode.
6. Inspect the output artifact/ref and clean run page.

Product-level error cases:

- If beads-form cannot create the requested artifact, workflow should show a
  provider/artifact error and not present a fake form.
- If qa-mode output is invalid form schema, workflow should show validation
  errors or a reviewable failure state.
- Aggregate-forms controls should not be shown before that beads-form capability
  ships.

Expected:

- Small workflow template is available alongside bigger workflows.
- Workflow output is a supported form schema/artifact/ref.
- Clean run page links or summarizes the artifact without raw debug details.

### TEST_CASE_M99_1A — Blocking workflow call waits for child and resumes parent

Milestone: M99

User story coverage: `USER_STORY_19`

Steps:

1. Create or use two published workflow designs: parent and child.
2. Add a supported blocking workflow-call step to the parent.
3. Launch the parent.
4. Let parent reach the call step.
5. Let child run complete.
6. Inspect parent state after child completion.

Product-level error cases:

- Missing child workflow should block validation/publish.
- Child failure/cancel/block should follow the configured parent policy and be
  visible in product language.
- Duplicate child completion events should not resume parent twice.

Expected:

- Parent creates durable child run ref and waits.
- Parent resumes with child status/output refs when child completes.
- Calls are visible in UI only because executable support exists.

### TEST_CASE_M100_1A — Batch enqueue creates pending runs and respects capacity

Milestone: M100

User story coverage: `USER_STORY_20`

Steps:

1. Open batch run UI/API for a supported workflow.
2. Submit multiple valid items and at least one invalid item.
3. Inspect created pending runs.
4. Let scheduler process under configured global/workspace capacity.
5. Inspect batch status.

Product-level error cases:

- Invalid per-item input should be reported without discarding all valid items
  unless policy explicitly says all-or-nothing.
- Scheduler should not start more active turns than configured limits allow.
- Workspace write-turn capacity should prevent unsafe simultaneous write turns.
- Batch cancellation/retry should be idempotent.

Expected:

- Batch queue creates durable pending runs.
- Capacity limits are respected.
- UI shows pending/running/complete/failed counts and per-item errors.

## Browser and E2E expectations

Browser-visible milestones must follow the onboarding browser workflow and, when
behavior should remain covered, convert passing manual flows into committed
Playwright tests.

Required browser/E2E coverage by milestone:

- **M94:** Workflows tab visible by default, empty/data states render, forbidden
  debug terms absent.
- **M95:** Launch workflow from Workflows tab with existing-session binding and
  create/reuse session binding.
- **M96:** Human form attention appears; form submission resumes workflow.
- **M97:** Graph renders states/actions/loops and validation blocks invalid save.
- **M98:** Dev / Review / Tester happy path and representative loop path under
  Docker qa-mode; Create-form-from-agent artifact path if backend support exists.
- **M99:** Workflow-call parent/child path once executable.
- **M100:** Batch enqueue/capacity path once executable.

Use focused E2E while implementing. Full Docker qa-mode E2E should be run for
milestones that claim end-to-end browser/runtime acceptance, and independent
tester passes should capture logs, video, trace, and JSON results keyed by the
`TEST_CASE_*` IDs above.

## Implementer validation expectations

For each milestone, implementer should record a JSON result comment on the
implementation bead. Example:

```json
{
  "TEST_CASE_M91_1A": { "status": "PASS" },
  "TEST_CASE_M91_1B": { "status": "PASS" },
  "TEST_CASE_M91_2A": { "status": "PASS" },
  "TEST_CASE_M91_2B": { "status": "PASS" }
}
```

Minimum command categories by milestone:

- M90: docs inspection and `git diff --check`.
- M91-M93: focused server/store/runtime tests, workflow-core tests where touched,
  type checks, `git diff --check`.
- M94-M98: focused server/component tests, relevant Playwright/Docker E2E for
  browser-visible flows, type checks, `git diff --check`.
- M99-M100: focused runtime/store/scheduler tests plus E2E only once UI/product
  paths are exposed.

## Independent tester expectations

After implementation review approval for each milestone, an independent tester
should use [`../../onboarding/independent-tester-prompt.md`](../../onboarding/independent-tester-prompt.md),
create a fresh tester bead, and run the approved test cases literally.

Tester results must include:

- JSON keyed by test-case IDs.
- Exact commands and URLs.
- Artifact paths for logs/screenshots/videos/traces.
- Explicit notes for any skipped Docker/browser E2E and why the skip is in scope.
- Confirmation that no unsupported controls/debug terms appear in default UI when
  the milestone includes browser-visible surfaces.

## Open follow-up decisions

These are not blockers for M90, but later milestones should resolve them before
implementation if they become relevant:

- Whether publishing a draft automatically makes it the default active runnable
  version or requires explicit activation. Current recommendation: publish makes
  it default active unless the user chooses otherwise.
- Whether workspace-level launch defaults should be added after M95. Current
  decision: defer.
- Exact create-form-from-agent artifact output once beads-form provider support
  is known: saved form artifact if available; otherwise schema JSON plus a
  reviewable artifact/ref.
- Whether M96 needs to split into M96A/M96B if human execution plus authoring is
  too large.
- Whether M99 should include fire-and-forget calls or only blocking calls.
