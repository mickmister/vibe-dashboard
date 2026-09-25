# BeadsForm ref-backed embedding

BeadsForm rich context is ref-only. Form metadata stores semantic references and
source metadata; it never inlines Markdown files, arbitrary file contents,
generated HTML, or generated controls.

## DSL blocks

- `markdown-attachment`: a single Markdown file reference with `ref`, optional
  `label`, and optional Markdown `description`.
- `media-gallery`: image/video gallery. Image `src`/video `src`/video `poster`
  can be repo-relative refs, explicit staging-root refs when a trusted preview
  or authoring flow declares that staging root, or hosted `http(s)` URLs.
- `attachments`: arbitrary file links. Each item has `id`, `label`, `ref`,
  optional `description`, and optional `mediaType:
  "markdown" | "image" | "video" | "file"`.
- `code-snippet`: source permalink metadata only: repo-relative `path`, commit
  hash, `startLine`, optional `endLine`, and optional `url`.

Preferred bead-backed refs are repo-relative working-tree paths such as:

- `docs/decision.md`
- `./docs/decision.md`
- `screenshots/candidate-a.png`
- `videos/demo.webm`
- `reports/output.log`

Hosted `http://` and `https://` refs remain valid for media/links where the
browser can load them safely. Legacy `attachment://path/to/file` refs are still
served for compatibility from `.beads/attachments`, but new forms should not use
`.beads/attachments` as the authoring convention.

## Runtime serving policy

Bead-backed repo-relative links and media are rewritten by VD to
`/dashboard/api/beads-form/bead-attachment?dir=<repo>&file=<ref>`. The route:

- resolves normal refs only under the bead repo cwd/working tree;
- may also resolve under an explicit staging root only when that root is passed
  by a trusted authoring/preview flow;
- keeps legacy `attachment://...` refs scoped to `<repo>/.beads/attachments`
  for backwards compatibility only;
- rejects traversal, absolute paths, backslashes, nested schemes, unsafe
  protocols, symlinks that leave the allowed root, and unsupported extensions;
- serves only allowlisted Markdown/text/JSON/image/video extensions;
- sets `X-Content-Type-Options: nosniff`;
- never exposes arbitrary filesystem paths.

Folder preview keeps its local-preview behavior and routes folder-relative refs
through `/dashboard/api/beads-form/preview-media`, scoped to the declared
preview folder.

## No upload or inlining

This policy does not add a file upload API. Agents should create referenced
files in the repo working tree or an explicitly declared staging folder before
attaching a bead-backed form. Code snippet blocks render source/permalink
metadata, not file contents, to preserve the ref-only storage rule.
