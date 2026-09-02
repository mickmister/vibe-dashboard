type MarkdownEditorElements = {
  toolbar: HTMLElement;
  preview: HTMLElement;
  previewButton: HTMLButtonElement;
};

const TEXTAREA_MARKDOWN_EDITOR_DATASET = 'beadsformMarkdownEditor';
const SOURCE_HIDDEN_CLASS = 'beadsform-markdown-source-hidden';

export function initializeMarkdownTextareaEditors(host: ParentNode): void {
  for (const textarea of Array.from(host.querySelectorAll<HTMLTextAreaElement>('textarea[name]'))) {
    if (textarea.dataset[TEXTAREA_MARKDOWN_EDITOR_DATASET] === 'true') continue;
    textarea.dataset[TEXTAREA_MARKDOWN_EDITOR_DATASET] = 'true';
    const elements = createEditorElements(textarea);
    textarea.after(elements.toolbar, elements.preview);
    syncEditorHiddenState(textarea, elements);
    textarea.addEventListener('input', () => {
      renderPreview(textarea, elements.preview);
    });
    textarea.addEventListener('change', () => {
      renderPreview(textarea, elements.preview);
    });
    textarea.addEventListener('beadsform:textarea-visibility-change', () => {
      syncEditorHiddenState(textarea, elements);
    });
    elements.previewButton.addEventListener('click', () => {
      renderPreview(textarea, elements.preview);
      setPreviewMode(textarea, elements, elements.preview.hidden);
    });
    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => syncEditorHiddenState(textarea, elements));
      observer.observe(textarea, { attributes: true, attributeFilter: ['hidden', 'disabled', 'readonly'] });
    }
  }
}

export function refreshMarkdownTextareaEditors(host: ParentNode): void {
  for (const textarea of Array.from(host.querySelectorAll<HTMLTextAreaElement>('textarea[data-beadsform-markdown-editor="true"]'))) {
    const elements = editorElementsForTextarea(textarea);
    if (!elements) continue;
    renderPreview(textarea, elements.preview);
    syncEditorHiddenState(textarea, elements);
  }
}

function createEditorElements(textarea: HTMLTextAreaElement): MarkdownEditorElements {
  const label = textareaLabel(textarea);
  const toolbar = document.createElement('div');
  toolbar.className = 'beadsform-markdown-editor-toolbar';
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', `Markdown editor controls for ${label}`);

  const previewButton = document.createElement('button');
  previewButton.type = 'button';
  previewButton.className = 'beadsform-markdown-preview-toggle';
  previewButton.dataset.beadsformMarkdownAction = 'preview';
  previewButton.setAttribute('aria-pressed', 'false');
  previewButton.setAttribute('aria-label', `Show Markdown preview for ${label}`);
  previewButton.setAttribute('title', `Show Markdown preview for ${label}`);
  previewButton.innerHTML = eyeIconSvg();

  toolbar.append(previewButton);

  const preview = document.createElement('div');
  preview.className = 'beadsform-markdown-preview beads-form-description';
  preview.setAttribute('role', 'region');
  preview.setAttribute('aria-label', `Markdown preview for ${label}`);
  preview.hidden = true;
  renderPreview(textarea, preview);

  return { toolbar, preview, previewButton };
}

function editorElementsForTextarea(textarea: HTMLTextAreaElement): MarkdownEditorElements | undefined {
  const toolbar = textarea.nextElementSibling;
  const preview = toolbar?.nextElementSibling;
  if (!(toolbar instanceof HTMLElement) || !toolbar.classList.contains('beadsform-markdown-editor-toolbar')) return undefined;
  if (!(preview instanceof HTMLElement) || !preview.classList.contains('beadsform-markdown-preview')) return undefined;
  const previewButton = toolbar.querySelector<HTMLButtonElement>('[data-beadsform-markdown-action="preview"]');
  if (!previewButton) return undefined;
  return { toolbar, preview, previewButton };
}

function setPreviewMode(textarea: HTMLTextAreaElement, elements: MarkdownEditorElements, previewMode: boolean): void {
  textarea.classList.toggle(SOURCE_HIDDEN_CLASS, previewMode);
  elements.preview.hidden = !previewMode;
  elements.previewButton.classList.toggle('is-active', previewMode);
  elements.previewButton.setAttribute('aria-pressed', String(previewMode));
  const label = textareaLabel(textarea);
  const action = previewMode ? 'Hide' : 'Show';
  elements.previewButton.setAttribute('aria-label', `${action} Markdown preview for ${label}`);
  elements.previewButton.setAttribute('title', `${action} Markdown preview for ${label}`);
  if (!previewMode) textarea.focus();
}

function syncEditorHiddenState(textarea: HTMLTextAreaElement, elements: MarkdownEditorElements): void {
  const hidden = textarea.hidden;
  elements.toolbar.hidden = hidden;
  if (hidden) {
    textarea.classList.remove(SOURCE_HIDDEN_CLASS);
    elements.preview.hidden = true;
    elements.previewButton.classList.remove('is-active');
    elements.previewButton.setAttribute('aria-pressed', 'false');
    const label = textareaLabel(textarea);
    elements.previewButton.setAttribute('aria-label', `Show Markdown preview for ${label}`);
    elements.previewButton.setAttribute('title', `Show Markdown preview for ${label}`);
  }
}

function eyeIconSvg(): string {
  return [
    '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
    '<path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" />',
    '<path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" />',
    '</svg>',
  ].join('');
}

function renderPreview(textarea: HTMLTextAreaElement, preview: HTMLElement): void {
  const value = textarea.value.trim();
  preview.innerHTML = value ? renderMarkdown(value) : '<p><em>No Markdown entered yet.</em></p>';
}

function textareaLabel(textarea: HTMLTextAreaElement): string {
  const explicit = textarea.getAttribute('aria-label')?.trim();
  if (explicit) return explicit;
  if (textarea.id) {
    const label = textarea.ownerDocument.querySelector<HTMLLabelElement>(`label[for="${cssEscape(textarea.id)}"]`)?.textContent?.trim();
    if (label) return label;
  }
  const legend = textarea.closest('fieldset')?.querySelector('legend')?.textContent?.trim();
  return legend || textarea.name || 'textarea';
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHref(value: string): string | undefined {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed) return undefined;
  if (
    lower.startsWith('http://')
    || lower.startsWith('https://')
    || lower.startsWith('mailto:')
    || lower.startsWith('/')
    || lower.startsWith('#')
  ) {
    return trimmed;
  }
  return undefined;
}

function renderInlineMarkdown(input: string): string {
  let html = escapeHtml(input);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
    const safe = safeHref(href);
    if (!safe) return label;
    return `<a href="${escapeHtml(safe)}" rel="noopener noreferrer">${label}</a>`;
  });
  return html;
}

function renderMarkdown(value: string): string {
  const blocks: string[] = [];
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let codeLines: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join('\n').trim()).replace(/\n/g, '<br>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(`<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`);
    listItems = [];
  };

  for (const line of lines) {
    if (codeLines) {
      if (/^```/.test(line.trim())) {
        blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = null;
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (/^```/.test(line.trim())) {
      flushParagraph();
      flushList();
      codeLines = [];
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1]!.length;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2]!.trim())}</h${level}>`);
      continue;
    }

    const list = line.match(/^\s*[-*]\s+(.+)$/);
    if (list) {
      flushParagraph();
      listItems.push(list[1]!.trim());
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  if (codeLines) blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  return blocks.join('');
}
