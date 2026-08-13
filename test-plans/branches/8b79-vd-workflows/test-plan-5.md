# Test Plan 5: M113 workflow UX completeness audit and centralized workflow page plan

Branch: `vk/8b79-vd-workflows`

Feature bead: `vibe-kanban-vscode-web-4o0u` — M113 Workflow UX completeness audit and centralized workflow page plan

Related beads:

- `vibe-kanban-vscode-web-lnac` — M112 Storybook workflow visualization and graph visual QA, completed.
- `vibe-kanban-vscode-web-411l` — M112 follow-up: improve workflow Storybook walkthrough video capture, completed.
- `vibe-kanban-vscode-web-k76t` — Storybook story pane should be scrollable, completed.
- `vibe-kanban-vscode-web-5fx9` — Improve workflow graph layout and transition visibility.
- `vibe-kanban-vscode-web-8aba` — Workflow editor right pane wizard navigation.
- `vibe-kanban-vscode-web-w6qf` — M114 Command-step safety design for workflow automation.
- `vibe-kanban-vscode-web-cfss` — M115 Sub-workspace lane design for isolated workflow milestones.
- `vibe-kanban-vscode-web-tqhk` — M116 Sub-workspace lane foundation.
- `vibe-kanban-vscode-web-vhx5` — M117 Safe workflow command-step provider.
- `vibe-kanban-vscode-web-z1on` — M118 Bead-driven meta-workflow sequential pause/resume prototype.
- `vibe-kanban-vscode-web-7mmi` — M119 Branch push UX revisit.
- `vibe-kanban-vscode-web-cahw` — M120 Scheduled workflow and command jobs design.

Earlier plans:

- [`./test-plan-3.md`](./test-plan-3.md) — M90-M100 workflow builder, generic runtime, templates, workflow calls, and batch/capacity.
- [`./test-plan-4.md`](./test-plan-4.md) — M101-M111 workflow UX, monitoring, craft surfaces, provenance, and CI wait.

## Purpose

M90-M111 made workflows real: users can create, edit, publish, run, monitor,
batch, use human forms, call child workflows, wait for CI, and view workflow UI
inside first-party craft surfaces. M112 then made the major workflow views
Storybook-friendly enough for visual QA.

M113 is intentionally **docs/planning only**. Its job is to audit what still
feels incomplete from a product UX perspective and turn that into a reviewable,
sequential follow-up plan before implementing a centralized workflow page or
new automation primitives.

The product question for this phase is:

> Can a user find the workflow system, understand the difference between
> templates/designs/runs/batches/attention, create or modify a workflow without
> raw JSON, run it with confidence, and monitor what happened from one clear
> product surface?

## M113 recommendations at a glance

1. Build a **centralized product workflow page** before adding more automation
   primitives. Keep direct `/dashboard/workflows/*` routes as deep links and
   diagnostics-compatible views, but make the product entry point a single
   workspace-aware page that can answer: available workflows, drafts, active
   runs, waiting input, recent batches, and latest completed runs.
2. Treat the existing Workflows tab as the first-party craft surface entry, but
   simplify it into a product dashboard rather than a collection of route cards.
3. Split workflow creation into two cooperating modes:
   - **wizard navigation** for roles, states, steps, and actions,
   - **graph canvas** for visual relationships and advanced edge/state edits.
4. Prioritize graph readability and layout before expanding graph editing. Users
   must always be able to read state names and transition/action labels.
5. Continue using Storybook as the visual comparison tool for workflow UI; add
   stories before or alongside each product-visible follow-up.
6. Keep diagnostics available but collapsed. Normal workflow UX must not expose
   webhook, queue, raw XML, raw response refs, internal run IDs, or transport
   terms by default.
7. Defer new runtime primitives until their safety/product design is clear:
   command steps, sub-workspace lanes, branch push, scheduled jobs.

## Definitions and IA decisions

