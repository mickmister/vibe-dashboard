# `/dashboard/workflows/meta-runs` — sequential bead workflows

## Current role

Lets users search/select ordered beads, choose a child workflow, confirm a sequential meta-workflow, and monitor active/past meta-runs.

## UX issues

- **“Meta-workflow” is not user-friendly.** The job is “run this workflow across these beads in order”. The page title should lead with that.
- **Search results and selected order are split across a wide layout.** On smaller screens, selecting and ordering beads may require too much back-and-forth.
- **The scope filter can include dangerous cross-workspace items.** There is a warning, but it is passive and easy to miss.
- **The confirmation step is inline and visually modest.** Starting multiple child workflows should feel like a deliberate review screen.
- **Reordering uses Up/Down buttons.** This is accessible but slow for long lists; there is no drag handle or bulk ordering.
- **Role bindings are auto-created silently.** The page chooses child workflow roles by label/name without showing the queue plan to the user.
- **Pause/resume controls exist on run cards, but recovery expectations are unclear.** Users need to know what pause means for the current child run.

## Potential improvements

- Rename surface to “Run workflow over beads” with “advanced: meta-workflow” in help text.
- Add a sticky selection cart with compact selected beads, validation, and estimated run count.
- Make cross-workspace scope a confirmed mode with stronger visual treatment.
- Use a full review screen before start: beads, child workflow version, role/session plan, expected lane/capacity behavior.
- Add drag-and-drop plus keyboard reordering for selected beads.
- Explain pause/resume semantics per run: pauses next starts vs interrupts active child.
