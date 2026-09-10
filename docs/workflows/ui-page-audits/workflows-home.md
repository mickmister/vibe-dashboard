# `/dashboard/workflows` — workspace workflow center

## Current role

Main workflow dashboard for one workspace or all workspaces. Shows summary tiles, notification controls, engine status, attention items, active/recent runs, batches, lanes, user workflows, starter templates, and launch dialogs.

## UX issues

- **The top-level CTA set is crowded.** Choose beads, Library, Meta-workflows, Create workflow, and Refresh have similar weight. Users need a stronger default next action.
- **“Choose beads” is an unclear label for Roadmap.** It describes a sub-action, not the page destination or job.
- **The page reads as a status dashboard and a workflow marketplace at once.** Monitoring active work and discovering templates are separate mental modes.
- **Summary tiles are counts, not decisions.** “Needs input: 2” should directly lead to the two required actions with priority and age.
- **Empty workspace state is too generic.** It needs a composed first-run path: import/start from template, connect beads, create lane, launch run.
- **Launch dialogs are long and role-heavy.** Role binding, lane, bead context, session preferences, executor/model choices, inputs, and summary make launching feel like configuration, not starting work.
- **Engine status/Gas City readiness is operationally valuable but product-heavy.** It may distract from the user's immediate workflow job.
- **Manual notification opt-in can be missed.** Browser notifications are important for waiting workflows; they need onboarding at the moment a user starts a long-running workflow.

## Potential improvements

- Reframe the hero around one primary action: “Start workflow” with secondary links to Monitor, Roadmap, and Library.
- Add a **Needs attention inbox** at the top with actionable rows and due/stale indicators.
- Separate “Run work” from “Design workflows” with two columns or tabs.
- Convert launch into a wizard with a final “who receives what” review screen.
- Rename “Choose beads” to “Roadmap” or “Select roadmap beads”.
- Hide engine diagnostics unless unhealthy, with “View engine details” available.
- Add live freshness: “Updated 14s ago”, automatic polling, and visible paused/offline state.
