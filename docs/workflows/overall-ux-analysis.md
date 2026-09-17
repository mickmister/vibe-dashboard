# Workflows feature set — overall UX analysis

Audience: UX/product teammate reviewing the current Workflows feature set.

Status: internal analysis draft. This is not user-facing documentation.

## Purpose

The Workflows area has grown from a run launcher into a broader system for:

- creating workflow designs;
- editing graph/state/role/action behavior;
- managing reusable role/prompt/skill assets;
- launching single runs and batch/meta-runs;
- monitoring work in progress;
- reviewing completed workflow output;
- using roadmap/bead context as task context.

This document maps the current pages and user flows, then calls out where the information architecture may be too fragmented or where pages might be merged.

## Current pages

### 1. Workflows Home

Path: `/dashboard/workflows`

Primary job:

- Act as the main hub for workflows in a workspace or across workspaces.
- Show a summary of workflow activity.
- Provide entry points to creation, running, monitoring, roadmap, meta-workflows, and library management.

What it currently contains:

- Header: “Workspace workflow center / Workflows”.
- Summary tiles:
  - needs input;
  - active runs;
  - user workflows;
  - starter templates.
- Browser notification controls.
- Links/actions:
  - View roadmap;
  - Library;
  - Meta-workflows, when workspace-scoped;
  - Create workflow;
  - Refresh.
- Lists/cards for workflows and recent activity.
- Launch controls for runnable workflow versions.

UX observations:

- This page is carrying multiple jobs: catalog, launcher, monitor, notification control, and navigation hub.
- It is probably the right landing page, but it needs sharper hierarchy:
  - “Start work” actions;
  - “Monitor work” section;
  - “Manage workflow designs” section;
  - “Manage reusable assets” link.
- The page should avoid becoming an everything-dashboard where users cannot tell the next step.

Questions for UX review:

- Should Home be a command center with several sections, or should it primarily be a launcher with monitoring moved elsewhere?
- Should active/recent runs be promoted above workflow design/library management?
- Should notification settings be global/persistent rather than visually part of this page?

### 2. Create Workflow Wizard

Path: `/dashboard/workflows/new`

Primary job:

- Create a new workflow design draft.

Supported creation paths:

- Start from a starter template.
- Duplicate an existing workflow design.
- Create a truly empty blank draft.

Current behavior:

- Blank means empty: no inputs, roles, states, steps, or actions.
- Blank drafts can be saved while invalid.
- Blank drafts cannot be published from the wizard.
- Starter copies and duplicates can be saved and may be published when valid.
- Name and purpose are collected up front.
- Duplicates preserve refs to role templates/prompt assets/skill snippets and do not copy sessions, runs, history, or library assets.

UX observations:

- This is a reasonable separate page if workflow creation remains a multi-step flow.
- The step numbers are not fully sequential in code/UI history, and UX should verify the visible numbering feels intentional.
- The “blank” path is intentionally advanced because users must complete structure in the graph editor.
- The starter/duplicate path currently leads to the graph editor or back to the Workflows tab; that seems right.

Questions for UX review:

- Should blank creation be labeled as “Advanced empty draft” to avoid users expecting a runnable workflow?
- Should duplicate existing workflows live here, or should it be an action on workflow cards on Home?
- Should starter selection include richer preview before copy, or is a select list enough?

### 3. Workflow Graph Editor

Path: `/dashboard/workflows/editor/:designId`

Primary job:

- Edit a workflow design.
- Understand its structure.
- Configure roles, states, transitions/actions, prompts, skills, and response contracts.

What it currently contains:

- Compact workflow title/description area.
- Progressive wizard/sidebar:
  - role list;
  - selected role;
  - selected state;
  - selected action/transition.
- Always-visible graph view that changes by wizard level.
- Prompt and skill authoring/selection.
- Final prompt preview for selected step.
- Generated response XSD diagnostics.
- JSON diagnostics.
- Save/publish controls.
- Safe removal controls for roles, states, and transitions.

UX observations:

