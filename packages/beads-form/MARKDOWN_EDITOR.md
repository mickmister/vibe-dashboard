# BeadsForm Markdown textarea editor

BeadsForm textarea answers are authored and submitted as plain Markdown source.
The dashboard enhances rendered form textareas with a compact preview toggle:
the original `<textarea name="...">` remains the submitted form control, and the
preview is derived from that source.

## Audit and package choice

- `~/repos/Vktest` uses a Lexical-based Markdown editor with a
  `MarkdownSyncPlugin` built on `@lexical/markdown`. That architecture is a good
  reference for future true WYSIWYG editing, but it is not reused here because it
  depends on a larger Vktest-specific component/plugin stack.
- `@mdxeditor/editor` provides true WYSIWYG Markdown editing and is Vite/React
  compatible, but it would add a substantial dependency surface for this small
  form slice.
- `@uiw/react-md-editor` is a maintained source/preview editor with a smaller
  integration path than MDXEditor, but it still adds CSS/theming and bundle-size
  risk.
- The implemented approach intentionally avoids a new dependency: native
  textareas get an accessible compact preview toggle, sanitized Markdown
  preview, and unchanged plain-Markdown submission behavior.

## Safety model

- The Markdown source remains the textarea value used by draft restore,
  edit-response restore, direct submit, review, folder preview, bead-backed
  submit, and aggregate submit.
- Preview rendering escapes raw HTML before applying the supported Markdown
  formatting subset. Raw HTML is not persisted as generated answer HTML.
- Hidden compact optional-context textareas keep their editor controls hidden
  until the textarea is expanded.