| Object                     | Meaning                                                   | Scope                                | Normal product location                            |
| -------------------------- | --------------------------------------------------------- | ------------------------------------ | -------------------------------------------------- |
| Starter template           | Checked-in catalog template that can be copied/customized | Global                               | Centralized page and Workflows tab starter section |
| Workflow design draft      | Mutable DB design/draft a user can edit                   | Global                               | Your workflows / draft cards / editor              |
| Published workflow version | Immutable runnable version of a design                    | Global                               | Run modal, workflow details, provenance            |
| Workflow run               | Workspace-specific execution of a published version       | Workspace                            | Active/recent runs and run details                 |
| Attention item             | Human input needed to resume a run                        | Workspace                            | Needs input feed and run details                   |
| Batch                      | Queue of run launch requests                              | Workspace                            | Recent batches and batch detail                    |
| Diagnostics                | Raw details for debugging                                 | Global/workspace depending on object | Collapsed advanced sections or old routes          |

## Centralized workflow page plan

### Recommended route/surface shape

The centralized page should be a product page, not the old diagnostics page.
Recommended entry points:

- Craft tab: `Workflows`, always first-party React surface, receives `workspaceId`.
- Deep link: `/dashboard/workflows`, still supported and using the standalone
  shell for direct navigation.
- Detail links:
  - `/dashboard/workflows/designs/:designId` or existing editor path for design/edit,
  - `/dashboard/workflows/runs/:runId` or existing run path for clean run view,
  - `/dashboard/workflows/batches/:batchId` for batch details.

The page should have a left-to-right product story:

1. **Header / workspace context**
   - Workspace name if available.
   - Primary CTAs: `Create workflow`, `Run workflow`, possibly `Import/copy starter` later.
   - No raw workspace/run IDs by default.
2. **Needs input**
   - Human forms and user decisions needed now.
   - Each item says what workflow/run is waiting and what input is needed.
3. **Active runs**
   - Running/waiting/blocked runs with owner, current state/step, and next expected event.
4. **Your workflows**
   - Drafts and published designs, status labels, edit/run/batch actions.
5. **Starter templates**
   - Catalog templates with `Create copy`/`Customize`, unavailable reasons if invalid.
6. **Recent runs and recent batches**
   - Links to clean run and batch detail pages when supported.

### What stays out of the centralized page

- Agent Teams diagnostics and manual/debug workflows.
- Raw queue/webhook/trigger/delivery IDs.
- Raw XML by default.
- Unsupported workflow-call modes, scheduled jobs, arbitrary command steps, and
  retry/cancel controls until implemented.
- Full JSON editing as a normal path. JSON remains diagnostics/view-only.

### UI-only vs runtime-dependent classification

| Follow-up                       | UI-only/read-model | Core/runtime/plugin dependent | Notes                                                           |
| ------------------------------- | ------------------ | ----------------------------- | --------------------------------------------------------------- |
| Centralized product page shell  | Yes                | No                            | Can compose existing read models first.                         |
| Better page IA and empty states | Yes                | No                            | Product copy and component work.                                |
| Wizard right-pane navigation    | Mostly             | No new core                   | Uses existing supported schema.                                 |
| Graph layout/readability        | Mostly             | No core                       | May add layout metadata to drafts later.                        |
| Movable node persistence        | UI/store           | No core                       | Store draft layout separately from canonical runtime config.    |
| Run storytelling gaps           | Read-model         | Maybe                         | Only add runtime events if current history lacks product facts. |
| Batch details v3                | Read-model         | Maybe                         | Retry/cancel deferred.                                          |
| CI wait presentation polish     | Read-model/UI      | Existing plugin               | No new CI primitive required.                                   |
| Command-step safety             | No                 | Yes/design first              | M114.                                                           |
| Sub-workspace lanes             | No                 | Yes/design then foundation    | M115/M116.                                                      |
| Bead-driven meta-workflow       | UI/runtime         | Yes                           | M118 depends on safe command/lane decisions.                    |
| Branch push UX                  | UI/integration     | Maybe VK/VD integration       | M119 deferred behind lane decisions.                            |
| Scheduled workflow/jobs         | No                 | Yes/design first              | M120.                                                           |

## Graph/editor audit

### Current product issue

The graph is now dark-mode readable, Storybook-captured, and scrollable, but
users still need stronger graph UX:

- State names and transition/action labels must remain visible at ordinary zoom.
- Edge labels must not overlap nodes, other edge labels, minimap/controls, or
  each other in common workflows.
- Selected state/transition details should be obvious without requiring the user
  to scroll far down the right pane.
