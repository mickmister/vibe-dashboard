# `/dashboard/workflows/library` — workflow asset library

## Current role

Manages reusable prompt assets, skill snippets, and role templates with version histories and forms for creating/editing new versions.

## UX issues

- **Three asset types appear side-by-side with similar visual weight.** Users need to understand the relationship: prompts and skills feed role templates, which feed workflow steps.
- **Versioning semantics are exposed but not taught.** “Use latest” vs pinned versions is important, but currently presented as dense explanatory text on each card.
- **Forms are technical.** Id fields like `prompt.review.security`, markdown bodies, version numbers, prompt refs, skill refs, executor preference, and model preference assume power-user knowledge.
- **No dependency impact preview.** Editing latest as a new version may affect future runs/designs, but the page does not show which workflows or roles use the asset.
- **Search/filter is only inside attachment pickers.** The library itself needs global search, type filters, source filters, active/inactive filters, and sort.
- **Long previews in cards can produce scan fatigue.** Prompt bodies and skill snippets need better expansion and compare tools.

## Potential improvements

- Add a library overview diagram: Prompt/Skill assets → Role templates → Workflow graph steps.
- Use tabs for Prompts, Skills, and Roles, with a guided “Create role template” flow.
- Add “Used by” counts and impact preview before publishing a new version.
- Provide diff between versions and a “pin this version” explanation.
- Generate ids from names by default; keep manual id edit in advanced settings.
- Add examples/templates for common role assets.
