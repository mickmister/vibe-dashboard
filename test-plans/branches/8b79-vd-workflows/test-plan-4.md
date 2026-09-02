# Test Plan 4: Post-M100 workflow UX, monitoring, and product polish

Branch: `vk/8b79-vd-workflows`

Planning/discussion bead: `vibe-kanban-vscode-web-9cu` — Post-M100 workflow UX next steps discussion

Related follow-up beads:

- `vibe-kanban-vscode-web-ar8` — Improve workflow graph dark-mode colors and contrast
- `vibe-kanban-vscode-web-xkr` — VK conversation UI should not say You for automation messages
- `vibe-kanban-vscode-web-zwr` — Workflow action: wait for GitHub CI result
- `vibe-kanban-vscode-web-fwe` — Discuss React craft surface tab architecture

Earlier roadmap:

- [`./test-plan-3.md`](./test-plan-3.md) — M90-M100 workflow builder, generic runtime, templates, workflow calls, and batch/capacity

## Purpose

M90-M100 built the workflow platform foundation: global designs/templates,
prompt/skill refs, generic persisted runtime, Workflows tab, launch/session
binding, human-form steps, graph editor, real Dev/Review/Tester and Create Form
templates, blocking workflow calls, and batch/capacity.

This plan organizes the next phase: make workflow creation, running, and
monitoring understandable and usable. The core product question is no longer
"can workflows execute?" but:

> Can a user understand what workflow they are creating, what will happen when
> they run it, what is happening now, why something is waiting, and what to do
> next?

## Product principles for this phase

1. **Fix basic usability first.** Standalone workflow pages must scroll without
   changing global body scroll behavior.
2. **Prefer product language over engine language.** Avoid queue/webhook/raw ID
   terms in normal UI.
3. **Separate concepts visually.** Starter templates, user workflows, runs,
   batches, and attention items are different objects.
4. **Wizard first, graph second.** Graph remains the visual model and advanced
   editor, but initial creation should be guided.
5. **Run pages tell a story.** Show who has the ball, why the run is waiting,
   what happened last, and what happens next.
6. **Show capacity as explanation, not controls.** Users need to know why items
   are pending; they do not need scheduler knobs in normal UI.
7. **Keep unsupported controls hidden.** Retry/cancel, fire-and-forget calls,
   terminal/handoff calls, and new plugin actions stay hidden until executable.
8. **React craft surfaces are desirable but not first.** Document the direction,
   but do not block immediate workflow UX on craft surface architecture.
9. **Preserve diagnostics without leading with them.** JSON/XML/raw refs remain
   advanced or diagnostics-only.

## Classification: UI-only vs core-dependent

| Area | Mostly UI/read-model | Requires workflow core/runtime/plugin changes |
| --- | --- | --- |
| Standalone route scroll shell | Yes | No |
| Graph dark-mode colors | Yes | No |
| Workflows home IA split | Yes | No/light API |
| Launch summary/recommended defaults | Yes | Maybe light API/store for remembered defaults |
| Run timeline/status storytelling | Yes/read-model | Maybe no core if existing events are enough |
| Parent-child call tree display | Yes/read-model | Maybe index later for scale |
| Batch detail page/table | Yes/read-model | No core unless retry/cancel added |
| Batch paste/table preview | Yes | No/light validation |
| Wizard-first creation | UI/API | No new core if only supported step types |
| Prompt/skill picker | UI/API | No core, but asset APIs may need expansion |
| React craft surface foundation | UI platform | No workflow core |
| Automation provenance labels | UI + metadata | Likely sender/provenance metadata plumbing |
| Wait for GitHub CI action | No | Yes: plugin/provider/runtime waiting/polling |
| Batch retry/cancel | No | Yes: runtime/scheduler semantics |
| Fire-and-forget/terminal workflow calls | No | Yes: core/runtime semantics |

## Recommended milestone sequence

