# `/dashboard/workflows/roadmap` — workflow roadmap

## Current role

Displays milestone/bead progress, filters by status, shows source metadata, lets users select queueable roadmap beads, then sends the selection to meta-workflow start.

## UX issues

- **Roadmap and bead selection are competing jobs.** The page is both a progress report and a launch picker, which can make selection feel accidental.
- **Status metrics are clickable filters but look like dashboard counters.** Users may not realize clicking a metric changes the list.
- **Completed milestones are hidden by default.** This is sensible, but the page needs a stronger “active vs all” explanation to avoid perceived missing work.
- **Queue eligibility is subtle.** Disabled checkboxes communicate something is unavailable, but the reason needs to be closer to the disabled control.
- **Source metadata is over-weighted.** Freshness/provider/counts are useful, but take a persistent sidebar that could instead hold selection summary and next action.
- **No workspace path if missing.** The page says creating a new sub-workspace from here is deferred, leaving users at a dead end for starting.

## Potential improvements

- Add a mode toggle: “Review roadmap” vs “Select beads to run”.
- Make status filters look like filters, or add labels/tooltips to metrics: “Click to show blocked only”.
- Use a sticky right rail for selected beads, eligibility warnings, and “Start selected”. Move source metadata into a collapsible footer/card.
- Add per-disabled-item reason text and a “what can I do?” hint.
- Provide a workspace picker or “Open in workspace” path when `workspaceId` is missing.
- Add batch selection helpers: select all active in milestone, select blocked, clear selection.