- The right pane should act like a guided editor: roles -> states -> steps ->
  transitions/actions -> details/args.
- Users need a way to adjust layout when auto-layout is not enough.

### React Flow research notes

React Flow/xyflow gives us the right primitives, but layout is our
responsibility:

- The `<ReactFlow />` component renders nodes and edges and supports controlled
  `nodes`, `edges`, and change handlers (`onNodesChange`, `onEdgesChange`). This
  means we can support user-positioned nodes without replacing the graph stack.
- React Flow examples document auto-layout integrations with engines such as
  dagre, d3-hierarchy, and ELK; ELK is the more configurable option when graph
  spacing and non-tree structures matter.
- React Flow's `EdgeLabelRenderer` renders edge labels as HTML overlays instead
  of SVG labels, which is a better fit for readable, selectable transition
  labels with tooltips/actions.
- React Flow docs and examples treat layout algorithms as external: compute node
  positions, pass them back to React Flow, and keep React Flow controlled.

References reviewed on August 13, 2026:

- React Flow `<ReactFlow />` API: <https://reactflow.dev/api-reference/react-flow>
- React Flow edge label renderer example: <https://reactflow.dev/examples/edges/edge-label-renderer>
- React Flow auto-layout example: <https://reactflow.dev/examples/layout/auto-layout>
- React Flow ELK layout example: <https://reactflow.dev/examples/layout/elkjs>
- React Flow `useNodesState` hook: <https://reactflow.dev/api-reference/hooks/use-nodes-state>

### Recommended graph implementation direction

For `vibe-kanban-vscode-web-5fx9`, implement graph readability in layers:

1. **Storybook comparison fixtures first**
   - Simple linear workflow.
   - Dev/Review/Tester with loops.
   - Human form workflow.
   - Blocking workflow call.
   - CI wait action.
   - Dense graph with long labels and parallel/reverse loops.
2. **Improve edge labels**
   - Prefer `EdgeLabelRenderer`/custom edge component for HTML labels.
   - Keep labels clickable/selectable and visible above edges.
   - Add label truncation with tooltip/detail panel rather than hiding labels.
3. **Improve auto-layout spacing**
   - Evaluate ELK first because it exposes richer spacing controls than a small
     hand-rolled fixed grid.
   - Preserve deterministic output for tests.
   - Tune rank/node/edge label spacing in Storybook comparison stories.
4. **Support manual repositioning**
   - Enable node dragging in edit mode only.
   - Persist layout in draft/editor metadata, not canonical runtime workflow JSON.
   - Published workflow execution should not depend on visual layout metadata.
5. **Add reset layout**
   - Users can reset to auto-layout if manual positions become confusing.

### Right-pane wizard direction

For `vibe-kanban-vscode-web-8aba`, make the right pane navigable and progressive:

1. **Roles list**
   - Clickable role rows.
   - `Add role` button.
   - Role summary: label, description, states owned by role.
2. **Role detail**
   - Role name/description.
   - States owned by that role.
   - `Add state for role`.
3. **State detail**
   - Owner role, state name/description if supported, steps, outgoing actions.
   - Add supported step types only.
4. **Step detail**
   - Agent turn prompt/skill picker.
   - Human form provider fields.
   - Blocking workflow call fields if executable.
5. **Transition/action detail**
   - Label, target state, result fields, handoff text, wait provider details.
6. **Validation panel**
   - Always visible in summary form, but details only expand when relevant.

The graph should remain the visual map. The right pane should be the primary
form editor.

## Remaining UX completeness audit

### Creation

Current strengths:

- Wizard-first creation exists.
- Starter templates and user workflows are separated.
- Prompt/skill picker exists.
- Graph editor supports supported workflow shapes.

Remaining gaps:

- Wizard and graph editor are not yet a single smooth authoring experience.
- Right pane is too form-dump-like for complex workflows.
- Graph layout/labels are not reliable enough for dense workflows.
- Duplicating a workflow should communicate exactly what is copied: design and
  prompt/skill assets, not sessions or runs.
- Prompt/skill provenance should stay visible when selecting reusable assets.

### Running

Current strengths:

- Launch modal supports required inputs, additional instructions, role/session
  binding, and post-launch affordances.
- Runs are workspace-specific and do not mutate global designs.

