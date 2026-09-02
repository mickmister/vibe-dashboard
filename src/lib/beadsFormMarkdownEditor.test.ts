// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { formValuesFromDom, applyValuesToForm } from './beadsFormPreviewState';
import { initializeMarkdownTextareaEditors, refreshMarkdownTextareaEditors } from './beadsFormMarkdownEditor';
import { initializeSingleQuestionMode } from './beadsFormSingleQuestion';

describe('BeadsForm Markdown textarea editor', () => {
  it('adds an accessible compact preview toggle while preserving the textarea as Markdown source', () => {
    document.body.innerHTML = `
      <form>
        <label for="plan">Plan</label>
        <textarea id="plan" name="plan"># Heading

- item

\`\`\`ts
const value = a < b && b > c;
\`\`\`

<script>alert(1)</script> & text</textarea>
      </form>
    `;

    initializeMarkdownTextareaEditors(document.body);

    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[name="plan"]')!;
    const toolbar = document.querySelector<HTMLElement>('.beadsform-markdown-editor-toolbar')!;
    const previewButton = toolbar.querySelector<HTMLButtonElement>('[data-beadsform-markdown-action="preview"]')!;
    const preview = document.querySelector<HTMLElement>('.beadsform-markdown-preview')!;

    expect(toolbar.getAttribute('role')).toBe('group');
    expect(toolbar.getAttribute('aria-label')).toBe('Markdown editor controls for Plan');
    expect(toolbar.textContent).not.toContain('Write Markdown');
    expect(toolbar.textContent).not.toContain('Preview');
    expect(toolbar.textContent).not.toContain('Answers are saved as Markdown source.');
    expect(previewButton.querySelector('svg')).not.toBeNull();
    expect(previewButton.getAttribute('aria-label')).toBe('Show Markdown preview for Plan');
    expect(previewButton.getAttribute('title')).toBe('Show Markdown preview for Plan');
    expect(previewButton.getAttribute('aria-pressed')).toBe('false');
    expect(preview.getAttribute('role')).toBe('region');
    expect(preview.getAttribute('aria-label')).toBe('Markdown preview for Plan');
    expect(preview.hidden).toBe(true);
    expect(textarea.classList.contains('beadsform-markdown-source-hidden')).toBe(false);

    previewButton.click();

    expect(preview.hidden).toBe(false);
    expect(preview.innerHTML).toContain('<h1>Heading</h1>');
    expect(preview.innerHTML).toContain('<li>item</li>');
    expect(preview.innerHTML).toContain('const value = a &lt; b &amp;&amp; b &gt; c;');
    expect(preview.innerHTML).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; text');
    expect(preview.innerHTML).not.toContain('<script>');
    expect(textarea.classList.contains('beadsform-markdown-source-hidden')).toBe(true);
    expect(previewButton.classList.contains('is-active')).toBe(true);
    expect(previewButton.getAttribute('aria-label')).toBe('Hide Markdown preview for Plan');
    expect(previewButton.getAttribute('title')).toBe('Hide Markdown preview for Plan');
    expect(previewButton.getAttribute('aria-pressed')).toBe('true');
    expect(formValuesFromDom(document.querySelector('form')!)).toEqual({
      plan: textarea.value,
    });

    previewButton.click();

    expect(preview.hidden).toBe(true);
    expect(textarea.classList.contains('beadsform-markdown-source-hidden')).toBe(false);
    expect(previewButton.classList.contains('is-active')).toBe(false);
    expect(previewButton.getAttribute('aria-label')).toBe('Show Markdown preview for Plan');
    expect(previewButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('refreshes preview content after draft or submitted values are restored', () => {
    document.body.innerHTML = `
      <form>
        <label for="answer">Answer</label>
        <textarea id="answer" name="answer"></textarea>
      </form>
    `;

    initializeMarkdownTextareaEditors(document.body);
    applyValuesToForm(document.querySelector('form')!, { answer: '**Restored** draft' });
    refreshMarkdownTextareaEditors(document.body);
    document.querySelector<HTMLButtonElement>('[data-beadsform-markdown-action="preview"]')!.click();

    expect(document.querySelector<HTMLElement>('.beadsform-markdown-preview')?.innerHTML).toContain('<strong>Restored</strong> draft');
    expect(formValuesFromDom(document.querySelector('form')!)).toEqual({ answer: '**Restored** draft' });
  });

  it('keeps controls hidden for compact optional-context textareas until they are expanded', () => {
    document.body.innerHTML = `
      <form>
        <button type="button" class="beads-form-more-info-toggle" aria-controls="choice_more_info">💬</button>
        <textarea id="choice_more_info" name="choice_more_info" hidden></textarea>
      </form>
    `;

    initializeMarkdownTextareaEditors(document.body);

    const toolbar = document.querySelector<HTMLElement>('.beadsform-markdown-editor-toolbar')!;
    expect(toolbar.hidden).toBe(true);

    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[name="choice_more_info"]')!;
    textarea.hidden = false;
    refreshMarkdownTextareaEditors(document.body);

    expect(toolbar.hidden).toBe(false);
  });

  it('keeps preview-mode Markdown source available to review and direct submit flows', () => {
    document.body.innerHTML = `
      <div id="host">
        <form>
          <fieldset>
            <legend>Implementation notes</legend>
            <label for="notes">Implementation notes</label>
            <textarea id="notes" name="notes"># Saved source</textarea>
          </fieldset>
          <fieldset>
            <legend>Final choice</legend>
            <label for="final">Final choice</label>
            <input id="final" name="final" value="yes">
          </fieldset>
          <div class="beads-form-submit-actions"><button type="submit">Submit</button></div>
        </form>
      </div>
    `;
    const host = document.querySelector<HTMLElement>('#host')!;
    initializeSingleQuestionMode(host);
    initializeMarkdownTextareaEditors(host);

    document.querySelector<HTMLButtonElement>('[data-beadsform-markdown-action="preview"]')!.click();
    document.querySelector<HTMLButtonElement>('.beadsform-single-question-controls--top button:nth-child(2)')!.click();
    document.querySelector<HTMLButtonElement>('.beadsform-single-question-controls--top button:nth-child(2)')!.click();

    const review = document.querySelector<HTMLElement>('.beadsform-single-question-review')!;
    expect(review.hidden).toBe(false);
    expect(review.textContent).toContain('Answer: # Saved source');
    expect(formValuesFromDom(document.querySelector('form')!)).toMatchObject({
      notes: '# Saved source',
      final: 'yes',
    });
    expect(Array.from(document.querySelectorAll<HTMLFieldSetElement>('.beadsform-single-question-item')).every((question) => question.hidden)).toBe(true);
  });
});
