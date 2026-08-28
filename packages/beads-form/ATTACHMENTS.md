# BeadsForm ref-backed attachments

BeadsForm rich context is ref-only. Form metadata stores semantic references and
source metadata; it does not inline Markdown files, arbitrary file contents,
generated HTML, or generated controls.

## DSL blocks

- `media-gallery`: existing image/video gallery. `src` and `poster` can be
  `https://...`, `http://...`, or `attachment://...` for bead-backed forms.
  Folder preview may also use folder-relative refs.
- `markdown-attachment`: a single Markdown file reference with `ref`, optional
  `label`, and optional Markdown `description`.
- `attachments`: a list of arbitrary file references. Each item has `id`,
  `label`, `ref`, optional `description`, and optional `mediaType:
  "markdown" | "image" | "video" | "file"`.
- `code-snippet`: source permalink metadata only: repo-relative `path`, commit
  hash, `startLine`, optional `endLine`, and optional `url`.

Use `attachment://path/to/file` for bead-backed local artifacts. Agents should
place those files under the repo's `.beads/attachments/` directory and attach
only the `attachment://...` ref in the form DSL. Do not use absolute filesystem
paths or `../` traversal refs.

## Runtime serving policy

Bead-backed `attachment://` links and media are rewritten by VD to
`/dashboard/api/beads-form/bead-attachment?dir=<repo>&file=<ref>`. The route:

- resolves files only under `<repo>/.beads/attachments`;
- rejects traversal and symlinks that leave that directory;
- serves only allowlisted Markdown/text/JSON/image/video extensions;
- sets `X-Content-Type-Options: nosniff`;
- never exposes arbitrary filesystem paths.

Folder preview keeps its existing local-preview behavior and routes local refs
through `/dashboard/api/beads-form/preview-media`.

## Current limitations

This slice does not add an upload command/API. Agents must create/copy artifact
files under `.beads/attachments/` themselves before attaching a bead-backed form
that references them. Code snippet blocks render source/permalink metadata, not
file contents, to preserve the ref-only storage rule.