Remaining gaps:

- A centralized page should show a launch summary in context, not only in a modal.
- Session defaults may need workspace-level memory later, but should not block
  central page work.
- Users need clearer confidence that a workflow is runnable: published version,
  required inputs, supported steps, and role bindings all complete.

### Monitoring

Current strengths:

- Clean run page tells a product story and hides raw IDs/XML by default.
- Human waits, workflow calls, CI wait, batches, and provenance have read-model/UI
  coverage.

Remaining gaps:

- The centralized page should summarize current runs and waiting reasons without
  forcing users into each run page.
- Parent/child call trees need a compact summary on the central page and a full
  tree on the run page.
- Batch summaries need to explain backpressure and item errors without making
  scheduler internals look like user controls.
- CI wait needs consistent language: what is being watched, current poll/backoff
  status when useful, last observed result, and next resume condition.

### Diagnostics boundary

Normal pages should hide:

- raw XML,
- response refs,
- webhook/queue/trigger/delivery language,
- internal run IDs,
- unbounded JSON dumps.

Advanced diagnostics may show:

- collapsed JSON snapshots,
- workflow definition diagnostics,
- internal IDs with copy buttons,
- transport/event history for developers.

The old Agent Teams/dashboard diagnostics can remain available by direct URL or
manual navigation, but should not be the user's product workflow entry.

## Proposed follow-up milestone sequence after M113

This sequence keeps the user-facing UX foundation ahead of new automation power.
It also keeps M114+ security/runtime design from being mixed into visual polish.

```text
M113A Centralized workflow page product shell/read model
M113B Workflow graph layout + transition visibility
M113C Workflow editor right-pane wizard navigation
M114  Command-step safety design for workflow automation
M115  Sub-workspace lane design for isolated workflow milestones
M116  Sub-workspace lane foundation
M117  Safe workflow command-step provider
M118  Bead-driven meta-workflow sequential pause/resume prototype
M119  Branch push UX revisit
M120  Scheduled workflow and command jobs design
```

Why split M113A-C before M114:

- The user is actively trying to use workflow creation/running/monitoring now.
- M113A-C are mostly UI/read-model/editor work and lower safety risk.
- Command steps and sub-workspace lanes can amplify workflow power, so their UX
  should land after the core product surface is understandable.

## M113 acceptance

### TEST_CASE_M113_1A — UX audit covers current workflow surfaces

Steps:

1. Review this plan's sections for creation, running, monitoring, batch, CI wait,
   graph/editor, prompt/skill picker, Storybook, and diagnostics boundaries.
2. Compare against `test-plan-3.md` and `test-plan-4.md` milestones.
3. Confirm every current major workflow surface has either a current strength,
   remaining gap, or deferred follow-up listed.

Expected:

- The plan explains what is complete enough now and what remains incomplete.
- The plan does not propose implementing the centralized page in M113.
- The plan calls out UI-only/read-model work separately from core/runtime work.

### TEST_CASE_M113_1B — Centralized workflow page plan is product-focused

Steps:

1. Read the centralized workflow page plan.
2. Confirm it identifies page entry points, page sections, detail links, and what
   stays out of the page.
3. Confirm it preserves direct routes as deep links/diagnostics-compatible paths.

Expected:

- The proposed page is workspace-aware and product-oriented.
- It has clear sections for Needs input, Active runs, Your workflows, Starter
  templates, Recent runs, and Recent batches.
- It avoids raw engine/transport terms by default.

### TEST_CASE_M113_1C — Graph/editor follow-ups are actionable

Steps:

1. Review graph research notes and recommendations.
2. Confirm the plan links the graph layout bead `vibe-kanban-vscode-web-5fx9`.
3. Confirm the plan links the right-pane wizard bead `vibe-kanban-vscode-web-8aba`.
4. Confirm each follow-up has Storybook, component, browser, and validation
   expectations.

Expected:

- The plan recommends React Flow-compatible solutions rather than a graph stack
  rewrite.
- It separates label readability, auto-layout, manual repositioning, and right
  pane navigation into reviewable pieces.
- It says layout metadata belongs in draft/editor metadata, not runtime workflow
  JSON.

### TEST_CASE_M113_1D — Future milestone sequence preserves safety boundaries