- This is the power-user authoring surface.
- It has improved from “everything at once” to a drill-in model, but it is still dense because graph editing, prompt composition, diagnostics, and validation all live together.
- The graph view and sidebar are tightly coupled; that is good, but UX should confirm users understand graph clicks navigate the wizard.
- Diagnostics are necessary but should remain secondary.
- “Final prompt preview” probably belongs near the graph/context area, not as a primary sidebar editing step.

Questions for UX review:

- Should the editor have modes/tabs such as Structure, Prompts, Validation, Preview?
- Is the graph necessary at every editing level, or should some prompt-editing states use more space for forms?
- Should library editing ever happen inline here, or always link out to Library?
- Are delete/remove affordances discoverable and safe enough?

### 4. Workflow Library

Path: `/dashboard/workflows/library`

Primary job:

- Manage reusable workflow building blocks.

Current asset types:

- Role templates.
- Prompt assets.
- Skill snippets.

Current behavior:

- Published versions are immutable.
- Editing means “edit as new version”.
- Role templates can attach prompt assets and skill snippets.
- Attachments default to latest but can be pinned to a concrete version.
- Role templates can store executor/model defaults.
- Create/edit forms are hidden until the user selects New/Edit.

UX observations:

- Library is conceptually separate from workflow orchestration, which is good.
- The main risk is terminology overload:
  - workflow;
  - starter template;
  - role template;
  - prompt asset;
  - skill snippet;
  - published version;
  - draft.
- Users likely need clear examples of when to use a role template vs a prompt asset vs a skill snippet.
- Because role templates are reusable “agent behavior bundles,” Library is important for advanced users but may not be needed for first-run users.

Questions for UX review:

- Should Library stay as one page with three columns, or become tabs/detail pages as assets grow?
- Should Workflows Home expose Library as an advanced/admin entry point rather than a peer of Create workflow?
- Should a role template preview show the fully composed prompt body, or only its parts?

### 5. Workflow Run Presentation

Path: `/dashboard/workflows/:instanceId`

Primary job:

- Tell the story of one workflow run.
- Show status, outputs, decisions, waits, errors, and next action without debug internals.

What it currently contains:

- Header with workflow name and status pills.
- Automation provenance, when available.
- Run summary:
  - status;
  - who has the ball;
  - current state;
  - current step;
  - waiting reason;
  - next action.
- Original task, when available.
- Needs-your-input section.
- Child workflow cards.
- Outputs/artifacts.
- Timeline of turns.
- Links to VK sessions for deeper inspection.

UX observations:

- This is the likely highest-value UX surface now.
- It should be the destination after launching a workflow and after clicking notifications.
- It overlaps with Home, Meta-workflows, and Batch Detail because those pages also monitor progress.
- The page should be optimized for user comprehension, not debugging.
- It may need stronger storytelling labels for loops, self-review, review requested changes, tester pass/fail, human waits, and child-workflow waits.

Questions for UX review:

- Should this become the primary “monitoring” experience for all workflow execution, with Home only linking into runs?
- Should meta-workflow parent runs have a presentation page too, rather than only the meta-runs page?
- What is the ideal balance between timeline and summary/cards?
- Should session links be primary or secondary?

### 6. Roadmap Workflow Page

Path: `/dashboard/workflows/roadmap`

Primary job:

- Browse roadmap/bead items and start workflow/meta-workflow work from them.

Current behavior:

- Shows roadmap items and workflow-related links.
- Can queue selected beads into meta-workflow flows.
- Links child workflow runs where available.

UX observations:

- This page is partly a source-of-work page, not just a workflow page.
- It may belong near Workflows because workflows can operate over beads, but it also overlaps with broader roadmap/task management.
- If users think “I want automation to work on these beads,” this page is useful.
- If users think “I want to run a workflow,” Home/Create may be more natural.

Questions for UX review:

- Should Roadmap stay inside Workflows, or should it be a workflow action embedded in a broader Roadmap/Beads page?
- Should starting meta-workflows from roadmap be integrated into the Meta-workflows page instead?
- Is “Roadmap” clear, or should the entry point say “Choose beads” / “Batch tasks” / “Run over beads”?

### 7. Meta-workflows Page

Path: `/dashboard/workflows/meta-runs`

Primary job:

- Start and monitor parent workflows that coordinate child workflow runs over groups of beads.

