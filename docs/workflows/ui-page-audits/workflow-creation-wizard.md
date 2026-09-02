# `/dashboard/workflows/new` — workflow creation wizard

## Current role

Creates a new workflow design from blank, a starter template, or a duplicate of an existing workflow. Captures name, purpose, publish flag, then sends the user to the graph editor.

## UX issues

- **It is called a wizard but behaves like a short form.** The page has steps, but no progressive navigation, validation checkpoint, or saved draft affordance.
- **The blank workflow default copy is placeholder-like.** “Describe what this workflow should accomplish.” risks being saved unchanged.
- **Source selection lacks previews.** Starter and existing workflows are selected by title only; users cannot inspect roles, states, complexity, or last updated before choosing.
- **Publishing at creation time is ambiguous.** Users may not understand the difference between draft, published, pinned version, and future runs.
- **Load errors do not offer fallback.** If templates fail, a blank workflow could still be available but the error may feel blocking.
- **Success state is minimal.** “Workflow saved” provides links, but does not explain what to do next in the editor.

## Potential improvements

- Make it a true 3-step flow: **Choose starting point → Name and purpose → Review and create**.
- Require a meaningful purpose before enabling create; detect unchanged placeholder text.
- Show starter cards with roles, estimated steps, best-for examples, and complexity.
- Move publish decision to the editor or explain it inline: “Published workflows can be run; drafts are editable only.”
- Offer “Create blank anyway” when library loading fails.
- After success, present “Edit graph”, “Run a test”, and “Back to workflows” as clear next choices.