Steps:

1. Review the proposed M113A-C and M114-M120 sequence.
2. Confirm command-step work remains design-first in M114.
3. Confirm sub-workspace lane design precedes lane foundation.
4. Confirm branch push and scheduled jobs remain deferred.

Expected:

- The sequence prioritizes immediate workflow UX before new automation power.
- Runtime/core-dependent work is not hidden inside UI-only milestones.
- Deferred items still have named future milestones.

### TEST_CASE_M113_1E — Docs-only validation and handoff are complete

Steps:

1. Manually review links in this document.
2. Run `git diff --check`.
3. Confirm implementation did not change product/runtime code.
4. Update bead `vibe-kanban-vscode-web-4o0u` with summary, validation, risks,
   and commit.

Expected:

- `git diff --check` passes.
- Only docs/test-plan files are changed for M113 unless a tiny metadata cleanup
  is explicitly documented.
- Reviewer and independent tester have enough detail to validate the plan.

## Acceptance and test plan for proposed follow-ups

### M113A — Centralized workflow page product shell/read model

**Type:** UI/read-model, product page implementation.

**Goal:** Create the main workspace-aware product page for workflow creation,
running, and monitoring without replacing existing deep links.

**Scope:**

- Centralized Workflows page shell reachable from craft tab and direct route.
- Sections: Needs input, Active runs, Your workflows, Starter templates, Recent
  runs, Recent batches.
- Product empty/loading/error states.
- Links to existing editor/run/batch pages only when supported.
- No unsupported runtime controls.

**Acceptance:**

- `TEST_CASE_M113A_1A` — Page shows workspace-aware product summary and primary
  CTAs.
- `TEST_CASE_M113A_1B` — Needs input and active runs explain who is waiting and
  what happens next.
- `TEST_CASE_M113A_1C` — Your workflows and Starter templates remain distinct.
- `TEST_CASE_M113A_1D` — Recent runs/batches link only to supported clean pages.
- `TEST_CASE_M113A_1E` — Debug/internal terms do not appear in normal view.

**Validation:**

- Read-model grouping tests.
- Component tests for each section and empty/error states.
- Storybook stories for full, empty, error, and dense states.
- Playwright Workflows tab/direct-route smoke.
- `npm run check-types`.
- `git diff --check`.

### M113B — Workflow graph layout and transition visibility

**Type:** UI/Storybook/editor polish.

**Goal:** Make workflow graphs readable for real workflows, including loops,
long transition labels, CI wait, human forms, and workflow calls.

**Scope:**

- Research/implement custom edge label rendering.
- Evaluate ELK/dagre/fixed-domain layout in Storybook before finalizing.
- Improve edge label collision avoidance and truncation/tooltip behavior.
- Enable controlled node positions and manual repositioning in edit mode if
  needed.
- Store layout metadata with draft/editor data, not executable workflow JSON.
- Add `Reset layout`.

**Acceptance:**

- `TEST_CASE_M113B_1A` — State names and transition labels are visible at default
  zoom for simple and Dev/Review/Tester workflows.
- `TEST_CASE_M113B_1B` — Labels do not overlap nodes in dense/loop/CI wait
  comparison stories.
- `TEST_CASE_M113B_1C` — Selecting an edge shows full transition details/args in
  the side pane even if the label is truncated.
- `TEST_CASE_M113B_1D` — Users can reposition nodes or reset to auto-layout when
  auto-layout is insufficient.
- `TEST_CASE_M113B_1E` — Published runtime behavior does not depend on visual
  layout metadata.

**Validation:**

- Graph model/layout unit tests with deterministic fixtures.
- Component tests for selected edge labels/details.
- Storybook comparison stories and walkthrough screenshots/video.
- Playwright graph editor browser smoke.
- `npm run check-types`.
- `git diff --check`.

### M113C — Workflow editor right-pane wizard navigation

**Type:** UI/editor polish.

**Goal:** Replace the dense right-side form dump with guided navigation from
roles to states to transitions/actions.

**Scope:**

- Role list with `Add role`.
- Selecting a role shows owned states.
- Selecting a state shows steps and outgoing transitions/actions.
- Selecting a step/action shows supported fields and args.
- Prompt/skill picker remains the normal prompt editing surface.
- Validation appears in context.
- Unsupported controls hidden.