Current behavior:

- Workspace-scoped.
- Select/search beads.
- Choose a child workflow.
- Start grouped bead work.
- Monitor parent aggregate progress.
- Pause/resume meta-runs.
- Child workflow spam is intentionally suppressed in browser notifications; parent aggregate completion/failure is the notification target.

UX observations:

- This is a specialized workflow mode.
- It overlaps with Roadmap because roadmap can feed bead selections into meta-runs.
- It overlaps with Run Presentation because a meta-run is also a run/story that needs status, progress, failures, and outcomes.
- The page currently combines “start a meta-workflow” and “monitor meta-workflows.” That may be acceptable, but it makes the page heavy.

Questions for UX review:

- Should meta-workflow creation be a mode in Create/Launch rather than a separate page?
- Should each meta-run have its own detail/presentation page?
- Should the meta-runs list be folded into Workflows Home active/recent monitoring?

### 8. Workflow Batch Detail

Path: `/dashboard/workflow-batches/:batchId`

Primary job:

- Show the status of a batch launch and its per-item workflow runs.

Current behavior:

- Lists batch items.
- Shows line/item status, run links, errors, and progress.
- Route is outside `/dashboard/workflows/...` but belongs to the workflow feature.

UX observations:

- Batch Detail and Meta-workflows are conceptually similar: one parent operation produces many child workflow runs.
- Batch likely exists for line-based/bulk launch use cases, while meta-workflows are bead/task grouped orchestration.
- Users may not understand why batch and meta-workflow monitoring are separate.

Questions for UX review:

- Should Batch Detail and Meta-run Detail share one “multi-run progress” component/page pattern?
- Should the route move under `/dashboard/workflows/batches/:batchId` for IA consistency?
- Should batch launches appear on Workflows Home next to meta-runs?

## Major user flows

### Flow A: First-time user creates and runs a workflow from a starter

1. User opens Workflows Home.
2. User clicks Create workflow.
3. User selects a starter template.
4. User names the workflow and describes its purpose.
5. User saves/publishes.
6. User returns to Workflows Home or opens Graph Editor.
7. User launches the workflow.
8. User lands on or opens Workflow Run Presentation.
9. User follows status, decisions, waits, and final outputs.

Potential UX issues:

- The handoff from creation result to launch may require too many page transitions.
- If the user opens Graph Editor after a starter copy, they may encounter a dense authoring surface before they need it.
- The desired path for simple users might be: choose starter → name → publish → launch → run page.

### Flow B: Advanced user creates a blank workflow

1. User opens Create Workflow Wizard.
2. User chooses Blank workflow draft.
3. User names/purposes it.
4. User saves draft.
5. User opens Graph Editor.
6. User adds roles, states, steps, actions, prompt assets, response contracts.
7. User publishes when valid.
8. User launches from Home.

Potential UX issues:

- Blank is truly empty and invalid by design; this must be framed as advanced.
- The editor must make it obvious how to add the first role/state/action.
- Publish errors must guide construction rather than just report schema problems.

### Flow C: User duplicates an existing workflow

1. User opens Create Workflow Wizard or acts from a workflow card.
2. User selects Duplicate existing.
3. User names/purposes the duplicate.
4. System copies design only and preserves asset refs.
5. User edits or publishes.

Potential UX issues:

- Duplicate may be more naturally discovered from a workflow card’s action menu than from the creation wizard.
- Users need confidence that runs/sessions/history are not copied.
- Users need to know whether duplicate starts from draft or latest published version.

### Flow D: User manages reusable agent behavior

1. User opens Workflow Library.
2. User creates or edits prompt assets, skill snippets, and role templates.
3. User pins or tracks latest asset versions in role template attachments.
4. User returns to Graph Editor and links role templates or assets.
5. Prompt preview shows resolved content without internal labels.

Potential UX issues:

- Library terms may be unclear without examples.
- Users may expect changes in Library to update existing workflow runs; actual behavior snapshots content per run.
- Editing as a new version is safe but may feel indirect.

### Flow E: User launches a workflow for beads

1. User opens Workflows Home.
2. User selects a workflow and one or more beads.
3. User launches.
4. Runtime includes bead IDs/titles as safe context.
5. User monitors the run page.

