# UI page audits for workflow surfaces

Branch: `vk/8b79-vd-workflows`

Route inventory source: `moduleAPI.registerRoute(...)` calls in:

- `src/modules/MainUIShellModule.tsx`
- `src/modules/BeadsFormModule.tsx`

These notes focus on the user-facing pages added or substantially expanded for the workflow, agent-team, dashboard workspace, and BeadsForm feature set on this branch. They are intentionally UX/product oriented rather than implementation-review notes.

## Audited pages

- [`/` and `/dashboard`](./dashboard-home.md)
- [`/dashboard/workspaces/:workspaceId`](./dashboard-workspace-link.md)
- [`/dashboard/admin/plugins`](./admin-plugins.md)
- [`/dashboard/teams`](./agent-teams.md)
- [`/dashboard/workflows`](./workflows-home.md)
- [`/dashboard/workflows/new`](./workflow-creation-wizard.md)
- [`/dashboard/workflows/roadmap`](./workflow-roadmap.md)
- [`/dashboard/workflows/library`](./workflow-library.md)
- [`/dashboard/workflows/meta-runs`](./workflow-meta-runs.md)
- [`/dashboard/workflows/editor/:designId`](./workflow-graph-editor.md)
- [`/dashboard/workflow-batches/:batchId`](./workflow-batch-detail.md)
- [`/dashboard/workflows/:instanceId`](./workflow-presentation.md)
- [`/dashboard/forms`](./beads-forms.md)
- [`/dashboard/forms/preview`](./beads-forms-preview.md)

## Cross-surface themes

1. **Information architecture is currently feature-led, not job-led.** The user sees Workflows, Agent Teams, Roadmap, Library, Meta-workflows, Batches, durable instances, forms, and plugin admin as separate conceptual islands. A stronger surface would group around jobs: “start work”, “watch work”, “review/unstick work”, and “maintain workflow assets”.
2. **Nearly every workflow page uses the same bordered dark card language.** This is consistent, but it makes priority hard to parse. The most important next action often has the same weight as diagnostics, metadata, and secondary navigation.
3. **Loading states are mostly text blocks.** For dashboard-like pages, skeletons matching summaries, lists, and sidebars would preserve layout and reduce perceived instability.
4. **Empty states explain absence but rarely teach the first successful path.** The user needs a guided path from “no workflows/runs/forms yet” to a concrete next action.
5. **Terminology is expert-heavy.** “lane”, “bead”, “meta-workflow”, “refs-only”, “wakeup”, “role binding”, “capacity token”, and “orchestration” are useful internally but need progressive disclosure for users.
6. **Refresh is manual and repeated.** Most pages have refresh buttons but little confidence about freshness, polling, or live updates. Workflow monitoring should feel live by default.
7. **Recovery actions are deferred or absent.** Error/blocked/waiting states are shown, but user-facing choices such as retry, cancel, pause, reopen session, resolve form, or inspect blocker are inconsistent.
8. **Focus and keyboard affordances need an explicit pass.** Many elements are semantic buttons/links, but dense custom panels need visible focus states, skip targets, and shortcut strategy.