```text
M101  UX roadmap/test-plan and decision lock
M102  Standalone route shell + workflow graph dark-mode polish
M103  Workflows home IA cleanup
M104  Launch UX clarity and session defaults v1
M105  Run monitoring/storytelling v2
M106  Batch detail UX v2
M107  Wizard-first workflow creation v1
M108  Prompt/skill picker and editor polish
M109  React craft surface foundation
M110  Automation provenance and message attribution
M111  GitHub CI wait action/plugin design and implementation
```

M111 is intentionally separated because it is a new core/plugin/runtime feature,
not merely UX polish.

---

## M101 — UX roadmap/test-plan and decision lock

**Type:** docs/test-plan/decision only

### Goal

Turn post-M100 UX discussions into an implementation-ready acceptance plan.

### Deliverables

- This test plan.
- Updated/linked beads for M102+.
- Explicit classification of UI-only vs core-dependent items.
- Decision record for:
  - scroll shell direction,
  - Workflows IA,
  - wizard vs graph creation,
  - run monitoring priorities,
  - batch UX next step,
  - React craft surface timing.

### Acceptance

- `TEST_CASE_M101_1A` — Plan lists milestone sequence and dependencies.
- `TEST_CASE_M101_1B` — Plan separates UI/read-model work from core/runtime/plugin work.
- `TEST_CASE_M101_1C` — Plan includes browser/E2E expectations for browser-visible milestones.

### Validation

- Docs review.
- `git diff --check`.

---

## M102 — Standalone route shell + workflow graph dark-mode polish

**Type:** UI bug fix/polish

### Goal

Make standalone workflow dashboard pages usable in the existing overflow-hidden app
shell and make the graph visually fit VD dark mode.

### Scope

1. Add shared standalone route wrapper, e.g. `StandaloneDashboardPage`:
   - `h-screen`,
   - `overflow-y-auto`,
   - dark background/text defaults,
   - optional content width/padding slots.
2. Apply to:
   - `/dashboard/workflows`,
   - `/dashboard/workflows/editor/:designId`,
   - `/dashboard/workflows/:runId`,
   - `/dashboard/teams` diagnostics if still standalone.
3. Do **not** set global `body { overflow: scroll }`.
4. Improve React Flow dark-mode theme:
   - dark blue/slate nodes,
   - readable text,
   - visible edges/labels,
   - selected/active/terminal styling,
   - accessible focus/hover states,
   - no harsh white default node blocks.

### Acceptance

- `TEST_CASE_M102_1A` — Workflows home scrolls when content exceeds viewport.
- `TEST_CASE_M102_1B` — Graph editor scrolls when side panel/content exceeds viewport.
- `TEST_CASE_M102_1C` — Run presentation page scrolls when timeline/details exceed viewport.
- `TEST_CASE_M102_1D` — Main workspace/craft shell layout does not regress.
- `TEST_CASE_M102_2A` — Graph nodes/edges use dark-mode colors with readable text.
- `TEST_CASE_M102_2B` — Selected/terminal/loop edges are visually distinct.

### Validation

- Component tests for wrapper classes and graph node/edge classes.
- Playwright workflow page scroll regression.
- Screenshot or trace artifact for graph dark-mode appearance.
- `npm run check-types`.
- `git diff --check`.

---

## M103 — Workflows home IA cleanup

**Type:** UI/read-model polish

### Goal

Make the Workflows tab easier to understand by separating starter templates from
user-owned workflows and improving labels/actions.

### Scope

- Replace mixed **Available workflows** with:
  - **Your workflows** — DB-backed designs/drafts/published versions.
  - **Starter templates** — checked-in catalog templates.
- Keep **Needs your input**, **Recent runs**, and **Recent batches**.
- Clarify status labels:
  - Draft,
  - Published vN,
  - Starter template,
  - Unavailable.
- Use clearer CTAs:
  - `Create copy`, `Customize`, `Run`, `Batch run`, `Edit`.
- Empty states explain next action.
- No debug/internal terminology.

### Acceptance

- `TEST_CASE_M103_1A` — Starter templates and user workflows render in separate sections.
- `TEST_CASE_M103_1B` — A built-in template cannot be confused with a runnable user workflow.
- `TEST_CASE_M103_1C` — Published user workflows expose Run/Batch/Edit actions.
- `TEST_CASE_M103_1D` — Empty states explain how to create the first workflow.
- `TEST_CASE_M103_1E` — No unsupported/debug terms appear.