**Acceptance:**

- `TEST_CASE_M113C_1A` — Roles are clickable and `Add role` creates a valid draft
  role path.
- `TEST_CASE_M113C_1B` — Selecting a role lists its states and supports adding a
  state for that role.
- `TEST_CASE_M113C_1C` — Selecting a state shows steps and actions without raw
  JSON editing.
- `TEST_CASE_M113C_1D` — Selecting a transition/action shows label, target,
  result fields, handoff, wait provider details, and validation errors.
- `TEST_CASE_M113C_1E` — Graph preview and validation remain in sync with pane
  edits.

**Validation:**

- Editor state/model tests.
- Component tests for navigation and validation.
- Storybook interactive-ish pure state stories where practical.
- Playwright graph editor edit smoke.
- `npm run check-types`.
- `git diff --check`.

### M114 — Command-step safety design for workflow automation

Detailed plan: [`./test-plan-7.md`](./test-plan-7.md).

**Type:** Design/ADR/test-plan only.

**Goal:** Decide how workflow command/bash steps can exist safely before any
execution implementation.

**Acceptance:**

- `TEST_CASE_M114_1A` — Plan defines allowed command providers vs arbitrary
  shell, permissions, cwd/workspace, environment, secret redaction, timeouts,
  output caps, cancellation, audit/provenance, idempotency, and approvals.
- `TEST_CASE_M114_1B` — Plan explains how command steps can read bead/status data
  for issue-tracker/meta-workflow automation without unrestricted filesystem or
  network access.
- `TEST_CASE_M114_1C` — Plan includes E2E/test harness expectations for safe and
  denied command paths.

**Validation:** docs review and `git diff --check`.

### M115 — Sub-workspace lane design for isolated workflow milestones

**Type:** Design/ADR/test-plan only.

**Goal:** Design isolated workspace/worktree lanes so workflow milestones can run
without agents stepping on the same working tree.

**Acceptance:**

- `TEST_CASE_M115_1A` — Plan defines lane creation, naming, parent/child refs,
  cleanup, branch/worktree ownership, capacity, and conflict rules.
- `TEST_CASE_M115_1B` — Plan explains how workflow runs choose lanes and how
  users inspect lane status.
- `TEST_CASE_M115_1C` — Plan covers failure/recovery and branch merge/push
  handoff constraints.

**Validation:** docs review and `git diff --check`.

### M116 — Sub-workspace lane foundation

**Type:** Runtime/store/API foundation.

**Goal:** Implement the smallest durable lane model needed before command steps
and meta-workflows use it.

**Acceptance:**

- `TEST_CASE_M116_1A` — API/store can create/list/close lanes linked to a parent
  workspace and workflow run.
- `TEST_CASE_M116_1B` — Capacity prevents conflicting write turns in the same
  lane/workspace.
- `TEST_CASE_M116_1C` — UI/read-model shows lane status without exposing raw
  internals.

**Validation:** store/API tests, scheduler tests, component/Playwright coverage
if browser-visible, `npm run check-types`, `git diff --check`.

### M117 — Safe workflow command-step provider

**Type:** Runtime/plugin implementation.

**Goal:** Add the first safe executable command provider using the M114 safety
model and M116 lane foundation.

**Acceptance:**

- `TEST_CASE_M117_1A` — Supported command step runs in allowed workspace/lane
  context with timeouts and output caps.
- `TEST_CASE_M117_1B` — Denied/unsafe command paths fail product-visibly without
  mutating workflow state incorrectly.
- `TEST_CASE_M117_1C` — Command output is redacted/capped and appears in run
  presentation as product output, not raw terminal dump.
- `TEST_CASE_M117_1D` — Duplicate wakeups are idempotent.

**Validation:** provider/runtime tests, safety tests, run presentation tests,
Playwright if UI-visible, `npm run check-types`, `git diff --check`.

### M118 — Bead-driven meta-workflow sequential pause/resume prototype

**Type:** Workflow template/runtime integration prototype.

**Goal:** Let workflow runs coordinate bead-driven work in a sequential,
pause/resume-friendly way without requiring an orchestrator agent.

**Acceptance:**

