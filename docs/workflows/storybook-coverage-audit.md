# Workflow Storybook Coverage Audit

Date: 2026-08-17
Bead: `vibe-kanban-vscode-web-4uv7`

## Scope and rule of thumb

This audit covers browser-visible workflow branch features after M90-M120/ZJCB. Storybook coverage should be pure prop/fixture based unless there is a strong reason to exercise live routes. Static/demo fixtures are allowed in Storybook and tests only; product routes should keep using typed providers/read models and must not silently fall back to fake roadmap or bead data.

## Current story inventory

| Surface | Current stories | Coverage status | Notes |
| --- | --- | --- | --- |
| Workflows home / centralized dashboard | `Workflows/Home` | Improved in this audit | Covers workspace overview, dense, empty, loading, product error, global/no-workspace overview, and lane capacity/dirty/blocked states. |
| Roadmap | `Workflows/Roadmap`, `Workflows/Roadmap Concepts` | Improved in this audit | Covers live mixed, stale, provider unavailable/no static product fallback, filters, completed-hidden behavior, workspace-scoped queue affordance, blocked/tester/dense/completed states. |
| Meta-workflows | `Workflows/Meta Workflows` | Improved in this audit | Covers create, selected roadmap beads, confirmation, duplicate/unsupported selections, active, paused, blocked, completed, loading, provider unavailable, and product error states. |
| Workflow graph/editor | `Workflows/Graph` | Adequate | Covers simple, DRT, human form, workflow call, CI wait, dense labels, collapsed/contextual graph, invalid definition, linked role template. Existing stories exercise progressive/sidebar UI via selected role/edit target. |
| Workflow run presentation | `Workflows/Run Presentation` | Improved in this audit | Covers CI waiting/completed, human form wait, workflow-call call tree, invalid XML blocked/needs-attention copy, and product error. |
| Batch detail | `Workflows/Batch Detail` | Added in this audit | Covers mixed batch with pending/running/completed/blocked items, per-item errors, capacity/backpressure, empty, and product error. |
| Workflow creation wizard | `Workflows/Creation Wizard` | Added in this audit | Covers blank simple workflow, starter template copy, duplicate existing workflow, and load error. Save actions are intentionally not mocked in Storybook. |
| Prompt/skill picker and authoring | `Workflows/Graph` | Partial but useful | Prompt/skill picker appears inside selected step details and linked role template story. More interaction-focused stories would need a controlled edit harness. |
| Shared role templates | `Workflows/Graph` | Partial but useful | Linked role template story shows resolved template/version metadata and editor context. Dedicated role-template library CRUD stories remain a follow-up if/when a standalone library page exists. |
| SEBL executor/model role settings | `Workflows/Graph`; launch controls indirectly in `Workflows/Home` | Partial | Editor story shows executor preference; home/launch is not easy to pin open because the launch modal fetches options internally. A pure launch dialog view extraction would improve Storybook coverage. |
| Lane UI / capacity | `Workflows/Home` | Adequate for visible slice | Storybook covers lane cards, dirty status, active write token, archived/blocked capacity, and global no-workspace disabled create-lane state. |
| Browser workflow creation E2E surfaces | `Workflows/Creation Wizard` | Adequate for visual/story coverage | Storybook covers wizard states, while execution remains covered by Docker/browser E2E rather than Storybook. |

## Remaining gaps and follow-up recommendations

1. **Extract pure launch dialog view**: `RunWorkflowDialog` currently owns fetch/submit state, which makes Storybook coverage for launch summary, SEBL workspace default, mismatched existing session warnings, lane selection, and post-launch result awkward. A follow-up should split a pure `RunWorkflowDialogView` from the container.
2. **Extract prompt/skill/role-template library views**: the editor can show linked role template and prompt/skill picker states, but a future centralized library deserves its own pure view and stories for empty, missing/deleted template, immutable version, and publish-new-version states.
3. **Add controlled interaction harness stories only when needed**: config-changing editor/wizard interactions can be shown today, but Storybook assertions around state changes would benefit from a small reusable state harness rather than MSW/live routes.
4. **Keep product/static boundary explicit**: roadmap static/demo data should remain in Storybook/test fixtures only. Product roadmap routes should show typed provider data or product-safe unavailable/error states.
5. **Optional visual regression later**: build/smoke and Storybook walkthrough are enough for this audit. Pixel comparisons can be added after story surfaces stabilize.

## Validation guidance for future changes

- Run `npm run build-storybook` for Storybook additions.
- Run `npm run check-types` and focused component tests when story fixtures exercise typed read models.
- Use Storybook screenshots/video walkthroughs for graph/editor visual changes and long-page scroll regressions.
- Do not use Storybook fixture data as normal product fallback data.
