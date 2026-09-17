# `/dashboard/workflows/editor/:designId` — workflow graph editor

## Current role

Full workflow design editor. It loads a workflow draft, displays a React Flow graph, provides a wizard/outline, edits workflow details, roles, states, steps, prompts, prompt/skill refs, actions, waits, handoff prompts, validation, XSD diagnostics, and final prompt preview. Users can save drafts and publish.

## UX issues

- **The editor combines visual graph, outline wizard, forms, validation, diagnostics, and prompt preview in one screen.** This is powerful but cognitively overwhelming.
- **The graph is called “Context graph”, but editing primarily happens in side panels.** Users may not know whether to click graph nodes, outline rows, or form controls.
- **Critical destructive actions use browser confirmation.** `window.confirm` style removal lacks context, dependency preview, and undo.
- **Validation exists but is not a guided fix flow.** Issues should link directly to the affected role/state/action field.
- **Prompt authoring is buried inside step details.** The final prompt preview is separated from the field that caused it, making iteration slower.
- **XSD/XML diagnostics are expert-only.** They should be progressive disclosure, not a peer panel competing with design edits.
- **Role template and asset reference versioning is complex.** Users need confidence about “latest” vs pinned behavior in this editor, not only in Library.
- **Publish is a high-impact action but lacks a final review.** Users should see version, validation status, changed assets, and run implications before publishing.
- **No visible autosave/dirty state model.** Save/publish actions exist, but users need “unsaved changes”, last saved time, and conflict handling.

## Potential improvements

- Reframe into three modes: **Design flow**, **Configure selected item**, **Test prompts**.
- Add a persistent breadcrumb: Workflow → Role → State → Step/Action, synchronized across graph and outline.
- Replace browser confirms with an undoable delete panel showing affected transitions and terminal states.
- Make validation actionable: clicking an issue selects the node/edge and focuses the field.
- Co-locate prompt preview with prompt editor, with “show compiled prompt” and “show XML contract” toggles.
- Add a publish checklist modal: validation, changed roles/states/actions, asset refs, version bump, and “run smoke test” option.
- Add autosave status and keyboard shortcuts for save, publish, find node, and zoom to selection.