### Validation

- Read-model unit tests for section grouping.
- Component tests for labels/actions/empty states.
- Playwright Workflows tab IA regression.
- `npm run check-types`.
- `git diff --check`.

---

## M104 — Launch UX clarity and session defaults v1

**Type:** UI/read-model, light API/store if defaults are included

### Goal

Make launching a workflow feel predictable before the user clicks Run.

### Scope

- Add launch summary:
  - workflow name/version,
  - required inputs,
  - roles,
  - selected sessions,
  - first actor/state,
  - whether human input/workflow calls may occur.
- Improve role/session binding affordances:
  - `Create sessions for all roles`,
  - recommended default of create/reuse by role when no obvious existing session,
  - workspace mismatch warnings if applicable.
- Keep one run-level additional instructions field.
- Optional: remember workspace role/session defaults only if small and explicitly approved.
- Show post-launch result clearly:
  - run queued/started,
  - open run page,
  - first session link if available.

### Acceptance

- `TEST_CASE_M104_1A` — Launch dialog shows summary before submit.
- `TEST_CASE_M104_1B` — User can create/reuse sessions for all roles with one action.
- `TEST_CASE_M104_1C` — Required inputs and missing role bindings produce product-level errors.
- `TEST_CASE_M104_1D` — Additional instructions are clearly scoped to this run only.
- `TEST_CASE_M104_1E` — After launch, user can open the created run page.

### Validation

- Component/API tests for launch summary/defaults.
- Server route tests for validation unchanged.
- Playwright launch flow regression.
- `npm run check-types`.
- `git diff --check`.

---

## M105 — Run monitoring/storytelling v2

**Type:** read-model/UI polish

### Goal

Turn running/completed workflow pages into readable stories rather than raw
runtime state displays.

### Scope

- Top summary:
  - status,
  - current owner/role,
  - current state/step,
  - why waiting,
  - what happens next.
- Timeline:
  - queued/sent/completed agent turns,
  - decisions/actions,
  - loops,
  - human forms,
  - workflow calls,
  - blocked/retry events.
- Parent/child workflow call tree:
  - child run links,
  - child status,
  - parent waiting reason.
- Output/artifact section:
  - form artifacts,
  - child output refs,
  - final summaries.
- Hide raw queue/webhook/internal IDs by default; keep diagnostics collapsed.

### Acceptance

- `TEST_CASE_M105_1A` — Running run page shows who has the ball and why waiting.
- `TEST_CASE_M105_1B` — Completed DRT run shows Dev/Review/Tester timeline with loops.
- `TEST_CASE_M105_1C` — Human-form wait shows the pending user action and clears after submit.
- `TEST_CASE_M105_1D` — Blocking workflow-call parent shows child call tree/link/status.
- `TEST_CASE_M105_1E` — Blocked/failed runs show product-level reason and next action if any.
- `TEST_CASE_M105_1F` — Debug transport terms remain hidden in default UI.

### Validation

- Presentation read-model tests for states, loops, calls, human waits, blocked runs.
- Component tests for summary/timeline/call tree.
- Playwright run page tests, including DRT Docker fixture if practical.
- `npm run check-types`.
- `git diff --check`.

---

## M106 — Batch detail UX v2

**Type:** read-model/UI polish

### Goal

Make batches understandable beyond the small inline summary added in M100.

### Scope

- Dedicated batch detail route/page or robust in-page detail panel.
- Item table:
  - line/index,
  - input summary,
  - status,
  - linked run when launched,
  - error/field errors,
  - timestamps.
- Filters:
  - All,
  - Pending,
  - Running,
  - Complete,
  - Failed/blocked.
- Capacity/backpressure explanation:
  - workspace active limit,
  - global active limit,
  - why items are pending.
- Better paste/preview can be included if small; otherwise M106B.
- Retry/cancel controls remain hidden/deferred unless semantics are designed.

### Acceptance