Potential UX issues:

- Multi-bead selection may make a single run harder to understand.
- Run Presentation should show bead IDs/titles prominently and product-safely.
- If an agent needs more details, the UI should not imply raw shell/provider mechanisms.

### Flow F: User runs work over many beads via meta-workflow

1. User opens Roadmap or Meta-workflows.
2. User selects beads or bead groups.
3. User chooses child workflow.
4. User starts meta-run.
5. Parent meta-run launches child workflow runs.
6. User monitors aggregate status.
7. Browser notification fires only when parent meta-run completes/fails/blocks.
8. User opens child runs only when details are needed.

Potential UX issues:

- Roadmap and Meta-workflows split the selection/start experience.
- Parent meta-run does not currently have the same dedicated presentation route as child workflow runs.
- “Lists of lists of beads” is a powerful concept but needs clear UI language.

### Flow G: User responds to workflow attention/human form wait

1. User sees Needs input on Workflows Home or run page.
2. User opens the run.
3. User sees the form/wait reason.
4. User completes the human form or follows the next action.
5. Workflow resumes.

Potential UX issues:

- Attention items must feel actionable from Home.
- Run Presentation should make “why we are waiting” and “what you can do” obvious.
- The form experience should show bead titles when bead IDs are referenced.

### Flow H: User receives browser/PWA notification

1. User enables notifications from Workflows Home.
2. Existing completed/failed runs are marked seen and do not notify retroactively.
3. A new workflow or parent meta-workflow reaches terminal state.
4. Browser notification appears.
5. User clicks notification and lands on Workflows run presentation or meta-runs page.

Potential UX issues:

- Notifications require Workflows page to be open; this should be messaged carefully.
- Meta notification links to the meta-runs page, not a dedicated meta-run presentation page.
- Notification settings may belong in a persistent app/workspace notification settings area eventually.

## Page consolidation opportunities

### Opportunity 1: Merge monitoring patterns across Run, Meta-run, and Batch

Current separate surfaces:

- Workflow Run Presentation: one run.
- Meta-workflows Page: parent aggregate + child runs.
- Batch Detail: parent batch + child runs.
- Workflows Home: recent/active summary.

Recommendation for UX exploration:

- Define a shared “Work Progress” presentation pattern:
  - parent summary;
  - current status;
  - items/children;
  - attention needed;
  - final outcome;
  - links to detailed child runs.
- Keep separate routes if necessary, but make them look and behave like one family.
- Consider adding dedicated detail routes for meta-runs so notifications land on a focused story page, not a combined start/monitor page.

### Opportunity 2: Split Workflows Home into clearer sections instead of more pages

Possible Home IA:

1. Start work
   - Run a workflow.
   - Create workflow.
   - Run over beads / meta-workflow.
2. Needs attention
   - Waiting human inputs.
   - Blocked workflows.
3. In progress
   - Running single workflows.
   - Running meta/batch work.
4. Manage workflows
   - Your workflows.
   - Starter templates.
   - Library.

This could reduce the need for users to understand every page immediately.

### Opportunity 3: Move duplicate action closer to workflow cards

Current duplicate path is in Create Workflow Wizard.

Potential improvement:

- Add “Duplicate” on each workflow card/menu.
- Keep Create Workflow Wizard for blank/starter creation.
- This matches the mental model: “I like this workflow; make me a copy.”

### Opportunity 4: Keep Library separate, but improve cross-links

Library should probably remain separate because it manages reusable assets, not workflow orchestration.

But Graph Editor and Library should cross-link cleanly:

- From role template picker: “Edit in Library”.
- From Library role template detail: “Used by these workflows”.
- From prompt preview: show resolved content, with provenance in diagnostics only.

### Opportunity 5: Reconsider Roadmap placement

Roadmap is source-of-work, not purely workflow management.

Options:

- Keep under Workflows because its primary action is queueing workflow work.
- Move/duplicate entry under broader Roadmap/Beads area and link into Workflows only for automation actions.
- Rename the Workflows entry to “Choose beads” or “Run over roadmap” to clarify intent.

## Terminology risks

