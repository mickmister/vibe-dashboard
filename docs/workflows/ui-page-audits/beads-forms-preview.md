# `/dashboard/forms/preview` — BeadsForm folder preview

## Current role

Loads `.json` form definitions from a local folder, previews a selected form, captures values, and copies/submits normalized JSON for form development and review.

## UX issues

- **It is a developer utility sharing the same namespace as user forms.** Users may not know whether this is for filling required workflow input or testing a form folder.
- **Folder path is central but not safely guided.** Manual path/query based loading can fail without browse/history/recent affordances.
- **No form quality checklist.** Preview should help authors catch missing labels, unclear prompts, invalid required fields, and poor mobile layout.
- **JSON copied state is the main success.** This makes sense for developers, but should be clearly labeled as preview/dev behavior.
- **Warnings are present but not prioritized.** Critical form issues should block or stand out; minor normalization warnings should be secondary.
- **No side-by-side source/preview mode.** Authors likely need to inspect definition JSON and rendered form together.

## Potential improvements

- Rename or label as “Form preview lab” and keep it visually distinct from “Pending input”.
- Add recent folders and a folder validation summary.
- Add a preview checklist: accessibility labels, required fields, invalid defaults, mobile fit, submit payload.
- Provide tabs for Rendered form, JSON definition, Normalized output, and Agent message.
- Add “Open pending queue” / “Use this in workflow” links when applicable.