- `TEST_CASE_M106_1A` — Batch detail shows every item status and error.
- `TEST_CASE_M106_1B` — Failed/blocked filters reveal actionable item errors.
- `TEST_CASE_M106_1C` — Running items link to their workflow run pages.
- `TEST_CASE_M106_1D` — Pending items explain capacity/backpressure when applicable.
- `TEST_CASE_M106_1E` — Retry/cancel controls are absent or clearly marked unavailable if not executable.

### Validation

- Batch read-model tests for item detail and capacity explanation.
- Component tests for table/filter states.
- Playwright batch detail test.
- `npm run check-types`.
- `git diff --check`.

---

## M107 — Wizard-first workflow creation v1

**Type:** UI/API using existing supported workflow model

### Goal

Make creating supported workflows possible without starting from raw graph editing.

### Scope

Wizard steps:

1. Choose starter template / duplicate existing / blank simple workflow.
2. Name and purpose.
3. Inputs.
4. Roles.
5. Stages/steps from supported types:
   - agent turn,
   - human form,
   - blocking workflow call if executable.
6. Decisions/actions/loops.
7. Review graph.
8. Save draft / Save & publish / Publish and run.

Graph editor remains available as visual review/advanced edit.

### Acceptance

- `TEST_CASE_M107_1A` — User creates a simple one-agent workflow through wizard.
- `TEST_CASE_M107_1B` — User creates/duplicates DRT-style workflow through wizard path.
- `TEST_CASE_M107_1C` — Wizard-generated workflow validates through workflow-core and store publish.
- `TEST_CASE_M107_1D` — Unsupported step/call modes are not offered.
- `TEST_CASE_M107_1E` — Save draft vs publish/runnable state is clear.
- `TEST_CASE_M107_1F` — Wizard links to graph preview/editor.

### Validation

- Wizard component tests.
- Store/publish route tests for generated definitions.
- Graph transform tests for wizard output.
- Playwright create-save-publish-run smoke path.
- `npm run check-types`.
- `git diff --check`.

---

## M108 — Prompt/skill picker and editor polish

**Type:** UI/API polish

### Goal

Replace raw prompt-ref editing with understandable prompt/skill selection.

### Scope

- Prompt/skill picker in graph editor/wizard.
- Search/list prompt assets and skill snippets.
- Show source/provenance:
  - built-in,
  - user-created,
  - plugin-provided later.
- Show versions clearly.
- Preview composed prompt segments, including run-level additional instructions as
  a separate preview-only layer when relevant.
- Keep raw JSON diagnostics view-only.

### Acceptance

- `TEST_CASE_M108_1A` — User can select prompt/skill refs without typing comma syntax.
- `TEST_CASE_M108_1B` — Missing/unpublished prompt refs show product-level validation.
- `TEST_CASE_M108_1C` — Prompt version/source is visible.
- `TEST_CASE_M108_1D` — Existing prompt-ref workflows remain editable.
- `TEST_CASE_M108_1E` — Raw JSON remains diagnostics-only.

### Validation

- Prompt/skill API tests.
- Component tests for picker/search/selection.
- Store validation tests for missing refs.
- Playwright editor prompt selection test.
- `npm run check-types`.
- `git diff --check`.

---

## M109 — React craft surface foundation

**Type:** UI platform architecture

### Goal

Render same-app first-party workflow UI as a React craft surface instead of an
iframe/direct-route exception, while keeping direct dashboard routes for deep
links and diagnostics.

### Scope

- Design/implement structured craft surface target, e.g.:

  ```ts
  surface: {
    kind: 'react',
    pluginId: 'vibe-dashboard',
    surfaceKey: 'workflows',
    props: { workspaceId }
  }
  ```

- Register Workflows as first first-party React surface.
- Keep `/dashboard/workflows` direct route working.
- Do not make marketplace/untrusted plugin React embedding part of this slice.
- Iframes remain for external/untrusted/isolated surfaces.

### Acceptance

- `TEST_CASE_M109_1A` — Workflows tab renders in-process as React surface.
- `TEST_CASE_M109_1B` — Direct `/dashboard/workflows` route still works.
- `TEST_CASE_M109_1C` — Workspace/craft tab persistence handles structured surface target.
- `TEST_CASE_M109_1D` — Existing iframe tabs continue working.
- `TEST_CASE_M109_1E` — No fake URL/internal route hacks are required for same-app Workflows.