The current feature set has many reusable concepts. UX should define consistent labels and decide which terms are visible to normal users.

Recommended visible terms:

- Workflows.
- Runs.
- Starter templates.
- Your workflows.
- Role templates.
- Prompt assets.
- Skill snippets.
- Beads.
- Meta-workflows, only where needed.

Terms to avoid in primary UI:

- queue item;
- webhook;
- HMAC;
- raw XML;
- raw JSON;
- execution ID;
- provider diagnostics;
- prompt/skill internal refs in agent-facing prompts;
- local paths;
- shell or CLI instructions.

Terms that may need gentler product labels:

- Meta-workflow → “Run over multiple beads” or “Grouped workflow run”.
- Batch → “Bulk run”.
- State → “Stage” in user-facing contexts, while editor can still use state where precise.
- Action → “Decision” or “Transition” depending context.

## UX review checklist

Use this checklist while reviewing mockups or current pages.

### Global navigation

- Can a user tell where to create, run, monitor, and configure workflows?
- Are advanced surfaces, especially Library and Graph Editor, visually secondary to common tasks?
- Do page titles match user intent?

### Creation

- Is blank creation clearly advanced and invalid until structured?
- Is starter creation easy enough for first-time success?
- Is duplicate discoverable from the object being duplicated?
- Are draft vs published vs runnable states clear?

### Editing

- Can users edit workflow title/description, roles, states, transitions, prompts, and skills without hunting?
- Are prompt previews realistic and SCIR-clean?
- Are diagnostics clearly secondary?
- Are remove/delete controls safe and understandable?

### Library

- Do users understand why to create a role template vs prompt asset vs skill snippet?
- Is edit-as-new-version understandable?
- Are latest/pinned choices understandable without implying nondeterministic completed runs?

### Running and monitoring

- After launch, does the user land in the most helpful place?
- Can users tell who has the ball and what happens next?
- Are loops and retries understandable?
- Are waits actionable?
- Are failures product-safe and specific?

### Meta/batch work

- Is it clear when the user is starting many child workflow runs?
- Is parent aggregate status more prominent than child noise?
- Can users drill into a child only when needed?
- Are notifications parent-only for meta-workflows?

## Suggested next UX milestones

### Milestone 1: Clean run/story presentation

Focus:

- Improve `/dashboard/workflows/:instanceId` so it tells the work story clearly.
- Use plain-English turn labels.
- Show bead IDs/titles when relevant.
- Make waits/failures actionable.
- Hide debug/internal terms.

Why first:

- Every launch, notification, batch, and meta-workflow eventually points to monitoring and results.
- A clear run page makes the whole system feel trustworthy.

### Milestone 2: Home IA cleanup

Focus:

- Reorganize Home into Start work, Needs attention, In progress, Manage workflows.
- Make Create, Run, Meta-run, Library, and Roadmap relationships clearer.

Why second:

- Home is the feature’s front door and currently carries too many mixed concepts.

### Milestone 3: Multi-run presentation pattern

Focus:

- Unify Meta-workflows and Batch Detail into a shared parent/children progress design pattern.
- Consider dedicated meta-run detail route.

Why third:

- Meta and batch flows are powerful but currently harder to explain than single runs.

### Milestone 4: Creation/duplication polish

Focus:

- Add duplicate action on workflow cards.
- Improve starter preview.
- Make blank draft advanced language clearer.

Why fourth:

- Creation now works functionally; polish can follow after monitoring is clear.

## Open decisions for UX teammate

1. Should Workflows Home remain the all-in-one command center, or become a simpler launcher plus attention summary?
2. Should single run, meta-run, and batch detail share one presentation component/pattern?
3. Should meta-runs get their own detail route that notifications can open directly?
4. Should Roadmap remain a workflow page, move closer to beads/roadmap, or be cross-linked from both?
5. Should “meta-workflow” remain visible terminology, or should the UI use “run over multiple beads” for most users?
6. Should duplicate workflow be primarily a Create Wizard option, a workflow-card action, or both?
7. Should Graph Editor be split into Structure / Prompts / Validation / Preview modes?
8. What is the minimum happy path for a first-time user to create and run a starter workflow without seeing advanced internals?
