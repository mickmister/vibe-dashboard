# `/dashboard/forms` — BeadsForm workspace/pending forms

## Current role

Shows pending BeadsForm submissions or workspace-scoped bead forms. Lets users pick repos/beads/forms, fill generated form HTML, submit normalized answers, inspect warnings/summary/agent message, and optionally remove review labels.

## UX issues

- **Visual system diverges from the workflow dashboard.** The page uses `beadsform-*` classes and plain headings, so it feels separate from VD workflows.
- **The route has several modes in one page.** Pending queue, parent directory scan, workspace forms, bead details, selected form, and submission result have different mental models.
- **Generated HTML forms are risky UX.** The host page may not fully control spacing, validation, labels, keyboard behavior, and dark-mode contrast inside arbitrary form HTML.
- **Repo/workspace scoping is complex.** “Show all beads” includes unscoped/other-workspace beads, but users need stronger warnings and filtering.
- **Submission result is developer-oriented.** Pretty summary, normalized JSON, and agent message are useful, but ordinary users need “submitted and next step”.
- **Review label removal is easy to misunderstand.** It is not clear whether this changes workflow state, bead state, or simply a local label.
- **Loading/error states are text-only.** Scanning repos could take time and needs progress indication.

## Potential improvements

- Restyle as a first-class workflow human-input page using the standalone dashboard/card system.
- Split routes or tabs into **Pending input**, **Browse workspace forms**, and **Folder preview**.
- Wrap generated forms in a controlled shell with consistent field validation, required markers, help text, and submit affordances.
- After submit, show one primary outcome: “Answer saved; return to workflow” plus expandable JSON/agent-message diagnostics.
- Add clear source breadcrumbs: workspace → repo → bead → form.
- Make cross-workspace inclusion a confirmed filter with count and warning.