### Validation

- Craft surface registry/unit tests.
- Workspace tab persistence tests.
- Workflows tab Playwright regression.
- Existing iframe tab regression.
- `npm run check-types`.
- `git diff --check`.

---

## M110 — Automation provenance and message attribution

**Type:** UI + metadata plumbing

### Goal

Make workflow/automation-authored actions/messages distinguishable from user-authored
messages. This includes the reported issue that VK conversation UI should not say
"You" for messages sent through automation.

### Scope

- Define sender/provenance metadata:
  - user,
  - workflow automation,
  - agent,
  - system/plugin.
- Ensure workflow-launched messages carry provenance through VD/VK where needed.
- Update conversation UI labels so automation is not displayed as `You`.
- Show workflow/template/run/version provenance where useful.
- Avoid exposing raw internal IDs in normal UI.

### Acceptance

- `TEST_CASE_M110_1A` — Workflow-sent messages are labeled as workflow/automation, not `You`.
- `TEST_CASE_M110_1B` — User-sent messages still display as user-authored.
- `TEST_CASE_M110_1C` — Run page shows which workflow/version caused automation actions.
- `TEST_CASE_M110_1D` — Provenance survives queued/session execution paths.

### Validation

- VK/VD sender metadata tests as needed.
- Conversation UI component tests.
- Workflow launch/message integration tests.
- Playwright conversation/workflow provenance regression.
- `npm run check-types` and relevant VK checks.
- `git diff --check`.

---

## M111 — GitHub CI wait action/plugin

**Type:** core/runtime/plugin feature

Planning bead: `vibe-kanban-vscode-web-zwr`

### Goal

Allow a workflow state to offer an executable `Wait for CI` action. An agent can
push code, identify a GitHub CI/check/run ID, end with action XML requesting a CI
watch, and receive a continuation/result later when CI succeeds or fails.

### Scope

- Workflow/state toggle: **Enable "Wait for CI"**.
- GitHub CI plugin/provider registers the executable wait capability.
- Agent XML action includes CI run/check reference.
- Workflow enters a waiting callback/watch state.
- Poll GitHub periodically while watch is open; do not depend on webhooks for V1.
- Resume with success/failure details when CI reaches terminal status.
- Handle:
  - invalid run/check IDs,
  - stale watch callbacks,
  - duplicate poll/completion,
  - rate limits/backoff,
  - auth failures,
  - cancelled/expired watches.
- Monitoring UI shows waiting on CI and final result.

### Acceptance

- `TEST_CASE_M111_1A` — State with Wait for CI enabled accepts agent XML with CI run/check ID and enters waiting state.
- `TEST_CASE_M111_1B` — Poller resumes workflow on successful CI.
- `TEST_CASE_M111_1C` — Poller resumes or blocks workflow with useful details on failed CI.
- `TEST_CASE_M111_1D` — Duplicate/stale poll completions are idempotent/no-op.
- `TEST_CASE_M111_1E` — Auth/rate-limit errors back off and surface product-level status.
- `TEST_CASE_M111_1F` — UI shows waiting-on-CI and final CI result without requiring webhooks.
- `TEST_CASE_M111_1G` — Feature is hidden unless enabled for the workflow/state and provider is configured.

### Validation

- Pure workflow-core tests for wait action semantics if represented in core.
- GitHub CI provider tests with mocked GitHub API.
- Poller integration tests with fake clock/backoff.
- Runtime idempotency/stale-watch tests.
- UI component tests for waiting/result states.
- Optional Playwright mocked CI watch flow.
- `npm run check-types`.
- `git diff --check`.

---

## Deferred beyond this plan

- Batch retry/cancel implementation.
- Fire-and-forget workflow calls.
- Terminal/handoff workflow calls.
- Aggregate forms workflow template.
- Marketplace plugin packaging for workflow providers.
- Multi-process durable scheduler leases.
- Large-batch pagination beyond initial detail/read-model caps.