- `TEST_CASE_M118_1A` — A workflow can read a bead, launch a milestone-like child
  step, pause for review/tester status, and resume when approved.
- `TEST_CASE_M118_1B` — Needs-input/blocked states are clear on the centralized
  page and run page.
- `TEST_CASE_M118_1C` — The workflow does not create conflicting agents in the
  same workspace/lane.

**Validation:** lower-level runtime tests first; Docker/qa-mode E2E only if the
lane and command provider seams are stable.

### M119 — Branch push UX revisit

**Type:** Deferred UX/integration.

**Goal:** Revisit easy workspace branch push from VD UI and VK file-change branch
push affordances after lane ownership is understood.

**Acceptance:**

- `TEST_CASE_M119_1A` — User can see changed files/branch state and choose a safe
  push path.
- `TEST_CASE_M119_1B` — Workflow-created lane changes explain provenance and do
  not push from the wrong workspace/lane.
- `TEST_CASE_M119_1C` — Errors/permissions are product-visible.

**Validation:** route/API tests, UI/component tests, Playwright, possible VK
integration tests.

### M120 — Scheduled workflow and command jobs design

**Type:** Design/ADR/test-plan only.

**Goal:** Decide how declarative scheduled jobs should trigger workflows or safe
commands without surprising users.

**Acceptance:**

- `TEST_CASE_M120_1A` — Plan defines schedule authoring, timezone, missed runs,
  backpressure, idempotency, ownership, disabling, and audit/provenance.
- `TEST_CASE_M120_1B` — Plan distinguishes scheduled workflow runs from scheduled
  command jobs.
- `TEST_CASE_M120_1C` — Plan defines notification/attention behavior for failures
  and blocked runs.

**Validation:** docs review and `git diff --check`.

## Browser/E2E expectations by follow-up

| Milestone | Browser-visible?         | Expected browser validation                                                   |
| --------- | ------------------------ | ----------------------------------------------------------------------------- |
| M113      | No, docs-only            | None beyond manual docs review.                                               |
| M113A     | Yes                      | Playwright central page smoke and forbidden debug term checks.                |
| M113B     | Yes                      | Storybook screenshot/video plus graph editor Playwright smoke.                |
| M113C     | Yes                      | Playwright editor navigation/edit smoke.                                      |
| M114      | No                       | Docs-only.                                                                    |
| M115      | No                       | Docs-only.                                                                    |
| M116      | Maybe                    | Add Playwright only if lane UI lands.                                         |
| M117      | Maybe                    | Add Playwright if command output/status is visible in run page.               |
| M118      | Yes if prototype exposed | Playwright/qa-mode if practical, otherwise documented lower-level validation. |
| M119      | Yes                      | Playwright branch push UX smoke.                                              |
| M120      | No                       | Docs-only.                                                                    |

## Review/tester handoff guidance

For each implementation milestone after M113:

1. Implementer updates the target bead with:
   - summary,
   - changed files,
   - validation commands and results,
   - screenshots/video/artifacts for browser-visible changes,
   - deviations/risks.
2. Review4 checks:
   - scope boundaries,
   - product language vs diagnostics leakage,
   - unsupported controls hidden,
   - runtime/core changes only when milestone allows them,
   - tests map to the test case IDs above.
3. Independent tester runs:
   - focused browser or Storybook walkthrough for UI-visible work,
   - Docker/qa-mode only when the milestone affects real execution paths,
   - artifact capture for screenshots/video where requested.
4. Any failed acceptance item gets a focused fix bead/commit before moving to the
   next milestone.

## M113 risks and decisions to revisit

- The centralized page could duplicate Workflows tab content if we do not make a
  clear IA decision. Recommendation: make the Workflows tab render the product
  centralized page for a workspace; direct routes are deep links.
- Graph layout could become a time sink. Recommendation: compare ELK/custom
  labels in Storybook before committing to persisted manual layout.
- Persisting visual layout in canonical workflow JSON would pollute runtime
  config. Recommendation: store visual layout as draft/editor metadata.
- Command steps are high-risk. Recommendation: keep M114 design-only and do not
  implement command execution before lane/safety decisions are accepted.
- Meta-workflows depend on lanes and safe commands. Recommendation: do not start
  M118 until M115-M117 are approved or explicitly narrowed.
